// Helper natif de Sténo pour les appels :
//   detect             écrit (en JSON, sur stdout) les apps qui utilisent le micro ou la sortie audio
//   record --out <dir> enregistre le micro (mic.wav) et tout le son du Mac (system.wav), calés sur la même horloge
//                      avec --mic-only, seulement le micro (dictée)
//   cancel-echo --mic <wav> --reference <wav> --out <wav>
//                      retire du micro le son du Mac qu'il a capté (annulation d'écho de WebRTC)
//   hotkey             écrit le début (Option droite + Cmd droite enfoncées) et la fin (l'une relâchée) de la dictée
//   paste              simule Cmd+V dans l'application active
//
// hotkey et paste n'ont besoin que de la permission « Accessibilité »
//
// Inspiré d'OpenWhispr (licence MIT) : resources/macos-mic-listener.swift et resources/macos-audio-tap.swift

import ApplicationServices
import AVFoundation
import CoreAudio
import Foundation

// Les fichiers sont écrits en 16 kHz mono : suffisant pour la voix, ffmpeg les compresse ensuite
let sampleRate = 16_000.0

func json(_ event: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]) else { return "{}" }
    return String(decoding: data, as: UTF8.self)
}

func emit(_ event: [String: Any]) {
    print(json(event))
    fflush(stdout)
}

func fail(_ message: String) -> Never {
    emit(["type": "error", "message": message])
    exit(1)
}

func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}

// ---------- detect ----------

func processObjects() -> [AudioObjectID] {
    var addr = address(kAudioHardwarePropertyProcessObjectList)
    let system = AudioObjectID(kAudioObjectSystemObject)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(system, &addr, 0, nil, &size) == noErr, size > 0 else { return [] }
    var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(system, &addr, 0, nil, &size, &objects) == noErr else { return [] }
    return objects
}

func uint32Property(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
    var addr = address(selector)
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    return AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value) == noErr ? value : nil
}

func stringProperty(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    var addr = address(selector)
    var value: CFString?
    var size = UInt32(MemoryLayout<CFString?>.size)
    let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &addr, 0, nil, &size, $0) }
    return status == noErr ? value as String? : nil
}

// Ce sont des processus helper qui tiennent le micro (ex. « Google Chrome Helper ») :
// on remonte à l'app qui les contient, le .app le plus externe de leur chemin
var appIdByPid: [pid_t: String] = [:]

func appBundleId(pid: pid_t, fallback: String?) -> String? {
    if let cached = appIdByPid[pid] { return cached }

    var buffer = [CChar](repeating: 0, count: 4096)
    var bundleId = fallback
    if proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 {
        let components = String(cString: buffer).split(separator: "/")
        if let appIndex = components.firstIndex(where: { $0.hasSuffix(".app") }) {
            let appPath = "/" + components[...appIndex].joined(separator: "/")
            bundleId = Bundle(path: appPath)?.bundleIdentifier ?? fallback
        }
    }
    if let bundleId { appIdByPid[pid] = bundleId }
    return bundleId
}

func audioApps() -> [[String: Any]] {
    var apps: [String: (input: Bool, output: Bool)] = [:]

    for object in processObjects() {
        guard let pid = uint32Property(object, kAudioProcessPropertyPID).map({ pid_t(bitPattern: $0) }),
              pid != getpid() else { continue }
        let input = (uint32Property(object, kAudioProcessPropertyIsRunningInput) ?? 0) != 0
        let output = (uint32Property(object, kAudioProcessPropertyIsRunningOutput) ?? 0) != 0
        guard input || output,
              let bundleId = appBundleId(pid: pid, fallback: stringProperty(object, kAudioProcessPropertyBundleID)) else { continue }

        let previous = apps[bundleId] ?? (false, false)
        apps[bundleId] = (previous.input || input, previous.output || output)
    }

    return apps.keys.sorted().map { ["bundleId": $0, "input": apps[$0]!.input, "output": apps[$0]!.output] }
}

func runDetect() -> Never {
    var lastLine = ""
    // Sur macOS 26, les notifications de Core Audio sur ces propriétés ne se déclenchent pas : on interroge
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now(), repeating: 1.0)
    timer.setEventHandler {
        let line = json(["apps": audioApps()])
        if line != lastLine {
            lastLine = line
            print(line)
            fflush(stdout)
        }
    }
    timer.resume()
    dispatchMain()
}

// ---------- record ----------

// Écart toléré entre la position d'une piste et l'horloge de la machine avant de le combler par du silence
let maxDrift = 0.05

func log(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

// Convertit l'audio reçu en 16 kHz mono, l'écrit dans un WAV et mesure son niveau.
// Chaque échantillon est placé selon l'heure à laquelle il a été capté, comptée depuis `startHostTime` :
// les deux pistes d'un appel restent calées même si l'une démarre plus tard ou perd des blocs en route
final class TrackWriter {
    private let file: AVAudioFile
    private let name: String
    private let startHostTime: UInt64
    private let outputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!
    private var converter: AVAudioConverter?
    private var framesWritten: AVAudioFramePosition = 0
    private var started = false
    private let levelLock = NSLock()
    private var peak: Float = 0

    // Une seconde de silence, écrite autant de fois que nécessaire
    private lazy var silence: AVAudioPCMBuffer = {
        let buffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: AVAudioFrameCount(sampleRate))!
        buffer.frameLength = buffer.frameCapacity
        memset(buffer.floatChannelData![0], 0, Int(buffer.frameCapacity) * MemoryLayout<Float>.size)
        return buffer
    }()

    init(url: URL, name: String, startHostTime: UInt64) throws {
        self.name = name
        self.startHostTime = startHostTime
        file = try AVAudioFile(
            forWriting: url,
            settings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: sampleRate,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
            ],
            commonFormat: .pcmFormatFloat32,
            interleaved: false
        )
    }

    // `hostTime` : instant où le premier échantillon du bloc a été capté, sur l'horloge de la machine
    func write(_ buffer: AVAudioPCMBuffer, at hostTime: UInt64?) {
        if converter == nil || converter!.inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: outputFormat)
            // Seul le premier canal est gardé, comme le fait déjà le convertisseur pour 2 canaux. Il faut le dire
            // au-delà (ex. micro en 9 canaux) : sans ça, la conversion ne rend que du silence
            converter?.channelMap = [0]
        }
        guard let converter,
              let output = AVAudioPCMBuffer(
                  pcmFormat: outputFormat,
                  frameCapacity: AVAudioFrameCount(Double(buffer.frameLength) * sampleRate / buffer.format.sampleRate) + 32
              ) else { return }

        var provided = false
        _ = converter.convert(to: output, error: nil) { _, status in
            if provided {
                status.pointee = .noDataNow
                return nil
            }
            provided = true
            status.pointee = .haveData
            return buffer
        }
        guard output.frameLength > 0 else { return }

        // Début plus tardif que l'autre piste, ou blocs perdus : on comble avec du silence pour rester à l'heure
        if let hostTime {
            let elapsed = AVAudioTime.seconds(forHostTime: hostTime) - AVAudioTime.seconds(forHostTime: startHostTime)
            let missing = AVAudioFramePosition(elapsed * sampleRate) - framesWritten
            if missing > AVAudioFramePosition(maxDrift * sampleRate) {
                if started { log("\(name) : \(String(format: "%.2f", Double(missing) / sampleRate)) s perdues, remplacées par du silence") }
                writeSilence(missing)
            }
        }
        started = true

        try? file.write(from: output)
        framesWritten += AVAudioFramePosition(output.frameLength)

        let samples = UnsafeBufferPointer(start: output.floatChannelData![0], count: Int(output.frameLength))
        let rms = sqrt(samples.reduce(0) { $0 + $1 * $1 } / Float(samples.count))
        levelLock.lock()
        peak = max(peak, rms)
        levelLock.unlock()
    }

    private func writeSilence(_ frames: AVAudioFramePosition) {
        var remaining = frames
        while remaining > 0 {
            silence.frameLength = AVAudioFrameCount(min(remaining, AVAudioFramePosition(silence.frameCapacity)))
            try? file.write(from: silence)
            remaining -= AVAudioFramePosition(silence.frameLength)
        }
        framesWritten += frames
    }

    // Écrit l'en-tête définitif du WAV
    func close() {
        file.close()
    }

    // Niveau entre 0 et 1 depuis le dernier appel (échelle de -50 dB à 0 dB)
    func takeLevel() -> Double {
        levelLock.lock()
        let rms = peak
        peak = 0
        levelLock.unlock()
        guard rms > 0 else { return 0 }
        return min(1, max(0, (20 * log10(Double(rms)) + 50) / 50))
    }
}

// Tap Core Audio sur tout le son joué par le Mac (macOS 14.2+), lu via un aggregate device privé
final class SystemAudioCapture {
    private let writer: TrackWriter
    private let queue = DispatchQueue(label: "com.devify.steno.recorder.system")
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var deviceID = AudioObjectID(kAudioObjectUnknown)
    private var ioProcID: AudioDeviceIOProcID?

    init(writer: TrackWriter) {
        self.writer = writer
    }

    func start() throws {
        let description = CATapDescription()
        description.name = "Sténo"
        description.uuid = UUID()
        // Liste d'exclusion vide : tous les processus
        description.processes = []
        description.isExclusive = true
        description.isMono = true
        description.isMixdown = true
        description.isPrivate = true
        description.muteBehavior = .unmuted
        try check(AudioHardwareCreateProcessTap(description, &tapID), "création du tap audio")

        var tapUID: CFString?
        var addr = address(kAudioTapPropertyUID)
        var size = UInt32(MemoryLayout<CFString?>.size)
        try check(withUnsafeMutablePointer(to: &tapUID) { AudioObjectGetPropertyData(tapID, &addr, 0, nil, &size, $0) }, "lecture du tap audio")

        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Sténo",
            kAudioAggregateDeviceUIDKey: "com.devify.steno.recorder.\(UUID().uuidString)",
            kAudioAggregateDeviceSubDeviceListKey: [],
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: tapUID! as String]],
            kAudioAggregateDeviceTapAutoStartKey: false,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
        ]
        try check(AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &deviceID), "création du périphérique audio")

        var streamDescription = AudioStreamBasicDescription()
        var formatAddr = address(kAudioTapPropertyFormat)
        var formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        try check(AudioObjectGetPropertyData(tapID, &formatAddr, 0, nil, &formatSize, &streamDescription), "lecture du format audio")
        guard let format = AVAudioFormat(streamDescription: &streamDescription) else { throw RecorderError("format audio système illisible") }

        try check(AudioDeviceCreateIOProcIDWithBlock(&ioProcID, deviceID, queue) { [writer] _, inputData, inputTime, _, _ in
            if let buffer = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: inputData, deallocator: nil) {
                let time = inputTime.pointee
                writer.write(buffer, at: time.mFlags.contains(.hostTimeValid) ? time.mHostTime : nil)
            }
        }, "lecture du son système")
        // C'est ici que macOS demande la permission « Enregistrement audio système »
        try check(AudioDeviceStart(deviceID, ioProcID), "démarrage du son système")
    }

    func stop() {
        if deviceID != kAudioObjectUnknown {
            AudioDeviceStop(deviceID, ioProcID)
            if let ioProcID { AudioDeviceDestroyIOProcID(deviceID, ioProcID) }
            AudioHardwareDestroyAggregateDevice(deviceID)
        }
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
        // Attend la fin du dernier bloc audio en cours d'écriture
        queue.sync {}
    }
}

// Micro via AVAudioEngine. macOS l'arrête sans prévenir quand la configuration audio change (casque branché,
// autre app qui ouvre le micro à une autre fréquence…) : on le relance alors, sur un moteur neuf qui suit le micro
// par défaut du moment. Le trou est comblé par du silence, la piste reste calée.
// Approche reprise de quill (MIT, github.com/humanitas-labs/quill) : relance sur changement de configuration,
// et surveillance de l'arrivée du son pour les arrêts que macOS ne signale pas
final class MicrophoneCapture {
    // Sans aucun bloc audio pendant ce délai (le silence en produit aussi), le micro est considéré comme arrêté
    private let stallSeconds = 3.0
    // Les changements de configuration arrivent souvent en rafale : on attend qu'ils soient passés
    private let restartDelay = 0.75

    private let writer: TrackWriter
    private var engine: AVAudioEngine?
    private var configurationObserver: NSObjectProtocol?
    private var watchdog: DispatchSourceTimer?
    private var pendingRestart: DispatchWorkItem?
    private let aliveLock = NSLock()
    private var lastBufferAt = Date()

    init(writer: TrackWriter) {
        self.writer = writer
    }

    // Appelé sur la file principale, comme tout le reste de la classe
    func start() throws {
        try startEngine()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in self?.checkAlive() }
        timer.resume()
        watchdog = timer
    }

    func stop() {
        watchdog?.cancel()
        pendingRestart?.cancel()
        stopEngine()
    }

    private func startEngine() throws {
        let engine = AVAudioEngine()
        let input = engine.inputNode
        input.installTap(onBus: 0, bufferSize: 4096, format: input.outputFormat(forBus: 0)) { [weak self, writer] buffer, when in
            self?.markAlive()
            writer.write(buffer, at: when.isHostTimeValid ? when.hostTime : nil)
        }
        configurationObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            self?.scheduleRestart("changement de configuration audio")
        }
        self.engine = engine
        markAlive()
        try engine.start()
    }

    private func stopEngine() {
        if let configurationObserver { NotificationCenter.default.removeObserver(configurationObserver) }
        configurationObserver = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
    }

    private func markAlive() {
        aliveLock.lock()
        lastBufferAt = Date()
        aliveLock.unlock()
    }

    private func checkAlive() {
        aliveLock.lock()
        let silentFor = Date().timeIntervalSince(lastBufferAt)
        aliveLock.unlock()
        if silentFor >= stallSeconds && pendingRestart == nil {
            scheduleRestart("plus de son depuis \(Int(silentFor)) s")
        }
    }

    private func scheduleRestart(_ reason: String) {
        pendingRestart?.cancel()
        let restart = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.pendingRestart = nil
            log("micro : \(reason), relance")
            self.stopEngine()
            do {
                try self.startEngine()
            } catch {
                // Le micro n'est peut-être pas encore disponible : la surveillance réessaiera dans quelques secondes
                log("micro : relance impossible (\(error))")
            }
        }
        pendingRestart = restart
        DispatchQueue.main.asyncAfter(deadline: .now() + restartDelay, execute: restart)
    }
}

struct RecorderError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

func check(_ status: OSStatus, _ step: String) throws {
    if status != noErr { throw RecorderError("échec : \(step) (\(status))") }
}

func runRecord(outputDir: URL, micOnly: Bool) -> Never {
    let permission = DispatchSemaphore(value: 0)
    var micAllowed = false
    AVCaptureDevice.requestAccess(for: .audio) { granted in
        micAllowed = granted
        permission.signal()
    }
    permission.wait()
    if !micAllowed { fail("Accès au micro refusé") }

    // Origine commune des deux pistes : chacune commence au lancement de l'enregistrement
    let startHostTime = mach_absolute_time()
    let micWriter: TrackWriter
    let systemWriter: TrackWriter?
    do {
        micWriter = try TrackWriter(url: outputDir.appendingPathComponent("mic.wav"), name: "micro", startHostTime: startHostTime)
        systemWriter = micOnly ? nil : try TrackWriter(url: outputDir.appendingPathComponent("system.wav"), name: "son du Mac", startHostTime: startHostTime)
    } catch {
        fail("Impossible de créer les fichiers audio : \(error)")
    }

    let mic = MicrophoneCapture(writer: micWriter)
    let system = systemWriter.map { SystemAudioCapture(writer: $0) }
    do {
        try mic.start()
        try system?.start()
    } catch {
        fail("\(error)")
    }
    emit(["type": "started"])

    let levels = DispatchSource.makeTimerSource(queue: .main)
    levels.schedule(deadline: .now(), repeating: 0.1)
    levels.setEventHandler {
        emit(["type": "level", "mic": micWriter.takeLevel(), "system": systemWriter?.takeLevel() ?? 0])
    }
    levels.resume()

    // Arrêt propre sur SIGTERM : on coupe les deux sources avant de finaliser les WAV
    signal(SIGTERM, SIG_IGN)
    let stop = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    stop.setEventHandler {
        levels.cancel()
        mic.stop()
        system?.stop()
        micWriter.close()
        systemWriter?.close()
        emit(["type": "stopped"])
        exit(0)
    }
    stop.resume()
    dispatchMain()
}

// ---------- cancel-echo ----------

// Après un appel : retire du micro le son du Mac qu'il a capté (la voix des autres sortie par les haut-parleurs).
// Les deux pistes sont calées sur la même horloge, le son du Mac sert de référence à l'annulation d'écho de WebRTC
func runCancelEcho(mic: URL, reference: URL, output: URL) -> Never {
    do {
        let micFile = try AVAudioFile(forReading: mic)
        let referenceFile = try AVAudioFile(forReading: reference)
        let format = micFile.processingFormat
        guard format.channelCount == 1, referenceFile.processingFormat == format else {
            fail("Les deux pistes doivent avoir le même format mono")
        }
        let outputFile = try AVAudioFile(forWriting: output, settings: micFile.fileFormat.settings, commonFormat: .pcmFormatFloat32, interleaved: false)

        guard let canceller = echo_canceller_create(Int32(format.sampleRate)) else { fail("Annulation d'écho indisponible") }
        defer { echo_canceller_destroy(canceller) }
        let blockSize = AVAudioFrameCount(echo_canceller_block_size(canceller))
        let micBlock = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: blockSize)!
        let referenceBlock = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: blockSize)!

        // Le dernier bloc, incomplet, est complété par du silence le temps du traitement
        func read(_ file: AVAudioFile, into block: AVAudioPCMBuffer) throws -> AVAudioFrameCount {
            block.frameLength = 0
            if file.framePosition < file.length { try file.read(into: block, frameCount: blockSize) }
            let count = block.frameLength
            memset(block.floatChannelData![0] + Int(count), 0, Int(blockSize - count) * MemoryLayout<Float>.size)
            block.frameLength = blockSize
            return count
        }

        while micFile.framePosition < micFile.length {
            let count = try read(micFile, into: micBlock)
            _ = try read(referenceFile, into: referenceBlock)
            let status = echo_canceller_process(canceller, referenceBlock.floatChannelData![0], micBlock.floatChannelData![0])
            if status != 0 { fail("Échec de l'annulation d'écho (\(status))") }
            micBlock.frameLength = count
            try outputFile.write(from: micBlock)
        }
    } catch {
        fail("Annulation d'écho : \(error)")
    }
    exit(0)
}

// ---------- hotkey ----------

// Option droite et Cmd droite, chacune avec son propre bit dans les flags (NX_DEVICERALTKEYMASK, NX_DEVICERCMDKEYMASK)
let rightOptionMask: UInt64 = 0x40
let rightCommandMask: UInt64 = 0x10

var hotkeyTap: CFMachPort?
var dictating = false

// La dictée démarre quand Option droite et Cmd droite sont enfoncées ensemble, et s'arrête dès qu'on en relâche une.
// Une seule des deux ne fait rien : Option sert à taper des caractères, Cmd aux raccourcis
func handleKeyEvent(type: CGEventType, event: CGEvent) {
    switch type {
    case .flagsChanged:
        let flags = event.flags.rawValue
        let held = flags & rightOptionMask != 0 && flags & rightCommandMask != 0
        guard held != dictating else { return }
        dictating = held
        emit(["type": held ? "down" : "up"])
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        if let hotkeyTap { CGEvent.tapEnable(tap: hotkeyTap, enable: true) }
    default:
        break
    }
}

// Une seule permission pour écouter le raccourci et coller : macOS affiche la demande la première fois
func requireAccessibility() {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    guard AXIsProcessTrustedWithOptions(options) else {
        fail("Permission « Accessibilité » manquante pour steno-recorder")
    }
}

func runHotkey() -> Never {
    requireAccessibility()

    // Tap actif : avec l'Accessibilité seule, macOS lui transmet les touches de modification
    // (les autres touches demanderaient en plus « Surveillance de l'entrée »).
    // Les événements sont rendus tels quels, le callback doit rester instantané pour ne pas ralentir le clavier
    let events = CGEventMask(1 << CGEventType.flagsChanged.rawValue)
    hotkeyTap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap, eventsOfInterest: events, callback: { _, type, event, _ in
        handleKeyEvent(type: type, event: event)
        return Unmanaged.passUnretained(event)
    }, userInfo: nil)
    guard let hotkeyTap else { fail("Impossible d'écouter le clavier") }

    CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(nil, hotkeyTap, 0), .commonModes)
    CGEvent.tapEnable(tap: hotkeyTap, enable: true)
    CFRunLoopRun()
    exit(0)
}

// ---------- paste ----------

// Touche V (kVK_ANSI_V), à la même place en AZERTY et en QWERTY
let vKeyCode: CGKeyCode = 9

func runPaste() -> Never {
    requireAccessibility()

    let source = CGEventSource(stateID: .combinedSessionState)
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: false) else {
        fail("Impossible de créer l'appui sur Cmd+V")
    }
    // Seulement Cmd : une touche de modification encore enfoncée ne doit pas changer le raccourci
    down.flags = .maskCommand
    up.flags = .maskCommand
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    exit(0)
}

// ---------- point d'entrée ----------

let arguments = CommandLine.arguments
switch arguments.dropFirst().first {
case "detect":
    runDetect()
case "record":
    guard let index = arguments.firstIndex(of: "--out"), index + 1 < arguments.count else { fail("usage : record --out <dossier>") }
    runRecord(outputDir: URL(fileURLWithPath: arguments[index + 1]), micOnly: arguments.contains("--mic-only"))
case "cancel-echo":
    func option(_ name: String) -> URL {
        guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else {
            fail("usage : cancel-echo --mic <wav> --reference <wav> --out <wav>")
        }
        return URL(fileURLWithPath: arguments[index + 1])
    }
    runCancelEcho(mic: option("--mic"), reference: option("--reference"), output: option("--out"))
case "hotkey":
    runHotkey()
case "paste":
    runPaste()
default:
    fail("usage : steno-recorder detect | record --out <dossier> [--mic-only] | cancel-echo --mic <wav> --reference <wav> --out <wav> | hotkey | paste")
}

// Helper natif de Sténo pour les appels :
//   detect             écrit (en JSON, sur stdout) les apps qui utilisent le micro ou la sortie audio,
//                      et si elles ont une connexion WebRTC établie (appel en cours)
//   record --out <dir> enregistre le micro (mic.wav) et tout le son du Mac (system.wav), calés sur la même horloge
//                      avec --mic-only, seulement le micro (dictée)
//                      avec --standby, prépare le micro sans l'ouvrir et le démarre à la première ligne lue sur stdin :
//                      « start », ou « start stream » pour recevoir aussi le son du micro au fil de l'eau (mode rapide)
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
import IOKit.pwr_mgt

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

// Chromium (donc Slack) empêche la mise en veille tant qu'une connexion WebRTC est établie, c'est-à-dire pendant un appel.
// L'assertion est posée par le processus principal de l'app, pas par celui qui tient le micro
func webRTCApps() -> Set<String> {
    var assertions: Unmanaged<CFDictionary>?
    guard IOPMCopyAssertionsByProcess(&assertions) == kIOReturnSuccess,
          let byPid = assertions?.takeRetainedValue() as? [NSNumber: [[String: Any]]] else { return [] }

    var apps = Set<String>()
    for (pid, list) in byPid where list.contains(where: { $0[kIOPMAssertionNameKey] as? String == "WebRTC has active PeerConnections" }) {
        if let bundleId = appBundleId(pid: pid.int32Value, fallback: nil) { apps.insert(bundleId) }
    }
    return apps
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

    // Sans app sur le micro, pas d'appel possible : inutile de lire les assertions
    let webRTC = apps.values.contains { $0.input } ? webRTCApps() : []
    return apps.keys.sorted().map { ["bundleId": $0, "input": apps[$0]!.input, "output": apps[$0]!.output, "webrtc": webRTC.contains($0)] }
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
    // En veille (--standby), remise à l'heure du démarrage du micro, avant le premier bloc
    var startHostTime: UInt64
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

        convert(buffer, with: converter, to: output)
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

    // Durée écrite, silence compris. Lue une fois la source arrêtée
    var seconds: Double {
        Double(framesWritten) / sampleRate
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

// Copie des premières images d'un bloc : le bloc livré par le moteur audio lui appartient, on ne le modifie pas
func prefix(of buffer: AVAudioPCMBuffer, frames: AVAudioFrameCount) -> AVAudioPCMBuffer? {
    guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: frames) else { return nil }
    copy.frameLength = frames
    let bytes = Int(frames) * Int(buffer.format.streamDescription.pointee.mBytesPerFrame)
    for (source, destination) in zip(UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList), UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)) {
        guard let from = source.mData, let to = destination.mData else { return nil }
        memcpy(to, from, bytes)
    }
    return copy
}

// Convertit un bloc entier d'un coup : le convertisseur réclame ses données par un callback
func convert(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter, to output: AVAudioPCMBuffer) {
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
}

// Mode rapide de la dictée : le son du micro part vers l'app pendant l'enregistrement, en PCM 16 bits 24 kHz mono
// (format attendu par la transcription en direct), encodé en base64 dans des événements "audio"
final class AudioStreamer {
    private let outputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24_000, channels: 1, interleaved: true)!
    private var converter: AVAudioConverter?

    // Appelé sur le fil audio ; l'écriture sur stdout passe par la file principale, comme les autres événements
    func send(_ buffer: AVAudioPCMBuffer) {
        if converter == nil || converter!.inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: outputFormat)
            converter?.channelMap = [0]
        }
        guard let converter,
              let output = AVAudioPCMBuffer(
                  pcmFormat: outputFormat,
                  frameCapacity: AVAudioFrameCount(Double(buffer.frameLength) * outputFormat.sampleRate / buffer.format.sampleRate) + 32
              ) else { return }

        convert(buffer, with: converter, to: output)
        guard output.frameLength > 0 else { return }
        let pcm = Data(bytes: output.int16ChannelData![0], count: Int(output.frameLength) * MemoryLayout<Int16>.size).base64EncodedString()
        DispatchQueue.main.async { emit(["type": "audio", "pcm": pcm]) }
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
    // Envoi du son en direct (mode rapide), posé avant le démarrage
    var streamer: AudioStreamer?
    // Appelé sur la file principale une fois le son écrit et envoyé jusqu'à l'instant de l'arrêt demandé
    var onStopReached: (() -> Void)?
    private var engine: AVAudioEngine?
    private var configurationObserver: NSObjectProtocol?
    private var watchdog: DispatchSourceTimer?
    private var pendingRestart: DispatchWorkItem?
    private let aliveLock = NSLock()
    // Arrêt demandé : seul le son capté avant cet instant est gardé
    private let stopLock = NSLock()
    private var stopHostTime: UInt64?
    private var stopReached = false
    private var lastBufferAt = Date()
    private var running = false
    // Micro et sortie par défaut à la création du moteur : AVAudioEngine les réunit dans un même périphérique
    private var engineDevices: [UInt32?] = []

    init(writer: TrackWriter) {
        self.writer = writer
    }

    // Crée le moteur sans ouvrir le micro (0,1 s) : le démarrage ne prend ensuite qu'une dizaine de millisecondes
    func prepare() throws {
        stopEngine()
        let engine = AVAudioEngine()
        let input = engine.inputNode
        input.installTap(onBus: 0, bufferSize: 4096, format: input.outputFormat(forBus: 0)) { [weak self, writer] buffer, when in
            guard let self else { return }
            self.markAlive()
            let (kept, reachedStop) = self.trimmedAtStop(buffer, startingAt: when)
            if let kept {
                writer.write(kept, at: when.isHostTimeValid ? when.hostTime : nil)
                self.streamer?.send(kept)
            }
            // Après l'envoi du dernier morceau, qui passe lui aussi par la file principale : il part avant l'arrêt
            if reachedStop { DispatchQueue.main.async { self.onStopReached?() } }
        }
        configurationObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            self?.scheduleRestart("changement de configuration audio")
        }
        self.engine = engine
        engineDevices = defaultDevices()
        engine.prepare()
    }

    // Appelé sur la file principale, comme tout le reste de la classe
    func start() throws {
        // Micro ou sortie par défaut changés depuis la préparation (AirPods connectés…) : le moteur est refait
        if engine == nil || defaultDevices() != engineDevices { try prepare() }
        running = true
        markAlive()
        do {
            try engine?.start()
        } catch {
            // Moteur préparé avant une mise en veille, ou périphérique disparu entre-temps : on le refait une fois
            log("micro : démarrage impossible (\(error)), nouvel essai")
            try prepare()
            try engine?.start()
        }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in self?.checkAlive() }
        timer.resume()
        watchdog = timer
    }

    func stop() {
        running = false
        watchdog?.cancel()
        pendingRestart?.cancel()
        stopEngine()
    }

    private func stopEngine() {
        if let configurationObserver { NotificationCenter.default.removeObserver(configurationObserver) }
        configurationObserver = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
    }

    // Le micro livre son son par blocs de 0,1 s : à l'arrêt, on attend le bloc qui contient l'instant demandé
    // et on le coupe à cet instant, au lieu de perdre ce bloc ou d'enregistrer au-delà
    func requestStop(at hostTime: UInt64) {
        stopLock.lock()
        stopHostTime = hostTime
        stopLock.unlock()
    }

    // Bloc coupé à l'instant de l'arrêt (nil s'il commence après), et s'il est le premier à l'atteindre
    private func trimmedAtStop(_ buffer: AVAudioPCMBuffer, startingAt time: AVAudioTime) -> (AVAudioPCMBuffer?, Bool) {
        stopLock.lock()
        defer { stopLock.unlock() }
        guard let stopHostTime, time.isHostTimeValid else { return (buffer, false) }
        if stopReached { return (nil, false) }
        let framesBeforeStop = (AVAudioTime.seconds(forHostTime: stopHostTime) - AVAudioTime.seconds(forHostTime: time.hostTime)) * buffer.format.sampleRate
        guard framesBeforeStop < Double(buffer.frameLength) else { return (buffer, false) }
        stopReached = true
        // Moins d'1 ms avant l'arrêt : rien à garder
        let framesToKeep = AVAudioFrameCount(max(0, framesBeforeStop))
        guard framesToKeep >= AVAudioFrameCount(buffer.format.sampleRate / 1000) else { return (nil, true) }
        return (prefix(of: buffer, frames: framesToKeep), true)
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
            // En veille, le moteur est refait sans ouvrir le micro
            if self.running { log("micro : \(reason), relance") }
            do {
                try self.prepare()
                if self.running {
                    self.markAlive()
                    try self.engine?.start()
                }
            } catch {
                // Le micro n'est peut-être pas encore disponible : la surveillance réessaiera dans quelques secondes
                log("micro : relance impossible (\(error))")
            }
        }
        pendingRestart = restart
        DispatchQueue.main.asyncAfter(deadline: .now() + restartDelay, execute: restart)
    }
}

// Micro et sortie par défaut du Mac
func defaultDevices() -> [UInt32?] {
    let system = AudioObjectID(kAudioObjectSystemObject)
    return [uint32Property(system, kAudioHardwarePropertyDefaultInputDevice), uint32Property(system, kAudioHardwarePropertyDefaultOutputDevice)]
}

struct RecorderError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

func check(_ status: OSStatus, _ step: String) throws {
    if status != noErr { throw RecorderError("échec : \(step) (\(status))") }
}

// Attente maximale du bloc de son qui contient l'instant de l'arrêt (il arrive normalement en moins de 0,1 s)
let maxStopWaitSeconds = 0.3
// Au-delà, l'arrêt est considéré comme bloqué
let maxStopSeconds = 2.0

func runRecord(outputDir: URL, micOnly: Bool, standby: Bool) -> Never {
    var micWriter: TrackWriter?
    var systemWriter: TrackWriter?
    var mic: MicrophoneCapture?
    var system: SystemAudioCapture?
    var levels: DispatchSourceTimer?

    // Arrêt propre sur SIGTERM, dès le lancement : une dictée relâchée avant le démarrage du micro
    // donne un WAV vide mais lisible, au lieu d'un processus tué sans fichier
    signal(SIGTERM, SIG_IGN)
    let stop = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    var stopping = false
    stop.setEventHandler {
        guard !stopping else { return }
        stopping = true
        // Filet de sécurité : un arrêt bloqué ne doit jamais laisser le micro ouvert
        DispatchQueue.global().asyncAfter(deadline: .now() + maxStopSeconds) {
            log("arrêt bloqué depuis \(Int(maxStopSeconds)) s, sortie forcée")
            _exit(1)
        }
        func finish() {
            levels?.cancel()
            mic?.stop()
            system?.stop()
            micWriter?.close()
            systemWriter?.close()
            emit(["type": "stopped", "seconds": micWriter?.seconds ?? 0])
            exit(0)
        }
        // Sans enregistrement en cours, arrêt immédiat. Sinon, le son est gardé jusqu'à l'instant de la demande, pas au-delà :
        // arrêter le moteur tout de suite perdrait le dernier bloc pas encore livré, donc la fin du dernier mot
        guard levels != nil, let capture = mic else { return finish() }
        capture.onStopReached = { finish() }
        capture.requestStop(at: mach_absolute_time())
        // Si le bloc n'arrive pas (micro arrêté par macOS…), on n'attend pas indéfiniment
        DispatchQueue.main.asyncAfter(deadline: .now() + maxStopWaitSeconds) { finish() }
    }
    stop.resume()

    let permission = DispatchSemaphore(value: 0)
    var micAllowed = false
    AVCaptureDevice.requestAccess(for: .audio) { granted in
        micAllowed = granted
        permission.signal()
    }
    permission.wait()
    if !micAllowed { fail("Accès au micro refusé") }

    // Les fichiers puis le moteur passent par le registre des composants audio de macOS, qui s'arrête après
    // quelques minutes sans audio : le relancer prend 2 à 3,5 s. En veille, c'est payé avant l'appui
    do {
        let startHostTime = mach_absolute_time()
        micWriter = try TrackWriter(url: outputDir.appendingPathComponent("mic.wav"), name: "micro", startHostTime: startHostTime)
        systemWriter = micOnly ? nil : try TrackWriter(url: outputDir.appendingPathComponent("system.wav"), name: "son du Mac", startHostTime: startHostTime)
    } catch {
        fail("Impossible de créer les fichiers audio : \(error)")
    }

    let capture = MicrophoneCapture(writer: micWriter!)
    mic = capture
    do {
        try capture.prepare()
    } catch {
        fail("\(error)")
    }

    func begin(stream: Bool) {
        if stream { capture.streamer = AudioStreamer() }
        // Origine commune des deux pistes : chacune commence au démarrage du micro
        let startHostTime = mach_absolute_time()
        micWriter?.startHostTime = startHostTime
        systemWriter?.startHostTime = startHostTime
        system = systemWriter.map { SystemAudioCapture(writer: $0) }
        do {
            try capture.start()
            try system?.start()
        } catch {
            fail("\(error)")
        }
        emit(["type": "started"])

        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: 0.1)
        timer.setEventHandler {
            emit(["type": "level", "mic": micWriter?.takeLevel() ?? 0, "system": systemWriter?.takeLevel() ?? 0])
        }
        timer.resume()
        levels = timer

        // L'app a disparu sans demander l'arrêt (plantage) : on s'arrête aussi, plutôt que de garder le micro ouvert
        let appGone = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .main)
        appGone.setEventHandler {
            var byte: UInt8 = 0
            guard read(STDIN_FILENO, &byte, 1) <= 0 else { return }
            appGone.cancel()
            raise(SIGTERM)
        }
        appGone.resume()
    }

    guard standby else {
        begin(stream: false)
        dispatchMain()
    }

    // En veille : le micro s'ouvre dès que l'app écrit une ligne. Une entrée fermée veut dire que l'app est partie
    emit(["type": "ready"])
    let input = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .main)
    input.setEventHandler {
        input.cancel()
        var line = [UInt8](repeating: 0, count: 64)
        let count = read(STDIN_FILENO, &line, line.count)
        if count <= 0 { exit(0) }
        begin(stream: String(decoding: line[..<count], as: UTF8.self).contains("stream"))
    }
    input.resume()
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
    runRecord(outputDir: URL(fileURLWithPath: arguments[index + 1]), micOnly: arguments.contains("--mic-only"), standby: arguments.contains("--standby"))
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
    fail("usage : steno-recorder detect | record --out <dossier> [--mic-only] [--standby] | cancel-echo --mic <wav> --reference <wav> --out <wav> | hotkey | paste")
}

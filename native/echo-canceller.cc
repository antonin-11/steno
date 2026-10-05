// Annulation d'écho de WebRTC (AEC3), réglée comme l'exemple run-offline de webrtc-audio-processing,
// sans le contrôle automatique du gain : la voix garde son niveau d'origine
#include "echo-canceller.h"

#include <modules/audio_processing/include/audio_processing.h>

struct EchoCanceller {
    rtc::scoped_refptr<webrtc::AudioProcessing> apm;
    webrtc::StreamConfig stream;
};

EchoCanceller *echo_canceller_create(int sample_rate) {
    rtc::scoped_refptr<webrtc::AudioProcessing> apm = webrtc::AudioProcessingBuilder().Create();
    if (!apm) return nullptr;

    webrtc::AudioProcessing::Config config;
    config.echo_canceller.enabled = true;
    config.echo_canceller.mobile_mode = false;
    config.high_pass_filter.enabled = true;
    apm->ApplyConfig(config);

    return new EchoCanceller{apm, webrtc::StreamConfig(sample_rate, 1)};
}

int echo_canceller_block_size(const EchoCanceller *canceller) {
    return static_cast<int>(canceller->stream.num_frames());
}

int echo_canceller_process(EchoCanceller *canceller, float *reference, float *microphone) {
    float *const reverse[] = {reference};
    float *const capture[] = {microphone};
    int error = canceller->apm->ProcessReverseStream(reverse, canceller->stream, canceller->stream, reverse);
    if (error != webrtc::AudioProcessing::kNoError) return error;
    return canceller->apm->ProcessStream(capture, canceller->stream, canceller->stream, capture);
}

void echo_canceller_destroy(EchoCanceller *canceller) {
    delete canceller;
}

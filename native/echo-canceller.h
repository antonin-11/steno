// Annulation d'écho de WebRTC (AEC3), appelée par le helper Swift (recorder.swift)
#ifndef ECHO_CANCELLER_H
#define ECHO_CANCELLER_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct EchoCanceller EchoCanceller;

EchoCanceller *echo_canceller_create(int sample_rate);

// Nombre d'échantillons d'un bloc : WebRTC traite le son par tranches de 10 ms
int echo_canceller_block_size(const EchoCanceller *canceller);

// Un bloc : `reference` est ce qui a été joué (le son du Mac), `microphone` est nettoyé sur place
int echo_canceller_process(EchoCanceller *canceller, float *reference, float *microphone);

void echo_canceller_destroy(EchoCanceller *canceller);

#ifdef __cplusplus
}
#endif

#endif

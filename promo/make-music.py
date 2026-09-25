#!/usr/bin/env python3
"""Synthesize the promo's background track: a soft pad with a plucked
arpeggio, so the video carries no third-party music. Deterministic, no
dependencies. Usage: python3 make-music.py public/music.wav [seconds]"""
import math
import struct
import sys
import wave

RATE = 22050
SECONDS = float(sys.argv[2]) if len(sys.argv) > 2 else 68.0
BPM = 96
BEAT = 60 / BPM
BAR = 4 * BEAT
# Am7 - Fmaj7 - C(add9) - G6, one chord per two bars (MIDI notes).
CHORDS = [
    [57, 60, 64, 67],
    [53, 57, 60, 64],
    [48, 55, 62, 64],
    [55, 59, 62, 64],
]
ARP = [0, 2, 1, 3, 2, 1, 3, 2]  # chord tone per eighth note


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


n = int(SECONDS * RATE)
out = []
two_pi = 2 * math.pi
chord_len = 2 * BAR
for i in range(n):
    t = i / RATE
    ci = int(t // chord_len)
    local = t - ci * chord_len
    # Pad: crossfade into each chord over the first second.
    pad = 0.0
    for k, weight in ((ci, smooth(local / 1.0)), (ci - 1, 1 - smooth(local / 1.0))):
        if k < 0 or weight <= 0:
            continue
        for note in CHORDS[k % len(CHORDS)]:
            f = hz(note)
            pad += weight * (math.sin(two_pi * f * t) + 0.5 * math.sin(two_pi * f * 1.003 * t)
                             + 0.12 * math.sin(two_pi * 2 * f * t))
    pad *= 0.045 * (0.85 + 0.15 * math.sin(two_pi * 0.1 * t))
    # Bass: chord root an octave down.
    root = hz(CHORDS[ci % len(CHORDS)][0] - 12)
    bass = 0.10 * math.sin(two_pi * root * t) * smooth(local / 0.4)
    # Pluck: eighth-note arpeggio an octave up, fast exponential decay.
    eighth = BEAT / 2
    step = int(t // eighth)
    since = t - step * eighth
    tone = hz(CHORDS[ci % len(CHORDS)][ARP[step % len(ARP)]] + 12)
    pluck = 0.07 * math.exp(-since * 9) * (math.sin(two_pi * tone * t) + 0.3 * math.sin(two_pi * 2 * tone * t))
    # Enter the pluck after the hook; fade everything in and out.
    pluck *= smooth((t - 4.5) / 2.0)
    master = smooth(t / 1.5) * smooth((SECONDS - t) / 3.0)
    s = (pad + bass + pluck) * master
    out.append(max(-1.0, min(1.0, s)))

with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(b"".join(struct.pack("<h", int(v * 32000)) for v in out))
print(f"wrote {sys.argv[1]}: {SECONDS:.0f} s")

#!/usr/bin/env python3
"""Render the voice callouts of src/audio/lines.js to assets/voice/<id>.mp3.

Uses the open Kokoro-82M text-to-speech model (Apache 2.0) through the kokoro-onnx package, then
trims the silence, levels every line to the same loudness and encodes mono MP3 with ffmpeg.

Setup (once):
  pip install kokoro-onnx soundfile numpy
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
  (ffmpeg on the PATH: brew install ffmpeg)

Usage, from the game folder:
  python3 tools/make_voice.py --models /path/to/model/files [--voice af_heart] [--speed 1.0] [--only id1,id2]
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)


def read_lines(path):
    """id -> text from the VOICE_LINES object of lines.js (single or double quoted strings)."""
    src = open(path, encoding="utf-8").read()
    block = src[src.index("VOICE_LINES"):]
    block = block[block.index("{") + 1:block.index("};")]
    lines = {}
    for m in re.finditer(r"^\s*(\w+):\s*(?:'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\")", block, flags=re.M):
        text = m.group(2) if m.group(2) is not None else m.group(3)
        lines[m.group(1)] = text.replace("\\'", "'")
    return lines


def trim(x, sr, floor_db=-42.0, pad_s=0.03):
    """Cut the leading and trailing silence, keep a short pad, fade the ends."""
    level = 20 * np.log10(np.maximum(1e-9, np.abs(x)))
    idx = np.nonzero(level > floor_db)[0]
    if len(idx) == 0:
        return x
    pad = int(pad_s * sr)
    x = x[max(0, idx[0] - pad):min(len(x), idx[-1] + pad)].copy()
    n_in, n_out = int(0.008 * sr), int(0.03 * sr)
    x[:n_in] *= np.linspace(0, 1, n_in)
    x[-n_out:] *= np.linspace(1, 0, n_out)
    return x


def level(x, target_rms_db=-18.0, peak_db=-1.0):
    """Same loudness for every line (RMS of the voiced part), peaks below peak_db."""
    voiced = x[np.abs(x) > 0.02]
    rms = np.sqrt(np.mean(voiced ** 2)) if len(voiced) else np.sqrt(np.mean(x ** 2))
    x = x * (10 ** (target_rms_db / 20) / max(rms, 1e-9))
    peak = np.max(np.abs(x))
    limit = 10 ** (peak_db / 20)
    if peak > limit:
        x = x * (limit / peak)
    return x


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", default=HERE, help="folder with kokoro-v1.0.onnx and voices-v1.0.bin")
    ap.add_argument("--voice", default="af_heart", help="Kokoro voice (default af_heart)")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--out", default=os.path.join(GAME, "assets", "voice"))
    ap.add_argument("--only", default="", help="comma-separated ids to render (default all)")
    ap.add_argument("--bitrate", default="64k")
    args = ap.parse_args()

    from kokoro_onnx import Kokoro  # imported here so that --help works without the package

    model = os.path.join(args.models, "kokoro-v1.0.onnx")
    voices = os.path.join(args.models, "voices-v1.0.bin")
    for f in (model, voices):
        if not os.path.exists(f):
            sys.exit("missing %s (see the setup notes at the top of this file)" % f)
    kokoro = Kokoro(model, voices)
    lang = "en-gb" if args.voice.startswith("b") else "en-us"
    lines = read_lines(os.path.join(GAME, "src", "audio", "lines.js"))
    only = [s for s in args.only.split(",") if s]
    os.makedirs(args.out, exist_ok=True)
    for key, text in lines.items():
        if only and key not in only:
            continue
        samples, sr = kokoro.create(text, voice=args.voice, speed=args.speed, lang=lang)
        x = level(trim(np.asarray(samples, dtype=np.float64), sr))
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            wav = tmp.name
        sf.write(wav, x.astype(np.float32), sr)
        mp3 = os.path.join(args.out, key + ".mp3")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-codec:a", "libmp3lame",
                        "-b:a", args.bitrate, mp3], check=True)
        os.remove(wav)
        print("%-14s %.2f s  %s" % (key, len(x) / sr, text))


if __name__ == "__main__":
    main()

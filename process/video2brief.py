#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
video2brief.py

Turns a reference video into a written brief (brief.md) that a coding model
such as DeepSeek can use as design input for a game.

Steps
  1. ffmpeg extracts keyframes at scene cuts, with at least one frame every
     --max-gap seconds and at most --max-frames frames in total.
  2. ffmpeg builds labelled thumbnails and contact sheets for a quick look.
  3. An optional transcript (.srt or .vtt from yt-dlp, or plain .txt) is
     parsed and aligned with the frames.
  4. A vision-language model (default: Qwen3.8-27B on oMLX) describes every
     keyframe as JSON: appearance, hardware, on-screen text.
  5. Optional, with --video-model: a model that accepts video (for example
     GLM-5.3-Flash on TensorFold behind llama-swap) watches the video in clips
     of about half a minute (--clip-seconds) and describes motion, sequence and timing.
  6. The first model writes the synthesis into brief.md and reconciles the
     frame notes with the clip notes.

Only the Python standard library is used. ffmpeg and ffprobe must be on PATH.

Examples
  export OMLX_API_KEY=...                                  # the key your oMLX expects
  python3 video2brief.py --list-models                     # model ids on both servers
  python3 video2brief.py --selftest                        # does Qwen see images?
  python3 video2brief.py --selftest-video --video-model GLM_ID      # does GLM see video?
  python3 video2brief.py refueling.mp4 --video-model GLM_ID --context "..."
  python3 video2brief.py refueling.mp4 --start 12 --end 190         # skip intro and credits
  python3 video2brief.py refueling.mp4 --no-vlm            # frames, sheets, transcript only
"""

from __future__ import print_function

import argparse
import base64
import concurrent.futures
import datetime
import glob
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

DEFAULT_API = os.environ.get("OMLX_URL", "http://127.0.0.1:8080/v1")
DEFAULT_MODEL = os.environ.get("VISION_MODEL", "Qwen3.8-27B-8bit")
DEFAULT_VIDEO_API = os.environ.get("VIDEO_URL", "http://127.0.0.1:8100/v1")

PHASES = [
    "title_or_text",
    "orbit_overview",
    "far_range_approach",
    "close_range_approach",
    "hold_point",
    "final_approach",
    "contact_or_capture",
    "docked",
    "refuelling",
    "undocking",
    "departure",
    "other",
]

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

# Request fields that some servers refuse; they are dropped one by one on HTTP 400/422.
OPTIONAL_FIELDS = ("chat_template_kwargs", "reasoning_effort", "temperature")

FRAME_SYSTEM = (
    "You are a meticulous visual analyst for a spacecraft simulation project. "
    "You describe single frames from a reference video about spacecraft rendezvous, "
    "docking and on-orbit refuelling. Describe only what is visible. Do not invent "
    "names, numbers or text that cannot be read in the frame. When you estimate "
    "something, say that it is an estimate. Answer with one JSON object and nothing else."
)

FRAME_KEYS = """{
  "phase": one of __PHASES__,
  "summary": "one sentence on what this frame shows",
  "chaser": "the approaching or servicing spacecraft: overall shape, estimated proportions, colours and materials (for example gold or silver multi-layer insulation), solar arrays (number, shape, orientation), antennas, thrusters, sensors, docking or capture mechanism, robotic arm, lights; null if not visible",
  "target": "the client or target spacecraft, same level of detail; null if not visible",
  "relative_geometry": "where the chaser is relative to the target (side, estimated distance in metres, alignment of the docking axes) and where Earth is",
  "interface": "the docking, capture or refuelling interface and the step of the sequence shown (probe, drogue, grapple fixture, valve, coupling, hose, tool); null if not visible",
  "motion_cues": "thruster plumes, arm motion, latches, fluid transfer indications, motion blur",
  "camera": "viewpoint and framing (external chase view, docking camera with reticle, wide shot, close-up) and any camera motion you can infer",
  "environment": "Earth in view and which part, sunlight direction, shadows, eclipse, stars",
  "on_screen_text": "verbatim text, labels, telemetry or HUD elements visible; empty string if none",
  "game_relevant_details": "details a game developer should reproduce: indicators, UI elements, sequence steps, visual effects",
  "uncertain": "anything ambiguous in this frame"
}""".replace("__PHASES__", json.dumps(PHASES))

CLIP_SYSTEM = (
    "You are a meticulous analyst for a spacecraft simulation project. You watch clips of "
    "a reference video about spacecraft rendezvous, docking and on-orbit refuelling, and "
    "you describe what happens over time: motion, sequence and timing. Describe only what "
    "is visible. Give times in seconds from the start of the clip. Do not invent names, "
    "numbers or text that cannot be read. Answer with one JSON object and nothing else."
)

CLIP_KEYS = """{
  "events": [
    {"from_s": seconds from the start of this clip,
     "to_s": seconds from the start of this clip,
     "phase": one of __PHASES__,
     "what_happens": "what happens in this interval",
     "motion": "relative motion of the two vehicles (direction, closing or opening, apparent speed), rotations, thruster firings, arm or mechanism movement"}
  ],
  "chaser": "appearance of the servicing spacecraft in this clip; null if not visible",
  "target": "appearance of the client spacecraft in this clip; null if not visible",
  "interface_sequence": "docking, capture or refuelling steps shown in this clip, in order; null if none",
  "camera": "camera viewpoints, camera motion and cuts",
  "on_screen_text": "text, labels or telemetry visible; empty string if none",
  "uncertain": "anything ambiguous in this clip"
}""".replace("__PHASES__", json.dumps(PHASES))

SYNTH_SYSTEM = (
    "You are a senior spacecraft systems engineer and technical game designer. "
    "You turn notes and keyframes of a reference video into a precise written brief "
    "for a developer who cannot see the video. Be factual and concrete. Mark estimates "
    "as estimates. Do not invent mission names, companies or figures that the notes or "
    "the images do not support."
)

SYNTH_TASK = """Write the brief in Markdown with exactly these sections.

## 1. What the video shows
One paragraph.

## 2. Timeline
A table with the columns: time range, phase, what happens, key visuals. Cover the whole analysed segment.

## 3. Visual bible
### 3.1 Chaser (servicer)
A consistent description detailed enough to build a procedural 3D model: main body shape and proportions, approximate dimensions in metres (estimates), colours and materials, and every appendage with its position on the body (solar arrays, antennas, thrusters, sensors, docking or capture mechanism, robotic arm, lights).
### 3.2 Target (client)
Same level of detail.
### 3.3 Docking and refuelling interface
Mechanism and hardware, step by step as shown.

## 4. Operations sequence
Numbered steps from the first approach to the final departure: approach direction, hold points, alignment, contact and capture, connection, propellant transfer, disconnection, undocking, retreat. Say for each step whether the video shows it explicitly or only implies it.

## 5. Camera language and environment
Views used, framing, transitions, Earth, lighting, starfield.

## 6. On-screen graphics and text
HUD elements, labels and indicators worth reproducing in a game.

## 7. Narration key points
Only if a transcript is provided; otherwise write "No narration provided."

## 8. Open questions and inconsistencies
What is unclear or contradictory, including any disagreement between the frame notes and the clip notes. When they disagree on motion, order or timing, the clip notes come from a model that watched the video and carry more weight. When they disagree on appearance or hardware details, the frame notes come from full-resolution stills and carry more weight. State which way you resolved each disagreement."""


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------

def log(msg):
    print(msg, flush=True)


def die(msg):
    print("ERROR: " + msg, file=sys.stderr, flush=True)
    sys.exit(1)


def run(cmd, check=True):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       universal_newlines=True, errors="replace")
    if check and p.returncode != 0:
        raise RuntimeError("Command failed (%d): %s\n%s"
                           % (p.returncode, " ".join(cmd), p.stderr[-3000:]))
    return p


def fmt_time(t):
    m, s = divmod(max(0.0, t), 60.0)
    return "%d:%04.1f" % (int(m), s)


def data_uri(path, mime="image/jpeg"):
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return "data:%s;base64,%s" % (mime, b64)


def extract_json(text):
    """Return the first JSON object found in a model reply, or None."""
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.M)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        value = json.loads(text[start:end + 1])
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def trunc(value, n):
    if value is None:
        return ""
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False)
    value = re.sub(r"\s+", " ", value).strip()
    return value if len(value) <= n else value[:n - 1] + "…"


# --------------------------------------------------------------------------
# ffmpeg stages
# --------------------------------------------------------------------------

def probe_duration(video):
    for args in (["-show_entries", "format=duration"],
                 ["-select_streams", "v:0", "-show_entries", "stream=duration"]):
        p = run(["ffprobe", "-v", "error"] + args + ["-of", "default=nw=1:nk=1", video], check=False)
        for line in p.stdout.splitlines():
            try:
                value = float(line.strip())
                if value > 0:
                    return value
            except ValueError:
                pass
    return 0.0


def clear_dir(path, patterns):
    os.makedirs(path, exist_ok=True)
    for pattern in patterns:
        for f in glob.glob(os.path.join(path, pattern)):
            os.remove(f)


def extract_frames(video, out_dir, args, duration):
    frames_dir = os.path.join(out_dir, "frames")
    clear_dir(frames_dir, ["raw_*.jpg", "f*.jpg"])
    start = max(0.0, args.start)
    end = args.end if args.end > 0 else (duration + 1.0 if duration > 0 else 1e9)
    select = ("between(t,{s},{e})*(isnan(prev_selected_t)"
              "+gte(t-prev_selected_t,{mx})"
              "+gt(scene,{sc})*gte(t-prev_selected_t,{mn}))").format(
                  s=start, e=end, mx=args.max_gap, sc=args.scene, mn=args.min_gap)
    vf = "select='{sel}',showinfo,scale='min({w},iw)':-2".format(sel=select, w=args.width)
    pattern = os.path.join(frames_dir, "raw_%05d.jpg")
    base = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-i", video, "-vf", vf]
    p = run(base + ["-fps_mode", "vfr", "-q:v", "3", pattern], check=False)
    if p.returncode != 0 and "fps_mode" in p.stderr:      # very old ffmpeg
        p = run(base + ["-vsync", "vfr", "-q:v", "3", pattern], check=False)
    if p.returncode != 0:
        raise RuntimeError("ffmpeg frame extraction failed:\n" + p.stderr[-3000:])

    times = [float(m.group(1)) for m in re.finditer(r"pts_time:\s*(-?[0-9.]+)", p.stderr)]
    files = sorted(glob.glob(os.path.join(frames_dir, "raw_*.jpg")))
    if not files:
        raise RuntimeError("ffmpeg produced no frames; check --start/--end and the video file")
    if len(times) != len(files):
        log("  warning: %d frames but %d timestamps; timestamps may be approximate"
            % (len(files), len(times)))
        while len(times) < len(files):
            times.append(times[-1] + args.max_gap if times else 0.0)
    pairs = list(zip(times, files))

    if len(pairs) > args.max_frames:
        k = args.max_frames
        keep = sorted(set(int(round(i * (len(pairs) - 1) / float(k - 1))) for i in range(k)))
        keep_set = set(keep)
        for i, (_, f) in enumerate(pairs):
            if i not in keep_set:
                os.remove(f)
        pairs = [pairs[i] for i in keep]

    frames = []
    for i, (t, f) in enumerate(pairs, start=1):
        fid = "f%03d" % i
        name = "%s_t%06.1fs.jpg" % (fid, t)
        os.rename(f, os.path.join(frames_dir, name))
        frames.append({"id": fid, "index": i, "t": round(t, 2), "file": "frames/" + name})
    return frames


def find_font():
    for f in FONT_CANDIDATES:
        if os.path.exists(f):
            return f
    return None


def make_thumbs(frames, out_dir, width=640):
    thumbs_dir = os.path.join(out_dir, "thumbs")
    clear_dir(thumbs_dir, ["f*.jpg"])
    font = find_font()
    labelled = True
    for fr in frames:
        src = os.path.join(out_dir, fr["file"])
        dst = os.path.join(thumbs_dir, fr["id"] + ".jpg")
        label = "%s   %.1f s" % (fr["id"].upper(), fr["t"])
        base = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-v", "error", "-i", src]
        plain = "scale=%d:-2" % width
        if labelled:
            fontpart = ("fontfile=%s:" % font) if font else ""
            vf = (plain + ",drawtext=%stext='%s':x=10:y=10:fontsize=26:fontcolor=white:"
                  "box=1:boxcolor=black@0.6:boxborderw=6" % (fontpart, label))
            p = run(base + ["-vf", vf, "-q:v", "3", dst], check=False)
            if p.returncode == 0:
                fr["thumb"] = "thumbs/" + fr["id"] + ".jpg"
                continue
            labelled = False
            log("  note: this ffmpeg build cannot draw text; thumbnails are unlabelled")
        run(base + ["-vf", plain, "-q:v", "3", dst])
        fr["thumb"] = "thumbs/" + fr["id"] + ".jpg"
    return labelled


def make_contact_sheets(out_dir, cols=6, rows=5):
    clear_dir(out_dir, ["contact_*.jpg"])
    pattern = os.path.join(out_dir, "thumbs", "f%03d.jpg")
    out_pattern = os.path.join(out_dir, "contact_%02d.jpg")
    vf = "scale=320:-2,tile=%dx%d:padding=4:margin=4:color=0x202020" % (cols, rows)
    run(["ffmpeg", "-hide_banner", "-nostdin", "-y", "-v", "error", "-framerate", "1",
         "-i", pattern, "-vf", vf, "-fps_mode", "passthrough", "-q:v", "3", out_pattern])
    return sorted(os.path.basename(f) for f in glob.glob(os.path.join(out_dir, "contact_*.jpg")))


def encode_clip(video, path, start, dur, height, crf, fps=2.0):
    """Re-encode one segment as a small H.264 file without audio, at a low frame rate.

    Servers such as llama.cpp turn every decoded frame into vision tokens, so the
    frame rate and the height of the clip decide how many tokens a clip costs."""
    base = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-v", "error",
            "-ss", "%.3f" % start, "-i", video, "-t", "%.3f" % dur,
            "-vf", "fps=%g,scale=-2:'min(%d,ih)'" % (fps, height), "-an", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart"]
    p = run(base + ["-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf), path], check=False)
    if p.returncode != 0:                      # ffmpeg built without libx264
        run(base + ["-c:v", "h264_videotoolbox", "-b:v", "2500k" if crf <= 26 else "1200k", path])


def make_clips(video, out_dir, start, end, clip_seconds, height, max_mb, fps=2.0):
    clips_dir = os.path.join(out_dir, "clips")
    clear_dir(clips_dir, ["clip_*.mp4"])
    bounds = []
    t = start
    while end - t > 0.5:
        t2 = min(t + clip_seconds, end)
        bounds.append([t, t2])
        t = t2
    if len(bounds) > 1 and bounds[-1][1] - bounds[-1][0] < 10:   # no tiny last clip
        bounds[-2][1] = bounds[-1][1]
        bounds.pop()
    clips = []
    for i, (a, b) in enumerate(bounds, 1):
        path = os.path.join(clips_dir, "clip_%02d.mp4" % i)
        h = height
        encode_clip(video, path, a, b - a, h, 26, fps)
        if os.path.getsize(path) > max_mb * 1e6:
            h = min(height, 480)
            encode_clip(video, path, a, b - a, h, 32, fps)
        clips.append({"id": "c%02d" % i, "index": i, "start": round(a, 2), "end": round(b, 2),
                      "file": "clips/" + os.path.basename(path), "fps": fps, "height": h,
                      "mb": round(os.path.getsize(path) / 1e6, 1)})
    return clips


# --------------------------------------------------------------------------
# transcript
# --------------------------------------------------------------------------

TS_RE = re.compile(r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})")


def parse_ts(s):
    m = TS_RE.search(s)
    if not m:
        return None
    h = int(m.group(1) or 0)
    return h * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4).ljust(3, "0")) / 1000.0


def find_transcript(video):
    d = os.path.dirname(os.path.abspath(video))
    stem = os.path.splitext(os.path.basename(video))[0]
    cands = [os.path.join(d, n) for n in os.listdir(d)
             if n.startswith(stem + ".") and os.path.splitext(n)[1].lower() in (".srt", ".vtt")]
    cands.sort(key=lambda p: (not p.lower().endswith(".srt"), len(p)))
    return cands[0] if cands else None


def load_transcript(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        data = f.read().replace("\r\n", "\n").replace("\r", "\n")
    if os.path.splitext(path)[1].lower() not in (".srt", ".vtt"):
        text = re.sub(r"\s+", " ", data).strip()
        return [(None, text)] if text else []
    # Line-based parsing: YouTube cues contain whitespace-only lines, so blank
    # lines cannot be used to split cues.
    cues, cur_t, cur_lines = [], None, []
    for line in data.split("\n"):
        if "-->" in line:
            if cur_t is not None:
                if cur_lines and cur_lines[-1].strip().isdigit():   # SRT index of the next cue
                    cur_lines = cur_lines[:-1]
                cues.append((cur_t, cur_lines))
            cur_t = parse_ts(line.split("-->")[0])
            cur_lines = []
        elif cur_t is not None and line.strip():
            cur_lines.append(line)
    if cur_t is not None:
        cues.append((cur_t, cur_lines))
    out, recent = [], []
    for t, text_lines in cues:          # YouTube auto captions repeat rolling lines
        for line in text_lines:
            line = html.unescape(re.sub(r"<[^>]+>", "", line))
            line = re.sub(r"\s+", " ", line).strip()
            if not line or line in recent:
                continue
            out.append((t, line))
            recent = (recent + [line])[-4:]
    return out


def attach_narration(frames, transcript):
    timed = [(t, l) for t, l in transcript if t is not None]
    for i, fr in enumerate(frames):
        t0 = fr["t"] - 2.0
        t1 = frames[i + 1]["t"] if i + 1 < len(frames) else 1e12
        fr["narration"] = " ".join(l for t, l in timed if t0 <= t < t1)


def transcript_text(transcript, limit=12000):
    lines = []
    for t, l in transcript:
        lines.append(l if t is None else "[%s] %s" % (fmt_time(t), l))
    text = "\n".join(lines)
    return text if len(text) <= limit else text[:limit] + "\n[transcript truncated]"


# --------------------------------------------------------------------------
# OpenAI-compatible client (oMLX, llama-swap, TensorFold, mlx_vlm.server, ...)
# --------------------------------------------------------------------------

class ChatClient(object):
    def __init__(self, api, key, model, timeout, extra=None, label="model",
                 retries=3, backoff=5, think=False):
        self.base = api.rstrip("/")
        self.url = self.base + "/chat/completions"
        self.key = key
        self.model = model
        self.timeout = timeout
        self.extra = dict(extra or {})
        self.dropped = set()
        self.label = label
        self.retries = retries
        self.backoff = backoff
        self.think = think
        # local endpoints: never route through an HTTP proxy
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def models(self):
        """Model ids served at /models, or None if the endpoint is missing."""
        req = urllib.request.Request(self.base + "/models")
        if self.key:
            req.add_header("Authorization", "Bearer " + self.key)
        try:
            with self.opener.open(req, timeout=30) as r:
                data = json.loads(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise RuntimeError("%s: authentication failed (HTTP %d) at %s" % (self.label, e.code, self.base))
            return None
        except OSError as e:
            raise RuntimeError("%s: cannot reach %s (%s); is the server running?" % (self.label, self.base, e))
        except ValueError:
            return None
        return [m.get("id") for m in data.get("data", []) if isinstance(m, dict) and m.get("id")]

    def preflight(self):
        ids = self.models()
        if ids is not None and self.model not in ids:
            raise RuntimeError("%s: model %r is not served at %s. Available ids:\n  %s"
                               % (self.label, self.model, self.base, "\n  ".join(sorted(ids))))

    def chat(self, messages, max_tokens, temperature=None):
        server_errors = 0
        empties = 0
        while True:
            body = {"model": self.model, "messages": messages, "max_tokens": max_tokens, "stream": False}
            for k, v in self.extra.items():
                if k not in self.dropped:
                    body[k] = v
            if temperature is not None and "temperature" not in self.dropped:
                body["temperature"] = temperature
            try:
                content = self._post(body)
                if not content and empties < 2:
                    empties += 1
                    max_tokens *= 2          # the budget ran out while the model was thinking
                    continue
                return content
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:600]
                present = [k for k in OPTIONAL_FIELDS if k in body]
                if e.code in (400, 422) and present:
                    named = [k for k in present if k in detail]
                    drop = named[0] if named else present[0]
                    self.dropped.add(drop)
                    log("    note: %s refused %r (HTTP %d); retrying without it" % (self.label, drop, e.code))
                    continue
                if e.code in (401, 403):
                    raise RuntimeError("%s: authentication failed (HTTP %d)" % (self.label, e.code))
                if e.code >= 500 and server_errors < self.retries:
                    server_errors += 1
                    time.sleep(self.backoff * server_errors)
                    continue
                raise RuntimeError("%s: HTTP %d from %s: %s" % (self.label, e.code, self.url, detail))
            except (OSError, ValueError) as e:            # connection errors, timeouts, bad JSON
                if server_errors < self.retries:
                    server_errors += 1
                    time.sleep(self.backoff * server_errors)
                    continue
                raise RuntimeError("%s: no usable answer from %s: %s" % (self.label, self.url, e))

    def _post(self, body):
        req = urllib.request.Request(self.url, data=json.dumps(body).encode("utf-8"), method="POST")
        req.add_header("Content-Type", "application/json")
        if self.key:
            req.add_header("Authorization", "Bearer " + self.key)
        with self.opener.open(req, timeout=self.timeout) as r:
            resp = json.loads(r.read().decode("utf-8", "replace"))
        msg = resp["choices"][0]["message"]
        content = msg.get("content") or ""
        if isinstance(content, list):
            content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.S)
        if "</think>" in content:
            content = content.split("</think>")[-1]
        if "<think>" in content:          # thinking cut off by max_tokens: no answer yet
            content = ""
        return content.strip()


def selftest(client):
    tmp = tempfile.mkdtemp(prefix="v2b_")
    img = os.path.join(tmp, "selftest.jpg")
    run(["ffmpeg", "-hide_banner", "-nostdin", "-y", "-v", "error", "-f", "lavfi",
         "-i", "color=c=blue:s=320x240:d=1",
         "-vf", "drawbox=x=100:y=60:w=120:h=120:color=red:t=fill", "-frames:v", "1", img])
    msgs = [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": data_uri(img)}},
        {"type": "text", "text": "What colour is the square in the middle of this image, and what "
                                 "colour is the background? Answer in five words or fewer."}]}]
    log("Sending a test image (red square on blue) to %s, model %s ..." % (client.url, client.model))
    answer = client.chat(msgs, max_tokens=2000, temperature=0.0)
    shutil.rmtree(tmp, ignore_errors=True)
    log("Model answer: %r" % answer)
    ok = "red" in answer.lower() and "blue" in answer.lower()
    log("Vision OK." if ok else
        "The answer does not mention red and blue: this model is probably loaded as text-only. "
        "Check its type in the oMLX dashboard or use a vision build of the model.")
    return ok


def selftest_video(vclient):
    """A white square crosses the frame left to right and turns red after 4 s."""
    tmp = tempfile.mkdtemp(prefix="v2b_")
    clip_path = os.path.join(tmp, "selftest.mp4")
    graph = ("[0][1]overlay=x='20+t*90':y=140:enable='lt(t,4)'[a];"
             "[a][2]overlay=x='20+t*90':y=140:enable='gte(t,4)'")
    base = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-v", "error",
            "-f", "lavfi", "-i", "color=c=black:s=640x360:d=6:r=25",
            "-f", "lavfi", "-i", "color=c=white:s=80x80:d=6:r=25",
            "-f", "lavfi", "-i", "color=c=red:s=80x80:d=6:r=25",
            "-filter_complex", graph, "-t", "6", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    p = run(base + ["-c:v", "libx264", "-preset", "veryfast", clip_path], check=False)
    if p.returncode != 0:
        run(base + ["-c:v", "h264_videotoolbox", "-b:v", "1000k", clip_path])
    msgs = [{"role": "user", "content": [
        {"type": "video_url", "video_url": {"url": data_uri(clip_path, "video/mp4")}},
        {"type": "text", "text": "Watch the whole clip. In which direction does the square move, "
                                 "and what colour is it at the end? Answer in one short sentence."}]}]
    log("Sending a 6 s test clip (white square moving left to right, red at the end) to %s, model %s ..."
        % (vclient.url, vclient.model))
    log("The first request may wait while llama-swap loads the model.")
    t0 = time.time()
    answer = vclient.chat(msgs, max_tokens=8000)
    shutil.rmtree(tmp, ignore_errors=True)
    log("Model answer after %.0f s: %r" % (time.time() - t0, answer))
    a = answer.lower()
    ok = "right" in a and "red" in a
    log("Video OK." if ok else
        "The answer does not mention both 'right' and 'red': the model saw at most a single frame, "
        "or no video at all. For GLM-5.3-Flash on TensorFold, check --vision and the libtfvideo library.")
    return ok


# --------------------------------------------------------------------------
# vision stages
# --------------------------------------------------------------------------

def read_cache(path, model, match):
    try:
        with open(path, encoding="utf-8") as f:
            cached = json.load(f)
        if cached.get("model") == model and all(abs(cached.get(k, -1) - v) < 0.05 for k, v in match.items()):
            return cached["description"]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def write_cache(path, model, match, desc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    record = {"model": model, "description": desc}
    record.update(match)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, indent=1)


def describe_frame(client, out_dir, fr, n_frames, duration, context, fresh):
    cache = os.path.join(out_dir, "desc", fr["id"] + ".json")
    if not fresh:
        cached = read_cache(cache, client.model, {"t": fr["t"]})
        if cached is not None:
            return cached, True
    text = ("Context from the user: %s\n"
            "This is frame %s at t = %.1f s of a %.0f s video (%d of %d).\n"
            "Narration near this moment: %s\n\n"
            "Describe the frame as one JSON object with exactly these keys:\n%s"
            % (context or "none", fr["id"], fr["t"], duration, fr["index"], n_frames,
               fr.get("narration") or "none", FRAME_KEYS))
    msgs = [{"role": "system", "content": FRAME_SYSTEM},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": data_uri(os.path.join(out_dir, fr["file"]))}},
                {"type": "text", "text": text}]}]
    reply = client.chat(msgs, max_tokens=8000 if client.think else 3000, temperature=0.2)
    desc = extract_json(reply)
    if desc is None:
        desc = {"phase": "other", "summary": trunc(reply, 300), "raw": reply}
    write_cache(cache, client.model, {"t": fr["t"]}, desc)
    return desc, False


def describe_clip(vclient, out_dir, cl, n_clips, duration, context, transcript, fresh):
    cache = os.path.join(out_dir, "desc", cl["id"] + ".json")
    match = {"start": cl["start"], "end": cl["end"]}
    if not fresh:
        cached = read_cache(cache, vclient.model, match)
        if cached is not None:
            return cached, True
    narration = " ".join(l for t, l in transcript
                         if t is not None and cl["start"] - 1.0 <= t < cl["end"])
    text = ("Context from the user: %s\n"
            "This clip covers t = %.1f to %.1f s of a %.0f s video (clip %d of %d).\n"
            "Narration during this clip: %s\n\n"
            "Watch the whole clip and describe what happens over time, as one JSON object "
            "with exactly these keys:\n%s"
            % (context or "none", cl["start"], cl["end"], duration, cl["index"], n_clips,
               narration or "none", CLIP_KEYS))
    msgs = [{"role": "system", "content": CLIP_SYSTEM},
            {"role": "user", "content": [
                {"type": "video_url", "video_url": {"url": data_uri(os.path.join(out_dir, cl["file"]), "video/mp4")}},
                {"type": "text", "text": text}]}]
    reply = vclient.chat(msgs, max_tokens=16000)
    desc = extract_json(reply)
    if desc is None:
        desc = {"events": [], "summary": trunc(reply, 600), "raw": reply}
    events = desc.get("events") if isinstance(desc.get("events"), list) else []
    for ev in events:
        if isinstance(ev, dict):
            for k in ("from_s", "to_s"):
                if isinstance(ev.get(k), (int, float)):
                    ev[k + "_abs"] = round(cl["start"] + float(ev[k]), 1)
    write_cache(cache, vclient.model, match, desc)
    return desc, False


CTX_RE = re.compile(r'"n_prompt_tokens"\s*:\s*(\d+).*?"n_ctx"\s*:\s*(\d+)', re.S)


def describe_clip_fitting(vclient, video, out_dir, cl, n_clips, duration, context, transcript, fresh):
    """describe_clip, re-encoding the clip with fewer frames when the server's context is too small."""
    for attempt in range(4):
        try:
            return describe_clip(vclient, out_dir, cl, n_clips, duration, context, transcript, fresh)
        except RuntimeError as e:
            msg = str(e)
            if attempt == 3 or not ("exceed" in msg and "context" in msg):
                raise
            m = CTX_RE.search(msg)
            ratio = 0.5
            if m:
                ratio = min(0.9, 0.85 * float(m.group(2)) / float(m.group(1)))
            fps = cl.get("fps", 2.0) * ratio
            height = cl.get("height", 480)
            if fps < 0.5:                      # below 1 frame every 2 s, shrink the picture instead
                height = max(240, int(height * max(ratio, 0.5)))
                fps = 0.5
            cl["fps"], cl["height"] = round(fps, 3), height
            log("    %s is too long for the server context; re-encoding at %.2f fps, %d px high"
                % (cl["id"], fps, height))
            encode_clip(video, os.path.join(out_dir, cl["file"]), cl["start"], cl["end"] - cl["start"],
                        height, 30, fps)


def frame_notes(frames):
    lines = []
    for fr in frames:
        d = fr.get("description") or {}
        lines.append("%s | %.1f s | %s | %s | geometry: %s | interface: %s | camera: %s | "
                     "motion: %s | text: %s | narration: %s" % (
                         fr["id"], fr["t"], trunc(d.get("phase"), 40), trunc(d.get("summary"), 220),
                         trunc(d.get("relative_geometry"), 200), trunc(d.get("interface"), 200),
                         trunc(d.get("camera"), 120), trunc(d.get("motion_cues"), 120),
                         trunc(d.get("on_screen_text"), 120), trunc(fr.get("narration"), 200)))
    return "\n".join(lines)


def clip_notes(clips):
    lines = []
    for cl in clips:
        d = cl.get("description") or {}
        events = d.get("events") if isinstance(d.get("events"), list) else []
        if not events and d.get("summary"):
            lines.append("%s | %s-%s | %s" % (cl["id"], fmt_time(cl["start"]), fmt_time(cl["end"]),
                                              trunc(d.get("summary"), 400)))
        for ev in events:
            if not isinstance(ev, dict):
                continue
            a = ev.get("from_s_abs", cl["start"])
            b = ev.get("to_s_abs", cl["end"])
            lines.append("%s | %s-%s | %s | %s | motion: %s" % (
                cl["id"], fmt_time(a), fmt_time(b), trunc(ev.get("phase"), 30),
                trunc(ev.get("what_happens"), 260), trunc(ev.get("motion"), 220)))
        for key in ("interface_sequence", "camera", "on_screen_text", "uncertain"):
            if d.get(key):
                lines.append("%s %s: %s" % (cl["id"], key, trunc(d.get(key), 300)))
    return "\n".join(lines)


def appearance_notes(frames, clips):
    """Chaser and target descriptions, so the synthesis can merge them into one visual bible."""
    lines = []
    for item in list(frames) + list(clips):
        d = item.get("description") or {}
        for key in ("chaser", "target"):
            v = d.get(key)
            if v:
                lines.append("%s %s: %s" % (item["id"], key, trunc(v, 400)))
    return "\n".join(lines)


def synthesise(client, out_dir, frames, clips, duration, context, transcript, n_images):
    clip_part = ""
    if clips:
        clip_part = ("Clip notes from a second model that watched the video as video "
                     "(motion, order, timing; times are absolute):\n%s\n\n" % clip_notes(clips))
    header = ("Context from the user: %s\nVideo duration: %.0f s. Keyframes analysed: %d. Clips watched: %d.\n\n"
              "Frame notes (id | time | phase | summary | ...):\n%s\n\n"
              "%s"
              "Appearance notes:\n%s\n\n"
              "Transcript:\n%s\n"
              % (context or "none", duration, len(frames), len(clips), frame_notes(frames), clip_part,
                 appearance_notes(frames, clips),
                 transcript_text(transcript) if transcript else "none"))
    count = min(n_images, len(frames))
    while True:
        content = [{"type": "text", "text": header}]
        if count > 0:
            idx = sorted(set(int(round(i * (len(frames) - 1) / float(max(1, count - 1))))
                             for i in range(count)))
            content.append({"type": "text", "text": "Selected keyframes follow, each with its id and time."})
            for i in idx:
                fr = frames[i]
                content.append({"type": "text", "text": "%s at %.1f s:" % (fr["id"], fr["t"])})
                content.append({"type": "image_url",
                                "image_url": {"url": data_uri(os.path.join(out_dir, fr["thumb"]))}})
        content.append({"type": "text", "text": SYNTH_TASK})
        msgs = [{"role": "system", "content": SYNTH_SYSTEM}, {"role": "user", "content": content}]
        try:
            log("    synthesis with %d keyframes ..." % count)
            return client.chat(msgs, max_tokens=16000 if client.think else 8000, temperature=0.3)
        except RuntimeError as e:
            if count == 0:
                raise
            log("    synthesis failed with %d images (%s); retrying with fewer" % (count, trunc(str(e), 160)))
            count = count // 2


# --------------------------------------------------------------------------
# output
# --------------------------------------------------------------------------

def write_outputs(out_dir, video, duration, frames, clips, transcript, context, models, synthesis, sheets):
    meta = {"source": os.path.basename(video), "duration_s": round(duration, 2),
            "models": models, "context": context,
            "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
            "frames": frames, "clips": clips}
    with open(os.path.join(out_dir, "frames.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    if transcript:
        with open(os.path.join(out_dir, "transcript.txt"), "w", encoding="utf-8") as f:
            f.write(transcript_text(transcript, limit=10 ** 9) + "\n")

    name = "brief.md" if synthesis is not None else "brief_skeleton.md"
    used = ", ".join("%s (%s)" % (m, role) for role, m in models.items() if m) if synthesis is not None else "none"
    with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
        f.write("# Video brief: %s\n\n" % os.path.basename(video))
        f.write("Source: %s, %s long, %d keyframes, %d clips. Models: %s. Generated %s by video2brief.py.\n"
                % (os.path.basename(video), fmt_time(duration), len(frames), len(clips), used, meta["generated"]))
        if context:
            f.write("User context: %s\n" % context)
        f.write("\n")
        if synthesis is not None:
            f.write(synthesis.strip() + "\n\n")
        f.write("## Appendix A. Frame log\n\n| Frame | Time | Phase | Summary |\n|---|---|---|---|\n")
        for fr in frames:
            d = fr.get("description") or {}
            f.write("| %s | %s | %s | %s |\n" % (fr["id"], fmt_time(fr["t"]),
                                               trunc(d.get("phase"), 40),
                                               trunc(d.get("summary"), 240).replace("|", "/")))
        f.write("\nContact sheets: %s\n" % (", ".join(sheets) if sheets else "none"))
        if clips:
            f.write("\n## Appendix B. Clip log (model that watched the video)\n\n"
                    "| Clip | Time | Phase | What happens | Motion |\n|---|---|---|---|---|\n")
            for cl in clips:
                d = cl.get("description") or {}
                events = d.get("events") if isinstance(d.get("events"), list) else []
                if not events:
                    f.write("| %s | %s-%s |  | %s |  |\n" % (cl["id"], fmt_time(cl["start"]), fmt_time(cl["end"]),
                                                             trunc(d.get("summary"), 240).replace("|", "/")))
                for ev in events:
                    if not isinstance(ev, dict):
                        continue
                    f.write("| %s | %s-%s | %s | %s | %s |\n" % (
                        cl["id"], fmt_time(ev.get("from_s_abs", cl["start"])),
                        fmt_time(ev.get("to_s_abs", cl["end"])), trunc(ev.get("phase"), 30),
                        trunc(ev.get("what_happens"), 200).replace("|", "/"),
                        trunc(ev.get("motion"), 160).replace("|", "/")))
        if transcript:
            f.write("\n## Appendix %s. Transcript\n\n```\n%s\n```\n"
                    % ("C" if clips else "B", transcript_text(transcript)))
    return name


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Turn a reference video into a written brief for a coding model.",
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("video", nargs="?", help="video file (mp4, mkv, webm, mov)")
    ap.add_argument("--out", help="output folder (default: <video name>_brief next to the video)")
    ap.add_argument("--context", default="", help="one line telling the models what the video is about")
    ap.add_argument("--transcript", help=".srt, .vtt or .txt (default: subtitles next to the video, if any)")
    g = ap.add_argument_group("frame model (stills)")
    g.add_argument("--api", default=DEFAULT_API, help="OpenAI-compatible base URL (default %(default)s)")
    g.add_argument("--key", default=os.environ.get("OMLX_API_KEY", ""), help="API key (default $OMLX_API_KEY)")
    g.add_argument("--model", default=DEFAULT_MODEL, help="vision model id (default %(default)s)")
    g.add_argument("--workers", type=int, default=3, help="parallel frame requests (default 3)")
    g.add_argument("--think", action="store_true", help="let the frame model think (slower)")
    v = ap.add_argument_group("video model (clips), optional")
    v.add_argument("--video-model", default="", help="model id that accepts video, e.g. the GLM-5.3-Flash "
                                                      "name in llama-swap; empty = skip the clip pass")
    v.add_argument("--video-api", default=DEFAULT_VIDEO_API, help="base URL (default %(default)s, llama-swap)")
    v.add_argument("--video-key", default=os.environ.get("VIDEO_API_KEY", ""), help="API key, if any ($VIDEO_API_KEY)")
    v.add_argument("--video-effort", default="low", help="reasoning_effort sent to the video model "
                                                        "(default low; empty to omit)")
    v.add_argument("--clip-seconds", type=float, default=30.0, help="clip length (default 30)")
    v.add_argument("--clip-height", type=int, default=480, help="clip height in pixels (default 480)")
    v.add_argument("--clip-fps", type=float, default=2.0, help="frames per second kept in each clip (default 2)")
    v.add_argument("--clip-max-mb", type=float, default=20.0, help="re-encode smaller above this size (default 20)")
    v.add_argument("--video-timeout", type=int, default=1800, help="seconds per clip request (default 1800)")
    s = ap.add_argument_group("frame selection")
    s.add_argument("--scene", type=float, default=0.30, help="scene-cut threshold 0..1 (default 0.30)")
    s.add_argument("--min-gap", type=float, default=1.5, help="min seconds between scene-cut frames")
    s.add_argument("--max-gap", type=float, default=6.0, help="max seconds without a frame")
    s.add_argument("--max-frames", type=int, default=48, help="cap on analysed frames (default 48)")
    s.add_argument("--start", type=float, default=0.0, help="start of the segment to analyse, seconds")
    s.add_argument("--end", type=float, default=0.0, help="end of the segment, seconds (0 = end of video)")
    s.add_argument("--width", type=int, default=1280, help="frame width sent to the model (default 1280)")
    o = ap.add_argument_group("other")
    o.add_argument("--synth-images", type=int, default=16, help="keyframes shown in the synthesis (default 16)")
    o.add_argument("--timeout", type=int, default=900, help="seconds per frame request (default 900)")
    o.add_argument("--fresh", action="store_true", help="ignore cached descriptions")
    o.add_argument("--no-vlm", action="store_true", help="only frames, contact sheets and transcript")
    o.add_argument("--selftest", action="store_true", help="check that the frame model sees images, then exit")
    o.add_argument("--selftest-video", action="store_true", help="check that --video-model sees video, then exit")
    o.add_argument("--list-models", action="store_true", help="list the model ids on both servers, then exit")
    args = ap.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            die("%s not found on PATH (install with: brew install ffmpeg)" % tool)
    if args.max_frames < 2:
        die("--max-frames must be at least 2")

    client = ChatClient(args.api, args.key, args.model, args.timeout, label="frame model",
                        extra={} if args.think else {"chat_template_kwargs": {"enable_thinking": False}},
                        think=args.think)
    vclient = None
    if args.video_model or args.selftest_video or args.list_models:
        vclient = ChatClient(args.video_api, args.video_key, args.video_model, args.video_timeout,
                             label="video model", extra={"reasoning_effort": args.video_effort} if args.video_effort else {},
                             retries=6, backoff=20, think=True)

    if args.list_models:
        for c, name in ((client, "frame server"), (vclient, "video server")):
            try:
                ids = c.models()
                log("%s %s: %s" % (name, c.base, ", ".join(sorted(ids)) if ids else "no /models list"))
            except RuntimeError as e:
                log("%s: %s" % (name, e))
        return

    if args.selftest or args.selftest_video:
        ok = True
        try:
            if args.selftest:
                client.preflight()
                ok = selftest(client) and ok
            if args.selftest_video:
                if not args.video_model:
                    die("--selftest-video needs --video-model (see --list-models)")
                vclient.preflight()
                ok = selftest_video(vclient) and ok
        except RuntimeError as e:
            die(str(e))
        sys.exit(0 if ok else 2)

    if not args.video:
        ap.error("the video path is required (or use --selftest, --selftest-video, --list-models)")
    video = os.path.abspath(os.path.expanduser(args.video))
    if not os.path.isfile(video):
        die("video not found: " + video)
    stem = os.path.splitext(os.path.basename(video))[0]
    out_dir = os.path.abspath(os.path.expanduser(args.out or os.path.join(os.path.dirname(video), stem + "_brief")))
    os.makedirs(out_dir, exist_ok=True)

    duration = probe_duration(video)
    log("Video: %s (%s)" % (video, fmt_time(duration) if duration else "unknown length"))
    log("Output: %s" % out_dir)

    log("1/6 Extracting keyframes ...")
    frames = extract_frames(video, out_dir, args, duration)
    log("    %d keyframes from %s to %s" % (len(frames), fmt_time(frames[0]["t"]), fmt_time(frames[-1]["t"])))

    log("2/6 Thumbnails and contact sheets ...")
    make_thumbs(frames, out_dir)
    sheets = make_contact_sheets(out_dir)
    log("    %s" % ", ".join(sheets))

    log("3/6 Transcript ...")
    tpath = args.transcript or find_transcript(video)
    transcript = []
    if tpath:
        transcript = load_transcript(os.path.expanduser(tpath))
        log("    %s: %d lines" % (os.path.basename(tpath), len(transcript)))
    else:
        log("    none found (fine for videos without narration)")
    attach_narration(frames, transcript)

    clips = []
    if args.video_model:
        seg_start = max(0.0, args.start)
        seg_end = args.end if args.end > 0 else duration
        if seg_end - seg_start > 1.0:
            clips = make_clips(video, out_dir, seg_start, seg_end, args.clip_seconds,
                               args.clip_height, args.clip_max_mb, args.clip_fps)
            log("    %d clips for the video model (%s MB)"
                % (len(clips), ", ".join(str(c["mb"]) for c in clips)))
        else:
            log("    note: video length unknown; the clip pass is skipped")

    models = {"frames": args.model, "clips": args.video_model if clips else ""}
    if args.no_vlm:
        name = write_outputs(out_dir, video, duration, frames, clips, transcript, args.context, models, None, sheets)
        log("Done without models: %s" % os.path.join(out_dir, name))
        return

    if not args.key:
        log("    note: no API key set; oMLX with authentication will refuse the requests")
    try:
        client.preflight()
        if clips:
            vclient.preflight()
    except RuntimeError as e:
        die(str(e) + "\nFrames, thumbnails and contact sheets are already in " + out_dir)

    log("4/6 Describing %d frames with %s (%d in parallel) ..." % (len(frames), args.model, args.workers))
    t_start = time.time()
    failures = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(describe_frame, client, out_dir, fr, len(frames), duration,
                               args.context, args.fresh): fr for fr in frames}
        done = 0
        for fut in concurrent.futures.as_completed(futures):
            fr = futures[fut]
            done += 1
            try:
                fr["description"], cached = fut.result()
                log("    [%d/%d] %s %6.1f s  %-22s %s%s" % (
                    done, len(frames), fr["id"], fr["t"], trunc(fr["description"].get("phase"), 22),
                    trunc(fr["description"].get("summary"), 90), "  (cached)" if cached else ""))
            except RuntimeError as e:
                failures += 1
                fr["description"] = {"phase": "other", "summary": "description failed"}
                log("    [%d/%d] %s failed: %s" % (done, len(frames), fr["id"], trunc(str(e), 200)))
                if failures >= 3 and failures == done:
                    for f in futures:
                        f.cancel()
                    die("the first requests all failed; run --selftest and check --api, --key and --model")
    log("    %.0f s for the frame descriptions" % (time.time() - t_start))

    if clips:
        log("5/6 Watching %d clips with %s (the first request may wait for the model to load) ..."
            % (len(clips), args.video_model))
        t_start = time.time()
        for cl in clips:
            try:
                cl["description"], cached = describe_clip_fitting(vclient, video, out_dir, cl, len(clips),
                                                                  duration, args.context, transcript, args.fresh)
                events = cl["description"].get("events") or []
                log("    [%d/%d] %s %s-%s  %d events%s" % (
                    cl["index"], len(clips), cl["id"], fmt_time(cl["start"]), fmt_time(cl["end"]),
                    len(events) if isinstance(events, list) else 0, "  (cached)" if cached else ""))
            except RuntimeError as e:
                log("    %s failed: %s" % (cl["id"], trunc(str(e), 300)))
                if not any(c.get("description") for c in clips):
                    log("    the video model refused the first clip; continuing with the frame notes only")
                    clips = []
                    models["clips"] = ""
                    break
                cl["description"] = {"events": [], "summary": "clip description failed"}
        log("    %.0f s for the clips" % (time.time() - t_start))
    else:
        log("5/6 Clip pass skipped (no --video-model)")

    log("6/6 Writing the synthesis ...")
    try:
        synthesis = synthesise(client, out_dir, frames, clips, duration, args.context, transcript, args.synth_images)
    except RuntimeError as e:
        log("    synthesis failed (%s); brief.md will contain the logs only" % trunc(str(e), 200))
        synthesis = "## Synthesis\n\nThe synthesis step failed. Use the logs below and frames.json."
    name = write_outputs(out_dir, video, duration, frames, clips, transcript, args.context, models, synthesis, sheets)

    brief = os.path.join(out_dir, name)
    log("\nBrief ready: %s" % brief)
    log("Check it against the contact sheets and correct it by hand, then build the DeepSeek prompt:")
    log('  cat master_prompt.md "%s" > "%s"' % (brief, os.path.join(out_dir, "prompt_for_deepseek.md")))


if __name__ == "__main__":
    main()

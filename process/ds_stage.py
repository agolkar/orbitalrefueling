#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ds_stage.py

Drives the staged game build with DeepSeek from the terminal, through
llama-swap's OpenAI-compatible API. It keeps the conversation on disk,
streams each answer to the screen, writes the files of every answer into the
game folder (with apply_stage.py, next to this script) and runs the tests.

Commands
  start            new conversation: sends prompt_for_deepseek.md (Stage 0)
  next             sends "next": DeepSeek writes the next stage
  say "TEXT"       sends your own message (answers, decisions, corrections);
                   say @file.txt sends a file, say - reads standard input
  fix              sends the output of the last failed test run and asks for fixes
  continue         asks DeepSeek to finish an answer that was cut off
  restart N        new conversation with the prompt, your earlier decisions, the
                   current project files and "Continue with Stage N"
                   (use it when the context grows past about 170k tokens)
  retry            drops the last answer (and its files, through git) and sends
                   the same request again: useful when an answer is poor
  undo             drops the last answer and its files without resending
  status           conversation size, last stage, last test result
  test             runs the tests again without asking DeepSeek

Typical session (on the Mac Studio, inside tmux, in ~/refuel)
  python3 ds_stage.py start
  python3 ds_stage.py say @answers.txt
  python3 ds_stage.py next
  python3 ds_stage.py fix

The llama-swap key is read from ~/.config/llama-swap/config.yaml (apiKeys) or
from $LLAMASWAP_API_KEY; it is never printed. Only the Python standard library
is used.
"""

from __future__ import print_function

import argparse
import datetime
import glob
import http.client
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_API = os.environ.get("DS_URL", "http://127.0.0.1:8100/v1")
DEFAULT_MODEL = os.environ.get("DS_MODEL", "deepseek-v4.1-flash")
DEFAULT_ROOT = os.path.expanduser("~/refuel/game")
DEFAULT_CHAT = os.path.expanduser("~/refuel/ds")
SWAP_CONFIG = os.path.expanduser("~/.config/llama-swap/config.yaml")
CONTEXT_WARN_TOKENS = 170000          # the DeepSeek server holds 262,144 tokens; leave room for the answer
SKIP_DIRS = {".git", ".backup", "node_modules", "assets"}
TEXT_EXT = {".js", ".mjs", ".html", ".css", ".md", ".json", ".txt", ".glsl"}
CONTINUE_MSG = ("Your last answer was cut off. Continue exactly where it stopped: repeat in full the file that "
                "was cut, with its path line, then write the remaining files, and end with STAGE <n> COMPLETE.")

_print_lock = threading.Lock()


def log(msg=""):
    with _print_lock:
        print(msg, flush=True)


def write(s):
    with _print_lock:
        sys.stdout.write(s)
        sys.stdout.flush()


def die(msg, code=1):
    print("ERROR: " + msg, file=sys.stderr, flush=True)
    sys.exit(code)


# --------------------------------------------------------------------------
# configuration
# --------------------------------------------------------------------------

def read_swap_key():
    key = os.environ.get("LLAMASWAP_API_KEY") or os.environ.get("VIDEO_API_KEY")
    if key:
        return key
    try:
        lines = open(SWAP_CONFIG, encoding="utf-8").read().splitlines()
    except OSError:
        return ""
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith("apiKeys:"):
            inline = s[len("apiKeys:"):].strip()
            if inline.startswith("["):                 # apiKeys: ["key"]
                m = re.search(r"[\"']?([^\"',\]\s]+)", inline[1:])
                return m.group(1) if m else ""
            for nxt in lines[i + 1:]:
                t = nxt.strip()
                if not t or t.startswith("#"):
                    continue
                if t.startswith("-"):
                    return t[1:].strip().strip('"').strip("'")
                break
    return ""


def tokens_estimate(messages):
    return int(sum(len(m["content"]) for m in messages) / 3.5)


# --------------------------------------------------------------------------
# conversation store
# --------------------------------------------------------------------------

class Chat(object):
    def __init__(self, folder):
        self.folder = folder
        self.path = os.path.join(folder, "chat.json")
        self.data = self.empty()
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as f:
                self.data.update(json.load(f))

    @staticmethod
    def empty():
        return {"model": "", "messages": [], "turns": [], "stage": None, "notes": [], "last_usage": None}

    @property
    def messages(self):
        return self.data["messages"]

    def archive(self):
        if os.path.exists(self.path):
            stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            dst = os.path.join(self.folder, "chat_%s.json" % stamp)
            k = 2
            while os.path.exists(dst):
                dst = os.path.join(self.folder, "chat_%s-%d.json" % (stamp, k))
                k += 1
            shutil.move(self.path, dst)
        notes = self.data.get("notes", [])
        self.data = self.empty()
        self.data["notes"] = notes          # decisions survive a restart

    def save(self):
        os.makedirs(self.folder, exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    def next_turn_file(self, suffix=""):
        nums = [int(m.group(1)) for m in (re.match(r"turn_(\d+)", os.path.basename(p))
                                          for p in glob.glob(os.path.join(self.folder, "turn_*.md"))) if m]
        return os.path.join(self.folder, "turn_%03d%s.md" % ((max(nums) if nums else 0) + 1, suffix))


# --------------------------------------------------------------------------
# streaming client
# --------------------------------------------------------------------------

class Stream(object):
    """Collects an OpenAI-style SSE stream: answer text in `sink`, reasoning only counted."""

    def __init__(self, sink, t0):
        self.sink, self.t0 = sink, t0
        self.thinking = 0
        self.started = False
        self.in_think = False
        self.finish = None
        self.usage = None
        self.error = None
        self.last_status = 0.0
        self.elapsed = 0.0

    def feed(self, line):
        """Process one SSE line; returns True at the end of the stream."""
        if not line.startswith("data:"):
            return False
        payload = line[5:].strip()
        if payload == "[DONE]":
            return True
        try:
            chunk = json.loads(payload)
        except ValueError:
            return False
        if chunk.get("error"):
            err = chunk["error"]
            self.error = err.get("message") if isinstance(err, dict) else str(err)
            return True
        if chunk.get("usage"):
            self.usage = chunk["usage"]
        elif chunk.get("timings"):
            t = chunk["timings"]
            self.usage = {"prompt_tokens": t.get("prompt_n"), "completion_tokens": t.get("predicted_n")}
        choices = chunk.get("choices") or []
        if not choices:
            return False
        if choices[0].get("finish_reason"):
            self.finish = choices[0]["finish_reason"]
        delta = choices[0].get("delta") or {}
        self.thinking += len(delta.get("reasoning_content") or delta.get("reasoning") or "")
        piece = delta.get("content") or ""
        if "<think>" in piece:
            self.in_think = True
            piece = piece.split("<think>", 1)[1]
        if self.in_think:
            if "</think>" in piece:
                before, piece = piece.split("</think>", 1)
                self.thinking += len(before)
                self.in_think = False
                piece = piece.lstrip("\n")
            else:
                self.thinking += len(piece)
                piece = ""
        if not self.started and self.thinking and time.time() - self.last_status > 1.0:
            write("\r  thinking ... %d characters, %.0f s   " % (self.thinking, time.time() - self.t0))
            self.last_status = time.time()
        if piece:
            if not self.started:
                write("\n" if self.thinking else "")
                self.started = True
            self.sink.append(piece)
            write(piece)
        return False


def strip_think(text):
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    if "<think>" in text:                       # unclosed: everything after it is reasoning
        text = text.split("<think>", 1)[0]
    return text.strip()


def waiting_indicator(done, t0):
    while not done.wait(5.0):
        write("\r  waiting for the first token ... %.0f s   " % (time.time() - t0))


def stream_chat(api, key, model, messages, max_tokens, timeout, extra, sink):
    """Send the conversation and stream the answer into `sink`; returns a Stream with the metadata."""
    url = api.rstrip("/") + "/chat/completions"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    body = dict(extra or {})
    body.update({"model": model, "messages": messages, "max_tokens": max_tokens, "stream": True})
    for attempt in range(4):
        req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST")
        req.add_header("Content-Type", "application/json")
        if key:
            req.add_header("Authorization", "Bearer " + key)
        t0 = time.time()
        done = threading.Event()
        threading.Thread(target=waiting_indicator, args=(done, t0), daemon=True).start()
        try:
            resp = opener.open(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            done.set()
            detail = e.read().decode("utf-8", "replace")[:800]
            if e.code in (400, 422) and "max_tokens" in detail and body["max_tokens"] > 4096:
                body["max_tokens"] //= 2
                log("\n  the server refused max_tokens; retrying with %d" % body["max_tokens"])
                continue
            if e.code in (401, 403):
                die("llama-swap refused the key (HTTP %d). Check apiKeys in %s" % (e.code, SWAP_CONFIG))
            if "context" in detail.lower() and e.code in (400, 413, 500):
                die("the conversation no longer fits in the model's context (%s).\n"
                    "Start a fresh one with the current files: python3 ds_stage.py restart <next stage>" % detail[:300])
            if e.code >= 500 and attempt < 3:
                log("\n  server error %d (%s), retrying in 20 s ..." % (e.code, detail[:200]))
                time.sleep(20)
                continue
            die("HTTP %d from %s: %s" % (e.code, url, detail))
        except OSError as e:
            done.set()
            if attempt < 3:
                log("\n  cannot reach %s (%s), retrying in 20 s ..." % (url, e))
                time.sleep(20)
                continue
            die("cannot reach %s: %s" % (url, e))

        st = Stream(sink, t0)
        try:
            with resp:
                lines = iter(resp)
                first = ""
                for raw in lines:
                    first = raw.decode("utf-8", "replace").strip()
                    if first:
                        break
                done.set()
                write("\r" + " " * 60 + "\r")
                if first and not first.startswith(("data:", ":", "event:", "id:", "retry:")):
                    # the server answered without streaming
                    data = json.loads(first + "".join(r.decode("utf-8", "replace") for r in lines))
                    if data.get("error"):
                        st.error = str(data["error"])
                        return st
                    choice = data["choices"][0]
                    msg = choice.get("message") or {}
                    text = strip_think(msg.get("content") or "")
                    st.thinking = len(msg.get("reasoning_content") or "")
                    st.finish, st.usage = choice.get("finish_reason"), data.get("usage")
                    sink.append(text)
                    log(text)
                    return st
                if first and not st.feed(first):
                    for raw in lines:
                        if st.feed(raw.decode("utf-8", "replace").strip()):
                            break
        except (OSError, http.client.HTTPException) as e:
            st.error = "connection lost while streaming (%s)" % (e or type(e).__name__)
        finally:
            done.set()
            st.elapsed = time.time() - t0
        write("\n")
        return st
    die("no answer from %s" % url)


# --------------------------------------------------------------------------
# project helpers
# --------------------------------------------------------------------------

def stage_marker(text):
    found = re.findall(r"STAGE\s+([0-9]+[A-Za-z]?)\s+COMPLETE", text)
    return found[-1] if found else None


def git(root, *args):
    try:
        return subprocess.run(["git", "-C", root] + list(args), stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, universal_newlines=True)
    except OSError:
        return None


def git_head(root):
    if not os.path.isdir(os.path.join(root, ".git")):
        return None
    p = git(root, "rev-parse", "--verify", "-q", "HEAD")
    return p.stdout.strip() if p and p.returncode == 0 else None


def ensure_repo(root):
    if not os.path.isdir(root):
        os.makedirs(root)
        log("  created %s" % root)
    if not shutil.which("git"):
        return
    if not os.path.isdir(os.path.join(root, ".git")):
        git(root, "init", "-q")
        log("  created a git repository in %s" % root)
    if not git_head(root):
        p = git(root, "config", "user.email")
        ident = [] if p and p.stdout.strip() else ["-c", "user.name=DeepSeek build",
                                                   "-c", "user.email=deepseek@localhost"]
        git(root, *(ident + ["commit", "-q", "--allow-empty", "-m", "Empty project"]))


def apply_files(turn_file, root):
    """Returns ('none' | 'ok' | 'partial', list of skipped paths)."""
    script = os.path.join(HERE, "apply_stage.py")
    if not os.path.exists(script):
        log("  apply_stage.py not found next to this script: files not written")
        return "none", []
    p = subprocess.run([sys.executable, script, turn_file, "--root", root, "--commit"],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
    out = p.stdout.strip()
    if p.returncode == 1 and "No files found" in out:
        log("  no files in this answer")
        return "none", []
    log(out)
    if re.search(r"ignored a \d+-line (?:js|javascript|mjs|html|css|json|glsl) block without a file path", out):
        log("Some code blocks had no path line, so they were not written. If they are files, run:\n"
            "  python3 ds_stage.py say \"Repeat those files in the required format: the path on its own line, "
            "then the complete file in a code block.\"")
    skipped = re.findall(r"^\s*SKIPPED\s+(\S+)", out, flags=re.M)
    return ("partial" if p.returncode == 3 else "ok"), skipped


def run_tests(root, chat_dir):
    runner = os.path.join(root, "tests", "run.mjs")
    if not os.path.exists(runner):
        return None
    if shutil.which("node"):
        cmd = ["node", "tests/run.mjs"]
    elif shutil.which("deno"):
        cmd = ["deno", "run", "--allow-read", "tests/run.mjs"]
    else:
        log("  tests skipped: neither node nor deno is installed (brew install node)")
        return None
    log("\nRunning the tests: %s" % " ".join(cmd))
    try:
        p = subprocess.run(cmd, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           universal_newlines=True, timeout=600)
        out, code = p.stdout, p.returncode
    except subprocess.TimeoutExpired:
        out, code = "Tests timed out after 600 s.", 124
    with open(os.path.join(chat_dir, "tests_last.log"), "w", encoding="utf-8") as f:
        f.write("exit code %d (%s)\n%s" % (code, " ".join(cmd), out))
    log("\n".join(out.strip().splitlines()[-25:]))
    log("TESTS %s (exit code %d)" % ("PASSED" if code == 0 else "FAILED", code))
    return code == 0


def project_files(root):
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(filenames):
            if os.path.splitext(name)[1].lower() in TEXT_EXT:
                files.append(os.path.relpath(os.path.join(dirpath, name), root))
    return files


def files_as_text(root):
    parts = []
    for rel in project_files(root):
        with open(os.path.join(root, rel), encoding="utf-8", errors="replace") as f:
            body = f.read().rstrip("\n")
        ext = os.path.splitext(rel)[1].lstrip(".").lower()
        fence = "````" if ext == "md" else "```"
        lang = {"mjs": "js", "md": "markdown", "txt": ""}.get(ext, ext)
        parts.append("%s\n%s%s\n%s\n%s" % (rel, fence, lang, body, fence))
    return "\n\n".join(parts)


def rerun_hint(command, args, chat_dir):
    """The command that sends the same request again, for error messages."""
    base = "python3 ds_stage.py"
    if command == "say":
        return '%s say @%s' % (base, os.path.join(chat_dir, "last_message.txt"))
    if command == "fix" and not os.path.exists(os.path.join(chat_dir, "tests_last.log")):
        return "%s test, then %s fix" % (base, base)
    if command == "restart":
        return "%s restart %s --yes" % (base, args.arg)
    if command == "start":
        return "%s start --yes" % base
    return "%s %s" % (base, command)


def read_text_arg(arg):
    if arg == "-":
        return sys.stdin.read().strip()
    if arg.startswith("@"):
        path = os.path.expanduser(arg[1:])
        if not os.path.exists(path):
            die("file not found: %s" % path)
        return open(path, encoding="utf-8").read().strip()
    return arg.strip()


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Drive the DeepSeek game build from the terminal.",
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("command", choices=["start", "next", "say", "fix", "continue", "restart", "retry", "undo",
                                        "status", "test"])
    ap.add_argument("arg", nargs="?", help="text, @file or - for 'say'; stage number for 'restart'")
    ap.add_argument("--prompt", default=os.path.join(HERE, "prompt_for_deepseek.md"),
                    help="master prompt plus brief (default: prompt_for_deepseek.md next to this script)")
    ap.add_argument("--root", default=DEFAULT_ROOT, help="game folder (default %(default)s)")
    ap.add_argument("--chat-dir", default=DEFAULT_CHAT, help="where the conversation is kept (default %(default)s)")
    ap.add_argument("--api", default=DEFAULT_API, help="llama-swap base URL (default %(default)s)")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="model name in llama-swap (default %(default)s)")
    ap.add_argument("--max-tokens", type=int, default=65536, help="answer budget (default 65536)")
    ap.add_argument("--timeout", type=int, default=7200, help="seconds without data before giving up")
    ap.add_argument("--extra", default="", help="extra JSON fields for the request, e.g. '{\"temperature\":0.6}'")
    ap.add_argument("--yes", action="store_true", help="start/restart without asking, even if a conversation exists")
    ap.add_argument("--no-apply", action="store_true", help="do not write files into the game folder")
    ap.add_argument("--no-tests", action="store_true", help="do not run the tests after applying")
    args = ap.parse_args()

    root = os.path.abspath(os.path.expanduser(args.root))
    chat_dir = os.path.abspath(os.path.expanduser(args.chat_dir))
    os.makedirs(chat_dir, exist_ok=True)
    chat = Chat(chat_dir)
    try:
        extra = json.loads(args.extra) if args.extra else {}
    except ValueError:
        die("--extra must be JSON, e.g. '{\"temperature\":0.6}'")

    if args.command == "status":
        log("Conversation: %s" % chat.path)
        log("Messages: %d, estimated context %d tokens (warning above %d)"
            % (len(chat.messages), tokens_estimate(chat.messages), CONTEXT_WARN_TOKENS))
        if chat.data.get("last_usage"):
            log("Last request as counted by the server: %s" % chat.data["last_usage"])
        log("Last stage completed: %s" % (chat.data.get("stage") or "none"))
        for t in chat.data.get("turns", [])[-5:]:
            log("  %s  %-8s stage %-4s %5ss" % (t["file"], t["command"], t.get("stage") or "-", t.get("seconds")))
        last = os.path.join(chat_dir, "tests_last.log")
        if os.path.exists(last):
            log("Last test run: %s" % open(last, encoding="utf-8").readline().strip())
        return

    if args.command == "test":
        run_tests(root, chat_dir)
        return

    command = args.command
    reset_done = False
    fresh = False
    if command in ("undo", "retry"):
        turns = chat.data.get("turns", [])
        if len(chat.messages) < 2 or not turns:
            die("nothing to undo")
        turn = turns[-1]
        if turn["command"] in ("start", "restart"):
            die("the last answer came from '%s'; to redo it, run that command again" % turn["command"])
        before, after = turn.get("git_before"), turn.get("git_after")
        if before and after and before != after:
            if git_head(root) != after:
                die("the game folder has commits made after %s; undo by hand with git in %s" % (turn["file"], root))
            status = git(root, "status", "--porcelain")
            if status and status.stdout.strip():
                die("the game folder has uncommitted changes; commit or discard them first "
                    "(git -C %s status)" % root)
            git(root, "reset", "-q", "--hard", before)
            log("Game folder reset to its state before %s." % turn["file"])
            stale = os.path.join(chat_dir, "tests_last.log")
            if os.path.exists(stale):
                os.remove(stale)
            reset_done = True
        user_msg = chat.messages[-2]["content"]
        chat.data["messages"] = chat.messages[:-2]
        turns.pop()
        notes = chat.data.get("notes", [])
        if turn["command"] == "say" and notes and notes[-1] == user_msg:
            notes.pop()
        old_file = os.path.join(chat_dir, turn["file"])
        if os.path.exists(old_file):
            os.replace(old_file, old_file[:-3] + "_undone.md")
        markers = [stage_marker(m["content"]) for m in chat.messages if m["role"] == "assistant"]
        markers = [m for m in markers if m]
        chat.data["stage"] = markers[-1] if markers else None
        chat.save()
        log("Removed the last exchange (%s, from '%s') from the conversation." % (turn["file"], turn["command"]))
        if command == "undo":
            if reset_done:
                run_tests(root, chat_dir)
            return
        command, message = turn["command"], user_msg
        if command == "say":
            chat.data.setdefault("notes", []).append(message)
        log("Sending the same request again.")
    elif command in ("start", "restart"):
        if not os.path.exists(args.prompt):
            die("prompt not found: %s" % args.prompt)
        if chat.messages and not args.yes:
            if not sys.stdin.isatty():
                die("a conversation already exists; add --yes to archive it and start a new one")
            ans = input("A conversation with %d messages exists. Archive it and start a new one? [y/N] "
                        % len(chat.messages))
            if ans.strip().lower() not in ("y", "yes", "s", "si", "sì"):
                log("Nothing done.")
                return
        prompt = open(args.prompt, encoding="utf-8").read().rstrip()
        ensure_repo(root)
        fresh = True
        if command == "start":
            message = prompt
        else:
            if not args.arg:
                die("restart needs the stage to continue with, e.g. restart 3")
            n = args.arg
            files = files_as_text(root)
            if not files:
                die("no project files found in %s" % root)
            prompt = prompt.replace("Start with Stage 0.",
                                    "Stages before Stage %s are complete; the current files are at the end "
                                    "of this message." % n)
            notes = chat.data.get("notes", [])
            message = prompt
            if notes:
                message += ("\n\n=== MY DECISIONS AND CORRECTIONS SO FAR ===\n\n" +
                            "\n\n".join("- " + x.replace("\n", "\n  ") for x in notes))
            message += ("\n\n=== CURRENT PROJECT FILES ===\n\nThese are the files as they stand now. "
                        "Treat them as the source of truth.\n\n" + files +
                        "\n\nContinue with Stage %s." % n)
            log("New conversation with the prompt, %d decisions and %d project files."
                % (len(notes), len(project_files(root))))
    else:
        if not chat.messages:
            die("no conversation yet: run 'python3 ds_stage.py start' first")
        if command == "next":
            message = "next"
        elif command == "say":
            if not args.arg:
                die('say needs a text in quotes, @file or -, e.g. say "Proceed with Stage 1"')
            message = read_text_arg(args.arg)
            if not message:
                die("empty message")
            chat.data.setdefault("notes", []).append(message)
        elif command == "continue":
            message = CONTINUE_MSG
        else:  # fix
            last = os.path.join(chat_dir, "tests_last.log")
            if not os.path.exists(last):
                die("no test output to send; run 'python3 ds_stage.py test' first")
            log_text = open(last, encoding="utf-8").read()
            if log_text.startswith("exit code 0 "):
                die("the last test run passed; nothing to fix")
            if len(log_text) > 20000:
                log_text = log_text[:4000] + "\n[...]\n" + log_text[-15000:]
            stage = chat.data.get("stage") or "<n>"
            message = ("I ran the tests and they failed. Output:\n\n```\n%s\n```\n\nFind the causes and fix them. "
                       "Output every changed file complete, in the usual format, and end with STAGE %s COMPLETE."
                       % (log_text.rstrip(), stage))

    messages = ([] if fresh else chat.messages) + [{"role": "user", "content": message}]
    with open(os.path.join(chat_dir, "last_message.txt"), "w", encoding="utf-8") as f:
        f.write(message + "\n")
    rerun = rerun_hint(command, args, chat_dir)
    est = tokens_estimate(messages)
    log("Sending to %s at %s, about %d tokens of context." % (args.model, args.api, est))
    if est > CONTEXT_WARN_TOKENS:
        log("  warning: the conversation is long. If the answer fails or gets worse, run: "
            "python3 ds_stage.py restart <next stage>")
    log("  (the first request can wait a few minutes while llama-swap loads the model)")
    key = read_swap_key()
    if not key:
        log("  note: no llama-swap key found; set LLAMASWAP_API_KEY if the server needs one")

    sink = []
    try:
        st = stream_chat(args.api, key, args.model, messages, args.max_tokens, args.timeout, extra, sink)
    except KeyboardInterrupt:
        partial = "".join(sink)
        if partial.strip():
            pfile = chat.next_turn_file("_interrupted")
            with open(pfile, "w", encoding="utf-8") as f:
                f.write(partial)
            log("\nInterrupted. The partial answer is in %s." % pfile)
        log("\nInterrupted; nothing was added to the conversation. To send it again: %s" % rerun)
        sys.exit(130)

    answer = strip_think("".join(sink))
    if st.error:
        if answer:
            pfile = chat.next_turn_file("_failed")
            with open(pfile, "w", encoding="utf-8") as f:
                f.write(answer + "\n")
            log("The partial answer is in %s." % pfile)
        die("the server stopped with an error: %s\nNothing was added to the conversation. To send it again: %s"
            % (st.error, rerun))
    if not answer:
        die("empty answer (the budget may have gone into thinking). To send it again: %s --max-tokens 100000"
            % rerun)

    if fresh:
        notes = chat.data.get("notes", []) if command == "restart" else []
        if chat.messages:
            log("Previous conversation archived in %s" % chat.folder)
        chat.archive()
        chat.data["notes"] = notes
    turn_file = chat.next_turn_file()
    with open(turn_file, "w", encoding="utf-8") as f:
        f.write(answer + "\n")
    chat.data["model"] = args.model
    chat.data["messages"] = messages + [{"role": "assistant", "content": answer}]
    marker = stage_marker(answer)
    if marker:
        chat.data["stage"] = marker
    chat.data["last_usage"] = st.usage
    turn = {"file": os.path.basename(turn_file), "command": command, "stage": marker,
            "seconds": int(round(st.elapsed)), "finish": st.finish}
    chat.data["turns"].append(turn)
    chat.save()

    log("\nSaved %s (%.0f s). Context now about %d tokens."
        % (turn_file, st.elapsed, tokens_estimate(chat.messages)))
    cut = st.finish == "length"
    if cut:
        log("The answer hit the token limit and is cut off. Run: python3 ds_stage.py continue")
    elif not marker:
        log("No 'STAGE n COMPLETE' at the end. If DeepSeek asked you something, answer with: "
            "python3 ds_stage.py say \"...\"; if the answer looks cut off: python3 ds_stage.py continue")
    if args.no_apply:
        return
    ensure_repo(root)
    turn["git_before"] = git_head(root)
    result, skipped = apply_files(turn_file, root)
    turn["git_after"] = git_head(root)
    chat.save()
    if result == "partial" and not cut:
        names = ", ".join(skipped) or "the skipped files"
        log("Some files were not written (see SKIPPED above). Ask for them complete:\n"
            "  python3 ds_stage.py say \"Output %s again, complete, with no placeholders, "
            "then end with STAGE %s COMPLETE.\"" % (names, marker or "<n>"))
    if result != "none" and not args.no_tests:
        ok = run_tests(root, chat_dir)
        if ok is False:
            log("To send the failures to DeepSeek: python3 ds_stage.py fix")


if __name__ == "__main__":
    main()

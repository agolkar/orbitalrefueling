#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
apply_stage.py

Writes the files contained in a DeepSeek answer to the game folder.
ds_stage.py calls it after every answer; you can also run it by hand.

The answer must follow the master prompt's format: a line with the relative
path (for example `src/physics/cw.js`, also accepted with **bold**, ### or a
trailing colon), followed by the complete file in a fenced code block.

Safety rules
  - a code block that never closes (answer cut off) is not written
  - a block that looks partial ("// ...", "rest unchanged"), or is less than
    half as long as the file it would replace (60+ lines), does not replace
    the existing file; --force writes it anyway
  - shell blocks (```bash) are never written as source files
  - paths outside the game folder are refused
Overwritten files are first copied to <root>/.backup/<timestamp>/. With
--commit, and if <root> is a git repository, the change is committed.

Exit codes: 0 files written, 1 no files found, 3 files written but some
blocks were skipped (cut off or partial).

Examples (on the Mac Studio)
  python3 apply_stage.py ~/refuel/ds/turn_003.md --root ~/refuel/game --dry-run
  python3 apply_stage.py ~/refuel/ds/turn_003.md --root ~/refuel/game --commit
"""

from __future__ import print_function

import argparse
import datetime
import os
import re
import shutil
import subprocess
import sys

FENCE_RE = re.compile(r"^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)\s*$")
# relative path with an extension, or a dotfile such as .gitignore
PATH_RE = re.compile(r"^(?:[A-Za-z0-9_][A-Za-z0-9_./-]*\.[A-Za-z0-9]+|\.[A-Za-z0-9_][A-Za-z0-9_./-]*)$")
LABEL_RE = re.compile(r"^(?:file|path|filename)\s*:\s*", re.I)
SUFFIX_RE = re.compile(r"^(\S+?)\s+[-(–].*$")   # "src/a.js (new)", "src/a.js - updated"

SHELL_LANGS = {"bash", "sh", "shell", "zsh", "console", "terminal", "powershell", "ps1", "cmd", "bat"}
SHELL_EXT = {".sh", ".bash", ".zsh", ".command", ".ps1", ".bat", ".cmd"}
MARKDOWN_EXT = {".md", ".markdown"}
HASH_COMMENT_EXT = {".py", ".sh", ".bash", ".zsh", ".yml", ".yaml", ".toml", ".cfg", ".ini"}
SHRINK_MIN_LINES = 60      # a new version under half the length of a file this long is held back
SHRINK_RATIO = 0.5

_DOTS = r"(?:\.\.\.|…)"
_PLACEHOLDER = (
    _DOTS + r".*\b(?:existing|unchanged|as before|same|previous|rest|remaining|omitted)\b"      # "// ... existing code"
    r"|\b(?:existing|unchanged|rest of)\b.*" + _DOTS +                                         # "// rest of code ..."
    r"|\b(?:code|file|content|implementation|functions?|methods?|class|module|rest|everything else)"
    r"\s+(?:is\s+|remains?\s+|stays?\s+)?unchanged\b"                                          # "// rest unchanged"
    r"|\brest of (?:the )?(?:file|code|module|class|implementation|function)\b"                  # "// rest of the file"
    r"|\bfor brevity\b|\b(?:existing|previous) code\b|\bsame as before\b|\bremains? the same\b")


def placeholder_re(comment):
    return re.compile(
        r"^\s*" + _DOTS + r"\s*;?\s*$"                                             # a bare "..." line
        r"|^\s*" + comment + r"\s*" + _DOTS + r"\s*(?:\*/|-->)?\s*$"               # "// ..."
        r"|^\s*" + comment + r".*(?:" + _PLACEHOLDER + r")",                       # "// rest unchanged"
        re.I)


PLACEHOLDER_WEB = placeholder_re(r"(?://|/\*|\*|<!--)")
PLACEHOLDER_HASH = placeholder_re(r"#")


def clean_path_line(line):
    s = line.strip()
    s = re.sub(r"^#{1,6}\s*", "", s)              # markdown heading
    s = re.sub(r"^\d+[.)]\s+", "", s)             # "1. path"
    s = re.sub(r"^[-*]\s+", "", s)                # bullet
    s = s.strip("*_` ").rstrip(":").strip("*_` ")
    s = LABEL_RE.sub("", s).strip("*_` ")
    m = SUFFIX_RE.match(s)
    if m:
        s = m.group(1).strip("*_`:")
    if s.startswith("./"):
        s = s[2:]
    return s


def find_close(lines, start, fence, markdown):
    """Index of the line that closes a block opened with `fence`, or None if it never closes.

    A Markdown file opened with only three backticks (the prompt asks for four) may contain
    inner blocks such as ```bash ... ```; those are skipped by counting openings that carry
    a language tag.
    """
    ch, n = fence[0], len(fence)
    depth = 0
    for j in range(start, len(lines)):
        s = lines[j].strip()
        if not s.startswith(ch * 3):
            continue
        run = len(s) - len(s.lstrip(ch))
        info = s[run:].strip()
        if not info and run >= n:
            if depth == 0:
                return j
            depth -= 1
        elif markdown and n == 3 and info and ch not in info:
            depth += 1
    return None


class Block(object):
    def __init__(self, path, body, lang, closed):
        self.path = path
        self.content = "\n".join(body).rstrip("\n") + "\n"
        self.lang = lang
        self.closed = closed
        self.ext = os.path.splitext(path)[1].lower()

    def placeholder_line(self):
        if self.ext in MARKDOWN_EXT or self.ext == ".json":
            return None
        pattern = PLACEHOLDER_HASH if self.ext in HASH_COMMENT_EXT else PLACEHOLDER_WEB
        for k, line in enumerate(self.content.split("\n"), 1):
            if pattern.search(line):
                return k, line.strip()[:70]
        return None

    def is_shell(self):
        return self.lang in SHELL_LANGS and self.ext not in SHELL_EXT


def parse(text):
    """Return (blocks with a path, blocks without one) in the order they appear."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks, nopath = [], []
    i = 0
    last_text = ""
    while i < len(lines):
        m = FENCE_RE.match(lines[i])
        if not m:
            if lines[i].strip():
                last_text = lines[i]
            i += 1
            continue
        fence, lang = m.group(2), m.group(3).lower()
        candidate = clean_path_line(last_text)
        is_path = bool(PATH_RE.match(candidate))
        markdown = is_path and os.path.splitext(candidate)[1].lower() in MARKDOWN_EXT
        j = find_close(lines, i + 1, fence, markdown)
        body = lines[i + 1:(j if j is not None else len(lines))]
        if is_path:
            blocks.append(Block(candidate, body, lang, j is not None))
        else:
            nopath.append((last_text.strip()[:60], lang, len(body)))
        last_text = ""
        i = (j + 1) if j is not None else len(lines)
    return blocks, nopath


def safe_target(root, rel):
    if rel.startswith("/") or ".." in rel.split("/"):
        return None
    full = os.path.normpath(os.path.join(root, rel))
    if not full.startswith(os.path.normpath(root) + os.sep):
        return None
    return full


def git(root, *args, **kw):
    return subprocess.run(["git", "-C", root] + list(args), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          universal_newlines=True, **kw)


def commit(root, msg):
    gitignore = os.path.join(root, ".gitignore")
    current = open(gitignore, encoding="utf-8").read() if os.path.exists(gitignore) else ""
    if ".backup/" not in current.split("\n"):
        with open(gitignore, "a", encoding="utf-8") as f:
            f.write(("" if not current or current.endswith("\n") else "\n") + ".backup/\n")
    git(root, "add", "-A", "--", ".", ":!.backup")
    if git(root, "diff", "--cached", "--quiet").returncode == 0:
        print("Nothing new to commit.")
        return
    ident = []
    if not git(root, "config", "user.email").stdout.strip():
        ident = ["-c", "user.name=DeepSeek build", "-c", "user.email=deepseek@localhost"]
    p = subprocess.run(["git", "-C", root] + ident + ["commit", "-q", "-m", msg],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
    if p.returncode == 0:
        print("Committed: %s" % msg)
    else:
        print("git commit failed: %s" % p.stdout.strip()[:300])


def main():
    ap = argparse.ArgumentParser(description="Write the files of a DeepSeek answer to the game folder.",
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("answer", nargs="?", help="file with the answer (default: standard input)")
    ap.add_argument("--root", required=True, help="game folder, created if missing")
    ap.add_argument("--dry-run", action="store_true", help="list the files without writing")
    ap.add_argument("--commit", action="store_true", help="git commit the result if root is a git repo")
    ap.add_argument("--force", action="store_true", help="also write blocks that look partial or much shorter")
    args = ap.parse_args()

    text = open(args.answer, encoding="utf-8").read() if args.answer else sys.stdin.read()
    root = os.path.abspath(os.path.expanduser(args.root))
    blocks, nopath = parse(text)
    if not blocks:
        print("No files found. Each file needs its path on the line before the code block.")
        sys.exit(1)

    chosen, commands = {}, []
    for b in blocks:                  # a later block for the same path wins, unless it was cut off
        if b.is_shell():
            commands.append(b)
        elif b.closed or b.path not in chosen:
            chosen[b.path] = b
    if not chosen:
        print("No files found. Each file needs its path on the line before the code block.")
        sys.exit(1)
    stage = re.findall(r"STAGE\s+([0-9]+[A-Za-z]?)\s+COMPLETE", text)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = os.path.join(root, ".backup", stamp)
    k = 2
    while os.path.exists(backup_dir):
        backup_dir = os.path.join(root, ".backup", "%s-%d" % (stamp, k))
        k += 1
    backed_up = False

    print("%s %d file(s) under %s%s" % ("Checking" if args.dry_run else "Writing", len(chosen), root,
                                        ("  [Stage %s]" % stage[-1]) if stage else ""))
    written, skipped, shrunk = 0, 0, 0
    for rel, b in chosen.items():
        target = safe_target(root, rel)
        if target is None:
            print("  SKIPPED  %-40s unsafe path" % rel)
            skipped += 1
            continue
        exists = os.path.exists(target)
        if not b.closed:
            print("  SKIPPED  %-40s cut off: its code block never closes" % rel)
            skipped += 1
            continue
        hole = b.placeholder_line()
        if hole and exists and not args.force:
            print("  SKIPPED  %-40s looks partial (line %d: %s); existing file kept" % (rel, hole[0], hole[1]))
            skipped += 1
            continue
        if exists and not args.force and b.ext not in MARKDOWN_EXT:
            old_n = sum(1 for _ in open(target, encoding="utf-8", errors="replace"))
            new_n = b.content.count("\n")
            if old_n >= SHRINK_MIN_LINES and new_n < SHRINK_RATIO * old_n:
                print("  SKIPPED  %-40s much shorter than the current file (%d -> %d lines); existing file kept"
                      % (rel, old_n, new_n))
                shrunk += 1
                skipped += 1
                continue
        print("  %-8s %-40s %5d lines" % ("update" if exists else "new", rel, b.content.count("\n")))
        if hole:
            print("           warning: line %d looks like a placeholder: %s" % hole)
        written += 1
        if args.dry_run:
            continue
        if exists:
            dst = os.path.join(backup_dir, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(target, dst)
            backed_up = True
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(b.content)

    if backed_up:
        print("Previous versions saved in %s" % backup_dir)
    for b in commands:
        print("  ignored a %s block after the line %r: a command, not file content" % (b.lang, b.path))
    for label, lang, n in nopath:
        print("  ignored a %d-line %sblock without a file path (after: %r)" % (n, (lang + " ") if lang else "", label))
    if not stage:
        print("Note: no 'STAGE n COMPLETE' marker found; the answer may be cut off.")
    if shrunk:
        print("If a shorter file is intended (code moved elsewhere), write it anyway with:\n"
              "  python3 %s %s --root %s --force --commit"
              % (os.path.abspath(sys.argv[0]), os.path.abspath(args.answer) if args.answer else "<answer file>", root))

    if args.commit and not args.dry_run and written and os.path.isdir(os.path.join(root, ".git")):
        msg = ("Stage %s (DeepSeek)" % stage[-1]) if stage else "DeepSeek update"
        if skipped:
            msg += ", incomplete"
        commit(root, msg)
    sys.exit(3 if skipped else 0)


if __name__ == "__main__":
    main()

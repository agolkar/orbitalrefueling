# Build process

*Claude Opus 5.5 (max) and DeepSeek V4.1 Flash.*

The scripts and the last specification used to build the game with local models. The main
[README](../README.md#how-it-was-made) tells the process; this page lists the files. They document
the method and are not needed to play the game.

| File | What it does |
|---|---|
| `video2brief.py` | Turns a reference video into a written brief: ffmpeg keyframes at the scene cuts, contact sheets, an optional transcript aligned with the frames, frame notes by a vision-language model (default Qwen3.8-27B on an oMLX server), optional clip notes by a model that accepts video, and a synthesis into `brief.md` |
| `ds_stage.py` | Drives the staged build with a coding model (default DeepSeek V4.1 Flash) through an OpenAI-compatible server such as llama-swap: keeps the conversation on disk, streams each answer, writes its files with `apply_stage.py`, runs the tests and commits with git. Commands: `start`, `next`, `say`, `fix`, `continue`, `restart N`, `retry`, `undo`, `status`, `test` |
| `apply_stage.py` | Writes the files of one model answer into the game folder. Refuses truncated code blocks, partial files and paths outside the folder, backs up every file it replaces, optionally commits |
| `prompt_for_deepseek.md` | The specification (master prompt) in its last version, as sent with Stage 6. Earlier versions carried the brief of the reference video and are not published |

Requirements: Python 3 (standard library only), ffmpeg and ffprobe on the path for
`video2brief.py`, local model servers with OpenAI-compatible endpoints (the defaults are
`http://127.0.0.1:8080/v1` for the vision model and `http://127.0.0.1:8100/v1` for the coding
model). Application programming interface (API) keys: `video2brief.py` takes `--key` or
`$OMLX_API_KEY` for the vision model and `--video-key` or `$VIDEO_API_KEY` for the clip model;
`ds_stage.py` reads `$LLAMASWAP_API_KEY` (or `$VIDEO_API_KEY`) or the `apiKeys` entry of the
llama-swap configuration file. The scripts never print the keys.

Typical use:

```
python3 video2brief.py reference.mp4 --context "what the video is about"
python3 ds_stage.py start          # sends prompt_for_deepseek.md: Stage 0
python3 ds_stage.py say @answers.txt
python3 ds_stage.py next           # the next stage
python3 ds_stage.py fix            # sends the failing tests back
```

Each script prints its full help with `--help`.

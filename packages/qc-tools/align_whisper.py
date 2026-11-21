#!/usr/bin/env python3
"""
本地 Whisper 逐词时间戳提取（Apple Silicon / MLX）。

用法:
  .venv-align/bin/python packages/qc-tools/align_whisper.py <audio.wav> [--prompt-file script.txt] [--model repo]

输出 (stdout, JSON):
  {"ok": true, "model": "...", "words": [{"w": "新干线", "s": 12.31, "e": 12.88}, ...]}

只负责"听"出每个词的时间；与文案的逐字对齐在 narration-timing.mjs 中完成。
"""
import argparse
import json
import os
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--prompt-file", default=None)
    ap.add_argument("--language", default="zh")
    ap.add_argument(
        "--model",
        default=os.environ.get("ALIGN_WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo"),
    )
    args = ap.parse_args()

    try:
        import mlx_whisper  # noqa
    except Exception as e:  # pragma: no cover
        print(json.dumps({"ok": False, "error": f"mlx_whisper 未安装: {e}"}, ensure_ascii=False))
        return 2

    prompt = None
    if args.prompt_file and os.path.exists(args.prompt_file):
        with open(args.prompt_file, "r", encoding="utf-8") as f:
            # 用文案开头做提示，让 Whisper 偏向简体中文和正确的专有名词
            prompt = f.read().strip()[:200] or None

    # Whisper 进度条写到 stderr，避免污染 stdout 的 JSON
    result = mlx_whisper.transcribe(
        args.audio,
        path_or_hf_repo=args.model,
        language=args.language,
        word_timestamps=True,
        initial_prompt=prompt,
        condition_on_previous_text=False,
        verbose=None,
    )

    words = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []) or []:
            text = (w.get("word") or "").strip()
            if not text:
                continue
            words.append({"w": text, "s": round(float(w["start"]), 3), "e": round(float(w["end"]), 3)})

    print(json.dumps({"ok": True, "model": args.model, "words": words}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

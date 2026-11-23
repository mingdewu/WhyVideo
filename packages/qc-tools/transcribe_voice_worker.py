#!/usr/bin/env python3
"""
Persistent local MLX Whisper speech-to-text worker (JSON lines over stdio).

Reads newline-delimited JSON requests from stdin and writes JSON responses to stdout.
All library logs and progress bars are redirected to stderr to keep stdout clean.
"""
import os
import sys

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TQDM_DISABLE", "1")

# Capture real stdout for protocol responses before importing MLX/HF libraries.
REAL_STDOUT = sys.stdout
sys.stdout = sys.stderr

import glob
import json
import re
import wave
import numpy as np
import mlx_whisper


DEFAULT_INITIAL_PROMPT = "以下是简体中文视频剪辑指令。"


def emit(payload: dict) -> None:
    """Write one JSON response line to the original stdout."""
    REAL_STDOUT.write(json.dumps(payload, ensure_ascii=False) + "\n")
    REAL_STDOUT.flush()


def resolve_model_path(model_spec: str) -> str:
    """Resolve a HuggingFace repo ID to a cached local snapshot directory if available."""
    if os.path.isdir(model_spec):
        return model_spec

    if "/" in model_spec:
        org, name = model_spec.split("/", 1)
        hub_root = os.path.expanduser(
            f"~/.cache/huggingface/hub/models--{org}--{name}"
        )
        if os.path.isdir(hub_root):
            ref_main = os.path.join(hub_root, "refs", "main")
            if os.path.isfile(ref_main):
                try:
                    with open(ref_main, "r", encoding="utf-8") as f:
                        rev = f.read().strip()
                    if rev:
                        candidate = os.path.join(hub_root, "snapshots", rev)
                        if (
                            os.path.isfile(os.path.join(candidate, "config.json"))
                            and os.path.isfile(os.path.join(candidate, "weights.safetensors"))
                        ):
                            return candidate
                except OSError:
                    pass

            for candidate in sorted(glob.glob(os.path.join(hub_root, "snapshots", "*"))):
                if (
                    os.path.isfile(os.path.join(candidate, "config.json"))
                    and os.path.isfile(os.path.join(candidate, "weights.safetensors"))
                ):
                    return candidate

    return model_spec


def load_wav_mono_f32(wav_path: str) -> tuple[np.ndarray, float]:
    """Load a 16-bit PCM WAV file into a float32 [-1, 1] array and return duration in seconds."""
    with wave.open(wav_path, "rb") as wf:
        nchannels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        nframes = wf.getnframes()
        raw_bytes = wf.readframes(nframes)

    if framerate <= 0:
        raise ValueError(f"Invalid WAV sample rate: {framerate}")
    if sampwidth != 2:
        raise ValueError(f"Expected 16-bit PCM WAV (sampwidth=2), got {sampwidth}")

    duration_sec = nframes / float(framerate)
    pcm = np.frombuffer(raw_bytes, dtype=np.int16)
    if nchannels > 1 and pcm.size > 0:
        pcm = pcm.reshape(-1, nchannels).mean(axis=1)
    samples = pcm.astype(np.float32) / 32768.0
    return samples, duration_sec


def clean_transcript(text: str) -> str:
    """Trim whitespace, remove stray spaces between CJK characters, and clean trailing punctuation."""
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip()
    cleaned = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", cleaned)
    cleaned = cleaned.rstrip("，,")
    if cleaned.endswith("。") and cleaned.count("。") == 1:
        cleaned = cleaned[:-1].rstrip()
    return cleaned


def handle_transcribe(req: dict, resolved_model: str, model_spec: str) -> dict:
    """Process one transcription request and return the response dict."""
    req_id = req.get("id")
    wav_path = str(req.get("wav_path") or "").strip()
    if not wav_path or not os.path.isfile(wav_path):
        return {"id": req_id, "ok": False, "error": f"音频文件不存在: {wav_path}"}

    language = str(req.get("language") or "zh").strip() or "zh"
    req_prompt = str(req.get("prompt") or "").strip()
    initial_prompt = req_prompt if req_prompt else DEFAULT_INITIAL_PROMPT

    samples, duration_sec = load_wav_mono_f32(wav_path)
    rms = float(np.sqrt(np.mean(samples ** 2))) if samples.size > 0 else 0.0

    # Guard against Whisper hallucinations on silence or ultra-short clicks.
    if duration_sec < 0.25 or rms < 0.0025:
        return {
            "id": req_id,
            "ok": True,
            "text": "",
            "silent": True,
            "duration_sec": round(duration_sec, 2),
            "model": model_spec,
        }

    result = mlx_whisper.transcribe(
        samples,
        path_or_hf_repo=resolved_model,
        language=language,
        initial_prompt=initial_prompt,
        condition_on_previous_text=False,
        temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
        no_speech_threshold=0.6,
        compression_ratio_threshold=2.4,
        verbose=None,
    )

    segments = result.get("segments") or []
    if segments:
        kept_parts = []
        for seg in segments:
            if float(seg.get("no_speech_prob", 0.0) or 0.0) > 0.75:
                continue
            seg_text = str(seg.get("text") or "").strip()
            if seg_text:
                kept_parts.append(seg_text)
        raw_text = "".join(kept_parts)
    else:
        raw_text = str(result.get("text") or "")

    cleaned_text = clean_transcript(raw_text)
    return {
        "id": req_id,
        "ok": True,
        "text": cleaned_text,
        "silent": len(cleaned_text) == 0,
        "duration_sec": round(duration_sec, 2),
        "model": model_spec,
    }


def main() -> int:
    model_spec = os.environ.get("ALIGN_WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo")
    resolved_model = resolve_model_path(model_spec)

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            if not isinstance(req, dict):
                continue
            if req.get("cmd") == "shutdown":
                break
            req_id = req.get("id")
            resp = handle_transcribe(req, resolved_model, model_spec)
            emit(resp)
        except Exception as exc:
            emit({"id": req_id, "ok": False, "error": str(exc)})

    return 0


if __name__ == "__main__":
    sys.exit(main())

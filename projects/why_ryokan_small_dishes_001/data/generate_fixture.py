#!/usr/bin/env python3
"""
Fixture generator for `projects/why_ryokan_small_dishes_001/`.
All topic-specific test sentences, timestamps, captions, and placeholder media
for this fixture reside strictly inside this project folder.
"""

import json
import os
import struct
import subprocess
import tempfile
import wave
import zlib

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))

SENTENCES = [
    {
        "sentence_id": "SENT-01",
        "text": "住进传统温泉旅馆，晚餐往往先让人吃惊：桌上摆满十几个小碗、小碟和小火锅。",
        "start_ms": 0,
        "end_ms": 16500,
        "clauses": [
            {
                "scene_id": "SC-001",
                "text": "住进传统温泉旅馆，晚餐往往先让人吃惊：",
                "start_ms": 0,
                "end_ms": 8000,
            },
            {
                "scene_id": "SC-002",
                "text": "桌上摆满十几个小碗、小碟和小火锅。",
                "start_ms": 8000,
                "end_ms": 16500,
            },
        ],
    },
    {
        "sentence_id": "SENT-02",
        "text": "每一份都不多，却像把一顿饭拆成了一场小型展览。",
        "start_ms": 16500,
        "end_ms": 32500,
        "clauses": [
            {
                "scene_id": "SC-003",
                "text": "每一份都不多，",
                "start_ms": 16500,
                "end_ms": 24000,
            },
            {
                "scene_id": "SC-004",
                "text": "却像把一顿饭拆成了一场小型展览。",
                "start_ms": 24000,
                "end_ms": 32500,
            },
        ],
    },
    {
        "sentence_id": "SENT-03",
        "text": "这并不只是为了好看，它同时来自宴席传统、料理节奏和旅馆的服务方式。",
        "start_ms": 32500,
        "end_ms": 48500,
        "clauses": [
            {
                "scene_id": "SC-005",
                "text": "这并不只是为了好看，",
                "start_ms": 32500,
                "end_ms": 40000,
            },
            {
                "scene_id": "SC-006",
                "text": "它同时来自宴席传统、料理节奏和旅馆的服务方式。",
                "start_ms": 40000,
                "end_ms": 48500,
            },
        ],
    },
    {
        "sentence_id": "SENT-04",
        "text": "接下来，我们就从这些小碟子开始，拆开看一顿温泉旅馆晚餐的历史。",
        "start_ms": 48500,
        "end_ms": 64000,
        "clauses": [
            {
                "scene_id": "SC-007",
                "text": "接下来，我们就从这些小碟子开始，",
                "start_ms": 48500,
                "end_ms": 56000,
            },
            {
                "scene_id": "SC-008",
                "text": "拆开看一顿温泉旅馆晚餐的历史。",
                "start_ms": 56000,
                "end_ms": 64000,
            },
        ],
    },
]

TOTAL_DURATION_MS = 64000
SAMPLE_RATE = 22050


def ensure_dirs():
    for rel in [
        "audio",
        "captions",
        "assets/images",
        "assets/video",
        "out",
    ]:
        os.makedirs(os.path.join(PROJECT_DIR, rel), exist_ok=True)


def synthesize_clause_pcm(text: str) -> bytes:
    with tempfile.TemporaryDirectory() as tmpdir:
        aiff_path = os.path.join(tmpdir, "clause.aiff")
        wav_path = os.path.join(tmpdir, "clause.wav")
        try:
            subprocess.run(
                ["say", "-v", "Tingting", "-r", "155", "-o", aiff_path, text],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            subprocess.run(
                [
                    "afconvert",
                    "-f",
                    "WAVE",
                    "-d",
                    f"LEI16@{SAMPLE_RATE}",
                    "-c",
                    "1",
                    aiff_path,
                    wav_path,
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            with wave.open(wav_path, "rb") as wf:
                return wf.readframes(wf.getnframes())
        except Exception:
            num_samples = int(SAMPLE_RATE * 2.5)
            return b"\x00\x00" * num_samples


def build_narration_wav():
    total_samples = int((TOTAL_DURATION_MS / 1000.0) * SAMPLE_RATE)
    buffer = bytearray(total_samples * 2)

    clause_records = []
    for sent in SENTENCES:
        for clause in sent["clauses"]:
            pcm = synthesize_clause_pcm(clause["text"])
            speech_samples = len(pcm) // 2
            speech_duration_ms = round((speech_samples / SAMPLE_RATE) * 1000)

            slot_start_ms = clause["start_ms"]
            slot_end_ms = clause["end_ms"]
            slot_duration_ms = slot_end_ms - slot_start_ms

            lead_in_ms = 350
            max_samples_in_slot = int(
                ((slot_duration_ms - lead_in_ms - 200) / 1000.0) * SAMPLE_RATE
            )
            if speech_samples > max_samples_in_slot and max_samples_in_slot > 0:
                pcm = pcm[: max_samples_in_slot * 2]
                speech_samples = max_samples_in_slot
                speech_duration_ms = round((speech_samples / SAMPLE_RATE) * 1000)

            start_sample = int(((slot_start_ms + lead_in_ms) / 1000.0) * SAMPLE_RATE)
            byte_offset = start_sample * 2
            buffer[byte_offset : byte_offset + len(pcm)] = pcm

            clause_records.append(
                {
                    "scene_id": clause["scene_id"],
                    "sentence_id": sent["sentence_id"],
                    "text": clause["text"],
                    "start_ms": slot_start_ms,
                    "end_ms": slot_end_ms,
                    "duration_ms": slot_duration_ms,
                    "speech_active_start_ms": slot_start_ms + lead_in_ms,
                    "speech_active_end_ms": slot_start_ms
                    + lead_in_ms
                    + speech_duration_ms,
                }
            )

    wav_out = os.path.join(PROJECT_DIR, "audio/narration.wav")
    with wave.open(wav_out, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(bytes(buffer))

    return clause_records


def ms_to_srt_time(ms: int) -> str:
    hrs = ms // 3600000
    rem = ms % 3600000
    mins = rem // 60000
    rem = rem % 60000
    secs = rem // 1000
    millis = rem % 1000
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{millis:03d}"


def write_script_and_timestamps(clause_records):
    final_script = {
        "project_id": "why_ryokan_small_dishes_001",
        "domain_category": "travel_and_culture",
        "title": "为什么日本温泉旅馆的晚餐常常是一小碟一小碟？",
        "language": "zh-CN",
        "total_duration_ms": TOTAL_DURATION_MS,
        "total_duration_sec": TOTAL_DURATION_MS / 1000.0,
        "approved_narration_sentences": [s["text"] for s in SENTENCES],
        "full_narration_text": "".join(s["text"] for s in SENTENCES),
    }
    with open(
        os.path.join(PROJECT_DIR, "final-script.json"), "w", encoding="utf-8"
    ) as f:
        json.dump(final_script, f, ensure_ascii=False, indent=2)

    sentence_timestamps = {
        "project_id": "why_ryokan_small_dishes_001",
        "audio_file": "audio/narration.wav",
        "audio_duration_ms": TOTAL_DURATION_MS,
        "audio_duration_seconds": TOTAL_DURATION_MS / 1000.0,
        "tts_engine": "macOS_say_Tingting_zh_CN_155wpm_with_documentary_pacing",
        "sentences": [
            {
                "sentence_id": s["sentence_id"],
                "text": s["text"],
                "start_ms": s["start_ms"],
                "end_ms": s["end_ms"],
                "duration_ms": s["end_ms"] - s["start_ms"],
            }
            for s in SENTENCES
        ],
        "clause_segments": clause_records,
    }
    with open(
        os.path.join(PROJECT_DIR, "sentence-timestamps.json"), "w", encoding="utf-8"
    ) as f:
        json.dump(sentence_timestamps, f, ensure_ascii=False, indent=2)

    srt_lines = []
    for idx, rec in enumerate(clause_records, start=1):
        srt_lines.append(str(idx))
        srt_lines.append(
            f"{ms_to_srt_time(rec['start_ms'])} --> {ms_to_srt_time(rec['end_ms'])}"
        )
        srt_lines.append(rec["text"])
        srt_lines.append("")

    with open(
        os.path.join(PROJECT_DIR, "captions/captions.srt"), "w", encoding="utf-8"
    ) as f:
        f.write("\n".join(srt_lines))


def create_solid_grid_png(
    filepath: str, width: int, height: int, bg_rgb, accent_rgb, border_rgb
):
    rows = []
    for y in range(height):
        row = bytearray([0])
        is_border = y < 16 or y >= height - 16
        is_grid_y = y % 120 == 0
        is_center_band = (height // 2 - 140) <= y <= (height // 2 + 140)
        for x in range(width):
            if is_border or x < 16 or x >= width - 16:
                r, g, b = border_rgb
            elif is_center_band and (width // 2 - 420 <= x <= width // 2 + 420):
                if y in (height // 2 - 140, height // 2 + 140) or x in (
                    width // 2 - 420,
                    width // 2 + 420,
                ):
                    r, g, b = accent_rgb
                else:
                    r, g, b = (
                        min(255, bg_rgb[0] + 18),
                        min(255, bg_rgb[1] + 22),
                        min(255, bg_rgb[2] + 28),
                    )
            elif is_grid_y or (x % 120 == 0):
                r, g, b = (
                    min(255, bg_rgb[0] + 12),
                    min(255, bg_rgb[1] + 15),
                    min(255, bg_rgb[2] + 20),
                )
            elif (x + y) % 90 == 0:
                r, g, b = accent_rgb
            else:
                r, g, b = bg_rgb
            row.extend((r, g, b))
        rows.append(bytes(row))

    raw_data = b"".join(rows)

    def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(raw_data, level=6)
    png_bytes = (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", idat)
        + png_chunk(b"IEND", b"")
    )
    with open(filepath, "wb") as f:
        f.write(png_bytes)


def generate_placeholder_images():
    create_solid_grid_png(
        os.path.join(PROJECT_DIR, "assets/images/placeholder_kaiseki_trays.png"),
        1920,
        1080,
        bg_rgb=(20, 32, 46),
        accent_rgb=(245, 158, 11),
        border_rgb=(56, 189, 248),
    )
    create_solid_grid_png(
        os.path.join(
            PROJECT_DIR, "assets/images/placeholder_honzen_archive_low_conf.png"
        ),
        1920,
        1080,
        bg_rgb=(42, 28, 22),
        accent_rgb=(239, 68, 68),
        border_rgb=(245, 158, 11),
    )
    create_solid_grid_png(
        os.path.join(PROJECT_DIR, "assets/images/unverified_external_sample.png"),
        1920,
        1080,
        bg_rgb=(50, 20, 20),
        accent_rgb=(255, 80, 80),
        border_rgb=(255, 0, 0),
    )


if __name__ == "__main__":
    ensure_dirs()
    records = build_narration_wav()
    write_script_and_timestamps(records)
    generate_placeholder_images()
    print(f"Fixture generated in {PROJECT_DIR}")

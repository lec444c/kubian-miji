"""Round-3 supplied assets: copy originals, loudness-normalise the four BGM tracks.

Dev-time only. Uses the ffmpeg binary bundled with imageio-ffmpeg (pip) so no
system install is required. Nothing here runs in the browser.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"D:/智器云杯")
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

BGM = [
    "pulsebox-a-background-jazz-music-448453.mp3",
    "pulsebox-a-jazz-background-music-448455.mp3",
    "happinessinmusic-free-lounge-music-478072.mp3",
    "faespencer-background-music-instrumental-207886.mp3",
]
TARGET_I = -16.0
TARGET_TP = -1.5
TARGET_LRA = 11.0


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def run(args: list[str]) -> str:
    result = subprocess.run([FFMPEG, *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-2000:])
    return result.stderr


def measure(path: Path) -> dict:
    log = run(["-i", str(path), "-af",
               f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json",
               "-f", "null", "-"])
    start = log.rfind("{")
    return json.loads(log[start:log.rfind("}") + 1])


def main() -> None:
    source_dir = ROOT / "assets/source/round3"
    source_dir.mkdir(parents=True, exist_ok=True)
    bgm_dir = ROOT / "public/assets/audio/bgm"
    bgm_dir.mkdir(parents=True, exist_ok=True)
    texture_dir = ROOT / "public/assets/textures"
    texture_dir.mkdir(parents=True, exist_ok=True)

    report = []
    for name in ["comfy_cafe_4k.exr", "pool_table_traditional.glb", *BGM]:
        shutil.copy2(SOURCE / name, source_dir / name)

    shutil.copy2(source_dir / "comfy_cafe_4k.exr", texture_dir / "comfy_cafe_4k.exr")
    report.append({
        "id": "comfy-cafe-hdri",
        "original": str(source_dir / "comfy_cafe_4k.exr"),
        "runtime": "public/assets/textures/comfy_cafe_4k.exr",
        "originalSha256": sha256(source_dir / "comfy_cafe_4k.exr"),
        "runtimeSha256": sha256(texture_dir / "comfy_cafe_4k.exr"),
    })
    report.append({
        "id": "pool-table-traditional-source",
        "original": str(source_dir / "pool_table_traditional.glb"),
        "runtime": None,
        "originalSha256": sha256(source_dir / "pool_table_traditional.glb"),
        "note": "Optimised runtime copy is produced by scripts/optimize-table.mjs",
    })

    for index, name in enumerate(BGM, start=1):
        original = source_dir / name
        stats = measure(original)
        output = bgm_dir / f"track-{index}.mp3"
        run(["-y", "-i", str(original), "-af",
             f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}"
             f":measured_I={stats['input_i']}:measured_TP={stats['input_tp']}"
             f":measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}"
             f":offset={stats['target_offset']}:linear=true:print_format=summary",
             "-ar", "44100", "-b:a", "192k", str(output)])
        after = measure(output)
        report.append({
            "id": f"bgm-track-{index}",
            "original": str(original),
            "runtime": f"public/assets/audio/bgm/track-{index}.mp3",
            "originalSha256": sha256(original),
            "runtimeSha256": sha256(output),
            "inputI": stats["input_i"],
            "outputI": after["input_i"],
            "outputTp": after["input_tp"],
        })
        print(f"track-{index}: {stats['input_i']} -> {after['input_i']} LUFS", flush=True)

    (ROOT / "scripts/round3-assets-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("round3 asset report written")


if __name__ == "__main__":
    main()
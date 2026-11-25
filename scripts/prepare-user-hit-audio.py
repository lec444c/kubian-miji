"""Reproduce the two local impact samples from the user-provided recording.

Requires Python 3 and FFmpeg on PATH, --ffmpeg, or the imageio-ffmpeg package.
Does not download tools or audio. The original recording remains unchanged.
"""
from __future__ import annotations

import argparse
from array import array
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import wave

ROOT = Path(__file__).resolve().parent.parent
SOURCE_REL = 'assets/source/user-hit/u_7fupvvf5ym-billiard-pool-hit-371618.mp3'
SOURCE_SHA256 = 'd8c1f7b5866d3ab83ff5fc9f2393b197f76cd915fa7f724ff9a317251309fd85'
RATE = 48000
# Two distinct attacks in the supplied mono recording: the first has a lower
# spectral centroid; the later impact is brighter. Roles are editorial choices,
# not independently authenticated annotations of the original recording.
CLIPS = [
    ('strike', 'public/assets/audio/sfx/cue-strike-user.wav', 0.036, 0.198, -5.0),
    ('collision', 'public/assets/audio/sfx/ball-hit-user.wav', 0.361, 0.534, -8.0),
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ffmpeg_path(override: str | None) -> str:
    if override:
        return override
    found = shutil.which('ffmpeg')
    if found:
        return found
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as error:
        raise SystemExit('FFmpeg is required: supply --ffmpeg /path/to/ffmpeg.') from error


def register_assets(report: dict, report_path: Path) -> None:
    manifest_path = ROOT / 'assets/asset-manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    asset_id = 'user-billiard-hit-371618'
    record = {
        'id': asset_id,
        'name': 'User-supplied billiard recording: cue strike and ball collision edits',
        'author': 'u_7fupvvf5ym (filename token only; actual author not independently verified)',
        'sourceUrl': 'file:///D:/%E6%99%BA%E5%99%A8%E4%BA%91%E6%9D%AF/u_7fupvvf5ym-billiard-pool-hit-371618.mp3',
        'acquiredDate': '2026-11-21',
        'license': 'User-provided attachment; no third-party license evidence supplied',
        'licenseUrl': None,
        'usage': 'Two locally edited impact samples replace cue strike and ball-ball collision playback at the user\'s request.',
        'restrictions': 'Local development authorization does not establish third-party redistribution or commercial rights. No public release clearance is asserted.',
        'status': 'available',
        'licenseEvidence': [],
        'originalPaths': [SOURCE_REL],
        'documentationPaths': [report_path.relative_to(ROOT).as_posix()],
        'outputPaths': [clip['path'] for clip in report['clips']],
        'processing': report,
    }
    manifest['assets'] = [asset for asset in manifest['assets'] if asset['id'] != asset_id] + [record]
    for asset in manifest['assets']:
        if asset['id'] == 'round3-ball-hit':
            asset['usage'] = 'Historical ball-ball collision sample, retained for provenance; superseded in runtime by user-billiard-hit-371618.'
        elif asset['id'] == 'round3-cue-strike':
            asset['usage'] = 'Historical cue strike sample, retained for provenance; superseded in runtime by user-billiard-hit-371618.'
    paths = [SOURCE_REL, report_path.relative_to(ROOT).as_posix(), *record['outputPaths']]
    manifest['files'] = [item for item in manifest['files'] if item['path'] not in paths]
    for relative in paths:
        path = ROOT / relative
        manifest['files'].append({'path': relative, 'bytes': path.stat().st_size, 'sha256': digest(path)})
    manifest['lastAcquiredDate'] = max(manifest.get('lastAcquiredDate', ''), '2026-11-21')
    serialized = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    manifest_path.write_text(serialized, encoding='utf-8')
    (ROOT / 'public/assets/asset-manifest.json').write_text(serialized, encoding='utf-8')


def prepare() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / SOURCE_REL)
    parser.add_argument('--ffmpeg')
    parser.add_argument('--register', action='store_true', help='Synchronize both asset manifests')
    args = parser.parse_args()
    source = args.source.resolve()
    if digest(source) != SOURCE_SHA256:
        raise SystemExit('Input SHA256 differs from the approved user attachment.')
    packaged = ROOT / SOURCE_REL
    packaged.parent.mkdir(parents=True, exist_ok=True)
    if source != packaged.resolve():
        shutil.copyfile(source, packaged)
    ffmpeg = ffmpeg_path(args.ffmpeg)
    decoded = subprocess.run([
        ffmpeg, '-v', 'error', '-i', str(packaged), '-map_metadata', '-1',
        '-ac', '1', '-ar', str(RATE), '-af', 'highpass=f=80', '-f', 'f32le', '-'
    ], check=True, capture_output=True)
    samples = array('f')
    samples.frombytes(decoded.stdout)
    if sys.byteorder != 'little':
        samples.byteswap()
    report = {
        'source': SOURCE_REL,
        'sourceSha256': SOURCE_SHA256,
        'sourceDurationSeconds': len(samples) / RATE,
        'sampleRate': RATE,
        'channels': 1,
        'bitsPerSample': 16,
        'tool': subprocess.run([ffmpeg, '-version'], check=True, capture_output=True,
                               text=True).stdout.splitlines()[0],
        'processing': '80 Hz high-pass; exact frame crop; 1 ms fade-in and 24 ms fade-out; peak normalization; PCM16 WAV',
        'roleAssignment': 'First lower-frequency attack used for cue strike; later brighter attack used for ball collision. The recording has no isolated-stem labels.',
        'clips': [],
    }
    for role, relative, start, end, peak_db in CLIPS:
        first, last = round(start * RATE), round(end * RATE)
        clip = list(samples[first:last])
        if len(clip) != last - first:
            raise SystemExit(f'{role}: source recording is too short')
        for i in range(len(clip)):
            fade_in = min(1.0, i / (round(RATE * .001) - 1))
            fade_out = min(1.0, (len(clip) - 1 - i) / (round(RATE * .024) - 1))
            clip[i] *= fade_in * fade_out
        peak = max(abs(value) for value in clip)
        if not math.isfinite(peak) or peak < .001:
            raise SystemExit(f'{role}: invalid or silent sample')
        gain = (10 ** (peak_db / 20)) / peak
        pcm = array('h', [round(max(-1.0, min(1.0, value * gain)) * 32767) for value in clip])
        peak_pcm = max(abs(value) for value in pcm) / 32768
        rms = math.sqrt(sum((value / 32768) ** 2 for value in pcm) / len(pcm))
        assert pcm[0] == 0 and pcm[-1] == 0
        assert peak_pcm < .99
        if sys.byteorder != 'little':
            pcm.byteswap()
        output = ROOT / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(output), 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(RATE)
            wav.writeframes(pcm.tobytes())
        record = {
            'role': role, 'path': relative, 'sourceStartSeconds': start,
            'sourceEndSeconds': end, 'frames': len(clip),
            'durationSeconds': len(clip) / RATE, 'targetPeakDbFS': peak_db,
            'actualPeakDbFS': round(20 * math.log10(peak_pcm), 4),
            'rmsDbFS': round(20 * math.log10(rms), 4),
            'gainDb': round(20 * math.log10(gain), 4),
            'bytes': output.stat().st_size, 'sha256': digest(output),
        }
        report['clips'].append(record)
    report_path = packaged.parent / 'processing-report.json'
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if args.register:
        register_assets(report, report_path)
    print(json.dumps(report, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    prepare()

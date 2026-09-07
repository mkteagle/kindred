"""Flickr video derivatives; durable originals are never transcoded in place."""
from __future__ import annotations
import asyncio
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile

PART_SECONDS = 540  # Nine minutes leaves headroom below Flickr's playback cutoff.
MAX_BYTES = 950_000_000


def probe(source: Path) -> dict:
    result = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
        'format=duration,size:stream=codec_name,codec_type', '-of', 'json', str(source)],
        check=True, capture_output=True, text=True, timeout=120)
    data = json.loads(result.stdout)
    duration = float(data['format']['duration'])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('Video has no usable duration')
    video = next(s for s in data['streams'] if s['codec_type'] == 'video')
    return {'duration': duration, 'size': source.stat().st_size, 'codec': video['codec_name']}


def part_plan(duration: float) -> list[tuple[float, float]]:
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('Video duration must be finite and positive')
    return [(float(start), min(PART_SECONDS, duration - start))
            for start in range(0, math.ceil(duration), PART_SECONDS)]


def save(path: Path, value: dict):
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def convert(source: Path, destination: Path, start: float, duration: float):
    temporary = destination.with_suffix('.pending.mp4')
    temporary.unlink(missing_ok=True)
    # Bounded video bitrate keeps even a nine-minute part well under 1 GB.
    # Two CPU threads avoid starving the NAS photo indexer and other services.
    command = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', str(start), '-i', str(source), '-t', str(duration),
        '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '0',
        '-vf', "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-maxrate', '10M',
        '-bufsize', '20M', '-threads', '2', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', str(temporary)]
    try:
        subprocess.run(command, check=True)
        info = probe(temporary)
        if info['size'] > MAX_BYTES or info['duration'] >= 600:
            raise ValueError('Converted part exceeds Flickr size or playback limits')
        if abs(info['duration'] - duration) > 2:
            raise ValueError('Converted part duration differs from its source segment')
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


class VideoProcessing(RuntimeError):
    """Accepted upload is still being transcoded remotely."""


class VideoRejected(RuntimeError):
    """Flickr rejected a recorded upload; preserve receipts for investigation."""


async def remote_status(main, flickr_id, creds):
    import urllib.parse
    import httpx
    url = 'https://api.flickr.com/services/rest'
    params = {'method': 'flickr.photos.getInfo', 'photo_id': flickr_id,
              'format': 'json', 'nojsoncallback': '1'}
    signed = main._flickr_oauth_sign(url, params, creds, method='GET')
    authorization = 'OAuth ' + ', '.join(
        f'{key}="{urllib.parse.quote(str(value), "")}"' for key, value in signed.items())
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(url, params=params, headers={'Authorization': authorization})
    response.raise_for_status()
    data = response.json()
    if data.get('stat') != 'ok':
        raise RuntimeError(f"Flickr getInfo {flickr_id}: {data.get('message', 'unknown error')}")
    video = data.get('photo', {}).get('video', {})
    if str(video.get('failed')) == '1':
        return 'failed'
    if (str(video.get('ready')) == '1' and str(video.get('pending')) == '0'
            and str(video.get('failed')) == '0'):
        return 'ready'
    return 'processing'


async def verify_parts(main, manifest_path, manifest, creds, metadata):
    pending, failed = [], []
    for number, part in manifest['parts'].items():
        state = await remote_status(main, part['flickr_id'], creds)
        part['remote_status'] = state
        save(manifest_path, manifest)
        if state == 'failed':
            failed.append(number)
        elif state != 'ready':
            pending.append(number)
        elif not part.get('metadata_applied'):
            if metadata.get('taken_at_unix'):
                await main._flickr_set_dates(part['flickr_id'],
                    int(metadata['taken_at_unix']) + int(part['start']), creds)
            if metadata.get('latitude') is not None and metadata.get('longitude') is not None:
                await main._flickr_set_location(part['flickr_id'], float(metadata['latitude']),
                                                float(metadata['longitude']), creds)
            part['metadata_applied'] = True
            save(manifest_path, manifest)
    if failed:
        raise VideoRejected('Flickr processing failed for parts ' + ', '.join(failed))
    if pending:
        raise VideoProcessing('Flickr is still processing parts ' + ', '.join(pending))


async def mirror(main, photo_id, source, title, description, creds, privacy, metadata=None):
    """Resume numbered uploads and return a copy ID only after ALL parts exist."""
    source = Path(source)
    info = await asyncio.to_thread(probe, source)
    root = Path(os.environ.get('KINDRED_WORKER_DATA', '/app/data')) / 'video-mirrors' / str(photo_id)
    root.mkdir(parents=True, exist_ok=True)
    manifest_path = root / 'manifest.json'
    fingerprint = {'size': source.stat().st_size, 'mtime_ns': source.stat().st_mtime_ns}
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {
        'source': str(source), 'fingerprint': fingerprint, 'parts': {}, 'complete': False}
    if manifest['fingerprint'] != fingerprint:
        raise ValueError('Original changed since video mirroring began; refusing to mix versions')
    parts = part_plan(info['duration'])
    manifest['complete'] = False
    manifest['duration'] = info['duration']
    manifest['part_count'] = len(parts)
    save(manifest_path, manifest)
    for number, (start, duration) in enumerate(parts, 1):
        key = str(number)
        if manifest['parts'].get(key, {}).get('flickr_id'):
            continue
        destination = root / f'part-{number:03d}.mp4'
        if not destination.exists():
            print(f'[video] {source.name}: converting part {number}/{len(parts)}', flush=True)
            await asyncio.to_thread(convert, source, destination, start, duration)
        converted = probe(destination)
        if (converted['size'] > MAX_BYTES or converted['duration'] >= 600
                or abs(converted['duration'] - duration) > 2):
            raise ValueError('Cached video derivative exceeds Flickr limits')
        part_title = title if len(parts) == 1 else f'{title} — Part {number} of {len(parts)}'
        part_description = f'{description}\n\nKindred video copy: part {number}/{len(parts)}, '
        part_description += f'source seconds {start:.3f}–{start + duration:.3f}. Full original retained on NAS.'
        flickr_id = await main._upload_to_flickr(str(destination), destination.name,
            part_title, part_description, creds, privacy=privacy)
        manifest['parts'][key] = {'flickr_id': flickr_id, 'start': start, 'duration': duration,
                                  'bytes': converted['size']}
        save(manifest_path, manifest)
        destination.unlink(missing_ok=True)
        print(f'[video] {source.name}: uploaded part {number}/{len(parts)} as {flickr_id}', flush=True)
    await verify_parts(main, manifest_path, manifest, creds, metadata or {})
    manifest['complete'] = True
    save(manifest_path, manifest)
    return manifest['parts']['1']['flickr_id']

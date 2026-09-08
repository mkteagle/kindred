"""When a photo or video was actually taken, read from the file itself.

Kindred orders, groups and scrubs the whole library by
`COALESCE(photos.taken_at, photos.created_at)`, so a null `taken_at` silently
means "sorted by upload time". Nothing used to read a capture date out of the
bytes: `/photos/upload` took `taken_at_unix` as a client form field, the web
uploader never sent one, and the NAS importers only found a date when a Google
Takeout sidecar happened to sit next to the original. This module is the single
place that answers the question from the file.

── The timezone decision ────────────────────────────────────────────────────
`photos.taken_at` holds **the photographer's local wall clock, labelled UTC.**

EXIF carries no timezone. `DateTimeOriginal` is `2019:04:12 14:30:00` and all
that means is "the clock on the wall said half past two". Kindred buckets the
timeline in SQL — `to_char(COALESCE(taken_at, created_at), 'YYYY-MM')` and
`EXTRACT(YEAR FROM ...)` — which renders in the database session's zone, UTC.
So storing the wall clock verbatim with a `+00:00` offset makes every year,
month and day bucket land on the photographer's own calendar date. Converting
it to a "true" instant instead would shift evening photos into the next day and
morning photos into the previous one, for no gain: the true instant is not
recoverable from a naive EXIF field anyway.

The same rule is applied wherever a source offers a local time:
`com.apple.quicktime.creationdate` on iPhone video is `2019-04-12T14:30:00-0600`
and we keep the `14:30` and drop the `-0600`.

Two sources give only a true UTC instant and no local offset — a Takeout
sidecar's `photoTakenTime.timestamp` epoch, and a container `creation_time`
without a QuickTime local counterpart. Those are stored as they are, and are
therefore off by the capture zone's offset (and, near midnight, by a day). That
is a documented, accepted residual: it is still enormously better than the
upload date, and it is why an embedded local wall clock is always preferred
over an epoch when both exist.

── Source precedence ────────────────────────────────────────────────────────
Images:  EXIF DateTimeOriginal → album folder → Takeout sidecar → filename
         → DateTimeDigitized
         → DateTime
Videos:  QuickTime creationdate → container creation_time → album folder
         → sidecar → filename

`DateTimeDigitized` is when a scan or import happened and `DateTime` is a
last-modified stamp, so both rank below Google's own curated capture time.

── Implausible dates ────────────────────────────────────────────────────────
Anything before the first photograph (1826) or in the future is rejected rather
than stored, and so is each epoch zero a device with a flat clock battery
writes verbatim — 1970-01-01, 1904-01-01, 1980-01-01, 2000-01-01, matched to
the exact second so a real photograph on one of those days survives. A null
falls back to the upload date honestly; a wrong date lies.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import re
import subprocess

# Nicéphore Niépce's view from Le Gras, 1826. Nothing photographic predates it.
FIRST_PHOTOGRAPH = datetime(1826, 1, 1, tzinfo=timezone.utc)
# Clock skew between a camera, a phone and this server is minutes, not days.
FUTURE_TOLERANCE_SECONDS = 24 * 60 * 60
# Epoch zeroes a device with a flat clock battery writes verbatim: Unix,
# QuickTime/HFS and FAT. Each falls inside the window above, so each is
# rejected by value — to the exact second, so a genuine scan dated
# 1970-07-04 or an evening in 1904 is still believed.
CLOCK_SENTINELS = frozenset({
    datetime(1970, 1, 1, tzinfo=timezone.utc),
    datetime(1904, 1, 1, tzinfo=timezone.utc),
    datetime(1980, 1, 1, tzinfo=timezone.utc),
    datetime(2000, 1, 1, tzinfo=timezone.utc),
})

FFPROBE_TIMEOUT = 60

# TIFF/EXIF tag numbers, used rather than names so a dict from Pillow's
# `Image.getexif()` (which is keyed by number) needs no translation table.
DATE_TIME_ORIGINAL = 0x9003
DATE_TIME_DIGITIZED = 0x9004
DATE_TIME = 0x0132
EXIF_IFD = 0x8769
GPS_IFD = 0x8825

GPS_LATITUDE_REF = 1
GPS_LATITUDE = 2
GPS_LONGITUDE_REF = 3
GPS_LONGITUDE = 4

VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".m4p", ".avi", ".wmv", ".mpeg",
                    ".mpg", ".3gp", ".m2ts", ".ogg", ".ogv", ".mkv"}
HEIF_EXTENSIONS = {".heic", ".heif", ".hif", ".avif"}


@dataclass(frozen=True)
class Capture:
    """What one file could tell us. Every field is independently optional."""

    taken_at: datetime | None = None
    taken_at_source: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    location_source: str | None = None
    error: str | None = None

    def or_else(self, other: "Capture") -> "Capture":
        """Fill this capture's gaps from a lower-precedence one."""
        merged = self
        if merged.taken_at is None and other.taken_at is not None:
            merged = replace(merged, taken_at=other.taken_at,
                             taken_at_source=other.taken_at_source)
        if merged.latitude is None and other.latitude is not None:
            merged = replace(merged, latitude=other.latitude, longitude=other.longitude,
                             location_source=other.location_source)
        if merged.error is None and other.error is not None:
            merged = replace(merged, error=other.error)
        return merged


# ── Plausibility ─────────────────────────────────────────────────────────────

def is_plausible(moment: datetime | None, now: datetime | None = None) -> bool:
    """True when a timestamp could belong to a real photograph."""
    if moment is None:
        return False
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    if moment in CLOCK_SENTINELS:
        return False
    horizon = now or datetime.now(timezone.utc)
    if horizon.tzinfo is None:
        horizon = horizon.replace(tzinfo=timezone.utc)
    return FIRST_PHOTOGRAPH <= moment <= horizon + timedelta(seconds=FUTURE_TOLERANCE_SECONDS)


def as_wall_clock(naive: datetime) -> datetime:
    """Label a naive local wall clock as UTC. See the timezone note above."""
    return naive.replace(tzinfo=timezone.utc)


def plausible(moment: datetime | None, now: datetime | None = None) -> datetime | None:
    """The timestamp, or None when it is outside the believable window."""
    return moment if is_plausible(moment, now) else None


# ── Parsers (pure) ───────────────────────────────────────────────────────────

_EXIF_DATE = re.compile(
    r"^\s*(?P<year>\d{4})[:\-/](?P<month>\d{1,2})[:\-/](?P<day>\d{1,2})"
    r"(?:[ T](?P<hour>\d{1,2}):(?P<minute>\d{1,2})(?::(?P<second>\d{1,2}))?)?"
)


def parse_exif_datetime(raw, now: datetime | None = None) -> datetime | None:
    """`2019:04:12 14:30:00` → an aware datetime holding that wall clock.

    Tolerates the dash and slash separators some cameras write, a missing time,
    and trailing subsecond or timezone junk. `0000:00:00 00:00:00` — the
    "unset" value a great many devices write — parses to nothing.
    """
    if isinstance(raw, bytes):
        raw = raw.decode("ascii", "ignore")
    if not isinstance(raw, str):
        return None
    match = _EXIF_DATE.match(raw.replace("\x00", " "))
    if not match:
        return None
    parts = match.groupdict()
    try:
        moment = datetime(
            int(parts["year"]), int(parts["month"]), int(parts["day"]),
            int(parts["hour"] or 0), int(parts["minute"] or 0), int(parts["second"] or 0),
        )
    except ValueError:
        return None
    return plausible(as_wall_clock(moment), now)


def parse_epoch(value, now: datetime | None = None) -> datetime | None:
    """A Unix timestamp (a true instant) as an aware UTC datetime."""
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        return None
    try:
        moment = datetime.fromtimestamp(seconds, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None
    return plausible(moment, now)


_ISO = re.compile(
    r"^\s*(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})[ T]"
    r"(?P<hour>\d{2}):(?P<minute>\d{2}):(?P<second>\d{2})(?:[.,]\d+)?"
    r"\s*(?P<zone>Z|[+-]\d{2}:?\d{2})?\s*$"
)


def parse_iso_datetime(raw, now: datetime | None = None):
    """Split an ISO-8601 stamp into its wall clock and whether a zone was given.

    Returns `(wall_clock, has_offset)`. The wall clock is always the literal
    time in the string, labelled UTC — for `...T14:30:00-0600` that is 14:30,
    which is exactly the local time we want to keep.
    """
    if isinstance(raw, bytes):
        raw = raw.decode("ascii", "ignore")
    if not isinstance(raw, str):
        return None, False
    match = _ISO.match(raw)
    if not match:
        return None, False
    parts = match.groupdict()
    try:
        moment = datetime(
            int(parts["year"]), int(parts["month"]), int(parts["day"]),
            int(parts["hour"]), int(parts["minute"]), int(parts["second"]),
        )
    except ValueError:
        return None, False
    zone = parts["zone"]
    return plausible(as_wall_clock(moment), now), bool(zone and zone not in ("Z", "+00:00", "+0000"))


# Camera and phone naming conventions: IMG_20190412_143000, PXL_20201105_...,
# VID-20190412-WA0001, Screenshot_2019-04-12-14-30-00, 2019-04-12 14.30.00.
_FILENAME_DATE = re.compile(
    r"(?<!\d)(?P<year>19\d{2}|20\d{2})(?P<datesep>[-_.]?)(?P<month>0[1-9]|1[0-2])"
    r"(?P=datesep)(?P<day>0[1-9]|[12]\d|3[01])"
    r"(?:[-_. tT](?P<hour>[01]\d|2[0-3])(?P<timesep>[-_.:]?)(?P<minute>[0-5]\d)"
    r"(?:(?P=timesep)(?P<second>[0-5]\d))?(?:[.,]?\d{1,9})?)?"
    r"(?!\d)"
)


def parse_filename_datetime(name, now: datetime | None = None) -> datetime | None:
    """A capture date encoded in the filename, as a local wall clock.

    Last resort, and only for the well-known camera-app shapes: these names are
    written at the moment of capture, so they survive the EXIF stripping that a
    Takeout export or a messaging app performs. A name that carries only a date
    yields midnight, which still sorts and groups into the right day.
    """
    if not name:
        return None
    match = _FILENAME_DATE.search(str(Path(str(name)).name))
    if not match:
        return None
    parts = match.groupdict()
    try:
        moment = datetime(
            int(parts["year"]), int(parts["month"]), int(parts["day"]),
            int(parts["hour"] or 0), int(parts["minute"] or 0), int(parts["second"] or 0),
        )
    except ValueError:
        return None
    return plausible(as_wall_clock(moment), now)


_FOLDER_DATE = re.compile(
    r"^(?P<year>(?:19|20)\d{2})[.\-_](?P<month>0[1-9]|1[0-2])"
    r"(?:[.\-_](?P<day>0[1-9]|[12]\d|3[01]))?(?:\D|$)"
)

# A folder naming only a year: "2003 CEU Pics", "2003 - 2004 Basketball".
_FOLDER_YEAR = re.compile(r"^(?P<year>(?:19|20)\d{2})(?:\D|$)")


def parse_folder_datetime(folder, now: datetime | None = None) -> datetime | None:
    """A capture date from a human-curated album folder, as a local wall clock.

    This library was organised by hand into folders like
    "2004.03.20 Allison Junior Prom" before it ever reached Google, and those
    names are a person stating when something happened. That outranks a Takeout
    sidecar, because Google's photoTakenTime for a scanned or re-uploaded photo
    is the moment it entered Google Photos, not the moment of the photograph —
    the prom above carries a sidecar reading May 2010.

    A year and month yields the first of that month. A folder naming only a
    year yields the first of January, which is a deliberate choice rather than
    a precise one: the day is invented, but the year is not, and a photo the
    library places in 2003 is far more useful than one it places nowhere. The
    alternative -- refusing the date -- sent every photo in four thousand
    year-named albums to the undated pile at the end of the gallery.

    The invented part is recorded: the source is "folder:year" rather than
    "folder", so anything that cares can tell a stated day from an assumed one.
    """
    if not folder:
        return None
    text = str(folder).strip()
    match = _FOLDER_DATE.match(text)
    if match:
        parts = match.groupdict()
        try:
            moment = datetime(int(parts["year"]), int(parts["month"]), int(parts["day"] or 1))
        except ValueError:
            return None
        return plausible(as_wall_clock(moment), now)

    year_match = _FOLDER_YEAR.match(text)
    if not year_match:
        return None
    try:
        moment = datetime(int(year_match.group("year")), 1, 1)
    except ValueError:
        return None
    return plausible(as_wall_clock(moment), now)


# ── Coordinates ──────────────────────────────────────────────────────────────

def valid_coordinates(latitude, longitude):
    """A usable (lat, lon) pair, or None.

    Exactly (0, 0) is rejected: Null Island is in the Gulf of Guinea and is
    what a zeroed-out GPS block looks like, never where a family photo is from.
    """
    try:
        latitude = float(latitude)
        longitude = float(longitude)
    except (TypeError, ValueError):
        return None
    if latitude != latitude or longitude != longitude:  # NaN
        return None
    if not (-90.0 <= latitude <= 90.0 and -180.0 <= longitude <= 180.0):
        return None
    if latitude == 0.0 and longitude == 0.0:
        return None
    return latitude, longitude


def _degrees(value):
    """A GPS coordinate from EXIF's (degrees, minutes, seconds) rationals."""
    try:
        degrees, minutes, seconds = (float(part) for part in value)
    except (TypeError, ValueError):
        return None
    return degrees + minutes / 60.0 + seconds / 3600.0


def coordinates_from_exif(gps: dict):
    """(lat, lon) from an EXIF GPS IFD keyed by tag number, or None."""
    if not gps:
        return None
    latitude = _degrees(gps.get(GPS_LATITUDE))
    longitude = _degrees(gps.get(GPS_LONGITUDE))
    if latitude is None or longitude is None:
        return None
    if str(gps.get(GPS_LATITUDE_REF, "N")).upper().startswith("S"):
        latitude = -latitude
    if str(gps.get(GPS_LONGITUDE_REF, "E")).upper().startswith("W"):
        longitude = -longitude
    return valid_coordinates(latitude, longitude)


_ISO6709 = re.compile(r"^(?P<lat>[+-]\d{2,6}(?:\.\d+)?)(?P<lon>[+-]\d{3,7}(?:\.\d+)?)")


def parse_iso6709(raw):
    """`+40.7580-073.9855+010.000/` — the QuickTime location tag."""
    if not isinstance(raw, str):
        return None
    match = _ISO6709.match(raw.strip())
    if not match:
        return None
    return valid_coordinates(match.group("lat"), match.group("lon"))


# ── Source readers (pure over already-parsed metadata) ───────────────────────

def capture_from_exif(tags: dict, gps: dict | None = None,
                      now: datetime | None = None) -> tuple:
    """`(primary, secondary)` captures from an EXIF tag dict.

    Split in two because `DateTimeOriginal` outranks a Takeout sidecar while
    `DateTimeDigitized` and `DateTime` do not — the caller interleaves them.
    """
    tags = tags or {}
    location = coordinates_from_exif(gps or {})
    coordinates = dict(latitude=location[0], longitude=location[1],
                       location_source="exif") if location else {}

    original = parse_exif_datetime(tags.get(DATE_TIME_ORIGINAL), now)
    primary = Capture(taken_at=original,
                      taken_at_source="exif:DateTimeOriginal" if original else None,
                      **coordinates)

    secondary = Capture()
    for tag, label in ((DATE_TIME_DIGITIZED, "exif:DateTimeDigitized"),
                       (DATE_TIME, "exif:DateTime")):
        moment = parse_exif_datetime(tags.get(tag), now)
        if moment:
            secondary = Capture(taken_at=moment, taken_at_source=label)
            break
    return primary, secondary


def capture_from_sidecar(data: dict, now: datetime | None = None) -> Capture:
    """Google Takeout's JSON sidecar: a true epoch plus its own geo block."""
    if not isinstance(data, dict):
        return Capture()
    moment = parse_epoch((data.get("photoTakenTime") or {}).get("timestamp"), now)
    geo = data.get("geoData") or data.get("geoDataExif") or {}
    location = valid_coordinates(geo.get("latitude"), geo.get("longitude"))
    return Capture(
        taken_at=moment,
        taken_at_source="sidecar:photoTakenTime" if moment else None,
        latitude=location[0] if location else None,
        longitude=location[1] if location else None,
        location_source="sidecar:geoData" if location else None,
    )


def capture_from_ffprobe(payload: dict, now: datetime | None = None) -> Capture:
    """Container metadata from `ffprobe -show_entries format_tags:stream_tags`.

    `com.apple.quicktime.creationdate` carries the capture zone's own offset,
    so its wall clock is the local time we want. Plain `creation_time` is UTC
    with no way back to local; it is used only when the QuickTime tag is absent.
    """
    tags = {}
    for container in [payload.get("format") or {}] + list(payload.get("streams") or []):
        for key, value in (container.get("tags") or {}).items():
            tags.setdefault(str(key).lower(), value)

    moment = source = None
    quicktime, _ = parse_iso_datetime(tags.get("com.apple.quicktime.creationdate"), now)
    if quicktime:
        moment, source = quicktime, "video:quicktime.creationdate"
    else:
        container_time, has_offset = parse_iso_datetime(tags.get("creation_time"), now)
        if container_time:
            moment = container_time
            source = "video:creation_time" + ("+offset" if has_offset else "")

    location = None
    for key in ("com.apple.quicktime.location.iso6709", "location", "location-eng"):
        location = parse_iso6709(tags.get(key))
        if location:
            break
    return Capture(
        taken_at=moment, taken_at_source=source,
        latitude=location[0] if location else None,
        longitude=location[1] if location else None,
        location_source="video:iso6709" if location else None,
    )


# ── File readers (IO) ────────────────────────────────────────────────────────

def sidecar_for(path: Path) -> Path | None:
    """Find a Google Takeout JSON sidecar, whichever naming this export used.

    Google has shipped several conventions and this library contains the newest
    one — `IMG_0081.JPG.supplemental-metadata.json`. Older exports use
    `IMG_0081.JPG.json`. Google also truncates the whole sidecar name to a fixed
    length, so a long photo name yields `....supplemental-metad.json` and cannot
    be matched exactly; hence the glob.

    Edited copies are a separate trap. Takeout writes `IMG_0081-edited.JPG` with
    no sidecar of its own — the metadata lives with the original — and this
    library is full of them, so fall back to the unedited name.
    """
    path = Path(path)
    names = [path.name]
    stem = path.stem
    for marker in ("-edited", "-EDITED"):
        if stem.endswith(marker):
            names.append(stem[: -len(marker)] + path.suffix)

    for name in names:
        base = path.with_name(name)
        exact = [
            base.with_name(name + ".json"),
            base.with_name(name + ".supplemental-metadata.json"),
            base.with_suffix(".json"),
        ]
        for candidate in exact:
            if candidate.is_file():
                return candidate
        # Truncated supplemental names, e.g. "...supplemental-met.json".
        try:
            matches = sorted(base.parent.glob(f"{name}.supplemental-me*.json"))
        except OSError:
            matches = []
        if matches:
            return matches[0]
    return None


def read_sidecar(path: Path, now: datetime | None = None) -> Capture:
    try:
        return capture_from_sidecar(json.loads(Path(path).read_text(encoding="utf-8")), now)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return Capture(error=f"unreadable sidecar {Path(path).name}: {exc}")


def read_image(path: Path, now: datetime | None = None) -> tuple:
    """`(primary, secondary)` EXIF captures for one image file."""
    path = Path(path)
    try:
        from PIL import Image
        if path.suffix.lower() in HEIF_EXTENSIONS:
            # HEIC is the default iPhone format; Pillow needs the plugin that
            # _upload_to_flickr and index_nas_library already register.
            from pillow_heif import register_heif_opener
            register_heif_opener()
        with Image.open(path) as image:
            exif = image.getexif()
            tags = dict(exif)
            # Pillow keeps the modern date tags in the nested Exif IFD; older
            # writers leave DateTime in the top-level IFD0. Read both.
            try:
                tags.update(dict(exif.get_ifd(EXIF_IFD)))
            except Exception:
                pass
            try:
                gps = dict(exif.get_ifd(GPS_IFD))
            except Exception:
                gps = {}
    except Exception as exc:
        return Capture(error=f"{type(exc).__name__}: {exc}"), Capture()
    return capture_from_exif(tags, gps, now)


def read_video(path: Path, now: datetime | None = None, run=subprocess.run) -> Capture:
    """Container metadata for one video, via the ffprobe already in the image."""
    command = ["ffprobe", "-v", "error", "-print_format", "json",
               "-show_entries", "format_tags:stream_tags", str(path)]
    try:
        completed = run(command, capture_output=True, text=True, timeout=FFPROBE_TIMEOUT)
    except Exception as exc:
        return Capture(error=f"ffprobe unavailable: {type(exc).__name__}: {exc}")
    if completed.returncode != 0:
        return Capture(error=f"ffprobe failed: {(completed.stderr or '').strip()[:300]}")
    try:
        payload = json.loads(completed.stdout or "{}")
    except ValueError as exc:
        return Capture(error=f"ffprobe returned unparseable JSON: {exc}")
    return capture_from_ffprobe(payload, now)


def is_video(path, media_type: str | None = None) -> bool:
    if media_type and media_type.startswith("video/"):
        return True
    return Path(str(path)).suffix.lower() in VIDEO_EXTENSIONS


def extract(path, *, original_filename: str | None = None, media_type: str | None = None,
            sidecar: Path | None = None, allow_filename: bool = True,
            album_folder: str | None = None,
            now: datetime | None = None, run=subprocess.run) -> Capture:
    """Everything the file (and its sidecar) can say about when it was taken.

    `original_filename` matters when `path` is a staging tempfile: the filename
    heuristic and the video/image split both need the name the user's device
    gave the file, not `tmpv3k1x9.jpg`.
    """
    path = Path(path)
    name = original_filename or path.name
    if sidecar is None:
        sidecar = sidecar_for(path)
    sidecar_capture = read_sidecar(sidecar, now) if sidecar else Capture()
    folder_moment = parse_folder_datetime(album_folder, now) if album_folder else None
    # A year-only folder gives a real year and an invented 1 January. Say so,
    # so a later reader can tell a day someone wrote down from one we assumed.
    folder_source = None
    if folder_moment:
        folder_source = "folder:year" if _FOLDER_YEAR.match(str(album_folder).strip()) \
            and not _FOLDER_DATE.match(str(album_folder).strip()) else "folder"
    folder_capture = Capture(taken_at=folder_moment, taken_at_source=folder_source)
    filename_moment = parse_filename_datetime(name, now) if allow_filename else None
    filename_capture = Capture(taken_at=filename_moment,
                               taken_at_source="filename" if filename_moment else None)

    if is_video(name, media_type) or is_video(path):
        embedded = read_video(path, now, run=run)
        return (embedded.or_else(folder_capture)
                        .or_else(sidecar_capture)
                        .or_else(filename_capture))

    primary, secondary = read_image(path, now)
    # The folder sits above the sidecar deliberately: see parse_folder_datetime.
    return (primary.or_else(folder_capture)
                   .or_else(sidecar_capture)
                   .or_else(filename_capture)
                   .or_else(secondary))

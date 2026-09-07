"""Real files in, real dates out.

The parsers are exercised against JPEGs written with actual EXIF blocks and,
where ffmpeg is installed, an actual MP4 with a container creation time —
mocking the decoders would only prove that the mocks agree with each other.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import Mock

import capture_date
from capture_date import (
    Capture, capture_from_exif, capture_from_ffprobe, capture_from_sidecar,
    coordinates_from_exif, extract, is_plausible, parse_folder_datetime, parse_epoch, parse_exif_datetime,
    parse_filename_datetime, parse_iso6709, parse_iso_datetime, read_image,
    read_video, valid_coordinates,
)

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:  # pragma: no cover - the container always has Pillow
    HAS_PILLOW = False

HAS_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
NOW = datetime(2026, 9, 7, tzinfo=timezone.utc)


def utc(*parts):
    return datetime(*parts, tzinfo=timezone.utc)


def write_jpeg_with_exif(path: Path, **tags) -> Path:
    """A 4x4 JPEG carrying whatever EXIF tags the test names.

    Pillow writes the nested Exif IFD for the date tags itself, so this
    exercises the same nesting a real camera produces.
    """
    image = Image.new("RGB", (4, 4), (120, 90, 60))
    exif = image.getexif()
    for tag, value in tags.items():
        if tag == "gps":
            exif.get_ifd(capture_date.GPS_IFD).update(value)
        elif tag == "date_time":
            exif[capture_date.DATE_TIME] = value
        else:
            exif.get_ifd(capture_date.EXIF_IFD)[{
                "original": capture_date.DATE_TIME_ORIGINAL,
                "digitized": capture_date.DATE_TIME_DIGITIZED,
            }[tag]] = value
    image.save(path, exif=exif)
    return path


class PlausibilityTests(unittest.TestCase):
    def test_accepts_an_ordinary_family_photo(self):
        self.assertTrue(is_plausible(utc(2019, 4, 12, 14, 30), now=NOW))

    def test_rejects_the_epoch_zeroes_a_dead_battery_emits(self):
        for sentinel in (utc(1970, 1, 1), utc(1904, 1, 1), utc(1980, 1, 1)):
            self.assertFalse(is_plausible(sentinel, now=NOW), sentinel)

    def test_believes_a_real_photograph_taken_on_a_sentinel_day(self):
        # Rejection is by exact instant, not by date, so a scan a family dated
        # to the afternoon of 1 January 1970 is still kept.
        self.assertTrue(is_plausible(utc(1970, 1, 1, 14, 30), now=NOW))

    def test_rejects_the_2036_rollover_as_a_future_date(self):
        self.assertFalse(is_plausible(utc(2036, 2, 7), now=NOW))

    def test_rejects_the_future_but_tolerates_small_clock_skew(self):
        self.assertFalse(is_plausible(utc(2027, 1, 1), now=NOW))
        self.assertTrue(is_plausible(utc(2026, 9, 7, 6), now=NOW))

    def test_accepts_the_earliest_photograph_and_nothing_before_it(self):
        self.assertTrue(is_plausible(utc(1826, 1, 1), now=NOW))
        self.assertFalse(is_plausible(utc(1825, 12, 31), now=NOW))

    def test_none_is_never_plausible(self):
        self.assertFalse(is_plausible(None, now=NOW))


class ExifDateParsingTests(unittest.TestCase):
    def test_keeps_the_wall_clock_and_labels_it_utc(self):
        # The timezone decision: 14:30 on the camera stays 14:30, tagged +00:00,
        # so SQL's to_char(...) buckets it on the photographer's own day.
        self.assertEqual(parse_exif_datetime("2019:04:12 14:30:00", NOW),
                         utc(2019, 4, 12, 14, 30))

    def test_never_shifts_an_evening_photo_into_the_next_day(self):
        moment = parse_exif_datetime("2019:04:12 23:45:00", NOW)
        self.assertEqual(moment.strftime("%Y-%m-%d"), "2019-04-12")

    def test_tolerates_dashes_a_missing_time_and_trailing_junk(self):
        self.assertEqual(parse_exif_datetime("2019-04-12", NOW), utc(2019, 4, 12))
        self.assertEqual(parse_exif_datetime("2019:04:12 14:30:00.250+02:00", NOW),
                         utc(2019, 4, 12, 14, 30))

    def test_the_unset_value_devices_write_yields_nothing(self):
        self.assertIsNone(parse_exif_datetime("0000:00:00 00:00:00", NOW))

    def test_implausible_exif_is_rejected_rather_than_stored(self):
        self.assertIsNone(parse_exif_datetime("1970:01:01 00:00:00", NOW))
        self.assertIsNone(parse_exif_datetime("2036:02:07 06:28:16", NOW))

    def test_garbage_and_wrong_types_are_not_fatal(self):
        for value in (None, 17, b"\x00\x00", "not a date", "2019:13:45 99:99:99"):
            self.assertIsNone(parse_exif_datetime(value, NOW))


class EpochAndIsoTests(unittest.TestCase):
    def test_sidecar_epoch_is_a_true_instant(self):
        self.assertEqual(parse_epoch("1555079400", NOW), utc(2019, 4, 12, 14, 30))

    def test_implausible_epochs_are_rejected(self):
        self.assertIsNone(parse_epoch(0, NOW))
        self.assertIsNone(parse_epoch(99999999999, NOW))
        self.assertIsNone(parse_epoch("not a number", NOW))

    def test_iso_with_a_zone_keeps_the_local_wall_clock(self):
        moment, has_offset = parse_iso_datetime("2019-04-12T14:30:00-0600", NOW)
        self.assertEqual(moment, utc(2019, 4, 12, 14, 30))
        self.assertTrue(has_offset)

    def test_iso_in_utc_reports_no_local_offset(self):
        moment, has_offset = parse_iso_datetime("2019-04-12T20:30:00.000000Z", NOW)
        self.assertEqual(moment, utc(2019, 4, 12, 20, 30))
        self.assertFalse(has_offset)


class FilenameTests(unittest.TestCase):
    def test_reads_the_camera_app_conventions(self):
        for name, expected in (
            ("IMG_20190412_143000.jpg", utc(2019, 4, 12, 14, 30, 0)),
            ("PXL_20201105_123456789.jpg", utc(2020, 11, 5, 12, 34, 56)),
            ("VID-20190412-WA0001.mp4", utc(2019, 4, 12)),
            ("Screenshot_2019-04-12-14-30-00.png", utc(2019, 4, 12, 14, 30)),
            ("2019-04-12 14.30.00.jpeg", utc(2019, 4, 12, 14, 30)),
        ):
            self.assertEqual(parse_filename_datetime(name, NOW), expected, name)

    def test_ignores_names_without_a_real_date(self):
        for name in ("IMG_1234.jpg", "DSC00019.JPG", "99999999.png", "", None,
                     "IMG_20191345_000000.jpg"):
            self.assertIsNone(parse_filename_datetime(name, NOW))

    def test_a_filename_date_in_the_future_is_still_rejected(self):
        self.assertIsNone(parse_filename_datetime("IMG_20991231_120000.jpg", NOW))


class CoordinateTests(unittest.TestCase):
    def test_converts_degrees_minutes_seconds_with_hemisphere_refs(self):
        gps = {1: "N", 2: (40.0, 45.0, 28.8), 3: "W", 4: (73.0, 59.0, 7.8)}
        latitude, longitude = coordinates_from_exif(gps)
        self.assertAlmostEqual(latitude, 40.7580, places=3)
        self.assertAlmostEqual(longitude, -73.9855, places=3)

    def test_rejects_null_island_and_out_of_range_values(self):
        self.assertIsNone(valid_coordinates(0, 0))
        self.assertIsNone(valid_coordinates(91, 10))
        self.assertIsNone(valid_coordinates(10, 181))
        self.assertIsNone(valid_coordinates(None, None))

    def test_parses_the_quicktime_iso6709_tag(self):
        latitude, longitude = parse_iso6709("+40.7580-073.9855+010.000/")
        self.assertAlmostEqual(latitude, 40.7580)
        self.assertAlmostEqual(longitude, -73.9855)
        self.assertIsNone(parse_iso6709("not a location"))


class PrecedenceTests(unittest.TestCase):
    def test_date_time_original_outranks_a_sidecar_epoch(self):
        primary, secondary = capture_from_exif(
            {capture_date.DATE_TIME_ORIGINAL: "2019:04:12 14:30:00"}, {}, NOW)
        sidecar = capture_from_sidecar(
            {"photoTakenTime": {"timestamp": "1555079400"}}, NOW)
        merged = primary.or_else(sidecar).or_else(secondary)
        self.assertEqual(merged.taken_at, utc(2019, 4, 12, 14, 30))
        self.assertEqual(merged.taken_at_source, "exif:DateTimeOriginal")

    def test_a_sidecar_outranks_date_time_digitized(self):
        primary, secondary = capture_from_exif(
            {capture_date.DATE_TIME_DIGITIZED: "2021:01:01 09:00:00"}, {}, NOW)
        sidecar = capture_from_sidecar(
            {"photoTakenTime": {"timestamp": "1555079400"}}, NOW)
        merged = primary.or_else(sidecar).or_else(secondary)
        self.assertEqual(merged.taken_at_source, "sidecar:photoTakenTime")

    def test_date_time_falls_through_when_nothing_better_exists(self):
        primary, secondary = capture_from_exif(
            {capture_date.DATE_TIME: "2019:04:12 14:30:00"}, {}, NOW)
        merged = primary.or_else(Capture()).or_else(secondary)
        self.assertEqual(merged.taken_at_source, "exif:DateTime")

    def test_gps_survives_a_merge_that_takes_its_date_elsewhere(self):
        primary, _ = capture_from_exif(
            {}, {1: "N", 2: (40.0, 0.0, 0.0), 3: "W", 4: (73.0, 0.0, 0.0)}, NOW)
        sidecar = capture_from_sidecar(
            {"photoTakenTime": {"timestamp": "1555079400"}}, NOW)
        merged = primary.or_else(sidecar)
        self.assertEqual(merged.taken_at_source, "sidecar:photoTakenTime")
        self.assertAlmostEqual(merged.latitude, 40.0)
        self.assertEqual(merged.location_source, "exif")


class FfprobeTests(unittest.TestCase):
    def test_quicktime_local_creationdate_wins_over_utc_creation_time(self):
        capture = capture_from_ffprobe({"format": {"tags": {
            "creation_time": "2019-04-12T20:30:00.000000Z",
            "com.apple.quicktime.creationdate": "2019-04-12T14:30:00-0600",
        }}}, NOW)
        self.assertEqual(capture.taken_at, utc(2019, 4, 12, 14, 30))
        self.assertEqual(capture.taken_at_source, "video:quicktime.creationdate")

    def test_falls_back_to_container_creation_time(self):
        capture = capture_from_ffprobe(
            {"format": {"tags": {"creation_time": "2019-04-12T20:30:00.000000Z"}}}, NOW)
        self.assertEqual(capture.taken_at, utc(2019, 4, 12, 20, 30))
        self.assertEqual(capture.taken_at_source, "video:creation_time")

    def test_reads_a_stream_tag_when_the_container_has_none(self):
        capture = capture_from_ffprobe({"format": {"tags": {}}, "streams": [
            {"tags": {"creation_time": "2019-04-12T20:30:00Z"}}]}, NOW)
        self.assertEqual(capture.taken_at, utc(2019, 4, 12, 20, 30))

    def test_reads_the_quicktime_location_tag(self):
        capture = capture_from_ffprobe({"format": {"tags": {
            "com.apple.quicktime.location.ISO6709": "+40.7580-073.9855/"}}}, NOW)
        self.assertAlmostEqual(capture.latitude, 40.7580)
        self.assertEqual(capture.location_source, "video:iso6709")

    def test_an_empty_container_yields_nothing_rather_than_raising(self):
        self.assertIsNone(capture_from_ffprobe({}, NOW).taken_at)

    def test_a_failing_ffprobe_is_recorded_not_raised(self):
        run = Mock(return_value=subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="moov atom not found"))
        capture = read_video(Path("/broken.mov"), NOW, run=run)
        self.assertIsNone(capture.taken_at)
        self.assertIn("moov atom", capture.error)

    def test_a_missing_ffprobe_binary_is_recorded_not_raised(self):
        run = Mock(side_effect=FileNotFoundError("ffprobe"))
        self.assertIn("ffprobe unavailable", read_video(Path("/x.mov"), NOW, run=run).error)


@unittest.skipUnless(HAS_PILLOW, "Pillow is required to write EXIF fixtures")
class RealImageFileTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.addCleanup(self.directory.cleanup)

    def test_reads_date_time_original_out_of_a_real_jpeg(self):
        path = write_jpeg_with_exif(self.root / "IMG_0001.jpg",
                                    original="2019:04:12 14:30:00")
        capture = extract(path, now=NOW)
        self.assertEqual(capture.taken_at, utc(2019, 4, 12, 14, 30))
        self.assertEqual(capture.taken_at_source, "exif:DateTimeOriginal")

    def test_reads_gps_out_of_a_real_jpeg_in_the_same_pass(self):
        path = write_jpeg_with_exif(
            self.root / "IMG_0002.jpg", original="2019:04:12 14:30:00",
            gps={1: "N", 2: (40.0, 45.0, 28.8), 3: "W", 4: (73.0, 59.0, 7.8)})
        capture = extract(path, now=NOW)
        self.assertAlmostEqual(capture.latitude, 40.7580, places=3)
        self.assertAlmostEqual(capture.longitude, -73.9855, places=3)

    def test_a_dead_battery_date_in_a_real_jpeg_is_left_null(self):
        path = write_jpeg_with_exif(self.root / "IMG_0003.jpg",
                                    original="1970:01:01 00:00:00")
        self.assertIsNone(extract(path, allow_filename=False, now=NOW).taken_at)

    def test_a_stripped_jpeg_falls_through_to_its_takeout_sidecar(self):
        path = self.root / "IMG_0004.jpg"
        Image.new("RGB", (4, 4)).save(path)
        (self.root / "IMG_0004.jpg.json").write_text(json.dumps({
            "photoTakenTime": {"timestamp": "1555079400"},
            "geoData": {"latitude": 40.1, "longitude": -111.7},
        }))
        capture = extract(path, now=NOW)
        self.assertEqual(capture.taken_at, utc(2019, 4, 12, 14, 30))
        self.assertEqual(capture.taken_at_source, "sidecar:photoTakenTime")
        self.assertAlmostEqual(capture.latitude, 40.1)

    def test_a_stripped_jpeg_with_no_sidecar_falls_through_to_its_name(self):
        path = self.root / "tmp7x1a9b.jpg"
        Image.new("RGB", (4, 4)).save(path)
        capture = extract(path, original_filename="IMG_20190412_143000.jpg", now=NOW)
        self.assertEqual(capture.taken_at, utc(2019, 4, 12, 14, 30))
        self.assertEqual(capture.taken_at_source, "filename")

    def test_a_bare_jpeg_with_nothing_to_say_returns_no_date(self):
        path = self.root / "DSC00019.jpg"
        Image.new("RGB", (4, 4)).save(path)
        self.assertIsNone(extract(path, now=NOW).taken_at)

    def test_an_unreadable_file_is_reported_and_never_fatal(self):
        path = self.root / "IMG_20190412_143000.jpg"
        path.write_bytes(b"this is not an image")
        capture = extract(path, now=NOW)
        self.assertIsNotNone(capture.error)
        # A corrupt file still sorts correctly if its name carries the date.
        self.assertEqual(capture.taken_at, utc(2019, 4, 12, 14, 30))

    def test_a_missing_file_is_reported_and_never_fatal(self):
        capture = extract(self.root / "gone.jpg", now=NOW)
        self.assertIsNone(capture.taken_at)
        self.assertIn("FileNotFoundError", capture.error)

    def test_exif_beats_the_filename_when_both_are_present(self):
        path = write_jpeg_with_exif(self.root / "IMG_20200101_090000.jpg",
                                    original="2019:04:12 14:30:00")
        self.assertEqual(extract(path, now=NOW).taken_at, utc(2019, 4, 12, 14, 30))


@unittest.skipUnless(HAS_FFMPEG, "ffmpeg and ffprobe are required")
class RealVideoFileTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.addCleanup(self.directory.cleanup)

    def encode(self, name, *metadata):
        path = self.root / name
        command = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
                   "-i", "testsrc=duration=1:size=64x64:rate=5",
                   "-c:v", "libx264", "-pix_fmt", "yuv420p"]
        for entry in metadata:
            command += ["-metadata", entry]
        command.append(str(path))
        subprocess.run(command, check=True, capture_output=True, timeout=120)
        return path

    def test_reads_creation_time_out_of_a_real_mp4(self):
        path = self.encode("clip.mp4", "creation_time=2019-04-12T20:30:00.000000Z")
        capture = extract(path, now=NOW)
        self.assertEqual(capture.taken_at, utc(2019, 4, 12, 20, 30))
        self.assertEqual(capture.taken_at_source, "video:creation_time")

    def test_a_video_with_no_creation_time_falls_through_to_its_name(self):
        path = self.encode("VID_20190412_143000.mp4")
        self.assertEqual(extract(path, now=NOW).taken_at, utc(2019, 4, 12, 14, 30))

    def test_a_truncated_video_is_reported_and_never_fatal(self):
        path = self.root / "broken.mp4"
        path.write_bytes(b"\x00" * 64)
        capture = extract(path, now=NOW)
        self.assertIsNone(capture.taken_at)
        self.assertIsNotNone(capture.error)


if __name__ == "__main__":
    unittest.main()


class AlbumFolderDateTests(unittest.TestCase):
    """This library was curated by hand into dated folders before it ever
    reached Google, and those names beat Google's own guess."""

    def test_reads_the_shapes_this_library_actually_uses(self):
        for folder, expected in [
            ("2004.03.20 Allison Junior Prom", datetime(2004, 3, 20)),
            ("2004.10.20 - Austin_s Birthday Party", datetime(2004, 10, 20)),
            ("2004.09.06 Labor Day Fishing", datetime(2004, 9, 6)),
            ("2019-07-15 Beach", datetime(2019, 7, 15)),
            ("2011_05_02 Something", datetime(2011, 5, 2)),
        ]:
            got = parse_folder_datetime(folder)
            self.assertIsNotNone(got, folder)
            self.assertEqual(got.replace(tzinfo=None), expected, folder)

    def test_a_year_and_month_groups_to_the_first_of_that_month(self):
        got = parse_folder_datetime("2004.03 Allison Hyde Park Princess Pageant")
        self.assertEqual(got.replace(tzinfo=None), datetime(2004, 3, 1))

    def test_a_bare_year_is_refused(self):
        # "2004" alone would date everything to 1 January, which sorts worse
        # than admitting the date is unknown.
        self.assertIsNone(parse_folder_datetime("2004"))
        self.assertIsNone(parse_folder_datetime("2004 Family"))

    def test_undated_and_nonsense_folders_yield_nothing(self):
        for folder in ("Halloween", "", None, "Dusty 10", "9999.99.99 x", "2004.13.01 x"):
            self.assertIsNone(parse_folder_datetime(folder))

    def test_the_date_must_lead_the_name(self):
        # A number inside a title is not a date for the whole folder.
        self.assertIsNone(parse_folder_datetime("Trip 2004.03.20"))

    def test_a_folder_date_is_stored_as_a_wall_clock_like_every_other_source(self):
        got = parse_folder_datetime("2004.03.20 Prom")
        self.assertEqual(got.tzinfo, timezone.utc)
        self.assertEqual(got.hour, 0)

    def test_implausible_folder_dates_are_rejected(self):
        self.assertIsNone(parse_folder_datetime("2099.01.01 Future"))


class FolderBeatsSidecarTests(unittest.TestCase):
    """The case that motivated this: a scanned 2004 prom photo whose Google
    sidecar claims 2010, because that is when it reached Google Photos."""

    def _photo_without_exif(self, directory):
        from PIL import Image
        path = Path(directory) / "IMG_0081.JPG"
        Image.new("RGB", (8, 8), "red").save(path, "JPEG")
        return path

    def _sidecar(self, path, epoch):
        sidecar = path.with_name(path.name + ".supplemental-metadata.json")
        sidecar.write_text(json.dumps({
            "title": path.name,
            "photoTakenTime": {"timestamp": str(epoch)},
        }), encoding="utf-8")
        return sidecar

    def test_the_folder_wins_when_the_file_has_no_embedded_date(self):
        with tempfile.TemporaryDirectory() as directory:
            photo = self._photo_without_exif(directory)
            self._sidecar(photo, 1272699054)  # May 2010, Google's guess

            capture = extract(photo, album_folder="2004.03.20 Allison Junior Prom")

            self.assertEqual(capture.taken_at_source, "folder")
            self.assertEqual(capture.taken_at.year, 2004)
            self.assertEqual(capture.taken_at.month, 3)
            self.assertEqual(capture.taken_at.day, 20)

    def test_without_a_folder_the_sidecar_is_still_used(self):
        with tempfile.TemporaryDirectory() as directory:
            photo = self._photo_without_exif(directory)
            self._sidecar(photo, 1272699054)

            capture = extract(photo)

            self.assertEqual(capture.taken_at_source, "sidecar:photoTakenTime")
            self.assertEqual(capture.taken_at.year, 2010)

    def test_an_embedded_exif_date_still_outranks_the_folder(self):
        # A camera's own observation beats a human's folder label.
        with tempfile.TemporaryDirectory() as directory:
            from PIL import Image
            import piexif
            path = Path(directory) / "IMG_1.JPG"
            Image.new("RGB", (8, 8), "blue").save(path, "JPEG")
            exif = {"Exif": {piexif.ExifIFD.DateTimeOriginal: b"2015:06:01 10:00:00"}}
            piexif.insert(piexif.dump(exif), str(path))

            capture = extract(path, album_folder="2004.03.20 Prom")

            self.assertEqual(capture.taken_at.year, 2015)


class SidecarNamingTests(unittest.TestCase):
    """Google has shipped several sidecar naming conventions; this library uses
    the newest, and is full of -edited copies that carry no sidecar at all."""

    def _photo(self, directory, name="IMG_0081.JPG"):
        from PIL import Image
        path = Path(directory) / name
        Image.new("RGB", (8, 8), "red").save(path, "JPEG")
        return path

    def _write(self, directory, name, epoch=1272699054):
        (Path(directory) / name).write_text(json.dumps(
            {"photoTakenTime": {"timestamp": str(epoch)}}), encoding="utf-8")

    def test_finds_the_supplemental_metadata_name_this_export_uses(self):
        with tempfile.TemporaryDirectory() as d:
            photo = self._photo(d)
            self._write(d, "IMG_0081.JPG.supplemental-metadata.json")
            self.assertEqual(extract(photo).taken_at_source, "sidecar:photoTakenTime")

    def test_still_finds_the_older_plain_name(self):
        with tempfile.TemporaryDirectory() as d:
            photo = self._photo(d)
            self._write(d, "IMG_0081.JPG.json")
            self.assertEqual(extract(photo).taken_at_source, "sidecar:photoTakenTime")

    def test_finds_a_truncated_supplemental_name(self):
        # Google truncates the sidecar name, so an exact match can never work.
        with tempfile.TemporaryDirectory() as d:
            photo = self._photo(d)
            self._write(d, "IMG_0081.JPG.supplemental-met.json")
            self.assertEqual(extract(photo).taken_at_source, "sidecar:photoTakenTime")

    def test_an_edited_copy_falls_back_to_the_originals_sidecar(self):
        # This library is full of "-edited" copies, and Takeout gives them none.
        with tempfile.TemporaryDirectory() as d:
            edited = self._photo(d, "IMG_5310-edited.JPG")
            self._write(d, "IMG_5310.JPG.supplemental-metadata.json")
            self.assertEqual(extract(edited).taken_at_source, "sidecar:photoTakenTime")

    def test_no_sidecar_at_all_is_not_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            capture = extract(self._photo(d))
            self.assertIsNone(capture.taken_at)
            self.assertIsNone(capture.error)

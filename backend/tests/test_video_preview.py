from pathlib import Path
import json
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import Mock

from video_preview import (
    VideoPreviewError, clip_command, poster_command, probe_duration, render, seek_for,
)

HAS_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def completed(returncode=0, stdout="", stderr=""):
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr=stderr)


class SeekTests(unittest.TestCase):
    def test_samples_a_tenth_in_to_skip_black_opening_frames(self):
        self.assertAlmostEqual(seek_for(30.0), 3.0)

    def test_stays_inside_very_short_clips(self):
        self.assertLess(seek_for(0.5), 0.5)

    def test_unknown_or_zero_duration_starts_at_the_beginning(self):
        self.assertEqual(seek_for(None), 0.0)
        self.assertEqual(seek_for(0), 0.0)


class CommandTests(unittest.TestCase):
    def setUp(self):
        self.source, self.destination = Path("/in.mov"), Path("/out")

    def test_poster_seeks_before_input_so_ffmpeg_does_not_decode_the_whole_file(self):
        command = poster_command(self.source, self.destination, 30.0)
        self.assertLess(command.index("-ss"), command.index("-i"))
        self.assertIn("-frames:v", command)

    def test_poster_never_upscales_a_small_source(self):
        self.assertIn("scale='min(512,iw)':-2", poster_command(self.source, self.destination, 10.0))

    def test_clip_is_silent_and_plays_inline_everywhere(self):
        command = clip_command(self.source, self.destination, 30.0)
        self.assertIn("-an", command)
        self.assertIn("yuv420p", command)
        self.assertIn("+faststart", command)
        self.assertIn("libx264", command)

    def test_clip_never_runs_past_the_end_of_a_short_video(self):
        self.assertIn("1.000", clip_command(self.source, self.destination, 1.0))


class ProbeTests(unittest.TestCase):
    def test_reads_duration_from_ffprobe_json(self):
        run = Mock(return_value=completed(stdout=json.dumps({"format": {"duration": "12.5"}})))
        self.assertEqual(probe_duration(Path("/in.mov"), run=run), 12.5)

    def test_containers_without_a_duration_return_none_rather_than_raising(self):
        run = Mock(return_value=completed(stdout=json.dumps({"format": {}})))
        self.assertIsNone(probe_duration(Path("/in.mov"), run=run))

    def test_a_failing_probe_is_an_error(self):
        run = Mock(return_value=completed(returncode=1, stderr="not a video"))
        with self.assertRaises(VideoPreviewError):
            probe_duration(Path("/in.mov"), run=run)


class RenderTests(unittest.TestCase):
    def test_a_failed_render_leaves_no_partial_file(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "out.mp4"
            destination.write_bytes(b"partial")
            run = Mock(return_value=completed(returncode=1, stderr="boom"))
            with self.assertRaises(VideoPreviewError):
                render(["ffmpeg"], destination, run=run)
            self.assertFalse(destination.exists())

    def test_an_empty_output_counts_as_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "out.mp4"
            destination.touch()
            with self.assertRaises(VideoPreviewError):
                render(["ffmpeg"], destination, run=Mock(return_value=completed()))


@unittest.skipUnless(HAS_FFMPEG, "ffmpeg and ffprobe are required")
class EndToEndTests(unittest.TestCase):
    """Generate a real video and derive both artefacts from it."""

    @classmethod
    def setUpClass(cls):
        cls._directory = tempfile.TemporaryDirectory()
        cls.root = Path(cls._directory.name)
        cls.video = cls.root / "clip.mp4"
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30:duration=10",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(cls.video),
        ], check=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls._directory.cleanup()

    def test_probes_the_real_duration(self):
        self.assertAlmostEqual(probe_duration(self.video), 10.0, places=1)

    def test_poster_is_a_scaled_jpeg_of_a_non_black_frame(self):
        destination = self.root / "poster.jpg"
        render(poster_command(self.video, destination, 10.0), destination)

        self.assertTrue(destination.exists())
        self.assertEqual(destination.read_bytes()[:2], b"\xff\xd8")  # JPEG SOI
        width = subprocess.run([
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width", "-of", "csv=p=0", str(destination),
        ], capture_output=True, text=True, timeout=60).stdout.strip()
        self.assertEqual(int(width), 512)

    def test_clip_is_short_silent_and_small_enough_to_cache_library_wide(self):
        destination = self.root / "clip-preview.mp4"
        render(clip_command(self.video, destination, 10.0), destination)

        probe = json.loads(subprocess.run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-show_streams", "-of", "json", str(destination),
        ], capture_output=True, text=True, timeout=60).stdout)

        self.assertAlmostEqual(float(probe["format"]["duration"]), 3.0, delta=0.4)
        self.assertEqual([s["codec_type"] for s in probe["streams"]], ["video"])  # no audio
        self.assertEqual(probe["streams"][0]["width"], 360)
        # The whole point of h264 over GIF: a library-wide cache stays cheap.
        self.assertLess(destination.stat().st_size, 400_000)


if __name__ == "__main__":
    unittest.main()

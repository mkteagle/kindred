from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from range_response import InvalidRange, content_range, iter_file_range, parse_range


class ParseRangeTests(unittest.TestCase):
    SIZE = 1000

    def test_no_header_means_send_the_whole_file(self):
        self.assertIsNone(parse_range(None, self.SIZE))
        self.assertIsNone(parse_range("", self.SIZE))

    def test_open_ended_range_is_what_a_player_opens_with(self):
        # Every <video> starts with exactly this.
        self.assertEqual(parse_range("bytes=0-", self.SIZE), (0, 999))

    def test_closed_range_is_a_seek(self):
        self.assertEqual(parse_range("bytes=200-499", self.SIZE), (200, 499))

    def test_suffix_range_asks_for_the_tail(self):
        self.assertEqual(parse_range("bytes=-500", self.SIZE), (500, 999))

    def test_a_tail_longer_than_the_file_clamps_to_the_start(self):
        self.assertEqual(parse_range("bytes=-5000", self.SIZE), (0, 999))

    def test_an_end_past_the_file_is_clamped_not_rejected(self):
        self.assertEqual(parse_range("bytes=900-99999", self.SIZE), (900, 999))

    def test_a_start_past_the_end_of_the_file_is_unsatisfiable(self):
        with self.assertRaises(InvalidRange):
            parse_range("bytes=1000-", self.SIZE)

    def test_a_backwards_range_is_unsatisfiable(self):
        with self.assertRaises(InvalidRange):
            parse_range("bytes=500-200", self.SIZE)

    def test_units_other_than_bytes_are_ignored_rather_than_failing(self):
        self.assertIsNone(parse_range("items=0-10", self.SIZE))

    def test_multipart_ranges_fall_back_to_the_whole_file(self):
        # Legal HTTP, but no media player needs it and a full body is a valid answer.
        self.assertIsNone(parse_range("bytes=0-99,200-299", self.SIZE))

    def test_content_range_header_is_well_formed(self):
        self.assertEqual(content_range(0, 999, 1000), "bytes 0-999/1000")
        self.assertEqual(content_range(500, 999, 1000), "bytes 500-999/1000")


class IterFileRangeTests(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.path = Path(self._dir.name) / "movie.bin"
        self.payload = bytes(range(256)) * 40  # 10240 bytes
        self.path.write_bytes(self.payload)

    def tearDown(self):
        self._dir.cleanup()

    def test_yields_exactly_the_requested_slice(self):
        got = b"".join(iter_file_range(self.path, 100, 199))
        self.assertEqual(got, self.payload[100:200])
        self.assertEqual(len(got), 100)

    def test_the_range_is_inclusive_of_its_final_byte(self):
        self.assertEqual(b"".join(iter_file_range(self.path, 0, 0)), self.payload[:1])

    def test_a_whole_file_range_round_trips(self):
        got = b"".join(iter_file_range(self.path, 0, len(self.payload) - 1))
        self.assertEqual(got, self.payload)

    def test_small_chunks_do_not_change_the_result(self):
        got = b"".join(iter_file_range(self.path, 50, 5000, chunk_size=7))
        self.assertEqual(got, self.payload[50:5001])


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg required")
class RealVideoTests(unittest.TestCase):
    """A real MP4, sliced the way a browser slices one."""

    @classmethod
    def setUpClass(cls):
        cls._dir = tempfile.TemporaryDirectory()
        cls.video = Path(cls._dir.name) / "real.mp4"
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
            "-i", "testsrc=size=640x360:rate=24:duration=4",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            str(cls.video),
        ], check=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        cls._dir.cleanup()

    def test_the_opening_request_a_browser_makes_returns_the_file(self):
        size = self.video.stat().st_size
        start, end = parse_range("bytes=0-", size)
        served = b"".join(iter_file_range(self.video, start, end))
        self.assertEqual(served, self.video.read_bytes())

    def test_a_seek_returns_bytes_at_the_right_offset(self):
        size = self.video.stat().st_size
        midpoint = size // 2
        start, end = parse_range(f"bytes={midpoint}-{midpoint + 999}", size)
        served = b"".join(iter_file_range(self.video, start, end))
        self.assertEqual(served, self.video.read_bytes()[midpoint:midpoint + 1000])

    def test_reassembling_every_chunk_reproduces_the_file_exactly(self):
        size = self.video.stat().st_size
        rebuilt, offset = b"", 0
        while offset < size:
            start, end = parse_range(f"bytes={offset}-{offset + 4095}", size)
            rebuilt += b"".join(iter_file_range(self.video, start, end))
            offset = end + 1
        self.assertEqual(rebuilt, self.video.read_bytes())


if __name__ == "__main__":
    unittest.main()

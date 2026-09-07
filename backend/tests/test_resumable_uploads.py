from pathlib import Path
import tempfile
import unittest

from resumable_uploads import ChunkAppendError, append_chunk


class ResumableUploadTests(unittest.TestCase):
    def test_append_chunk_advances_confirmed_offset(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "upload.part"
            self.assertEqual(
                append_chunk(target, expected_offset=0, expected_size=6, chunk=b"abc"),
                3,
            )
            self.assertEqual(
                append_chunk(target, expected_offset=3, expected_size=6, chunk=b"def"),
                6,
            )
            self.assertEqual(target.read_bytes(), b"abcdef")

    def test_append_chunk_rejects_stale_offset_without_changing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "upload.part"
            target.write_bytes(b"abc")
            with self.assertRaisesRegex(ChunkAppendError, "expected 2"):
                append_chunk(target, expected_offset=2, expected_size=6, chunk=b"def")
            self.assertEqual(target.read_bytes(), b"abc")

    def test_append_chunk_rejects_oversized_chunk_without_changing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "upload.part"
            target.write_bytes(b"abc")
            with self.assertRaisesRegex(ChunkAppendError, "exceeds"):
                append_chunk(target, expected_offset=3, expected_size=5, chunk=b"def")
            self.assertEqual(target.read_bytes(), b"abc")

    def test_append_chunk_accepts_exact_replay_after_file_only_write(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "upload.part"
            target.write_bytes(b"abcdef")
            self.assertEqual(
                append_chunk(target, expected_offset=3, expected_size=6, chunk=b"def"),
                6,
            )
            self.assertEqual(target.read_bytes(), b"abcdef")


if __name__ == "__main__":
    unittest.main()

"""HTTP-level checks on the range responses main.py actually returns.

The parsing is covered in test_range_response; this asserts the wire behaviour
a browser depends on — 206, Content-Range, Accept-Ranges, and bytes landing at
the right offset — by extracting _media_response from main.py and serving it
through a real ASGI app.
"""
from __future__ import annotations as _future_annotations

import ast
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from starlette.testclient import TestClient

import range_response


def load_media_response():
    tree = ast.parse((Path(__file__).parents[1] / "main.py").read_text())
    function = next(n for n in tree.body
                    if isinstance(n, ast.FunctionDef) and n.name == "_media_response")
    namespace = {
        "range_response": range_response, "FileResponse": FileResponse,
        "Response": Response, "StreamingResponse": StreamingResponse, "Path": Path,
    }
    code = compile(ast.Module(body=[function], type_ignores=[]), "<media>", "exec",
                   flags=_future_annotations.compiler_flag)
    exec(code, namespace)
    return namespace["_media_response"]


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg required")
class MediaResponseHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._dir = tempfile.TemporaryDirectory()
        cls.video = Path(cls._dir.name) / "clip.mp4"
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
            "-i", "testsrc=size=320x180:rate=24:duration=3",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            str(cls.video),
        ], check=True, timeout=120)
        cls.payload = cls.video.read_bytes()

        media_response = load_media_response()
        app = FastAPI()

        @app.get("/media")
        def media(request: Request):
            return media_response(cls.video, "video/mp4", "clip.mp4", request)

        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls._dir.cleanup()

    def test_a_plain_request_advertises_range_support(self):
        response = self.client.get("/media")
        self.assertEqual(response.status_code, 200)
        # Without this header a player will not even attempt to seek.
        self.assertEqual(response.headers["accept-ranges"], "bytes")
        self.assertEqual(response.content, self.payload)

    def test_the_opening_range_a_player_sends_returns_206(self):
        response = self.client.get("/media", headers={"Range": "bytes=0-"})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.headers["content-range"],
                         f"bytes 0-{len(self.payload) - 1}/{len(self.payload)}")
        self.assertEqual(response.content, self.payload)

    def test_a_seek_returns_only_that_slice_at_the_right_offset(self):
        midpoint = len(self.payload) // 2
        response = self.client.get(
            "/media", headers={"Range": f"bytes={midpoint}-{midpoint + 499}"})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, self.payload[midpoint:midpoint + 500])
        self.assertEqual(response.headers["content-length"], "500")

    def test_a_suffix_range_returns_the_tail(self):
        response = self.client.get("/media", headers={"Range": "bytes=-256"})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, self.payload[-256:])

    def test_an_unsatisfiable_range_is_416_and_reports_the_real_size(self):
        response = self.client.get(
            "/media", headers={"Range": f"bytes={len(self.payload) + 10}-"})
        self.assertEqual(response.status_code, 416)
        self.assertEqual(response.headers["content-range"], f"bytes */{len(self.payload)}")

    def test_scrubbing_the_whole_file_in_slices_reproduces_it_exactly(self):
        rebuilt, offset = b"", 0
        while offset < len(self.payload):
            response = self.client.get(
                "/media", headers={"Range": f"bytes={offset}-{offset + 8191}"})
            self.assertEqual(response.status_code, 206)
            rebuilt += response.content
            offset += len(response.content)
        self.assertEqual(rebuilt, self.payload)


if __name__ == "__main__":
    unittest.main()

"""Flickr's REST quota is the scarce resource in a bulk mirror.

Uploads go to a separate endpoint, but every REST call -- setDates,
setLocation -- comes out of 3,600 queries an hour, per key, enforced by
Flickr. At two calls a photo that is a ceiling of 1,800 photos an hour no
amount of concurrency moves. So the only lever is not making the call.

Flickr reads EXIF DateTimeOriginal off the file it was just handed, so for an
EXIF-dated photo setDates tells it something it already knows. For a date we
recovered from a sidecar, a folder or a filename it does not, and the call has
to go out -- those are precisely the photos whose EXIF carries no date.
"""
from __future__ import annotations

import ast
import asyncio
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock


def load_import_one():
    """Exec the import helper with a stubbed `main`, so no ML stack loads."""
    source = Path(__file__).parents[1] / "staged_import.py"
    tree = ast.parse(source.read_text())
    function = next(n for n in tree.body
                    if isinstance(n, ast.AsyncFunctionDef) and "mirror_flickr" in
                    {a.arg for a in n.args.kwonlyargs})
    namespace: dict = {
        "read_metadata": lambda path: {
            "title": "t", "description": "", "taken_at_unix": 1_600_000_000,
            "latitude": None, "longitude": None},
        # Module globals the function closes over; a .jpg is not a video, which
        # is the branch these tests care about.
        "VIDEO_EXTENSIONS": {".mov", ".mp4", ".m4v", ".avi"},
        "Path": Path,
        "quarantine_duplicate": lambda *a, **k: None,
    }
    exec(compile(ast.Module(body=[function], type_ignores=[]), "<import-one>", "exec"),
         namespace)
    return namespace[function.name], namespace


class RestBudgetTests(unittest.TestCase):
    def run_import(self, taken_at_source):
        main = Mock()
        main._store_nas_original.return_value = {
            "kindred_photo_id": "kid", "taken_at_unix": 1_600_000_000,
            "taken_at_source": taken_at_source, "latitude": None,
            "longitude": None, "deduplicated": False,
        }
        main._existing_flickr_copy.return_value = None
        main.get_flickr_credentials.return_value = {"user_id": "u"}
        main._upload_to_flickr = AsyncMock(return_value="fid")
        main._flickr_set_dates = AsyncMock()
        main._flickr_set_location = AsyncMock()
        main._content_type_for_filename.return_value = "image/jpeg"

        import_one, namespace = load_import_one()
        # `import main` inside the function resolves through sys.modules.
        import sys
        previous = sys.modules.get("main")
        sys.modules["main"] = main
        try:
            asyncio.run(import_one(Path("/tmp/photo.jpg"), analyze=False,
                                   mirror_flickr=True, privacy="private"))
        finally:
            if previous is None:
                sys.modules.pop("main", None)
            else:
                sys.modules["main"] = previous
        return main

    def test_an_exif_date_costs_no_rest_call(self):
        main = self.run_import("exif:DateTimeOriginal")
        main._flickr_set_dates.assert_not_awaited()

    def test_a_sidecar_date_still_has_to_be_sent(self):
        main = self.run_import("sidecar:photoTakenTime")
        main._flickr_set_dates.assert_awaited_once()

    def test_a_folder_date_still_has_to_be_sent(self):
        main = self.run_import("folder")
        main._flickr_set_dates.assert_awaited_once()

    def test_a_filename_date_still_has_to_be_sent(self):
        main = self.run_import("filename")
        main._flickr_set_dates.assert_awaited_once()

    def test_an_unknown_source_is_sent_rather_than_assumed(self):
        # None means we do not know where the date came from. Sending it costs
        # a call; not sending it risks a photo dated by upload time forever.
        main = self.run_import(None)
        main._flickr_set_dates.assert_awaited_once()

    def test_the_photo_is_still_uploaded_either_way(self):
        for source in ("exif:DateTimeOriginal", "folder"):
            main = self.run_import(source)
            main._upload_to_flickr.assert_awaited_once()
            main._record_flickr_copy.assert_called_once()


if __name__ == "__main__":
    unittest.main()

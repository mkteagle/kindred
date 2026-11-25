import ast
from contextlib import nullcontext
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, Mock, patch

from categorization_log import CategorizationError, describe_error, events


class CategorizationLogTests(unittest.TestCase):
    def test_error_detail_omits_raw_paths_and_credentials(self):
        source = describe_error(OSError("failed /data/library/private.jpg"), "reading the source image")
        self.assertEqual(source.code, "source_read_failed")
        self.assertNotIn("/data/library", str(source))
        model = describe_error(RuntimeError("secret=abc"), "detecting objects")
        self.assertIn("detecting objects", str(model))
        self.assertNotIn("secret", str(model))

    def test_list_pages_use_event_ids_and_have_open_and_history_modes(self):
        query = Mock(return_value=[{"id": 7}, {"id": 6}, {"id": 5}])
        self.assertEqual(events(query, before=10, limit=2),
                         {"events": [{"id": 7}, {"id": 6}], "next_before": 6})
        self.assertIn("source.ml_error IS NOT NULL", query.call_args.args[0])
        self.assertEqual(query.call_args.args[1], (10, 3))
        events(query, history=True)
        self.assertNotIn("source.ml_error IS NOT NULL", query.call_args.args[0])


class CategorizationInputTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        path = Path(__file__).parents[1] / "index_nas_library.py"
        tree = ast.parse(path.read_text())
        method = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "categorize_photo")
        self.main = Mock(_process_uploaded_photo=AsyncMock())
        scope = {"main": self.main, "indexable_original": nullcontext}
        exec(compile(ast.Module(body=[method], type_ignores=[]), str(path), "exec"), scope)
        self.analyze = scope["categorize_photo"]
        self.row = {"kindred_photo_id": "photo", "source_mtime_ns": 123, "provider_key": "raw"}
        self.provider = Mock()
        self.provider.resolve_local_path.return_value = Path("/private/original.dng")
        self.preview = Path("/cached/preview.jpg")

    async def test_cached_thumbnail_is_used_without_opening_original(self):
        with patch("preview_delivery.cached_thumbnail", return_value=self.preview):
            self.assertTrue(await self.analyze(self.row, self.provider))
        self.assertEqual(self.main._process_uploaded_photo.call_args.args[1], str(self.preview))
        self.provider.resolve_local_path.assert_not_called()

    async def test_decode_failure_falls_back_to_original(self):
        self.main._process_uploaded_photo.side_effect = [CategorizationError("decode_failed", "Unreadable"), None]
        with patch("preview_delivery.cached_thumbnail", return_value=self.preview):
            self.assertTrue(await self.analyze(self.row, self.provider))
        self.assertEqual([call.args[1] for call in self.main._process_uploaded_photo.await_args_list],
                         [str(self.preview), "/private/original.dng"])

    async def test_model_failure_is_logged_and_does_not_repeat_model_on_original(self):
        self.main._process_uploaded_photo.side_effect = CategorizationError("embedding_failed", "No embedding.")
        with patch("preview_delivery.cached_thumbnail", return_value=self.preview), \
                patch("categorization_log.record_failure") as record:
            self.assertFalse(await self.analyze(self.row, self.provider))
        self.main._process_uploaded_photo.assert_awaited_once()
        self.provider.resolve_local_path.assert_not_called()
        self.assertEqual(record.call_args.args[1:3], ("photo", 123))
        self.assertEqual(record.call_args.args[3].code, "embedding_failed")

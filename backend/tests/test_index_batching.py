"""Batching CLIP must change the cost, not the answer.

An embedding that shifts because it was computed alongside others would
silently re-rank every search result and re-cluster every face, so the point of
these tests is that stacking is arithmetically inert. The ordering tests cover
the other half: with more photos queued than the box can index in months, the
order decides which part of the library is searchable in the meantime.
"""
from __future__ import annotations

import ast
import sqlite3
import unittest
from pathlib import Path
from unittest.mock import Mock

import numpy as np


def load_pending():
    """Pull `pending` out of the indexer without importing its ML dependencies."""
    source = Path(__file__).parents[1] / "index_nas_library.py"
    tree = ast.parse(source.read_text())
    function = next(n for n in tree.body
                    if isinstance(n, ast.FunctionDef) and n.name == "pending")
    namespace: dict = {"main": Mock()}
    exec(compile(ast.Module(body=[function], type_ignores=[]), "<pending>", "exec"), namespace)
    return namespace["pending"], namespace["main"]


class QueueOrderTests(unittest.TestCase):
    def setUp(self):
        self.pending, self.main = load_pending()

    def test_the_queue_is_newest_first(self):
        self.pending(None)
        sql = self.main.db_query.call_args.args[0]
        self.assertIn("ORDER BY COALESCE(p.taken_at,", sql)
        self.assertIn("DESC", sql.split("ORDER BY")[1])
        self.assertNotIn("ORDER BY p.created_at", sql)

    def test_every_value_is_parameterised(self):
        self.pending(50)
        sql, params = self.main.db_query.call_args.args
        # "image/%%" is an escaped literal percent, not a placeholder.
        self.assertEqual(sql.count("%s"), len(params))
        self.assertEqual(params[-1], 50)

    def test_the_unlimited_query_still_passes_its_sentinel(self):
        self.pending(None)
        _, params = self.main.db_query.call_args.args
        self.assertEqual(params, ("0001-01-01",))

    def test_undated_photos_sort_behind_dated_ones(self):
        # The sentinel is what puts them last; a bare taken_at would sort NULLs
        # first under DESC and index the photos we know least about first.
        db = sqlite3.connect(":memory:")
        db.execute("CREATE TABLE photos (id TEXT, taken_at TEXT)")
        db.executemany("INSERT INTO photos VALUES (?,?)", [
            ("old", "2004-01-01"), ("new", "2026-01-01"), ("none", None)])
        order = [r[0] for r in db.execute(
            "SELECT id FROM photos ORDER BY COALESCE(taken_at,?) DESC, id DESC",
            ("0001-01-01",))]
        self.assertEqual(order, ["new", "old", "none"])
        db.close()


class ClipBatchingTests(unittest.TestCase):
    """`clip_embed_regions` is exec'd with a stub model, so no weights load."""

    def setUp(self):
        import torch
        self.torch = torch
        source = Path(__file__).parents[1] / "main.py"
        tree = ast.parse(source.read_text())
        wanted = {"clip_embed_regions", "clip_embed_image"}
        functions = [n for n in tree.body
                     if isinstance(n, ast.FunctionDef) and n.name in wanted]
        self.assertEqual(len(functions), 2)

        # A stand-in that is deterministic per sample and, crucially, computes
        # each row independently -- exactly the property batching relies on.
        class Model:
            calls = 0
            def encode_image(self, batch):
                Model.calls += 1
                flat = batch.reshape(batch.shape[0], -1)
                return torch.stack([
                    torch.stack([row.sum(), row.mean(), row.max(), row.min()])
                    for row in flat
                ])
        self.model = Model
        def preprocess(pil):
            return torch.tensor(np.asarray(pil, dtype="float32")[:8, :8, :].copy()).permute(2, 0, 1)

        self.namespace = {"get_clip": lambda: (Model(), preprocess, None)}
        exec(compile(ast.Module(body=functions, type_ignores=[]), "<clip>", "exec"),
             self.namespace)

    def frame(self):
        rng = np.random.default_rng(7)
        return rng.integers(0, 255, size=(64, 64, 3), dtype=np.uint8)

    def test_a_batch_matches_embedding_each_region_alone(self):
        img = self.frame()
        boxes = [[0, 0, 32, 32], [16, 16, 60, 60], None]
        batched = self.namespace["clip_embed_regions"](img, boxes)
        for box, together in zip(boxes, batched):
            alone = self.namespace["clip_embed_image"](img, bbox=box)
            np.testing.assert_allclose(together, alone, rtol=1e-5, atol=1e-6)

    def test_the_whole_batch_is_one_pass_through_the_model(self):
        self.model.calls = 0
        self.namespace["clip_embed_regions"](self.frame(), [[0, 0, 20, 20], [4, 4, 40, 40], None])
        self.assertEqual(self.model.calls, 1)

    def test_results_line_up_with_the_regions_asked_for(self):
        img = self.frame()
        # The middle crop is empty, so it must come back None without shifting
        # the others -- a caller zips these against its own detection list.
        out = self.namespace["clip_embed_regions"](img, [[0, 0, 20, 20], [10, 10, 10, 10], None])
        self.assertEqual(len(out), 3)
        self.assertIsNone(out[1])
        self.assertIsNotNone(out[0])
        self.assertIsNotNone(out[2])

    def test_no_usable_region_costs_no_forward_pass(self):
        self.model.calls = 0
        out = self.namespace["clip_embed_regions"](self.frame(), [[5, 5, 5, 5]])
        self.assertEqual(out, [None])
        self.assertEqual(self.model.calls, 0)

    def test_embeddings_come_back_unit_length(self):
        for vector in self.namespace["clip_embed_regions"](self.frame(), [None, [0, 0, 30, 30]]):
            self.assertAlmostEqual(float(np.linalg.norm(vector)), 1.0, places=5)


if __name__ == "__main__":
    unittest.main()

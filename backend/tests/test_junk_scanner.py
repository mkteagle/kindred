from unittest.mock import Mock

import numpy as np
from junk_scanner import filename_reason, scan_batch, visual_reason


def test_screenshot_filename_signals_are_conservative():
    assert filename_reason("Screenshot_2019-04-12-14-30-00.png", None) == "screenshot"
    assert filename_reason(None, "Screen Shot (125)") == "screenshot"
    assert filename_reason("Our screenshot project.jpg", "Screenshot ideas") is None
    assert filename_reason("IMG_1098.HEIC", "Baking with Mom") is None


def test_visual_reason_uses_a_keeper_margin_and_stricter_blank_threshold():
    vectors = {"photo": np.array([[1, 0, 0]]), "receipt": np.array([[0, 1, 0]]), "blank": np.array([[0, 0, 1]])}
    assert visual_reason(np.array([0.23, 0.34, 0.10]), vectors) == "receipt"
    assert visual_reason(np.array([0.29, 0.34, 0.10]), vectors) == "photo"
    assert visual_reason(np.array([0.10, 0.11, 0.30]), vectors) == "photo"
    assert visual_reason(np.array([0.26, 0.20, 0.12]), vectors) == "photo"


def test_batch_marks_filenames_leaves_pending_rows_and_respects_manual_keep():
    rows = [
        {"photo_id": "a", "original_filename": "Screenshot 2025-11-01.png", "title": "", "clip_embedding": None},
        {"photo_id": "b", "original_filename": "IMG_555.jpg", "title": "", "clip_embedding": None},
    ]
    query = Mock(side_effect=[rows, None])
    embed_text = Mock(side_effect=AssertionError("This batch must not load the model"))
    assert scan_batch(query, embed_text, after="cursor", limit=2) == "b"
    assert query.call_args_list[0].args[1] == ("cursor", 2)
    update, params = query.call_args_list[1].args
    assert params == (["a"], ["screenshot"])
    assert "p.junk_classification IS NULL" in update
    assert "library_junk_scanner" in update

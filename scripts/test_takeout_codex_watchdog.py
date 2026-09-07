import unittest

from takeout_codex_watchdog import progressed


class ProgressTests(unittest.TestCase):
    def test_stalled_partial_does_not_count_as_progress(self):
        state = {'complete': [1], 'partial': [{'name': '002.part', 'bytes': 500}]}
        self.assertFalse(progressed(state, state))

    def test_growth_and_completion_count_as_progress(self):
        old = {'complete': [1], 'partial': [{'name': '002.part', 'bytes': 500}]}
        self.assertTrue(progressed(old, {'complete': [1], 'partial': [
            {'name': '002.part', 'bytes': 1000}]}))
        self.assertTrue(progressed(old, {'complete': [1, 2], 'partial': []}))

    def test_missing_or_shrinking_file_is_not_recovery(self):
        old = {'complete': [1], 'partial': [{'name': '002.part', 'bytes': 500}]}
        self.assertFalse(progressed(old, {'complete': [1], 'partial': []}))
        self.assertFalse(progressed(old, {'complete': [1], 'partial': [
            {'name': '002.part', 'bytes': 100}]}))


if __name__ == '__main__':
    unittest.main()

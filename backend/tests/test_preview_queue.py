import unittest
from unittest.mock import MagicMock, patch
from capture_date import Capture
from prepare_nas_previews import commit_results


class PreviewCommitTests(unittest.TestCase):
    def test_ready_files_and_errors_are_committed_together(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        ready = [('a', Capture()), ('b', Capture())]
        with patch('prepare_nas_previews.execute_values') as bulk:
            commit_results(connection, ready, [('c', 'decoder error')])
        connection.commit.assert_called_once()
        connection.rollback.assert_not_called()
        markers = [call.args[1][0] for call in cursor.execute.call_args_list if 'preview_ready_at=now()' in call.args[0]]
        self.assertEqual(markers, [['a','b']])
        self.assertEqual(bulk.call_args_list[-1].args[2], [('c','decoder error')])
        self.assertIn('IS DISTINCT FROM',bulk.call_args_list[0].args[1])

    def test_failed_commit_rolls_back_the_batch_for_safe_retry(self):
        connection = MagicMock()
        connection.commit.side_effect = RuntimeError('disk unavailable')
        with patch('prepare_nas_previews.execute_values'), self.assertRaises(RuntimeError):
            commit_results(connection, [('a', Capture()), ('b', Capture())], [])
        connection.rollback.assert_called_once()


if __name__ == '__main__':
    unittest.main()

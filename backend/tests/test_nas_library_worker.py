from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import nas_library_worker as worker


class WorkerTests(unittest.TestCase):
    def test_import_failure_does_not_skip_indexing_and_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(worker, 'DATA', Path(directory)), \
                 patch.object(worker, 'phase', side_effect=[1, 0, 0, 0]) as phase, \
                 patch.object(worker.time, 'sleep') as sleep, \
                 patch.object(worker, 'status') as status:
                self.assertEqual(worker.run(), 0)
            self.assertEqual([call.args[0] for call in phase.call_args_list],
                             ['import', 'index', 'import', 'index'])
            sleep.assert_called_once_with(300)
            self.assertEqual(status.call_args.kwargs['phase'], 'complete')

    def test_index_failure_is_reported_and_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(worker, 'DATA', Path(directory)), \
                 patch.object(worker, 'phase', side_effect=[0, 1, 0, 0]), \
                 patch.object(worker.time, 'sleep'), \
                 patch.object(worker, 'status') as status:
                self.assertEqual(worker.run(), 0)
            self.assertEqual(status.call_args_list[0].kwargs['index_exit'], 1)

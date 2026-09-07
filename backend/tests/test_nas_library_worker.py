from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import nas_library_worker as worker


class WorkerTests(unittest.TestCase):
    def test_indexing_starts_while_import_is_still_running(self):
        importer = Mock(pid=10)
        importer.poll.side_effect = [None, 0, 0, 0]
        first_index = Mock(pid=11)
        first_index.poll.return_value = 0
        final_index = Mock(pid=12)
        final_index.poll.return_value = 0
        with patch.object(worker, 'launch', side_effect=[importer, first_index, final_index]) as launch, \
             patch.object(worker.time, 'sleep'), patch.object(worker, 'status') as status:
            self.assertEqual(worker.run_pass(), (0, 0))
        self.assertEqual([c.args[0] for c in launch.call_args_list], ['import', 'index', 'index'])
        self.assertEqual(status.call_args_list[0].kwargs['phase'], 'importing_and_indexing')
        self.assertTrue(status.call_args_list[-1].kwargs['final_index_pass'])

    def test_failed_import_still_gets_final_indexing_pass(self):
        importer = Mock(pid=10)
        importer.poll.return_value = 1
        indexer = Mock(pid=11)
        indexer.poll.return_value = 0
        with patch.object(worker, 'launch', side_effect=[importer, indexer]) as launch, \
             patch.object(worker.time, 'sleep'), patch.object(worker, 'status'):
            self.assertEqual(worker.run_pass(), (1, 0))
        self.assertEqual([c.args[0] for c in launch.call_args_list], ['import', 'index'])

    def test_failed_pass_retries_without_reporting_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(worker, 'DATA', Path(directory)), \
                 patch.object(worker, 'run_pass', side_effect=[(1, 0), (0, 0)]), \
                 patch.object(worker.time, 'sleep') as sleep, \
                 patch.object(worker, 'status') as status:
                self.assertEqual(worker.run(), 0)
        self.assertEqual(status.call_args_list[0].kwargs['phase'], 'retry_wait')
        self.assertEqual(status.call_args_list[-1].kwargs['phase'], 'complete')
        sleep.assert_called_once_with(300)

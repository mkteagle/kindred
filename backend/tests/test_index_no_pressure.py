"""Recognition must keep processing when host pressure is high."""
import argparse
import ast
import asyncio
import contextlib
import io
from pathlib import Path
import time
import unittest
from unittest.mock import AsyncMock, Mock


class RecognitionPressureTests(unittest.TestCase):
    def worker(self):
        tree=ast.parse((Path(__file__).parents[1]/'index_nas_library.py').read_text())
        functions=[node for node in tree.body if isinstance(node,ast.AsyncFunctionDef) and node.name in ('index_photo','run')]
        main=Mock()
        main._process_uploaded_photo=AsyncMock()
        main.LocalStorageProvider.return_value.resolve_local_path.return_value=Path('/fixture/original.jpg')
        main.db_query.return_value=[{'exists':1}]
        throttle=Mock()
        throttle.read_pressure.side_effect=AssertionError('Resource pressure must not pause this queue')
        throttle.wait_for_capacity.side_effect=AssertionError('Resource pressure must not pause this queue')
        namespace={'argparse':argparse,'main':main,'time':time,'asyncio':asyncio,'throttle':throttle,
                   'pending':lambda *a,**kw:[{'provider_key':'a','kindred_photo_id':'a'},{'provider_key':'b','kindred_photo_id':'b'}],
                   'indexable_original':contextlib.nullcontext}
        exec(compile(ast.Module(body=functions,type_ignores=[]),'<run>','exec'),namespace)
        return namespace['run'], main, throttle

    def test_host_pressure_does_not_pause_the_queue(self):
        run, main, throttle = self.worker()
        args=argparse.Namespace(limit=2,library_only=True,defer_clustering=True)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(asyncio.run(run(args)),0)
        self.assertEqual(main._process_uploaded_photo.await_count,2)
        throttle.read_pressure.assert_not_called()
        throttle.wait_for_capacity.assert_not_called()

    def test_preview_priority_stops_dispatch_after_the_active_photo(self):
        run, main, _ = self.worker()
        args = argparse.Namespace(
            limit=2, library_only=True, defer_clustering=True,
            before_item=lambda: main._process_uploaded_photo.await_count == 0,
            on_progress=Mock(),
        )
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(asyncio.run(run(args)), 0)
        self.assertEqual(main._process_uploaded_photo.await_count, 1)
        args.on_progress.assert_called_with(1, 1, 0)

if __name__=='__main__':unittest.main()

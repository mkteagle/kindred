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
    def test_host_pressure_does_not_pause_the_queue(self):
        tree=ast.parse((Path(__file__).parents[1]/'index_nas_library.py').read_text())
        run=next(node for node in tree.body if isinstance(node,ast.AsyncFunctionDef) and node.name=='run')
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
        exec(compile(ast.Module(body=[run],type_ignores=[]),'<run>','exec'),namespace)
        args=argparse.Namespace(limit=2,library_only=True,defer_clustering=True)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(asyncio.run(namespace['run'](args)),0)
        self.assertEqual(main._process_uploaded_photo.await_count,2)
        throttle.read_pressure.assert_not_called()
        throttle.wait_for_capacity.assert_not_called()

if __name__=='__main__':unittest.main()

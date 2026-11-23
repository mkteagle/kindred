"""Durable progress stays correct when render results finish concurrently."""
import argparse
import ast
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from collections import deque
from contextlib import closing, nullcontext
import json
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest

class ParallelPreviewTests(unittest.TestCase):
    def test_parallel_results_keep_database_baseline_and_commit_before_counting(self):
        tree=ast.parse((Path(__file__).parents[1]/'prepare_nas_previews.py').read_text())
        funcs=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('run','heartbeat','prepare_batch')]
        class Cursor:
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def execute(self,sql,*a):self.sql=sql
            def fetchone(self):return (True,) if 'advisory' in self.sql else (10,2)
            def fetchall(self):return [{'photo_id':str(i)} for i in range(4)]
        class Connection:
            def cursor(self,**kw):return Cursor()
            def commit(self):pass
            def close(self):pass
        lock=threading.Lock();active=maximum=0;writes=[];committed=[]
        def render(provider,row):
            nonlocal active,maximum
            with lock:active+=1;maximum=max(maximum,active)
            time.sleep(.03)
            with lock:active-=1
            return row['photo_id'],object(),('decoder failed' if row['photo_id']=='0' else None),.03,0
        def commit(connection,ready,failed):
            committed.extend([id for id,_ in ready]+[id for id,_ in failed]);return .01
        ns={'os':SimpleNamespace(nice=lambda n:None,environ={'PHOTO_STORAGE_ROOT':'fixture'}),
            'LocalStorageProvider':lambda p:object(),'Path':Path,'json':json,'threading':threading,
            'time':time,'deque':deque,'closing':closing,'ThreadPoolExecutor':ThreadPoolExecutor,
            'FIRST_COMPLETED':FIRST_COMPLETED,'wait':wait,
            'psycopg2':SimpleNamespace(connect=lambda url:Connection()),'RealDictCursor':object,
            'save_status':lambda state,status:writes.append(dict(status)),
            'DISCOVERY_STATUS':'discovery.json','preview_queue_access':lambda _:nullcontext(),
            'read_status':lambda _:dict(complete=True, version=1),
            'render_item':render,'commit_results':commit}
        ns['os'].environ['DATABASE_URL']='fixture'
        exec(compile(ast.Module(body=funcs,type_ignores=[]),'<preview>','exec'),ns)
        with tempfile.TemporaryDirectory() as d:
            ns['run'](argparse.Namespace(status=str(Path(d)/'status.json'),workers=4,once=True))
        self.assertGreaterEqual(maximum,2)
        self.assertCountEqual(committed,['0','1','2','3'])
        self.assertEqual(writes[-1]['completed'],13)
        self.assertEqual(writes[-1]['failed'],3)
        self.assertTrue(writes[-1]['counts_authoritative'])
        self.assertFalse(writes[-1]['running'])

if __name__=='__main__':unittest.main()

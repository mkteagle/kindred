"""Bounded disposable API cache; never makes a reader wait for durable WAL."""
from collections import OrderedDict
from copy import deepcopy
import json
import threading
import time


class MemoryCache:
    def __init__(self, budget=64*1024*1024, clock=time.monotonic):
        self.budget=budget;self.clock=clock;self.items=OrderedDict();self.bytes=0
        self.lock=threading.RLock();self.generations={}

    def get(self,key,ttl=3600):
        with self.lock:
            item=self.items.get(key)
            if item is None:return None
            created,data,size=item
            if self.clock()-created>=ttl:
                self.items.pop(key);self.bytes-=size;return None
            self.items.move_to_end(key)
            return deepcopy(data)

    def version(self,key):
        with self.lock:return self.generations.get(key,0)

    def set(self,key,data,version=None):
        size=len(json.dumps(data,default=str).encode())
        if size>self.budget:return
        value=deepcopy(data)
        with self.lock:
            if version is not None and version!=self.generations.get(key,0):return
            previous=self.items.pop(key,None)
            if previous:self.bytes-=previous[2]
            self.items[key]=(self.clock(),value,size);self.bytes+=size
            while self.bytes>self.budget:
                _,(_,_,removed)=self.items.popitem(last=False);self.bytes-=removed

    def invalidate(self,prefix=''):
        with self.lock:
            keys=set(self.items)|set(self.generations)
            # Track exact invalidations even before an in-flight result is cached.
            if prefix:keys.add(prefix)
            for key in keys:
                if not prefix or key.startswith(prefix):
                    previous=self.items.pop(key,None)
                    if previous:self.bytes-=previous[2]
                    self.generations[key]=self.generations.get(key,0)+1

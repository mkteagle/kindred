import unittest
from memory_cache import MemoryCache

class MemoryCacheTests(unittest.TestCase):
    def test_cache_expires_and_does_not_share_mutable_results(self):
        now=[0];cache=MemoryCache(clock=lambda:now[0]);cache.set('key',{'count':2})
        cache.get('key')['count']=999
        self.assertEqual(cache.get('key')['count'],2)
        now[0]=10
        self.assertIsNone(cache.get('key',ttl=10))

    def test_eviction_bounds_memory_and_invalidates_prefixes(self):
        cache=MemoryCache(budget=25)
        cache.set('a','1234567890');cache.set('b','1234567890');cache.set('c','1234567890')
        self.assertLessEqual(cache.bytes,25);self.assertIsNone(cache.get('a'))
        cache.invalidate('b');self.assertIsNone(cache.get('b'));self.assertIsNotNone(cache.get('c'))

    def test_invalidation_during_a_query_does_not_recache_its_old_result(self):
        cache=MemoryCache();version=cache.version('library_counts')
        cache.invalidate('library_counts')
        cache.set('library_counts',{'total':10},version=version)
        self.assertIsNone(cache.get('library_counts'))

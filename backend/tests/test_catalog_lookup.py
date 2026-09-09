"""Catalog identity resolution uses the existing indexes before joining copies."""
import ast
from pathlib import Path
import unittest
from unittest.mock import Mock

UUID = '993a38bc-c01e-41ed-b85b-1b931a8cf1ca'

def load(query):
    tree = ast.parse((Path(__file__).parents[1] / 'main.py').read_text())
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_catalog_photo')
    namespace = {'db_query': query}
    exec(compile(ast.Module(body=[function], type_ignores=[]), '<catalog>', 'exec'), namespace)
    return namespace['_catalog_photo']

class CatalogLookupTests(unittest.TestCase):
    def test_uuid_resolves_in_one_indexed_lookup(self):
        query = Mock(return_value=[{'id': UUID, 'nas_key': 'original.jpg'}])
        self.assertEqual(load(query)(UUID)['id'], UUID)
        query.assert_called_once()
        sql, args = query.call_args.args
        self.assertIn('p.id=%s::uuid', sql)
        self.assertNotIn('p.id::text', sql)
        self.assertNotIn(' OR ', sql)
        self.assertEqual(args, (UUID,))

    def test_legacy_identity_keeps_priority(self):
        query = Mock(return_value=[{'id': UUID}])
        self.assertEqual(load(query)('123456')['id'], UUID)
        query.assert_called_once()
        self.assertIn('p.legacy_photo_id=%s', query.call_args.args[0])

    def test_flickr_only_identity_uses_copy_key_index(self):
        query = Mock(side_effect=[[], [{'id': UUID}]])
        self.assertEqual(load(query)('123456')['id'], UUID)
        self.assertEqual(query.call_count, 2)
        self.assertIn("provider='flickr' AND provider_key=%s AND status='available'", query.call_args.args[0])

    def test_uuid_shaped_legacy_id_and_missing_photo(self):
        query = Mock(side_effect=[[], [{'id': 'legacy'}]])
        self.assertEqual(load(query)(UUID)['id'], 'legacy')
        self.assertIsNone(load(Mock(return_value=[]))(UUID))

if __name__ == '__main__': unittest.main()

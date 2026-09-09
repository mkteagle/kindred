import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('kindred_deploy', Path(__file__).parents[1] / 'deploy.py')
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


class DeployTests(unittest.TestCase):
    def test_render_pins_release_and_preserves_secret_references(self):
        template = (Path(__file__).parents[1] / 'docker-compose.release.yml').read_text()
        rendered = deploy.render(template, Path('/releases/abc'), Path('/live/data'), 'a' * 40)
        self.assertNotIn('${KINDRED_', rendered)
        self.assertIn('kindred-api:' + 'a' * 40, rendered)
        self.assertIn('org.opencontainers.image.revision: ' + 'a' * 40, rendered)
        self.assertIn('${POSTGRES_PASSWORD}', rendered)
        self.assertNotIn(':/app/main.py', rendered)
        self.assertIn('/live/data/photos:/data/photos', rendered)

    def test_rejects_symbolic_or_malformed_revision(self):
        for revision in ['main', 'abc123', 'a' * 39]:
            with self.assertRaises(ValueError):
                deploy.render('', Path('/source'), Path('/data'), revision)

    def test_rejects_wrong_running_image_revision(self):
        container = {'Image': 'sha256:wrong', 'State': {'Running': True}}
        with patch.object(deploy, 'inspect_container', return_value=container), \
             patch.object(deploy, 'run', return_value='[{"Config":{"Labels":{"org.opencontainers.image.revision":"old"}}}]'):
            with self.assertRaisesRegex(RuntimeError, 'differs'):
                deploy.verify(Path('/config'), Path('/runtime'), 'a' * 40, ['web'])

    def test_rejects_unhealthy_correct_revision(self):
        container = {'Image': 'sha256:id', 'State': {'Running': True, 'Health': {'Status': 'unhealthy'}}}
        with patch.object(deploy, 'inspect_container', return_value=container), \
             patch.object(deploy, 'run', return_value='[{"Config":{"Labels":{"org.opencontainers.image.revision":"' + 'a'*40 + '"}}}]'):
            with self.assertRaisesRegex(RuntimeError, 'health is unhealthy'):
                deploy.verify(Path('/config'), Path('/runtime'), 'a' * 40, ['web'])

    def test_rollback_stops_new_worker_absent_from_previous_release(self):
        previous = {'config': '/old', 'services': ['api', 'web', 'library-worker']}
        current = {'config': '/new', 'services': [*previous['services'], 'video-worker']}
        with patch.object(deploy, 'compose') as compose:
            deploy.restore(previous, Path('/runtime'), current)
        self.assertEqual(compose.call_args_list[0].args[2:], ('stop', 'library-worker'))
        self.assertIn('import_checkpoint.compact(path)', compose.call_args_list[1].args[-1])
        self.assertEqual(compose.call_args_list[2].args[2:], ('stop', 'video-worker'))
        self.assertNotIn('video-worker', compose.call_args_list[3].args)

    def test_rollback_does_not_start_old_image_when_compaction_fails(self):
        target = {'config': '/old', 'services': ['api', 'library-worker']}
        active = {'config': '/new', 'services': ['api', 'library-worker']}
        with patch.object(deploy, 'compose', side_effect=[None, RuntimeError('corrupt checkpoint')]) as compose:
            with self.assertRaisesRegex(RuntimeError, 'corrupt checkpoint'):
                deploy.restore(target, Path('/runtime'), active)
        self.assertEqual(compose.call_count, 2)
        self.assertTrue(all('up' not in call.args for call in compose.call_args_list))

    def test_legacy_rollback_never_touches_other_target(self):
        legacy = {'config': '/old', 'services': ['api', 'web', 'library-worker']}
        for target, expected in [('backend', ['api', 'library-worker']), ('web', ['web'])]:
            record = deploy.scoped_record(legacy, target)
            with patch.object(deploy, 'compose') as compose:
                deploy.restore(record, Path('/runtime'), record)
            self.assertEqual(record['services'], expected)
            for call in compose.call_args_list:
                for excluded in set(legacy['services']) - set(expected):
                    self.assertNotIn(excluded, call.args)

    def test_deploy_targets_build_and_restart_only_their_services(self):
        import json
        import tempfile
        revision = 'a' * 40
        for target, services, images in [
            ('backend', ['api', 'library-worker', 'video-worker'], ['api']),
            ('web', ['web'], ['web']),
        ]:
            with tempfile.TemporaryDirectory() as directory:
                runtime = Path(directory)
                (runtime / '.env').touch()
                state = runtime / 'data/deployments'
                release = state / 'releases' / revision
                (release / 'deploy/ugreen').mkdir(parents=True)
                (release / 'deploy/ugreen/docker-compose.release.yml').write_text('services: {}')
                legacy = {'revision': 'b' * 40, 'config': '/old',
                          'services': ['api', 'web', 'library-worker', 'video-worker']}
                (state / 'current.json').write_text(json.dumps(legacy))
                (runtime / 'docker-compose.yaml').write_text('original UGOS config')
                def fake_run(*args, **kwargs):
                    return revision if 'rev-parse' in args else ''
                argv = ['deploy.py', 'deploy', '--ref', revision, '--runtime', str(runtime)]
                if target == 'web':
                    argv += ['--target', 'web']
                with patch.object(deploy.sys, 'argv', argv), \
                     patch.object(deploy, 'run', side_effect=fake_run), \
                     patch.object(deploy, 'compose') as compose, \
                     patch.object(deploy, 'verify', return_value={}):
                    self.assertEqual(deploy.main(), 0)
                self.assertEqual(compose.call_args_list[1].args[2:], ('build', *images))
                up = compose.call_args_list[2].args
                self.assertIn('--no-deps', up)
                self.assertEqual(list(up[-len(services):]), services)
                previous = json.loads((state / f'{target}-previous.json').read_text())
                self.assertEqual(previous['services'], services)
                current = json.loads((state / f'{target}-current.json').read_text())
                self.assertEqual(current['services'], services)
                self.assertEqual(json.loads((state / 'current.json').read_text()), legacy)
                self.assertEqual((runtime / 'docker-compose.yaml').read_text(), 'original UGOS config')

    def test_target_history_takes_precedence_over_legacy(self):
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            (state / 'current.json').write_text(json.dumps({'config': '/legacy', 'services': ['web', 'api']}))
            (state / 'backend-current.json').write_text(json.dumps({'config': '/backend', 'services': ['api']}))
            self.assertEqual(deploy.release_record(state, 'backend', 'current')['config'], '/backend')
            self.assertEqual(deploy.release_record(state, 'web', 'current')['services'], ['web'])

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

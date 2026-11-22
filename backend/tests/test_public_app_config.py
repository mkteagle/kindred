from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

import main


class PublicAppConfigTests(TestCase):
    def test_config_reports_capabilities_without_provider_credentials(self):
        with (
            patch.object(main, "db_query", return_value=[{"cnt": 1}]),
            patch.object(main, "FLICKR_API_KEY", "private-key-fixture"),
            patch.object(main, "FLICKR_SECRET", "private-secret-fixture"),
        ):
            response = TestClient(main.app).get("/app-config")

        self.assertEqual(response.status_code, 200)
        config = response.json()
        self.assertTrue(config["setup_complete"])
        self.assertTrue(config["features"]["flickr_integration"])
        self.assertNotIn("flickr", config)
        self.assertNotIn("private-key-fixture", response.text)
        self.assertNotIn("private-secret-fixture", response.text)

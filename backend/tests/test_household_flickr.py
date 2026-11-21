import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from household_flickr import connect, credentials
import main


WIFE = {"user_id": "household", "oauth_token": "fixture", "oauth_secret": "fixture-secret", "verified": True}
OTHER = {**WIFE, "user_id": "other"}


class HouseholdFlickrTests(unittest.TestCase):
    def test_singleton_beats_a_different_legacy_configuration(self):
        query = Mock(return_value=[WIFE])
        self.assertEqual(credentials(query, "household", OTHER), WIFE)

    def test_operator_pin_fails_closed_if_the_existing_selection_differs(self):
        query = Mock(return_value=[OTHER])
        self.assertIsNone(credentials(query, "household", WIFE))

    def test_legacy_configuration_requires_an_identified_destination(self):
        query = Mock(return_value=[])
        self.assertEqual(credentials(query, "household", WIFE), WIFE)
        self.assertIsNone(credentials(query, "household", OTHER))
        self.assertIsNone(credentials(query, "", {**WIFE, "user_id": ""}))

    def test_other_account_cannot_change_the_configured_pin(self):
        query = Mock()
        self.assertFalse(connect(query, OTHER, "household"))
        query.assert_not_called()

    def test_connection_is_accepted_only_if_the_atomic_update_succeeds(self):
        query = Mock(return_value=[])
        self.assertFalse(connect(query, WIFE, ""))
        query.return_value = [{"flickr_user_id": "household"}]
        self.assertTrue(connect(query, WIFE, "household"))


class HouseholdFlickrStatusTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        auth = patch.object(main, "validate_session", side_effect=lambda token: {
            "owner-session": {"user_id": "owner", "role": "admin"},
            "member-session": {"user_id": "member", "role": "member"},
        }.get(token))
        config = patch.multiple(main, FLICKR_API_KEY="fixture-key", FLICKR_SECRET="fixture-secret")
        selected = patch.object(main, "get_flickr_credentials", return_value=WIFE)
        auth.start()
        config.start()
        self.selected = selected.start()
        self.addCleanup(auth.stop)
        self.addCleanup(config.stop)
        self.addCleanup(selected.stop)

    def test_signed_in_member_sees_only_destination_status(self):
        response = self.client.get("/integrations/flickr", headers={"X-Session-Token": "member-session"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"configured": True, "connected": True, "verified": True})

    def test_owner_sees_account_identifier_and_unverified_status(self):
        self.selected.return_value = {**WIFE, "verified": False}
        response = self.client.get("/integrations/flickr", headers={"X-Session-Token": "owner-session"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "configured": True, "connected": True, "verified": False, "user_id": "household",
        })

    def test_status_requires_authentication_and_member_cannot_connect(self):
        self.assertEqual(self.client.get("/integrations/flickr").status_code, 401)
        self.assertEqual(self.client.post("/integrations/flickr", json={},
                                         headers={"X-Session-Token": "member-session"}).status_code, 403)

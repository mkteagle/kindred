import os
import unittest
from unittest.mock import patch

from review_account import build_review_auth_response, review_credentials_match


class ReviewAccountTests(unittest.TestCase):
    def test_disabled_when_credentials_are_not_configured(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(review_credentials_match("reviewer", "password"))

    def test_requires_exact_username_and_password(self):
        configured = {
            "APP_REVIEW_USERNAME": "appreview@kindredphotos.app",
            "APP_REVIEW_PASSWORD": "correct horse battery staple",
        }
        with patch.dict(os.environ, configured, clear=True):
            self.assertTrue(
                review_credentials_match(
                    "appreview@kindredphotos.app", "correct horse battery staple"
                )
            )
            self.assertFalse(
                review_credentials_match(
                    "appreview@kindredphotos.app", "wrong password"
                )
            )
            self.assertFalse(
                review_credentials_match(
                    "someone@kindredphotos.app", "correct horse battery staple"
                )
            )

    def test_response_is_marked_as_demo_and_has_no_real_session(self):
        response = build_review_auth_response("appreview@kindredphotos.app")
        self.assertTrue(response["review_demo"])
        self.assertEqual(response["user"]["id"], "app_review_demo")
        self.assertEqual(response["session"]["token"], "review-demo")


if __name__ == "__main__":
    unittest.main()

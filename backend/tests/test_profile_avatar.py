from datetime import datetime, timezone
from io import BytesIO
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

import main
from profile_avatar import avatar_image, google_picture_url


class ProfileAvatarTests(unittest.TestCase):
    def test_google_picture_is_limited_to_google_profile_image_hosts(self):
        valid = "https://lh3.googleusercontent.com/a/profile=s96-c"
        self.assertEqual(google_picture_url(valid), valid)
        for url in ("http://lh3.googleusercontent.com/a/p", "https://lh3.googleusercontent.com.evil.test/a/p",
                    "https://lh3.googleusercontent.com@localhost/a/p", "https://lh3.googleusercontent.com:8443/a/p",
                    "https://lh3.googleusercontent.com/a/default-user=s96-c", "https://[::1]/picture"):
            with self.subTest(url=url):
                self.assertIsNone(google_picture_url(url))

    def test_upload_preserves_position_and_rejects_invalid_bytes(self):
        client = TestClient(main.app)
        picture = BytesIO()
        Image.new("RGBA", (512, 512), (150, 80, 20, 160)).save(picture, format="PNG")
        with patch.object(main, "validate_session", return_value={"user_id": "owner", "role": "member"}), \
             patch.object(main, "db_query", return_value=[{"updated_at": datetime(2025, 1, 1, tzinfo=timezone.utc)}]) as query:
            headers = {"X-Session-Token": "fixture-session"}
            response = client.put("/users/me/avatar", headers=headers, files={"file": ("profile.png", picture.getvalue(), "image/png")})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["avatar_url"], "/users/owner/avatar?v=1735689600000000")
            binary, owner = query.call_args.args[1]
            self.assertEqual(owner, "owner")
            with Image.open(BytesIO(binary.adapted)) as result:
                self.assertEqual(result.size, (512, 512))
                self.assertEqual(result.getpixel((200, 300))[3], 160)
            query.reset_mock()
            invalid = client.put("/users/me/avatar", headers=headers, files={"file": ("profile.jpg", b"not an image", "image/jpeg")})
            self.assertEqual(invalid.status_code, 400)
            query.assert_not_called()

    def test_oversized_image_dimensions_are_rejected_before_decode(self):
        large = BytesIO()
        Image.new("1", (7000, 6000)).save(large, format="PNG")
        with self.assertRaisesRegex(ValueError, "36 megapixels"):
            avatar_image(large.getvalue())

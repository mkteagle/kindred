from io import BytesIO
import re
from urllib.parse import urlsplit

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_AVATAR_BYTES = 5 * 1024 * 1024


def google_picture_url(value):
    """Accept only HTTPS profile images on Google's profile image hosts."""
    if not isinstance(value, str) or not 0 < len(value) <= 2048 or any(c.isspace() for c in value):
        return None
    try:
        url = urlsplit(value)
        if (url.scheme != "https" or not re.fullmatch(r"lh[0-9]+\.googleusercontent\.com", url.netloc)
                or not url.path.startswith("/") or url.path.startswith("/a/default-user") or url.fragment):
            return None
    except ValueError:
        return None
    return value


def avatar_image(data):
    """Decode a bounded static image and strip metadata before sharing it."""
    if not 0 < len(data) <= MAX_AVATAR_BYTES:
        raise ValueError("Choose an image under 5 MB.")
    try:
        with Image.open(BytesIO(data), formats=("JPEG", "PNG", "WEBP")) as source:
            if source.width * source.height > 36_000_000:
                raise ValueError("Choose an image smaller than 36 megapixels.")
            image = ImageOps.exif_transpose(source)
            image.thumbnail((1024, 1024))
            mode = "RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB"
            output = BytesIO()
            image.convert(mode).save(output, format="WEBP", quality=90, method=4)
            return output.getvalue()
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise ValueError("Choose a valid JPG, PNG, or WebP image.") from exc


def profile_avatar_url(user_id, revision=None):
    path = f"/users/{user_id}/avatar"
    return f"{path}?v={int(revision.timestamp() * 1_000_000)}" if revision else path

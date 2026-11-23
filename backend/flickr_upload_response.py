"""Recover a Flickr ID from the provider's duplicate-upload receipt."""
import re
from xml.etree import ElementTree


def duplicate_photo_id(body: str) -> str | None:
    try:
        root = ElementTree.fromstring(body)
    except ElementTree.ParseError:
        return None
    error = root.find("err")
    if error is None or error.get("code") != "9":
        return None
    photo_id = error.get("duplicate_photo_id") or error.findtext("duplicate_photo_id")
    photo_id = photo_id or root.findtext("duplicate_photo_id")
    if photo_id and re.fullmatch(r"[0-9]{1,32}", photo_id):
        return photo_id
    return None

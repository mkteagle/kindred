from collections.abc import Sequence


def build_backup_status_items(photo_ids: list[str], rows: list[dict], *,
                              kindred_ids: Sequence[str] = ()) -> list[dict]:
    """Return an ordered status for each requested Flickr or Kindred ID."""
    by_flickr = {row["flickr_photo_id"]: row for row in rows if row.get("flickr_photo_id")}
    by_kindred = {str(row["kindred_photo_id"]): row for row in rows if row.get("kindred_photo_id")}

    def status(row, flickr_id=None, kindred_id=None):
        flickr_id = row.get("flickr_photo_id") or flickr_id
        kindred_id = row.get("kindred_photo_id") or kindred_id
        flickr_status = row.get("flickr_status") or "missing"
        nas_status = row.get("nas_status") or "missing"
        return {
            "flickr_photo_id": flickr_id,
            "kindred_photo_id": str(kindred_id) if kindred_id else None,
            "flickr_status": flickr_status,
            "nas_status": nas_status,
            "cleanup_safe": bool(flickr_id) and flickr_status == nas_status == "available",
        }

    return [status(by_flickr.get(photo_id, {}), flickr_id=photo_id) for photo_id in photo_ids] + [
        status(by_kindred.get(photo_id, {}), kindred_id=photo_id) for photo_id in kindred_ids
    ]

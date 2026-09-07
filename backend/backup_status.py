def build_backup_status_items(photo_ids: list[str], rows: list[dict]) -> list[dict]:
    """Return one ordered, fail-closed status item for every requested Flickr ID."""
    found = {row["flickr_photo_id"]: row for row in rows}
    items = []
    for flickr_photo_id in photo_ids:
        row = found.get(flickr_photo_id)
        flickr_status = row.get("flickr_status") if row else "missing"
        nas_status = row.get("nas_status") if row and row.get("nas_status") else "missing"
        items.append(
            {
                "flickr_photo_id": flickr_photo_id,
                "kindred_photo_id": str(row["kindred_photo_id"])
                    if row and row.get("kindred_photo_id") else None,
                "flickr_status": flickr_status,
                "nas_status": nas_status,
                "cleanup_safe": (
                    flickr_status == "available" and nas_status == "available"
                ),
            }
        )
    return items

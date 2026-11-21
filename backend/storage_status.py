"""Read capacity from the configured storage mount, never scan the photo tree."""
from pathlib import Path
import shutil


def storage_status(root: str, name: str = "Home NAS", household_name: str = "", browse_root: str = "") -> dict:
    result = {"name": name, "household_name": household_name, "configured": bool(root or browse_root),
              "available": False, "total_bytes": None, "used_bytes": None, "free_bytes": None}
    if not root and not browse_root:
        return result
    try:
        path = Path(browse_root or root)
        if not path.is_dir():
            return dict(result, detail="The configured storage folder is unavailable.")
        usage = shutil.disk_usage(path)
        return dict(result, available=True, total_bytes=usage.total,
                    used_bytes=usage.used, free_bytes=usage.free)
    except OSError:
        return dict(result, detail="Storage capacity could not be read. Check the server mount.")

"""
Kindred backend — FastAPI + PostgreSQL/pgvector
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks, Query, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
import numpy as np
import json
import uuid
import httpx
import asyncio
import base64
import os
from pathlib import Path

import secrets
import bcrypt

import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
from pgvector.psycopg2 import register_vector
from datetime import datetime, timedelta, timezone
from db_migrations import apply_migrations
from storage import LocalStorageProvider
from storage.local import managed_originals
from backup_status import build_backup_status_items
from resumable_uploads import ChunkAppendError, append_chunk
from review_account import build_review_auth_response, review_credentials_match
from albums import album_slug, unique_album_slug

DATABASE_URL = os.environ.get("DATABASE_URL", "")
FLICKR_API_KEY = os.environ.get("FLICKR_API_KEY", "")
FLICKR_SECRET = os.environ.get("FLICKR_SECRET", "")
FLICKR_OAUTH_TOKEN = os.environ.get("FLICKR_OAUTH_TOKEN", "")
FLICKR_OAUTH_SECRET = os.environ.get("FLICKR_OAUTH_SECRET", "")
FLICKR_USER_ID = os.environ.get("FLICKR_USER_ID", "")
SCAN_SECRET = os.environ.get("SCAN_SECRET", "")
API_KEY = os.environ.get("API_KEY", "")
PHOTO_STORAGE_ROOT = os.environ.get("PHOTO_STORAGE_ROOT", "")
PUBLIC_API_URL = os.environ.get("PUBLIC_API_URL", "https://api.kindredphotos.app").rstrip("/")
PUBLIC_WEB_URL = os.environ.get("PUBLIC_WEB_URL", "https://kindredphotos.app").rstrip("/")

app = FastAPI(title="Kindred API")
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "").split(",") if os.environ.get("CORS_ORIGINS") else [
    "https://kindredphotos.app",
    "https://demo.kindredphotos.app",
    "http://localhost:3000",
    "http://localhost:3001",
]
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])

from fastapi import Request as FastAPIRequest, Depends
from starlette.middleware.base import BaseHTTPMiddleware

AUTH_SKIP_PATHS = {"/health", "/docs", "/openapi.json", "/app-config",
                   "/auth/setup", "/auth/login", "/auth/register", "/auth/flickr-login"}

# Share links are their own capability: the handlers under this prefix validate
# the token, its liveness and its scope themselves, and must stay reachable
# without a session or API key. Nothing else may be added to this prefix.
PUBLIC_SHARE_PREFIX = "/public/shares/"

class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: FastAPIRequest, call_next):
        from fastapi.responses import JSONResponse
        path = request.url.path
        # Skip auth for public endpoints
        if path in AUTH_SKIP_PATHS or path.startswith("/docs"):
            return await call_next(request)
        if path.startswith(PUBLIC_SHARE_PREFIX):
            # Deliberately anonymous. A share token grants exactly its own
            # subject, so no session is established and none is honoured here.
            return await call_next(request)
        if path == "/scan/auto":
            # Optionally extract user (session OR API key) so admin auth can substitute
            # for the SCAN_SECRET. Auth is not *required* here — the handler also accepts
            # the shared SCAN_SECRET query param for cron-style triggers.
            session_token = request.headers.get("X-Session-Token")
            if session_token:
                user = validate_session(session_token)
                if user:
                    request.state.user = {**user, "auth_method": "session"}
            else:
                key = request.headers.get("X-API-Key") or request.query_params.get("api_key")
                if key and key.startswith("knd_"):
                    api_user = validate_api_key(key)
                    if api_user:
                        request.state.user = {**api_user, "auth_method": "api_key"}
            return await call_next(request)

        # Try session token first (web users) — check header and query param for image endpoints
        session_token = request.headers.get("X-Session-Token") or request.query_params.get("session_token")
        if session_token:
            user = validate_session(session_token)
            if user:
                request.state.user = {**user, "auth_method": "session"}
                return await call_next(request)
            return JSONResponse(status_code=401, content={"detail": "Invalid or expired session"})

        # Fall back to API key (mobile/external)
        key = request.headers.get("X-API-Key") or request.query_params.get("api_key")
        if key:
            # Check DB-stored hashed API keys first
            if key.startswith("knd_"):
                api_user = validate_api_key(key)
                if api_user:
                    request.state.user = {**api_user, "auth_method": "api_key"}
                    return await call_next(request)
            # Legacy: check static env var for backward compat during migration
            if API_KEY and key == API_KEY:
                request.state.user = {"user_id": None, "role": "admin", "username": "api", "auth_method": "api_key"}
                return await call_next(request)

        return JSONResponse(status_code=401, content={"detail": "Authentication required"})

app.add_middleware(AuthMiddleware)

# ── Role dependencies ────────────────────────────────────────────────────────

def get_current_user(request: FastAPIRequest):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

def require_admin(request: FastAPIRequest):
    user = get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

@app.on_event("startup")
def create_new_tables():
    """Create tables for new features if they don't exist yet."""
    try:
        applied = apply_migrations(DATABASE_URL)
        if applied:
            print(f"Applied database migrations: {', '.join(applied)}")
        conn = psycopg2.connect(DATABASE_URL)
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS photo_metadata (
                    photo_id TEXT PRIMARY KEY,
                    date_taken TIMESTAMPTZ,
                    latitude REAL,
                    longitude REAL,
                    location_name TEXT,
                    tags TEXT[],
                    description TEXT,
                    created_at TIMESTAMPTZ DEFAULT now()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS scene_overrides (
                    photo_id TEXT,
                    scene TEXT,
                    PRIMARY KEY (photo_id, scene)
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS photo_text (
                    photo_id TEXT PRIMARY KEY,
                    detected_text TEXT,
                    created_at TIMESTAMPTZ DEFAULT now()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS photo_colors (
                    photo_id TEXT PRIMARY KEY,
                    colors JSONB,
                    created_at TIMESTAMPTZ DEFAULT now()
                )
            """)
            # Add label_source to clusters: 'human' (user-labeled) vs 'auto' (AI-generated)
            cur.execute("""
                ALTER TABLE clusters ADD COLUMN IF NOT EXISTS label_source TEXT DEFAULT 'auto'
            """)
            # Custom avatar: user picks which detection to use as avatar + optional crop for cover photo
            cur.execute("""
                ALTER TABLE clusters ADD COLUMN IF NOT EXISTS avatar_detection_id UUID
            """)
            cur.execute("""
                ALTER TABLE clusters ADD COLUMN IF NOT EXISTS cover_photo_id TEXT
            """)
            cur.execute("""
                ALTER TABLE clusters ADD COLUMN IF NOT EXISTS cover_crop JSONB
            """)
            # ── Household accounts ───────────────────────────────────────
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    username TEXT UNIQUE NOT NULL,
                    display_name TEXT NOT NULL,
                    password_hash TEXT,
                    role TEXT NOT NULL DEFAULT 'member',
                    flickr_user_id TEXT,
                    flickr_oauth_token TEXT,
                    flickr_oauth_secret TEXT,
                    created_at TIMESTAMPTZ DEFAULT now(),
                    updated_at TIMESTAMPTZ DEFAULT now()
                )
            """)
            # Migration: add Flickr token columns if upgrading from older schema
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS flickr_oauth_token TEXT")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS flickr_oauth_secret TEXT")
            # Migration: user avatar — can be a photo_id from the library or a custom uploaded image
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_photo_id TEXT")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_upload BYTEA")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    token TEXT UNIQUE NOT NULL,
                    expires_at TIMESTAMPTZ NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT now()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS invites (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    code TEXT UNIQUE NOT NULL,
                    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    role TEXT NOT NULL DEFAULT 'member',
                    used_by UUID REFERENCES users(id),
                    expires_at TIMESTAMPTZ NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT now()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code)")
            # ── API keys ────────────────────────────────────────────────
            cur.execute("""
                CREATE TABLE IF NOT EXISTS api_keys (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    key_hash TEXT NOT NULL,
                    key_prefix TEXT NOT NULL,
                    name TEXT NOT NULL DEFAULT 'Default',
                    last_used_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT now()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)")
            # ── Settings (key-value store for integrations) ─────────────
            cur.execute("""
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMPTZ DEFAULT now()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS notifications (
                    id SERIAL PRIMARY KEY,
                    type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    message TEXT,
                    metadata JSONB DEFAULT '{}',
                    read BOOLEAN DEFAULT false,
                    created_at TIMESTAMPTZ DEFAULT now()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read)")
            # Fuzzy name search support
            cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
            # Clean up expired sessions
            cur.execute("DELETE FROM sessions WHERE expires_at < now()")
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Warning: could not create new tables: {e}")

# ── DB helpers ────────────────────────────────────────────────────────────────
def get_db():
    conn = psycopg2.connect(DATABASE_URL)
    register_vector(conn)
    return conn

def db_query(sql, params=None, fetch=True):
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            if fetch:
                result = cur.fetchall()
            else:
                result = None
            conn.commit()
        return result
    finally:
        conn.close()

# ── Auth helpers ─────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))

def create_session(user_id: str) -> dict:
    token = secrets.token_hex(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    db_query(
        "INSERT INTO sessions (user_id, token, expires_at) VALUES (%s, %s, %s)",
        (user_id, token, expires_at),
        fetch=False,
    )
    return {"token": token, "expires_at": expires_at.isoformat()}

def validate_session(token: str) -> dict | None:
    rows = db_query(
        """SELECT u.id as user_id, u.username, u.display_name, u.role, u.flickr_user_id, u.avatar_photo_id
           FROM sessions s JOIN users u ON s.user_id = u.id
           WHERE s.token = %s AND s.expires_at > now()""",
        (token,),
    )
    if not rows:
        return None
    r = rows[0]
    return {
        "user_id": str(r["user_id"]),
        "username": r["username"],
        "display_name": r["display_name"],
        "role": r["role"],
        "flickr_user_id": r.get("flickr_user_id"),
        "avatar_photo_id": r.get("avatar_photo_id"),
    }

def generate_invite_code() -> str:
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no I/O/0/1 to avoid confusion
    return "".join(secrets.choice(chars) for _ in range(8))

def generate_api_key() -> tuple[str, str, str]:
    """Generate a new API key. Returns (raw_key, key_hash, key_prefix)."""
    raw_key = f"knd_{secrets.token_hex(32)}"
    key_hash = bcrypt.hashpw(raw_key.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    key_prefix = raw_key[:12]
    return raw_key, key_hash, key_prefix

def create_api_key(user_id: str, name: str = "Default") -> tuple[str, dict]:
    """Create and store a new API key. Returns (raw_key, key_record)."""
    raw_key, key_hash, key_prefix = generate_api_key()
    rows = db_query(
        """INSERT INTO api_keys (user_id, key_hash, key_prefix, name)
           VALUES (%s, %s, %s, %s) RETURNING id, key_prefix, name, created_at""",
        (user_id, key_hash, key_prefix, name),
    )
    record = rows[0]
    return raw_key, {
        "id": str(record["id"]),
        "key_prefix": record["key_prefix"],
        "name": record["name"],
        "created_at": record["created_at"].isoformat() if record["created_at"] else None,
    }

def validate_api_key(raw_key: str) -> dict | None:
    """Validate an API key against hashed values in DB. Returns user dict or None."""
    rows = db_query(
        """SELECT ak.id as key_id, ak.key_hash, ak.key_prefix,
                  u.id as user_id, u.username, u.display_name, u.role, u.flickr_user_id
           FROM api_keys ak JOIN users u ON ak.user_id = u.id"""
    )
    for row in rows:
        if bcrypt.checkpw(raw_key.encode("utf-8"), row["key_hash"].encode("utf-8")):
            # Update last_used_at (fire and forget)
            try:
                db_query("UPDATE api_keys SET last_used_at = now() WHERE id = %s",
                         (str(row["key_id"]),), fetch=False)
            except Exception:
                pass
            return {
                "user_id": str(row["user_id"]),
                "username": row["username"],
                "display_name": row["display_name"],
                "role": row["role"],
                "flickr_user_id": row.get("flickr_user_id"),
            }
    return None

def get_flickr_credentials() -> dict | None:
    """Get Flickr OAuth credentials from admin user in DB, falling back to env vars."""
    rows = db_query(
        "SELECT flickr_user_id, flickr_oauth_token, flickr_oauth_secret FROM users WHERE role = 'admin' AND flickr_user_id IS NOT NULL LIMIT 1"
    )
    if rows and rows[0].get("flickr_oauth_token") and rows[0].get("flickr_oauth_secret"):
        return {
            "user_id": rows[0]["flickr_user_id"],
            "oauth_token": rows[0]["flickr_oauth_token"],
            "oauth_secret": rows[0]["flickr_oauth_secret"],
        }
    # Fall back to env vars for backward compat
    if FLICKR_OAUTH_TOKEN and FLICKR_OAUTH_SECRET:
        return {
            "user_id": FLICKR_USER_ID,
            "oauth_token": FLICKR_OAUTH_TOKEN,
            "oauth_secret": FLICKR_OAUTH_SECRET,
        }
    return None

# ── Lazy model init ───────────────────────────────────────────────────────────
_face_app = None
_yolo = None
_clip_model = None
_clip_preprocess = None
_clip_tokenizer = None

def get_face_app():
    global _face_app
    if _face_app is None:
        from insightface.app import FaceAnalysis
        _face_app = FaceAnalysis(name="buffalo_l",
            root=os.path.join(os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache")), "insightface"),
            providers=["CPUExecutionProvider"])
        _face_app.prepare(ctx_id=0, det_size=(960, 960))
    return _face_app

def get_yolo():
    global _yolo
    if _yolo is None:
        from ultralytics import YOLO
        model_directory = os.path.join(os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache")), "ultralytics")
        os.makedirs(model_directory, exist_ok=True)
        _yolo = YOLO(os.path.join(model_directory, "yolov8n.pt"))
    return _yolo

def get_clip():
    global _clip_model, _clip_preprocess, _clip_tokenizer
    if _clip_model is None:
        import open_clip
        _clip_model, _, _clip_preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32", pretrained="laion2b_s34b_b79k"
        )
        _clip_tokenizer = open_clip.get_tokenizer("ViT-B-32")
        _clip_model.eval()
    return _clip_model, _clip_preprocess, _clip_tokenizer

PET_CLASSES     = {15: "cat", 16: "dog", 17: "horse", 18: "sheep", 19: "cow", 20: "elephant", 21: "bear", 22: "zebra", 23: "giraffe"}
VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

# ── Request models ────────────────────────────────────────────────────────────
class ProcessPhotoRequest(BaseModel):
    photo_id: str
    photo_url: Optional[str] = None

class ResendKeyRequest(BaseModel):
    api_key: str

class EmailInviteRequest(BaseModel):
    email: str
    name: Optional[str] = None

class AnalyzeRequest(BaseModel):
    photos: list[dict]

class BackupStatusRequest(BaseModel):
    flickr_photo_ids: list[str]

class ResumableUploadRequest(BaseModel):
    client_upload_id: str
    filename: str
    content_type: str
    byte_size: int
    title: str = ""
    description: str = ""
    taken_at_unix: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    album_id: str | None = None

class ShareCreateRequest(BaseModel):
    subject_type: str
    photo_id: str | None = None
    album_id: str | None = None
    title: str = ""
    password: str | None = None
    allow_download: bool = False
    expires_in_days: int | None = None


class ShareUnlockRequest(BaseModel):
    password: str | None = None


class AlbumCreateRequest(BaseModel):
    name: str
    description: str = ""

class ClusterRequest(BaseModel):
    category: str = "people"
    eps: float = 0.4
    min_samples: int = 2

class LabelRequest(BaseModel):
    category: str
    cluster_id: str
    name: str

class MergeRequest(BaseModel):
    category: str = "people"
    source_id: str
    target_id: str

class RemoveDetectionsRequest(BaseModel):
    category: str = "people"
    cluster_id: str
    detection_ids: list[str]

class SceneMoveRequest(BaseModel):
    photo_id: str
    from_scene: str
    to_scene: str

# ── Jobs (in-memory, transient) ───────────────────────────────────────────────
jobs: dict[str, dict] = {}

# ── Helpers ───────────────────────────────────────────────────────────────────
def bbox_chip_b64(img_bgr, bbox: list[float], pad: float = 0.18) -> str:
    import cv2
    h, w = img_bgr.shape[:2]
    x1, y1, x2, y2 = bbox
    bw, bh = x2 - x1, y2 - y1
    x1 = max(0, int(x1 - bw * pad))
    y1 = max(0, int(y1 - bh * pad))
    x2 = min(w, int(x2 + bw * pad))
    y2 = min(h, int(y2 + bh * pad))
    chip = img_bgr[y1:y2, x1:x2]
    if chip.size == 0:
        return ""
    ch, cw = chip.shape[:2]
    max_dim = 160
    if max(ch, cw) > max_dim:
        scale = max_dim / max(ch, cw)
        chip = cv2.resize(chip, (int(cw * scale), int(ch * scale)))
    _, buf = cv2.imencode(".jpg", chip, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode()

def clip_embed_image(img_bgr, bbox=None):
    """Get CLIP embedding for an image or a cropped region."""
    import torch
    from PIL import Image
    model, preprocess, _ = get_clip()
    if bbox:
        x1, y1, x2, y2 = [max(0, int(v)) for v in bbox]
        crop = img_bgr[y1:y2, x1:x2]
        if crop.size == 0:
            return None
    else:
        crop = img_bgr
    pil = Image.fromarray(crop[:, :, ::-1])  # BGR -> RGB
    tensor = preprocess(pil).unsqueeze(0)
    with torch.no_grad():
        emb = model.encode_image(tensor)
        emb = emb / emb.norm(dim=-1, keepdim=True)
    return emb[0].cpu().numpy()

def clip_embed_text(text: str):
    """Get CLIP embedding for a text query."""
    import torch
    model, _, tokenizer = get_clip()
    tokens = tokenizer([text])
    with torch.no_grad():
        emb = model.encode_text(tokens)
        emb = emb / emb.norm(dim=-1, keepdim=True)
    return emb[0].cpu().numpy()

def is_dismissed_face(conn, embedding, category, threshold=0.35):
    """Check if a face embedding is similar to any dismissed face centroid."""
    if category != "people" or len(embedding) != 512:
        return False
    vec = np.array(embedding, dtype=np.float32)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM dismissed_faces
            WHERE category = %s AND centroid IS NOT NULL
            AND (centroid <=> %s) < %s
            LIMIT 1
        """, (category, vec, threshold))
        return cur.fetchone() is not None

def insert_detection(conn, photo, category, subtype, bbox, score, embedding, img_bgr):
    # Check if this face looks like a previously dismissed person
    if is_dismissed_face(conn, embedding, category):
        return None

    # Skip if we already have a detection for this face in this photo
    # (prevents duplicates from re-scans at different det_size)
    # Also checks 'rejected' category — detections the user marked as misclassified
    if len(embedding) == 512:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT 1 FROM detections
                WHERE photo_id = %s AND category IN (%s, 'rejected') AND embedding IS NOT NULL
                AND (embedding <=> %s) < 0.15
                LIMIT 1
            """, (photo["id"], category, np.array(embedding, dtype=np.float32)))
            if cur.fetchone():
                return None

    chip = bbox_chip_b64(img_bgr, bbox)
    det_id = str(uuid.uuid4())
    bbox_json = json.dumps([round(v, 1) for v in bbox])
    vec = None
    if len(embedding) == 512:
        vec = np.array(embedding, dtype=np.float32)
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO detections (id, category, subtype, photo_id, photo_url, thumb_url,
                flickr_url, photo_title, owner, bbox, det_score, chip, embedding)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
        """, (
            det_id, category, subtype, photo["id"], photo["url"],
            photo.get("thumb", photo["url"]), photo.get("flickr_url", ""),
            photo.get("title", ""), photo.get("owner", ""),
            bbox_json, round(float(score), 3),
            chip, vec,
        ))
    # Track that this photo was processed
    with conn.cursor() as cur:
        cur.execute("INSERT INTO processed_photos (photo_id) VALUES (%s) ON CONFLICT DO NOTHING",
                   (photo["id"],))
    return det_id

def region_embedding(img_bgr, bbox: list, size: int = 64) -> list:
    import cv2
    h, w = img_bgr.shape[:2]
    x1, y1, x2, y2 = [max(0, int(v)) for v in bbox]
    x2, y2 = min(w, x2), min(h, y2)
    chip = img_bgr[y1:y2, x1:x2]
    if chip.size == 0:
        return [0.0] * (size * size * 3)
    chip = cv2.resize(chip, (size, size)).astype(np.float32) / 255.0
    return chip.flatten().tolist()

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    try:
        db_query("SELECT 1", fetch=True)
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        return {"status": "ok", "db": f"error: {e}"}

@app.get("/app-config")
def get_app_config():
    """Public config endpoint for mobile app setup. No auth required."""
    rows = db_query("SELECT COUNT(*) as cnt FROM users")
    setup_complete = rows[0]["cnt"] > 0 if rows else False
    return {
        "api_version": "1.0",
        "app_name": "Kindred",
        "setup_complete": setup_complete,
        "features": {
            "flickr_integration": bool(FLICKR_API_KEY),
            "flickr_connected": bool(get_flickr_credentials()),
            "face_detection": True,
            "pet_detection": True,
            "vehicle_detection": True,
        },
        "auth": {
            "method": "session",
            "header": "X-Session-Token",
        },
        "flickr": {
            "consumer_key": FLICKR_API_KEY,
            "consumer_secret": FLICKR_SECRET,
        } if FLICKR_API_KEY else None,
    }

# ── Auth endpoints ───────────────────────────────────────────────────────────

class SetupRequest(BaseModel):
    username: str
    display_name: str
    flickr_user_id: str
    flickr_oauth_token: Optional[str] = None
    flickr_oauth_secret: Optional[str] = None

@app.post("/auth/setup")
def auth_setup(req: SetupRequest):
    """First-run admin creation. Only works if no users exist."""
    rows = db_query("SELECT COUNT(*) as cnt FROM users")
    if rows and rows[0]["cnt"] > 0:
        raise HTTPException(409, "Setup already complete — admin user exists")
    user_rows = db_query(
        """INSERT INTO users (username, display_name, role, flickr_user_id, flickr_oauth_token, flickr_oauth_secret)
           VALUES (%s, %s, 'admin', %s, %s, %s) RETURNING id, username, display_name, role""",
        (req.username, req.display_name, req.flickr_user_id, req.flickr_oauth_token, req.flickr_oauth_secret),
    )
    user = user_rows[0]
    session = create_session(str(user["id"]))
    # Auto-generate an API key for the admin
    raw_key, key_record = create_api_key(str(user["id"]), name="Default")
    return {
        "user": {"id": str(user["id"]), "username": user["username"],
                 "display_name": user["display_name"], "role": user["role"]},
        "session": session,
        "api_key": raw_key,
        "api_key_info": key_record,
    }

class FlickrLoginRequest(BaseModel):
    flickr_user_id: str
    flickr_oauth_token: Optional[str] = None
    flickr_oauth_secret: Optional[str] = None

@app.post("/auth/flickr-login")
def auth_flickr_login(req: FlickrLoginRequest):
    """Admin re-login via Flickr OAuth. Finds admin by flickr_user_id and refreshes tokens."""
    rows = db_query(
        "SELECT id, username, display_name, role, avatar_photo_id, avatar_upload IS NOT NULL as has_avatar_upload FROM users WHERE flickr_user_id = %s AND role = 'admin'",
        (req.flickr_user_id,),
    )
    if not rows:
        raise HTTPException(401, "No admin account for this Flickr user")
    user = rows[0]
    # Update stored Flickr tokens on each login (they may have been re-authorized)
    if req.flickr_oauth_token and req.flickr_oauth_secret:
        db_query(
            "UPDATE users SET flickr_oauth_token = %s, flickr_oauth_secret = %s, updated_at = now() WHERE id = %s",
            (req.flickr_oauth_token, req.flickr_oauth_secret, str(user["id"])),
            fetch=False,
        )
    uid = str(user["id"])
    avatar_url = f"/users/{uid}/avatar" if (user.get("avatar_photo_id") or user.get("has_avatar_upload")) else None
    session = create_session(uid)
    return {
        "user": {"id": uid, "username": user["username"],
                 "display_name": user["display_name"], "role": user["role"],
                 "avatar_url": avatar_url},
        "session": session,
    }

class LoginRequest(BaseModel):
    username: str
    password: str

@app.post("/auth/login")
def auth_login(req: LoginRequest):
    """Member login with username/password."""
    if review_credentials_match(req.username, req.password):
        return build_review_auth_response(req.username)

    rows = db_query(
        "SELECT id, username, display_name, role, password_hash, avatar_photo_id, avatar_upload IS NOT NULL as has_avatar_upload FROM users WHERE username = %s",
        (req.username,),
    )
    if not rows or not rows[0]["password_hash"]:
        raise HTTPException(401, "Invalid username or password")
    user = rows[0]
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Invalid username or password")
    uid = str(user["id"])
    avatar_url = f"/users/{uid}/avatar" if (user.get("avatar_photo_id") or user.get("has_avatar_upload")) else None
    session = create_session(uid)
    return {
        "user": {"id": uid, "username": user["username"],
                 "display_name": user["display_name"], "role": user["role"],
                 "avatar_url": avatar_url},
        "session": session,
    }

class RegisterRequest(BaseModel):
    invite_code: str
    username: str
    display_name: str
    password: str

@app.post("/auth/register")
def auth_register(req: RegisterRequest):
    """Member registration with invite code."""
    invites = db_query(
        "SELECT id, role FROM invites WHERE code = %s AND used_by IS NULL AND expires_at > now()",
        (req.invite_code.upper(),),
    )
    if not invites:
        raise HTTPException(400, "Invalid or expired invite code")
    invite = invites[0]
    if len(req.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    pw_hash = hash_password(req.password)
    try:
        user_rows = db_query(
            """INSERT INTO users (username, display_name, password_hash, role)
               VALUES (%s, %s, %s, %s) RETURNING id, username, display_name, role""",
            (req.username, req.display_name, pw_hash, invite["role"]),
        )
    except Exception as e:
        if "unique" in str(e).lower():
            raise HTTPException(409, "Username already taken")
        raise
    user = user_rows[0]
    db_query("UPDATE invites SET used_by = %s WHERE id = %s", (str(user["id"]), str(invite["id"])), fetch=False)
    session = create_session(str(user["id"]))
    return {
        "user": {"id": str(user["id"]), "username": user["username"],
                 "display_name": user["display_name"], "role": user["role"]},
        "session": session,
    }

@app.post("/auth/logout")
def auth_logout(request: FastAPIRequest):
    """Invalidate the current session."""
    token = request.headers.get("X-Session-Token")
    if token:
        db_query("DELETE FROM sessions WHERE token = %s", (token,), fetch=False)
    return {"ok": True}

@app.get("/auth/me")
def auth_me(request: FastAPIRequest):
    """Return current user info from session."""
    user = getattr(request.state, "user", None)
    if not user or not user.get("user_id"):
        return {"loggedIn": False}
    # Build avatar URL if the user has one
    avatar_url = None
    if user.get("avatar_photo_id"):
        avatar_url = f"/users/{user['user_id']}/avatar"
    elif user.get("user_id"):
        # Check if they have a custom upload
        rows = db_query("SELECT avatar_upload IS NOT NULL as has_upload FROM users WHERE id = %s", (user["user_id"],))
        if rows and rows[0].get("has_upload"):
            avatar_url = f"/users/{user['user_id']}/avatar"
    return {
        "loggedIn": True,
        "userId": user["user_id"],
        "username": user["username"],
        "display_name": user["display_name"],
        "role": user["role"],
        "auth_method": user.get("auth_method", "session"),
        "avatar_url": avatar_url,
    }

# ── API key management endpoints ──────────────────────────────────────────────

class CreateApiKeyRequest(BaseModel):
    name: str = "Default"

@app.post("/api-keys")
def create_api_key_endpoint(req: CreateApiKeyRequest, user=Depends(get_current_user)):
    """Generate a new API key. The raw key is returned once and never stored."""
    raw_key, key_record = create_api_key(user["user_id"], name=req.name)
    return {
        "api_key": raw_key,
        "key": key_record,
        "warning": "Save this key now — it will not be shown again.",
    }

@app.get("/api-keys")
def list_api_keys(user=Depends(get_current_user)):
    """List API keys for the current user (prefix only, not the full key)."""
    rows = db_query(
        """SELECT id, key_prefix, name, last_used_at, created_at
           FROM api_keys WHERE user_id = %s ORDER BY created_at DESC""",
        (user["user_id"],),
    )
    return {"keys": [{
        "id": str(r["id"]),
        "key_prefix": r["key_prefix"],
        "name": r["name"],
        "last_used_at": r["last_used_at"].isoformat() if r["last_used_at"] else None,
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
    } for r in rows]}

@app.delete("/api-keys/{key_id}")
def delete_api_key(key_id: str, user=Depends(get_current_user)):
    """Delete an API key."""
    db_query("DELETE FROM api_keys WHERE id = %s AND user_id = %s",
             (key_id, user["user_id"]), fetch=False)
    return {"ok": True}

@app.post("/api-keys/{key_id}/roll")
def roll_api_key(key_id: str, user=Depends(get_current_user)):
    """Regenerate an API key. Old key is invalidated, new raw key is returned once."""
    rows = db_query("SELECT name FROM api_keys WHERE id = %s AND user_id = %s",
                    (key_id, user["user_id"]))
    if not rows:
        raise HTTPException(404, "API key not found")
    name = rows[0]["name"]
    raw_key, key_hash, key_prefix = generate_api_key()
    db_query(
        "UPDATE api_keys SET key_hash = %s, key_prefix = %s, last_used_at = NULL, created_at = now() WHERE id = %s",
        (key_hash, key_prefix, key_id), fetch=False,
    )
    return {
        "api_key": raw_key,
        "key": {"id": key_id, "key_prefix": key_prefix, "name": name,
                "last_used_at": None, "created_at": datetime.now(timezone.utc).isoformat()},
        "warning": "Save this key now — it will not be shown again.",
    }

# ── Household management endpoints (admin-only) ─────────────────────────────

@app.get("/users")
def list_users(admin=Depends(require_admin)):
    rows = db_query("SELECT id, username, display_name, role, flickr_user_id, avatar_photo_id, avatar_upload IS NOT NULL as has_avatar_upload, created_at FROM users ORDER BY created_at")
    def user_avatar_url(r):
        uid = str(r["id"])
        if r.get("avatar_photo_id") or r.get("has_avatar_upload"):
            return f"/users/{uid}/avatar"
        return None
    return {"users": [{"id": str(r["id"]), "username": r["username"], "display_name": r["display_name"],
                        "role": r["role"], "flickr_user_id": r.get("flickr_user_id"),
                        "avatar_url": user_avatar_url(r),
                        "created_at": r["created_at"].isoformat() if r["created_at"] else None}
                       for r in rows]}

class UpdateUserRequest(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None

@app.patch("/users/{user_id}")
def update_user(user_id: str, req: UpdateUserRequest, admin=Depends(require_admin)):
    sets, params = [], []
    if req.display_name is not None:
        sets.append("display_name = %s")
        params.append(req.display_name)
    if req.role is not None:
        if req.role not in ("admin", "member"):
            raise HTTPException(400, "Role must be 'admin' or 'member'")
        sets.append("role = %s")
        params.append(req.role)
    if not sets:
        raise HTTPException(400, "Nothing to update")
    sets.append("updated_at = now()")
    params.append(user_id)
    db_query(f"UPDATE users SET {', '.join(sets)} WHERE id = %s", params, fetch=False)
    return {"ok": True}

class ChangePasswordRequest(BaseModel):
    current_password: Optional[str] = None
    new_password: str

@app.post("/auth/change-password")
def change_password(req: ChangePasswordRequest, user=Depends(get_current_user)):
    """Change the current user's password. If no password was set (Flickr-only admin), current_password is optional."""
    if len(req.new_password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    rows = db_query("SELECT password_hash FROM users WHERE id = %s", (user["user_id"],))
    if not rows:
        raise HTTPException(404, "User not found")
    existing_hash = rows[0]["password_hash"]
    # If user already has a password, verify the current one
    if existing_hash and req.current_password:
        if not verify_password(req.current_password, existing_hash):
            raise HTTPException(401, "Current password is incorrect")
    elif existing_hash and not req.current_password:
        raise HTTPException(400, "Current password is required")
    new_hash = hash_password(req.new_password)
    db_query("UPDATE users SET password_hash = %s, updated_at = now() WHERE id = %s",
             (new_hash, user["user_id"]), fetch=False)
    return {"ok": True}

@app.delete("/users/{user_id}")
def delete_user(user_id: str, request: FastAPIRequest, admin=Depends(require_admin)):
    if admin["user_id"] == user_id:
        raise HTTPException(400, "Cannot delete yourself")
    db_query("DELETE FROM users WHERE id = %s", (user_id,), fetch=False)
    return {"ok": True}

# ── User avatar endpoints ───────────────────────────────────────────────────

from fastapi import UploadFile, File, Form

class SetAvatarPhotoRequest(BaseModel):
    photo_id: str

@app.put("/users/me/avatar")
async def set_user_avatar(request: FastAPIRequest, user=Depends(get_current_user)):
    """Set the current user's avatar. Accepts JSON with photo_id or multipart file upload."""
    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type:
        # Multipart file upload
        form = await request.form()
        file = form.get("file")
        if not file:
            raise HTTPException(400, "No file provided")
        image_data = await file.read()
        if len(image_data) > 5 * 1024 * 1024:
            raise HTTPException(400, "Image must be under 5MB")
        # Store as uploaded avatar, clear photo_id reference
        conn = get_db()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE users SET avatar_upload = %s, avatar_photo_id = NULL, updated_at = now() WHERE id = %s",
                    (psycopg2.Binary(image_data), user["user_id"]),
                )
            conn.commit()
        finally:
            conn.close()
        return {"ok": True, "avatar_url": f"/users/{user['user_id']}/avatar"}
    else:
        # JSON body with photo_id
        body = await request.json()
        photo_id = body.get("photo_id")
        if not photo_id:
            raise HTTPException(400, "photo_id is required")
        # Verify the photo exists in the library (check detections or photo_metadata)
        rows = db_query(
            "SELECT photo_id FROM photo_metadata WHERE photo_id = %s UNION SELECT DISTINCT photo_id FROM detections WHERE photo_id = %s LIMIT 1",
            (photo_id, photo_id),
        )
        if not rows:
            raise HTTPException(404, "Photo not found in library")
        # Store photo_id reference, clear uploaded avatar
        db_query(
            "UPDATE users SET avatar_photo_id = %s, avatar_upload = NULL, updated_at = now() WHERE id = %s",
            (photo_id, user["user_id"]),
            fetch=False,
        )
        return {"ok": True, "avatar_url": f"/users/{user['user_id']}/avatar"}

@app.get("/users/{user_id}/avatar")
async def get_user_avatar(user_id: str, size: str = "q", user=Depends(get_current_user)):
    """Return the user's avatar image. If from library, proxies from Flickr. If uploaded, returns the stored image."""
    rows = db_query(
        "SELECT avatar_photo_id, avatar_upload FROM users WHERE id = %s",
        (user_id,),
    )
    if not rows:
        raise HTTPException(404, "User not found")
    row = rows[0]

    # Custom upload takes priority
    if row.get("avatar_upload"):
        image_data = bytes(row["avatar_upload"])
        # Detect content type from magic bytes
        ct = "image/jpeg"
        if image_data[:4] == b'\x89PNG':
            ct = "image/png"
        elif image_data[:4] == b'RIFF' and image_data[8:12] == b'WEBP':
            ct = "image/webp"
        return StreamingResponse(
            iter([image_data]),
            media_type=ct,
            headers={"Cache-Control": "private, max-age=3600"},
        )

    # From library photo — proxy via Flickr
    if row.get("avatar_photo_id"):
        # Reuse the existing photo proxy logic
        return await proxy_photo_image(row["avatar_photo_id"], size=size, user=user)

    raise HTTPException(404, "No avatar set")

@app.delete("/users/me/avatar")
def delete_user_avatar(user=Depends(get_current_user)):
    """Remove the current user's avatar."""
    db_query(
        "UPDATE users SET avatar_photo_id = NULL, avatar_upload = NULL, updated_at = now() WHERE id = %s",
        (user["user_id"],),
        fetch=False,
    )
    return {"ok": True}

@app.post("/invites")
def create_invite(request: FastAPIRequest, admin=Depends(require_admin)):
    code = generate_invite_code()
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    db_query(
        "INSERT INTO invites (code, created_by, expires_at) VALUES (%s, %s, %s)",
        (code, admin["user_id"], expires_at),
        fetch=False,
    )
    return {"code": code, "expires_at": expires_at.isoformat()}

@app.get("/invites")
def list_invites(admin=Depends(require_admin)):
    rows = db_query(
        "SELECT id, code, role, expires_at, created_at FROM invites WHERE used_by IS NULL AND expires_at > now() ORDER BY created_at DESC"
    )
    return {"invites": [{"id": str(r["id"]), "code": r["code"], "role": r["role"],
                          "expires_at": r["expires_at"].isoformat() if r["expires_at"] else None,
                          "created_at": r["created_at"].isoformat() if r["created_at"] else None}
                         for r in rows]}

@app.delete("/invites/{invite_id}")
def revoke_invite(invite_id: str, admin=Depends(require_admin)):
    db_query("DELETE FROM invites WHERE id = %s", (invite_id,), fetch=False)
    return {"ok": True}

# ── Settings / Integrations ─────────────────────────────────────────────────

def _mask_key(key: str) -> str:
    """Return a masked preview of an API key, e.g. 're_BFc...'"""
    if len(key) <= 6:
        return key[:2] + "..."
    return key[:6] + "..."

@app.put("/settings/integrations/resend")
def save_resend_key(request: FastAPIRequest, admin=Depends(require_admin)):
    """Save the Resend API key to the database (admin only).
    Key is sent via X-Integration-Secret header to avoid payload exposure."""
    key = request.headers.get("X-Integration-Secret", "").strip()
    if not key:
        raise HTTPException(400, "API key must be sent in X-Integration-Secret header")
    if not key.startswith("re_"):
        raise HTTPException(400, "Invalid Resend key — must start with 're_'")
    if len(key) < 20 or len(key) > 100:
        raise HTTPException(400, "Invalid Resend key length")
    if " " in key or "\n" in key:
        raise HTTPException(400, "Invalid Resend key — contains whitespace")
    # Store with a simple obfuscation prefix so it's not raw in DB
    import base64
    stored = base64.b64encode(key.encode()).decode()
    db_query(
        """INSERT INTO settings (key, value, updated_at) VALUES ('resend_api_key', %s, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""",
        (stored,),
        fetch=False,
    )
    return {"configured": True, "key_preview": _mask_key(key)}

@app.get("/settings/integrations/resend")
def get_resend_status(admin=Depends(require_admin)):
    """Check whether a Resend API key is configured (admin only)."""
    import base64
    rows = db_query("SELECT value FROM settings WHERE key = 'resend_api_key'")
    if not rows or not rows[0]["value"]:
        return {"configured": False, "key_preview": None}
    try:
        decoded = base64.b64decode(rows[0]["value"]).decode()
    except Exception:
        decoded = rows[0]["value"]
    return {"configured": True, "key_preview": _mask_key(decoded)}

@app.delete("/settings/integrations/resend")
def remove_resend_key(admin=Depends(require_admin)):
    """Remove the stored Resend API key (admin only)."""
    db_query("DELETE FROM settings WHERE key = 'resend_api_key'", fetch=False)
    return {"configured": False}

def _get_resend_key() -> str | None:
    """Retrieve the Resend API key from the database (base64-decoded)."""
    import base64
    rows = db_query("SELECT value FROM settings WHERE key = 'resend_api_key'")
    if rows and rows[0]["value"]:
        try:
            return base64.b64decode(rows[0]["value"]).decode()
        except Exception:
            return rows[0]["value"]  # Fallback for pre-encoded keys
    return None

@app.post("/invites/send-email")
def send_email_invite(req: EmailInviteRequest, request: FastAPIRequest, admin=Depends(require_admin)):
    """Create an invite AND send it via email using the stored Resend API key."""
    resend_key = _get_resend_key()
    if not resend_key:
        raise HTTPException(400, "Resend is not configured. Add your API key under Settings > Integrations.")

    # Create the invite
    code = generate_invite_code()
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    db_query(
        "INSERT INTO invites (code, created_by, expires_at) VALUES (%s, %s, %s)",
        (code, admin["user_id"], expires_at),
        fetch=False,
    )

    # Send the email via Resend (using httpx to avoid Cloudflare blocks)
    email_payload = {
        "from": os.getenv("RESEND_FROM_EMAIL", "Kindred Photos <noreply@mail.kindredphotos.app>"),
        "to": [req.email],
        "subject": f"{admin.get('display_name', 'Someone')} invited you to Kindred Photos",
        "html": _build_invite_email_html(
            inviter_name=admin.get("display_name", "A family member"),
            invite_code=code,
            recipient_name=req.name,
        ),
    }

    email_sent = False
    email_error = None
    try:
        import httpx
        resp = httpx.post(
            "https://api.resend.com/emails",
            json=email_payload,
            headers={"Authorization": f"Bearer {resend_key}"},
            timeout=15,
        )
        if resp.status_code < 300:
            email_sent = True
        else:
            email_error = resp.text
    except Exception as e:
        email_error = str(e)

    return {
        "code": code,
        "expires_at": expires_at.isoformat(),
        "email": req.email,
        "email_sent": email_sent,
        "email_error": email_error,
    }


def _build_invite_email_html(inviter_name: str, invite_code: str, recipient_name: str | None = None) -> str:
    """Build the branded invite email HTML."""
    app_url = "https://kindredphotos.app"
    join_url = f"{app_url}/join/{invite_code}"
    greeting = f"Hi {recipient_name}," if recipient_name else "Hi there,"

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#fbf4e7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fbf4e7;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#fffdf8;border-radius:12px;border:1px solid rgba(74,40,26,.12);overflow:hidden;">
          <!-- Wordmark -->
          <tr>
            <td style="padding:28px 36px 16px;text-align:center;">
              <span style="font-family:'Space Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;color:#2a201b;letter-spacing:-0.01em;">Kindred Photos</span>
            </td>
          </tr>
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#2a201b,#3a2818);padding:32px 36px;margin-top:20px;">
              <p style="font-family:monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#e9b85d;margin:0 0 8px;">You're invited</p>
              <h1 style="font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:700;color:#fbf4e7;margin:0;line-height:1.1;">{inviter_name} opened the family archive to you.</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 36px;">
              <p style="font-size:15px;line-height:1.6;color:#6d3c24;margin:0 0 20px;">
                {greeting}
              </p>
              <p style="font-size:15px;line-height:1.6;color:#6d3c24;margin:0 0 20px;">
                You've been invited to join a family photo library on <strong>Kindred Photos</strong>.
                Once you join, you'll see photos organized by people, places, and moments &mdash; all
                powered by AI, all stored on the family's own Flickr account.
              </p>
              <p style="font-size:15px;line-height:1.6;color:#6d3c24;margin:0 0 28px;">
                Click below to set up your account. It takes about 30 seconds.
              </p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="{join_url}" style="display:inline-block;background:#c9551c;color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;padding:14px 32px;border-radius:8px;">
                      Join the library
                    </a>
                  </td>
                </tr>
              </table>
              <!-- Invite code fallback -->
              <p style="font-size:12px;line-height:1.6;color:#946f5b;margin:24px 0 0;text-align:center;">
                Or enter this code manually: <strong style="font-family:monospace;letter-spacing:0.1em;color:#2a201b;">{invite_code}</strong>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 36px;border-top:1px solid rgba(74,40,26,.08);">
              <p style="font-family:monospace;font-size:10px;color:#946f5b;margin:0;text-align:center;">
                Kindred Photos &middot; A product of Kindling Signal &middot; <a href="{app_url}" style="color:#946f5b;">kindredphotos.app</a><br>
                This invite expires in 7 days.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

# ── Analysis endpoints ───────────────────────────────────────────────────────

@app.post("/analyze")
async def analyze_photos(req: AnalyzeRequest, background_tasks: BackgroundTasks, admin=Depends(require_admin)):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "running", "progress": 0,
        "total": len(req.photos), "message": "Starting...",
        "counts": {"people": 0, "pets": 0, "vehicles": 0},
    }
    background_tasks.add_task(_run_analysis, job_id, req.photos)
    return {"job_id": job_id}

@app.post("/process-photo")
async def process_photo(req: ProcessPhotoRequest, admin=Depends(require_admin)):
    """Process a single newly-uploaded photo through the full ML pipeline.

    Accepts photo_id and optional photo_url. If photo_url is not provided,
    constructs it via the Flickr API (flickr.photos.getInfo).
    """
    import cv2
    import urllib.parse

    photo_id = req.photo_id
    photo_url = req.photo_url

    # If no URL provided, look it up from Flickr
    if not photo_url:
        flickr_creds = get_flickr_credentials()
        if not FLICKR_API_KEY or not flickr_creds:
            raise HTTPException(500, "Flickr OAuth not configured")
        flickr_url = "https://api.flickr.com/services/rest"
        params = {
            "method": "flickr.photos.getInfo",
            "photo_id": photo_id,
            "format": "json",
            "nojsoncallback": "1",
        }
        oauth_params = _flickr_oauth_sign(flickr_url, params)
        auth_header = "OAuth " + ", ".join(
            f'{k}="{urllib.parse.quote(str(v), "")}"'
            for k, v in oauth_params.items()
        )
        qs = urllib.parse.urlencode(params)
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{flickr_url}?{qs}", headers={"Authorization": auth_header})
            data = resp.json()
        if data.get("stat") != "ok":
            raise HTTPException(400, f"Could not fetch photo info: {data.get('message', 'unknown')}")
        info = data["photo"]
        server = info.get("server", "")
        secret = info.get("secret", "")
        farm = info.get("farm", "")
        photo_url = f"https://live.staticflickr.com/{server}/{photo_id}_{secret}_z.jpg"

    # Build a photo dict compatible with insert_detection / _run_analysis
    flickr_creds_for_owner = get_flickr_credentials()
    owner_id = (flickr_creds_for_owner or {}).get("user_id", "") or ""
    photo = {
        "id": photo_id,
        "url": photo_url,
        "title": "",
        "owner": owner_id,
        "thumb": photo_url.replace("_z.jpg", "_q.jpg") if "_z.jpg" in photo_url else photo_url,
        "flickr_url": f"https://www.flickr.com/photos/{owner_id}/{photo_id}" if owner_id else "",
    }

    # If we fetched info above, use it for title
    if 'info' in dir() or 'info' in locals():
        try:
            photo["title"] = info.get("title", {}).get("_content", "") if isinstance(info.get("title"), dict) else str(info.get("title", ""))
        except Exception:
            pass

    # Download the image
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(photo_url)
        resp.raise_for_status()
    arr = np.frombuffer(resp.content, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Could not decode image")

    face_app = get_face_app()
    yolo = get_yolo()
    conn = get_db()

    counts = {"people": 0, "pets": 0, "vehicles": 0}

    try:
        # Face detection
        faces = face_app.get(img)
        for face in faces:
            bbox = face.bbox.tolist()
            bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
            if bw < 24 or bh < 24:
                continue
            x1, y1 = max(0, int(bbox[0])), max(0, int(bbox[1]))
            x2, y2 = min(img.shape[1], int(bbox[2])), min(img.shape[0], int(bbox[3]))
            face_crop = img[y1:y2, x1:x2]
            if face_crop.size > 0:
                gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
                if cv2.Laplacian(gray, cv2.CV_64F).var() < 15:
                    continue
            if float(face.det_score) < 0.35:
                continue
            insert_detection(conn, photo, "people", "face",
                bbox, float(face.det_score),
                face.embedding.tolist(), img)
            counts["people"] += 1

        # YOLO object detection
        yolo_results = yolo(img[:, :, ::-1], verbose=False)
        for box in yolo_results[0].boxes:
            cls_id = int(box.cls[0])
            score = float(box.conf[0])
            if score < 0.4:
                continue
            xyxy = box.xyxy[0].tolist()
            clip_emb = clip_embed_image(img, bbox=xyxy)
            emb_list = clip_emb.tolist() if clip_emb is not None else []
            if cls_id in PET_CLASSES:
                insert_detection(conn, photo, "pets", PET_CLASSES[cls_id],
                    xyxy, score, emb_list, img)
                counts["pets"] += 1
            elif cls_id in VEHICLE_CLASSES:
                insert_detection(conn, photo, "vehicles", VEHICLE_CLASSES[cls_id],
                    xyxy, score, emb_list, img)
                counts["vehicles"] += 1

        # CLIP photo embedding
        photo_clip = clip_embed_image(img)
        if photo_clip is not None:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO photo_embeddings (photo_id, clip_embedding)
                    VALUES (%s, %s) ON CONFLICT (photo_id) DO NOTHING
                """, (photo_id, np.array(photo_clip, dtype=np.float32)))

        # Dominant colors
        try:
            colors = _extract_dominant_colors(img)
            if colors:
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO photo_colors (photo_id, colors)
                        VALUES (%s, %s) ON CONFLICT (photo_id) DO NOTHING
                    """, (photo_id, json.dumps(colors)))
        except Exception:
            pass

        conn.commit()

        # Re-cluster categories that got new detections
        for cat in ("people", "pets", "vehicles"):
            if counts[cat] > 0:
                try:
                    run_clustering(cat, distance_threshold=0.80)
                except Exception as e:
                    print(f"  process-photo cluster {cat} failed: {e}")

    except Exception as e:
        conn.rollback()
        raise HTTPException(500, f"ML processing failed: {e}")
    finally:
        conn.close()

    if sum(counts.values()) > 0:
        create_notification("photo_processed", "Photo processed",
            f"{counts['people']} faces · {counts['pets']} animals · {counts['vehicles']} vehicles",
            {"photo_id": photo_id})

    return {
        "photo_id": photo_id,
        "counts": counts,
        "message": f"Processed: {counts['people']} faces, {counts['pets']} pets, {counts['vehicles']} vehicles",
    }


@app.get("/jobs/active")
def get_active_job():
    """Return the currently running job, if any."""
    for jid, j in jobs.items():
        if j.get("status") == "running":
            return {"job_id": jid, **j}
    return {"job_id": None, "status": "idle"}

@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    return jobs[job_id]

@app.get("/jobs/{job_id}/stream")
async def stream_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")

    async def event_stream():
        while True:
            if job_id not in jobs:
                break
            data = json.dumps(jobs[job_id])
            yield f"data: {data}\n\n"
            if jobs[job_id]["status"] in ("done", "error"):
                break
            await asyncio.sleep(1)

    return StreamingResponse(event_stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

def _clean_named_clusters_by_subtype(category: str):
    """Remove wrong-species detections from named animal clusters.

    For each named cluster, find the dominant species and unpin+remove
    any detections that don't match. Those freed detections will be
    picked up by _run_subtype_clustering afterwards.
    """
    # Get human-labeled clusters in this category (auto-labeled get fully reclustered)
    named_clusters = db_query("""
        SELECT c.id, c.label FROM clusters c
        WHERE c.category = %s AND c.label IS NOT NULL AND c.label_source = 'human'
    """, (category,))

    if not named_clusters:
        print(f"  No named clusters to clean in {category}")
        return 0

    total_removed = 0
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            for cluster in named_clusters:
                cid = cluster["id"]
                label = cluster["label"]

                # Get subtype breakdown for this cluster
                cur.execute("""
                    SELECT d.subtype, COUNT(*) as cnt,
                           array_agg(dc.detection_id::text) as det_ids
                    FROM detection_clusters dc
                    JOIN detections d ON d.id = dc.detection_id
                    WHERE dc.cluster_id = %s AND dc.category = %s
                    GROUP BY d.subtype
                    ORDER BY cnt DESC
                """, (cid, category))
                subtypes = cur.fetchall()

                if len(subtypes) <= 1:
                    # Already pure or empty
                    continue

                # Dominant species = the one with the most detections
                dominant = subtypes[0]["subtype"]
                dominant_count = subtypes[0]["cnt"]

                # Remove non-dominant species detections
                for st in subtypes[1:]:
                    raw_ids = st["det_ids"]
                    # array_agg may return a list of strings or a pg array string
                    if isinstance(raw_ids, str):
                        wrong_ids = [x.strip() for x in raw_ids.strip("{}").split(",") if x.strip()]
                    elif isinstance(raw_ids, list):
                        wrong_ids = [str(x) for x in raw_ids]
                    else:
                        continue
                    n = len(wrong_ids)
                    total_removed += n
                    print(f"  [{label}] removing {n} {st['subtype']} (keeping {dominant_count} {dominant})")

                    # Unpin and move each to its own new cluster
                    for det_id in wrong_ids:
                        new_cid = str(uuid.uuid4())
                        cur.execute("""
                            UPDATE detection_clusters
                            SET cluster_id = %s, pinned = false
                            WHERE detection_id = %s::uuid AND cluster_id = %s AND category = %s
                        """, (new_cid, det_id, cid, category))

        conn.commit()
    finally:
        conn.close()

    print(f"  Cleaned {len(named_clusters)} named clusters, removed {total_removed} wrong-species detections")
    return total_removed


def _run_subtype_clustering(category: str, distance_threshold: float = 0.80):
    """Cluster animals/vehicles by subtype first, then by visual similarity within subtype."""
    from sklearn.cluster import AgglomerativeClustering
    from sklearn.preprocessing import normalize

    # Get protected detections: only those pinned OR in a HUMAN-labeled cluster
    pinned_rows = db_query("""
        SELECT dc.detection_id FROM detection_clusters dc
        WHERE dc.category = %s AND (dc.pinned = true OR EXISTS (
            SELECT 1 FROM clusters c WHERE c.id = dc.cluster_id AND c.category = dc.category
            AND c.label IS NOT NULL AND c.label_source = 'human'
        ))
    """, (category,))
    pinned_ids = {r["detection_id"] for r in pinned_rows}

    # Get all non-protected detections with subtype
    rows = db_query("""
        SELECT id, subtype, embedding FROM detections
        WHERE category = %s AND embedding IS NOT NULL
    """, (category,))
    unpinned = [(r["id"], r["subtype"], r["embedding"]) for r in rows if r["id"] not in pinned_ids]

    if not unpinned:
        return

    # Group by subtype
    by_subtype: dict[str, list] = {}
    for det_id, subtype, emb in unpinned:
        by_subtype.setdefault(subtype, []).append((det_id, emb))

    conn = get_db()
    try:
        with conn.cursor() as cur:
            # Clear non-protected assignments (not pinned and not human-labeled)
            cur.execute("""
                DELETE FROM detection_clusters
                WHERE category = %s AND pinned = false
                  AND NOT EXISTS (
                    SELECT 1 FROM clusters c
                    WHERE c.id = detection_clusters.cluster_id
                      AND c.category = detection_clusters.category
                      AND c.label IS NOT NULL AND c.label_source = 'human'
                  )
            """, (category,))

            from psycopg2.extras import execute_values
            all_values = []

            for subtype, items in by_subtype.items():
                if len(items) < 2:
                    # Single detection gets its own cluster named by subtype
                    cid = str(uuid.uuid4())
                    all_values.append((items[0][0], cid, category, False))
                    continue

                ids = [i[0] for i in items]
                vecs = normalize(np.array([i[1] for i in items], dtype=np.float32))

                clustering = AgglomerativeClustering(
                    n_clusters=None,
                    distance_threshold=distance_threshold,
                    metric="cosine",
                    linkage="average",
                )
                labels = clustering.fit_predict(vecs)

                label_to_uuid: dict[int, str] = {}
                for lbl in set(labels):
                    label_to_uuid[int(lbl)] = str(uuid.uuid4())

                for i in range(len(ids)):
                    all_values.append((ids[i], label_to_uuid[int(labels[i])], category, False))

            if all_values:
                execute_values(cur,
                    "INSERT INTO detection_clusters (detection_id, cluster_id, category, pinned) VALUES %s",
                    all_values)
        conn.commit()
    finally:
        conn.close()

    # Auto-label clusters by their subtype
    # Get cluster → subtype mapping
    subtype_rows = db_query("""
        SELECT dc.cluster_id, d.subtype, COUNT(*) as cnt
        FROM detection_clusters dc
        JOIN detections d ON d.id = dc.detection_id
        WHERE dc.category = %s AND dc.pinned = false
        GROUP BY dc.cluster_id, d.subtype
        ORDER BY cnt DESC
    """, (category,))

    for r in subtype_rows:
        # Only auto-label if no existing human label
        existing = db_query("SELECT label, label_source FROM clusters WHERE id = %s AND category = %s", (r["cluster_id"], category))
        if not existing or not existing[0].get("label") or existing[0].get("label_source") != "human":
            label = r["subtype"].capitalize()
            if r["cnt"] > 1:
                label = f"{label} ({r['cnt']})"
            db_query("""
                INSERT INTO clusters (id, category, label, label_source) VALUES (%s, %s, %s, 'auto')
                ON CONFLICT (id, category) DO UPDATE SET label = EXCLUDED.label, label_source = 'auto'
            """, (r["cluster_id"], category, label), fetch=False)

    invalidate_cache()
    print(f"  Clustering {category}: {len(by_subtype)} subtypes, {sum(len(v) for v in by_subtype.values())} detections")


def run_clustering(category: str, distance_threshold: float = 0.80):
    """Three-phase clustering for people, subtype-based for animals/vehicles."""
    # For animals: clean named clusters first, then cluster remaining by subtype
    if category in ("pets", "vehicles"):
        _clean_named_clusters_by_subtype(category)
        return _run_subtype_clustering(category, distance_threshold)

    # For people: full three-phase clustering
    from sklearn.cluster import AgglomerativeClustering
    from sklearn.preprocessing import normalize
    from sklearn.metrics.pairwise import cosine_distances

    # Get protected detections: pinned OR in a labeled/named cluster
    pinned_rows = db_query("""
        SELECT dc.detection_id, dc.cluster_id, d.embedding
        FROM detection_clusters dc
        JOIN detections d ON d.id = dc.detection_id
        WHERE dc.category = %s AND d.embedding IS NOT NULL
          AND (dc.pinned = true OR EXISTS (
            SELECT 1 FROM clusters c WHERE c.id = dc.cluster_id AND c.category = dc.category AND c.label IS NOT NULL
          ))
    """, (category,))
    pinned_ids = {r["detection_id"] for r in pinned_rows}

    # Build exemplar sets for each named/pinned cluster
    # Instead of a single averaged centroid, keep up to 15 diverse exemplars
    # per person. This handles kids aging, different expressions, lighting.
    cluster_embeddings: dict[str, list] = {}
    for r in pinned_rows:
        cluster_embeddings.setdefault(r["cluster_id"], []).append(r["embedding"])

    MAX_EXEMPLARS = 15
    exemplars: dict[str, np.ndarray] = {}  # cluster_id -> (N, 512) matrix
    for cid, embs in cluster_embeddings.items():
        all_vecs = normalize(np.array(embs, dtype=np.float32))
        if len(all_vecs) <= MAX_EXEMPLARS:
            exemplars[cid] = all_vecs
        elif len(all_vecs) <= 100:
            # For medium clusters, pick evenly spaced samples
            indices = np.linspace(0, len(all_vecs) - 1, MAX_EXEMPLARS, dtype=int)
            exemplars[cid] = all_vecs[indices]
        else:
            # For large clusters, random sample for speed
            rng = np.random.default_rng(42)
            indices = rng.choice(len(all_vecs), MAX_EXEMPLARS, replace=False)
            exemplars[cid] = all_vecs[indices]

    # Get all unpinned detections
    rows = db_query(
        "SELECT id, embedding FROM detections WHERE category = %s AND embedding IS NOT NULL",
        (category,)
    )
    unpinned = [(r["id"], r["embedding"]) for r in rows if r["id"] not in pinned_ids]

    if not unpinned:
        return

    # Phase 1: match new faces to existing named people using exemplars
    # For each new face, find the nearest exemplar across all people
    auto_assigned = []  # (det_id, cluster_id)
    still_unmatched = []  # (det_id, embedding)

    if exemplars:
        # Build a flat matrix of all exemplars with cluster labels
        all_exemplar_vecs = []
        all_exemplar_cids = []
        for cid, vecs in exemplars.items():
            for v in vecs:
                all_exemplar_vecs.append(v)
                all_exemplar_cids.append(cid)
        exemplar_matrix = np.array(all_exemplar_vecs, dtype=np.float32)

        for det_id, emb in unpinned:
            vec = normalize(np.array(emb, dtype=np.float32).reshape(1, -1))
            dists = cosine_distances(vec, exemplar_matrix)[0]
            min_idx = int(np.argmin(dists))
            min_dist = float(dists[min_idx])

            # 0.55 generous — exemplars are real diverse faces, catches angle/expression variation
            if min_dist < 0.55:
                auto_assigned.append((det_id, all_exemplar_cids[min_idx]))
            else:
                still_unmatched.append((det_id, emb))
    else:
        still_unmatched = unpinned

    # Phase 2: cluster remaining unknowns — use UUIDs so IDs never collide with named clusters
    new_cluster_values = []
    if len(still_unmatched) >= 2:
        u_ids = [u[0] for u in still_unmatched]
        vectors = np.array([u[1] for u in still_unmatched], dtype=np.float32)
        vectors = normalize(vectors)

        clustering = AgglomerativeClustering(
            n_clusters=None,
            distance_threshold=distance_threshold,
            metric="cosine",
            linkage="average",
        )
        labels = clustering.fit_predict(vectors)

        # Map agglomerative label numbers to stable UUIDs
        label_to_uuid = {}
        for lbl in set(labels):
            label_to_uuid[int(lbl)] = str(uuid.uuid4())

        # Group detections by their new cluster label
        new_clusters: dict[int, list] = {}
        for i in range(len(u_ids)):
            new_clusters.setdefault(int(labels[i]), []).append(i)

        # Phase 3: check each new cluster's centroid against named clusters
        # If close enough, merge into the named cluster instead of creating new
        if exemplars:
            for lbl, member_indices in list(new_clusters.items()):
                member_vecs = vectors[member_indices]
                centroid = member_vecs.mean(axis=0, keepdims=True)
                centroid = normalize(centroid)
                dists = cosine_distances(centroid, exemplar_matrix)[0]
                min_idx = int(np.argmin(dists))
                min_dist = float(dists[min_idx])

                # 0.65 — looser than per-face (0.55) since this is a centroid
                if min_dist < 0.65:
                    matched_cid = all_exemplar_cids[min_idx]
                    for idx in member_indices:
                        new_cluster_values.append((u_ids[idx], matched_cid, category, True))
                    del new_clusters[lbl]

        # Remaining truly unknown clusters get new UUIDs
        for lbl, member_indices in new_clusters.items():
            new_uuid = str(uuid.uuid4())
            for idx in member_indices:
                new_cluster_values.append((u_ids[idx], new_uuid, category, False))

    elif len(still_unmatched) == 1:
        det_id = still_unmatched[0][0]
        # Check single face against named exemplars too
        if exemplars:
            vec = normalize(np.array(still_unmatched[0][1], dtype=np.float32).reshape(1, -1))
            dists = cosine_distances(vec, exemplar_matrix)[0]
            min_idx = int(np.argmin(dists))
            if float(dists[min_idx]) < 0.65:
                new_cluster_values.append((det_id, all_exemplar_cids[min_idx], category, True))
            else:
                new_cluster_values.append((det_id, str(uuid.uuid4()), category, False))
        else:
            new_cluster_values.append((det_id, str(uuid.uuid4()), category, False))

    # Write to DB
    conn = get_db()
    try:
        with conn.cursor() as cur:
            # Only delete unpinned detections that are NOT in a labeled cluster
            cur.execute("""
                DELETE FROM detection_clusters
                WHERE category = %s AND pinned = false
                  AND NOT EXISTS (
                    SELECT 1 FROM clusters c
                    WHERE c.id = detection_clusters.cluster_id
                      AND c.category = detection_clusters.category
                      AND c.label IS NOT NULL
                  )
            """, (category,))

            # Auto-assigned faces get pinned to their matched cluster
            if auto_assigned:
                auto_values = [(did, cid, category, True) for did, cid in auto_assigned]
                execute_values(cur,
                    "INSERT INTO detection_clusters (detection_id, cluster_id, category, pinned) VALUES %s",
                    auto_values)

            # Remaining get new cluster assignments
            if new_cluster_values:
                execute_values(cur,
                    "INSERT INTO detection_clusters (detection_id, cluster_id, category, pinned) VALUES %s",
                    new_cluster_values)
        conn.commit()
    finally:
        conn.close()

    n_auto = len(auto_assigned)
    n_new = len(new_cluster_values)
    print(f"  Clustering {category}: {n_auto} auto-matched to known people, {n_new} in new clusters")
    # Invalidate cached explore data since clusters changed
    invalidate_cache()

@app.post("/cluster")
def cluster(req: ClusterRequest, admin=Depends(require_admin)):
    rows = db_query(
        "SELECT id FROM detections WHERE category = %s AND embedding IS NOT NULL",
        (req.category,)
    )
    if len(rows) < 2:
        raise HTTPException(400, f"Need >=2 detections in '{req.category}' to cluster")

    run_clustering(req.category, distance_threshold=req.eps)
    return _get_clusters_response(req.category)

# Static /clusters/* routes must be defined BEFORE /clusters/{category} to avoid path param capture

@app.get("/clusters/named")
def get_named_clusters(category: str = "people"):
    """Return all named clusters for assignment dropdowns."""
    rows = db_query("""
        SELECT c.id, c.category, c.label, c.avatar_detection_id,
               (SELECT chip FROM detections d
                JOIN detection_clusters dc ON dc.detection_id = d.id
                WHERE dc.cluster_id = c.id AND dc.category = c.category
                ORDER BY d.det_score DESC LIMIT 1) as auto_avatar
        FROM clusters c
        WHERE c.category = %s AND c.label IS NOT NULL
        ORDER BY c.label
    """, (category,))
    # Resolve custom avatars
    results = []
    custom_ids = [str(r["avatar_detection_id"]) for r in rows if r.get("avatar_detection_id")]
    custom_chips = {}
    if custom_ids:
        chip_rows = db_query("SELECT id, chip FROM detections WHERE id = ANY(%s::uuid[])", (custom_ids,))
        custom_chips = {str(r["id"]): r["chip"] for r in chip_rows}
    for r in rows:
        avatar = r["auto_avatar"]
        if r.get("avatar_detection_id") and str(r["avatar_detection_id"]) in custom_chips:
            avatar = custom_chips[str(r["avatar_detection_id"])]
        results.append({"id": r["id"], "category": r["category"], "label": r["label"], "avatar": avatar})
    return {"clusters": results}

@app.post("/clusters/clean-species")
def clean_species(category: str = "pets", admin=Depends(require_admin)):
    """Clean named clusters by removing wrong-species detections, then recluster."""
    removed = _clean_named_clusters_by_subtype(category)
    if removed > 0:
        _run_subtype_clustering(category)
    invalidate_cache()
    return {"removed": removed, "message": f"Removed {removed} wrong-species detections and reclustered"}

@app.get("/clusters/{category}")
def get_clusters(category: str):
    return _get_clusters_response(category)

@app.get("/clusters/{category}/summary")
def get_clusters_summary(category: str, sort_visual: bool = False, limit: int = 30, offset: int = 0, q: str = ""):
    """Lightweight summary — single query, no N+1. sort_visual groups unnamed by visual similarity.
    Optional q parameter for fuzzy name search using pg_trgm similarity."""

    # If searching, filter cluster IDs by name first
    filtered_ids = None
    if q.strip():
        search_q = q.strip()
        # Check similarity against each word in the label (not just the full string)
        # so "mike" matches "Michael Teagle" by comparing against "Michael"
        name_rows = db_query("""
            SELECT id FROM clusters
            WHERE category = %s AND label IS NOT NULL AND (
                label ILIKE %s
                OR LOWER(label) LIKE LOWER(%s)
                OR EXISTS (
                    SELECT 1 FROM unnest(string_to_array(LOWER(label), ' ')) AS word
                    WHERE word LIKE LOWER(%s)
                    OR (LENGTH(word) >= 4 AND LENGTH(%s) >= 3 AND LEFT(word, 2) = LEFT(LOWER(%s), 2) AND similarity(word, LOWER(%s)) > 0.15)
                )
            )
            ORDER BY similarity(LOWER(label), LOWER(%s)) DESC
        """, (category, f"%{search_q}%", f"{search_q}%", f"{search_q}%", search_q, search_q, search_q))
        filtered_ids = [r["id"] for r in name_rows]
        if not filtered_ids:
            return {"clusters": [], "noise_count": 0}

    base_filter = "dc.category = %s AND dc.cluster_id != '-1'"
    params = [category]
    if filtered_ids is not None:
        base_filter += " AND dc.cluster_id = ANY(%s)"
        params.append(filtered_ids)

    rows = db_query(f"""
        WITH ranked AS (
            SELECT dc.cluster_id, d.id, d.photo_id, d.det_score, d.chip, d.thumb_url, d.photo_url,
                   ROW_NUMBER() OVER (PARTITION BY dc.cluster_id ORDER BY d.det_score DESC) as rn
            FROM detection_clusters dc
            JOIN detections d ON d.id = dc.detection_id
            WHERE {base_filter}
        ),
        agg AS (
            SELECT cluster_id,
                   COUNT(*) as det_count,
                   COUNT(DISTINCT photo_id) as photo_count
            FROM ranked GROUP BY cluster_id
        )
        SELECT a.cluster_id, a.det_count, a.photo_count, r.chip as avatar, r.thumb_url, r.photo_url
        FROM agg a
        JOIN ranked r ON r.cluster_id = a.cluster_id AND r.rn = 1
        ORDER BY a.det_count DESC
    """, params)

    labels_rows = db_query("""
        SELECT id, label, avatar_detection_id, cover_photo_id, cover_crop
        FROM clusters WHERE category = %s
    """, (category,))
    labels = {r["id"]: r["label"] for r in labels_rows}
    custom_avatars = {}
    for r in labels_rows:
        if r.get("avatar_detection_id") or r.get("cover_photo_id"):
            custom_avatars[r["id"]] = {
                "avatar_detection_id": str(r["avatar_detection_id"]) if r.get("avatar_detection_id") else None,
                "cover_photo_id": r.get("cover_photo_id"),
                "cover_crop": r.get("cover_crop"),
            }

    # Fetch custom avatar chips in bulk
    custom_avatar_chips = {}
    avatar_det_ids = [v["avatar_detection_id"] for v in custom_avatars.values() if v.get("avatar_detection_id")]
    if avatar_det_ids:
        chip_rows = db_query("""
            SELECT id, chip FROM detections WHERE id = ANY(%s::uuid[])
        """, (avatar_det_ids,))
        custom_avatar_chips = {str(r["id"]): r["chip"] for r in chip_rows}

    # Fetch custom cover photos in bulk
    custom_cover_photos = {}
    cover_photo_ids = [v["cover_photo_id"] for v in custom_avatars.values() if v.get("cover_photo_id")]
    if cover_photo_ids:
        cover_rows = db_query("""
            SELECT DISTINCT photo_id, thumb_url, photo_url FROM detections WHERE photo_id = ANY(%s)
        """, (cover_photo_ids,))
        custom_cover_photos = {r["photo_id"]: r for r in cover_rows}

    clusters = []
    for r in rows:
        cid = r["cluster_id"]
        ca = custom_avatars.get(cid)
        avatar = r["avatar"]
        thumb_url = r["thumb_url"]
        photo_url = r["photo_url"]
        cover_crop = None

        if ca:
            if ca.get("avatar_detection_id") and ca["avatar_detection_id"] in custom_avatar_chips:
                avatar = custom_avatar_chips[ca["avatar_detection_id"]]
            if ca.get("cover_photo_id") and ca["cover_photo_id"] in custom_cover_photos:
                cover = custom_cover_photos[ca["cover_photo_id"]]
                thumb_url = cover.get("thumb_url") or thumb_url
                photo_url = cover.get("photo_url") or photo_url
            cover_crop = ca.get("cover_crop")

        clusters.append({
            "id": cid,
            "label": labels.get(cid),
            "det_count": r["det_count"],
            "photo_count": r["photo_count"],
            "avatar": avatar,
            "thumb_url": thumb_url,
            "photo_url": photo_url,
            "cover_crop": cover_crop,
        })

    noise_row = db_query("""
        SELECT COUNT(*) as cnt FROM detections d
        LEFT JOIN detection_clusters dc ON d.id = dc.detection_id AND dc.category = %s
        WHERE d.category = %s AND (dc.cluster_id = '-1' OR dc.cluster_id IS NULL)
    """, (category, category))
    noise_count = noise_row[0]["cnt"] if noise_row else 0

    # Optionally sort unnamed clusters by visual similarity
    if sort_visual and category == "people":
        named = [c for c in clusters if c.get("label")]
        unnamed = [c for c in clusters if not c.get("label")]

        if len(unnamed) >= 2:
            try:
                from sklearn.preprocessing import normalize as sk_normalize
                from sklearn.metrics.pairwise import cosine_distances

                unnamed_ids = [c["id"] for c in unnamed]

                # Single batch query — get one CLIP embedding per unnamed cluster
                emb_rows = db_query("""
                    SELECT DISTINCT ON (dc.cluster_id) dc.cluster_id, pe.clip_embedding
                    FROM detection_clusters dc
                    JOIN detections d ON d.id = dc.detection_id
                    JOIN photo_embeddings pe ON pe.photo_id = d.photo_id
                    WHERE dc.category = %s AND dc.cluster_id = ANY(%s)
                      AND pe.clip_embedding IS NOT NULL
                    ORDER BY dc.cluster_id, d.det_score DESC
                """, (category, unnamed_ids))

                emb_map = {r["cluster_id"]: np.array(r["clip_embedding"], dtype=np.float32) for r in emb_rows}

                valid_indices = [i for i, c in enumerate(unnamed) if c["id"] in emb_map]
                no_emb_indices = [i for i, c in enumerate(unnamed) if c["id"] not in emb_map]

                if len(valid_indices) >= 2:
                    vecs = sk_normalize(np.array([emb_map[unnamed[i]["id"]] for i in valid_indices], dtype=np.float32))
                    dists = cosine_distances(vecs)

                    # Nearest-neighbor chain sort
                    ordered = [0]
                    used = {0}
                    for _ in range(len(valid_indices) - 1):
                        last = ordered[-1]
                        best_idx = min(
                            (j for j in range(len(valid_indices)) if j not in used),
                            key=lambda j: dists[last][j],
                            default=-1
                        )
                        if best_idx >= 0:
                            ordered.append(best_idx)
                            used.add(best_idx)

                    unnamed = [unnamed[valid_indices[i]] for i in ordered] + [unnamed[i] for i in no_emb_indices]

            except Exception:
                pass  # Fall back to default order

        clusters = named + unnamed

    total = len(clusters)
    paginated = clusters[offset:offset + limit] if limit > 0 else clusters
    has_more = (offset + limit) < total if limit > 0 else False

    return {
        "clusters": paginated,
        "noise_count": noise_count,
        "labels": labels,
        "total": total,
        "has_more": has_more,
        "offset": offset,
        "limit": limit,
    }

@app.get("/clusters/{category}/unmatched")
def get_unmatched(category: str):
    """Get unmatched/noise detections — faces that only appeared once."""
    rows = db_query("""
        SELECT d.id, d.category, d.subtype, d.photo_id, d.photo_url, d.thumb_url,
               d.flickr_url, d.photo_title, d.owner, d.bbox, d.det_score, d.chip,
               COALESCE(dc.cluster_id, 'none') as cluster_id
        FROM detections d
        LEFT JOIN detection_clusters dc ON d.id = dc.detection_id AND dc.category = %s
        WHERE d.category = %s AND (dc.cluster_id = '-1' OR dc.cluster_id IS NULL)
        ORDER BY d.det_score DESC
    """, (category, category))
    return {"items": [dict(r) for r in rows], "count": len(rows)}

@app.get("/clusters/{category}/{cluster_id}")
def get_cluster_detail(category: str, cluster_id: str):
    """Full detail for a single cluster — all chips and photos."""
    rows = db_query("""
        SELECT d.id, d.category, d.subtype, d.photo_id, d.photo_url, d.thumb_url,
               d.flickr_url, d.photo_title, d.owner, d.bbox, d.det_score, d.chip
        FROM detections d
        JOIN detection_clusters dc ON d.id = dc.detection_id
        WHERE dc.cluster_id = %s AND dc.category = %s
    """, (cluster_id, category))
    # Get cluster label + custom avatar info
    label_rows = db_query("""
        SELECT label, avatar_detection_id, cover_photo_id, cover_crop
        FROM clusters WHERE id = %s AND category = %s
    """, (cluster_id, category))
    lr = label_rows[0] if label_rows else {}
    return {
        "cluster_id": cluster_id,
        "label": lr.get("label"),
        "avatar_detection_id": str(lr["avatar_detection_id"]) if lr.get("avatar_detection_id") else None,
        "cover_photo_id": lr.get("cover_photo_id"),
        "cover_crop": lr.get("cover_crop"),
        "items": [dict(r) for r in rows],
    }

def _get_clusters_response(category: str):
    rows = db_query("""
        SELECT d.id, d.category, d.subtype, d.photo_id, d.photo_url, d.thumb_url,
               d.flickr_url, d.photo_title, d.owner, d.bbox, d.det_score, d.chip,
               COALESCE(dc.cluster_id, '-1') as cluster_id
        FROM detections d
        LEFT JOIN detection_clusters dc ON d.id = dc.detection_id AND dc.category = %s
        WHERE d.category = %s
    """, (category, category))

    labels_rows = db_query(
        "SELECT id, label FROM clusters WHERE category = %s", (category,)
    )
    labels = {r["id"]: r["label"] for r in labels_rows}

    clusters: dict[str, list] = {}
    for r in rows:
        cid = r["cluster_id"]
        clusters.setdefault(cid, [])
        clusters[cid].append({
            "id": str(r["id"]),
            "category": r["category"],
            "subtype": r["subtype"],
            "photo_id": r["photo_id"],
            "photo_url": r["photo_url"],
            "thumb_url": r["thumb_url"],
            "flickr_url": r["flickr_url"],
            "photo_title": r["photo_title"],
            "owner": r["owner"],
            "bbox": r["bbox"],
            "det_score": r["det_score"],
            "chip": r["chip"],
        })

    return {
        "category": category,
        "labels": labels,
        "clusters": clusters,
        "stats": {
            "total": len(rows),
            "clusters": len([k for k in clusters if k != "-1"]),
            "noise": len(clusters.get("-1", [])),
        },
    }

@app.post("/clusters/label")
def label_cluster(req: LabelRequest, admin=Depends(require_admin)):
    db_query("""
        INSERT INTO clusters (id, category, label, label_source) VALUES (%s, %s, %s, 'human')
        ON CONFLICT (id, category) DO UPDATE SET label = EXCLUDED.label, label_source = 'human'
    """, (req.cluster_id, req.category, req.name), fetch=False)
    # Pin all detections in this cluster so they survive re-clustering
    db_query("""
        UPDATE detection_clusters SET pinned = true
        WHERE cluster_id = %s AND category = %s
    """, (req.cluster_id, req.category), fetch=False)
    return {"ok": True}

@app.post("/clusters/merge")
def merge_clusters(req: MergeRequest, admin=Depends(require_admin)):
    # Move all detections from source cluster to target cluster and pin them
    db_query("""
        UPDATE detection_clusters SET cluster_id = %s, pinned = true
        WHERE cluster_id = %s AND category = %s
    """, (req.target_id, req.source_id, req.category), fetch=False)
    # Also pin existing target detections
    db_query("""
        UPDATE detection_clusters SET pinned = true
        WHERE cluster_id = %s AND category = %s
    """, (req.target_id, req.category), fetch=False)

    # Transfer label if target has none
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT label FROM clusters WHERE id = %s AND category = %s",
                       (req.source_id, req.category))
            src = cur.fetchone()
            cur.execute("SELECT label FROM clusters WHERE id = %s AND category = %s",
                       (req.target_id, req.category))
            tgt = cur.fetchone()
            if src and not tgt:
                cur.execute("""
                    INSERT INTO clusters (id, category, label) VALUES (%s, %s, %s)
                    ON CONFLICT (id, category) DO UPDATE SET label = EXCLUDED.label
                """, (req.target_id, req.category, src["label"]))
            cur.execute("DELETE FROM clusters WHERE id = %s AND category = %s",
                       (req.source_id, req.category))
        conn.commit()
    finally:
        conn.close()

    return _get_clusters_response(req.category)

class SetAvatarRequest(BaseModel):
    category: str = "people"
    cluster_id: str
    avatar_detection_id: Optional[str] = None  # detection to use as avatar chip (None = auto)
    cover_photo_id: Optional[str] = None       # photo to use as cover (None = auto)
    cover_crop: Optional[dict] = None          # {"x": 50, "y": 30} focal point percentages


@app.post("/clusters/set-avatar")
def set_cluster_avatar(req: SetAvatarRequest, admin=Depends(require_admin)):
    """Set custom avatar detection and/or cover photo for a cluster."""
    # Build SET clause dynamically so we only update fields that were provided
    sets = []
    params: list = []
    raw = req.model_dump(exclude_unset=True)
    if "avatar_detection_id" in raw:
        sets.append("avatar_detection_id = %s")
        params.append(raw["avatar_detection_id"])
    if "cover_photo_id" in raw:
        sets.append("cover_photo_id = %s")
        params.append(raw["cover_photo_id"])
    if "cover_crop" in raw:
        sets.append("cover_crop = %s")
        params.append(json.dumps(raw["cover_crop"]) if raw["cover_crop"] else None)

    if sets:
        # Ensure cluster row exists first
        db_query("""
            INSERT INTO clusters (id, category) VALUES (%s, %s)
            ON CONFLICT (id, category) DO NOTHING
        """, (req.cluster_id, req.category), fetch=False)
        # Then update only the provided fields
        db_query(f"""
            UPDATE clusters SET {', '.join(sets)}
            WHERE id = %s AND category = %s
        """, (*params, req.cluster_id, req.category), fetch=False)
    invalidate_cache()
    return {"ok": True}


class DismissRequest(BaseModel):
    category: str = "people"
    cluster_id: str

@app.post("/clusters/remove-detections")
def remove_detections(req: RemoveDetectionsRequest, admin=Depends(require_admin)):
    """Remove detections from a cluster (undo bad merges). Each gets its own new cluster."""
    conn = get_db()
    try:
        with conn.cursor() as cur:
            for det_id in req.detection_ids:
                new_id = str(uuid.uuid4())
                cur.execute("""
                    UPDATE detection_clusters SET cluster_id = %s, pinned = false
                    WHERE detection_id = %s::uuid AND cluster_id = %s AND category = %s
                """, (new_id, det_id, req.cluster_id, req.category))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "removed": len(req.detection_ids)}

class AssignDetectionRequest(BaseModel):
    category: str = "people"
    detection_id: str
    target_cluster_id: str

class DismissDetectionRequest(BaseModel):
    category: str = "people"
    detection_id: str

@app.post("/clusters/assign")
def assign_detection(req: AssignDetectionRequest, admin=Depends(require_admin)):
    """Assign an unmatched detection to an existing cluster."""
    conn = get_db()
    try:
        with conn.cursor() as cur:
            # Remove any existing assignment
            cur.execute("""
                DELETE FROM detection_clusters
                WHERE detection_id = %s::uuid AND category = %s
            """, (req.detection_id, req.category))
            # Insert into target cluster, pinned
            cur.execute("""
                INSERT INTO detection_clusters (detection_id, cluster_id, category, pinned)
                VALUES (%s::uuid, %s, %s, true)
            """, (req.detection_id, req.target_cluster_id, req.category))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}

@app.post("/clusters/dismiss-detection")
def dismiss_single_detection(req: DismissDetectionRequest, admin=Depends(require_admin)):
    """Dismiss a single detection — store its embedding and delete it."""
    conn = get_db()
    try:
        with conn.cursor() as cur:
            # Get embedding to remember this face
            cur.execute("""
                SELECT embedding FROM detections WHERE id = %s::uuid AND category = %s AND embedding IS NOT NULL
            """, (req.detection_id, req.category))
            row = cur.fetchone()
            if row and row[0] is not None:
                from sklearn.preprocessing import normalize
                centroid = np.array(row[0], dtype=np.float32)
                centroid = normalize(centroid.reshape(1, -1))[0]
                cur.execute("""
                    INSERT INTO dismissed_faces (category, centroid, det_count)
                    VALUES (%s, %s, 1)
                """, (req.category, centroid))
            # Delete from clusters and detections
            cur.execute("DELETE FROM detection_clusters WHERE detection_id = %s::uuid", (req.detection_id,))
            cur.execute("DELETE FROM detections WHERE id = %s::uuid", (req.detection_id,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}

class DeleteDetectionRequest(BaseModel):
    detection_id: str

@app.post("/detections/delete")
def delete_detection(req: DeleteDetectionRequest, admin=Depends(require_admin)):
    """Remove a misclassified detection (e.g. human detected as cow).
    Keeps the detection row with rejected=true so the scan won't re-detect it."""
    conn = get_db()
    try:
        with conn.cursor() as cur:
            # Remove from clusters so it disappears from the UI
            cur.execute("DELETE FROM detection_clusters WHERE detection_id = %s::uuid", (req.detection_id,))
            # Mark as rejected instead of deleting — the embedding stays in the
            # detections table so the scan's dedup check (embedding <=> < 0.15)
            # will skip this region on future scans
            cur.execute("""
                UPDATE detections SET category = 'rejected' WHERE id = %s::uuid
            """, (req.detection_id,))
        conn.commit()
    finally:
        conn.close()
    invalidate_cache()
    return {"ok": True}

@app.post("/clusters/dismiss")
def dismiss_cluster(req: DismissRequest, admin=Depends(require_admin)):
    """Dismiss a face group — stores the average face so similar faces are auto-rejected forever."""
    conn = get_db()
    try:
        with conn.cursor() as cur:
            # Compute centroid embedding for this cluster
            cur.execute("""
                SELECT d.embedding FROM detections d
                JOIN detection_clusters dc ON d.id = dc.detection_id
                WHERE dc.cluster_id = %s AND dc.category = %s AND d.embedding IS NOT NULL
            """, (req.cluster_id, req.category))
            embeddings = [r[0] for r in cur.fetchall()]

            if embeddings:
                from sklearn.preprocessing import normalize
                centroid = np.mean(np.array(embeddings, dtype=np.float32), axis=0)
                centroid = normalize(centroid.reshape(1, -1))[0]
                cur.execute("""
                    INSERT INTO dismissed_faces (category, centroid, det_count)
                    VALUES (%s, %s, %s)
                """, (req.category, centroid, len(embeddings)))

            # Get detection IDs and delete
            cur.execute("""
                SELECT detection_id FROM detection_clusters
                WHERE cluster_id = %s AND category = %s
            """, (req.cluster_id, req.category))
            det_ids = [r[0] for r in cur.fetchall()]

            if det_ids:
                cur.execute("DELETE FROM detection_clusters WHERE cluster_id = %s AND category = %s",
                           (req.cluster_id, req.category))
                cur.execute("DELETE FROM detections WHERE id = ANY(%s::uuid[])", (det_ids,))
            cur.execute("DELETE FROM clusters WHERE id = %s AND category = %s",
                       (req.cluster_id, req.category))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}

@app.get("/photos/together")
def photos_together(people: str, limit: int = 100):
    """Find photos containing ALL specified clusters. Pass comma-separated cluster IDs. Works across categories (people + animals)."""
    cluster_ids = [cid.strip() for cid in people.split(",") if cid.strip()]
    if len(cluster_ids) < 1:
        raise HTTPException(400, "Need at least 1 cluster ID")

    rows = db_query("""
        SELECT dc.detection_id, d.photo_id, d.photo_url, d.thumb_url, d.flickr_url,
               d.photo_title, dc.cluster_id
        FROM detection_clusters dc
        JOIN detections d ON d.id = dc.detection_id
        WHERE dc.cluster_id = ANY(%s)
    """, (cluster_ids,))

    # Group by photo_id, find photos with ALL requested people
    photo_clusters: dict[str, set] = {}
    photo_info: dict[str, dict] = {}
    for r in rows:
        pid = r["photo_id"]
        photo_clusters.setdefault(pid, set()).add(r["cluster_id"])
        if pid not in photo_info:
            photo_info[pid] = {
                "photo_id": pid,
                "photo_url": r["photo_url"],
                "thumb_url": r["thumb_url"],
                "flickr_url": r["flickr_url"],
                "photo_title": r["photo_title"],
            }

    required = set(cluster_ids)
    matching = [
        photo_info[pid] for pid, clusters in photo_clusters.items()
        if required.issubset(clusters)
    ]

    return {"photos": matching[:limit], "count": len(matching), "people_count": len(cluster_ids)}

@app.get("/photos/appears-with")
def appears_with(cluster_id: str, limit: int = 15):
    """Find other people AND animals who frequently appear in the same photos."""
    # Get all photo_ids for this cluster
    rows = db_query("""
        SELECT DISTINCT d.photo_id
        FROM detection_clusters dc
        JOIN detections d ON d.id = dc.detection_id
        WHERE dc.cluster_id = %s
    """, (cluster_id,))
    photo_ids = [r["photo_id"] for r in rows]
    if not photo_ids:
        return {"appears_with": []}

    # Find other clusters (people + animals) that appear in those same photos
    rows = db_query("""
        SELECT dc.cluster_id, dc.category, c.label, COUNT(DISTINCT d.photo_id) as shared_photos,
               (SELECT det.chip FROM detections det
                JOIN detection_clusters dc2 ON dc2.detection_id = det.id
                WHERE dc2.cluster_id = dc.cluster_id
                ORDER BY det.det_score DESC LIMIT 1) as avatar
        FROM detection_clusters dc
        JOIN detections d ON d.id = dc.detection_id
        LEFT JOIN clusters c ON c.id = dc.cluster_id AND c.category = dc.category
        WHERE dc.category IN ('people', 'pets')
          AND dc.cluster_id != %s
          AND d.photo_id = ANY(%s)
        GROUP BY dc.cluster_id, dc.category, c.label
        ORDER BY shared_photos DESC
        LIMIT %s
    """, (cluster_id, photo_ids, limit))

    return {"appears_with": [dict(r) for r in rows]}

# ── Photo Upload (proxy to Flickr via admin credentials) ────────────────────

UPLOAD_MAX_SIZE = 1024 * 1024 * 1024  # 1 GB (Flickr's per-video limit on Pro)
RESUMABLE_CHUNK_MAX_SIZE = 8 * 1024 * 1024
UPLOAD_ALLOWED_TYPES = {
    # Images
    "image/jpeg", "image/png", "image/gif", "image/heic", "image/heif",
    "image/webp", "image/bmp", "image/tiff",
    "image/vnd.adobe.photoshop",
    # Videos
    "video/mp4", "video/quicktime", "video/x-m4v",
    "video/x-msvideo", "video/x-ms-wmv",
    "video/mpeg", "video/3gpp", "video/mp2t",
    "video/ogg", "video/x-matroska",
}
UPLOAD_ALLOWED_EXTENSIONS = {
    # Images (Flickr converts BMP/TIFF/WebP/HEIC/PSD to JPEG server-side)
    ".jpg", ".jpeg", ".jfif", ".png", ".gif", ".bmp", ".tif", ".tiff",
    ".webp", ".heic", ".heif", ".psd",
    # Videos
    ".mp4", ".mov", ".m4v", ".m4p", ".avi", ".wmv",
    ".mpeg", ".mpg", ".3gp", ".m2ts", ".ogg", ".ogv", ".mkv",
}

def _content_type_for_filename(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    mapping = {
        # Images
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".jfif": "image/jpeg",
        ".png": "image/png", ".gif": "image/gif",
        ".heic": "image/heic", ".heif": "image/heif",
        ".webp": "image/webp", ".bmp": "image/bmp",
        ".tif": "image/tiff", ".tiff": "image/tiff",
        ".psd": "image/vnd.adobe.photoshop",
        # Videos
        ".mkv": "video/x-matroska", ".mp4": "video/mp4", ".mov": "video/quicktime",
        ".m4v": "video/x-m4v", ".m4p": "video/mp4",
        ".avi": "video/x-msvideo", ".wmv": "video/x-ms-wmv",
        ".mpeg": "video/mpeg", ".mpg": "video/mpeg",
        ".3gp": "video/3gpp", ".m2ts": "video/mp2t",
        ".ogg": "video/ogg", ".ogv": "video/ogg",
    }
    return mapping.get(ext, "application/octet-stream")

VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".m4p", ".avi", ".wmv",
                    ".mpeg", ".mpg", ".3gp", ".m2ts", ".ogg", ".ogv", ".mkv"}


def _file_sha256(path: str) -> str:
    import hashlib

    digest = hashlib.sha256()
    with open(path, "rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _store_nas_original(
    file_path: str,
    filename: str,
    content_type: str,
    title: str,
    description: str,
    taken_at_unix: int | None,
    latitude: float | None,
    longitude: float | None,
    client_upload_id: str | None,
) -> dict | None:
    """Commit an original to NAS storage before attempting its Flickr mirror."""
    if not PHOTO_STORAGE_ROOT:
        return None

    checksum = _file_sha256(file_path)
    provider = LocalStorageProvider(PHOTO_STORAGE_ROOT)
    conn = get_db()
    stored = None
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            row = None
            if client_upload_id:
                cur.execute(
                    "SELECT id, sha256, client_upload_id FROM photos WHERE client_upload_id = %s FOR UPDATE",
                    (client_upload_id,),
                )
                row = cur.fetchone()
                if row and row.get("sha256") and row["sha256"] != checksum:
                    raise HTTPException(409, "Upload ID was already used for a different file")
            if not row:
                cur.execute(
                    "SELECT id, sha256, client_upload_id FROM photos WHERE sha256 = %s FOR UPDATE",
                    (checksum,),
                )
                row = cur.fetchone()
            kindred_photo_id = str(row["id"]) if row else str(uuid.uuid4())
            if not row:
                taken_at = (
                    datetime.fromtimestamp(taken_at_unix, tz=timezone.utc)
                    if taken_at_unix else None
                )
                cur.execute(
                    """
                    INSERT INTO photos (
                        id, sha256, original_filename, media_type, byte_size,
                        title, description, taken_at, latitude, longitude,
                        client_upload_id
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        kindred_photo_id, checksum, filename, content_type,
                        os.path.getsize(file_path), title, description, taken_at,
                        latitude, longitude,
                        client_upload_id,
                    ),
                )
            elif client_upload_id and not row.get("client_upload_id"):
                cur.execute(
                    "UPDATE photos SET client_upload_id = %s, updated_at = now() WHERE id = %s",
                    (client_upload_id, kindred_photo_id),
                )

            cur.execute(
                """
                SELECT provider_key, sha256, byte_size
                FROM photo_copies
                WHERE photo_id = %s AND provider = 'nas' AND status = 'available'
                """,
                (kindred_photo_id,),
            )
            existing = cur.fetchone()
            if existing and provider.resolve_local_path(existing["provider_key"]):
                conn.commit()
                return {
                    "kindred_photo_id": kindred_photo_id,
                    "provider_key": existing["provider_key"],
                    "sha256": existing["sha256"],
                    "byte_size": existing["byte_size"],
                    "deduplicated": True,
                }

            stored = provider.store_file(kindred_photo_id, Path(file_path), filename)
            cur.execute(
                """
                INSERT INTO photo_copies (
                    photo_id, provider, provider_key, storage_path, sha256,
                    byte_size, status, last_synced_at
                ) VALUES (%s, 'nas', %s, %s, %s, %s, 'available', now())
                ON CONFLICT (photo_id, provider) DO UPDATE SET
                    provider_key = EXCLUDED.provider_key,
                    storage_path = EXCLUDED.storage_path,
                    sha256 = EXCLUDED.sha256,
                    byte_size = EXCLUDED.byte_size,
                    status = 'available',
                    last_error = NULL,
                    last_synced_at = now(),
                    updated_at = now()
                """,
                (
                    kindred_photo_id, stored.provider_key, stored.provider_key,
                    stored.sha256, stored.byte_size,
                ),
            )
        conn.commit()
        invalidate_cache("timeline")
        return {
            "kindred_photo_id": kindred_photo_id,
            "provider_key": stored.provider_key,
            "sha256": stored.sha256,
            "byte_size": stored.byte_size,
            "deduplicated": False,
        }
    except Exception:
        conn.rollback()
        if stored is not None:
            provider.delete(stored.provider_key)
        raise
    finally:
        conn.close()


def _queue_video(nas_copy, title, description, privacy, taken_at_unix=None,
                 latitude=None, longitude=None):
    import video_queue
    source = LocalStorageProvider(PHOTO_STORAGE_ROOT).resolve_local_path(nas_copy['provider_key'])
    if source is None:
        raise RuntimeError('Video has no durable NAS original')
    metadata = dict(title=title, description=description, taken_at_unix=taken_at_unix,
                    latitude=latitude, longitude=longitude)
    video_queue.enqueue(nas_copy['kindred_photo_id'], source, metadata, privacy)
    _queue_flickr_replication(nas_copy['kindred_photo_id'])


def _original_upload_limit(filename):
    if PHOTO_STORAGE_ROOT and Path(filename).suffix.lower() in VIDEO_EXTENSIONS:
        return int(os.environ.get('VIDEO_ORIGINAL_MAX_BYTES', str(64 * 1024**3)))
    return UPLOAD_MAX_SIZE


def _existing_flickr_copy(kindred_photo_id: str) -> str | None:
    rows = db_query(
        """
        SELECT provider_key FROM photo_copies
        WHERE photo_id = %s AND provider = 'flickr' AND status = 'available'
        """,
        (kindred_photo_id,),
    )
    return rows[0]["provider_key"] if rows else None


def _queue_flickr_replication(kindred_photo_id: str) -> int:
    rows = db_query(
        """
        INSERT INTO replication_jobs (photo_id, source_provider, target_provider)
        SELECT %s, 'nas', 'flickr'
        WHERE NOT EXISTS (
            SELECT 1 FROM replication_jobs
            WHERE photo_id = %s AND target_provider = 'flickr'
              AND status IN ('pending', 'running', 'retry')
        )
        RETURNING id
        """,
        (kindred_photo_id, kindred_photo_id),
    )
    if rows:
        return rows[0]["id"]
    existing = db_query(
        """
        SELECT id FROM replication_jobs
        WHERE photo_id = %s AND target_provider = 'flickr'
          AND status IN ('pending', 'running', 'retry')
        ORDER BY id DESC LIMIT 1
        """,
        (kindred_photo_id,),
    )
    return existing[0]["id"]


def _set_replication_status(job_id: int, status: str, error: str | None = None) -> None:
    terminal = status in ("done", "failed")
    db_query(
        """
        UPDATE replication_jobs
        SET status = %s,
            attempts = attempts + CASE WHEN %s = 'running' THEN 1 ELSE 0 END,
            started_at = CASE WHEN %s = 'running' THEN now() ELSE started_at END,
            finished_at = CASE WHEN %s THEN now() ELSE NULL END,
            next_attempt_at = CASE WHEN %s = 'retry' THEN now() + interval '5 minutes' ELSE next_attempt_at END,
            last_error = %s
        WHERE id = %s
        """,
        (status, status, status, terminal, status, error, job_id),
        fetch=False,
    )


def _record_flickr_copy(kindred_photo_id: str, flickr_photo_id: str, owner_id: str) -> None:
    remote_url = (
        f"https://www.flickr.com/photos/{owner_id}/{flickr_photo_id}"
        if owner_id else None
    )
    db_query(
        """
        INSERT INTO photo_copies (
            photo_id, provider, provider_key, remote_url, status, last_synced_at
        ) VALUES (%s, 'flickr', %s, %s, 'available', now())
        ON CONFLICT (photo_id, provider) DO UPDATE SET
            provider_key = EXCLUDED.provider_key,
            remote_url = EXCLUDED.remote_url,
            status = 'available',
            last_error = NULL,
            last_synced_at = now(),
            updated_at = now()
        """,
        (kindred_photo_id, flickr_photo_id, remote_url),
        fetch=False,
    )

def _validate_upload_file(file: UploadFile) -> None:
    """Validate an upload file's extension and content type."""
    if not file.filename:
        raise HTTPException(400, "Filename is required")
    ext = os.path.splitext(file.filename)[1].lower()
    if ext in VIDEO_EXTENSIONS and not PHOTO_STORAGE_ROOT:
        raise HTTPException(503, 'Video uploads require durable NAS storage')
    if ext not in UPLOAD_ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {ext}. Allowed: {', '.join(sorted(UPLOAD_ALLOWED_EXTENSIONS))}")


def _validate_resumable_upload(body: ResumableUploadRequest) -> tuple[str, str, str]:
    if not PHOTO_STORAGE_ROOT:
        raise HTTPException(503, "NAS photo storage is not configured")
    try:
        client_upload_id = str(uuid.UUID(body.client_upload_id))
    except ValueError:
        raise HTTPException(400, "client_upload_id must be a UUID")

    filename = os.path.basename(body.filename.strip())
    if not filename:
        raise HTTPException(400, "Filename is required")
    ext = os.path.splitext(filename)[1].lower()
    if ext not in UPLOAD_ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            f"Unsupported file type: {ext}. Allowed: {', '.join(sorted(UPLOAD_ALLOWED_EXTENSIONS))}",
        )
    if body.content_type not in UPLOAD_ALLOWED_TYPES and body.content_type != "application/octet-stream":
        raise HTTPException(400, "Unsupported content type")
    if body.byte_size <= 0:
        raise HTTPException(400, "File must not be empty")
    if body.byte_size > _original_upload_limit(filename):
        raise HTTPException(
            413,
            f"File too large. Maximum size is {_original_upload_limit(filename) // (1024 * 1024)}MB",
        )
    if body.latitude is not None and not -90 <= body.latitude <= 90:
        raise HTTPException(400, "Latitude must be between -90 and 90")
    if body.longitude is not None and not -180 <= body.longitude <= 180:
        raise HTTPException(400, "Longitude must be between -180 and 180")
    return client_upload_id, filename, _content_type_for_filename(filename)


def _resumable_receipt(row: dict) -> dict:
    return {
        "photo_id": row["flickr_photo_id"],
        "kindred_photo_id": str(row["kindred_photo_id"]) if row.get("kindred_photo_id") else None,
        "status": "ok",
        "nas_status": "available" if row.get("kindred_photo_id") else "disabled",
        "flickr_status": "available" if row.get("flickr_photo_id") else "pending",
        "deduplicated": True,
    }


def _resumable_session_response(row: dict) -> dict:
    response = {
        "upload_id": str(row["id"]),
        "status": row["status"],
        "next_offset": int(row["received_bytes"]),
    }
    if row["status"] == "completed":
        response["receipt"] = _resumable_receipt(row)
    return response

PRIVACY_FLAGS = {
    # is_public, is_friend, is_family
    "private":        ("0", "0", "0"),
    "family":         ("0", "0", "1"),
    "friends":        ("0", "1", "0"),
    "friends_family": ("0", "1", "1"),
    "public":         ("1", "0", "0"),
}

async def _upload_to_flickr(
    file_path: str,
    filename: str,
    title: str,
    description: str,
    creds: dict,
    privacy: str = "family",
) -> str:
    """Stream a single file from disk to Flickr using the admin's OAuth credentials.
    Returns the Flickr photo ID. Caller is responsible for cleaning up file_path.
    """
    import hmac
    import hashlib
    import time as _t
    import urllib.parse

    ext = os.path.splitext(filename)[1].lower()
    if ext in VIDEO_EXTENSIONS:
        from video_mirror import validate_part
        import asyncio
        await asyncio.to_thread(validate_part, Path(file_path))
    converted_heic = False

    # Convert HEIC/HEIF to a temporary high-quality JPEG for Flickr while
    # retaining the untouched HEIC as Kindred's durable NAS original.
    if ext in (".heic", ".heif"):
        try:
            from PIL import Image
            from PIL import ImageOps
            from pillow_heif import register_heif_opener

            register_heif_opener()
            jpeg_path = file_path + ".jpg"
            with Image.open(file_path) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
                save_options = {
                    "format": "JPEG",
                    "quality": 94,
                    "subsampling": 0,
                    "optimize": True,
                }
                exif = source.getexif()
                if exif:
                    save_options["exif"] = exif.tobytes()
                if source.info.get("icc_profile"):
                    save_options["icc_profile"] = source.info["icc_profile"]
                image.save(jpeg_path, **save_options)
            file_path = jpeg_path
            filename = os.path.splitext(filename)[0] + ".jpg"
            converted_heic = True
            print(f"[upload] Converted HEIC to JPEG: {os.path.getsize(file_path)} bytes")
        except Exception as e:
            raise RuntimeError(f"HEIC-to-JPEG conversion failed for {filename}: {e}") from e

    upload_url = "https://up.flickr.com/services/upload/"
    is_public, is_friend, is_family = PRIVACY_FLAGS.get(privacy, PRIVACY_FLAGS["family"])

    # Parameters that go into the OAuth signature (everything EXCEPT the photo binary)
    flickr_params = {
        "title": title,
        "description": description,
        "is_public": is_public,
        "is_friend": is_friend,
        "is_family": is_family,
    }

    # Build OAuth header (POST method for upload)
    oauth_params = {
        "oauth_consumer_key": FLICKR_API_KEY,
        "oauth_token": creds["oauth_token"],
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(_t.time())),
        "oauth_nonce": uuid.uuid4().hex,
        "oauth_version": "1.0",
    }
    all_sign_params = {**flickr_params, **oauth_params}
    sorted_params = "&".join(
        f"{urllib.parse.quote(k, '')}={urllib.parse.quote(str(v), '')}"
        for k, v in sorted(all_sign_params.items())
    )
    base_string = f"POST&{urllib.parse.quote(upload_url, '')}&{urllib.parse.quote(sorted_params, '')}"
    signing_key = f"{urllib.parse.quote(FLICKR_SECRET, '')}&{urllib.parse.quote(creds['oauth_secret'], '')}"
    sig = base64.b64encode(
        hmac.new(signing_key.encode(), base_string.encode(), hashlib.sha1).digest()
    ).decode()
    oauth_params["oauth_signature"] = sig

    auth_header = "OAuth " + ", ".join(
        f'{k}="{urllib.parse.quote(str(v), "")}"'
        for k, v in oauth_params.items()
    )

    content_type = _content_type_for_filename(filename)

    # Stream file to Flickr — httpx constructs the multipart body and reads
    # the file in chunks, so a 1GB video doesn't get buffered into memory.
    # Long timeout because video uploads from a home network can take a while.
    with open(file_path, "rb") as f:
        # httpx can derive a stale multipart Content-Length from a converted
        # file on some mounted NAS filesystems. Converted JPEGs are modest in
        # size, so freeze those bytes before constructing the request. Original
        # videos and other large media remain streamed from disk.
        upload_body = f.read() if converted_heic else f
        files = {"photo": (filename, upload_body, content_type)}
        async with httpx.AsyncClient(timeout=3600) as client:
            resp = await client.post(
                upload_url,
                data=flickr_params,
                files=files,
                headers={"Authorization": auth_header},
            )

    if resp.status_code not in range(200, 300):
        raise HTTPException(502, f"Flickr upload failed (HTTP {resp.status_code}): {resp.text[:500]}")

    # Parse photo ID from XML response: <photoid>12345</photoid>
    response_text = resp.text
    import re
    match = re.search(r"<photoid>(\d+)</photoid>", response_text)
    if not match:
        err_match = re.search(r'<err code="(\d+)" msg="([^"]*)"', response_text)
        if err_match:
            raise HTTPException(502, f"Flickr upload error {err_match.group(1)}: {err_match.group(2)}")
        raise HTTPException(502, f"Could not parse Flickr upload response: {response_text[:500]}")

    return match.group(1)


@app.post("/uploads/resumable")
def start_resumable_upload(
    body: ResumableUploadRequest,
    user=Depends(get_current_user),
):
    """Create or resume an account-owned, idempotent upload session."""
    user_id = user.get("user_id")
    if not user_id:
        raise HTTPException(403, "A household account is required for resumable uploads")
    client_upload_id, filename, content_type = _validate_resumable_upload(body)

    album = None
    if body.album_id:
        album = _resolve_album(body.album_id)
        if not album:
            raise HTTPException(404, f"Album '{body.album_id}' not found")

    rows = db_query(
        "SELECT * FROM upload_sessions WHERE client_upload_id = %s",
        (client_upload_id,),
    )
    if rows:
        row = rows[0]
        if str(row["user_id"]) != str(user_id):
            raise HTTPException(409, "Upload ID belongs to another account")
        if row["original_filename"] != filename or int(row["byte_size"]) != body.byte_size:
            raise HTTPException(409, "Upload ID was already used for a different file")

        if row["status"] != "completed" and row["expires_at"] < datetime.now(timezone.utc):
            try:
                os.unlink(row["temp_path"])
            except FileNotFoundError:
                pass
            db_query(
                "DELETE FROM upload_sessions WHERE id = %s AND user_id = %s",
                (str(row["id"]), user_id),
                fetch=False,
            )
        else:
            # Recover a finalization abandoned by a stopped server process.
            if (
                row["status"] == "finalizing"
                and row["updated_at"] < datetime.now(timezone.utc) - timedelta(hours=2)
            ):
                updated = db_query(
                    """
                    UPDATE upload_sessions
                    SET status = 'ready', updated_at = now()
                    WHERE id = %s
                    RETURNING *
                    """,
                    (str(row["id"]),),
                )
                row = updated[0]
            return _resumable_session_response(row)

    staging_directory = Path(PHOTO_STORAGE_ROOT) / ".uploads"
    staging_directory.mkdir(parents=True, exist_ok=True)
    upload_id = str(uuid.uuid4())
    temp_path = str(staging_directory / f"{upload_id}.part")
    Path(temp_path).touch(exist_ok=False)
    try:
        rows = db_query(
            """
            INSERT INTO upload_sessions (
                id, client_upload_id, user_id, original_filename, content_type,
                byte_size, title, description, taken_at_unix, latitude,
                longitude, temp_path, album_id
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                upload_id, client_upload_id, user_id, filename, content_type,
                body.byte_size, body.title or os.path.splitext(filename)[0],
                body.description, body.taken_at_unix, body.latitude,
                body.longitude, temp_path, album["id"] if album else None,
            ),
        )
    except Exception:
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
        raise
    return _resumable_session_response(rows[0])


@app.put("/uploads/resumable/{upload_id}")
async def append_resumable_upload_chunk(
    upload_id: str,
    request: FastAPIRequest,
    offset: int = Query(..., ge=0),
    user=Depends(get_current_user),
):
    """Append one bounded chunk at the exact server-confirmed offset."""
    user_id = user.get("user_id")
    if not user_id:
        raise HTTPException(403, "A household account is required for resumable uploads")
    try:
        upload_id = str(uuid.UUID(upload_id))
    except ValueError:
        raise HTTPException(400, "Invalid upload ID")

    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > RESUMABLE_CHUNK_MAX_SIZE:
                raise HTTPException(413, "Upload chunk exceeds the 8MB limit")
        except ValueError:
            raise HTTPException(400, "Invalid Content-Length")
    chunk = await request.body()
    if len(chunk) > RESUMABLE_CHUNK_MAX_SIZE:
        raise HTTPException(413, "Upload chunk exceeds the 8MB limit")

    conn = get_db()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM upload_sessions WHERE id = %s FOR UPDATE",
                (upload_id,),
            )
            row = cur.fetchone()
            if not row or str(row["user_id"]) != str(user_id):
                raise HTTPException(404, "Upload session not found")
            if row["expires_at"] < datetime.now(timezone.utc):
                raise HTTPException(410, "Upload session expired; start it again")
            if row["status"] == "completed":
                return _resumable_session_response(row)
            if row["status"] == "finalizing":
                raise HTTPException(409, "Upload is being finalized")
            if offset != int(row["received_bytes"]):
                raise HTTPException(
                    409,
                    f"Offset mismatch; server expects {row['received_bytes']}",
                )
            try:
                next_offset = append_chunk(
                    row["temp_path"],
                    expected_offset=offset,
                    expected_size=int(row["byte_size"]),
                    chunk=chunk,
                )
            except ChunkAppendError as exc:
                raise HTTPException(409, str(exc))
            status = "ready" if next_offset == int(row["byte_size"]) else "pending"
            cur.execute(
                """
                UPDATE upload_sessions
                SET received_bytes = %s, status = %s, last_error = NULL,
                    updated_at = now(), expires_at = now() + interval '7 days'
                WHERE id = %s
                RETURNING id, status, received_bytes
                """,
                (next_offset, status, upload_id),
            )
            updated = cur.fetchone()
        conn.commit()
        return {
            "upload_id": str(updated["id"]),
            "status": updated["status"],
            "next_offset": int(updated["received_bytes"]),
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


async def _finalize_resumable_upload(upload_id: str, row: dict, creds: dict) -> None:
    """Finish NAS/Flickr persistence after the HTTP request has returned."""
    nas_copy = None
    replication_job_id = None
    try:
        nas_copy = _store_nas_original(
            row["temp_path"], row["original_filename"], row["content_type"],
            row["title"], row["description"], row["taken_at_unix"],
            row["latitude"], row["longitude"], row["client_upload_id"],
        )
        if not nas_copy:
            raise RuntimeError("NAS photo storage is not configured")

        photo_id = _existing_flickr_copy(nas_copy["kindred_photo_id"])
        is_video = Path(row['original_filename']).suffix.lower() in VIDEO_EXTENSIONS
        if not photo_id and is_video:
            _queue_video(nas_copy, row['title'], row['description'], 'family',
                         row['taken_at_unix'], row['latitude'], row['longitude'])
        if not photo_id and not is_video:
            replication_job_id = _queue_flickr_replication(nas_copy["kindred_photo_id"])
            _set_replication_status(replication_job_id, "running")
            photo_id = await _upload_to_flickr(
                row["temp_path"], row["original_filename"], row["title"],
                row["description"], creds, privacy="family",
            )
            _record_flickr_copy(
                nas_copy["kindred_photo_id"], photo_id, creds.get("user_id", "")
            )
            _set_replication_status(replication_job_id, "done")

        if photo_id and row["taken_at_unix"]:
            try:
                await _flickr_set_dates(photo_id, int(row["taken_at_unix"]), creds)
            except Exception as exc:
                print(f"[upload] setDates failed for photo {photo_id}: {exc}")
        if photo_id and row["latitude"] is not None and row["longitude"] is not None:
            try:
                await _flickr_set_location(
                    photo_id, float(row["latitude"]), float(row["longitude"]), creds
                )
            except Exception as exc:
                print(f"[upload] setLocation failed for photo {photo_id}: {exc}")

        if row.get("album_id"):
            album = _album_row(str(row["album_id"]))
            if album:
                await _add_photo_to_album_everywhere(
                    album, nas_copy["kindred_photo_id"], photo_id,
                    row["original_filename"], creds, str(row["user_id"]),
                )

        db_query(
            """
            UPDATE upload_sessions
            SET status = 'completed', kindred_photo_id = %s, flickr_photo_id = %s,
                last_error = NULL, updated_at = now()
            WHERE id = %s
            """,
            (nas_copy["kindred_photo_id"], photo_id, upload_id),
            fetch=False,
        )

        for candidate in (row["temp_path"], row["temp_path"] + ".jpg"):
            try:
                os.unlink(candidate)
            except FileNotFoundError:
                pass

        ext = os.path.splitext(row["original_filename"])[1].lower()
        if ext not in VIDEO_EXTENSIONS:
            try:
                await _process_uploaded_photo(photo_id)
            except Exception as exc:
                print(f"[upload] processing failed for photo {photo_id}: {exc}")
    except Exception as exc:
        if replication_job_id is not None:
            try:
                _set_replication_status(replication_job_id, "retry", str(exc)[:1000])
            except Exception:
                pass
        try:
            db_query(
                """
                UPDATE upload_sessions
                SET status = 'ready', last_error = %s, updated_at = now()
                WHERE id = %s AND status = 'finalizing'
                """,
                (str(exc)[:1000], upload_id),
                fetch=False,
            )
        except Exception as update_exc:
            print(f"[upload] could not persist finalization failure: {update_exc}")
        print(f"[upload] resumable finalization failed for {upload_id}: {exc}")


@app.post("/uploads/resumable/{upload_id}/complete")
async def complete_resumable_upload(
    upload_id: str,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_user),
):
    """Commit a complete staged original to the NAS, then mirror it to Flickr."""
    user_id = user.get("user_id")
    if not user_id:
        raise HTTPException(403, "A household account is required for resumable uploads")
    try:
        upload_id = str(uuid.UUID(upload_id))
    except ValueError:
        raise HTTPException(400, "Invalid upload ID")

    creds = get_flickr_credentials()
    if not creds:
        raise HTTPException(500, "Flickr OAuth not configured — ask your household admin to connect Flickr")

    conn = get_db()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM upload_sessions WHERE id = %s FOR UPDATE",
                (upload_id,),
            )
            row = cur.fetchone()
            if not row or str(row["user_id"]) != str(user_id):
                raise HTTPException(404, "Upload session not found")
            if row["status"] == "completed":
                return _resumable_session_response(row)
            if row["status"] == "finalizing":
                return _resumable_session_response(row)
            if row["status"] != "ready" or int(row["received_bytes"]) != int(row["byte_size"]):
                raise HTTPException(
                    409,
                    f"Upload is incomplete; server has {row['received_bytes']} of {row['byte_size']} bytes",
                )
            try:
                actual_size = os.path.getsize(row["temp_path"])
            except FileNotFoundError:
                raise HTTPException(409, "Staged upload is missing; start it again")
            if actual_size != int(row["byte_size"]):
                raise HTTPException(409, "Staged upload size does not match the declared size")
            cur.execute(
                """
                UPDATE upload_sessions
                SET status = 'finalizing', updated_at = now()
                WHERE id = %s
                RETURNING *
                """,
                (upload_id,),
            )
            row = cur.fetchone()
        conn.commit()
    except Exception:
        conn.rollback()
        conn.close()
        raise
    conn.close()

    background_tasks.add_task(_finalize_resumable_upload, upload_id, dict(row), creds)
    return _resumable_session_response(row)


@app.post("/photos/upload")
async def upload_photo(
    background_tasks: BackgroundTasks,
    request: FastAPIRequest,
    photo: UploadFile = File(...),
    title: str = Form(""),
    description: str = Form(""),
    taken_at_unix: int | None = Form(None),
    latitude: float | None = Form(None),
    longitude: float | None = Form(None),
    client_upload_id: str | None = Form(None),
    skip_processing: bool = Query(False),
    privacy: str = Query("family"),
    album_id: str | None = Query(None),
    user=Depends(get_current_user),
):
    """Commit a photo/video to the NAS, then mirror it to Flickr.

    Any authenticated household member can upload — the admin's Flickr OAuth
    tokens are used so members don't need their own Flickr accounts.

    Query params:
    - `skip_processing=true` — suppress per-photo ML for bulk runs (then hit /scan/auto)
    - `privacy` — one of: private, family (default), friends, friends_family, public
    - `album_id` — Kindred album UUID, slug, or Flickr photoset id. The photo
      is symlinked into the album on the NAS and added to its Flickr photoset.
    """
    import tempfile

    if privacy not in PRIVACY_FLAGS:
        raise HTTPException(400, f"Invalid privacy '{privacy}'. Must be one of: {', '.join(PRIVACY_FLAGS)}")

    _validate_upload_file(photo)

    # Resolve the album before spending bandwidth on the upload, so a bad
    # album reference fails fast instead of after a 1GB video lands.
    album = None
    if album_id:
        album = _resolve_album(album_id)
        if not album:
            raise HTTPException(404, f"Album '{album_id}' not found")

    if client_upload_id:
        try:
            client_upload_id = str(uuid.UUID(client_upload_id))
        except ValueError:
            raise HTTPException(400, "client_upload_id must be a UUID")

    creds = get_flickr_credentials()
    if not creds:
        raise HTTPException(500, "Flickr OAuth not configured — ask your household admin to connect Flickr")

    filename = photo.filename or "upload.jpg"
    if not title:
        title = os.path.splitext(filename)[0]

    # Spool the upload to a tempfile in chunks, enforcing the size limit as we go.
    # This keeps memory bounded even for 1GB videos — UploadFile would otherwise
    # buffer in a SpooledTemporaryFile but `.read()` returns the whole thing.
    suffix = os.path.splitext(filename)[1]
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp_path = tmp.name
    try:
        total = 0
        CHUNK = 1024 * 1024  # 1 MB
        while True:
            chunk = await photo.read(CHUNK)
            if not chunk:
                break
            total += len(chunk)
            if total > _original_upload_limit(filename):
                tmp.close()
                raise HTTPException(
                    413,
                    f"File too large. Maximum size is {_original_upload_limit(filename) // (1024*1024)}MB",
                )
            tmp.write(chunk)
        tmp.close()
        if total == 0:
            raise HTTPException(400, "Empty file")

        nas_copy = _store_nas_original(
            tmp_path, filename, _content_type_for_filename(filename), title,
            description, taken_at_unix, latitude, longitude,
            client_upload_id,
        )
        if nas_copy and Path(filename).suffix.lower() in VIDEO_EXTENSIONS:
            photo_id = _existing_flickr_copy(nas_copy['kindred_photo_id'])
            if not photo_id:
                _queue_video(nas_copy, title, description, privacy, taken_at_unix, latitude, longitude)
            album_result = None
            if album:
                album_result = await _add_photo_to_album_everywhere(
                    album, nas_copy['kindred_photo_id'], photo_id, filename, creds, user.get('user_id'))
            return dict(photo_id=photo_id, kindred_photo_id=nas_copy['kindred_photo_id'],
                        status='ok', nas_status='available',
                        flickr_status='available' if photo_id else 'pending',
                        deduplicated=nas_copy['deduplicated'],
                        album_id=str(album['id']) if album else None, album=album_result)
        replication_job_id = None
        photo_id = None
        if nas_copy:
            photo_id = _existing_flickr_copy(nas_copy["kindred_photo_id"])
            if not photo_id:
                replication_job_id = _queue_flickr_replication(nas_copy["kindred_photo_id"])
                _set_replication_status(replication_job_id, "running")
        if not photo_id:
            try:
                photo_id = await _upload_to_flickr(
                    tmp_path, filename, title, description, creds, privacy=privacy
                )
            except Exception as exc:
                if replication_job_id is not None:
                    _set_replication_status(replication_job_id, "retry", str(exc)[:1000])
                raise
        if nas_copy:
            _record_flickr_copy(
                nas_copy["kindred_photo_id"], photo_id, creds.get("user_id", "")
            )
            if replication_job_id is not None:
                _set_replication_status(replication_job_id, "done")
    finally:
        # _upload_to_flickr may have replaced tmp_path with a .jpg sibling for
        # HEIC; clean up whatever's left.
        for candidate in (tmp_path, tmp_path + ".jpg"):
            try:
                os.unlink(candidate)
            except FileNotFoundError:
                pass
            except Exception as e:
                print(f"[upload] tempfile cleanup failed for {candidate}: {e}")

    # Restore original capture date from Google Takeout sidecar (EXIF is
    # often stripped or wrong on Takeout exports). Failure non-fatal — the
    # photo is on Flickr regardless, just dated as upload time.
    if taken_at_unix:
        try:
            await _flickr_set_dates(photo_id, taken_at_unix, creds)
        except Exception as e:
            print(f"[upload] setDates failed for photo {photo_id}: {e}")

    # Apply GPS coords from sidecar.
    if latitude is not None and longitude is not None:
        try:
            await _flickr_set_location(photo_id, latitude, longitude, creds)
        except Exception as e:
            print(f"[upload] setLocation failed for photo {photo_id}: {e}")

    # Add to album if requested. Failure here doesn't roll back the upload —
    # the photo is stored on both providers, the album link just didn't take.
    album_result = None
    if album:
        album_result = await _add_photo_to_album_everywhere(
            album,
            nas_copy["kindred_photo_id"] if nas_copy else None,
            photo_id,
            filename,
            creds,
            user.get("user_id"),
        )

    # Trigger async ML processing for images (not videos), unless caller opted out
    ext = os.path.splitext(filename)[1].lower()
    if not skip_processing and ext not in VIDEO_EXTENSIONS:
        background_tasks.add_task(_process_uploaded_photo, photo_id)

    return {
        "photo_id": photo_id,
        "kindred_photo_id": nas_copy["kindred_photo_id"] if nas_copy else None,
        "status": "ok",
        "nas_status": "available" if nas_copy else "disabled",
        "flickr_status": "available",
        "deduplicated": nas_copy["deduplicated"] if nas_copy else False,
        "album_id": str(album["id"]) if album else None,
        "album": album_result,
    }


@app.get('/photos/{photo_id}/video-mirror')
def get_video_mirror_status(photo_id: str, user=Depends(get_current_user)):
    from video_queue import queue_root
    try:
        photo_id = str(uuid.UUID(photo_id))
    except ValueError:
        raise HTTPException(400, 'Invalid Kindred photo ID')
    path = queue_root() / photo_id / 'job.json'
    if not path.exists():
        raise HTTPException(404, 'Video mirror is not queued')
    job = json.loads(path.read_text())
    manifest_path = path.with_name('manifest.json')
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'parts': {}}
    return dict(photo_id=photo_id, status=job['status'], phase=job.get('phase'),
                error=job.get('error'), next_attempt=job.get('next_attempt'),
                complete=job['status'] == 'done', parts=manifest['parts'],
                owner_id=manifest.get('owner_id'), duration=manifest.get('duration'))


@app.post("/photos/backup-status")
def get_photo_backup_status(
    body: BackupStatusRequest,
    user=Depends(get_current_user),
):
    """Verify durable provider copies before a client offers local deletion."""
    photo_ids = list(dict.fromkeys(body.flickr_photo_ids))
    if len(photo_ids) > 500:
        raise HTTPException(400, "Maximum 500 photo IDs per status request")
    if not photo_ids:
        return {"items": []}

    rows = db_query(
        """
        SELECT flickr.provider_key AS flickr_photo_id,
               p.id AS kindred_photo_id,
               flickr.status AS flickr_status,
               nas.status AS nas_status
        FROM photo_copies flickr
        JOIN photos p ON p.id = flickr.photo_id
        LEFT JOIN photo_copies nas
          ON nas.photo_id = p.id AND nas.provider = 'nas'
        WHERE flickr.provider = 'flickr'
          AND flickr.provider_key = ANY(%s)
        """,
        (photo_ids,),
    )
    return {"items": build_backup_status_items(photo_ids, rows)}


@app.post("/photos/{photo_id}/metadata")
async def update_photo_metadata(
    photo_id: str,
    taken_at_unix: int | None = Form(None),
    latitude: float | None = Form(None),
    longitude: float | None = Form(None),
    user=Depends(get_current_user),
):
    """Apply metadata to an existing Flickr photo.

    Used to retroactively fix photos uploaded before the sidecar-aware
    upload path existed — desktop client walks its done queue and calls this
    for each photo where a Google Takeout sidecar is now available.
    """
    creds = get_flickr_credentials()
    if not creds:
        raise HTTPException(500, "Flickr OAuth not configured")

    applied = []
    if taken_at_unix:
        await _flickr_set_dates(photo_id, taken_at_unix, creds)
        applied.append("date_taken")
    if latitude is not None and longitude is not None:
        await _flickr_set_location(photo_id, latitude, longitude, creds)
        applied.append("location")
    return {"photo_id": photo_id, "applied": applied}


@app.post("/photos/upload-batch")
async def upload_photos_batch(
    background_tasks: BackgroundTasks,
    request: FastAPIRequest,
    photos: List[UploadFile] = File(...),
    title: str = Form(""),
    description: str = Form(""),
    user=Depends(get_current_user),
):
    """Upload multiple photos/videos (up to 10) to Flickr via admin credentials."""
    if len(photos) > 10:
        raise HTTPException(400, "Maximum 10 files per batch upload")
    if len(photos) == 0:
        raise HTTPException(400, "No files provided")

    creds = get_flickr_credentials()
    if not creds:
        raise HTTPException(500, "Flickr OAuth not configured — ask your household admin to connect Flickr")

    results = []
    for photo_file in photos:
        try:
            result = await upload_photo(
                background_tasks, request, photo=photo_file, title=title,
                description=description, taken_at_unix=None, latitude=None,
                longitude=None, client_upload_id=None, skip_processing=False,
                privacy='family', album_id=None, user=user)
            results.append(dict(result, filename=photo_file.filename))
        except Exception as exc:
            results.append(dict(filename=photo_file.filename, status='error',
                                error=str(getattr(exc, 'detail', exc))))
    ok_count = sum(r['status'] == 'ok' for r in results)
    return {'results': results, 'uploaded': ok_count, 'failed': len(photos) - ok_count}


async def _process_uploaded_photo(
    photo_id: str,
    local_path: str | None = None,
    cluster_after: bool = True,
    fetch_flickr_info: bool = True,
) -> None:
    """Run ML for a Flickr photo, preferring its NAS original when supplied."""
    import urllib.parse

    try:
        photo_url = ""
        if fetch_flickr_info:
            flickr_creds = get_flickr_credentials()
            if not flickr_creds:
                return
            flickr_url = "https://api.flickr.com/services/rest"
            params = {
                "method": "flickr.photos.getInfo", "photo_id": photo_id,
                "format": "json", "nojsoncallback": "1",
            }
            oauth_params = _flickr_oauth_sign(flickr_url, params)
            auth_header = "OAuth " + ", ".join(
                f'{k}="{urllib.parse.quote(str(v), "")}"'
                for k, v in oauth_params.items()
            )
            qs = urllib.parse.urlencode(params)
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{flickr_url}?{qs}", headers={"Authorization": auth_header}
                )
                data = resp.json()
            if data.get("stat") != "ok":
                print(f"[upload-process] Could not fetch photo info for {photo_id}: {data.get('message')}")
                return
            info = data["photo"]
            server, secret = info.get("server", ""), info.get("secret", "")
            photo_url = f"https://live.staticflickr.com/{server}/{photo_id}_{secret}_z.jpg"
            owner_id = flickr_creds.get("user_id", "") or ""
            title_value = info.get("title", {})
            title = title_value.get("_content", "") if isinstance(title_value, dict) else str(title_value)
            photo = {
                "id": photo_id, "url": photo_url, "title": title,
                "owner": owner_id, "thumb": photo_url.replace("_z.jpg", "_q.jpg"),
                "flickr_url": f"https://www.flickr.com/photos/{owner_id}/{photo_id}" if owner_id else "",
            }
        else:
            catalog = db_query(
                "SELECT COALESCE(NULLIF(title, ''), original_filename, '') AS title FROM photos WHERE id=%s",
                (photo_id,),
            )
            photo = {
                "id": photo_id, "url": "", "title": catalog[0]["title"] if catalog else "",
                "owner": "", "thumb": "", "flickr_url": "",
            }

        # Run ML processing. NAS recovery passes a local original so indexing does
        # not waste bandwidth downloading the same image back from Flickr. Fall
        # back to Flickr's normalized JPEG for formats OpenCV cannot decode.
        import cv2
        img = cv2.imread(local_path, cv2.IMREAD_COLOR) if local_path else None
        if img is None and photo_url:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(photo_url)
                resp.raise_for_status()
            arr = np.frombuffer(resp.content, np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            print(f"[upload-process] Could not decode image for {photo_id}")
            return

        face_app = get_face_app()
        yolo = get_yolo()
        conn = get_db()
        counts = {"people": 0, "pets": 0, "vehicles": 0}

        try:
            faces = face_app.get(img)
            for face in faces:
                bbox = face.bbox.tolist()
                bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
                if bw < 24 or bh < 24:
                    continue
                x1, y1 = max(0, int(bbox[0])), max(0, int(bbox[1]))
                x2, y2 = min(img.shape[1], int(bbox[2])), min(img.shape[0], int(bbox[3]))
                face_crop = img[y1:y2, x1:x2]
                if face_crop.size > 0:
                    gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
                    if cv2.Laplacian(gray, cv2.CV_64F).var() < 15:
                        continue
                if float(face.det_score) < 0.35:
                    continue
                insert_detection(conn, photo, "people", "face",
                    bbox, float(face.det_score),
                    face.embedding.tolist(), img)
                counts["people"] += 1

            yolo_results = yolo(img[:, :, ::-1], verbose=False)
            for box in yolo_results[0].boxes:
                cls_id = int(box.cls[0])
                score = float(box.conf[0])
                if score < 0.4:
                    continue
                xyxy = box.xyxy[0].tolist()
                clip_emb = clip_embed_image(img, bbox=xyxy)
                emb_list = clip_emb.tolist() if clip_emb is not None else []
                if cls_id in PET_CLASSES:
                    insert_detection(conn, photo, "pets", PET_CLASSES[cls_id],
                        xyxy, score, emb_list, img)
                    counts["pets"] += 1
                elif cls_id in VEHICLE_CLASSES:
                    insert_detection(conn, photo, "vehicles", VEHICLE_CLASSES[cls_id],
                        xyxy, score, emb_list, img)
                    counts["vehicles"] += 1

            photo_clip = clip_embed_image(img)
            if photo_clip is not None:
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO photo_embeddings (photo_id, clip_embedding)
                        VALUES (%s, %s) ON CONFLICT (photo_id) DO NOTHING
                    """, (photo_id, np.array(photo_clip, dtype=np.float32)))

            try:
                colors = _extract_dominant_colors(img)
                if colors:
                    with conn.cursor() as cur:
                        cur.execute("""
                            INSERT INTO photo_colors (photo_id, colors)
                            VALUES (%s, %s) ON CONFLICT (photo_id) DO NOTHING
                        """, (photo_id, json.dumps(colors)))
            except Exception:
                pass

            # Record completion even when the image contains no object
            # detections; otherwise a restart analyzes it forever.
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO processed_photos (photo_id) VALUES (%s) ON CONFLICT DO NOTHING",
                    (photo_id,),
                )

            conn.commit()

            if cluster_after:
                for cat in ("people", "pets", "vehicles"):
                    if counts[cat] <= 0:
                        continue
                    try:
                        run_clustering(cat, distance_threshold=0.80)
                    except Exception as e:
                        print(f"  upload-process cluster {cat} failed: {e}")

        except Exception as e:
            conn.rollback()
            print(f"[upload-process] ML processing failed for {photo_id}: {e}")
        finally:
            conn.close()

    except Exception as e:
        print(f"[upload-process] Failed to process uploaded photo {photo_id}: {e}")


@app.get("/search")
def search_photos(
    q: str = "",
    media: str = Query("all", description="all, photo, or video"),
    date_from: str | None = Query(None, description="ISO date, inclusive"),
    date_to: str | None = Query(None, description="ISO date, inclusive"),
    date_field: str = Query("taken", description="Apply the date range to 'taken' or 'added'"),
    cluster_id: str | None = Query(None, description="Restrict to one person/pet/vehicle cluster"),
    category: str | None = Query(None, description="Cluster category, required with cluster_id"),
    album_id: str | None = Query(None, description="Restrict to one album"),
    sort: str = Query("newest", description="Ordering when there is no free text"),
    limit: int = Query(60, ge=1, le=200),
):
    """Search the catalog by free text, facets, or both.

    Free text is answered from three sources, best first: photos of a person
    whose name fuzzy-matches the query, CLIP visual similarity, and a literal
    match on title or filename. The last of those is what lets videos appear
    at all — they have no embeddings and no detections.

    With no `q`, the facets stand on their own and this is a filtered browse.
    """
    import search_api

    facets = search_api.Facets(
        media=media, date_from=date_from, date_to=date_to, date_field=date_field,
        cluster_id=cluster_id, category=category, album_id=album_id,
    )
    query = q.strip()

    if not query:
        results = search_api.browse(db_query, facets, sort=sort, limit=limit)
        return {"results": results, "query": "", "facets": _facet_summary(facets)}

    ranked = []

    # Phase 1 — people. A name match is a stronger signal than anything the
    # visual index can offer, so these lead the results.
    if not facets.cluster_id:
        for match in _matching_clusters(query, limit=3):
            person_facets = search_api.Facets(
                media=media, date_from=date_from, date_to=date_to, date_field=date_field,
                cluster_id=match["cluster_id"], category=match["category"],
                album_id=album_id,
            )
            people = search_api.browse(db_query, person_facets, sort=sort, limit=limit)
            for row in people:
                row.update(match_type="person", match_name=match["label"],
                           match_cluster_id=match["cluster_id"],
                           match_category=match["category"], distance=0.0)
            ranked.append(people)

    # Phase 2 — CLIP visual similarity over the ANN index.
    try:
        embedding = np.array(clip_embed_text(query), dtype=np.float32)
        visual = search_api.by_vector(db_query, embedding, facets, limit=limit)
        for row in visual:
            row["match_type"] = "visual"
        ranked.append(visual)
    except Exception as exc:
        print(f"[search] visual phase failed for {query!r}: {exc}")

    # Phase 3 — literal title/filename match, the only path that reaches videos.
    literal = search_api.by_text(db_query, query, facets, limit=limit)
    for row in literal:
        row.setdefault("match_type", "text")
    ranked.append(literal)

    results = search_api.merge(*ranked, limit=limit)
    return {"results": results, "query": query, "facets": _facet_summary(facets)}


def _facet_summary(facets) -> dict:
    return {
        "media": facets.media,
        "date_from": facets.date_from,
        "date_to": facets.date_to,
        "date_field": facets.date_field,
        "cluster_id": facets.cluster_id,
        "category": facets.category,
        "album_id": facets.album_id,
    }


def _matching_clusters(query: str, limit: int = 3) -> list[dict]:
    """Named clusters whose label fuzzy-matches the query.

    Trigram similarity so "mike" reaches "Michael" and "jen" reaches
    "Jennifer"; migration 006 adds the GIN index this leans on.
    """
    rows = db_query("""
        SELECT c.id AS cluster_id, c.label, c.category,
               similarity(LOWER(c.label), LOWER(%s)) AS sim,
               LOWER(c.label) LIKE LOWER(%s) AS prefix_match
        FROM clusters c
        WHERE c.label IS NOT NULL AND (
            c.label ILIKE %s
            OR LOWER(c.label) LIKE LOWER(%s)
            OR similarity(LOWER(c.label), LOWER(%s)) > 0.25
        )
        ORDER BY prefix_match DESC, sim DESC, LENGTH(c.label) ASC
        LIMIT %s
    """, (query, f"{query}%", f"%{query}%", f"{query}%", query, limit))
    return [dict(row) for row in rows]


# ── Scenes / Landmarks (cached) ──────────────────────────────────────────────
import time as _time

def get_cached(key: str, ttl_seconds: int = 3600):
    """Get data from DB cache if fresh enough."""
    rows = db_query("""
        SELECT data, updated_at FROM endpoint_cache
        WHERE key = %s AND updated_at > now() - interval '%s seconds'
    """, (key, ttl_seconds))
    if rows:
        return rows[0]["data"]
    return None

def set_cached(key: str, data):
    """Store data in DB cache."""
    db_query("""
        INSERT INTO endpoint_cache (key, data, updated_at) VALUES (%s, %s, now())
        ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
    """, (key, json.dumps(data)), fetch=False)

def invalidate_cache(prefix: str = ""):
    """Clear cache entries matching prefix, or all if empty."""
    if prefix:
        db_query("DELETE FROM endpoint_cache WHERE key LIKE %s", (f"{prefix}%",), fetch=False)
    else:
        db_query("DELETE FROM endpoint_cache", fetch=False)

SCENE_LABELS = [
    "beach", "mountain", "city", "forest", "indoor", "church", "sunset",
    "snow", "water", "park", "restaurant", "garden", "desert", "bridge",
    "castle", "playground", "stadium", "airport", "school", "wedding",
    "birthday party", "concert", "museum",
]

OBJECT_LABELS = [
    "car", "bicycle", "book", "phone", "laptop", "food", "cake",
    "flower", "christmas tree", "balloon", "flag", "guitar", "piano",
    "surfboard", "skateboard", "ball", "trophy", "gift", "candle",
    "hat", "sunglasses", "backpack", "umbrella", "tent", "boat",
    "airplane", "train", "motorcycle", "bus", "fire truck",
    "stroller", "swing", "slide", "trampoline", "pool",
]

_scene_cache: dict[str, tuple[float, dict]] = {}  # key -> (timestamp, data)
_SCENE_TTL = 600  # 10 minutes

@app.get("/scenes")
def get_scenes(distance_threshold: float = 0.82):
    """Return photos grouped by scene label using CLIP text search against photo_embeddings."""
    cache_key = f"scenes_{distance_threshold}"
    now = _time.time()
    if cache_key in _scene_cache:
        ts, cached = _scene_cache[cache_key]
        if now - ts < _SCENE_TTL:
            return cached

    scenes: dict[str, list] = {}
    for label in SCENE_LABELS:
        emb = clip_embed_text(f"a photo of a {label}")
        vec = np.array(emb, dtype=np.float32)
        rows = db_query("""
            SELECT pe.photo_id, pe.clip_embedding <=> %s AS distance,
                   d.photo_url, d.thumb_url, d.flickr_url, d.photo_title, d.owner
            FROM photo_embeddings pe
            JOIN LATERAL (
                SELECT DISTINCT ON (photo_id) photo_url, thumb_url, flickr_url, photo_title, owner
                FROM detections WHERE photo_id = pe.photo_id LIMIT 1
            ) d ON true
            WHERE pe.clip_embedding <=> %s < %s
            ORDER BY distance ASC
            LIMIT 50
        """, (vec, vec, distance_threshold))

        if rows:
            scenes[label] = [{
                "photo_id": r["photo_id"],
                "distance": round(float(r["distance"]), 4),
                "photo_url": r["photo_url"],
                "thumb_url": r["thumb_url"],
                "flickr_url": r["flickr_url"],
                "photo_title": r["photo_title"],
            } for r in rows]

    # Apply scene overrides: remove photos moved away from a scene and add photos moved into a scene
    try:
        override_rows = db_query("SELECT photo_id, scene FROM scene_overrides")
        # Build sets: which photo_ids are overridden TO each scene
        overrides_to: dict[str, set[str]] = {}
        # Build sets: which photo_ids have ANY override (meaning they were moved away from CLIP results)
        overridden_photos: set[str] = set()
        for r in override_rows:
            overrides_to.setdefault(r["scene"], set()).add(r["photo_id"])
            overridden_photos.add(r["photo_id"])

        # Remove overridden photos from their CLIP-assigned scenes (they've been moved)
        for label in list(scenes.keys()):
            scenes[label] = [
                p for p in scenes[label]
                if p["photo_id"] not in overridden_photos or p["photo_id"] in overrides_to.get(label, set())
            ]

        # Add override photos to their target scenes (fetch details if needed)
        for scene_label, photo_ids in overrides_to.items():
            if scene_label not in scenes:
                scenes[scene_label] = []
            existing_ids = {p["photo_id"] for p in scenes.get(scene_label, [])}
            missing_ids = [pid for pid in photo_ids if pid not in existing_ids]
            if missing_ids:
                detail_rows = db_query("""
                    SELECT DISTINCT ON (d.photo_id) d.photo_id,
                           d.photo_url, d.thumb_url, d.flickr_url, d.photo_title
                    FROM detections d WHERE d.photo_id = ANY(%s)
                """, (list(missing_ids),))
                for dr in detail_rows:
                    scenes[scene_label].append({
                        "photo_id": dr["photo_id"],
                        "distance": 0.0,
                        "photo_url": dr["photo_url"],
                        "thumb_url": dr["thumb_url"],
                        "flickr_url": dr["flickr_url"],
                        "photo_title": dr["photo_title"],
                    })

        # Remove empty scenes
        scenes = {k: v for k, v in scenes.items() if v}
    except Exception:
        pass  # If scene_overrides table doesn't exist yet, just skip

    result = {"scenes": scenes}
    _scene_cache[cache_key] = (now, result)
    return result

_object_cache: dict[str, tuple[float, dict]] = {}

@app.get("/objects")
def get_objects(distance_threshold: float = 0.80):
    """Return photos grouped by detected object using CLIP text search."""
    cache_key = f"objects_{distance_threshold}"
    now = _time.time()
    if cache_key in _object_cache:
        ts, cached = _object_cache[cache_key]
        if now - ts < _SCENE_TTL:
            return cached

    objects: dict[str, list] = {}
    for label in OBJECT_LABELS:
        emb = clip_embed_text(f"a photo containing a {label}")
        vec = np.array(emb, dtype=np.float32)
        rows = db_query("""
            SELECT pe.photo_id, pe.clip_embedding <=> %s AS distance,
                   d.photo_url, d.thumb_url, d.flickr_url, d.photo_title, d.owner
            FROM photo_embeddings pe
            JOIN LATERAL (
                SELECT DISTINCT ON (photo_id) photo_url, thumb_url, flickr_url, photo_title, owner
                FROM detections WHERE photo_id = pe.photo_id LIMIT 1
            ) d ON true
            WHERE pe.clip_embedding <=> %s < %s
            ORDER BY distance ASC
            LIMIT 30
        """, (vec, vec, distance_threshold))

        if rows:
            objects[label] = [{
                "photo_id": r["photo_id"],
                "distance": round(float(r["distance"]), 4),
                "photo_url": r["photo_url"],
                "thumb_url": r["thumb_url"],
                "flickr_url": r["flickr_url"],
                "photo_title": r["photo_title"],
            } for r in rows]

    result = {"objects": objects}
    _object_cache[cache_key] = (now, result)
    return result

# ── Event Detection ────────────────────────────────────────────────────────

_event_cache: dict[str, tuple[float, dict]] = {}

@app.get("/events")
def get_events(time_gap_hours: float = 4.0, visual_threshold: float = 0.90, min_photos: int = 2):
    """Detect events by clustering photos with close timestamps and visual similarity."""
    cache_key = f"events_{time_gap_hours}_{visual_threshold}_{min_photos}"
    now = _time.time()
    if cache_key in _event_cache:
        ts, cached = _event_cache[cache_key]
        if now - ts < _SCENE_TTL:
            return cached

    from sklearn.preprocessing import normalize

    # Get photos with timestamps — no CLIP requirement, time proximity is enough
    rows = db_query("""
        SELECT pm.photo_id, pm.date_taken,
               d.thumb_url, d.flickr_url, d.photo_title, d.photo_url
        FROM photo_metadata pm
        JOIN LATERAL (
            SELECT DISTINCT ON (photo_id) thumb_url, flickr_url, photo_title, photo_url
            FROM detections WHERE photo_id = pm.photo_id LIMIT 1
        ) d ON true
        WHERE pm.date_taken IS NOT NULL
        ORDER BY pm.date_taken ASC
    """)

    if len(rows) < min_photos:
        result = {"events": [], "count": 0}
        _event_cache[cache_key] = (now, result)
        return result

    # Phase 1: Group by time proximity
    time_groups: list[list[int]] = []
    current_group: list[int] = [0]
    gap_seconds = time_gap_hours * 3600

    for i in range(1, len(rows)):
        prev_dt = rows[i-1]["date_taken"]
        curr_dt = rows[i]["date_taken"]
        if prev_dt and curr_dt:
            diff = abs((curr_dt - prev_dt).total_seconds())
            if diff <= gap_seconds:
                current_group.append(i)
            else:
                if len(current_group) >= min_photos:
                    time_groups.append(current_group)
                current_group = [i]
        else:
            current_group.append(i)

    if len(current_group) >= min_photos:
        time_groups.append(current_group)

    # Phase 2: Within each time group, split by visual similarity if needed
    events = []
    for group_indices in time_groups:
        if len(group_indices) < min_photos:
            continue

        group_rows = [rows[i] for i in group_indices]

        # Build event
        first_dt = group_rows[0]["date_taken"]
        last_dt = group_rows[-1]["date_taken"]

        # Generate event name from date
        if first_dt:
            event_name = first_dt.strftime("%B %d, %Y")
            if last_dt and first_dt.date() != last_dt.date():
                event_name = f"{first_dt.strftime('%b %d')} – {last_dt.strftime('%b %d, %Y')}"
        else:
            event_name = "Unknown date"

        photos = [{
            "photo_id": r["photo_id"],
            "thumb_url": r["thumb_url"],
            "flickr_url": r["flickr_url"],
            "photo_title": r["photo_title"],
            "photo_url": r["photo_url"],
            "date_taken": str(r["date_taken"]) if r["date_taken"] else None,
        } for r in group_rows]

        events.append({
            "name": event_name,
            "photo_count": len(photos),
            "start_date": str(first_dt) if first_dt else None,
            "end_date": str(last_dt) if last_dt else None,
            "photos": photos[:50],  # Cap at 50 for response size
            "total_photos": len(photos),
        })

    # Apply saved event names and filter dismissed
    label_rows = db_query("SELECT event_key, name FROM event_labels")
    saved_names = {r["event_key"]: r["name"] for r in label_rows}
    filtered_events = []
    for event in events:
        key = event.get("start_date") or event.get("name")
        event["event_key"] = key
        if key and saved_names.get(key) == "__dismissed__":
            continue  # Skip dismissed events
        if key and key in saved_names:
            event["custom_name"] = saved_names[key]
        filtered_events.append(event)
    events = filtered_events

    # Sort by date descending (newest first)
    events.sort(key=lambda e: e.get("start_date") or "", reverse=True)

    result = {"events": events, "count": len(events)}
    _event_cache[cache_key] = (now, result)
    return result

class EventLabelRequest(BaseModel):
    event_key: str  # start_date of the event
    name: str

class EventDismissRequest(BaseModel):
    event_key: str

@app.post("/events/label")
def label_event(req: EventLabelRequest, admin=Depends(require_admin)):
    """Name an event."""
    db_query("""
        INSERT INTO event_labels (event_key, name) VALUES (%s, %s)
        ON CONFLICT (event_key) DO UPDATE SET name = EXCLUDED.name
    """, (req.event_key, req.name), fetch=False)
    _event_cache.clear()
    return {"ok": True}

@app.post("/events/dismiss")
def dismiss_event(req: EventDismissRequest, admin=Depends(require_admin)):
    """Dismiss an event so it doesn't show up."""
    db_query("""
        INSERT INTO event_labels (event_key, name) VALUES (%s, '__dismissed__')
        ON CONFLICT (event_key) DO UPDATE SET name = '__dismissed__'
    """, (req.event_key,), fetch=False)
    _event_cache.clear()
    return {"ok": True}

class EventMergeRequest(BaseModel):
    source_key: str
    target_key: str

@app.post("/events/merge")
def merge_events(req: EventMergeRequest, admin=Depends(require_admin)):
    """Merge source event into target by dismissing source. Photos naturally regroup on next cache refresh."""
    # Dismiss the source event
    db_query("""
        INSERT INTO event_labels (event_key, name) VALUES (%s, '__dismissed__')
        ON CONFLICT (event_key) DO UPDATE SET name = '__dismissed__'
    """, (req.source_key,), fetch=False)
    _event_cache.clear()
    return {"ok": True}

# ── Notifications ──────────────────────────────────────────────────────────

def create_notification(type: str, title: str, message: str = "", metadata: dict = {}):
    """Create a notification."""
    try:
        db_query("""
            INSERT INTO notifications (type, title, message, metadata)
            VALUES (%s, %s, %s, %s)
        """, (type, title, message, json.dumps(metadata)), fetch=False)
    except Exception:
        pass

@app.get("/notifications")
def get_notifications(limit: int = 20, unread_only: bool = False):
    """Get recent notifications."""
    if unread_only:
        rows = db_query("""
            SELECT id, type, title, message, metadata, read, created_at
            FROM notifications WHERE read = false
            ORDER BY created_at DESC LIMIT %s
        """, (limit,))
    else:
        rows = db_query("""
            SELECT id, type, title, message, metadata, read, created_at
            FROM notifications
            ORDER BY created_at DESC LIMIT %s
        """, (limit,))
    unread_count = db_query("SELECT COUNT(*) as cnt FROM notifications WHERE read = false")[0]["cnt"]
    return {"notifications": [dict(r) for r in rows], "unread_count": unread_count}

@app.post("/notifications/read")
def mark_notifications_read(ids: list[int] | None = None):
    """Mark notifications as read. If no ids, mark all as read."""
    if ids:
        db_query("UPDATE notifications SET read = true WHERE id = ANY(%s)", (ids,), fetch=False)
    else:
        db_query("UPDATE notifications SET read = true WHERE read = false", fetch=False)
    return {"ok": True}

@app.get("/stats")
def stats():
    rows = db_query("""
        SELECT category, COUNT(*) as detections, COUNT(DISTINCT photo_id) as photos
        FROM detections GROUP BY category
    """)
    result = {
        "people": {"detections": 0, "photos": 0},
        "pets": {"detections": 0, "photos": 0},
        "vehicles": {"detections": 0, "photos": 0},
    }
    for r in rows:
        result[r["category"]] = {"detections": r["detections"], "photos": r["photos"]}
    # Add group counts (unique clusters, excluding noise)
    group_rows = db_query("""
        SELECT dc.category, COUNT(DISTINCT dc.cluster_id) as groups
        FROM detection_clusters dc
        WHERE dc.cluster_id != '-1'
        GROUP BY dc.category
    """)
    for r in group_rows:
        if r["category"] in result:
            result[r["category"]]["groups"] = r["groups"]
    return result

class FlickrDeleteRequest(BaseModel):
    photo_ids: list[str]

@app.post("/flickr/delete")
async def delete_flickr_photos(req: FlickrDeleteRequest, admin=Depends(require_admin)):
    """Delete photos from Flickr and clean up local DB records."""
    import urllib.parse

    flickr_creds = get_flickr_credentials()
    if not FLICKR_API_KEY or not flickr_creds:
        raise HTTPException(500, "Flickr OAuth not configured")

    flickr_url = "https://api.flickr.com/services/rest"
    deleted = []
    failed = []

    async with httpx.AsyncClient(timeout=30) as client:
        for photo_id in req.photo_ids:
            try:
                params = {
                    "method": "flickr.photos.delete",
                    "photo_id": photo_id,
                    "format": "json",
                    "nojsoncallback": "1",
                }
                oauth_params = _flickr_oauth_sign(flickr_url, params, method="POST")
                # Delete requires POST
                auth_header = "OAuth " + ", ".join(
                    f'{k}="{urllib.parse.quote(str(v), "")}"'
                    for k, v in oauth_params.items()
                )
                resp = await client.post(
                    flickr_url,
                    data=params,
                    headers={"Authorization": auth_header},
                )
                data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {"stat": "ok" if resp.status_code == 200 else "fail"}

                if data.get("stat") == "ok":
                    deleted.append(photo_id)
                    # Clean up local DB
                    db_query("DELETE FROM detection_clusters WHERE detection_id IN (SELECT id FROM detections WHERE photo_id = %s)", (photo_id,), fetch=False)
                    db_query("DELETE FROM detections WHERE photo_id = %s", (photo_id,), fetch=False)
                    db_query("DELETE FROM photo_embeddings WHERE photo_id = %s", (photo_id,), fetch=False)
                    db_query("DELETE FROM photo_metadata WHERE photo_id = %s", (photo_id,), fetch=False)
                    db_query("DELETE FROM photo_text WHERE photo_id = %s", (photo_id,), fetch=False)
                    db_query("DELETE FROM photo_colors WHERE photo_id = %s", (photo_id,), fetch=False)
                    db_query("DELETE FROM processed_photos WHERE photo_id = %s", (photo_id,), fetch=False)
                else:
                    failed.append({"photo_id": photo_id, "error": data.get("message", "Unknown error")})
            except Exception as e:
                failed.append({"photo_id": photo_id, "error": str(e)})

    return {"deleted": deleted, "failed": failed, "count": len(deleted)}


@app.get("/flickr/albums")
async def list_flickr_albums(user=Depends(get_current_user)):
    """List the household's Flickr albums (photosets).
    Returns [{id, title, photo_count, primary_photo_id}].
    """
    import urllib.parse

    flickr_creds = get_flickr_credentials()
    if not FLICKR_API_KEY or not flickr_creds:
        raise HTTPException(500, "Flickr OAuth not configured")

    flickr_url = "https://api.flickr.com/services/rest"
    albums: list[dict] = []
    page = 1
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            params = {
                "method": "flickr.photosets.getList",
                "user_id": flickr_creds["user_id"],
                "per_page": "500",
                "page": str(page),
                "format": "json",
                "nojsoncallback": "1",
            }
            signed = _flickr_oauth_sign(flickr_url, params, flickr_creds)
            auth_header = "OAuth " + ", ".join(
                f'{k}="{urllib.parse.quote(str(v), "")}"' for k, v in signed.items()
            )
            qs = urllib.parse.urlencode(params)
            resp = await client.get(f"{flickr_url}?{qs}", headers={"Authorization": auth_header})
            data = resp.json()
            if data.get("stat") != "ok":
                raise HTTPException(502, f"Flickr error: {data.get('message', 'unknown')}")
            photosets = data.get("photosets", {})
            for ps in photosets.get("photoset", []):
                title = ps.get("title", {})
                title_str = title.get("_content", "") if isinstance(title, dict) else str(title)
                albums.append({
                    "id": ps["id"],
                    "title": title_str,
                    "photo_count": int(ps.get("photos", 0)),
                    "primary_photo_id": ps.get("primary"),
                })
            if page >= int(photosets.get("pages", 1)):
                break
            page += 1
    return {"albums": albums}


async def _flickr_set_dates(photo_id: str, taken_at_unix: int, creds: dict) -> None:
    """Set the 'date taken' on an existing Flickr photo.

    Flickr extracts date taken from EXIF on upload, but Google Photos Takeout
    often strips or mangles the EXIF dates — so we restore the real date from
    the sidecar JSON after upload."""
    import urllib.parse
    from datetime import datetime, timezone

    dt = datetime.fromtimestamp(taken_at_unix, tz=timezone.utc)
    date_taken_str = dt.strftime("%Y-%m-%d %H:%M:%S")

    flickr_url = "https://api.flickr.com/services/rest"
    params = {
        "method": "flickr.photos.setDates",
        "photo_id": photo_id,
        "date_taken": date_taken_str,
        "date_taken_granularity": "0",  # 0 = exact second
        "format": "json",
        "nojsoncallback": "1",
    }
    oauth_params = _flickr_oauth_sign(flickr_url, params, creds, method="POST")
    auth_header = "OAuth " + ", ".join(
        f'{k}="{urllib.parse.quote(str(v), "")}"' for k, v in oauth_params.items()
    )
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(flickr_url, data=params, headers={"Authorization": auth_header})
    try:
        data = resp.json()
    except Exception:
        data = {"stat": "fail"}
    if data.get("stat") != "ok":
        raise HTTPException(502, f"setDates failed for {photo_id}: {data.get('message', 'unknown')}")


async def _flickr_set_location(photo_id: str, lat: float, lon: float, creds: dict) -> None:
    """Set the geotag on an existing Flickr photo via flickr.photos.geo.setLocation."""
    import urllib.parse

    flickr_url = "https://api.flickr.com/services/rest"
    params = {
        "method": "flickr.photos.geo.setLocation",
        "photo_id": photo_id,
        "lat": f"{lat:.6f}",
        "lon": f"{lon:.6f}",
        "format": "json",
        "nojsoncallback": "1",
    }
    oauth_params = _flickr_oauth_sign(flickr_url, params, creds, method="POST")
    auth_header = "OAuth " + ", ".join(
        f'{k}="{urllib.parse.quote(str(v), "")}"' for k, v in oauth_params.items()
    )
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(flickr_url, data=params, headers={"Authorization": auth_header})
    try:
        data = resp.json()
    except Exception:
        data = {"stat": "fail"}
    if data.get("stat") != "ok":
        raise HTTPException(502, f"setLocation failed for {photo_id}: {data.get('message', 'unknown')}")


async def _flickr_set_perms(
    photo_id: str,
    is_public: str,
    is_friend: str,
    is_family: str,
    creds: dict,
) -> None:
    """Update visibility on an existing Flickr photo via flickr.photos.setPerms."""
    import urllib.parse

    flickr_url = "https://api.flickr.com/services/rest"
    params = {
        "method": "flickr.photos.setPerms",
        "photo_id": photo_id,
        "is_public": is_public,
        "is_friend": is_friend,
        "is_family": is_family,
        # perm_comment / perm_addmeta are required: 1 = friends and family only
        "perm_comment": "1",
        "perm_addmeta": "1",
        "format": "json",
        "nojsoncallback": "1",
    }
    oauth_params = _flickr_oauth_sign(flickr_url, params, creds, method="POST")
    auth_header = "OAuth " + ", ".join(
        f'{k}="{urllib.parse.quote(str(v), "")}"' for k, v in oauth_params.items()
    )
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(flickr_url, data=params, headers={"Authorization": auth_header})
    try:
        data = resp.json()
    except Exception:
        data = {"stat": "fail", "message": resp.text[:200] if hasattr(resp, "text") else "non-json response"}
    if data.get("stat") != "ok":
        raise HTTPException(502, f"setPerms failed: {data.get('message', 'unknown')}")


async def _list_recent_flickr_photos(min_upload_date: int, creds: dict) -> list[dict]:
    """List photos uploaded after the given Unix timestamp via flickr.people.getPhotos."""
    import urllib.parse

    flickr_url = "https://api.flickr.com/services/rest"
    out: list[dict] = []
    page = 1
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            params = {
                "method": "flickr.people.getPhotos",
                "user_id": creds["user_id"],
                "min_upload_date": str(min_upload_date),
                "per_page": "500",
                "page": str(page),
                "extras": "date_upload",
                "format": "json",
                "nojsoncallback": "1",
            }
            signed = _flickr_oauth_sign(flickr_url, params, creds)
            auth_header = "OAuth " + ", ".join(
                f'{k}="{urllib.parse.quote(str(v), "")}"' for k, v in signed.items()
            )
            qs = urllib.parse.urlencode(params)
            resp = await client.get(f"{flickr_url}?{qs}", headers={"Authorization": auth_header})
            data = resp.json()
            if data.get("stat") != "ok":
                raise HTTPException(502, f"Flickr listing error: {data.get('message', 'unknown')}")
            photos = data.get("photos", {})
            for p in photos.get("photo", []):
                out.append({"id": p["id"], "title": p.get("title", "")})
            if page >= int(photos.get("pages", 1)):
                break
            page += 1
    return out


@app.post("/photos/set-privacy")
async def bulk_set_privacy(
    privacy: str = Query("private"),
    since_hours: int = Query(24, ge=1, le=720),
    dry_run: bool = Query(False),
    admin=Depends(require_admin),
):
    """Bulk-update privacy on photos uploaded in the last N hours.

    Useful as a cleanup after a bulk run that landed with the wrong visibility
    (e.g. uploads went up before the backend understood ?privacy=private).

    Admin-only. Query params:
    - `privacy` — target visibility (private, family, friends, friends_family, public)
    - `since_hours` — only photos uploaded within this window (1–720)
    - `dry_run=true` — return the count without making changes
    """
    import asyncio
    import time as _t

    if privacy not in PRIVACY_FLAGS:
        raise HTTPException(400, f"Invalid privacy '{privacy}'. Must be one of: {', '.join(PRIVACY_FLAGS)}")

    creds = get_flickr_credentials()
    if not creds:
        raise HTTPException(500, "Flickr OAuth not configured")

    min_upload_date = int(_t.time()) - (since_hours * 3600)
    photos = await _list_recent_flickr_photos(min_upload_date, creds)

    if dry_run:
        return {
            "matched": len(photos),
            "updated": 0,
            "failed": [],
            "dry_run": True,
            "privacy": privacy,
            "since_hours": since_hours,
        }

    is_public, is_friend, is_family = PRIVACY_FLAGS[privacy]
    updated = 0
    failed: list[dict] = []
    for p in photos:
        try:
            await _flickr_set_perms(p["id"], is_public, is_friend, is_family, creds)
            updated += 1
            # gentle rate limiting — Flickr's per-key limit is 3600/hr
            await asyncio.sleep(0.05)
        except Exception as e:
            failed.append({"photo_id": p["id"], "error": str(e)})

    return {
        "matched": len(photos),
        "updated": updated,
        "failed": failed,
        "dry_run": False,
        "privacy": privacy,
        "since_hours": since_hours,
    }


async def _add_photo_to_album(photo_id: str, album_id: str, creds: dict) -> None:
    """Add a single photo to a Flickr album (photoset)."""
    import urllib.parse

    flickr_url = "https://api.flickr.com/services/rest"
    params = {
        "method": "flickr.photosets.addPhoto",
        "photoset_id": album_id,
        "photo_id": photo_id,
        "format": "json",
        "nojsoncallback": "1",
    }
    oauth_params = _flickr_oauth_sign(flickr_url, params, creds, method="POST")
    auth_header = "OAuth " + ", ".join(
        f'{k}="{urllib.parse.quote(str(v), "")}"' for k, v in oauth_params.items()
    )
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            flickr_url,
            data=params,
            headers={"Authorization": auth_header},
        )
    try:
        data = resp.json()
    except Exception:
        data = {"stat": "ok" if resp.status_code == 200 else "fail"}
    if data.get("stat") != "ok":
        # code 3 = "Photo already in set" — treat as success
        if data.get("code") == 3:
            return
        raise HTTPException(502, f"Flickr addPhoto failed: {data.get('message', 'unknown')}")


# ── Albums ───────────────────────────────────────────────────────────────────
# Kindred owns the album list. A Flickr photoset and a NAS symlink directory are
# both projections of an `albums` row — the album exists here first, and each
# projection is filled in lazily and best-effort so a Flickr outage or a
# disabled NAS never costs you the upload.

def _unique_album_slug(name: str) -> str:
    base = album_slug(name)
    taken = {
        row["slug"]
        for row in db_query("SELECT slug FROM albums WHERE slug LIKE %s", (base + "%",))
    }
    try:
        return unique_album_slug(name, taken)
    except ValueError:
        return f"{base}-{uuid.uuid4().hex[:8]}"


def _album_row(album_id: str) -> dict | None:
    rows = db_query("SELECT * FROM albums WHERE id = %s", (album_id,))
    return rows[0] if rows else None


def _resolve_album(reference: str) -> dict | None:
    """Look an album up by Kindred UUID, slug, or Flickr photoset id.

    Accepting a bare Flickr photoset id keeps the pre-albums `album_id=` upload
    contract working, and adopts that photoset into an `albums` row the first
    time it is used so it becomes Kindred-owned from then on.
    """
    reference = (reference or "").strip()
    if not reference:
        return None

    try:
        return _album_row(str(uuid.UUID(reference)))
    except ValueError:
        pass

    if reference.isdigit():
        rows = db_query("SELECT * FROM albums WHERE flickr_photoset_id = %s", (reference,))
        if rows:
            return rows[0]
        return _adopt_flickr_photoset(reference)

    rows = db_query("SELECT * FROM albums WHERE slug = %s", (reference,))
    return rows[0] if rows else None


def _flickr_photoset_title(photoset_id: str) -> str:
    """Best-effort lookup of a photoset's title, for adopting it by name.

    Deliberately synchronous: adoption happens once per album, from both sync
    and async callers, and is not worth colouring either of them.
    """
    import urllib.parse

    creds = get_flickr_credentials()
    if not creds:
        return ""
    flickr_url = "https://api.flickr.com/services/rest"
    params = {
        "method": "flickr.photosets.getInfo",
        "photoset_id": photoset_id,
        "user_id": creds["user_id"],
        "format": "json",
        "nojsoncallback": "1",
    }
    try:
        signed = _flickr_oauth_sign(flickr_url, params, creds)
        auth_header = "OAuth " + ", ".join(
            f'{k}="{urllib.parse.quote(str(v), "")}"' for k, v in signed.items()
        )
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                f"{flickr_url}?{urllib.parse.urlencode(params)}",
                headers={"Authorization": auth_header},
            )
        data = resp.json()
        if data.get("stat") != "ok":
            return ""
        title = data["photoset"]["title"]
        return title.get("_content", "") if isinstance(title, dict) else str(title)
    except Exception as exc:
        print(f"[albums] could not read Flickr photoset {photoset_id}: {exc}")
        return ""


def _adopt_flickr_photoset(photoset_id: str, title: str = "") -> dict | None:
    """Create the `albums` row that stands for an album made on Flickr itself."""
    name = title.strip() or _flickr_photoset_title(photoset_id) or f"Flickr album {photoset_id}"
    rows = db_query(
        """
        INSERT INTO albums (name, slug, flickr_photoset_id)
        VALUES (%s, %s, %s)
        ON CONFLICT (flickr_photoset_id) DO UPDATE SET updated_at = now()
        RETURNING *
        """,
        (name, _unique_album_slug(name), photoset_id),
    )
    return rows[0] if rows else None


async def _create_flickr_photoset(
    title: str, description: str, primary_photo_id: str, creds: dict
) -> str:
    """flickr.photosets.create — needs a primary photo, so albums can only be
    created on Flickr once they have their first photo."""
    import urllib.parse

    flickr_url = "https://api.flickr.com/services/rest"
    params = {
        "method": "flickr.photosets.create",
        "title": title,
        "description": description,
        "primary_photo_id": primary_photo_id,
        "format": "json",
        "nojsoncallback": "1",
    }
    oauth_params = _flickr_oauth_sign(flickr_url, params, creds, method="POST")
    auth_header = "OAuth " + ", ".join(
        f'{k}="{urllib.parse.quote(str(v), "")}"' for k, v in oauth_params.items()
    )
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(flickr_url, data=params, headers={"Authorization": auth_header})
    try:
        data = resp.json()
    except Exception:
        data = {"stat": "fail"}
    if data.get("stat") != "ok":
        raise HTTPException(502, f"Flickr photosets.create failed: {data.get('message', 'unknown')}")
    return str(data["photoset"]["id"])


async def _ensure_flickr_photoset(album: dict, primary_photo_id: str, creds: dict) -> tuple[str, bool]:
    """Return (photoset_id, this_photo_became_the_primary).

    The bool matters: Flickr puts the primary photo in the set as part of
    creating it, so the caller must not also addPhoto it.
    """
    if album.get("flickr_photoset_id"):
        return album["flickr_photoset_id"], False

    photoset_id = await _create_flickr_photoset(
        album["name"], album.get("description") or "", primary_photo_id, creds
    )
    claimed = db_query(
        """
        UPDATE albums
        SET flickr_photoset_id = %s, flickr_last_error = NULL, updated_at = now()
        WHERE id = %s AND flickr_photoset_id IS NULL
        RETURNING flickr_photoset_id
        """,
        (photoset_id, album["id"]),
    )
    if claimed:
        return photoset_id, True

    # Another concurrent upload created the photoset first. Theirs wins; ours is
    # left behind on Flickr as an empty-ish set for the admin to delete. Rare
    # enough (it needs two first-photo uploads into one new album at the same
    # instant) that reconciling it automatically isn't worth the delete call.
    current = _album_row(album["id"])
    print(
        f"[albums] lost photoset creation race for album {album['id']}; "
        f"orphaned Flickr photoset {photoset_id}"
    )
    if not current or not current.get("flickr_photoset_id"):
        # The album was deleted mid-flight. Ours is the only set that exists.
        return photoset_id, True
    return current["flickr_photoset_id"], False


def _link_photo_into_album_on_nas(album: dict, kindred_photo_id: str, filename: str) -> str | None:
    """Symlink an original into albums/<slug>/ on the NAS."""
    if not PHOTO_STORAGE_ROOT:
        return None
    rows = db_query(
        """
        SELECT provider_key FROM photo_copies
        WHERE photo_id = %s AND provider = 'nas' AND status = 'available'
        """,
        (kindred_photo_id,),
    )
    if not rows:
        return None
    provider = LocalStorageProvider(PHOTO_STORAGE_ROOT)
    return provider.link_into_album(album["slug"], rows[0]["provider_key"], filename)


async def _add_photo_to_album_everywhere(
    album: dict,
    kindred_photo_id: str | None,
    flickr_photo_id: str | None,
    filename: str,
    creds: dict,
    user_id: str | None = None,
) -> dict:
    """Record album membership, then project it onto the NAS and Flickr.

    Every step is best-effort and independently recorded: the photo is already
    uploaded by the time this runs, so a failure here must never lose it. Rows
    left with flickr_synced_at IS NULL are the retry queue.
    """
    result = {"album_id": str(album["id"]), "nas_linked": False, "flickr_linked": False}

    if kindred_photo_id:
        db_query(
            """
            INSERT INTO album_photos (album_id, photo_id, added_by)
            VALUES (%s, %s, %s)
            ON CONFLICT (album_id, photo_id) DO NOTHING
            """,
            (album["id"], kindred_photo_id, user_id),
            fetch=False,
        )

        try:
            link_path = _link_photo_into_album_on_nas(album, kindred_photo_id, filename)
            if link_path:
                db_query(
                    "UPDATE album_photos SET nas_link_path = %s WHERE album_id = %s AND photo_id = %s",
                    (link_path, album["id"], kindred_photo_id),
                    fetch=False,
                )
                result["nas_linked"] = True
        except Exception as exc:
            print(f"[albums] NAS link failed for photo {kindred_photo_id} → {album['slug']}: {exc}")

    if flickr_photo_id:
        try:
            photoset_id, was_primary = await _ensure_flickr_photoset(album, flickr_photo_id, creds)
            if not was_primary:
                await _add_photo_to_album(flickr_photo_id, photoset_id, creds)
            if kindred_photo_id and PHOTO_STORAGE_ROOT:
                from video_queue import queue_root
                manifest_path = queue_root() / str(kindred_photo_id) / 'manifest.json'
                if manifest_path.exists():
                    manifest = json.loads(manifest_path.read_text())
                    if manifest['complete']:
                        for part in manifest['parts'].values():
                            if part['flickr_id'] != flickr_photo_id:
                                await _add_photo_to_album(part['flickr_id'], photoset_id, creds)
            result["flickr_linked"] = True
            result["flickr_photoset_id"] = photoset_id
            if kindred_photo_id:
                db_query(
                    """
                    UPDATE album_photos
                    SET flickr_synced_at = now(), flickr_last_error = NULL
                    WHERE album_id = %s AND photo_id = %s
                    """,
                    (album["id"], kindred_photo_id),
                    fetch=False,
                )
        except Exception as exc:
            message = str(exc)[:1000]
            print(f"[albums] Flickr album add failed for {flickr_photo_id} → {album['slug']}: {exc}")
            if kindred_photo_id:
                db_query(
                    """
                    UPDATE album_photos SET flickr_last_error = %s
                    WHERE album_id = %s AND photo_id = %s
                    """,
                    (message, album["id"], kindred_photo_id),
                    fetch=False,
                )
            else:
                db_query(
                    "UPDATE albums SET flickr_last_error = %s WHERE id = %s",
                    (message, album["id"]),
                    fetch=False,
                )

    return result


def _album_response(row: dict, photo_count: int | None = None) -> dict:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "slug": row["slug"],
        "description": row.get("description") or "",
        "flickr_photoset_id": row.get("flickr_photoset_id"),
        "photo_count": photo_count if photo_count is not None else row.get("photo_count", 0),
        "nas_path": f"albums/{row['slug']}" if PHOTO_STORAGE_ROOT else None,
        "source": "kindred",
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
    }


@app.get("/albums")
async def list_albums(
    include_flickr: bool = Query(
        False,
        description="Also list Flickr photosets Kindred hasn't adopted yet",
    ),
    user=Depends(get_current_user),
):
    """List Kindred albums, newest first."""
    rows = db_query(
        """
        SELECT a.*, COUNT(ap.photo_id) AS photo_count
        FROM albums a
        LEFT JOIN album_photos ap ON ap.album_id = a.id
        GROUP BY a.id
        ORDER BY a.created_at DESC
        """
    )
    albums = [_album_response(row, int(row["photo_count"])) for row in rows]

    if include_flickr:
        known = {row["flickr_photoset_id"] for row in rows if row["flickr_photoset_id"]}
        try:
            remote = await list_flickr_albums(user=user)
            for photoset in remote["albums"]:
                if photoset["id"] not in known:
                    albums.append({
                        "id": None,
                        "name": photoset["title"],
                        "slug": None,
                        "description": "",
                        "flickr_photoset_id": photoset["id"],
                        "photo_count": photoset["photo_count"],
                        "nas_path": None,
                        "source": "flickr",
                        "created_at": None,
                    })
        except Exception as exc:
            print(f"[albums] could not list Flickr photosets: {exc}")

    return {"albums": albums}


@app.post("/albums")
async def create_album(body: AlbumCreateRequest, user=Depends(get_current_user)):
    """Create a Kindred album.

    The album is usable immediately. Its NAS directory appears with the first
    photo, and so does its Flickr photoset — Flickr can't create an empty one.
    """
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Album name is required")
    if len(name) > 200:
        raise HTTPException(400, "Album name is too long (max 200 characters)")

    existing = db_query("SELECT * FROM albums WHERE lower(name) = lower(%s)", (name,))
    if existing:
        raise HTTPException(409, f"An album named '{name}' already exists")

    rows = db_query(
        """
        INSERT INTO albums (name, slug, description, created_by)
        VALUES (%s, %s, %s, %s)
        RETURNING *
        """,
        (name, _unique_album_slug(name), body.description.strip(), user.get("user_id")),
    )
    return _album_response(rows[0], 0)


@app.get("/albums/{reference}")
async def get_album(reference: str, user=Depends(get_current_user)):
    album = _resolve_album(reference)
    if not album:
        raise HTTPException(404, "Album not found")
    counts = db_query(
        "SELECT COUNT(*) AS n FROM album_photos WHERE album_id = %s", (album["id"],)
    )
    return _album_response(album, int(counts[0]["n"]))


# ── Share links ──────────────────────────────────────────────────────────────
# Anonymous read access to exactly one photo or one album. A share token is a
# bearer capability, so it is stored only as a hash, it carries its own scope,
# and its validity is decided on every request rather than exchanged for a
# session. Nothing here reaches the catalog or search.

SHARE_MAX_ITEMS = 2000


def _share_signing_key() -> bytes:
    import shares
    return shares.signing_key(API_KEY)


def _share_by_token(token: str) -> dict | None:
    import shares
    rows = db_query("SELECT * FROM shares WHERE token_hash = %s", (shares.hash_token(token),))
    return rows[0] if rows else None


def _share_photo_ids(share: dict) -> list[str]:
    """The photos a share covers, in display order."""
    if share["subject_type"] == "photo":
        return [str(share["photo_id"])]
    rows = db_query(
        """
        SELECT p.id::text AS photo_id
        FROM album_photos ap
        JOIN photos p ON p.id = ap.photo_id
        LEFT JOIN photo_copies n ON n.photo_id = p.id AND n.provider='nas' AND n.status='available'
        LEFT JOIN photo_copies f ON f.photo_id = p.id AND f.provider='flickr' AND f.status='available'
        WHERE ap.album_id = %s AND (n.photo_id IS NOT NULL OR f.photo_id IS NOT NULL)
        ORDER BY COALESCE(p.taken_at, p.created_at) DESC, p.id DESC
        LIMIT %s
        """,
        (share["album_id"], SHARE_MAX_ITEMS),
    )
    return [row["photo_id"] for row in rows]


def _share_items(share: dict, token: str, photo_ids: list[str]) -> list[dict]:
    """Viewer-facing entries, each with a media URL scoped to this share.

    Password-protected shares get a short-lived HMAC on every URL, so an
    unlocked page can render <img> tags without the password ever travelling
    in a URL and without minting a session.
    """
    import shares as shares_module

    if not photo_ids:
        return []
    rows = db_query(
        """
        SELECT p.id::text AS photo_id, p.media_kind, p.duration_seconds,
               COALESCE(NULLIF(p.title,''), p.original_filename, 'Untitled') AS photo_title,
               COALESCE(p.taken_at, p.created_at) AS date_taken
        FROM photos p WHERE p.id::text = ANY(%s)
        """,
        (photo_ids,),
    )
    by_id = {row["photo_id"]: row for row in rows}

    signature_params = ""
    expires_unix = 0
    key = None
    if shares_module.requires_password(share):
        key = _share_signing_key()
        expires_unix = int(
            (datetime.now(timezone.utc)
             + timedelta(seconds=shares_module.MEDIA_URL_TTL_SECONDS)).timestamp()
        )

    items = []
    for photo_id in photo_ids:
        row = by_id.get(photo_id)
        if not row:
            continue
        base = f"{PUBLIC_API_URL}/public/shares/{token}/media/{photo_id}"
        if key is not None:
            signature = shares_module.sign_media(key, str(share["id"]), photo_id, expires_unix)
            signature_params = f"&exp={expires_unix}&sig={signature}"
        items.append({
            "photo_id": photo_id,
            "photo_title": row["photo_title"],
            "media_kind": row["media_kind"],
            "duration_seconds": row["duration_seconds"],
            "date_taken": str(row["date_taken"]),
            "thumb_url": f"{base}?variant=thumb{signature_params}",
            "preview_url": f"{base}?variant=preview{signature_params}",
            "clip_url": (f"{base}?variant=clip{signature_params}"
                         if row["media_kind"] == "video" else None),
        })
    return items


@app.post("/shares")
def create_share(body: ShareCreateRequest, user=Depends(get_current_user)):
    """Mint a share link. The token is returned once and never stored in clear."""
    import shares

    try:
        photo_id, album_id = shares.normalise_subject(
            body.subject_type, body.photo_id, body.album_id
        )
    except shares.ShareError as exc:
        raise HTTPException(exc.status, exc.reason)

    if photo_id:
        if not db_query("SELECT 1 FROM photos WHERE id = %s", (photo_id,)):
            raise HTTPException(404, "Photo not found")
        title = body.title.strip()
    else:
        album = _album_row(str(album_id))
        if not album:
            raise HTTPException(404, "Album not found")
        title = body.title.strip() or album["name"]

    expires_at = None
    if body.expires_in_days is not None:
        if not 1 <= body.expires_in_days <= 3650:
            raise HTTPException(400, "expires_in_days must be between 1 and 3650")
        expires_at = datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)

    password_hash = hash_password(body.password) if body.password else None

    token, token_hash = shares.mint_token()
    rows = db_query(
        """
        INSERT INTO shares (token_hash, subject_type, photo_id, album_id, title,
                            password_hash, allow_download, expires_at, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (token_hash, body.subject_type, photo_id, album_id, title, password_hash,
         body.allow_download, expires_at, user.get("user_id")),
    )
    return {**_owner_share_view(rows[0]), "url": f"{PUBLIC_WEB_URL}/s/{token}", "token": token}


@app.get("/shares")
def list_shares(user=Depends(get_current_user)):
    """Every live share, newest first. Tokens are unrecoverable by design."""
    rows = db_query(
        """
        SELECT s.*, a.name AS album_name
        FROM shares s
        LEFT JOIN albums a ON a.id = s.album_id
        WHERE s.revoked_at IS NULL
        ORDER BY s.created_at DESC
        """
    )
    return {"shares": [_owner_share_view(row) for row in rows]}


@app.delete("/shares/{share_id}")
def revoke_share(share_id: str, user=Depends(get_current_user)):
    """Revoke a share. The link stops working immediately and for good."""
    try:
        share_id = str(uuid.UUID(share_id))
    except ValueError:
        raise HTTPException(400, "Invalid share id")
    rows = db_query(
        "UPDATE shares SET revoked_at = now() WHERE id = %s AND revoked_at IS NULL RETURNING id",
        (share_id,),
    )
    if not rows:
        raise HTTPException(404, "Share not found")
    return {"status": "revoked", "id": share_id}


def _owner_share_view(row: dict) -> dict:
    """What the household sees. Still never includes the token."""
    return {
        "id": str(row["id"]),
        "subject_type": row["subject_type"],
        "photo_id": str(row["photo_id"]) if row.get("photo_id") else None,
        "album_id": str(row["album_id"]) if row.get("album_id") else None,
        "album_name": row.get("album_name"),
        "title": row.get("title") or "",
        "password_protected": bool(row.get("password_hash")),
        "allow_download": bool(row.get("allow_download")),
        "expires_at": row["expires_at"].isoformat() if row.get("expires_at") else None,
        "view_count": int(row.get("view_count") or 0),
        "last_viewed_at": row["last_viewed_at"].isoformat() if row.get("last_viewed_at") else None,
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
    }


# ── Public share access (no authentication) ──────────────────────────────────

@app.get("/public/shares/{token}")
def view_share(token: str):
    """Resolve a share link for an anonymous viewer.

    A revoked, expired or unknown token is a plain 404 — never a message that
    distinguishes them, which would let a stranger probe for real links.
    """
    import shares

    share = _share_by_token(token)
    try:
        shares.check_live(share)
    except shares.ShareError as exc:
        raise HTTPException(exc.status, exc.reason)

    if shares.requires_password(share):
        return shares.public_view(share, items=[], unlocked=False)

    _record_share_view(share["id"])
    items = _share_items(share, token, _share_photo_ids(share))
    return shares.public_view(share, items=items, unlocked=True)


@app.post("/public/shares/{token}/unlock")
def unlock_share(token: str, body: ShareUnlockRequest):
    """Exchange a share password for its contents.

    Returns signed, short-lived media URLs rather than a session, so the
    capability stays scoped to this share and cannot widen.
    """
    import shares

    share = _share_by_token(token)
    try:
        shares.check_live(share)
    except shares.ShareError as exc:
        raise HTTPException(exc.status, exc.reason)

    if not shares.requires_password(share):
        _record_share_view(share["id"])
        items = _share_items(share, token, _share_photo_ids(share))
        return shares.public_view(share, items=items, unlocked=True)

    if not verify_password(body.password or "", share["password_hash"]):
        raise HTTPException(401, "Incorrect password")

    _record_share_view(share["id"])
    items = _share_items(share, token, _share_photo_ids(share))
    return shares.public_view(share, items=items, unlocked=True)


@app.get("/public/shares/{token}/media/{photo_id}")
def share_media(token: str, photo_id: str, variant: str = "thumb",
                exp: int | None = None, sig: str | None = None,
                request: FastAPIRequest = None):
    """Serve one photo or video from inside a share.

    Membership is re-checked here against the share's own scope: an id in the
    request is never trusted, so a valid token for one album cannot be pointed
    at a photo outside it.
    """
    import shares

    share = _share_by_token(token)
    try:
        shares.check_live(share)
    except shares.ShareError as exc:
        raise HTTPException(exc.status, exc.reason)

    if not shares.scope_allows(share, photo_id, _share_photo_ids(share)):
        raise HTTPException(404, "Not found in this share")

    if shares.requires_password(share):
        if not shares.verify_media(_share_signing_key(), str(share["id"]), photo_id,
                                   int(exp or 0), sig or ""):
            raise HTTPException(403, "This link has expired; reopen the share")

    if variant == "original" and not share.get("allow_download"):
        raise HTTPException(403, "Downloads are not enabled for this share")

    return get_local_photo(photo_id, variant, None, request)


def _record_share_view(share_id) -> None:
    try:
        db_query(
            "UPDATE shares SET view_count = view_count + 1, last_viewed_at = now() WHERE id = %s",
            (share_id,), fetch=False,
        )
    except Exception as exc:
        print(f"[shares] could not record view for {share_id}: {exc}")


@app.post("/scan/auto")
async def auto_scan(request: FastAPIRequest, background_tasks: BackgroundTasks, secret: str = ""):
    """Nightly auto-scan: fetch all Flickr photos and analyze new ones.
    Auth: either provide the SCAN_SECRET query param, or be an authenticated admin user.
    """
    # Allow admin session auth as an alternative to the shared secret
    admin_auth = False
    user = getattr(request.state, "user", None)
    if user and user.get("role") == "admin":
        admin_auth = True
    if not admin_auth and secret != SCAN_SECRET:
        raise HTTPException(403, "Invalid scan secret")
    flickr_creds = get_flickr_credentials()
    if not FLICKR_API_KEY or not flickr_creds:
        raise HTTPException(500, "Flickr OAuth not configured")

    # Fetch all photos from Flickr using OAuth
    import urllib.parse

    flickr_url = "https://api.flickr.com/services/rest"
    flickr_uid = flickr_creds["user_id"]
    all_photos = []
    page = 1

    while True:
        params = {
            "method": "flickr.people.getPhotos",
            "user_id": flickr_uid,
            "per_page": "500",
            "page": str(page),
            "extras": "url_z,url_b,owner_name,title,media",
            "media": "photos",
            "format": "json",
            "nojsoncallback": "1",
        }
        signed = _flickr_oauth_sign(flickr_url, params, flickr_creds)
        auth_header = "OAuth " + ", ".join(f'{k}="{urllib.parse.quote(str(v), "")}"'
                                           for k, v in signed.items())
        qs = urllib.parse.urlencode(params)
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{flickr_url}?{qs}", headers={"Authorization": auth_header})
            data = resp.json()

        if data.get("stat") != "ok":
            break

        for p in data["photos"]["photo"]:
            url_z = p.get("url_z") or p.get("url_b") or f"https://live.staticflickr.com/{p['server']}/{p['id']}_{p['secret']}_z.jpg"
            all_photos.append({
                "id": p["id"],
                "url": url_z,
                "title": p.get("title", ""),
                "owner": p.get("ownername", flickr_uid),
                "thumb": f"https://live.staticflickr.com/{p['server']}/{p['id']}_{p['secret']}_q.jpg",
                "flickr_url": f"https://www.flickr.com/photos/{flickr_uid}/{p['id']}",
            })

        if page >= data["photos"]["pages"]:
            break
        page += 1

    if not all_photos:
        return {"message": "No photos found", "count": 0}

    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "running", "progress": 0,
        "total": len(all_photos), "message": "Auto-scan starting...",
        "counts": {"people": 0, "pets": 0, "vehicles": 0},
    }
    background_tasks.add_task(_run_analysis, job_id, all_photos)
    return {"message": f"Auto-scan started with {len(all_photos)} photos", "job_id": job_id, "count": len(all_photos)}

@app.post("/backfill-clip")
async def backfill_clip(background_tasks: BackgroundTasks, admin=Depends(require_admin)):
    """Backfill CLIP embeddings for pet/vehicle detections that have NULL embeddings."""
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "running", "progress": 0, "total": 0, "message": "Starting CLIP backfill..."}
    background_tasks.add_task(_backfill_clip, job_id)
    return {"job_id": job_id}

async def _backfill_clip(job_id: str):
    import cv2
    rows = db_query("""
        SELECT id, photo_url, bbox, category FROM detections
        WHERE embedding IS NULL AND category IN ('pets', 'vehicles')
    """)
    jobs[job_id]["total"] = len(rows)
    conn = get_db()
    updated = 0
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            for i, r in enumerate(rows):
                jobs[job_id]["progress"] = i + 1
                jobs[job_id]["message"] = f"[{i+1}/{len(rows)}] CLIP embedding"
                try:
                    resp = await client.get(r["photo_url"])
                    resp.raise_for_status()
                    arr = np.frombuffer(resp.content, np.uint8)
                    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                    if img is None:
                        continue
                    bbox = r["bbox"] if isinstance(r["bbox"], list) else []
                    emb = clip_embed_image(img, bbox=bbox if bbox else None)
                    if emb is not None and len(emb) == 512:
                        vec = np.array(emb, dtype=np.float32)
                        with conn.cursor() as cur:
                            cur.execute("UPDATE detections SET embedding = %s WHERE id = %s", (vec, r["id"]))
                        conn.commit()
                        updated += 1
                except Exception as e:
                    print(f"  backfill error {r['id']}: {e}")
                    conn.rollback()
                await asyncio.sleep(0)

        # Cluster pets and vehicles now that they have embeddings
        for cat in ("pets", "vehicles"):
            try:
                run_clustering(cat, distance_threshold=0.80)
            except Exception as e:
                print(f"  cluster {cat} failed: {e}")
    finally:
        conn.close()

    jobs[job_id]["status"] = "done"
    jobs[job_id]["message"] = f"Backfilled {updated} CLIP embeddings"

@app.post("/backfill-photo-clips")
async def backfill_photo_clips(background_tasks: BackgroundTasks, admin=Depends(require_admin)):
    """Backfill CLIP embeddings for all photos that don't have one yet."""
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "running", "progress": 0, "total": 0, "message": "Starting photo CLIP backfill..."}
    background_tasks.add_task(_backfill_photo_clips, job_id)
    return {"job_id": job_id}

async def _backfill_photo_clips(job_id: str):
    import cv2
    # Get all unique photo URLs that don't have CLIP embeddings yet
    rows = db_query("""
        SELECT DISTINCT ON (d.photo_id) d.photo_id, d.photo_url
        FROM detections d
        LEFT JOIN photo_embeddings pe ON pe.photo_id = d.photo_id
        WHERE pe.photo_id IS NULL
    """)
    jobs[job_id]["total"] = len(rows)
    conn = get_db()
    done = 0
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            for i, r in enumerate(rows):
                jobs[job_id]["progress"] = i + 1
                jobs[job_id]["message"] = f"[{i+1}/{len(rows)}] CLIP photo embedding"
                try:
                    resp = await client.get(r["photo_url"])
                    resp.raise_for_status()
                    arr = np.frombuffer(resp.content, np.uint8)
                    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                    if img is None:
                        continue
                    emb = clip_embed_image(img)
                    if emb is not None:
                        vec = np.array(emb, dtype=np.float32)
                        with conn.cursor() as cur:
                            cur.execute("""
                                INSERT INTO photo_embeddings (photo_id, clip_embedding)
                                VALUES (%s, %s) ON CONFLICT (photo_id) DO NOTHING
                            """, (r["photo_id"], vec))
                        conn.commit()
                        done += 1
                except Exception as e:
                    print(f"  clip photo {r['photo_id']}: {e}")
                    conn.rollback()
                await asyncio.sleep(0)
    finally:
        conn.close()
    jobs[job_id]["status"] = "done"
    jobs[job_id]["message"] = f"Done — {done} photo CLIP embeddings generated"

@app.get("/syncs")
def get_syncs():
    """Get recent sync history."""
    rows = db_query("""
        SELECT id, started_at, finished_at, status, total_photos,
               new_faces, new_pets, new_vehicles, clusters_created, error, job_id
        FROM sync_logs ORDER BY started_at DESC LIMIT 20
    """)
    return [dict(r) for r in rows]

@app.delete("/embeddings")
def clear_all(admin=Depends(require_admin)):
    db_query("DELETE FROM detection_clusters", fetch=False)
    db_query("DELETE FROM clusters", fetch=False)
    db_query("DELETE FROM detections", fetch=False)
    return {"ok": True}

# ── Feature 1: Photo metadata from Flickr ────────────────────────────────────

def _flickr_oauth_sign(url: str, params: dict, creds: dict | None = None, method: str = "GET") -> dict:
    """Sign a Flickr API request using OAuth 1.0a.
    creds: { oauth_token, oauth_secret, user_id } — from get_flickr_credentials()
    method: HTTP method (GET or POST) — affects the signature base string.
    """
    import hmac
    import hashlib
    import time
    import urllib.parse

    if creds is None:
        creds = get_flickr_credentials()
    if not creds:
        raise HTTPException(500, "Flickr OAuth not configured")

    oauth_params = {
        "oauth_consumer_key": FLICKR_API_KEY,
        "oauth_token": creds["oauth_token"],
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_nonce": uuid.uuid4().hex,
        "oauth_version": "1.0",
    }
    all_params = {**params, **oauth_params}
    sorted_params = "&".join(
        f"{urllib.parse.quote(k, '')}={urllib.parse.quote(str(v), '')}"
        for k, v in sorted(all_params.items())
    )
    base_string = f"{method}&{urllib.parse.quote(url, '')}&{urllib.parse.quote(sorted_params, '')}"
    signing_key = f"{urllib.parse.quote(FLICKR_SECRET, '')}&{urllib.parse.quote(creds['oauth_secret'], '')}"
    sig = base64.b64encode(
        hmac.new(signing_key.encode(), base_string.encode(), hashlib.sha1).digest()
    ).decode()
    oauth_params["oauth_signature"] = sig
    return oauth_params


async def _backfill_metadata_task(job_id: str) -> None:
    """Background task: fetch Flickr metadata for photos missing it."""
    import urllib.parse

    flickr_url = "https://api.flickr.com/services/rest"

    # Find photo_ids in detections that don't have metadata yet
    rows = db_query("""
        SELECT DISTINCT d.photo_id
        FROM detections d
        LEFT JOIN photo_metadata pm ON pm.photo_id = d.photo_id
        WHERE pm.photo_id IS NULL
    """)
    photo_ids: list[str] = [r["photo_id"] for r in rows]
    jobs[job_id]["total"] = len(photo_ids)

    conn = get_db()
    done = 0
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for i, pid in enumerate(photo_ids):
                jobs[job_id]["progress"] = i + 1
                jobs[job_id]["message"] = f"[{i+1}/{len(photo_ids)}] Fetching metadata for {pid}"

                try:
                    params = {
                        "method": "flickr.photos.getInfo",
                        "photo_id": pid,
                        "format": "json",
                        "nojsoncallback": "1",
                    }
                    oauth_params = _flickr_oauth_sign(flickr_url, params)
                    auth_header = "OAuth " + ", ".join(
                        f'{k}="{urllib.parse.quote(str(v), "")}"'
                        for k, v in oauth_params.items()
                    )
                    qs = urllib.parse.urlencode(params)
                    resp = await client.get(
                        f"{flickr_url}?{qs}",
                        headers={"Authorization": auth_header},
                    )
                    data = resp.json()

                    if data.get("stat") != "ok":
                        continue

                    info = data["photo"]
                    date_taken = info.get("dates", {}).get("taken")
                    lat: Optional[float] = None
                    lng: Optional[float] = None
                    location = info.get("location", {})
                    if location:
                        try:
                            lat = float(location.get("latitude", 0))
                            lng = float(location.get("longitude", 0))
                            if lat == 0.0 and lng == 0.0:
                                lat, lng = None, None
                        except (ValueError, TypeError):
                            lat, lng = None, None

                    tags_list: list[str] = [
                        t.get("raw", t.get("_content", ""))
                        for t in info.get("tags", {}).get("tag", [])
                    ]
                    description = info.get("description", {}).get("_content", "")

                    # Reverse geocode if we have coordinates
                    location_name: Optional[str] = None
                    if lat is not None and lng is not None:
                        try:
                            geo_resp = await client.get(
                                "https://nominatim.openstreetmap.org/reverse",
                                params={"lat": lat, "lon": lng, "format": "json"},
                                headers={"User-Agent": "kindred/1.0"},
                            )
                            geo_data = geo_resp.json()
                            addr = geo_data.get("address", {})
                            location_name = (
                                addr.get("city")
                                or addr.get("town")
                                or addr.get("village")
                                or addr.get("county")
                                or geo_data.get("display_name", "")[:100]
                            )
                            # Respect Nominatim rate limit
                            await asyncio.sleep(1)
                        except Exception:
                            pass

                    with conn.cursor() as cur:
                        cur.execute("""
                            INSERT INTO photo_metadata
                                (photo_id, date_taken, latitude, longitude, location_name, tags, description)
                            VALUES (%s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (photo_id) DO NOTHING
                        """, (pid, date_taken, lat, lng, location_name, tags_list, description))
                    conn.commit()
                    done += 1

                except Exception as e:
                    print(f"  metadata error {pid}: {e}")
                    conn.rollback()

                await asyncio.sleep(0)
    finally:
        conn.close()

    jobs[job_id]["status"] = "done"
    jobs[job_id]["message"] = f"Done -- metadata fetched for {done} photos"


@app.post("/backfill-metadata")
async def backfill_metadata(background_tasks: BackgroundTasks, admin=Depends(require_admin)):
    """Backfill Flickr metadata (date, geo, tags, description) for all photos."""
    if not FLICKR_API_KEY or not get_flickr_credentials():
        raise HTTPException(500, "Flickr OAuth not configured")
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "running", "progress": 0, "total": 0, "message": "Starting metadata backfill..."}
    background_tasks.add_task(_backfill_metadata_task, job_id)
    return {"job_id": job_id}


@app.get("/library/counts")
def get_library_counts(user=Depends(get_current_user)):
    from library_api import counts
    return counts(db_query)


@app.get("/library/photos")
def get_library_photos(sort: str = "newest",
                       media: str = Query("all", description="all, photo, or video"),
                       cursor: str | None = Query(None, description="next_cursor from the previous page"),
                       limit: int = Query(48, ge=1, le=100), user=Depends(get_current_user)):
    from library_api import gallery
    return gallery(db_query, sort, limit, media=media, cursor=cursor)


@app.get("/timeline")
def get_timeline(
    request: FastAPIRequest,
    months: int = Query(3, ge=1, le=24, description="How many month buckets to return"),
    before: str | None = Query(None, description="Return months older than this YYYY-MM"),
    media: str = Query("all", description="all, photo, or video"),
):
    """A page of the library grouped by month, newest first.

    Paginated: ask for more with `before` set to the response's `next_before`.
    Videos are included by default now that they have poster frames.
    """
    import search_api
    import timeline_api

    facets = search_api.Facets(media=media)
    page, next_before = timeline_api.months_page(db_query, facets, months=months, before=before)

    session_token = request.headers.get("X-Session-Token")
    auth_query = f"&session_token={session_token}" if session_token else ""

    for bucket in page:
        for row in bucket["photos"]:
            local_thumb = (
                f"{PUBLIC_API_URL}/photos/{row['photo_id']}/local?variant=thumb{auth_query}"
                if row.get("nas_provider_key") else None
            )
            row["thumb_url"] = local_thumb or ""
            if row["media_kind"] == "video" and row.get("nas_provider_key"):
                row["clip_url"] = (
                    f"{PUBLIC_API_URL}/photos/{row['photo_id']}/local?variant=clip{auth_query}"
                )
            row["flickr_url"] = row.get("flickr_url") or ""
            row["date_taken"] = str(row["date_taken"])
            row.pop("nas_provider_key", None)
            row.pop("month", None)

    # Originals are the durable source of truth, so the library stays browsable
    # when the database index is stale or pointing at a fresh database. Only on
    # the first page: this walks the managed tree, and paging backwards through
    # history should not pay for it repeatedly.
    if PHOTO_STORAGE_ROOT and before is None:
        _merge_unindexed_originals(page, months, media, auth_query)

    return {"months": page, "next_before": next_before}


def _merge_unindexed_originals(page: list[dict], months: int, media: str, auth_query: str) -> None:
    """Fold NAS originals the catalog does not know about into a timeline page."""
    indexed = {row["photo_id"] for bucket in page for row in bucket["photos"]}
    buckets = {bucket["month"]: bucket for bucket in page}

    for source in managed_originals(Path(PHOTO_STORAGE_ROOT)):
        photo_id = source.parent.name
        if photo_id in indexed:
            continue
        is_video = source.suffix.lower() in VIDEO_EXTENSIONS
        if (media == "photo" and is_video) or (media == "video" and not is_video):
            continue
        try:
            uuid.UUID(photo_id)
            modified = datetime.fromtimestamp(source.stat().st_mtime, tz=timezone.utc)
        except (ValueError, OSError):
            continue
        indexed.add(photo_id)
        key = modified.strftime("%Y-%m")
        bucket = buckets.get(key)
        if bucket is None:
            bucket = {"month": key, "count": 0, "photos": []}
            buckets[key] = bucket
        entry = {
            "photo_id": photo_id,
            "thumb_url": f"{PUBLIC_API_URL}/photos/{photo_id}/local?variant=thumb{auth_query}",
            "flickr_url": "",
            "photo_title": source.stem,
            "date_taken": modified.isoformat(),
            "media_kind": "video" if is_video else "photo",
            "duration_seconds": None,
        }
        if is_video:
            entry["clip_url"] = f"{PUBLIC_API_URL}/photos/{photo_id}/local?variant=clip{auth_query}"
        bucket["photos"].append(entry)
        bucket["count"] += 1

    ordered = sorted(buckets.values(), key=lambda b: b["month"], reverse=True)[:months]
    page[:] = ordered


THUMBNAIL_DIR = Path("/app/data/thumbnails")


def _media_response(path: Path, media_type: str, filename: str | None,
                    request: "FastAPIRequest | None"):
    """Serve a file, honouring a byte-range request when one is made.

    Video playback depends on this: browsers request ranges to start and to
    seek, and Safari will not play a source that cannot answer them. The
    starlette version FastAPI 0.111 pins has no range support in FileResponse,
    so ranges are handled here.
    """
    import range_response

    headers = {"Cache-Control": "private, max-age=86400", "Accept-Ranges": "bytes"}
    file_size = path.stat().st_size
    range_header = request.headers.get("range") if request is not None else None

    try:
        requested = range_response.parse_range(range_header, file_size)
    except (range_response.InvalidRange, ValueError):
        # Unsatisfiable: tell the client the real size so it can retry.
        return Response(
            status_code=416,
            headers={**headers, "Content-Range": f"bytes */{file_size}"},
        )

    if requested is None:
        return FileResponse(
            path, media_type=media_type, filename=filename,
            content_disposition_type="inline", headers=headers,
        )

    start, end = requested
    return StreamingResponse(
        range_response.iter_file_range(path, start, end),
        status_code=206,
        media_type=media_type,
        headers={
            **headers,
            "Content-Range": range_response.content_range(start, end, file_size),
            "Content-Length": str(end - start + 1),
        },
    )


def _video_derivative(photo_id: str, source: Path, variant: str) -> tuple[Path, str]:
    """Return a cached poster frame or hover clip for a video, rendering once.

    Duration is probed on the first derivative and written back to the photo
    row, so the grid can show a badge without touching the file again.
    """
    import video_preview

    THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)
    is_clip = variant == "clip"
    destination = THUMBNAIL_DIR / f"{photo_id}{'-clip.mp4' if is_clip else '-poster.jpg'}"
    media_type = "video/mp4" if is_clip else "image/jpeg"
    if destination.exists():
        return destination, media_type

    try:
        duration = video_preview.probe_duration(source)
    except video_preview.VideoPreviewError as exc:
        raise HTTPException(422, "This video could not be read") from exc

    if duration is not None:
        try:
            db_query(
                "UPDATE photos SET duration_seconds = %s WHERE id = %s AND duration_seconds IS NULL",
                (duration, photo_id),
                fetch=False,
            )
        except Exception as exc:
            print(f"[video] could not persist duration for {photo_id}: {exc}")

    # Render to a unique sibling first so concurrent requests cannot serve a
    # half-written file, mirroring how image thumbnails are cached.
    temporary = destination.with_name(f"{destination.stem}.{uuid.uuid4().hex}.tmp{destination.suffix}")
    build = video_preview.clip_command if is_clip else video_preview.poster_command
    try:
        video_preview.render(build(source, temporary, duration), temporary)
        os.replace(temporary, destination)
    except video_preview.VideoPreviewError as exc:
        raise HTTPException(422, "This video could not be decoded") from exc
    finally:
        temporary.unlink(missing_ok=True)
    return destination, media_type


@app.get("/photos/{photo_id}/local")
def get_local_photo(photo_id: str, variant: str = "original", user=Depends(get_current_user),
                    request: FastAPIRequest = None):
    """Serve a NAS original or an on-demand cached thumbnail.

    Videos derive two extra artefacts on first request: a `thumb`/`preview`
    poster frame and a short silent `clip` for hover. Both are cached beside
    the image thumbnails.
    """
    if variant not in ("original", "thumb", "preview", "clip"):
        raise HTTPException(400, "variant must be original, thumb, preview, or clip")
    if not PHOTO_STORAGE_ROOT:
        raise HTTPException(503, "NAS photo storage is not configured")

    rows = db_query(
        """
        SELECT pc.provider_key, p.original_filename, p.media_type
        FROM photos p
        JOIN photo_copies pc ON pc.photo_id = p.id
        WHERE p.id = %s AND pc.provider = 'nas' AND pc.status = 'available'
        """,
        (photo_id,),
    )
    row = rows[0] if rows else None
    provider = LocalStorageProvider(PHOTO_STORAGE_ROOT)
    source = provider.resolve_local_path(row["provider_key"]) if row else None
    if source is None:
        try:
            stable_id = str(uuid.UUID(photo_id))
        except ValueError:
            raise HTTPException(404, "NAS photo not found")
        matches = list(Path(PHOTO_STORAGE_ROOT).glob(f"{stable_id[:2]}/{stable_id}/original.*"))
        source = matches[0] if len(matches) == 1 else None
    if source is None:
        raise HTTPException(404, "NAS original is missing")

    response_path = source
    original_filename = row.get("original_filename") if row else None
    media_type = (row.get("media_type") if row else None) or _content_type_for_filename(original_filename or source.name)

    if media_type.startswith("video/") and variant != "original":
        response_path, media_type = _video_derivative(photo_id, source, variant)
        # The hover clip is a video too, so it also wants range support.
        return _media_response(response_path, media_type, None, request)
    if variant == "clip":
        raise HTTPException(400, "clip is only available for videos")

    if variant in ("thumb", "preview") and media_type.startswith("image/"):
        thumbnail_dir = Path("/app/data/thumbnails")
        thumbnail_dir.mkdir(parents=True, exist_ok=True)
        thumbnail = thumbnail_dir / f"{photo_id}{'-preview' if variant == 'preview' else ''}.jpg"
        if not thumbnail.exists():
            from PIL import Image, ImageOps
            if source.suffix.lower() in (".heic", ".heif"):
                from pillow_heif import register_heif_opener
                register_heif_opener()
            temporary = thumbnail.with_name(f"{thumbnail.stem}.{uuid.uuid4().hex}.tmp.jpg")
            try:
                with Image.open(source) as original:
                    image = ImageOps.exif_transpose(original)
                    edge = 2048 if variant == "preview" else 512
                    image.thumbnail((edge, edge))
                    image.convert("RGB").save(temporary, "JPEG", quality=90 if variant == "preview" else 82)
                os.replace(temporary, thumbnail)
            except Exception as exc:
                raise HTTPException(422, "This photo could not be decoded") from exc
            finally:
                temporary.unlink(missing_ok=True)
        if thumbnail.exists():
            response_path = thumbnail
            media_type = "image/jpeg"

    # Videos served whole still need Accept-Ranges and 206 support so the
    # player can seek; images fall through the same helper harmlessly.
    if media_type.startswith("video/"):
        return _media_response(response_path, media_type,
                               original_filename or source.name, request)

    return FileResponse(
        response_path,
        media_type=media_type,
        filename=original_filename or source.name,
        content_disposition_type="inline",
        headers={"Cache-Control": "private, max-age=86400"},
    )


@app.get("/locations")
def get_locations():
    """Return photos grouped by location_name from photo_metadata."""
    cached = get_cached("locations", ttl_seconds=3600)
    if cached:
        return cached
    rows = db_query("""
        SELECT pm.photo_id, pm.location_name, pm.latitude, pm.longitude,
               d.thumb_url, d.flickr_url, d.photo_title, d.photo_url
        FROM photo_metadata pm
        JOIN LATERAL (
            SELECT DISTINCT ON (photo_id) thumb_url, flickr_url, photo_title, photo_url
            FROM detections WHERE photo_id = pm.photo_id LIMIT 1
        ) d ON true
        WHERE pm.location_name IS NOT NULL AND pm.location_name != ''
        ORDER BY pm.location_name
    """)

    loc_dict: dict[str, dict] = {}
    for r in rows:
        name = r["location_name"]
        if name not in loc_dict:
            loc_dict[name] = {
                "name": name,
                "lat": float(r["latitude"]) if r["latitude"] else None,
                "lng": float(r["longitude"]) if r["longitude"] else None,
                "photos": [],
            }
        loc_dict[name]["photos"].append({
            "photo_id": r["photo_id"],
            "thumb_url": r["thumb_url"],
            "flickr_url": r["flickr_url"] or "",
            "photo_title": r["photo_title"] or "",
        })

    locations = [
        {**loc, "count": len(loc["photos"])}
        for loc in sorted(loc_dict.values(), key=lambda x: -len(x["photos"]))
    ]
    result = {"locations": locations}
    set_cached("locations", result)
    return result


@app.get("/photos/{photo_id}/metadata")
def get_photo_metadata(photo_id: str):
    """Return full metadata for a single photo."""
    catalog = _catalog_photo(photo_id)
    identities = [photo_id]
    if catalog:
        identities += [v for v in (catalog.get('legacy_photo_id'), catalog.get('flickr_id')) if v]
    rows = db_query("SELECT * FROM photo_metadata WHERE photo_id = ANY(%s) LIMIT 1", (identities,))
    if not rows:
        if catalog:
            return {'photo_id': photo_id, 'date_taken': catalog.get('taken_at'),
                    'latitude': catalog.get('latitude'), 'longitude': catalog.get('longitude'),
                    'description': catalog.get('description', ''), 'tags': []}
        raise HTTPException(404, "Metadata not found for this photo")
    row = dict(rows[0])
    # Convert datetime fields to strings for JSON serialization
    for key in ("date_taken", "created_at"):
        if row.get(key) is not None:
            row[key] = str(row[key])
    return row


def _catalog_photo(photo_id: str):
    rows = db_query("""SELECT p.*, n.provider_key AS nas_key, f.provider_key AS flickr_id,
        f.remote_url AS flickr_url
        FROM photos p
        LEFT JOIN photo_copies n ON n.photo_id=p.id AND n.provider='nas' AND n.status='available'
        LEFT JOIN photo_copies f ON f.photo_id=p.id AND f.provider='flickr' AND f.status='available'
        WHERE p.id::text=%s OR p.legacy_photo_id=%s OR f.provider_key=%s LIMIT 1
    """, (photo_id, photo_id, photo_id))
    return dict(rows[0]) if rows else None


@app.get("/photos/{photo_id}/image")
async def proxy_photo_image(photo_id: str, size: str = "b", user=Depends(get_current_user)):
    """Proxy a Flickr photo through the backend so family members can view
    full-resolution private photos without their own Flickr account.

    Size suffixes: s=75sq, q=150sq, t=100, m=240, n=320, z=640, c=800, b=1024, h=1600, k=2048, o=original
    Default 'b' (1024px) is good for viewing. Use 'o' for original quality.
    """
    import urllib.parse

    catalog = _catalog_photo(photo_id)
    if catalog and catalog.get('nas_key'):
        try:
            return await asyncio.to_thread(
                get_local_photo, str(catalog['id']),
                'original' if size == 'o' else ('thumb' if size in ('s', 'q', 't', 'm', 'n') else 'preview'),
                user,
            )
        except HTTPException as exc:
            if exc.status_code not in (404, 422) or not catalog.get('flickr_id'):
                raise
    if catalog:
        photo_id = catalog.get('flickr_id') or catalog.get('legacy_photo_id')
        if not photo_id:
            raise HTTPException(404, 'No available photo copy')

    flickr_creds = get_flickr_credentials()
    if not FLICKR_API_KEY or not flickr_creds:
        raise HTTPException(500, "Flickr not configured")

    # Get photo info from Flickr API to build the correct URL
    flickr_url = "https://api.flickr.com/services/rest"
    params = {
        "method": "flickr.photos.getSizes",
        "photo_id": photo_id,
        "format": "json",
        "nojsoncallback": "1",
    }
    oauth_params = _flickr_oauth_sign(flickr_url, params)
    auth_header = "OAuth " + ", ".join(
        f'{k}="{urllib.parse.quote(str(v), "")}"'
        for k, v in oauth_params.items()
    )
    qs = urllib.parse.urlencode(params)

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{flickr_url}?{qs}", headers={"Authorization": auth_header})
        data = resp.json()

    if data.get("stat") != "ok":
        raise HTTPException(404, f"Photo not found: {data.get('message', '')}")

    sizes = data.get("sizes", {}).get("size", [])
    if not sizes:
        raise HTTPException(404, "No sizes available for this photo")

    # Map size param to Flickr size labels
    size_map = {
        "s": "Square", "q": "Large Square", "t": "Thumbnail",
        "m": "Small", "n": "Small 320", "z": "Medium 640",
        "c": "Medium 800", "b": "Large", "h": "Large 1600",
        "k": "Large 2048", "o": "Original",
    }
    target_label = size_map.get(size, "Large")

    # Find the requested size, fall back to largest available
    image_url = None
    for s in sizes:
        if s.get("label") == target_label:
            image_url = s.get("source")
            break
    if not image_url:
        # Fall back to largest available
        image_url = sizes[-1].get("source")

    if not image_url:
        raise HTTPException(404, "Could not determine image URL")

    # Fetch the actual image and stream it back
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        img_resp = await client.get(image_url)
        if img_resp.status_code != 200:
            raise HTTPException(502, "Failed to fetch image from Flickr")

    content_type = img_resp.headers.get("content-type", "image/jpeg")
    return StreamingResponse(
        iter([img_resp.content]),
        media_type=content_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": f"inline; filename={photo_id}.jpg",
        },
    )


# ── Photo detections & manual tagging ─────────────────────────────────────────


@app.get("/photos/{photo_id}/detections")
def get_photo_detections(photo_id: str):
    """Return all detections for a photo with their cluster assignments."""
    catalog = _catalog_photo(photo_id)
    identities = [photo_id]
    if catalog:
        identities += [v for v in (str(catalog['id']), catalog.get('legacy_photo_id'), catalog.get('flickr_id')) if v]
    rows = db_query("""
        SELECT d.id, d.category, d.subtype, d.bbox, d.det_score, d.chip,
               dc.cluster_id, c.label as cluster_label
        FROM detections d
        LEFT JOIN detection_clusters dc ON dc.detection_id = d.id
        LEFT JOIN clusters c ON c.id = dc.cluster_id AND c.category = dc.category
        WHERE d.photo_id = ANY(%s)
        ORDER BY d.det_score DESC
    """, (identities,))
    # Also get photo info from any detection
    photo_info = db_query("""
        SELECT photo_url, thumb_url, flickr_url, photo_title, owner
        FROM detections WHERE photo_id = ANY(%s) LIMIT 1
    """, (identities,))
    photo = dict(photo_info[0]) if photo_info else {}
    if catalog:
        photo['photo_title'] = catalog.get('title') or catalog.get('original_filename') or 'Untitled'
        photo['flickr_url'] = catalog.get('flickr_url') or ''
    return {
        "photo_id": photo_id,
        "photo_url": photo.get("photo_url", ""),
        "thumb_url": photo.get("thumb_url", ""),
        "flickr_url": photo.get("flickr_url", ""),
        "photo_title": photo.get("photo_title", ""),
        "detections": [
            {
                "id": str(r["id"]),
                "category": r["category"],
                "subtype": r["subtype"],
                "bbox": json.loads(r["bbox"]) if isinstance(r["bbox"], str) else r["bbox"],
                "det_score": float(r["det_score"]) if r["det_score"] else 0,
                "chip": r["chip"],
                "cluster_id": r["cluster_id"],
                "cluster_label": r["cluster_label"],
            }
            for r in rows
        ],
    }


class ManualTagRequest(BaseModel):
    bbox: list[float]  # [x1, y1, x2, y2] in pixel coords of original image
    category: str = "people"
    subtype: str = "face"
    cluster_id: Optional[str] = None  # assign to existing cluster
    new_label: Optional[str] = None   # create new cluster with this name


@app.post("/photos/{photo_id}/tag")
async def manual_tag_photo(photo_id: str, req: ManualTagRequest, admin=Depends(require_admin)):
    """Manually tag a face/object in a photo by providing a bounding box."""
    import cv2

    # Get photo URL from existing detections or photo_embeddings
    photo_rows = db_query("""
        SELECT photo_url, thumb_url, flickr_url, photo_title, owner
        FROM detections WHERE photo_id = %s LIMIT 1
    """, (photo_id,))

    if not photo_rows:
        # Try to find photo URL from photo_embeddings or construct from Flickr
        raise HTTPException(404, "Photo not found in detections. Run a scan first or provide photo_url.")

    pr = photo_rows[0]
    photo_url = pr["photo_url"]

    # Download the image
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(photo_url)
        resp.raise_for_status()
    arr = np.frombuffer(resp.content, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Could not decode image")

    bbox = req.bbox
    x1, y1, x2, y2 = [max(0, int(v)) for v in bbox]
    x2 = min(img.shape[1], x2)
    y2 = min(img.shape[0], y2)

    if (x2 - x1) < 10 or (y2 - y1) < 10:
        raise HTTPException(400, "Bounding box too small")

    # Generate embedding based on category
    if req.category == "people":
        # Try InsightFace on the cropped region for a proper face embedding
        face_app = get_face_app()
        face_crop = img[y1:y2, x1:x2]
        faces = face_app.get(face_crop)
        if faces:
            # Use the best face detected within the crop
            best = max(faces, key=lambda f: f.det_score)
            embedding = best.embedding.tolist()
            score = float(best.det_score)
        else:
            # No face detected in crop - use CLIP embedding instead
            clip_emb = clip_embed_image(img, bbox=bbox)
            if clip_emb is None:
                raise HTTPException(400, "Could not generate embedding for this region")
            embedding = clip_emb.tolist()
            score = 0.5  # manual tag, moderate confidence
    else:
        # For pets/vehicles, use CLIP embedding
        clip_emb = clip_embed_image(img, bbox=bbox)
        if clip_emb is None:
            raise HTTPException(400, "Could not generate embedding for this region")
        embedding = clip_emb.tolist()
        score = 0.5

    # Build photo dict for insert_detection
    photo = {
        "id": photo_id,
        "url": pr["photo_url"],
        "thumb": pr["thumb_url"],
        "flickr_url": pr["flickr_url"],
        "title": pr["photo_title"],
        "owner": pr["owner"],
    }

    conn = get_db()
    try:
        det_id = insert_detection(conn, photo, req.category, req.subtype,
                                  bbox, score, embedding, img)
        if not det_id:
            conn.close()
            raise HTTPException(400, "Detection was filtered (duplicate or dismissed)")

        # Assign to cluster if specified
        if req.cluster_id:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO detection_clusters (detection_id, cluster_id, category, pinned)
                    VALUES (%s, %s, %s, true)
                    ON CONFLICT (detection_id) DO UPDATE
                    SET cluster_id = EXCLUDED.cluster_id, pinned = true
                """, (det_id, req.cluster_id, req.category))
            conn.commit()
        elif req.new_label:
            # Create a new named cluster
            new_cid = str(uuid.uuid4())
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO clusters (id, category, label) VALUES (%s, %s, %s)
                    ON CONFLICT (id, category) DO NOTHING
                """, (new_cid, req.category, req.new_label))
                cur.execute("""
                    INSERT INTO detection_clusters (detection_id, cluster_id, category, pinned)
                    VALUES (%s, %s, %s, true)
                    ON CONFLICT (detection_id) DO UPDATE
                    SET cluster_id = EXCLUDED.cluster_id, pinned = true
                """, (det_id, new_cid, req.category))
            conn.commit()
        else:
            # Put in its own cluster, unpinned (will be clustered later)
            new_cid = str(uuid.uuid4())
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO detection_clusters (detection_id, cluster_id, category, pinned)
                    VALUES (%s, %s, %s, false)
                    ON CONFLICT (detection_id) DO UPDATE
                    SET cluster_id = EXCLUDED.cluster_id, pinned = false
                """, (det_id, new_cid, req.category))
            conn.commit()

        conn.close()
    except HTTPException:
        raise
    except Exception as e:
        conn.close()
        raise HTTPException(500, f"Error creating detection: {str(e)}")

    invalidate_cache()

    return {
        "detection_id": det_id,
        "cluster_id": req.cluster_id or (new_cid if req.new_label or not req.cluster_id else None),
        "chip": bbox_chip_b64(img, bbox),
    }


# ── Feature 2: Duplicate detection ──────────────────────────────────────────

@app.get("/duplicates")
def get_duplicates(threshold: float = Query(0.05, ge=0.0, le=1.0)):
    """Find near-duplicate photos using CLIP embedding cosine distance."""
    cached = get_cached(f"duplicates_{threshold}", ttl_seconds=3600)
    if cached:
        return cached
    rows = db_query("""
        SELECT a.photo_id as id_a, b.photo_id as id_b,
               a.clip_embedding <=> b.clip_embedding as distance
        FROM photo_embeddings a, photo_embeddings b
        WHERE a.photo_id < b.photo_id
        AND a.clip_embedding <=> b.clip_embedding < %s
        ORDER BY distance ASC
        LIMIT 200
    """, (threshold,))

    # Build duplicate groups using union-find
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x])
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    pair_distances: dict[tuple[str, str], float] = {}
    for r in rows:
        union(r["id_a"], r["id_b"])
        pair_distances[(r["id_a"], r["id_b"])] = float(r["distance"])

    # Collect groups
    groups_dict: dict[str, list[str]] = {}
    all_ids = set()
    for r in rows:
        all_ids.add(r["id_a"])
        all_ids.add(r["id_b"])
    for pid in all_ids:
        root = find(pid)
        groups_dict.setdefault(root, [])
        if pid not in groups_dict[root]:
            groups_dict[root].append(pid)

    # Get photo details
    if all_ids:
        detail_rows = db_query("""
            SELECT DISTINCT ON (d.photo_id) d.photo_id, d.thumb_url, d.photo_url, d.flickr_url
            FROM detections d
            WHERE d.photo_id = ANY(%s)
        """, (list(all_ids),))
        details = {r["photo_id"]: dict(r) for r in detail_rows}
    else:
        details = {}

    result_groups = []
    for root, members in groups_dict.items():
        if len(members) < 2:
            continue
        # Compute average similarity for the group
        dists = []
        for i, a in enumerate(members):
            for b in members[i+1:]:
                key = (min(a, b), max(a, b))
                if key in pair_distances:
                    dists.append(pair_distances[key])
        avg_dist = sum(dists) / len(dists) if dists else 0.0
        similarity = round(1.0 - avg_dist, 4)

        photos = [details.get(pid, {"photo_id": pid}) for pid in members]
        result_groups.append({"photos": photos, "similarity": similarity})

    result_groups.sort(key=lambda g: -g["similarity"])
    result = {"groups": result_groups[:50]}
    set_cached(f"duplicates_{threshold}", result)
    return result


# ── Feature 3: Scene recategorization ────────────────────────────────────────

@app.post("/scenes/move")
def move_scene(req: SceneMoveRequest, admin=Depends(require_admin)):
    """Override a photo's scene classification."""
    # Remove old scene assignment if present
    db_query(
        "DELETE FROM scene_overrides WHERE photo_id = %s AND scene = %s",
        (req.photo_id, req.from_scene),
        fetch=False,
    )
    # Insert new scene assignment
    db_query("""
        INSERT INTO scene_overrides (photo_id, scene)
        VALUES (%s, %s)
        ON CONFLICT (photo_id, scene) DO NOTHING
    """, (req.photo_id, req.to_scene), fetch=False)
    return {"ok": True, "photo_id": req.photo_id, "scene": req.to_scene}


# ── Feature 4: OCR (text detection) ─────────────────────────────────────────

def _run_ocr(img_bgr) -> Optional[str]:
    """Run Tesseract OCR on an image and return detected text or None."""
    try:
        import pytesseract
        from PIL import Image
        pil_img = Image.fromarray(img_bgr[:, :, ::-1])  # BGR -> RGB
        text = pytesseract.image_to_string(pil_img).strip()
        return text if text else None
    except Exception:
        return None


@app.get("/search/text")
def search_text(q: str = Query(..., min_length=1)):
    """Full-text search on OCR-detected text in photos."""
    rows = db_query("""
        SELECT pt.photo_id, pt.detected_text, d.thumb_url, d.flickr_url, d.photo_title
        FROM photo_text pt
        JOIN LATERAL (
            SELECT DISTINCT ON (photo_id) thumb_url, flickr_url, photo_title
            FROM detections WHERE photo_id = pt.photo_id LIMIT 1
        ) d ON true
        WHERE pt.detected_text ILIKE %s
        LIMIT 30
    """, (f"%{q}%",))
    return [dict(r) for r in rows]


async def _backfill_ocr_task(job_id: str) -> None:
    """Background task: run OCR on all photos that don't have text extracted yet."""
    import cv2

    rows = db_query("""
        SELECT DISTINCT ON (d.photo_id) d.photo_id, d.photo_url
        FROM detections d
        LEFT JOIN photo_text pt ON pt.photo_id = d.photo_id
        WHERE pt.photo_id IS NULL
    """)
    jobs[job_id]["total"] = len(rows)
    conn = get_db()
    done = 0
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            for i, r in enumerate(rows):
                jobs[job_id]["progress"] = i + 1
                jobs[job_id]["message"] = f"[{i+1}/{len(rows)}] OCR on {r['photo_id']}"
                try:
                    resp = await client.get(r["photo_url"])
                    resp.raise_for_status()
                    arr = np.frombuffer(resp.content, np.uint8)
                    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                    if img is None:
                        continue
                    text = _run_ocr(img)
                    if text:
                        with conn.cursor() as cur:
                            cur.execute("""
                                INSERT INTO photo_text (photo_id, detected_text)
                                VALUES (%s, %s) ON CONFLICT (photo_id) DO NOTHING
                            """, (r["photo_id"], text))
                        conn.commit()
                        done += 1
                except Exception as e:
                    print(f"  OCR error {r['photo_id']}: {e}")
                    conn.rollback()
                await asyncio.sleep(0)
    finally:
        conn.close()

    jobs[job_id]["status"] = "done"
    jobs[job_id]["message"] = f"Done -- OCR extracted text from {done} photos"


@app.post("/backfill-ocr")
async def backfill_ocr(background_tasks: BackgroundTasks, admin=Depends(require_admin)):
    """Backfill OCR text detection for all existing photos."""
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "running", "progress": 0, "total": 0, "message": "Starting OCR backfill..."}
    background_tasks.add_task(_backfill_ocr_task, job_id)
    return {"job_id": job_id}


# ── Feature 5: Dominant color extraction ─────────────────────────────────────

def _extract_dominant_colors(img_bgr, n_colors: int = 3) -> list[dict]:
    """Extract top N dominant colors using k-means clustering on pixel values."""
    import cv2
    from sklearn.cluster import KMeans

    # Resize for speed
    h, w = img_bgr.shape[:2]
    max_dim = 200
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        img_bgr = cv2.resize(img_bgr, (int(w * scale), int(h * scale)))

    # Convert to RGB and reshape to pixel list
    img_rgb = img_bgr[:, :, ::-1]
    pixels = img_rgb.reshape(-1, 3).astype(np.float32)

    kmeans = KMeans(n_clusters=n_colors, n_init=10, random_state=42)
    kmeans.fit(pixels)

    # Count pixels per cluster
    labels, counts = np.unique(kmeans.labels_, return_counts=True)
    total = counts.sum()

    colors = []
    for center, count in sorted(zip(kmeans.cluster_centers_, counts), key=lambda x: -x[1]):
        r_val, g_val, b_val = int(round(center[0])), int(round(center[1])), int(round(center[2]))
        hex_str = f"#{r_val:02x}{g_val:02x}{b_val:02x}"
        colors.append({
            "r": r_val, "g": g_val, "b": b_val,
            "hex": hex_str,
            "pct": round(float(count) / float(total), 4),
        })
    return colors


@app.get("/search/color")
def search_by_color(
    hex: str = Query(..., description="Hex color without # (e.g. ff8000)"),
    threshold: float = Query(50.0, ge=0, description="Max Euclidean distance in RGB space"),
):
    """Find photos with a dominant color close to the given hex color."""
    # Parse hex color
    hex_clean = hex.lstrip("#")
    if len(hex_clean) != 6:
        raise HTTPException(400, "hex must be 6 hex characters (e.g. ff8000)")
    try:
        target_r = int(hex_clean[0:2], 16)
        target_g = int(hex_clean[2:4], 16)
        target_b = int(hex_clean[4:6], 16)
    except ValueError:
        raise HTTPException(400, "Invalid hex color")

    # Query all photo colors and filter in application
    rows = db_query("""
        SELECT pc.photo_id, pc.colors, d.thumb_url, d.flickr_url, d.photo_title
        FROM photo_colors pc
        JOIN LATERAL (
            SELECT DISTINCT ON (photo_id) thumb_url, flickr_url, photo_title
            FROM detections WHERE photo_id = pc.photo_id LIMIT 1
        ) d ON true
    """)

    results = []
    for r in rows:
        colors = r["colors"] if isinstance(r["colors"], list) else json.loads(r["colors"])
        for c in colors:
            dist = ((c["r"] - target_r) ** 2 + (c["g"] - target_g) ** 2 + (c["b"] - target_b) ** 2) ** 0.5
            if dist <= threshold:
                results.append({
                    "photo_id": r["photo_id"],
                    "thumb_url": r["thumb_url"],
                    "flickr_url": r["flickr_url"],
                    "photo_title": r["photo_title"],
                    "matched_color": c,
                    "distance": round(dist, 2),
                })
                break  # One match per photo is enough

    results.sort(key=lambda x: x["distance"])
    return results[:50]


async def _backfill_colors_task(job_id: str) -> None:
    """Background task: extract dominant colors for all photos missing them."""
    import cv2

    rows = db_query("""
        SELECT DISTINCT ON (d.photo_id) d.photo_id, d.photo_url
        FROM detections d
        LEFT JOIN photo_colors pc ON pc.photo_id = d.photo_id
        WHERE pc.photo_id IS NULL
    """)
    jobs[job_id]["total"] = len(rows)
    conn = get_db()
    done = 0
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            for i, r in enumerate(rows):
                jobs[job_id]["progress"] = i + 1
                jobs[job_id]["message"] = f"[{i+1}/{len(rows)}] Colors for {r['photo_id']}"
                try:
                    resp = await client.get(r["photo_url"])
                    resp.raise_for_status()
                    arr = np.frombuffer(resp.content, np.uint8)
                    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                    if img is None:
                        continue
                    colors = _extract_dominant_colors(img)
                    with conn.cursor() as cur:
                        cur.execute("""
                            INSERT INTO photo_colors (photo_id, colors)
                            VALUES (%s, %s) ON CONFLICT (photo_id) DO NOTHING
                        """, (r["photo_id"], json.dumps(colors)))
                    conn.commit()
                    done += 1
                except Exception as e:
                    print(f"  color error {r['photo_id']}: {e}")
                    conn.rollback()
                await asyncio.sleep(0)
    finally:
        conn.close()

    jobs[job_id]["status"] = "done"
    jobs[job_id]["message"] = f"Done -- colors extracted for {done} photos"


@app.post("/backfill-colors")
async def backfill_colors(background_tasks: BackgroundTasks, admin=Depends(require_admin)):
    """Backfill dominant color extraction for all existing photos."""
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "running", "progress": 0, "total": 0, "message": "Starting color backfill..."}
    background_tasks.add_task(_backfill_colors_task, job_id)
    return {"job_id": job_id}


# ── Background analysis ───────────────────────────────────────────────────────

async def _run_analysis(job_id: str, photos: list[dict]):
    import cv2
    from concurrent.futures import ThreadPoolExecutor

    face_app = get_face_app()
    yolo     = get_yolo()

    # Log sync start
    sync_id = None
    try:
        rows = db_query("""
            INSERT INTO sync_logs (job_id, total_photos, status) VALUES (%s, %s, 'running')
            RETURNING id
        """, (job_id, len(photos)))
        sync_id = rows[0]["id"] if rows else None
    except Exception:
        pass

    # Get already-processed photo IDs
    existing_rows = db_query("SELECT photo_id FROM processed_photos")
    existing = {r["photo_id"] for r in existing_rows}

    # Thread pool for parallel ML inference
    executor = ThreadPoolExecutor(max_workers=3)

    conn = get_db()
    batch_count = 0
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            for i, photo in enumerate(photos):
                jobs[job_id]["progress"] = i + 1
                jobs[job_id]["message"] = f"[{i+1}/{len(photos)}] {photo.get('title', photo['id'])[:50]}"

                if photo["id"] in existing:
                    continue

                try:
                    t_start = _time.time()
                    resp = await client.get(photo["url"])
                    resp.raise_for_status()
                    t_download = _time.time() - t_start
                    arr = np.frombuffer(resp.content, np.uint8)
                    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                    if img is None:
                        continue

                    # Run ArcFace, YOLOv8, and CLIP in parallel threads
                    t_ml_start = _time.time()
                    loop = asyncio.get_event_loop()
                    face_future = loop.run_in_executor(executor, face_app.get, img)
                    yolo_future = loop.run_in_executor(executor, lambda: yolo(img[:, :, ::-1], verbose=False))
                    clip_future = loop.run_in_executor(executor, clip_embed_image, img, None)

                    faces, yolo_results, photo_clip = await asyncio.gather(
                        face_future, yolo_future, clip_future
                    )

                    # Process faces
                    for face in faces:
                        bbox = face.bbox.tolist()
                        bw, bh = bbox[2]-bbox[0], bbox[3]-bbox[1]
                        if bw < 24 or bh < 24:
                            continue
                        x1, y1 = max(0, int(bbox[0])), max(0, int(bbox[1]))
                        x2, y2 = min(img.shape[1], int(bbox[2])), min(img.shape[0], int(bbox[3]))
                        face_crop = img[y1:y2, x1:x2]
                        if face_crop.size > 0:
                            gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
                            if cv2.Laplacian(gray, cv2.CV_64F).var() < 15:
                                continue
                        if float(face.det_score) < 0.35:
                            continue
                        insert_detection(conn, photo, "people", "face",
                            bbox, float(face.det_score),
                            face.embedding.tolist(), img)
                        jobs[job_id]["counts"]["people"] += 1

                    # Process pets/vehicles
                    for box in yolo_results[0].boxes:
                        cls_id = int(box.cls[0])
                        score = float(box.conf[0])
                        if score < 0.4:
                            continue
                        xyxy = box.xyxy[0].tolist()

                        clip_emb = clip_embed_image(img, bbox=xyxy)
                        emb_list = clip_emb.tolist() if clip_emb is not None else []

                        if cls_id in PET_CLASSES:
                            insert_detection(conn, photo, "pets", PET_CLASSES[cls_id],
                                xyxy, score, emb_list, img)
                            jobs[job_id]["counts"]["pets"] += 1
                        elif cls_id in VEHICLE_CLASSES:
                            insert_detection(conn, photo, "vehicles", VEHICLE_CLASSES[cls_id],
                                xyxy, score, emb_list, img)
                            jobs[job_id]["counts"]["vehicles"] += 1

                    # Store CLIP photo embedding (already computed above)
                    if photo_clip is not None:
                        try:
                            with conn.cursor() as cur:
                                cur.execute("""
                                    INSERT INTO photo_embeddings (photo_id, clip_embedding)
                                    VALUES (%s, %s) ON CONFLICT (photo_id) DO NOTHING
                                """, (photo["id"], np.array(photo_clip, dtype=np.float32)))
                        except Exception:
                            pass

                    # Color extraction (fast, ~0.1s)
                    try:
                        colors = _extract_dominant_colors(img)
                        if colors:
                            with conn.cursor() as cur:
                                cur.execute("""
                                    INSERT INTO photo_colors (photo_id, colors)
                                    VALUES (%s, %s) ON CONFLICT (photo_id) DO NOTHING
                                """, (photo["id"], json.dumps(colors)))
                    except Exception:
                        pass

                    # Batch commit every 5 photos instead of every photo
                    batch_count += 1
                    t_total = _time.time() - t_start
                    t_ml = _time.time() - t_ml_start
                    if batch_count % 50 == 0:
                        print(f"  Photo {batch_count}: download={t_download:.1f}s ml={t_ml:.1f}s total={t_total:.1f}s")
                    if batch_count % 5 == 0:
                        conn.commit()

                except Exception as e:
                    print(f"  x photo {photo['id']}: {e}")
                    conn.rollback()
                    continue

                await asyncio.sleep(0)

        conn.commit()  # Final commit

        # Auto-cluster
        jobs[job_id]["message"] = "Clustering faces..."
        for cat in ("people", "pets", "vehicles"):
            try:
                run_clustering(cat, distance_threshold=0.80)
            except Exception as e:
                print(f"  Auto-cluster {cat} failed: {e}")

    finally:
        conn.close()
        executor.shutdown(wait=False)

    c = jobs[job_id]["counts"]
    jobs[job_id]["status"] = "done"
    jobs[job_id]["message"] = f"Done — {c['people']} faces, {c['pets']} pets, {c['vehicles']} vehicles"

    # Log sync completion
    if sync_id:
        try:
            db_query("""
                UPDATE sync_logs SET finished_at = now(), status = 'done',
                    new_faces = %s, new_pets = %s, new_vehicles = %s
                WHERE id = %s
            """, (c["people"], c["pets"], c["vehicles"], sync_id), fetch=False)
        except Exception:
            pass

    # Notifications
    total_found = c["people"] + c["pets"] + c["vehicles"]
    if total_found > 0:
        create_notification("scan_complete", "Scan complete",
            f"{c['people']} faces · {c['pets']} animals · {c['vehicles']} vehicles detected",
            {"faces": c["people"], "pets": c["pets"], "vehicles": c["vehicles"]})
    else:
        create_notification("scan_complete", "Scan complete", "No new detections found")

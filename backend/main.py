"""
Kindred backend — FastAPI + PostgreSQL/pgvector
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import numpy as np
import json
import uuid
import httpx
import asyncio
import base64
import os

import secrets
import bcrypt

import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
from pgvector.psycopg2 import register_vector
from datetime import datetime, timedelta, timezone

DATABASE_URL = os.environ.get("DATABASE_URL", "")
FLICKR_API_KEY = os.environ.get("FLICKR_API_KEY", "")
FLICKR_SECRET = os.environ.get("FLICKR_SECRET", "")
FLICKR_OAUTH_TOKEN = os.environ.get("FLICKR_OAUTH_TOKEN", "")
FLICKR_OAUTH_SECRET = os.environ.get("FLICKR_OAUTH_SECRET", "")
FLICKR_USER_ID = os.environ.get("FLICKR_USER_ID", "")
SCAN_SECRET = os.environ.get("SCAN_SECRET", "")
API_KEY = os.environ.get("API_KEY", "")

app = FastAPI(title="Kindred API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

from fastapi import Request as FastAPIRequest, Depends
from starlette.middleware.base import BaseHTTPMiddleware

AUTH_SKIP_PATHS = {"/health", "/docs", "/openapi.json", "/app-config",
                   "/auth/setup", "/auth/login", "/auth/register"}

class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: FastAPIRequest, call_next):
        from fastapi.responses import JSONResponse
        path = request.url.path
        # Skip auth for public endpoints
        if path in AUTH_SKIP_PATHS or path.startswith("/docs"):
            return await call_next(request)
        if path == "/scan/auto":
            return await call_next(request)

        # Try session token first (web users)
        session_token = request.headers.get("X-Session-Token")
        if session_token:
            user = validate_session(session_token)
            if user:
                request.state.user = {**user, "auth_method": "session"}
                return await call_next(request)
            return JSONResponse(status_code=401, content={"detail": "Invalid or expired session"})

        # Fall back to API key (mobile/external)
        if API_KEY:
            key = request.headers.get("X-API-Key") or request.query_params.get("api_key")
            if key == API_KEY:
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
                    created_at TIMESTAMPTZ DEFAULT now(),
                    updated_at TIMESTAMPTZ DEFAULT now()
                )
            """)
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
        """SELECT u.id as user_id, u.username, u.display_name, u.role, u.flickr_user_id
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
    }

def generate_invite_code() -> str:
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no I/O/0/1 to avoid confusion
    return "".join(secrets.choice(chars) for _ in range(8))

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
        _face_app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        _face_app.prepare(ctx_id=0, det_size=(960, 960))
    return _face_app

def get_yolo():
    global _yolo
    if _yolo is None:
        from ultralytics import YOLO
        _yolo = YOLO("yolov8n.pt")
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

class AnalyzeRequest(BaseModel):
    photos: list[dict]

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
            "face_detection": True,
            "pet_detection": True,
            "vehicle_detection": True,
        },
        "auth": {
            "method": "api_key",
            "header": "X-API-Key",
        },
    }

# ── Auth endpoints ───────────────────────────────────────────────────────────

class SetupRequest(BaseModel):
    username: str
    display_name: str
    flickr_user_id: str

@app.post("/auth/setup")
def auth_setup(req: SetupRequest):
    """First-run admin creation. Only works if no users exist."""
    rows = db_query("SELECT COUNT(*) as cnt FROM users")
    if rows and rows[0]["cnt"] > 0:
        raise HTTPException(409, "Setup already complete — admin user exists")
    user_rows = db_query(
        """INSERT INTO users (username, display_name, role, flickr_user_id)
           VALUES (%s, %s, 'admin', %s) RETURNING id, username, display_name, role""",
        (req.username, req.display_name, req.flickr_user_id),
    )
    user = user_rows[0]
    session = create_session(str(user["id"]))
    return {
        "user": {"id": str(user["id"]), "username": user["username"],
                 "display_name": user["display_name"], "role": user["role"]},
        "session": session,
    }

class FlickrLoginRequest(BaseModel):
    flickr_user_id: str

@app.post("/auth/flickr-login")
def auth_flickr_login(req: FlickrLoginRequest):
    """Admin re-login via Flickr OAuth. Finds admin by flickr_user_id."""
    rows = db_query(
        "SELECT id, username, display_name, role FROM users WHERE flickr_user_id = %s AND role = 'admin'",
        (req.flickr_user_id,),
    )
    if not rows:
        raise HTTPException(401, "No admin account for this Flickr user")
    user = rows[0]
    session = create_session(str(user["id"]))
    return {
        "user": {"id": str(user["id"]), "username": user["username"],
                 "display_name": user["display_name"], "role": user["role"]},
        "session": session,
    }

class LoginRequest(BaseModel):
    username: str
    password: str

@app.post("/auth/login")
def auth_login(req: LoginRequest):
    """Member login with username/password."""
    rows = db_query(
        "SELECT id, username, display_name, role, password_hash FROM users WHERE username = %s",
        (req.username,),
    )
    if not rows or not rows[0]["password_hash"]:
        raise HTTPException(401, "Invalid username or password")
    user = rows[0]
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Invalid username or password")
    session = create_session(str(user["id"]))
    return {
        "user": {"id": str(user["id"]), "username": user["username"],
                 "display_name": user["display_name"], "role": user["role"]},
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
    return {
        "loggedIn": True,
        "userId": user["user_id"],
        "username": user["username"],
        "display_name": user["display_name"],
        "role": user["role"],
        "auth_method": user.get("auth_method", "session"),
    }

# ── Household management endpoints (admin-only) ─────────────────────────────

@app.get("/users")
def list_users(admin=Depends(require_admin)):
    rows = db_query("SELECT id, username, display_name, role, flickr_user_id, created_at FROM users ORDER BY created_at")
    return {"users": [{"id": str(r["id"]), "username": r["username"], "display_name": r["display_name"],
                        "role": r["role"], "flickr_user_id": r.get("flickr_user_id"), "created_at": r["created_at"].isoformat() if r["created_at"] else None}
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

@app.delete("/users/{user_id}")
def delete_user(user_id: str, request: FastAPIRequest, admin=Depends(require_admin)):
    if admin["user_id"] == user_id:
        raise HTTPException(400, "Cannot delete yourself")
    db_query("DELETE FROM users WHERE id = %s", (user_id,), fetch=False)
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
        if not all([FLICKR_API_KEY, FLICKR_OAUTH_TOKEN, FLICKR_OAUTH_SECRET]):
            raise HTTPException(500, "Flickr OAuth not configured on backend")
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
    owner_id = FLICKR_USER_ID or ""
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
def get_clusters_summary(category: str, sort_visual: bool = False, limit: int = 30, offset: int = 0):
    """Lightweight summary — single query, no N+1. sort_visual groups unnamed by visual similarity."""
    rows = db_query("""
        WITH ranked AS (
            SELECT dc.cluster_id, d.id, d.photo_id, d.det_score, d.chip, d.thumb_url, d.photo_url,
                   ROW_NUMBER() OVER (PARTITION BY dc.cluster_id ORDER BY d.det_score DESC) as rn
            FROM detection_clusters dc
            JOIN detections d ON d.id = dc.detection_id
            WHERE dc.category = %s AND dc.cluster_id != '-1'
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
    """, (category,))

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

@app.get("/search")
def search_photos(q: str, limit: int = 50):
    """Search photos — checks named people first, then CLIP visual search."""
    if not q.strip():
        raise HTTPException(400, "Query required")

    query = q.strip()
    results = []

    # Phase 1: Check named people/clusters
    name_rows = db_query("""
        SELECT c.id as cluster_id, c.label, c.category
        FROM clusters c
        WHERE c.label ILIKE %s
        ORDER BY LENGTH(c.label) ASC
        LIMIT 5
    """, (f"%{query}%",))

    if name_rows:
        # Get photos for matching people
        for nr in name_rows:
            photo_rows = db_query("""
                SELECT DISTINCT ON (d.photo_id) d.photo_id, d.photo_url, d.thumb_url,
                       d.flickr_url, d.photo_title, d.owner
                FROM detections d
                JOIN detection_clusters dc ON d.id = dc.detection_id
                WHERE dc.cluster_id = %s AND dc.category = %s
                LIMIT %s
            """, (nr["cluster_id"], nr["category"], limit))
            for r in photo_rows:
                results.append({
                    "photo_id": r["photo_id"],
                    "distance": 0.0,
                    "photo_url": r["photo_url"],
                    "thumb_url": r["thumb_url"],
                    "flickr_url": r["flickr_url"],
                    "photo_title": r["photo_title"],
                    "owner": r["owner"],
                    "match_type": "person",
                    "match_name": nr["label"],
                    "match_cluster_id": nr["cluster_id"],
                    "match_category": nr["category"],
                })

    # Phase 2: CLIP visual search (fill remaining slots)
    remaining = limit - len(results)
    if remaining > 0:
        emb = clip_embed_text(query)
        vec = np.array(emb, dtype=np.float32)
        seen_ids = {r["photo_id"] for r in results}
        clip_rows = db_query("""
            SELECT pe.photo_id, pe.clip_embedding <=> %s AS distance,
                   d.photo_url, d.thumb_url, d.flickr_url, d.photo_title, d.owner
            FROM photo_embeddings pe
            JOIN LATERAL (
                SELECT DISTINCT ON (photo_id) photo_url, thumb_url, flickr_url, photo_title, owner
                FROM detections WHERE photo_id = pe.photo_id LIMIT 1
            ) d ON true
            ORDER BY distance ASC
            LIMIT %s
        """, (vec, remaining + len(seen_ids)))
        for r in clip_rows:
            if r["photo_id"] not in seen_ids:
                row = dict(r)
                row["match_type"] = "visual"
                results.append(row)
                if len(results) >= limit:
                    break

    return results

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

    if not all([FLICKR_API_KEY, FLICKR_OAUTH_TOKEN, FLICKR_OAUTH_SECRET]):
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
                oauth_params = _flickr_oauth_sign(flickr_url, params)
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

    if deleted:
        create_notification("photos_deleted", f"{len(deleted)} photos deleted from Flickr",
            f"{len(failed)} failed" if failed else "All successful",
            {"deleted_count": len(deleted), "failed_count": len(failed)})

    return {"deleted": deleted, "failed": failed, "count": len(deleted)}

@app.post("/scan/auto")
async def auto_scan(background_tasks: BackgroundTasks, secret: str = ""):
    """Nightly auto-scan: fetch all Flickr photos and analyze new ones."""
    if secret != SCAN_SECRET:
        raise HTTPException(403, "Invalid scan secret")
    if not all([FLICKR_API_KEY, FLICKR_OAUTH_TOKEN, FLICKR_OAUTH_SECRET, FLICKR_USER_ID]):
        raise HTTPException(500, "Flickr OAuth env vars not configured")

    # Fetch all photos from Flickr using OAuth
    import hmac
    import hashlib
    import time
    import urllib.parse

    def oauth_sign(url, params):
        oauth_params = {
            "oauth_consumer_key": FLICKR_API_KEY,
            "oauth_token": FLICKR_OAUTH_TOKEN,
            "oauth_signature_method": "HMAC-SHA1",
            "oauth_timestamp": str(int(time.time())),
            "oauth_nonce": uuid.uuid4().hex,
            "oauth_version": "1.0",
        }
        all_params = {**params, **oauth_params}
        sorted_params = "&".join(f"{urllib.parse.quote(k, '')}={urllib.parse.quote(str(v), '')}"
                                 for k, v in sorted(all_params.items()))
        base_string = f"GET&{urllib.parse.quote(url, '')}&{urllib.parse.quote(sorted_params, '')}"
        signing_key = f"{urllib.parse.quote(FLICKR_SECRET, '')}&{urllib.parse.quote(FLICKR_OAUTH_SECRET, '')}"
        sig = base64.b64encode(hmac.new(signing_key.encode(), base_string.encode(), hashlib.sha1).digest()).decode()
        oauth_params["oauth_signature"] = sig
        return oauth_params

    flickr_url = "https://api.flickr.com/services/rest"
    all_photos = []
    page = 1

    while True:
        params = {
            "method": "flickr.people.getPhotos",
            "user_id": FLICKR_USER_ID,
            "per_page": "500",
            "page": str(page),
            "extras": "url_z,url_b,owner_name,title,media",
            "media": "photos",
            "format": "json",
            "nojsoncallback": "1",
        }
        oauth_params = oauth_sign(flickr_url, params)
        auth_header = "OAuth " + ", ".join(f'{k}="{urllib.parse.quote(str(v), "")}"'
                                           for k, v in oauth_params.items())
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
                "owner": p.get("ownername", FLICKR_USER_ID),
                "thumb": f"https://live.staticflickr.com/{p['server']}/{p['id']}_{p['secret']}_q.jpg",
                "flickr_url": f"https://www.flickr.com/photos/{FLICKR_USER_ID}/{p['id']}",
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

def _flickr_oauth_sign(url: str, params: dict) -> dict:
    """Sign a Flickr API request using OAuth 1.0a."""
    import hmac
    import hashlib
    import time
    import urllib.parse

    oauth_params = {
        "oauth_consumer_key": FLICKR_API_KEY,
        "oauth_token": FLICKR_OAUTH_TOKEN,
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
    base_string = f"GET&{urllib.parse.quote(url, '')}&{urllib.parse.quote(sorted_params, '')}"
    signing_key = f"{urllib.parse.quote(FLICKR_SECRET, '')}&{urllib.parse.quote(FLICKR_OAUTH_SECRET, '')}"
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
    if not all([FLICKR_API_KEY, FLICKR_OAUTH_TOKEN, FLICKR_OAUTH_SECRET, FLICKR_USER_ID]):
        raise HTTPException(500, "Flickr OAuth env vars not configured")
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "running", "progress": 0, "total": 0, "message": "Starting metadata backfill..."}
    background_tasks.add_task(_backfill_metadata_task, job_id)
    return {"job_id": job_id}


@app.get("/timeline")
def get_timeline():
    """Return photos grouped by month/year from photo_metadata."""
    cached = get_cached("timeline", ttl_seconds=3600)
    if cached:
        return cached
    rows = db_query("""
        SELECT pm.photo_id, pm.date_taken,
               d.thumb_url, d.flickr_url, d.photo_title, d.photo_url
        FROM photo_metadata pm
        JOIN LATERAL (
            SELECT DISTINCT ON (photo_id) thumb_url, flickr_url, photo_title, photo_url
            FROM detections WHERE photo_id = pm.photo_id LIMIT 1
        ) d ON true
        WHERE pm.date_taken IS NOT NULL
        ORDER BY pm.date_taken DESC
    """)

    months_dict: dict[str, list[dict]] = {}
    for r in rows:
        dt = r["date_taken"]
        month_key = dt.strftime("%Y-%m") if hasattr(dt, "strftime") else str(dt)[:7]
        months_dict.setdefault(month_key, [])
        months_dict[month_key].append({
            "photo_id": r["photo_id"],
            "thumb_url": r["thumb_url"],
            "flickr_url": r["flickr_url"] or "",
            "photo_title": r["photo_title"] or "",
            "photo_url": r["photo_url"] or "",
            "date_taken": str(r["date_taken"]),
        })

    months = [
        {"month": m, "count": len(photos), "photos": photos}
        for m, photos in sorted(months_dict.items(), reverse=True)
    ]
    result = {"months": months}
    set_cached("timeline", result)
    return result


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
    rows = db_query("SELECT * FROM photo_metadata WHERE photo_id = %s", (photo_id,))
    if not rows:
        raise HTTPException(404, "Metadata not found for this photo")
    row = dict(rows[0])
    # Convert datetime fields to strings for JSON serialization
    for key in ("date_taken", "created_at"):
        if row.get(key) is not None:
            row[key] = str(row[key])
    return row


# ── Photo detections & manual tagging ─────────────────────────────────────────


@app.get("/photos/{photo_id}/detections")
def get_photo_detections(photo_id: str):
    """Return all detections for a photo with their cluster assignments."""
    rows = db_query("""
        SELECT d.id, d.category, d.subtype, d.bbox, d.det_score, d.chip,
               dc.cluster_id, c.label as cluster_label
        FROM detections d
        LEFT JOIN detection_clusters dc ON dc.detection_id = d.id
        LEFT JOIN clusters c ON c.id = dc.cluster_id AND c.category = dc.category
        WHERE d.photo_id = %s
        ORDER BY d.det_score DESC
    """, (photo_id,))
    # Also get photo info from any detection
    photo_info = db_query("""
        SELECT photo_url, thumb_url, flickr_url, photo_title, owner
        FROM detections WHERE photo_id = %s LIMIT 1
    """, (photo_id,))
    photo = dict(photo_info[0]) if photo_info else {}
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

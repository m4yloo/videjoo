from fastapi import FastAPI, APIRouter, Query, Request, HTTPException
from fastapi.responses import Response, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
import re
from urllib.parse import urlparse, urljoin, quote, unquote
from datetime import datetime, timezone
import httpx


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")  # Ignore MongoDB's _id field
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.model_dump()
    status_obj = StatusCheck(**status_dict)
    
    # Convert to dict and serialize datetime to ISO string for MongoDB
    doc = status_obj.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    
    _ = await db.status_checks.insert_one(doc)
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    # Exclude MongoDB's _id field from the query results
    status_checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    
    # Convert ISO string timestamps back to datetime objects
    for check in status_checks:
        if isinstance(check['timestamp'], str):
            check['timestamp'] = datetime.fromisoformat(check['timestamp'])
    
    return status_checks


# ---------- HLS / Media Proxy ----------
# Some streaming origins (e.g. aether.cx, aether.bar) require a specific Referer
# header and refuse cross-origin browser requests. This proxy fetches the asset
# server-side with the right headers, and (for HLS playlists) rewrites inner
# URIs so segments are also fetched through the proxy.

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

def _derive_referer(target_url: str) -> str:
    """Use same-origin Referer for the target host (required by aether.* gateways)."""
    try:
        parsed = urlparse(target_url)
    except Exception:
        return ""
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}/"
    return ""


def _is_playlist(url: str, content_type: str) -> bool:
    ct = (content_type or "").lower()
    if "mpegurl" in ct or "x-mpegurl" in ct:
        return True
    path = urlparse(url).path.lower()
    return path.endswith(".m3u8") or path.endswith(".m3u")


def _proxy_uri(absolute_url: str, ref: str) -> str:
    return f"/api/proxy?url={quote(absolute_url, safe='')}&ref={quote(ref, safe='')}"


_URI_ATTR_RE = re.compile(r'URI="([^"]+)"')


def _rewrite_playlist(text: str, base_url: str, ref: str) -> str:
    out_lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            out_lines.append(raw)
            continue
        if line.startswith("#"):
            # Rewrite URI="..." attributes inside tags (e.g. EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA)
            def _sub(m):
                uri = m.group(1)
                absolute = urljoin(base_url, uri)
                segment_ref = _derive_referer(absolute) or ref
                return f'URI="{_proxy_uri(absolute, segment_ref)}"'
            out_lines.append(_URI_ATTR_RE.sub(_sub, raw))
        else:
            absolute = urljoin(base_url, line)
            segment_ref = _derive_referer(absolute) or ref
            out_lines.append(_proxy_uri(absolute, segment_ref))
    return "\n".join(out_lines) + "\n"


@api_router.get("/proxy")
async def proxy(
    request: Request,
    url: str = Query(..., description="Target URL to fetch"),
    ref: Optional[str] = Query(None, description="Referer override"),
):
    target = unquote(url)
    parsed = urlparse(target)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Invalid url")

    referer = ref if ref else _derive_referer(target)
    headers = {
        "User-Agent": UA,
        "Accept": "*/*",
    }
    if referer:
        headers["Referer"] = referer
    # Forward Range header for segment seeking
    range_header = request.headers.get("range")
    if range_header:
        headers["Range"] = range_header

    timeout = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)

    # First, do a quick GET (not stream) for playlists so we can rewrite.
    # We decide based on URL extension first; if it's not a playlist, we stream.
    looks_like_playlist = parsed.path.lower().endswith((".m3u8", ".m3u"))

    if looks_like_playlist:
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client_:
                r = await client_.get(target, headers=headers)
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Upstream error: {e}")
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=f"Upstream returned {r.status_code}")
        body = r.text
        stripped = body.lstrip()
        if not stripped.startswith("#EXTM3U"):
            preview = stripped[:200].replace("\n", " ")
            raise HTTPException(
                status_code=502,
                detail=f"Upstream returned invalid playlist: {preview}",
            )
        # Use the final URL (after redirects) as base for relative resolution
        base = str(r.url)
        rewritten = _rewrite_playlist(body, base, referer)
        return Response(
            content=rewritten,
            media_type="application/vnd.apple.mpegurl",
            headers={"Cache-Control": "no-store"},
        )

    # Otherwise, stream the body (segments, mp4, webm, etc.)
    client_ = httpx.AsyncClient(timeout=timeout, follow_redirects=True)
    try:
        req = client_.build_request("GET", target, headers=headers)
        upstream = await client_.send(req, stream=True)
    except httpx.HTTPError as e:
        await client_.aclose()
        raise HTTPException(status_code=502, detail=f"Upstream error: {e}")

    if upstream.status_code >= 400:
        status = upstream.status_code
        await upstream.aclose()
        await client_.aclose()
        raise HTTPException(status_code=status, detail=f"Upstream returned {status}")

    # Pass through select headers
    passthrough = {}
    for h in ("content-type", "content-length", "content-range", "accept-ranges", "cache-control", "last-modified", "etag"):
        v = upstream.headers.get(h)
        if v:
            passthrough[h] = v

    async def iter_bytes():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client_.aclose()

    return StreamingResponse(
        iter_bytes(),
        status_code=upstream.status_code,
        media_type=passthrough.get("content-type", "application/octet-stream"),
        headers=passthrough,
    )
# ---------- end proxy ----------


# ---------- /api/download : zip the /app source ----------
import io
import zipfile
import asyncio

APP_ROOT = Path("/app")
EXCLUDE_DIRS = {
    "node_modules", ".venv", "venv", ".git", "__pycache__",
    "build", "dist", ".next", ".cache", ".yarn", ".pytest_cache",
    ".mypy_cache", ".ruff_cache", "tmp", ".idea", ".vscode",
    "test_reports", "test_results", "automation_output",
}
EXCLUDE_SUFFIXES = {".pyc", ".pyo", ".log", ".lock", ".tsbuildinfo"}
MAX_FILE_BYTES = 5 * 1024 * 1024  # skip files > 5MB

def _build_zip_bytes() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, dirs, files in os.walk(APP_ROOT):
            # prune excluded dirs in-place
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
            for fname in files:
                if fname.startswith("."):
                    # still include some dotfiles we care about
                    if fname not in {".env.example", ".gitignore", ".eslintrc", ".prettierrc"}:
                        continue
                if any(fname.endswith(s) for s in EXCLUDE_SUFFIXES):
                    continue
                full = Path(root) / fname
                try:
                    if full.stat().st_size > MAX_FILE_BYTES:
                        continue
                except OSError:
                    continue
                arcname = full.relative_to(APP_ROOT.parent)  # so the zip extracts as "app/..."
                try:
                    zf.write(full, arcname)
                except (OSError, PermissionError):
                    continue
    return buf.getvalue()


@api_router.get("/download")
async def download_site():
    # Build zip in a thread so we don't block the event loop
    data = await asyncio.to_thread(_build_zip_bytes)
    filename = f"video-previewer-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.zip"
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(data)),
            "Cache-Control": "no-store",
        },
    )
# ---------- end download ----------

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
"""Vercel API entry point. NAS containers continue serving main:app."""
import os
from urllib.parse import quote

import httpx
from fastapi import FastAPI, Request
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.routing import Match

import main


CATALOG_ROUTES = {
    "/health", "/app-config", "/stats", "/locations", "/albums", "/albums/{reference}",
    "/favorites", "/favorites/count", "/photos/{photo_id}/favorite",
    "/library/photos", "/library/years", "/library/counts", "/library/day-labels",
    "/library/junk-settings",
    "/photos/{photo_id}/metadata", "/photos/{photo_id}/detections",
    "/photos/{photo_id}/image", "/photos/{photo_id}/local",
    "/clusters/named", "/clusters/{category}/summary", "/search",
}
READ_ONLY = {"GET", "HEAD"}
NAS_ORIGIN = os.environ.get("KINDRED_NAS_API_URL", "").rstrip("/")
REQUEST_HEADERS = {
    "accept", "authorization", "content-length", "content-type", "if-modified-since",
    "if-none-match", "if-range", "range", "user-agent", "x-api-key",
    "x-integration-secret", "x-session-token",
}
RESPONSE_HEADERS = {
    "accept-ranges", "content-disposition", "content-encoding", "content-length",
    "content-range", "content-type", "etag", "last-modified", "location", "retry-after",
    "x-content-type-options",
}


def supports_route(route):
    if not isinstance(route, APIRoute):
        return False
    if route.path.startswith("/auth/") or route.path in {
        "/photos/{photo_id}/favorite", "/library/junk-settings", "/photos/{photo_id}/keep-in-library",
    }:
        return True
    return route.path in CATALOG_ROUTES and route.methods <= READ_ONLY


app = FastAPI(title="Kindred Catalog API")
app.add_middleware(main.AuthMiddleware)
catalog_routes = [route for route in main.app.router.routes if supports_route(route)]
app.router.routes.extend(catalog_routes)


@app.middleware("http")
async def route_catalog_or_nas(request: Request, call_next):
    path, params = request.url.path, request.query_params
    photo_image = path.startswith("/photos/") and path.endswith("/image")
    photo_local = path.startswith("/photos/") and path.endswith("/local")
    thumbnail = request.method == "GET" and (
        photo_image and _thumbnail(params) or photo_local and params.get("variant") == "thumb"
    )
    requires_nas = (
        path == "/search" and params.get("mode") != "quick" and bool(params.get("q"))
        or (photo_image or photo_local) and not thumbnail
    )
    if not NAS_ORIGIN:
        if not requires_nas:
            return await call_next(request)
        return JSONResponse({"detail": "This operation uses the NAS media API"}, status_code=404)

    has_catalog_route = any(route.matches(request.scope)[0] == Match.FULL for route in catalog_routes)
    if not requires_nas and (has_catalog_route or path in {"/docs", "/openapi.json", "/redoc"}):
        response = await call_next(request)
        if not thumbnail or response.status_code not in {404, 422, 503}:
            return response
    return await proxy_to_nas(request)


async def proxy_to_nas(request):
    origin = httpx.URL(NAS_ORIGIN)
    if (
        origin.scheme != "https" or not origin.host or origin.host == request.url.hostname
        or origin.username or origin.password or origin.path != "/" or origin.query
    ):
        return JSONResponse({"detail": "NAS origin is unavailable"}, status_code=503)

    raw_path = request.scope.get("raw_path") or quote(request.url.path).encode("ascii")
    if raw_path.startswith(b"//"):
        return JSONResponse({"detail": "Invalid request path"}, status_code=400)
    query = request.scope.get("query_string", b"")
    url = origin.copy_with(raw_path=raw_path + (b"?" + query if query else b""))
    headers = {name: value for name, value in request.headers.items() if name in REQUEST_HEADERS}
    client = httpx.AsyncClient(timeout=httpx.Timeout(30, connect=5), follow_redirects=False)
    try:
        upstream = client.build_request(
            request.method, url, headers=headers,
            content=None if request.method in READ_ONLY else request.stream(),
        )
        response = await client.send(upstream, stream=True)
    except httpx.HTTPError:
        await client.aclose()
        return JSONResponse({"detail": "NAS origin is unavailable"}, status_code=502)

    async def stream():
        try:
            async for chunk in response.aiter_raw():
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    forwarded = {name: value for name, value in response.headers.items() if name in RESPONSE_HEADERS}
    forwarded["cache-control"] = "private, no-store"
    return StreamingResponse(stream(), response.status_code, headers=forwarded)


def _thumbnail(params):
    if params.get("size") == "o" or params.get("format", "auto") not in ("auto", "jpeg"):
        return False
    width = params.get("w")
    if width is None:
        return params.get("size") in {"s", "q", "t", "m", "n", "z"}
    return width in {"160", "320", "480", "640", "960"}

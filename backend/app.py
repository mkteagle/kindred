"""Vercel API entry point. NAS containers continue serving main:app."""
from fastapi import FastAPI, Request
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse

import main


CATALOG_ROUTES = {
    "/health", "/app-config", "/stats", "/locations", "/albums", "/albums/{reference}",
    "/favorites", "/favorites/count", "/photos/{photo_id}/favorite",
    "/library/photos", "/library/years", "/library/counts", "/library/day-labels",
    "/photos/{photo_id}/metadata", "/photos/{photo_id}/detections",
    "/photos/{photo_id}/image", "/photos/{photo_id}/local",
    "/clusters/named", "/clusters/{category}/summary", "/search",
}
READ_ONLY = {"GET", "HEAD"}


def supports_route(route):
    if not isinstance(route, APIRoute):
        return False
    if route.path.startswith("/auth/") or route.path == "/photos/{photo_id}/favorite":
        return True
    return route.path in CATALOG_ROUTES and route.methods <= READ_ONLY


app = FastAPI(title="Kindred Catalog API")
app.add_middleware(main.AuthMiddleware)
app.router.routes.extend(route for route in main.app.router.routes if supports_route(route))


@app.middleware("http")
async def require_nas_for_media_and_inference(request: Request, call_next):
    path, params = request.url.path, request.query_params
    requires_nas = (
        path == "/search" and params.get("mode") != "quick" and bool(params.get("q"))
        or path.startswith("/photos/") and path.endswith("/local") and params.get("variant") != "thumb"
        or path.startswith("/photos/") and path.endswith("/image") and not _thumbnail(params)
    )
    if requires_nas:
        return JSONResponse({"detail": "This operation uses the NAS media API"}, status_code=404)
    return await call_next(request)


def _thumbnail(params):
    if params.get("size") == "o" or params.get("format", "auto") not in ("auto", "jpeg"):
        return False
    width = params.get("w")
    if width is None:
        return params.get("size") in {"s", "q", "t", "m", "n", "z"}
    return width in {"160", "320", "480", "640", "960"}

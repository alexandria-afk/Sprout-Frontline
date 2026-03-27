import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse

# Routes that don't require an Authorization header
_PUBLIC_PATHS = {
    "/health",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/api/v1/auth/login",
}


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        # Add a unique request ID to every response
        request_id = str(uuid.uuid4())

        if request.url.path not in _PUBLIC_PATHS and request.method != "OPTIONS":
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return JSONResponse(
                    status_code=401,
                    content={"success": False, "message": "Authentication required", "errors": []},
                    headers={"X-Request-ID": request_id},
                )

        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

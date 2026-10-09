import logging
import time

from fastapi import FastAPI, Request

from app.errors import SECURITY_HEADERS, error_response

access_logger = logging.getLogger("chismoso.access")
error_logger = logging.getLogger("chismoso.errors")


def install_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def access_log_and_security_headers(request: Request, call_next):
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception as exc:
            # Converted here and not re-raised: the server would otherwise log the exception message
            # and traceback, which may carry request data. Log the type only.
            error_logger.error("unhandled_error type=%s", type(exc).__name__)
            response = error_response(500, "internal_error", "An internal error occurred.")
        for name, value in SECURITY_HEADERS.items():
            response.headers[name] = value
        # Route template only: never the concrete path, query, headers or body.
        route = request.scope.get("route")
        access_logger.info(
            "request method=%s route=%s status=%d duration_ms=%.1f",
            request.method,
            getattr(route, "path", "<unmatched>"),
            response.status_code,
            (time.perf_counter() - started) * 1000,
        )
        return response

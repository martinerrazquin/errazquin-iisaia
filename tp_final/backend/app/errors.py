from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


class AppError(Exception):
    """Application error rendered as the uniform envelope. Messages never contain submitted values."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code
        self.message = message


def authentication_required() -> AppError:
    return AppError(401, "authentication_required", "Authentication is required.")


def invalid_authentication() -> AppError:
    return AppError(401, "invalid_authentication", "The authentication token is invalid.")


def admin_access_required() -> AppError:
    return AppError(403, "admin_access_required", "Administrator access is required.")


def share_not_found() -> AppError:
    return AppError(404, "share_not_found", "Share not found.")


_GONE_MESSAGES = {
    "share_already_consumed": "This share has already been consumed.",
    "share_expired": "This share has expired.",
    "share_revoked": "This share has been revoked.",
    "share_payload_deleted": "This share's content is no longer available.",
}


def gone(code: str) -> AppError:
    return AppError(410, code, _GONE_MESSAGES[code])


def invalid_request(message: str = "The request is invalid.") -> AppError:
    return AppError(422, "invalid_request", message)


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
        headers=SECURITY_HEADERS,
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        return error_response(exc.status_code, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Never include exc.errors(): it echoes submitted values.
        return error_response(422, "invalid_request", "The request is invalid.")

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "invalid_request")
        return error_response(exc.status_code, code, "The request could not be processed.")

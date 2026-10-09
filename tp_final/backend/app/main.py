import logging

from fastapi import FastAPI
from sqlalchemy.orm import Session, sessionmaker

from app.auth import TokenVerifier
from app.config import Settings
from app.db import make_session_factory
from app.errors import install_error_handlers
from app.middleware import install_middleware


def _configure_logging() -> None:
    app_logger = logging.getLogger("chismoso")
    if not app_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        app_logger.addHandler(handler)
    app_logger.setLevel(logging.INFO)
    # Never emit SQL statements/parameters, even if the root logger is lowered.
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)


def create_app(
    settings: Settings | None = None,
    *,
    session_factory: sessionmaker[Session] | None = None,
    verifier: TokenVerifier | None = None,
) -> FastAPI:
    settings = settings or Settings()
    _configure_logging()
    app = FastAPI(title="Chismoso", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.session_factory = session_factory or make_session_factory(settings.database_url)
    app.state.verifier = verifier or TokenVerifier(settings)
    install_error_handlers(app)
    install_middleware(app)
    return app

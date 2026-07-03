from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,       # tự kiểm tra kết nối trước mỗi query
    pool_size=10,
    max_overflow=20,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency — yields a DB session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def set_rls_user(db: Session, user_uuid: str) -> None:
    """
    Set the PostgreSQL session variable used by RLS policies.

    Uses a bound parameter (prepared statement) — never string-interpolated.
    SET LOCAL scopes the variable to the current transaction; it resets
    automatically when the transaction ends or the connection is returned to
    the pool.

    Must be called after auth is verified and before any user-scoped query.
    No-op on SQLite (dev mode without PostgreSQL).
    """
    try:
        # Bind param prevents injection; SET LOCAL is transaction-scoped.
        db.execute(
            text("SELECT set_config('app.current_user_uuid', :uuid, true)"),
            {"uuid": user_uuid},
        )
    except Exception:
        # Silently ignore on non-PostgreSQL (e.g. SQLite in tests).
        pass

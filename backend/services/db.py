"""
Shared PostgreSQL connection pool for the FastAPI backend.
Replaces the Supabase Python client for all direct database access.

Usage in route handlers:
    from services.db import get_db, row, rows, execute, execute_returning

Usage as FastAPI dependency:
    from dependencies import get_db
    async def my_route(db=Depends(get_db)):
        with db.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM issues WHERE id = %s", (issue_id,))
            return cur.fetchone()
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Generator, Optional

import psycopg2
import psycopg2.extras
import psycopg2.pool
from psycopg2.extras import RealDictCursor, RealDictRow

from config import settings

_log = logging.getLogger(__name__)

# ── Connection pool ───────────────────────────────────────────────────────────
# Created lazily on first use; reused across requests.
_pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=20,
            dsn=settings.database_url,
        )
    return _pool


# ── FastAPI dependency ────────────────────────────────────────────────────────

def get_db_conn():
    """
    FastAPI dependency that yields a pooled psycopg2 connection.
    Commits on success, rolls back on exception, returns connection to pool.

    Usage:
        from services.db import get_db_conn
        router.get("/items")
        def list_items(conn=Depends(get_db_conn)):
            ...
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


# ── Convenience helpers ───────────────────────────────────────────────────────

def row(conn, sql: str, params: tuple = ()) -> Optional[RealDictRow]:
    """Execute *sql* and return the first row as a dict, or None."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def rows(conn, sql: str, params: tuple = ()) -> list[RealDictRow]:
    """Execute *sql* and return all rows as a list of dicts."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql, params)
        return cur.fetchall() or []


def execute(conn, sql: str, params: tuple = ()) -> int:
    """Execute *sql* (INSERT/UPDATE/DELETE) and return rowcount."""
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.rowcount


def execute_returning(conn, sql: str, params: tuple = ()) -> Optional[RealDictRow]:
    """Execute *sql* with RETURNING clause and return first result row."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def execute_many(conn, sql: str, param_list: list[tuple]) -> int:
    """Execute *sql* for each parameter tuple; returns total rowcount."""
    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, sql, param_list)
        return cur.rowcount

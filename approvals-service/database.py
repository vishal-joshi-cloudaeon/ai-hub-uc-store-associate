"""
Thin wrapper around databricks-sql-connector for the approvals service —
now dual-environment: dev and prod are two entirely separate Databricks
workspaces, each with its own OAuth service principal.

Auth is Azure AD service-principal client-credentials OAuth per environment
(not a static PAT): a background thread fetches a token for each *configured*
environment at startup and proactively refreshes it before it expires.
`_get_access_token` is a lazy fallback so a request never fails just because
that thread hasn't run yet or died. An unconfigured environment (e.g. prod,
before its credentials are supplied) is simply skipped at startup rather
than blocking the other environment from working.

Every request opens and closes its own SQL warehouse connection.
"""

import logging
import os
import threading
import time
from contextlib import contextmanager
from typing import Any, Literal, Optional

import requests
from databricks import sql

logger = logging.getLogger("approvals_service.database")

EnvName = Literal["dev", "prod"]


def _clean_host(raw: str) -> str:
    return raw.replace("https://", "").replace("http://", "").rstrip("/")


def _env_config(env: str) -> dict[str, str]:
    suffix = env.upper()
    return {
        "hostname": _clean_host(os.environ.get(f"DATABRICKS_SERVER_HOSTNAME_{suffix}", "")),
        "http_path": os.environ.get(f"DATABRICKS_HTTP_PATH_{suffix}", ""),
        "client_id": os.environ.get(f"DATABRICKS_CLIENT_ID_{suffix}", ""),
        "client_secret": os.environ.get(f"DATABRICKS_CLIENT_SECRET_{suffix}", ""),
    }


DB_CONFIG: dict[str, dict[str, str]] = {
    "dev": _env_config("dev"),
    "prod": _env_config("prod"),
}

TOKEN_REFRESH_SKEW_SECONDS = 60

_token_lock = threading.Lock()
_token_cache: dict[str, dict[str, Any]] = {}  # env -> {"token": str, "expires_at": float}


def _is_configured(env: str) -> bool:
    config = DB_CONFIG.get(env)
    return bool(config and all(config.values()))


def _require_config(env: str) -> dict[str, str]:
    config = DB_CONFIG.get(env)
    if config is None:
        raise RuntimeError(f"Unknown environment '{env}'. Must be 'dev' or 'prod'.")
    if not all(config.values()):
        missing = [k for k, v in config.items() if not v]
        raise RuntimeError(
            f"Databricks connection for env='{env}' is not configured (missing: "
            f"{', '.join(missing)}). Set DATABRICKS_*_{env.upper()} in approvals-service/.env."
        )
    return config


def _fetch_new_token(env: str) -> tuple[str, float]:
    config = _require_config(env)
    token_url = f"https://{config['hostname']}/oidc/v1/token"
    response = requests.post(
        token_url,
        data={
            "grant_type": "client_credentials",
            "client_id": config["client_id"],
            "client_secret": config["client_secret"],
            "scope": "all-apis",
        },
        timeout=15,
    )
    response.raise_for_status()
    payload = response.json()
    return payload["access_token"], time.time() + payload.get("expires_in", 3600)


def _refresh_now(env: str) -> str:
    with _token_lock:
        token, expires_at = _fetch_new_token(env)
        _token_cache[env] = {"token": token, "expires_at": expires_at}
        logger.info(
            "Databricks OAuth token refreshed for env=%s, expires in %.0fs",
            env,
            expires_at - time.time(),
        )
        return token


def _get_access_token(env: str) -> str:
    cached = _token_cache.get(env)
    if cached and time.time() < cached["expires_at"] - TOKEN_REFRESH_SKEW_SECONDS:
        return cached["token"]
    return _refresh_now(env)


def start_token_refresh_thread() -> None:
    """Fetch a token for every *configured* environment at startup (fails
    fast on bad credentials for that environment), then keep refreshing each
    in the background before it expires. An unconfigured environment (e.g.
    prod, before real credentials exist) is skipped, not fatal."""

    configured_envs = [env for env in DB_CONFIG if _is_configured(env)]
    if not configured_envs:
        raise RuntimeError(
            "No environment is fully configured — check approvals-service/.env "
            "(need DATABRICKS_*_DEV at minimum)"
        )
    logger.info("Databricks environments configured at startup: %s", ", ".join(configured_envs))

    for env in configured_envs:
        _refresh_now(env)

    def _loop(env: str) -> None:
        while True:
            cached = _token_cache[env]
            sleep_for = max(cached["expires_at"] - time.time() - TOKEN_REFRESH_SKEW_SECONDS, 5)
            time.sleep(sleep_for)
            try:
                _refresh_now(env)
            except Exception:
                logger.exception(
                    "Failed to refresh Databricks OAuth token for env=%s; will retry shortly", env
                )
                time.sleep(10)

    for env in configured_envs:
        thread = threading.Thread(
            target=_loop, args=(env,), name=f"databricks-token-refresh-{env}", daemon=True
        )
        thread.start()


@contextmanager
def get_connection(env: str = "dev"):
    config = _require_config(env)
    access_token = _get_access_token(env)
    conn = sql.connect(
        server_hostname=config["hostname"],
        http_path=config["http_path"],
        access_token=access_token,
    )
    try:
        yield conn
    finally:
        conn.close()


def query(sql_text: str, params: Optional[dict[str, Any]] = None, env: str = "dev") -> list[dict[str, Any]]:
    """Run a SELECT and return rows as a list of column-name -> value dicts."""
    with get_connection(env) as conn:
        with conn.cursor() as cursor:
            cursor.execute(sql_text, params or {})
            columns = [c[0] for c in cursor.description]
            rows = cursor.fetchall()
            return [dict(zip(columns, row)) for row in rows]


def execute(sql_text: str, params: Optional[dict[str, Any]] = None, env: str = "dev") -> None:
    """Run an INSERT/UPDATE statement with no result set expected."""
    with get_connection(env) as conn:
        with conn.cursor() as cursor:
            cursor.execute(sql_text, params or {})

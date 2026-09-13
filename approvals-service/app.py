import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()  # local dev only — Databricks Apps injects real env vars directly

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from database import start_token_refresh_thread  # noqa: E402
from routers import approvals, tools  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_token_refresh_thread()
    yield


app = FastAPI(title="Loyalty Approvals Service", lifespan=lifespan)

cors_origin = os.environ.get("CORS_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[cors_origin],
    allow_methods=["GET", "PATCH", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(approvals.router)
app.include_router(tools.router)


@app.get("/healthz")
def healthz():
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("DATABRICKS_APP_PORT") or os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

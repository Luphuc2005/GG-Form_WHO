"""Run durable Sheet and export queues separately from web API processes."""
import asyncio
import logging
import os
import sys
import tempfile
import time
from pathlib import Path
import app.models  # Register models without starting the web application.
from app.database import SessionLocal
from app.services.deployment_checks import verify_current_schema
from app.services.record_sync import sync_loop
from app.services.export_jobs import export_loop

HEARTBEAT = Path(os.environ.get("WORKER_HEARTBEAT_PATH", str(Path(tempfile.gettempdir()) / "who-worker-heartbeat")))


def heartbeat():
    with SessionLocal() as db:
        verify_current_schema(db)
    HEARTBEAT.write_text(str(time.time()), encoding="ascii")


async def heartbeat_loop():
    while True:
        try:
            await asyncio.to_thread(heartbeat)
        except Exception:
            logging.getLogger("worker").warning("Worker database check unavailable; retrying.")
        await asyncio.sleep(15)


async def main():
    await asyncio.gather(sync_loop(), export_loop(), heartbeat_loop())


if __name__ == "__main__":
    if "--healthcheck" in sys.argv:
        try:
            sys.exit(0 if time.time()-float(HEARTBEAT.read_text(encoding="ascii")) < 90 else 1)
        except (OSError, ValueError):
            sys.exit(1)
    logging.basicConfig(level=logging.INFO)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

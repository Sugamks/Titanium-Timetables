import os
import threading
import time

from fastapi import APIRouter, HTTPException

from app.updates import UpdateError, install_available_update, launch_helper, public_status

router = APIRouter(tags=["updates"])
_install_lock = threading.Lock()


def _exit_later() -> None:
    time.sleep(1.2)
    os._exit(0)


@router.get("/v1/app/update")
def read_update():
    return public_status()


@router.post("/v1/app/update/install")
def install_update():
    if not _install_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="An update is already installing")
    try:
        staged = install_available_update()
        launch_helper(staged)
    except UpdateError as exc:
        _install_lock.release()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception:
        _install_lock.release()
        raise
    threading.Thread(target=_exit_later, daemon=True).start()
    return {"ok": True, "restarting": True}

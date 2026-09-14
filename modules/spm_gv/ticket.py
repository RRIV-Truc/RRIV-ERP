# -*- coding: utf-8 -*-
"""Short-lived HMAC tickets so hub can open Cloudflare Pages without trusting username headers."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import uuid


def _secret() -> bytes:
    raw = (
        os.getenv("SPM_GV_TICKET_SECRET")
        or os.getenv("SECRET_KEY")
        or "rriv-spm-gv-ticket-dev"
    ).strip()
    return raw.encode("utf-8")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def issue_ticket(username: str, extra: dict | None = None, ttl_sec: int = 60) -> str:
    payload = {
        "u": str(username or "").strip().lower(),
        "exp": int(time.time()) + int(ttl_sec),
        "jti": uuid.uuid4().hex[:12],
    }
    if extra:
        payload.update(extra)
    body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()[:32]
    return body + "." + sig


def verify_ticket(token: str) -> dict | None:
    raw = str(token or "").strip()
    if "." not in raw:
        return None
    body, sig = raw.rsplit(".", 1)
    expect = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(expect, sig):
        return None
    try:
        payload = json.loads(_unb64(body).decode("utf-8"))
    except Exception:
        return None
    if int(payload.get("exp") or 0) < int(time.time()):
        return None
    if not payload.get("u"):
        return None
    return payload


def issue_session(username: str, ttl_sec: int = 8 * 3600) -> str:
    return issue_ticket(username, {"kind": "session"}, ttl_sec=ttl_sec)


def verify_session(token: str) -> dict | None:
    payload = verify_ticket(token)
    if not payload:
        return None
    if payload.get("kind") != "session":
        return None
    return payload

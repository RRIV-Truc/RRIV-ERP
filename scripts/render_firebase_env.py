#!/usr/bin/env python3
"""In giá trị FIREBASE_SERVICE_ACCOUNT (một dòng) hoặc B64 để dán lên Render."""

from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_dotenv() -> None:
    try:
        from dotenv import load_dotenv as _load

        _load(ROOT / '.env')
    except ImportError:
        pass


def main() -> None:
    load_dotenv()
    path = (os.getenv('FIREBASE_SERVICE_ACCOUNT_PATH') or '').strip()
    if path and not os.path.isabs(path):
        path = str(ROOT / path)
    raw = (os.getenv('FIREBASE_SERVICE_ACCOUNT') or '').strip()

    if path and os.path.isfile(path):
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
    elif raw:
        data = json.loads(raw)
    else:
        print(
            'Thiếu FIREBASE_SERVICE_ACCOUNT_PATH hoặc FIREBASE_SERVICE_ACCOUNT trong .env',
            file=sys.stderr,
        )
        sys.exit(1)

    one_line = json.dumps(data, separators=(',', ':'))
    b64 = base64.b64encode(one_line.encode('utf-8')).decode('ascii')

    print('=== Dan vao Render -> FIREBASE_SERVICE_ACCOUNT (mot dong) ===')
    print(one_line)
    print()
    print('=== Hoac FIREBASE_SERVICE_ACCOUNT_B64 (neu JSON dai / loi format) ===')
    print(b64)


if __name__ == '__main__':
    main()

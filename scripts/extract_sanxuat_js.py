#!/usr/bin/env python3
"""Tách inline JS từ templates/sanxuat.html ra file riêng."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / 'templates' / 'sanxuat.html'
DIALOG_JS = ROOT / 'static' / 'js' / 'sanxuat' / 'sanxuat-dialog.js'
APP_JS = ROOT / 'static' / 'js' / 'sanxuat' / 'sanxuat-app.js'

lines = HTML.read_text(encoding='utf-8').splitlines(keepends=True)

dialog_start, dialog_end = 3923, 3999   # 0-based: line after <script> through before </script>
app_start, app_end = 4035, 14924

dialog_body = ''.join(lines[dialog_start:dialog_end])
app_body = ''.join(lines[app_start:app_end])

DIALOG_JS.parent.mkdir(parents=True, exist_ok=True)
DIALOG_JS.write_text('/* sanxuat-dialog.js — custom confirm/alert */\n' + dialog_body, encoding='utf-8')
APP_JS.write_text('/* sanxuat-app.js — shell ứng dụng Sản xuất */\n' + app_body, encoding='utf-8')

new_lines = (
    lines[:3923]
    + ['<script src="/static/js/sanxuat/sanxuat-dialog.js?v=1"></script>\n']
    + lines[4000:4035]
    + ['<script src="/static/js/sanxuat/sanxuat-app.js?v=1"></script>\n']
    + lines[14925:]
)
HTML.write_text(''.join(new_lines), encoding='utf-8')
print(f'Dialog: {len(dialog_body.splitlines())} lines -> {DIALOG_JS.name}')
print(f'App: {len(app_body.splitlines())} lines -> {APP_JS.name}')
print(f'HTML: {len(new_lines)} lines (was {len(lines)})')

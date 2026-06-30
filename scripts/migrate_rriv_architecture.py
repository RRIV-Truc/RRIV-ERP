"""Chuyển mã Phước Hòa sang kiến trúc RRIV/Supabase — loại bỏ Firebase."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "templates"
STATIC_JS = ROOT / "static" / "js"
SKIP_HTML = {"index.html"}

RRIV_BLOCK_RE = re.compile(
    r"<!--\s*RRIV:.*?-->\s*"
    r"(?:<script\s+src=\"/static/js/[^\"]+\"></script>\s*)+",
    re.DOTALL | re.IGNORECASE,
)

INCLUDE = "{% include 'includes/rriv_core.html' %}\n"


def patch_text(text: str, is_html: bool) -> str:
    text = text.replace("firebase-shim.js", "ErpDb.js")
    text = text.replace("/static/js/services/ErpDb.js", "/static/js/services/ErpDb.js")
    text = text.replace("firebase-modular-shim.mjs", "erp-modular-shim.mjs")
    text = re.sub(r"https://www\.gstatic\.com/firebasejs/[^\s\"']+", "/static/js/erp-modular-shim.mjs", text)
    text = text.replace("firebase.", "ErpDb.")
    text = text.replace("firebaseConfig", "erpDbConfig")
    text = RRIV_BLOCK_RE.sub("", text)

    if is_html and "includes/rriv_core" not in text:
        text = re.sub(r"(<head[^>]*>)", r"\1\n" + INCLUDE, text, count=1, flags=re.I)

    if is_html:
        text = text.replace('src="js/', 'src="/static/js/')
        text = text.replace("src='js/", "src='/static/js/")
        text = text.replace('href="css/', 'href="/static/css/')
        text = text.replace("href='css/", "href='/static/css/")

    return text


def main():
    changed = []
    for path in list(TEMPLATES.glob("*.html")) + list(STATIC_JS.rglob("*.js")) + list(STATIC_JS.rglob("*.mjs")):
        if path.name in SKIP_HTML:
            continue
        if "includes" in path.parts:
            continue
        original = path.read_text(encoding="utf-8")
        updated = patch_text(original, path.suffix == ".html")
        if updated != original:
            path.write_text(updated, encoding="utf-8")
            changed.append(str(path.relative_to(ROOT)))
    print("Patched", len(changed), "files")
    for c in changed[:30]:
        print(" -", c)
    if len(changed) > 30:
        print(" ...")


if __name__ == "__main__":
    main()

#!/usr/bin/env bash
# Hướng dẫn deploy RRIV-ERP lên Render.com
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== RRIV-ERP — Deploy lên Render ==="
echo ""

if [ ! -f .env ]; then
  echo "Cần file .env với SUPABASE_URL và SUPABASE_KEY"
  exit 1
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Chưa có git — đang khởi tạo..."
  git init
  git branch -M main
fi

if ! git diff --cached --quiet 2>/dev/null || [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "$(cat <<'EOF'
Prepare Render deployment for RRIV-ERP Flask app.

EOF
)" || true
fi

echo ""
echo "Bước tiếp theo (làm trên trình duyệt):"
echo ""
echo "1. Đẩy code lên GitHub:"
echo "   - Tạo repo mới: https://github.com/new (tên: rriv-erp)"
echo "   - Chạy trong thư mục dự án:"
echo "     git remote add origin https://github.com/<tên-github>/rriv-erp.git"
echo "     git push -u origin main"
echo ""
echo "2. Deploy trên Render:"
echo "   - Vào https://dashboard.render.com/blueprints"
echo "   - New Blueprint Instance → chọn repo GitHub vừa push"
echo "   - Render đọc file render.yaml tự động"
echo ""
echo "3. Nhập biến môi trường khi Render hỏi (copy từ file .env):"
echo "   - SUPABASE_URL"
echo "   - SUPABASE_KEY"
echo "   - EMAIL_SENDER (nếu dùng OTP)"
echo "   - EMAIL_PASSWORD (nếu dùng OTP)"
echo ""
echo "4. Sau khi deploy xong, mở URL dạng: https://rriv-erp.onrender.com"
echo ""

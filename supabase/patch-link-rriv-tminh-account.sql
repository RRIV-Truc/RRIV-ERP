-- Liên kết tài khoản rriv.tminh với hồ sơ nhân sự rriv.tminh2 (cùng người, đã gán quyền Sản xuất)
-- Chạy trên Supabase SQL Editor nếu đăng nhập rriv.tminh nhưng không có quyền cân mủ.

UPDATE user_accounts
SET employee_id = 'ddaa794f-4748-4862-84c3-1cceb073e21e'
WHERE username = 'rriv.tminh'
  AND (employee_id IS NULL OR employee_id <> 'ddaa794f-4748-4862-84c3-1cceb073e21e');

-- (Tuỳ chọn) Đồng bộ username trên hồ sơ nếu muốn một tài khoản duy nhất:
-- UPDATE category_personnel SET username = 'rriv.tminh' WHERE id = 'ddaa794f-4748-4862-84c3-1cceb073e21e';

import os
import uuid
import random
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta

from flask import Flask, render_template, request, jsonify, abort, send_from_directory, redirect
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

EMAIL_SENDER = os.getenv("EMAIL_SENDER")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
MAPBOX_TOKEN = os.getenv("MAPBOX_TOKEN", "")
VOICERSS_API_KEY = os.getenv("VOICERSS_API_KEY", "")
RESPONSIVEVOICE_KEY = os.getenv("RESPONSIVEVOICE_KEY", "")


@app.context_processor
def inject_runtime_config():
    return {
        "openweather_api_key": OPENWEATHER_API_KEY,
        "mapbox_token": MAPBOX_TOKEN,
        "voicerss_api_key": VOICERSS_API_KEY,
        "responsivevoice_key": RESPONSIVEVOICE_KEY,
    }

OTP_SESSIONS = {}

VALID_APPS = [
    'vanphongpham', 'doanhnghiep', 'dieuhanhxe', 'vanbannoibo', 'nhansu',
    'dautu', 'diemdanh', 'vuoncay', 'sanxuat', 'chatluong', 'thoitiet',
    'baocao', 'thongbao', 'phanquyen'
]

PHUOC_HOA_FILES = {
    'vanphongpham': 'app-vpp.html',
    'doanhnghiep': 'app-baocao.html',
    'dieuhanhxe': 'app-dieuxe.html',
    'vanbannoibo': 'app-vanban.html',
    'nhansu': 'app-nhansu.html',
    'dautu': 'app-dautuxdcb.html',
    'diemdanh': 'app-diemdanh.html',
    'vuoncay': 'app-vuoncay.html',
    'sanxuat': 'app-sanxuat.html',
    'chatluong': 'app-chatluong.html',
    'thoitiet': 'app-thoitiet.html',
    'baocao': 'app-bctm.html',
    'thongbao': 'app-thongbao.html',
    'phanquyen': 'app-admin-roles.html',
}

APP_TITLES = {
    'vanphongpham': 'Quản Lý Văn Phòng Phẩm',
    'doanhnghiep': 'Quản Trị Doanh Nghiệp',
    'dieuhanhxe': 'Điều Hành Xe',
    'vanbannoibo': 'Văn Bản Nội Bộ',
    'nhansu': 'Quản Lý Nhân Sự',
    'dautu': 'Quản Lý Đầu Tư XDCB',
    'diemdanh': 'Điểm Danh & Kiểm Soát',
    'vuoncay': 'Quản Lý Vườn Cây',
    'sanxuat': 'Quản Lý Sản Xuất',
    'chatluong': 'Quản Lý Chất Lượng',
    'thoitiet': 'Dự Báo Thời Tiết',
    'baocao': 'Báo Cáo Thông Minh',
    'thongbao': 'Quản Lý Thông Báo',
    'phanquyen': 'Quản Lý Phân Quyền',
}

# URL /app/<tên> → file template thực tế (tên có thể khác URL)
APP_TEMPLATES = {
    'vanphongpham': 'vanphongpham.html',
    'dieuhanhxe': 'dieuxe.html',
    'vanbannoibo': 'vanbannoibo.html',
    'nhansu': 'nhansu.html',
    'dautu': 'dautu.html',
    'diemdanh': 'diemdanh.html',
    'vuoncay': 'vuoncay.html',
    'sanxuat': 'sanxuat.html',
    'chatluong': 'chatluong.html',
    'thoitiet': 'thoitiet.html',
    'baocao': 'baocao.html',
    'thongbao': 'thongbao.html',
    'phanquyen': 'phanquyen.html',
    'doanhnghiep': 'doanhnghiep.html',
}

# Firestore collection name → bảng Supabase chuyên biệt (nếu có)
TABLE_MAP = {
    'categoryPersonnel': 'category_personnel',  # VIEW → employee (sau migrate-employee-master.sql)
    'employee': 'employee',
    'categoryDepartments': 'category_departments',
    'categoryPositions': 'category_positions',
    'categoryTeams': 'category_teams',
    'workGroups': 'work_groups',
    'rubberLots': 'rubber_lots',
    'vProductionWorkforce': 'v_production_workforce',
    'vTappingSections': 'v_tapping_sections',
    'vTappingSectionRoster': 'v_tapping_section_roster',
    'categoryFactories': 'category_factories',
    'appPermissions': 'app_permissions',
    'roleDefinitions': 'role_definitions',
    'userRoles': 'user_roles',
    'tappingSections': 'tapping_sections',
    'sectionWorkerAssignments': 'section_worker_assignments',
    'fieldWorkerWeighings': 'field_worker_weighings',
    'tscDrcConversion': 'tsc_drc_conversion',
}


def record_login_history(username, status, req):
    try:
        ip_addr = req.headers.get('X-Forwarded-For', req.remote_addr)
        if ip_addr and ',' in ip_addr:
            ip_addr = ip_addr.split(',')[0].strip()
        supabase.table("login_history").insert({
            "username": username,
            "status": status,
            "ip_address": ip_addr
        }).execute()
    except Exception as e:
        print(f"Lỗi ghi log: {e}")


def send_otp_email(receiver_email, username, otp_code):
    try:
        msg = MIMEMultipart()
        msg['From'] = f"Hệ Thống RRIV <{EMAIL_SENDER}>"
        msg['To'] = receiver_email
        msg['Subject'] = f"🔑 [{otp_code}] - Mã xác thực đăng nhập"
        html = f"<h3>Xin chào {username},</h3><p>Mã OTP: <b>{otp_code}</b> (hiệu lực 2 phút).</p>"
        msg.attach(MIMEText(html, 'html', 'utf-8'))
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(EMAIL_SENDER, EMAIL_PASSWORD)
            server.sendmail(EMAIL_SENDER, receiver_email, msg.as_string())
        return True
    except Exception as e:
        print(f"Lỗi gửi email: {e}")
        return False


def _row_to_doc(row, use_data_field=True, table_name=None):
    """Chuyển row Supabase → document kiểu Firestore {id, ...fields}."""
    if not row:
        return None
    if use_data_field and 'data' in row and isinstance(row.get('data'), dict):
        doc = dict(row['data'])
        doc['id'] = row.get('id')
        if row.get('created_at'):
            doc['createdAt'] = row['created_at']
        if row.get('updated_at'):
            doc['updatedAt'] = row['updated_at']
        return doc
    doc = dict(row)
    doc_id = doc.pop('id', None)
    if doc_id:
        doc['id'] = doc_id
    if table_name == 'employee':
        _apply_employee_field_aliases(doc)
    return doc


def _apply_employee_field_aliases(doc):
    """Map cột employee → tên field app ERP (hoTen, ho_ten…)."""
    if doc.get('full_name') and not doc.get('ho_ten'):
        doc['ho_ten'] = doc['full_name']
        doc['hoTen'] = doc['full_name']
    if doc.get('phone_number') and not doc.get('phone'):
        doc['phone'] = doc['phone_number']
    if not doc.get('email'):
        doc['email'] = doc.get('company_email') or doc.get('personal_email')
    if doc.get('department_name') and not doc.get('department'):
        doc['department'] = doc['department_name']
    if doc.get('position_name') and not doc.get('position'):
        doc['position'] = doc['position_name']
    if doc.get('team_name') and not doc.get('team'):
        doc['team'] = doc['team_name']
    if doc.get('erp_role') and not doc.get('role'):
        doc['role'] = doc['erp_role']
    if doc.get('employment_status') and not doc.get('status'):
        doc['status'] = doc['employment_status']
    if doc.get('employee_code') and not doc.get('employeeCode'):
        doc['employeeCode'] = doc['employee_code']


def _apply_where(docs, where_list):
    result = docs
    for cond in where_list or []:
        if len(cond) != 3:
            continue
        field, op, value = cond
        if op == '==':
            result = [d for d in result if str(d.get(field, '')) == str(value)]
        elif op == '!=':
            result = [d for d in result if str(d.get(field, '')) != str(value)]
    return result


def _load_collection_docs(collection, where=None, order_by=None, order_dir='desc', limit=None):
    table = TABLE_MAP.get(collection)
    docs = []

    if table:
        res = supabase.table(table).select('*').execute()
        for row in res.data or []:
            doc = _row_to_doc(row, use_data_field=False, table_name=table)
            if doc:
                docs.append(doc)
    else:
        res = supabase.table('erp_collections').select('*').eq('collection', collection).execute()
        for row in res.data or []:
            doc = _row_to_doc(row, use_data_field=True)
            if doc:
                docs.append(doc)

    docs = _apply_where(docs, where)
    reverse = (order_dir or 'desc').lower() == 'desc'
    if order_by:
        docs.sort(key=lambda d: d.get(order_by) or '', reverse=reverse)
    else:
        docs.sort(key=lambda d: d.get('createdAt') or d.get('created_at') or '', reverse=True)

    if limit:
        docs = docs[: int(limit)]
    return docs


# File tĩnh gốc (app Phước Hòa dùng đường dẫn /logo.png, /manifest-*.json, …)
ROOT_STATIC_FILES = {
    'logo.png', 'favicon-32.png', 'icon-192.png', 'icon-512.png',
    'apple-touch-icon.png', 'manifest.json', 'offline.html',
    'sw.js', 'sw-erp.js', 'sw-diemdanh.js',
    'manifest-vuoncay.json', 'manifest-diemdanh.json', 'manifest-dieuxe.json',
}

ROOT_STATIC_MIME = {
    'manifest.json': 'application/manifest+json',
    'sw.js': 'application/javascript',
    'sw-erp.js': 'application/javascript',
    'sw-diemdanh.js': 'application/javascript',
}


@app.route('/index.html')
def index_html_redirect():
    """Mini-app Phước Hòa redirect về hub Flask sau đăng nhập."""
    return redirect('/')


@app.route('/<filename>')
def root_static_file(filename):
    """Phục vụ asset ở URL gốc — tránh 404 khi mở /app/<tên>."""
    if filename not in ROOT_STATIC_FILES and not (
        filename.startswith('manifest-') and filename.endswith('.json')
    ):
        abort(404)
    static_dir = os.path.join(app.root_path, 'static')
    if not os.path.isfile(os.path.join(static_dir, filename)):
        abort(404)
    mimetype = ROOT_STATIC_MIME.get(filename)
    if mimetype:
        return send_from_directory(static_dir, filename, mimetype=mimetype)
    return send_from_directory(static_dir, filename)


# ==================== ROUTES GIAO DIỆN ====================

@app.route('/')
def home():
    return render_template('index.html')


@app.route('/app/<app_name>')
def show_app(app_name):
    if app_name not in VALID_APPS:
        abort(404)

    template_name = APP_TEMPLATES.get(app_name, f'{app_name}.html')
    template_path = os.path.join(app.root_path, 'templates', template_name)
    if os.path.isfile(template_path):
        return render_template(template_name)

    return render_template(
        'app_shell.html',
        app_id=app_name,
        app_title=APP_TITLES.get(app_name, app_name),
        phuoc_hoa_file=PHUOC_HOA_FILES.get(app_name, 'app-*.html')
    )


# ==================== API ĐĂNG NHẬP ====================

@app.route('/api/login-password', methods=['POST'])
def login_password():
    data = request.json or {}
    username = data.get('username', '').strip().lower()
    password = data.get('password')

    try:
        res = supabase.table("user_login_view").select("*").eq("username", username).execute()
        if not res.data or res.data[0].get("password") != password:
            record_login_history(username, "failed_login", request)
            return jsonify({"success": False, "message": "Sai tài khoản hoặc mật khẩu!"}), 401

        user = res.data[0]
        record_login_history(username, "success_via_password", request)
        role = user.get("role", "user")
        is_super = bool(user.get("is_super_admin")) or role == "admin"
        return jsonify({
            "success": True,
            "user": {
                "username": username,
                "name": user.get("display_name") or user.get("ho_ten") or username,
                "id": user.get("personnel_id") or username,
                "role": role,
                "department": user.get("department", ""),
                "email": user.get("email") or f"{username}@rriv.org.vn",
                "systemRoles": user.get("system_roles") or [],
                "isSuperAdmin": is_super,
                "appRolesCache": user.get("app_roles_cache") or {}
            }
        })
    except Exception as e:
        print(e)
        return jsonify({"success": False, "message": "Lỗi kết nối database"}), 500


@app.route('/api/request-otp', methods=['POST'])
def request_otp():
    data = request.json or {}
    username = data.get('username', '').strip().lower()
    try:
        res = supabase.table("user_login_view").select("*").eq("username", username).execute()
        if not res.data:
            return jsonify({"success": False, "message": "Không tìm thấy tài khoản!"}), 404

        user = res.data[0]
        email = user.get("email")
        if not email:
            return jsonify({"success": False, "message": "Tài khoản chưa có email!"}), 400

        otp = f"{random.randint(100000, 999999)}"
        OTP_SESSIONS[username] = {"otp": otp, "expires": datetime.utcnow() + timedelta(minutes=2)}

        if not send_otp_email(email, username, otp):
            return jsonify({"success": False, "message": "Không gửi được email OTP!"}), 500

        masked = email[:2] + "***" + email[email.index('@'):]
        return jsonify({"success": True, "username": username, "email": masked})
    except Exception as e:
        print(e)
        return jsonify({"success": False, "message": "Lỗi hệ thống"}), 500


@app.route('/api/verify-login-otp', methods=['POST'])
def verify_login_otp():
    data = request.json or {}
    username = data.get('username', '').strip().lower()
    otp_code = data.get('otpCode', '').strip()

    session = OTP_SESSIONS.get(username)
    if not session or session['expires'] < datetime.utcnow():
        return jsonify({"success": False, "message": "OTP hết hạn hoặc chưa yêu cầu!"}), 401
    if session['otp'] != otp_code:
        record_login_history(username, "failed_otp", request)
        return jsonify({"success": False, "message": "Mã OTP không đúng!"}), 401

    del OTP_SESSIONS[username]
    try:
        res = supabase.table("user_login_view").select("*").eq("username", username).execute()
        user = res.data[0] if res.data else {}
        record_login_history(username, "success_via_otp", request)
        role = user.get("role", "user")
        is_super = bool(user.get("is_super_admin")) or role == "admin"
        return jsonify({
            "success": True,
            "user": {
                "username": username,
                "name": user.get("display_name") or user.get("ho_ten") or username,
                "id": user.get("personnel_id") or username,
                "role": role,
                "department": user.get("department", ""),
                "email": user.get("email") or f"{username}@rriv.org.vn",
                "systemRoles": user.get("system_roles") or [],
                "isSuperAdmin": is_super,
                "appRolesCache": user.get("app_roles_cache") or {}
            }
        })
    except Exception as e:
        print(e)
        return jsonify({"success": False, "message": "Lỗi hệ thống"}), 500


@app.route('/api/profile')
def get_profile():
    username = request.args.get('username', '').strip().lower()
    if not username:
        return jsonify({"profile": None}), 400
    try:
        res = supabase.table('category_personnel').select('*').eq('username', username).limit(1).execute()
        if res.data:
            return jsonify({"profile": _row_to_doc(res.data[0], use_data_field=False)})
        res_emp = supabase.table('employee').select('*').eq('username', username).limit(1).execute()
        if res_emp.data:
            return jsonify({"profile": _row_to_doc(res_emp.data[0], use_data_field=False, table_name='employee')})
        res2 = supabase.table('erp_collections').select('*').eq('collection', 'categoryPersonnel').execute()
        for row in res2.data or []:
            doc = _row_to_doc(row, use_data_field=True)
            if doc and doc.get('username') == username:
                return jsonify({"profile": doc})
        return jsonify({"profile": None})
    except Exception as e:
        print(e)
        return jsonify({"profile": None}), 500


# ==================== API DỮ LIỆU (thay Firestore) ====================

@app.route('/api/data/<collection>/query', methods=['POST'])
def query_collection(collection):
    body = request.json or {}
    try:
        docs = _load_collection_docs(
            collection,
            where=body.get('where'),
            order_by=body.get('orderBy'),
            order_dir=body.get('orderDir', 'desc'),
            limit=body.get('limit')
        )
        return jsonify({"success": True, "data": docs})
    except Exception as e:
        print(e)
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/data/<collection>/<doc_id>', methods=['GET'])
def get_document(collection, doc_id):
    try:
        table = TABLE_MAP.get(collection)
        if table:
            res = supabase.table(table).select('*').eq('id', doc_id).limit(1).execute()
            if res.data:
                return jsonify({"success": True, "data": _row_to_doc(res.data[0], use_data_field=False, table_name=table)})
        res = supabase.table('erp_collections').select('*').eq('collection', collection).eq('id', doc_id).limit(1).execute()
        if res.data:
            return jsonify({"success": True, "data": _row_to_doc(res.data[0], use_data_field=True)})
        return jsonify({"success": True, "data": None})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/data/<collection>', methods=['POST'])
def create_document(collection):
    body = request.json or {}
    data = body.get('data') or {}
    doc_id = body.get('id') or str(uuid.uuid4())
    username = data.get('createdBy') or 'system'

    try:
        table = TABLE_MAP.get(collection)
        if table:
            row = {'id': doc_id, **data}
            supabase.table(table).upsert(row).execute()
        else:
            supabase.table('erp_collections').insert({
                'id': doc_id,
                'collection': collection,
                'data': data,
                'created_by': username,
                'updated_by': username
            }).execute()
        return jsonify({"success": True, "id": doc_id})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/data/<collection>/<doc_id>', methods=['PATCH'])
def update_document(collection, doc_id):
    body = request.json or {}
    data = body.get('data') or {}
    try:
        table = TABLE_MAP.get(collection)
        if table:
            supabase.table(table).update(data).eq('id', doc_id).execute()
        else:
            existing = supabase.table('erp_collections').select('data').eq('collection', collection).eq('id', doc_id).limit(1).execute()
            merged = {}
            if existing.data:
                merged = dict(existing.data[0].get('data') or {})
            merged.update(data)
            supabase.table('erp_collections').update({'data': merged}).eq('id', doc_id).execute()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/data/<collection>/<doc_id>', methods=['DELETE'])
def delete_document(collection, doc_id):
    try:
        table = TABLE_MAP.get(collection)
        if table:
            supabase.table(table).delete().eq('id', doc_id).execute()
        else:
            supabase.table('erp_collections').delete().eq('collection', collection).eq('id', doc_id).execute()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/functions/<name>', methods=['POST'])
def cloud_function_stub(name):
    """Stub thay Cloud Functions Firebase — mở rộng từng function khi cần."""
    body = request.json or {}
    return jsonify({
        "success": False,
        "message": f"Function '{name}' chưa triển khai trên RRIV Flask",
        "received": body
    }), 501


@app.route('/api/data/batch', methods=['POST'])
def batch_write():
    body = request.json or {}
    for op in body.get('operations', []):
        coll = op.get('collection')
        doc_id = op.get('docId') or str(uuid.uuid4())
        op_type = op.get('type', 'create')
        if op_type == 'delete':
            table = TABLE_MAP.get(coll)
            if table:
                supabase.table(table).delete().eq('id', doc_id).execute()
            else:
                supabase.table('erp_collections').delete().eq('collection', coll).eq('id', doc_id).execute()
        elif op_type == 'update':
            data = op.get('data') or {}
            table = TABLE_MAP.get(coll)
            if table:
                supabase.table(table).update(data).eq('id', doc_id).execute()
            else:
                existing = supabase.table('erp_collections').select('data').eq('collection', coll).eq('id', doc_id).limit(1).execute()
                merged = dict(existing.data[0].get('data') or {}) if existing.data else {}
                merged.update(data)
                supabase.table('erp_collections').update({'data': merged}).eq('id', doc_id).execute()
        else:
            data = op.get('data') or {}
            table = TABLE_MAP.get(coll)
            if table:
                supabase.table(table).upsert({'id': doc_id, **data}).execute()
            else:
                supabase.table('erp_collections').insert({
                    'id': doc_id, 'collection': coll, 'data': data
                }).execute()
    return jsonify({"success": True})


if __name__ == '__main__':
    port = int(os.getenv('PORT', 8080))
    debug = os.getenv('FLASK_DEBUG', '1') == '1'
    app.run(debug=debug, host='0.0.0.0', port=port)

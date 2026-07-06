import os
import socket
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


@app.after_request
def _no_cache_html(response):
    ct = response.content_type or ''
    if 'text/html' in ct:
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    path = request.path or ''
    if '/static/js/sanxuat/tabs/' in path:
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
    return response

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
app.config['SUPABASE_CLIENT'] = supabase

from modules.meetings.routes import meetings_bp
app.register_blueprint(meetings_bp)

EMAIL_SENDER = os.getenv("EMAIL_SENDER")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
MAPBOX_TOKEN = os.getenv("MAPBOX_TOKEN", "")
VOICERSS_API_KEY = os.getenv("VOICERSS_API_KEY", "")
RESPONSIVEVOICE_KEY = os.getenv("RESPONSIVEVOICE_KEY", "")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
APP_PORT = int(os.getenv("PORT", 8080))


def _guess_lan_origin():
    """IP LAN để quét QR từ điện thoại khi dev (không dùng 127.0.0.1)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return f"http://{ip}:{APP_PORT}"
    except OSError:
        return ""


def _join_public_origin():
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    return _guess_lan_origin()


@app.context_processor
def inject_runtime_config():
    lan = _guess_lan_origin() if not PUBLIC_BASE_URL else ""
    return {
        "openweather_api_key": OPENWEATHER_API_KEY,
        "mapbox_token": MAPBOX_TOKEN,
        "voicerss_api_key": VOICERSS_API_KEY,
        "responsivevoice_key": RESPONSIVEVOICE_KEY,
        "erp_public_origin": PUBLIC_BASE_URL,
        "erp_lan_origin": lan,
        "erp_join_origin": _join_public_origin(),
    }


@app.route("/api/public-origin")
def api_public_origin():
    current = request.host_url.rstrip("/")
    configured = PUBLIC_BASE_URL or None
    lan = _guess_lan_origin() if not configured else None
    recommended = configured or lan or current
    host = (request.host or "").split(":")[0].lower()
    is_localhost = host in ("127.0.0.1", "localhost")
    return jsonify({
        "configured": configured,
        "current": current,
        "lan": lan,
        "recommended": recommended,
        "is_localhost": is_localhost,
    })

OTP_SESSIONS = {}

VALID_APPS = [
    'vanphongpham', 'doanhnghiep', 'dieuhanhxe', 'vanbannoibo', 'nhansu',
    'dautu', 'diemdanh', 'vuoncay', 'sanxuat', 'chatluong', 'thoitiet',
    'baocao', 'thongbao', 'phanquyen', 'phonghop'
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
    'phonghop': 'phonghop.html',
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
    'phonghop': 'Phòng Họp',
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
    'phonghop': 'phonghop.html',
}

# Firestore collection name → bảng Supabase chuyên biệt (nếu có)
TABLE_MAP = {
    'categoryPersonnel': 'employee',  # đọc/ghi trực tiếp — có department_id, team_id
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
    'rubberDeliveries': 'rubber_deliveries',
    'vRubberDeliveryDailyTotals': 'v_rubber_delivery_daily_totals',
    'vRubberDeliveryDailyByDate': 'v_rubber_delivery_daily_totals_by_date',
    'vRubberDeliveryDailyBySession': 'v_rubber_delivery_daily_totals_by_session',
    'vRubberDeliveryReceiptMetrics': 'v_rubber_delivery_receipt_metrics',
    'tscDrcConversion': 'tsc_drc_conversion',
    'employeePositions': 'employee_assignment',
    'meetings': 'meetings',
    'meetingParticipants': 'meeting_participants',
    'meetingRooms': 'meeting_rooms',
}

_RUBBER_DELIVERY_COLUMNS = frozenset({
    'id', 'delivery_no', 'team', 'grp', 'garden_id', 'garden_code',
    'material_type', 'grade', 'vehicle_no', 'gross_weight', 'drc_percent', 'dry_weight',
    'nh3_percent', 'ph_value', 'tapping_session', 'tapping_date',
    'plot_ids', 'plot_names', 'status', 'delivery_person', 'notes',
    'metadata', 'created_by', 'created_at', 'updated_at',
})

_RUBBER_DELIVERY_FIELD_MAP = {
    'deliveryNo': 'delivery_no',
    'team_id': 'team',
    'group': 'grp',
    'gardenId': 'garden_id',
    'gardenCode': 'garden_code',
    'materialType': 'material_type',
    'vehicleNo': 'vehicle_no',
    'grossWeight': 'gross_weight',
    'drcPercent': 'drc_percent',
    'dryWeight': 'dry_weight',
    'nh3Percent': 'nh3_percent',
    'phValue': 'ph_value',
    'tappingSession': 'tapping_session',
    'tappingDate': 'tapping_date',
    'tappingTime': 'tapping_date',
    'plotIds': 'plot_ids',
    'plotNames': 'plot_names',
    'deliveryPerson': 'delivery_person',
    'createdBy': 'created_by',
}

_FIELD_WEIGHING_COLUMNS = {
    'id', 'record_date', 'tapping_section_id', 'worker_id', 'session_no',
    'latex_fresh_kg', 'latex_tsc_pct', 'latex_drc_pct', 'latex_dry_kg',
    'coag_fresh_kg', 'coag_tsc_pct', 'coag_drc_pct', 'coag_dry_kg',
    'cord_fresh_kg', 'cord_drc_pct', 'cord_dry_kg',
    'other_fresh_kg', 'other_drc_pct', 'other_dry_kg',
    'total_fresh_kg', 'total_dry_kg',
    'is_rainy', 'has_stimulant', 'notes', 'created_by', 'metadata',
    'created_at', 'updated_at',
}

_FIELD_WEIGHING_AUDIT_KEYS = (
    'updated_by', 'updated_by_name', 'updated_at',
    'created_by_name', 'created_at',
)


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
    _flatten_metadata_into_doc(doc, table_name)
    if table_name in ('employee', 'category_personnel'):
        _apply_personnel_field_aliases(doc)
    if table_name == 'role_definitions':
        _apply_role_definition_aliases(doc)
    if table_name == 'app_registry':
        _apply_app_registry_aliases(doc)
    if table_name == 'employee_assignment':
        _apply_employee_assignment_aliases(doc)
    if table_name == 'rubber_deliveries':
        _apply_rubber_delivery_aliases(doc)
    if table_name == 'category_teams' and doc.get('manager_id') is not None:
        doc['managerId'] = doc['manager_id']
    if row.get('created_at') and not doc.get('createdAt'):
        doc['createdAt'] = row['created_at']
    if row.get('updated_at') and not doc.get('updatedAt'):
        doc['updatedAt'] = row['updated_at']
    return doc


# Cột hợp lệ khi ghi qua view category_personnel (PostgREST PGRST204 nếu gửi field lạ)
_CATEGORY_PERSONNEL_COLUMNS = frozenset({
    'username', 'ho_ten', 'phone', 'email', 'department', 'position', 'team',
    'role', 'disabled', 'account_locked', 'lock_until', 'status',
    'app_roles_cache', 'metadata', 'created_at', 'updated_at',
})

_EMPLOYEE_WRITE_COLUMNS = frozenset({
    'employee_code', 'full_name', 'gender', 'phone_number', 'personal_email',
    'company_email', 'national_id', 'status', 'hire_date', 'date_of_birth', 'username',
    'department_name', 'position_name', 'team_name', 'employment_status',
    'permanent_address', 'current_address', 'tax_code',
    'disabled', 'account_locked', 'lock_until', 'app_roles_cache', 'metadata',
    'erp_role', 'created_at', 'updated_at', 'team_id', 'work_group_id',
    'department_id', 'position_id',
})

_CATEGORY_TABLE_COLUMNS = {
    'category_departments': frozenset({
        'id', 'name', 'ten', 'ten_phong_ban', 'dept_type', 'active',
        'metadata', 'created_at', 'updated_at',
    }),
    'category_positions': frozenset({'id', 'name', 'metadata', 'created_at', 'updated_at'}),
    'category_teams': frozenset({
        'id', 'name', 'department', 'manager_id', 'metadata', 'created_at', 'updated_at',
    }),
    'category_factories': frozenset({'id', 'name', 'metadata', 'created_at', 'updated_at'}),
    'employee_assignment': frozenset({
        'id', 'employee_id', 'employee_uuid', 'department_name', 'job_title',
        'is_primary', 'assigned_date', 'management_level', 'created_at',
    }),
    'role_definitions': frozenset({
        'id', 'app_id', 'role_id', 'role_name', 'name', 'description',
        'permissions', 'is_active', 'scope_type', 'scopeable', 'sort_order',
        'metadata', 'created_at', 'updated_at',
    }),
    'app_registry': frozenset({
        'app_id', 'name', 'scope_type', 'hub_enabled', 'assignable',
        'sort_order', 'metadata', 'created_at', 'updated_at',
    }),
}

_FIELD_ALIASES = {
    'updatedAt': 'updated_at',
    'createdAt': 'created_at',
    'managerId': 'manager_id',
    'userId': 'employee_uuid',
    'departmentName': 'department_name',
    'positionName': 'job_title',
    'isPrimary': 'is_primary',
    'assignedAt': 'assigned_date',
    'startDate': 'assigned_date',
    'deliveryNo': 'delivery_no',
    'gardenId': 'garden_id',
    'gardenCode': 'garden_code',
    'materialType': 'material_type',
    'vehicleNo': 'vehicle_no',
    'grossWeight': 'gross_weight',
    'drcPercent': 'drc_percent',
    'dryWeight': 'dry_weight',
    'nh3Percent': 'nh3_percent',
    'phValue': 'ph_value',
    'tappingSession': 'tapping_session',
    'tappingDate': 'tapping_date',
    'tappingTime': 'tapping_date',
    'plotIds': 'plot_ids',
    'plotNames': 'plot_names',
    'deliveryPerson': 'delivery_person',
    'createdBy': 'created_by',
}

_PERSONNEL_FIELD_MAP = {
    'phone': 'phone_number',
    'email': 'company_email',
    'personalEmail': 'personal_email',
    'department': 'department_name',
    'position': 'position_name',
    'team': 'team_name',
    'role': 'erp_role',
    'status': 'employment_status',
    'employeeCode': 'employee_code',
    'code': 'employee_code',
    'cccd': 'national_id',
    'permanentAddress': 'permanent_address',
    'currentAddress': 'current_address',
    'hireDate': 'hire_date',
    'dateOfBirth': 'date_of_birth',
    'taxCode': 'tax_code',
    'gender': 'gender',
    'updatedAt': 'updated_at',
    'createdAt': 'created_at',
}


def _is_delete_marker(val):
    return isinstance(val, dict) and val.get('__op') == 'delete'


def _normalize_date(val):
    if val is None or val == '':
        return None
    if isinstance(val, str):
        return val[:10] if len(val) >= 10 else val
    if hasattr(val, 'isoformat'):
        return val.isoformat()[:10]
    return val


def _flatten_metadata_into_doc(doc, table_name=None):
    meta = doc.pop('metadata', None)
    if not isinstance(meta, dict):
        return
    priority_keys = (
        'factory', 'assignments', 'orderByDept', 'listStt', 'code', 'employeeCode', 'cccd',
        'icon', 'order', 'description', 'parentId',
    )
    for key in priority_keys:
        if key in meta:
            doc[key] = meta[key]
    for key, val in meta.items():
        if key not in doc or doc.get(key) in (None, '', {}):
            doc[key] = val
    # Giữ metadata gốc — client Firestore đọc doc.metadata (slots, tapping_session, …)
    doc['metadata'] = meta


def _apply_employee_assignment_aliases(doc):
    """Map employee_assignment ↔ collection Firebase employeePositions."""
    if doc.get('employee_uuid') is not None:
        doc['userId'] = str(doc['employee_uuid'])
    if doc.get('department_name') is not None:
        doc['departmentName'] = doc['department_name']
    if doc.get('job_title') is not None:
        doc['positionName'] = doc['job_title']
    if doc.get('is_primary') is not None:
        doc['isPrimary'] = doc['is_primary']
    if doc.get('assigned_date') is not None:
        doc['assignedAt'] = doc['assigned_date']
    if doc.get('id') is not None:
        doc['id'] = str(doc['id'])


def _prepare_employee_assignment_write(data):
    row = {}
    user_id = data.get('userId') or data.get('employee_uuid') or data.get('user_id')
    if user_id:
        row['employee_uuid'] = str(user_id)
    dept_name = data.get('departmentName') or data.get('department_name')
    if dept_name:
        row['department_name'] = dept_name
    job_title = data.get('positionName') or data.get('position_name') or data.get('job_title')
    if job_title:
        row['job_title'] = job_title
    if 'isPrimary' in data or 'is_primary' in data:
        row['is_primary'] = bool(data.get('isPrimary', data.get('is_primary', False)))
    assigned = data.get('assignedAt') or data.get('assigned_date') or data.get('startDate')
    if assigned:
        row['assigned_date'] = _normalize_date(assigned)
    return row


def _is_org_id(val, kind='dept'):
    if not val or not isinstance(val, str):
        return False
    if kind == 'dept':
        return val.startswith(('dl-', 'vien-', 'dept-'))
    return val.startswith(('team-', 'tram-', 'wg-'))


def _apply_department_field(row, data, table='employee'):
    if 'department' not in data:
        return
    val = data.get('department')
    if val is None or val == '':
        if table == 'employee':
            row['department_id'] = None
            row['department_name'] = None
        return
    name = data.get('departmentName') or data.get('department_name')
    if _is_org_id(val, 'dept'):
        if table == 'employee':
            row['department_id'] = val
        row['department_name'] = name or val
    else:
        row['department_name'] = val
        if table == 'employee' and name:
            row['department_id'] = data.get('departmentId') or data.get('department_id')


def _apply_team_field(row, data, table='employee'):
    if 'team' not in data:
        return
    val = data.get('team')
    if val is None or val == '':
        if table == 'employee':
            row['team_id'] = None
        row['team_name'] = None
        return
    name = data.get('teamName') or data.get('team_name')
    if _is_org_id(val, 'team'):
        if table == 'employee':
            row['team_id'] = val
        row['team_name'] = name or val
    else:
        row['team_name'] = val
        if table == 'employee' and name:
            row['team_id'] = data.get('teamId') or data.get('team_id')


def _apply_personnel_field_aliases(doc):
    """Map cột employee / category_personnel ↔ tên field app ERP (hoTen, ho_ten…)."""
    name_val = (
        doc.get('full_name') or doc.get('ho_ten') or doc.get('hoTen') or doc.get('name')
    )
    if name_val:
        doc['full_name'] = name_val
        doc['ho_ten'] = name_val
        doc['hoTen'] = name_val
        doc['name'] = name_val
    if doc.get('phone_number') and not doc.get('phone'):
        doc['phone'] = doc['phone_number']
    if not doc.get('email'):
        doc['email'] = doc.get('company_email') or doc.get('personal_email')
    if doc.get('department_id'):
        doc['department'] = doc['department_id']
    elif doc.get('department_name') and not doc.get('department'):
        doc['department'] = doc['department_name']
    if doc.get('department_name'):
        doc['departmentName'] = doc['department_name']
    if doc.get('position_name') and not doc.get('position'):
        doc['position'] = doc['position_name']
    if doc.get('position') and not doc.get('position_name'):
        doc['position_name'] = doc['position']
    if doc.get('position_name'):
        doc['positionName'] = doc['position_name']
    if doc.get('team_id'):
        doc['team'] = doc['team_id']
    elif doc.get('team_name') and not doc.get('team'):
        doc['team'] = doc['team_name']
    if doc.get('team_name'):
        doc['teamName'] = doc['team_name']
    if doc.get('work_group_id'):
        doc['workGroupId'] = doc['work_group_id']
    if doc.get('erp_role') and not doc.get('role'):
        doc['role'] = doc['erp_role']
    if doc.get('employment_status') and not doc.get('status'):
        doc['status'] = doc['employment_status']
    if doc.get('employee_code') and not doc.get('employeeCode'):
        doc['employeeCode'] = doc['employee_code']
    if doc.get('national_id') and not doc.get('cccd'):
        doc['cccd'] = doc['national_id']
    if doc.get('app_roles_cache') is not None and doc.get('appRolesCache') is None:
        doc['appRolesCache'] = doc['app_roles_cache']


def _normalize_permissions_list(val):
    if val is None:
        return []
    if isinstance(val, list):
        return [str(p) for p in val if p]
    if isinstance(val, dict):
        return [str(k) for k in val.keys() if k]
    return []


def _apply_role_definition_aliases(doc):
    """Map role_definitions ↔ field Firestore (appId, roleName, permissions[])."""
    meta = doc.get('metadata') if isinstance(doc.get('metadata'), dict) else {}
    if meta.get('app_id'):
        doc['app_id'] = meta['app_id']
    elif not doc.get('app_id') and doc.get('role_id') and '_' in str(doc['role_id']):
        parts = str(doc['role_id']).split('_', 1)
        if len(parts) == 2:
            doc['app_id'] = parts[0]
    if meta.get('role_id'):
        doc['role_id'] = meta['role_id']
    elif doc.get('role_id') and '_' in str(doc['role_id']) and not doc.get('app_id'):
        parts = str(doc['role_id']).split('_', 1)
        if len(parts) == 2:
            doc.setdefault('app_id', parts[0])
            doc['role_id'] = parts[1]
    if doc.get('app_id'):
        doc['appId'] = doc['app_id']
    if doc.get('role_id'):
        doc['roleId'] = doc['role_id']
    name = doc.get('role_name') or doc.get('name') or meta.get('role_name')
    if name:
        doc['roleName'] = name
        doc['name'] = name
    perms = doc.get('permissions')
    if not perms or perms == {}:
        perms = meta.get('permissions')
    doc['permissions'] = _normalize_permissions_list(perms)
    if not doc.get('scope_type') and meta.get('scope_type'):
        doc['scope_type'] = meta['scope_type']
    if doc.get('scope_type'):
        doc['scope'] = {'type': doc['scope_type']}
    if doc.get('is_active') is not None:
        doc['isActive'] = bool(doc['is_active'])
    elif meta.get('is_active') is not None:
        doc['isActive'] = bool(meta['is_active'])
    if doc.get('scopeable') is not None:
        doc['scopeable'] = doc['scopeable'] or {}
    elif meta.get('scopeable'):
        doc['scopeable'] = meta['scopeable']
    if doc.get('sort_order') is not None:
        doc['sortOrder'] = doc['sort_order']
    elif meta.get('sort_order') is not None:
        doc['sortOrder'] = meta['sort_order']
    if meta.get('description') and not doc.get('description'):
        doc['description'] = meta['description']


def _apply_app_registry_aliases(doc):
    if doc.get('app_id'):
        doc['appId'] = doc['app_id']
    if doc.get('scope_type'):
        doc['scopeType'] = doc['scope_type']
    if doc.get('hub_enabled') is not None:
        doc['hubEnabled'] = bool(doc['hub_enabled'])
    if doc.get('sort_order') is not None:
        doc['sortOrder'] = doc['sort_order']


def _prepare_role_definition_write(data, doc_id=None):
    app_id = (data.get('appId') or data.get('app_id') or '').strip()
    role_id = (data.get('roleId') or data.get('role_id') or '').strip()
    rid = doc_id or data.get('id') or (f'{app_id}_{role_id}' if app_id and role_id else None)
    scope = data.get('scope') if isinstance(data.get('scope'), dict) else {}
    scope_type = data.get('scope_type') or data.get('scopeType') or scope.get('type') or ''
    meta = dict(data.get('metadata') or {})
    if data.get('scopeable'):
        meta['scopeable'] = data['scopeable']
    if data.get('color'):
        meta['color'] = data['color']
    row = {
        'id': rid,
        'app_id': app_id or None,
        'role_id': role_id or None,
        'role_name': data.get('roleName') or data.get('role_name') or data.get('name') or role_id,
        'name': data.get('roleName') or data.get('role_name') or data.get('name') or role_id,
        'description': data.get('description') or '',
        'permissions': _normalize_permissions_list(data.get('permissions')),
        'is_active': bool(data.get('isActive', data.get('is_active', True))),
        'scope_type': scope_type or None,
        'scopeable': data.get('scopeable') or meta.get('scopeable') or {},
        'sort_order': int(data.get('sortOrder') or data.get('sort_order') or 100),
        'metadata': meta,
        'updated_at': datetime.utcnow().isoformat(),
    }
    return {k: v for k, v in row.items() if v is not None}


def _fetch_row_metadata(table, doc_id):
    storage = 'employee' if table == 'category_personnel' else table
    if storage == 'employee_assignment':
        return {}
    if storage not in _CATEGORY_TABLE_COLUMNS and storage not in ('employee', 'category_personnel'):
        return {}
    try:
        res = supabase.table(storage).select('metadata').eq('id', doc_id).limit(1).execute()
        if res.data:
            meta = res.data[0].get('metadata')
            return dict(meta) if isinstance(meta, dict) else {}
    except Exception as e:
        print(f"_fetch_row_metadata({table}, {doc_id}): {e}")
    return {}


def _merge_personnel_metadata(existing_meta, data, table='employee'):
    meta = dict(existing_meta or {})
    row = {}
    name_val = data.get('hoTen') or data.get('name') or data.get('ho_ten') or data.get('full_name')
    if name_val is not None:
        row['ho_ten' if table == 'category_personnel' else 'full_name'] = name_val

    skip = {'hoTen', 'name', 'ho_ten', 'full_name', 'updatedAt', 'createdAt', 'metadata',
            'department', 'team', 'departmentName', 'departmentId', 'teamName', 'teamId'}
    cp_direct = {
        'phone': 'phone', 'email': 'email', 'position': 'position',
        'role': 'role', 'status': 'status',
        'username': 'username', 'disabled': 'disabled', 'account_locked': 'account_locked',
        'lock_until': 'lock_until', 'app_roles_cache': 'app_roles_cache',
    }
    _apply_department_field(row, data, table)
    _apply_team_field(row, data, table)
    for key, val in data.items():
        if key in skip:
            continue
        if key.startswith('orderByDept.'):
            dept_id = key.split('.', 1)[1]
            bucket = meta.setdefault('orderByDept', {})
            if _is_delete_marker(val):
                bucket.pop(dept_id, None)
            else:
                bucket[dept_id] = val
            continue
        if key == 'updatedAt':
            row['updated_at'] = val
            continue
        if key == 'createdAt':
            row['created_at'] = val
            continue
        if table == 'category_personnel':
            dest = cp_direct.get(key, key)
            if dest in _CATEGORY_PERSONNEL_COLUMNS:
                row[dest] = val
            elif not _is_delete_marker(val) and val is not None:
                meta[key] = val
            continue
        dest = _PERSONNEL_FIELD_MAP.get(key, key)
        if dest in _EMPLOYEE_WRITE_COLUMNS:
            if dest in ('hire_date', 'date_of_birth'):
                row[dest] = _normalize_date(val)
            else:
                row[dest] = val
        elif not _is_delete_marker(val) and val is not None:
            meta[key] = val
    if meta:
        row['metadata'] = meta
    return row


def _prepare_category_write(table, data, existing_meta=None):
    allowed = _CATEGORY_TABLE_COLUMNS.get(table)
    if not allowed:
        return data
    meta = dict(existing_meta or {})
    row = {}
    for key, val in data.items():
        if key in ('updatedAt', 'createdAt'):
            row[_FIELD_ALIASES[key]] = val
            continue
        dest = _FIELD_ALIASES.get(key, key)
        if dest in allowed and dest != 'metadata':
            row[dest] = val
        elif not _is_delete_marker(val):
            meta[dest if dest != key else key] = val
    if meta:
        row['metadata'] = meta
    return row


def _apply_rubber_delivery_aliases(doc):
    """Map rubber_deliveries ↔ collection rubberDeliveries (camelCase client)."""
    aliases = {
        'delivery_no': 'deliveryNo',
        'garden_id': 'gardenId',
        'garden_code': 'gardenCode',
        'material_type': 'materialType',
        'vehicle_no': 'vehicleNo',
        'gross_weight': 'grossWeight',
        'drc_percent': 'drcPercent',
        'dry_weight': 'dryWeight',
        'nh3_percent': 'nh3Percent',
        'ph_value': 'phValue',
        'tapping_session': 'tappingSession',
        'tapping_date': 'tappingDate',
        'plot_ids': 'plotIds',
        'plot_names': 'plotNames',
        'delivery_person': 'deliveryPerson',
        'created_by': 'createdBy',
        'grp': 'group',
    }
    for snake, camel in aliases.items():
        if doc.get(snake) is not None and doc.get(camel) is None:
            doc[camel] = doc[snake]
    if doc.get('team') and not doc.get('team_id'):
        doc['team_id'] = doc['team']
    if doc.get('tappingDate') and not doc.get('tappingTime'):
        doc['tappingTime'] = doc['tappingDate']
    meta_doc = doc.get('metadata') if isinstance(doc.get('metadata'), dict) else {}
    try:
        lg = float(doc.get('latexGrossWeight') or meta_doc.get('latexGrossWeight') or 0)
        cg = float(doc.get('coagGrossWeight') or meta_doc.get('coagGrossWeight') or 0)
    except (TypeError, ValueError):
        lg = cg = 0
    if (lg > 0 and cg > 0) or doc.get('coagByType') or meta_doc.get('coagByType'):
        doc['materialType'] = 'mixed'


def _normalize_rubber_material_type(val):
    """Enum Postgres material_type không có 'mixed' — phiếu GN hỗn hợp lưu latex + coag trong metadata."""
    if val is None or val == '':
        return None
    s = str(val).strip().lower()
    if s in ('latex', 'coagulum', 'misc'):
        return s
    if s == 'mixed':
        return 'latex'
    return 'latex'


def _prepare_rubber_delivery_write(data, doc_id=None):
    """Chuyển phiếu GN camelCase → cột rubber_deliveries; field phụ vào metadata."""
    data = dict(data or {})
    existing_meta = _fetch_row_metadata('rubber_deliveries', doc_id) if doc_id else {}
    meta = dict(existing_meta) if isinstance(existing_meta, dict) else {}
    incoming_meta = data.pop('metadata', None)
    if isinstance(incoming_meta, dict):
        meta.update(incoming_meta)
    row = {}
    skip = {'id', 'metadata'}
    for key, val in data.items():
        if key in skip or _is_delete_marker(val):
            continue
        if key == 'updatedAt':
            row['updated_at'] = val
            continue
        if key == 'createdAt':
            row['created_at'] = val
            continue
        dest = _RUBBER_DELIVERY_FIELD_MAP.get(key, key)
        if dest in _RUBBER_DELIVERY_COLUMNS and dest != 'metadata':
            if dest == 'tapping_date':
                row[dest] = _normalize_date(val)
            elif dest == 'material_type':
                norm_mt = _normalize_rubber_material_type(val)
                if norm_mt:
                    row[dest] = norm_mt
            elif dest == 'garden_id':
                # Trạm SX (team-lk…) thường không có trong rubber_gardens — tránh lỗi FK.
                meta['gardenId'] = val
            elif dest == 'created_by':
                meta['createdBy'] = val
            else:
                row[dest] = val
        elif _is_delete_marker(val) or val is None:
            meta.pop(key, None)
        else:
            meta[key] = val
    if meta:
        row['metadata'] = meta
    return row


def _prepare_field_weighing_write(data):
    """Chuẩn hóa ghi cân mủ — audit nằm trong metadata, không có cột updated_by."""
    data = dict(data or {})
    meta = data.get('metadata') or {}
    if not isinstance(meta, dict):
        meta = {}
    for key in _FIELD_WEIGHING_AUDIT_KEYS:
        if key in data:
            meta[key] = data.pop(key)
    data['metadata'] = meta
    return {k: v for k, v in data.items() if k in _FIELD_WEIGHING_COLUMNS}


def _find_field_weighing_id(row):
    record_date = row.get('record_date')
    section_id = row.get('tapping_section_id')
    worker_id = row.get('worker_id')
    session_no = row.get('session_no') if row.get('session_no') is not None else 1
    if not record_date or not section_id or not worker_id:
        return None
    try:
        res = (
            supabase.table('field_worker_weighings')
            .select('id')
            .eq('record_date', record_date)
            .eq('tapping_section_id', section_id)
            .eq('worker_id', worker_id)
            .eq('session_no', session_no)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0]['id']
    except Exception as e:
        print(f'_find_field_weighing_id: {e}')
    return None


def _upsert_field_weighing(data, doc_id=None):
    row = _prepare_field_weighing_write(data)
    existing_id = _find_field_weighing_id(row)
    use_id = existing_id or doc_id or row.get('id') or str(uuid.uuid4())
    supabase.table('field_worker_weighings').upsert({'id': use_id, **row}).execute()
    return use_id


def _prepare_table_write(table, data, doc_id=None):
    """Chuyển field Firestore (hoTen, updatedAt…) → cột Supabase trước khi ghi."""
    if not data:
        return data

    if table in ('category_personnel', 'employee'):
        existing = _fetch_row_metadata(table, doc_id) if doc_id else {}
        return _merge_personnel_metadata(existing, data, table=table)

    if table in _CATEGORY_TABLE_COLUMNS:
        if table == 'employee_assignment':
            return _prepare_employee_assignment_write(data)
        if table == 'role_definitions':
            return _prepare_role_definition_write(data, doc_id=doc_id)
        existing = _fetch_row_metadata(table, doc_id) if doc_id else {}
        return _prepare_category_write(table, data, existing)

    if table == 'role_definitions':
        return _prepare_role_definition_write(data, doc_id=doc_id)

    if table == 'field_worker_weighings':
        return _prepare_field_weighing_write(data)

    if table == 'rubber_deliveries':
        return _prepare_rubber_delivery_write(data, doc_id=doc_id)

    return data


def _prepare_table_update(table, doc_id, data):
    """PATCH / batch update — merge metadata, map field names."""
    if table in TABLE_MAP.values():
        prepared = _prepare_table_write(table, data, doc_id=doc_id)
        if prepared:
            return prepared
    return data


def _resolve_query_field(field):
    """Map tên field Firestore (camelCase) → cột Postgres khi filter/order Supabase."""
    if not field:
        return field
    if field in _FIELD_ALIASES:
        return _FIELD_ALIASES[field]
    if field in _PERSONNEL_FIELD_MAP:
        return _PERSONNEL_FIELD_MAP[field]
    return field


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


def _load_erp_collection_docs(collection, where=None, order_by=None, order_dir='desc', limit=None):
    """Đọc collection legacy trong erp_collections (fallback khi bảng chuyên biệt trống)."""
    tapping_date = None
    for cond in where or []:
        if len(cond) == 3 and cond[0] in ('tappingDate', 'tapping_date', 'tappingTime') and cond[1] == '==':
            tapping_date = _normalize_date(cond[2])
            break
    try:
        q = supabase.table('erp_collections').select('*').eq('collection', collection)
        if tapping_date:
            q = q.or_(
                f'data->>tappingDate.eq.{tapping_date},'
                f'data->>tapping_date.eq.{tapping_date},'
                f'data->>tappingTime.eq.{tapping_date}'
            )
        else:
            q = q.limit(200)
        res = q.execute()
    except Exception as e:
        print(f'_load_erp_collection_docs {collection}: {e}')
        return []
    docs = []
    for row in res.data or []:
        doc = _row_to_doc(row, use_data_field=True)
        if doc:
            docs.append(doc)
    docs = _apply_where(docs, where)
    reverse = (order_dir or 'desc').lower() == 'desc'
    if order_by:
        ob = order_by
        db_ob = _resolve_query_field(order_by)
        docs.sort(key=lambda d: d.get(ob) or d.get(db_ob) or '', reverse=reverse)
    else:
        docs.sort(key=lambda d: d.get('createdAt') or d.get('created_at') or '', reverse=True)
    if limit:
        docs = docs[: int(limit)]
    return docs


def _merge_delivery_docs(primary, legacy):
    """Gộp phiếu GN bảng mới + erp_collections (ưu tiên bản trong bảng)."""
    by_id = {}
    for d in legacy or []:
        if d and d.get('id'):
            by_id[d['id']] = d
    for d in primary or []:
        if d and d.get('id'):
            by_id[d['id']] = d
    return list(by_id.values())


def _load_collection_docs(collection, where=None, order_by=None, order_dir='desc', limit=None):
    table = TABLE_MAP.get(collection)
    docs = []

    if table:
        q = supabase.table(table).select('*')
        post_filters = []
        for cond in where or []:
            if len(cond) != 3:
                continue
            field, op, value = cond
            db_field = _resolve_query_field(field)
            if op == '==':
                norm_val = _normalize_date(value) if db_field == 'tapping_date' else value
                q = q.eq(db_field, norm_val)
            else:
                post_filters.append(cond)
        if order_by:
            q = q.order(_resolve_query_field(order_by), desc=(order_dir or 'desc').lower() == 'desc')
        if limit:
            q = q.limit(int(limit))
        res = q.execute()
        for row in res.data or []:
            doc = _row_to_doc(row, use_data_field=False, table_name=table)
            if doc:
                docs.append(doc)
        docs = _apply_where(docs, post_filters)
        if collection == 'rubberDeliveries' and not docs:
            docs = _load_erp_collection_docs(collection, where, order_by, order_dir, limit)
    else:
        docs = _load_erp_collection_docs(collection, where, order_by, order_dir, limit)

    docs = _apply_where(docs, where)
    reverse = (order_dir or 'desc').lower() == 'desc'
    if order_by:
        ob = order_by
        db_ob = _resolve_query_field(order_by)
        docs.sort(key=lambda d: d.get(ob) or d.get(db_ob) or '', reverse=reverse)
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


@app.route('/app/ecabinet')
@app.route('/ecabinet')
def ecabinet_redirect():
    """Alias cũ → Phòng họp e-Cabinet."""
    return redirect('/app/phonghop')


@app.route('/app/phonghop/present')
@app.route('/phonghop/present')
def phonghop_present():
    """Cửa sổ trình chiếu — kéo sang màn hình lớn, fullscreen."""
    return render_template('phonghop-present.html')


@app.route('/app/phonghop/screen')
@app.route('/phonghop/screen')
def phonghop_screen():
    """Cửa sổ màn chiếu TV — xem chia sẻ màn hình WebRTC."""
    return render_template('phonghop-screen.html')


@app.route('/app/phonghop/join')
@app.route('/phonghop/join')
def phonghop_join():
    """Deep link nội bộ — ?code=MTG-YYYY-NNNN (cùng app Phòng họp)."""
    return render_template('phonghop.html')


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

def _employee_position_name(personnel_id, username=None):
    """Lấy position_name từ bảng employee (view đăng nhập có thể chưa có cột này)."""
    try:
        if personnel_id:
            res = supabase.table('employee').select('position_name').eq('id', personnel_id).limit(1).execute()
            if res.data and res.data[0].get('position_name'):
                return res.data[0]['position_name']
        if username:
            res = supabase.table('employee').select('position_name').eq('username', username).limit(1).execute()
            if res.data and res.data[0].get('position_name'):
                return res.data[0]['position_name']
    except Exception as e:
        print(f"_employee_position_name: {e}")
    return ''


def _personnel_row_by_ref(username=None, personnel_id=None):
    """Tìm hồ sơ category_personnel theo username hoặc id."""
    try:
        if username:
            res = supabase.table('category_personnel').select('*').eq('username', username).limit(1).execute()
            if res.data:
                return res.data[0]
        if personnel_id:
            res = supabase.table('category_personnel').select('*').eq('id', personnel_id).limit(1).execute()
            if res.data:
                return res.data[0]
    except Exception as e:
        print(f'_personnel_row_by_ref: {e}')
    return None


def _resolve_login_profile_fields(user_row, username):
    """Lấy personnel_id, chức vụ, app_roles_cache — kể cả khi view đăng nhập thiếu."""
    personnel_id = user_row.get('personnel_id') or user_row.get('employee_id')
    app_cache = user_row.get('app_roles_cache') or {}
    position_name = user_row.get('position_name') or user_row.get('position') or ''

    if not personnel_id and username:
        try:
            ua = supabase.table('user_accounts').select('employee_id').eq('username', username).limit(1).execute()
            if ua.data and ua.data[0].get('employee_id'):
                personnel_id = ua.data[0]['employee_id']
        except Exception as e:
            print(f'_resolve_login_profile_fields user_accounts: {e}')

    personnel = _personnel_row_by_ref(username, personnel_id)
    if personnel:
        doc = _row_to_doc(personnel, use_data_field=False, table_name='employee')
        if not app_cache or app_cache == {}:
            app_cache = doc.get('appRolesCache') or doc.get('app_roles_cache') or {}
        if not position_name:
            position_name = (
                doc.get('position_name') or doc.get('positionName') or doc.get('position') or ''
            )
        if not personnel_id:
            personnel_id = doc.get('id')

    if not position_name:
        position_name = _employee_position_name(personnel_id, username)

    if (not app_cache or app_cache == {}) and personnel_id:
        try:
            res = supabase.table('employee').select('app_roles_cache, position_name').eq(
                'id', personnel_id
            ).limit(1).execute()
            if res.data:
                row = res.data[0]
                if row.get('app_roles_cache'):
                    app_cache = row['app_roles_cache']
                if not position_name and row.get('position_name'):
                    position_name = row['position_name']
        except Exception as e:
            print(f'_resolve_login_profile_fields employee: {e}')

    return personnel_id, position_name, app_cache


def _login_user_payload(user_row, username):
    """JSON user trả về sau đăng nhập — gồm chức vụ để header hiển thị ngay."""
    role = user_row.get('role', 'user')
    is_super = bool(user_row.get('is_super_admin')) or role == 'admin'
    personnel_id, position_name, app_cache = _resolve_login_profile_fields(user_row, username)
    department = user_row.get('department') or user_row.get('department_name') or ''
    display = user_row.get('display_name') or user_row.get('ho_ten') or username
    return {
        'username': username,
        'name': display,
        'hoTen': display,
        'id': personnel_id or username,
        'role': role,
        'department': department,
        'department_name': department,
        'position': position_name,
        'position_name': position_name,
        'positionName': position_name,
        'email': user_row.get('email') or f'{username}@rriv.org.vn',
        'systemRoles': user_row.get('system_roles') or [],
        'isSuperAdmin': is_super,
        'appRolesCache': app_cache if isinstance(app_cache, dict) else {}
    }


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
        return jsonify({
            "success": True,
            "user": _login_user_payload(user, username)
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
        return jsonify({
            "success": True,
            "user": _login_user_payload(user, username)
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
        res_emp = supabase.table('employee').select('*').eq('username', username).limit(1).execute()
        if res_emp.data:
            return jsonify({"profile": _row_to_doc(res_emp.data[0], use_data_field=False, table_name='employee')})
        res = supabase.table('category_personnel').select('*').eq('username', username).limit(1).execute()
        if res.data:
            return jsonify({"profile": _row_to_doc(res.data[0], use_data_field=False, table_name='employee')})
        try:
            ua = supabase.table('user_accounts').select('employee_id').eq('username', username).limit(1).execute()
            if ua.data and ua.data[0].get('employee_id'):
                emp_id = ua.data[0]['employee_id']
                res_link = supabase.table('category_personnel').select('*').eq('id', emp_id).limit(1).execute()
                if res_link.data:
                    doc = _row_to_doc(res_link.data[0], use_data_field=False, table_name='employee')
                    doc['username'] = username
                    return jsonify({"profile": doc})
                res_emp2 = supabase.table('employee').select('*').eq('id', emp_id).limit(1).execute()
                if res_emp2.data:
                    doc = _row_to_doc(res_emp2.data[0], use_data_field=False, table_name='employee')
                    doc['username'] = username
                    return jsonify({"profile": doc})
        except Exception as e:
            print(f'get_profile link employee_id: {e}')
        res2 = supabase.table('erp_collections').select('*').eq('collection', 'categoryPersonnel').execute()
        for row in res2.data or []:
            doc = _row_to_doc(row, use_data_field=True)
            if doc and doc.get('username') == username:
                return jsonify({"profile": doc})
        return jsonify({"profile": None})
    except Exception as e:
        print(e)
        return jsonify({"profile": None}), 500


def _system_role_erp_role(system_role_id):
    """Map system_role → erp_role legacy (user/vpp/admin)."""
    if not system_role_id:
        return 'user'
    try:
        res = supabase.table('system_role').select('role_name').eq('id', int(system_role_id)).limit(1).execute()
        if not res.data:
            return 'user'
        name = res.data[0].get('role_name') or ''
        if name == 'Super_Admin':
            return 'admin'
        if name in ('Institute_Executive', 'Department_Head', 'Operations_Specialist'):
            return 'vpp'
        return 'user'
    except Exception:
        return 'user'


def _sync_user_app_roles(username, employee_id, app_roles_cache):
    """Đồng bộ app_roles_cache → user_roles (1 dòng / app, metadata.roles + scopes)."""
    if not username:
        return
    cache = app_roles_cache if isinstance(app_roles_cache, dict) else {}
    try:
        supabase.table('user_roles').delete().eq('username', username).execute()
    except Exception as e:
        print(f'_sync_user_app_roles delete: {e}')

    for app_id, entry in cache.items():
        if not isinstance(entry, dict):
            continue
        roles = entry.get('roles') or []
        if not roles:
            continue
        primary = roles[0] if isinstance(roles, list) else roles
        meta = {
            'roles': roles if isinstance(roles, list) else [roles],
            'scopes': entry.get('scopes') or {},
            'isActive': True,
        }
        row = {
            'id': f'ur-{username}-{app_id}',
            'uid': employee_id or username,
            'username': username,
            'app_id': app_id,
            'role_id': primary,
            'is_active': True,
            'metadata': meta,
        }
        try:
            supabase.table('user_roles').upsert(row).execute()
        except Exception as e:
            print(f'_sync_user_app_roles upsert {app_id}: {e}')


def _sync_user_system_role(username, system_role_id, assigned_by='nhansu'):
    """Gán một vai trò tổ chức duy nhất cho user (thay thế các role cũ)."""
    if not username or not system_role_id:
        return
    try:
        rid = int(system_role_id)
    except (TypeError, ValueError):
        return
    supabase.table('user_system_role').delete().eq('username', username).execute()
    supabase.table('user_system_role').insert({
        'username': username,
        'system_role_id': rid,
        'assigned_by': assigned_by,
    }).execute()


# Phạm vi dữ liệu mặc định theo app (cấu hình cấu trúc — không phải tên role)
APP_SCOPE_TYPES = {
    'nhansu': 'department',
    'sanxuat': 'team',
    'vuoncay': 'department',
    'baocao': 'department',
    'thongbao': 'department',
    'phanquyen': 'none',
}


@app.route('/api/app-registry', methods=['GET'])
def list_app_registry():
    """Danh mục app — ma trận gán quyền Nhân sự đọc từ đây."""
    assignable_only = request.args.get('assignable', '').lower() in ('1', 'true', 'yes')
    try:
        q = supabase.table('app_registry').select('*').order('sort_order')
        if assignable_only:
            q = q.eq('assignable', True)
        res = q.execute()
        if res.data:
            apps = [_row_to_doc(row, use_data_field=False, table_name='app_registry') for row in res.data]
            return jsonify({"success": True, "apps": apps})
    except Exception as e:
        print(f'list_app_registry (table): {e}')

    try:
        res = supabase.table('role_definitions').select('id, metadata').execute()
        seen = {}
        for row in res.data or []:
            doc = _row_to_doc(row, use_data_field=False, table_name='role_definitions')
            app_id = doc.get('appId') or doc.get('app_id')
            if not app_id:
                continue
            if app_id not in seen:
                seen[app_id] = {
                    'appId': app_id,
                    'app_id': app_id,
                    'name': APP_TITLES.get(app_id, app_id),
                    'scopeType': APP_SCOPE_TYPES.get(app_id, 'department'),
                    'scope_type': APP_SCOPE_TYPES.get(app_id, 'department'),
                    'assignable': True,
                    'sortOrder': len(seen) + 1,
                }
        apps = sorted(seen.values(), key=lambda a: a.get('sortOrder', 999))
        if assignable_only:
            apps = [a for a in apps if a.get('assignable', True)]
        return jsonify({"success": True, "apps": apps})
    except Exception as e:
        print(f'list_app_registry (fallback): {e}')
        return jsonify({"success": False, "message": str(e), "apps": []}), 500


def _load_role_definitions_rows(app_id='', active_only=True):
    """Đọc role_definitions — tương thích schema cũ (chỉ metadata) và schema ERP mới."""
    try:
        q = supabase.table('role_definitions').select('*')
        if app_id:
            q = q.eq('app_id', app_id)
        if active_only:
            q = q.eq('is_active', True)
        res = q.order('sort_order').order('role_name').execute()
        return res.data or []
    except Exception as e:
        print(f'_load_role_definitions_rows (modern): {e}')

    res = supabase.table('role_definitions').select(
        'id, role_id, name, permissions, metadata, created_at'
    ).execute()
    rows = res.data or []
    if not app_id and not active_only:
        return rows

    filtered = []
    for row in rows:
        doc = _row_to_doc(row, use_data_field=False, table_name='role_definitions')
        row_app = doc.get('appId') or doc.get('app_id') or ''
        if app_id and row_app != app_id:
            continue
        if active_only:
            meta = row.get('metadata') if isinstance(row.get('metadata'), dict) else {}
            is_active = doc.get('isActive')
            if is_active is None:
                is_active = meta.get('is_active', True)
            if not is_active:
                continue
        filtered.append(row)
    filtered.sort(key=lambda r: (
        (r.get('metadata') or {}).get('sort_order', 999),
        (r.get('metadata') or {}).get('role_name') or r.get('name') or '',
    ))
    return filtered


@app.route('/api/role-definitions', methods=['GET'])
def list_role_definitions():
    """Danh mục role theo app — dropdown Nhân sự + Permissions.js đọc từ đây."""
    app_id = (request.args.get('app_id') or request.args.get('appId') or '').strip()
    active_only = request.args.get('active_only', 'true').lower() not in ('0', 'false', 'no')
    try:
        rows = _load_role_definitions_rows(app_id=app_id, active_only=active_only)
        roles = [
            _row_to_doc(row, use_data_field=False, table_name='role_definitions')
            for row in rows
        ]
        return jsonify({"success": True, "roles": roles})
    except Exception as e:
        print(f'list_role_definitions: {e}')
        return jsonify({"success": False, "message": str(e), "roles": []}), 500


@app.route('/api/system-roles', methods=['GET'])
def list_system_roles():
    try:
        res = supabase.table('system_role').select('id, role_name, description').order('id').execute()
        return jsonify({"success": True, "roles": res.data or []})
    except Exception as e:
        print(f"list_system_roles: {e}")
        return jsonify({"success": False, "message": str(e), "roles": []}), 500


@app.route('/api/personnel/system-role', methods=['POST'])
def set_personnel_system_role():
    body = request.json or {}
    username = (body.get('username') or '').strip().lower()
    system_role_id = body.get('systemRoleId') or body.get('system_role_id')
    if not username or not system_role_id:
        return jsonify({"success": False, "message": "Thiếu username hoặc systemRoleId"}), 400
    try:
        erp_role = _system_role_erp_role(system_role_id)
        _sync_user_system_role(username, system_role_id)
        supabase.table('user_accounts').update({'role': erp_role}).eq('username', username).execute()
        emp = supabase.table('employee').select('id, metadata').eq('username', username).limit(1).execute()
        if emp.data:
            meta = dict(emp.data[0].get('metadata') or {})
            meta['systemRoleId'] = int(system_role_id)
            supabase.table('employee').update({
                'erp_role': erp_role,
                'metadata': meta,
            }).eq('id', emp.data[0]['id']).execute()
        return jsonify({"success": True})
    except Exception as e:
        print(f"set_personnel_system_role: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/personnel/access-rights', methods=['POST'])
def set_personnel_access_rights():
    """Cập nhật ma trận quyền app (app_roles_cache + user_roles)."""
    body = request.json or {}
    username = (body.get('username') or '').strip().lower()
    employee_id = body.get('employeeId') or body.get('employee_id') or body.get('id')
    app_roles_cache = body.get('appRolesCache') or body.get('app_roles_cache') or {}

    if not username:
        return jsonify({'success': False, 'message': 'Thiếu username'}), 400
    if not isinstance(app_roles_cache, dict):
        return jsonify({'success': False, 'message': 'appRolesCache không hợp lệ'}), 400

    try:
        if not employee_id:
            emp = supabase.table('employee').select('id').eq('username', username).limit(1).execute()
            if emp.data:
                employee_id = emp.data[0]['id']

        if employee_id:
            supabase.table('employee').update({
                'app_roles_cache': app_roles_cache,
            }).eq('id', employee_id).execute()

        _sync_user_app_roles(username, employee_id, app_roles_cache)
        return jsonify({'success': True})
    except Exception as e:
        print(f'set_personnel_access_rights: {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/personnel/create', methods=['POST'])
def create_personnel():
    """Tạo nhân sự + tài khoản đăng nhập (thay Firebase Auth createUser)."""
    body = request.json or {}
    username = (body.get('username') or '').strip().lower()
    password = body.get('password') or ''
    data = dict(body.get('data') or {})

    if not username:
        return jsonify({"success": False, "message": "Thiếu username"}), 400
    if len(password) < 6:
        return jsonify({"success": False, "message": "Mật khẩu ≥ 6 ký tự"}), 400

    try:
        dup = supabase.table('employee').select('id').eq('username', username).limit(1).execute()
        if dup.data:
            return jsonify({"success": False, "message": "Username đã tồn tại trong danh sách nhân sự"}), 409
        dup_acct = supabase.table('user_accounts').select('username').eq('username', username).limit(1).execute()
        if dup_acct.data:
            return jsonify({"success": False, "message": "Username đã có tài khoản đăng nhập"}), 409

        emp_id = str(uuid.uuid4())
        email = data.get('email') or f'{username}@rriv.org.vn'
        data.setdefault('username', username)
        data.setdefault('email', email)
        if not data.get('employeeCode') and not data.get('code'):
            data['employeeCode'] = f'RRIV-{username.upper().replace(".", "-")}'

        row = {'id': emp_id, **_prepare_table_write('employee', data)}
        if not row.get('employee_code'):
            row['employee_code'] = data['employeeCode']
        if not row.get('full_name'):
            row['full_name'] = data.get('hoTen') or username
        if not row.get('employment_status'):
            row['employment_status'] = 'active'

        system_role_id = data.get('systemRoleId') or data.get('system_role_id')
        erp_role = _system_role_erp_role(system_role_id) if system_role_id else (data.get('role') or 'user')
        row['erp_role'] = erp_role
        meta = dict(row.get('metadata') or {})
        if system_role_id:
            meta['systemRoleId'] = int(system_role_id)
        row['metadata'] = meta

        app_cache = data.get('appRolesCache') or data.get('app_roles_cache')
        if app_cache:
            row['app_roles_cache'] = app_cache

        supabase.table('employee').insert(row).execute()
        supabase.table('user_accounts').insert({
            'username': username,
            'password': password,
            'display_name': row.get('full_name') or username,
            'email': email,
            'role': erp_role,
            'department': row.get('department_name') or data.get('department') or '',
            'employee_id': emp_id,
        }).execute()
        if system_role_id:
            _sync_user_system_role(username, system_role_id, assigned_by='create_personnel')
        if app_cache:
            _sync_user_app_roles(username, emp_id, app_cache)
        return jsonify({"success": True, "id": emp_id})
    except Exception as e:
        print(f"create_personnel: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


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
            if table == 'field_worker_weighings':
                use_id = _upsert_field_weighing(data, doc_id=doc_id if body.get('id') else None)
                return jsonify({"success": True, "id": use_id})
            row = _prepare_table_write(table, data, doc_id=doc_id if body.get('id') else None)
            if table == 'employee_assignment':
                if body.get('id'):
                    row['id'] = body.get('id')
                res = supabase.table(table).insert(row).execute()
                new_id = res.data[0]['id'] if res.data else doc_id
                return jsonify({"success": True, "id": str(new_id)})
            row = {'id': doc_id, **row}
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
            patch = _prepare_table_update(table, doc_id, data)
            if table == 'rubber_deliveries':
                rubber_ok = False
                try:
                    res = supabase.table(table).update(patch).eq('id', doc_id).execute()
                    if res.data and len(res.data) > 0:
                        rubber_ok = True
                    else:
                        supabase.table(table).upsert({'id': doc_id, **patch}).execute()
                        rubber_ok = True
                except Exception as rd_err:
                    print(f'rubber_deliveries write ({collection}/{doc_id}): {rd_err}')
                erp_ok = False
                try:
                    existing = (
                        supabase.table('erp_collections')
                        .select('data')
                        .eq('collection', collection)
                        .eq('id', doc_id)
                        .limit(1)
                        .execute()
                    )
                    if existing.data:
                        merged = dict(existing.data[0].get('data') or {})
                        merged.update(data)
                        supabase.table('erp_collections').update({'data': merged}).eq('id', doc_id).execute()
                    else:
                        supabase.table('erp_collections').insert({
                            'id': doc_id,
                            'collection': collection,
                            'data': data,
                            'created_by': data.get('updatedBy') or data.get('createdBy') or 'system',
                            'updated_by': data.get('updatedBy') or data.get('createdBy') or 'system',
                        }).execute()
                    erp_ok = True
                except Exception as sync_err:
                    print(f'erp_collections sync ({collection}/{doc_id}): {sync_err}')
                if not rubber_ok and not erp_ok:
                    raise RuntimeError('Không ghi được phiếu GN lên Supabase')
            else:
                supabase.table(table).update(patch).eq('id', doc_id).execute()
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
        if collection == 'rubberDeliveries' or not table:
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


def _chunked(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


@app.route('/api/harvest/assignments/bulk', methods=['POST'])
def bulk_save_harvest_assignments():
    """Ghi hàng loạt phân công phần cạo — ít round-trip hơn /api/data/batch."""
    body = request.json or {}
    date = body.get('date')
    items = body.get('items') or []
    meta_updates = body.get('sectionMetaUpdates') or []
    if not date:
        return jsonify({"success": False, "message": "Thiếu record_date"}), 400
    try:
        delete_ids = []
        upsert_by_id = {}
        for item in items:
            section_id = item.get('sectionId')
            if not section_id:
                continue
            for did in item.get('deleteIds') or []:
                if did:
                    delete_ids.append(str(did))
            for row in item.get('rows') or []:
                rid = row.get('id')
                worker_id = row.get('worker_id')
                if not rid or not worker_id:
                    continue
                upsert_by_id[str(rid)] = {
                    'id': str(rid),
                    'record_date': row.get('record_date') or date,
                    'tapping_section_id': row.get('tapping_section_id') or section_id,
                    'worker_id': worker_id,
                    'assignment_role': row.get('assignment_role') or 'tapper',
                    'notes': row.get('notes') or '',
                    'metadata': row.get('metadata') or {},
                }

        unique_delete_ids = list(dict.fromkeys(delete_ids))
        upsert_rows = list(upsert_by_id.values())

        for chunk in _chunked(unique_delete_ids, 80):
            supabase.table('section_worker_assignments').delete().in_('id', chunk).execute()

        for chunk in _chunked(upsert_rows, 80):
            supabase.table('section_worker_assignments').upsert(chunk).execute()

        for mu in meta_updates:
            sid = mu.get('sectionId')
            if not sid:
                continue
            supabase.table('tapping_sections').update({
                'metadata': mu.get('metadata') or {}
            }).eq('id', sid).execute()

        return jsonify({
            "success": True,
            "deleted": len(unique_delete_ids),
            "upserted": len(upsert_rows),
        })
    except Exception as e:
        print(f"bulk_save_harvest_assignments: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/harvest/weighings/range', methods=['GET'])
def harvest_weighings_range():
    """Tổng hợp sản lượng CN theo khoảng ngày (tuần / tháng / năm)."""
    from_date = request.args.get('from') or request.args.get('date_from')
    to_date = request.args.get('to') or request.args.get('date_to')
    if not from_date or not to_date:
        return jsonify({"success": False, "message": "Thiếu tham số from và to (YYYY-MM-DD)"}), 400
    try:
        res = (
            supabase.table('field_worker_weighings')
            .select('*')
            .gte('record_date', from_date)
            .lte('record_date', to_date)
            .execute()
        )
        docs = []
        for row in res.data or []:
            doc = _row_to_doc(row, use_data_field=False, table_name='field_worker_weighings')
            if doc:
                docs.append(doc)
        docs.sort(key=lambda d: (d.get('record_date') or '', d.get('tapping_section_id') or ''))
        return jsonify({"success": True, "data": docs, "from": from_date, "to": to_date})
    except Exception as e:
        print(f"harvest_weighings_range: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/harvest/delivery-totals', methods=['GET'])
def harvest_delivery_totals():
    """Tổng sản lượng phiếu GN theo ngày cạo — view Supabase (có lọc trạm + phiên)."""
    date_str = request.args.get('date') or request.args.get('tapping_date')
    team_id = request.args.get('team') or request.args.get('team_id')
    session = (request.args.get('session') or request.args.get('tapping_session') or '').strip()
    by_date_only = request.args.get('by_date') in ('1', 'true', 'yes')

    def _aggregate_gn_rows(rows):
        if not rows:
            return None
        keys = (
            'latex_fresh_kg', 'coag_fresh_kg', 'total_fresh_kg',
            'latex_dry_kg', 'coag_dry_kg', 'total_dry_kg',
        )
        out = {k: 0.0 for k in keys}
        out['receipt_count'] = 0
        for row in rows:
            out['receipt_count'] += int(row.get('receipt_count') or 0)
            for k in keys:
                out[k] += float(row.get(k) or 0)
        for k in keys:
            out[k] = round(out[k], 3)
        out['tapping_date'] = date_str
        if team_id:
            out['team'] = team_id
        if session:
            out['tapping_session'] = session
        return out

    if not date_str:
        return jsonify({"success": False, "message": "Thiếu tham số date (YYYY-MM-DD)"}), 400
    try:
        if by_date_only:
            res = (
                supabase.table('v_rubber_delivery_daily_totals_by_date')
                .select('*')
                .eq('tapping_date', date_str)
                .execute()
            )
            rows = res.data or []
            row = rows[0] if rows else None
            return jsonify({"success": True, "date": date_str, "data": row, "sessions": []})

        q = (
            supabase.table('v_rubber_delivery_daily_totals_by_session')
            .select('*')
            .eq('tapping_date', date_str)
        )
        if team_id:
            q = q.eq('team', team_id)
        if session and session != '__all__':
            q = q.eq('tapping_session', session)
        res = q.execute()
        session_rows = res.data or []

        if session and session != '__all__':
            row = session_rows[0] if session_rows else None
        else:
            row = _aggregate_gn_rows(session_rows)

        return jsonify({
            "success": True,
            "date": date_str,
            "team": team_id,
            "session": session or '__all__',
            "data": row,
            "sessions": session_rows,
        })
    except Exception as e:
        print(f"harvest_delivery_totals: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/data/batch', methods=['POST'])
def batch_write():
    body = request.json or {}
    idx = -1
    try:
        for idx, op in enumerate(body.get('operations', [])):
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
                    patch = _prepare_table_update(table, doc_id, data)
                    supabase.table(table).update(patch).eq('id', doc_id).execute()
                else:
                    existing = supabase.table('erp_collections').select('data').eq('collection', coll).eq('id', doc_id).limit(1).execute()
                    merged = dict(existing.data[0].get('data') or {}) if existing.data else {}
                    merged.update(data)
                    supabase.table('erp_collections').update({'data': merged}).eq('id', doc_id).execute()
            else:
                data = op.get('data') or {}
                table = TABLE_MAP.get(coll)
                if table:
                    row = _prepare_table_write(table, data, doc_id=doc_id if op.get('docId') else None)
                    if table == 'field_worker_weighings':
                        _upsert_field_weighing(data, doc_id=doc_id if op.get('docId') else None)
                    elif table == 'employee_assignment':
                        supabase.table(table).insert(row).execute()
                    else:
                        supabase.table(table).upsert({
                            'id': doc_id,
                            **row
                        }).execute()
                else:
                    supabase.table('erp_collections').insert({
                        'id': doc_id, 'collection': coll, 'data': data
                    }).execute()
        return jsonify({"success": True})
    except Exception as e:
        print(f"batch_write op#{idx}: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


if __name__ == '__main__':
    port = int(os.getenv('PORT', 8080))
    debug = os.getenv('FLASK_DEBUG', '1') == '1'
    app.run(debug=debug, host='0.0.0.0', port=port)

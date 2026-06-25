// =============================================
// Firebase Init
// =============================================
ErpDb.initializeApp({ projectId: 'rriv' });
var db = ErpDb.firestore();
var auth = ErpDb.auth();
var storage = ErpDb.storage();
auth.setPersistence(ErpDb.auth.Auth.Persistence.LOCAL);

// =============================================
// Global State
// =============================================
var currentUser = null;    // Firebase auth user
var userData = null;        // categoryPersonnel doc
var userRole = 'employee'; // 'admin' | 'manager' | 'employee'
var GV_APP_ID = 'giaoviec';
var userManagedDepts = [];  // dept IDs mà user quản lý
var allDepartments = [];
var allPersonnel = [];
var allPositions = [];       // categoryPositions (chức vụ)
var allTasks = [];          // cached workTasks
var myTasks = [];           // filtered for current user
var kpiData = [];           // cached kpiEvaluations (nhân viên)
var kpiCoordData = [];      // cached kpiEvaluations phối hợp (phòng ban)
var currentTaskFilter = 'all';
var currentMyTaskFilter = 'all';
var _batchSelected = [];
var assistantLeaderMappings = []; // mapping trợ lý ↔ lãnh đạo
var _prioLabels = { P1: 'Khẩn cấp', P2: 'Bình thường', P3: 'Không gấp' };
function getPrioLabel(p) { return _prioLabels[p] || _prioLabels.P3; }

/**
 * Validation Utility Module
 * Cung cấp các hàm validate input cho toàn bộ hệ thống
 * @module validation
 */

const Validation = (function() {
  'use strict';

  // ==================== REGEX PATTERNS ====================
  const PATTERNS = {
    // Email theo chuẩn RFC 5322 simplified
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,

    // Email nội bộ PHR
    emailPHR: /^[a-zA-Z0-9._-]+@phr\.vn$/,

    // Số điện thoại Việt Nam (10 số, bắt đầu 0)
    phoneVN: /^0[0-9]{9}$/,

    // Số điện thoại có mã quốc gia (+84)
    phoneIntl: /^\+84[0-9]{9}$/,

    // Username: chữ cái, số, dấu gạch dưới, 3-30 ký tự
    username: /^[a-zA-Z0-9_]{3,30}$/,

    // Password: tối thiểu 6 ký tự
    passwordBasic: /^.{6,}$/,

    // Password mạnh: 8+ ký tự, có chữ hoa, chữ thường, số
    passwordStrong: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/,

    // Chỉ chữ cái và khoảng trắng (tên người)
    nameOnly: /^[a-zA-ZÀ-ỹ\s]+$/,

    // Chỉ số
    numbersOnly: /^\d+$/,

    // Số thập phân
    decimal: /^\d+(\.\d{1,2})?$/,

    // Mã nhân viên: chữ và số, 3-20 ký tự
    employeeCode: /^[A-Z0-9]{3,20}$/i,

    // URL
    url: /^https?:\/\/.+/,

    // Date format: YYYY-MM-DD
    dateISO: /^\d{4}-\d{2}-\d{2}$/,

    // Date format: DD/MM/YYYY
    dateVN: /^\d{2}\/\d{2}\/\d{4}$/
  };

  // ==================== ERROR MESSAGES ====================
  const MESSAGES = {
    required: 'Trường này là bắt buộc',
    email: 'Email không hợp lệ',
    emailPHR: 'Email phải có đuôi @phr.vn',
    phone: 'Số điện thoại không hợp lệ (10 số, bắt đầu bằng 0)',
    username: 'Username chỉ chứa chữ cái, số và dấu gạch dưới (3-30 ký tự)',
    passwordBasic: 'Mật khẩu phải có ít nhất 6 ký tự',
    passwordStrong: 'Mật khẩu phải có ít nhất 8 ký tự, bao gồm chữ hoa, chữ thường và số',
    passwordMatch: 'Mật khẩu xác nhận không khớp',
    nameOnly: 'Chỉ được nhập chữ cái và khoảng trắng',
    numbersOnly: 'Chỉ được nhập số',
    decimal: 'Số không hợp lệ',
    minLength: 'Tối thiểu {min} ký tự',
    maxLength: 'Tối đa {max} ký tự',
    min: 'Giá trị tối thiểu là {min}',
    max: 'Giá trị tối đa là {max}',
    range: 'Giá trị phải từ {min} đến {max}',
    url: 'URL không hợp lệ',
    date: 'Ngày không hợp lệ',
    dateRange: 'Ngày kết thúc phải sau ngày bắt đầu',
    fileSize: 'File vượt quá kích thước cho phép ({max})',
    fileType: 'Loại file không được hỗ trợ',
    xss: 'Nội dung chứa ký tự không hợp lệ'
  };

  // ==================== SANITIZATION ====================

  /**
   * Loại bỏ HTML tags và XSS vectors
   * @param {string} input - Chuỗi cần sanitize
   * @returns {string} Chuỗi đã được sanitize
   */
  function sanitizeHTML(input) {
    if (typeof input !== 'string') return '';

    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * Loại bỏ script tags và event handlers
   * @param {string} input - Chuỗi cần sanitize
   * @returns {string} Chuỗi đã được sanitize
   */
  function stripScripts(input) {
    if (typeof input !== 'string') return '';

    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/javascript:/gi, '');
  }

  /**
   * Trim và normalize whitespace
   * @param {string} input - Chuỗi cần normalize
   * @returns {string} Chuỗi đã được normalize
   */
  function normalizeWhitespace(input) {
    if (typeof input !== 'string') return '';
    return input.trim().replace(/\s+/g, ' ');
  }

  /**
   * Sanitize object - áp dụng sanitize cho tất cả string fields
   * @param {Object} obj - Object cần sanitize
   * @returns {Object} Object đã được sanitize
   */
  function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    const sanitized = Array.isArray(obj) ? [] : {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];
        if (typeof value === 'string') {
          sanitized[key] = sanitizeHTML(normalizeWhitespace(value));
        } else if (typeof value === 'object' && value !== null) {
          sanitized[key] = sanitizeObject(value);
        } else {
          sanitized[key] = value;
        }
      }
    }

    return sanitized;
  }

  // ==================== VALIDATORS ====================

  /**
   * Validate required field
   * @param {*} value - Giá trị cần kiểm tra
   * @returns {Object} {valid: boolean, message: string}
   */
  function required(value) {
    const valid = value !== null && value !== undefined && String(value).trim() !== '';
    return { valid, message: valid ? '' : MESSAGES.required };
  }

  /**
   * Validate email
   * @param {string} email - Email cần kiểm tra
   * @param {boolean} phrOnly - Chỉ chấp nhận email @phr.vn
   * @returns {Object} {valid: boolean, message: string}
   */
  function email(email, phrOnly = false) {
    if (!email || !email.trim()) {
      return { valid: true, message: '' }; // Empty is valid (use required for mandatory)
    }

    if (phrOnly) {
      const valid = PATTERNS.emailPHR.test(email);
      return { valid, message: valid ? '' : MESSAGES.emailPHR };
    }

    const valid = PATTERNS.email.test(email);
    return { valid, message: valid ? '' : MESSAGES.email };
  }

  /**
   * Validate số điện thoại Việt Nam
   * @param {string} phone - Số điện thoại cần kiểm tra
   * @returns {Object} {valid: boolean, message: string}
   */
  function phone(phone) {
    if (!phone || !phone.trim()) {
      return { valid: true, message: '' };
    }

    // Loại bỏ khoảng trắng và dấu gạch
    const cleaned = phone.replace(/[\s-]/g, '');

    // Chấp nhận cả 0xxx và +84xxx
    const valid = PATTERNS.phoneVN.test(cleaned) || PATTERNS.phoneIntl.test(cleaned);
    return { valid, message: valid ? '' : MESSAGES.phone };
  }

  /**
   * Validate username
   * @param {string} username - Username cần kiểm tra
   * @returns {Object} {valid: boolean, message: string}
   */
  function username(username) {
    if (!username || !username.trim()) {
      return { valid: true, message: '' };
    }

    const valid = PATTERNS.username.test(username);
    return { valid, message: valid ? '' : MESSAGES.username };
  }

  /**
   * Validate password
   * @param {string} password - Password cần kiểm tra
   * @param {boolean} strong - Yêu cầu password mạnh
   * @returns {Object} {valid: boolean, message: string}
   */
  function password(password, strong = false) {
    if (!password) {
      return { valid: false, message: MESSAGES.required };
    }

    if (strong) {
      const valid = PATTERNS.passwordStrong.test(password);
      return { valid, message: valid ? '' : MESSAGES.passwordStrong };
    }

    const valid = PATTERNS.passwordBasic.test(password);
    return { valid, message: valid ? '' : MESSAGES.passwordBasic };
  }

  /**
   * Validate password confirmation
   * @param {string} password - Password gốc
   * @param {string} confirm - Password xác nhận
   * @returns {Object} {valid: boolean, message: string}
   */
  function passwordMatch(password, confirm) {
    const valid = password === confirm;
    return { valid, message: valid ? '' : MESSAGES.passwordMatch };
  }

  /**
   * Validate độ dài chuỗi
   * @param {string} value - Giá trị cần kiểm tra
   * @param {number} min - Độ dài tối thiểu
   * @param {number} max - Độ dài tối đa
   * @returns {Object} {valid: boolean, message: string}
   */
  function length(value, min = 0, max = Infinity) {
    if (!value) value = '';
    const len = String(value).length;

    if (len < min) {
      return { valid: false, message: MESSAGES.minLength.replace('{min}', min) };
    }
    if (len > max) {
      return { valid: false, message: MESSAGES.maxLength.replace('{max}', max) };
    }
    return { valid: true, message: '' };
  }

  /**
   * Validate số trong khoảng
   * @param {number} value - Giá trị cần kiểm tra
   * @param {number} min - Giá trị tối thiểu
   * @param {number} max - Giá trị tối đa
   * @returns {Object} {valid: boolean, message: string}
   */
  function range(value, min = -Infinity, max = Infinity) {
    const num = Number(value);

    if (isNaN(num)) {
      return { valid: false, message: MESSAGES.numbersOnly };
    }

    if (num < min) {
      return { valid: false, message: MESSAGES.min.replace('{min}', min) };
    }
    if (num > max) {
      return { valid: false, message: MESSAGES.max.replace('{max}', max) };
    }

    return { valid: true, message: '' };
  }

  /**
   * Validate ngày tháng
   * @param {string} dateStr - Chuỗi ngày cần kiểm tra
   * @returns {Object} {valid: boolean, message: string}
   */
  function date(dateStr) {
    if (!dateStr) {
      return { valid: true, message: '' };
    }

    // Chấp nhận cả ISO và VN format
    const isValidFormat = PATTERNS.dateISO.test(dateStr) || PATTERNS.dateVN.test(dateStr);
    if (!isValidFormat) {
      return { valid: false, message: MESSAGES.date };
    }

    // Kiểm tra ngày hợp lệ
    const d = new Date(dateStr);
    const valid = !isNaN(d.getTime());
    return { valid, message: valid ? '' : MESSAGES.date };
  }

  /**
   * Validate khoảng thời gian
   * @param {string} startDate - Ngày bắt đầu
   * @param {string} endDate - Ngày kết thúc
   * @returns {Object} {valid: boolean, message: string}
   */
  function dateRange(startDate, endDate) {
    if (!startDate || !endDate) {
      return { valid: true, message: '' };
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    const valid = end >= start;
    return { valid, message: valid ? '' : MESSAGES.dateRange };
  }

  /**
   * Validate file size
   * @param {File} file - File cần kiểm tra
   * @param {number} maxSizeMB - Kích thước tối đa (MB)
   * @returns {Object} {valid: boolean, message: string}
   */
  function fileSize(file, maxSizeMB = 5) {
    if (!file) return { valid: true, message: '' };

    const maxBytes = maxSizeMB * 1024 * 1024;
    const valid = file.size <= maxBytes;
    return {
      valid,
      message: valid ? '' : MESSAGES.fileSize.replace('{max}', maxSizeMB + 'MB')
    };
  }

  /**
   * Validate file type
   * @param {File} file - File cần kiểm tra
   * @param {string[]} allowedTypes - Danh sách MIME types cho phép
   * @returns {Object} {valid: boolean, message: string}
   */
  function fileType(file, allowedTypes = []) {
    if (!file || allowedTypes.length === 0) {
      return { valid: true, message: '' };
    }

    const valid = allowedTypes.includes(file.type);
    return { valid, message: valid ? '' : MESSAGES.fileType };
  }

  /**
   * Kiểm tra XSS vectors
   * @param {string} input - Chuỗi cần kiểm tra
   * @returns {Object} {valid: boolean, message: string}
   */
  function noXSS(input) {
    if (!input) return { valid: true, message: '' };

    const xssPatterns = [
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i,
      /<iframe/i,
      /<object/i,
      /<embed/i
    ];

    const hasXSS = xssPatterns.some(pattern => pattern.test(input));
    return { valid: !hasXSS, message: hasXSS ? MESSAGES.xss : '' };
  }

  // ==================== FORM VALIDATION ====================

  /**
   * Validate toàn bộ form
   * @param {Object} formData - Object chứa data của form
   * @param {Object} rules - Object chứa rules validate cho từng field
   * @returns {Object} {valid: boolean, errors: Object}
   *
   * @example
   * const rules = {
   *   username: ['required', 'username'],
   *   email: ['required', {email: true, phrOnly: true}],
   *   password: ['required', {password: true, strong: true}],
   *   age: [{range: {min: 18, max: 65}}]
   * };
   * const result = Validation.validateForm(formData, rules);
   */
  function validateForm(formData, rules) {
    const errors = {};
    let valid = true;

    for (const field in rules) {
      const fieldRules = rules[field];
      const value = formData[field];

      for (const rule of fieldRules) {
        let result;

        if (rule === 'required') {
          result = required(value);
        } else if (rule === 'email') {
          result = email(value);
        } else if (rule === 'phone') {
          result = phone(value);
        } else if (rule === 'username') {
          result = username(value);
        } else if (rule === 'noXSS') {
          result = noXSS(value);
        } else if (typeof rule === 'object') {
          // Complex rules
          if (rule.email) {
            result = email(value, rule.phrOnly);
          } else if (rule.password) {
            result = password(value, rule.strong);
          } else if (rule.length) {
            result = length(value, rule.length.min, rule.length.max);
          } else if (rule.range) {
            result = range(value, rule.range.min, rule.range.max);
          } else if (rule.date) {
            result = date(value);
          } else if (rule.fileSize) {
            result = fileSize(value, rule.fileSize);
          } else if (rule.fileType) {
            result = fileType(value, rule.fileType);
          } else if (rule.match) {
            result = passwordMatch(formData[rule.match], value);
          }
        }

        if (result && !result.valid) {
          errors[field] = result.message;
          valid = false;
          break; // Stop at first error for this field
        }
      }
    }

    return { valid, errors };
  }

  /**
   * Hiển thị lỗi validation trên form
   * @param {Object} errors - Object chứa lỗi từ validateForm
   * @param {string} prefix - Prefix của ID các elements (default: '')
   */
  function showFormErrors(errors, prefix = '') {
    // Clear previous errors
    document.querySelectorAll('.validation-error').forEach(el => {
      el.textContent = '';
      el.style.display = 'none';
    });
    document.querySelectorAll('.input-error').forEach(el => {
      el.classList.remove('input-error');
    });

    // Show new errors
    for (const field in errors) {
      const inputId = prefix ? `${prefix}-${field}` : field;
      const input = document.getElementById(inputId);
      const errorEl = document.getElementById(`${inputId}-error`);

      if (input) {
        input.classList.add('input-error');
      }
      if (errorEl) {
        errorEl.textContent = errors[field];
        errorEl.style.display = 'block';
      }
    }
  }

  /**
   * Clear tất cả lỗi validation
   * @param {string} formId - ID của form (optional)
   */
  function clearFormErrors(formId) {
    const container = formId ? document.getElementById(formId) : document;
    if (!container) return;

    container.querySelectorAll('.validation-error').forEach(el => {
      el.textContent = '';
      el.style.display = 'none';
    });
    container.querySelectorAll('.input-error').forEach(el => {
      el.classList.remove('input-error');
    });
  }

  // ==================== PUBLIC API ====================
  return {
    // Patterns
    PATTERNS,
    MESSAGES,

    // Sanitization
    sanitizeHTML,
    stripScripts,
    normalizeWhitespace,
    sanitizeObject,

    // Individual validators
    required,
    email,
    phone,
    username,
    password,
    passwordMatch,
    length,
    range,
    date,
    dateRange,
    fileSize,
    fileType,
    noXSS,

    // Form validation
    validateForm,
    showFormErrors,
    clearFormErrors
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Validation;
}

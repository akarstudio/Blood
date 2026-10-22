import { BloodGroup, ALL_BLOOD_GROUPS } from '../types';

/**
 * Normalizes email address by trimming whitespace and converting to lowercase.
 */
export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

/**
 * Validates whether an email string looks like a standard valid email.
 */
export function isValidEmail(email: string): boolean {
  if (!email) return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return re.test(email.trim());
}

/**
 * Validates and normalizes Bangladesh phone numbers.
 * Valid mobile operator codes in Bangladesh: 013, 014, 015, 016, 017, 018, 019.
 * Accepts:
 *   - "01712345678" (11 digits)
 *   - "+8801712345678"
 *   - "8801712345678"
 *   - with spaces or dashes: "01712-345678"
 * Returns normalized 11-digit local string "01XXXXXXXXX" or null if invalid.
 */
export function normalizeBangladeshPhone(rawPhone: string): string | null {
  if (!rawPhone) return null;
  // Remove spaces, hyphens, parentheses, plus
  const cleaned = rawPhone.replace(/[\s\-\(\)\+]/g, '');

  let normalized = cleaned;
  if (normalized.startsWith('880')) {
    normalized = '0' + normalized.slice(3);
  }

  // Exactly 11 digits, starts with 01[3-9]
  const bdRegex = /^01[3-9]\d{8}$/;
  if (bdRegex.test(normalized)) {
    return normalized;
  }
  return null;
}

export function formatBangladeshPhone(phone: string): string {
  const norm = normalizeBangladeshPhone(phone);
  if (!norm) return phone;
  // Format as 01712-345678
  return `${norm.slice(0, 5)}-${norm.slice(5)}`;
}

export function isValidBloodGroup(bg: string): bg is BloodGroup {
  return ALL_BLOOD_GROUPS.includes(bg as BloodGroup);
}

/**
 * Sanitizes cell values to prevent Spreadsheet Formula Injection (CSV Injection).
 * Any cell starting with =, +, -, @, \t, or \r is prefixed with a single quote.
 */
export function sanitizeForSpreadsheet(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/^[=\+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

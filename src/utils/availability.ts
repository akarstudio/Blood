import { Donor, AvailabilityStatus } from '../types';
import { formatBangladeshPhone } from './validation';
export { formatBangladeshPhone };

/**
 * Adds an integer number of calendar months to a YYYY-MM-DD date string.
 * Accurately handles month-end clamping (e.g. Jan 31 + 3 months -> Apr 30)
 * and leap years (e.g. Nov 30, 2023 + 3 months -> Feb 29, 2024).
 */
export function addCalendarMonths(dateStr: string, monthsToAdd: number): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format for addCalendarMonths: expected YYYY-MM-DD, got "${dateStr}"`);
  }

  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10); // 1-12
  const day = parseInt(dayStr, 10);

  // Add months
  const totalMonths = month - 1 + monthsToAdd;
  year += Math.floor(totalMonths / 12);
  month = (totalMonths % 12) + 1;

  // Days in target month
  // Day 0 of next month gives the last day of target month
  const maxDaysInTargetMonth = new Date(year, month, 0).getDate();
  const clampedDay = Math.min(day, maxDaysInTargetMonth);

  const formattedMonth = String(month).padStart(2, '0');
  const formattedDay = String(clampedDay).padStart(2, '0');

  return `${year}-${formattedMonth}-${formattedDay}`;
}

/**
 * Returns the current calendar date string (YYYY-MM-DD) in Asia/Dhaka timezone.
 */
export function getBangladeshCurrentDate(referenceDate: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // 'en-CA' outputs YYYY-MM-DD
  return formatter.format(referenceDate);
}

/**
 * Formats a date/timestamp in Asia/Dhaka time zone for user-facing UI.
 */
export function formatBangladeshDateTime(value: string | Date | number | undefined): string {
  if (!value) return 'N/A';
  const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value;
  if (isNaN(date.getTime())) return 'N/A';

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

export function formatBangladeshDateOnly(value: string | Date | undefined): string {
  if (!value) return 'N/A';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(date.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/**
 * Robustly parses various date formats from spreadsheets, forms, and user inputs into standard ISO YYYY-MM-DD.
 * Supports:
 * - JavaScript Date objects (e.g. from SheetJS cellDates: true)
 * - Excel 1900 numeric serial codes (e.g. 45430, 44927)
 * - Standard ISO format (YYYY-MM-DD or with time e.g. 2024-05-18T00:00:00.000Z)
 * - Bangladesh/International format (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, e.g. 18/05/2024)
 * - US format (MM/DD/YYYY, e.g. 05/18/2024)
 * - Slashed ISO (YYYY/MM/DD)
 * - English written dates (e.g. "18 May 2024", "May 18, 2024")
 * - Disregards words like "never", "n/a", "none", "-", ""
 */
export function parseFlexibleDate(val: any): string {
  if (val === null || val === undefined) return '';

  // 1. If it's a native Date instance
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 2. If it's a number (Excel 1900 date serial code, e.g. 45430)
  if (typeof val === 'number') {
    if (val <= 0 || isNaN(val)) return '';
    // Excel base date is 1899-12-30 (due to Lotus 1-2-3 1900 leap year bug) -> 25569 days to 1970-01-01
    const utcDays = val - 25569;
    const date = new Date(Math.round(utcDays * 86400 * 1000));
    if (isNaN(date.getTime())) return '';
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    if (y < 1900 || y > 2100) return '';
    return `${y}-${m}-${d}`;
  }

  let str = String(val).trim();
  if (!str) return '';

  const lower = str.toLowerCase();
  if (['never', 'n/a', 'na', 'none', '-', 'null', 'undefined', 'no', '0', 'not yet', 'unrecorded'].includes(lower)) {
    return '';
  }

  // 3. Numeric string (e.g. "45430")
  if (/^\d{5}(\.\d+)?$/.test(str)) {
    const num = parseFloat(str);
    const utcDays = num - 25569;
    const date = new Date(Math.round(utcDays * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      if (y >= 1900 && y <= 2100) {
        return `${y}-${m}-${d}`;
      }
    }
  }

  // 4. ISO with timestamp (e.g. 2024-05-18T14:30:00... or 2024-05-18 12:00:00)
  if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(str)) {
    return str.substring(0, 10);
  }

  // 5. Standard YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) {
    const [y, m, d] = str.split('-');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // 6. YYYY/MM/DD
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(str)) {
    const [y, m, d] = str.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // 7. DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, or MM/DD/YYYY
  const delimiterMatch = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (delimiterMatch) {
    const p1 = parseInt(delimiterMatch[1], 10);
    const p2 = parseInt(delimiterMatch[2], 10);
    const yr = delimiterMatch[3];

    let day = p1;
    let month = p2;
    if (p2 > 12 && p1 <= 12) {
      // e.g. 05/18/2024 -> month=5, day=18
      month = p1;
      day = p2;
    } else if (p1 > 12) {
      // e.g. 18/05/2024 -> day=18, month=5
      day = p1;
      month = p2;
    } else {
      // Both <= 12, Bangladesh standard format is DD/MM/YYYY
      day = p1;
      month = p2;
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${yr}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // 8. General Date parsing fallback (e.g. "18 May 2024", "May 18, 2024")
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    if (y >= 1900 && y <= 2100) {
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  return '';
}

export interface AvailabilityCalculationResult {
  isAvailable: boolean;
  calculatedAvailability: AvailabilityStatus;
  eligibilityDate?: string;
  reason: string;
}

/**
 * Pure calculation function for donor availability.
 * Centralized across donor search, donor profiles, and admin operations.
 *
 * Rules:
 * 1. Contact verification must be 'verified'
 * 2. Approval status must be 'approved'
 * 3. Account status must be 'active'
 * 4. Declared availability must NOT be 'unavailable' (explicit donor opt-out persists)
 * 5. If last donation date is recorded, Today in Asia/Dhaka must be >= eligibilityDate (lastDonationDate + minimumIntervalMonths).
 * 6. If no last donation date is recorded, donor is a voluntary first-time donor and eligible immediately.
 */
export function calculateDonorAvailability(
  donor: Pick<Donor, 
    'contactVerificationStatus' | 
    'approvalStatus' | 
    'accountStatus' | 
    'declaredAvailability' | 
    'lastDonationDate'
  >,
  minimumIntervalMonths: number = 3,
  currentBangladeshDateStr?: string
): AvailabilityCalculationResult {
  const todayInDhaka = currentBangladeshDateStr || getBangladeshCurrentDate();

  if (donor.accountStatus !== 'active') {
    return {
      isAvailable: false,
      calculatedAvailability: 'unavailable',
      reason: `Account is ${donor.accountStatus}.`,
    };
  }

  if (donor.approvalStatus !== 'approved') {
    return {
      isAvailable: false,
      calculatedAvailability: 'unavailable',
      reason: `Donor registration is ${donor.approvalStatus} (not yet approved by administrator).`,
    };
  }

  if (donor.contactVerificationStatus !== 'verified') {
    return {
      isAvailable: false,
      calculatedAvailability: 'unavailable',
      reason: 'Contact information is not yet verified.',
    };
  }

  if (donor.declaredAvailability === 'unavailable') {
    return {
      isAvailable: false,
      calculatedAvailability: 'unavailable',
      reason: 'Donor has explicitly set their status to unavailable.',
    };
  }

  // Parse and normalize last donation date if provided
  const cleanedLastDonation = donor.lastDonationDate ? parseFlexibleDate(donor.lastDonationDate) : '';

  // If no last donation date is recorded, the donor has no resting restriction (eligible immediately)
  if (!cleanedLastDonation) {
    return {
      isAvailable: true,
      calculatedAvailability: 'available',
      eligibilityDate: todayInDhaka,
      reason: 'Eligible to donate immediately (no prior donation resting interval required).',
    };
  }

  const eligibilityDate = addCalendarMonths(cleanedLastDonation, minimumIntervalMonths);

  // Compare YYYY-MM-DD lexicographically (valid because ISO format YYYY-MM-DD compares chronologically)
  if (todayInDhaka < eligibilityDate) {
    return {
      isAvailable: false,
      calculatedAvailability: 'unavailable',
      eligibilityDate,
      reason: `Waiting period in effect. Eligible to donate on ${eligibilityDate} (Bangladesh Standard Time).`,
    };
  }

  return {
    isAvailable: true,
    calculatedAvailability: 'available',
    eligibilityDate,
    reason: 'Donor satisfies all verification, approval, and calendar interval conditions.',
  };
}

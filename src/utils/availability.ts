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
 * 5. A valid last donation date must exist. If unknown, the donor is NOT automatically eligible.
 * 6. Today in Asia/Dhaka must be >= eligibilityDate (lastDonationDate + minimumIntervalMonths).
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

  if (!donor.lastDonationDate || !/^\d{4}-\d{2}-\d{2}$/.test(donor.lastDonationDate)) {
    return {
      isAvailable: false,
      calculatedAvailability: 'unavailable',
      reason: 'Last donation date is unknown or unrecorded. A recorded date is required to verify the minimum interval.',
    };
  }

  const eligibilityDate = addCalendarMonths(donor.lastDonationDate, minimumIntervalMonths);

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

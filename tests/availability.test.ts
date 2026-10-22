import { describe, it, expect } from 'vitest';
import { 
  addCalendarMonths, 
  calculateDonorAvailability, 
  getBangladeshCurrentDate 
} from '../src/utils/availability';
import { Donor } from '../src/types';

describe('Donor Availability Policy & Calculation Engine', () => {
  describe('Calendar Month Arithmetic & Edge Cases', () => {
    it('accurately adds 3 calendar months to a standard mid-month date', () => {
      expect(addCalendarMonths('2026-03-15', 3)).toBe('2026-06-15');
      expect(addCalendarMonths('2026-05-10', 3)).toBe('2026-08-10');
    });

    it('handles January 31 month-end clamping (Jan 31 + 3 months -> Apr 30, not May 1)', () => {
      // April has only 30 days
      expect(addCalendarMonths('2026-01-31', 3)).toBe('2026-04-30');
    });

    it('handles August 31 month-end clamping (Aug 31 + 3 months -> Nov 30)', () => {
      // November has only 30 days
      expect(addCalendarMonths('2026-08-31', 3)).toBe('2026-11-30');
    });

    it('handles Leap Year calculation correctly (Nov 30, 2023 + 3 months -> Feb 29, 2024)', () => {
      // 2024 is a leap year
      expect(addCalendarMonths('2023-11-30', 3)).toBe('2024-02-29');
    });

    it('handles Non-Leap Year February clamping (Nov 30, 2024 + 3 months -> Feb 28, 2025)', () => {
      // 2025 is not a leap year
      expect(addCalendarMonths('2024-11-30', 3)).toBe('2025-02-28');
    });

    it('handles year transitions cleanly', () => {
      expect(addCalendarMonths('2026-10-15', 3)).toBe('2027-01-15');
      expect(addCalendarMonths('2026-12-31', 3)).toBe('2027-03-31');
    });

    it('throws error if malformed date string is passed', () => {
      expect(() => addCalendarMonths('invalid-date', 3)).toThrow();
    });
  });

  describe('Authoritative Availability Policy Rules', () => {
    const baseDonor: Pick<Donor, 
      'contactVerificationStatus' | 
      'approvalStatus' | 
      'accountStatus' | 
      'declaredAvailability' | 
      'lastDonationDate'
    > = {
      contactVerificationStatus: 'verified',
      approvalStatus: 'approved',
      accountStatus: 'active',
      declaredAvailability: 'available',
      lastDonationDate: '2026-01-01',
    };

    it('marks donor available if current date is strictly AFTER eligibility date', () => {
      // Last donation: 2026-01-01 -> Eligibility: 2026-04-01
      // Current date: 2026-04-15
      const result = calculateDonorAvailability(baseDonor, 3, '2026-04-15');
      expect(result.isAvailable).toBe(true);
      expect(result.calculatedAvailability).toBe('available');
      expect(result.eligibilityDate).toBe('2026-04-01');
    });

    it('marks donor available EXACTLY on eligibility date', () => {
      // Current date: 2026-04-01
      const result = calculateDonorAvailability(baseDonor, 3, '2026-04-01');
      expect(result.isAvailable).toBe(true);
      expect(result.calculatedAvailability).toBe('available');
      expect(result.eligibilityDate).toBe('2026-04-01');
    });

    it('marks donor unavailable if current date is BEFORE eligibility date', () => {
      // Current date: 2026-03-31
      const result = calculateDonorAvailability(baseDonor, 3, '2026-03-31');
      expect(result.isAvailable).toBe(false);
      expect(result.calculatedAvailability).toBe('unavailable');
      expect(result.eligibilityDate).toBe('2026-04-01');
      expect(result.reason).toContain('Waiting period in effect');
    });

    it('rejects availability if last donation date is unknown or missing', () => {
      const donorWithoutDate = {
        ...baseDonor,
        lastDonationDate: undefined,
      };
      const result = calculateDonorAvailability(donorWithoutDate, 3, '2026-05-01');
      expect(result.isAvailable).toBe(false);
      expect(result.calculatedAvailability).toBe('unavailable');
      expect(result.reason).toContain('Last donation date is unknown');
    });

    it('respects explicit donor unavailability opt-out even after interval expires', () => {
      const optOutDonor = {
        ...baseDonor,
        declaredAvailability: 'unavailable' as const,
      };
      const result = calculateDonorAvailability(optOutDonor, 3, '2026-05-01');
      expect(result.isAvailable).toBe(false);
      expect(result.calculatedAvailability).toBe('unavailable');
      expect(result.reason).toContain('explicitly set their status to unavailable');
    });

    it('marks unapproved donors unavailable regardless of donation date', () => {
      const unapprovedDonor = {
        ...baseDonor,
        approvalStatus: 'pending' as const,
      };
      const result = calculateDonorAvailability(unapprovedDonor, 3, '2026-05-01');
      expect(result.isAvailable).toBe(false);
      expect(result.calculatedAvailability).toBe('unavailable');
      expect(result.reason).toContain('not yet approved by administrator');
    });

    it('marks unverified contact donors unavailable regardless of donation date', () => {
      const unverifiedDonor = {
        ...baseDonor,
        contactVerificationStatus: 'unverified' as const,
      };
      const result = calculateDonorAvailability(unverifiedDonor, 3, '2026-05-01');
      expect(result.isAvailable).toBe(false);
      expect(result.calculatedAvailability).toBe('unavailable');
      expect(result.reason).toContain('not yet verified');
    });

    it('marks suspended or deactivated donors unavailable', () => {
      const suspendedDonor = {
        ...baseDonor,
        accountStatus: 'suspended' as const,
      };
      const result = calculateDonorAvailability(suspendedDonor, 3, '2026-05-01');
      expect(result.isAvailable).toBe(false);
      expect(result.calculatedAvailability).toBe('unavailable');
      expect(result.reason).toContain('Account is suspended');
    });

    it('dynamically adapts when minimum interval is changed (e.g. from 3 to 4 months)', () => {
      // Last donation: 2026-01-01
      // Under 3 months -> Eligible 2026-04-01
      // Under 4 months -> Eligible 2026-05-01
      // On 2026-04-15:
      const check3Mo = calculateDonorAvailability(baseDonor, 3, '2026-04-15');
      const check4Mo = calculateDonorAvailability(baseDonor, 4, '2026-04-15');

      expect(check3Mo.isAvailable).toBe(true);
      expect(check4Mo.isAvailable).toBe(false);
      expect(check4Mo.eligibilityDate).toBe('2026-05-01');
    });

    it('transitions calculated status from unavailable to available when admin approves verification', () => {
      const pendingDonor = {
        ...baseDonor,
        contactVerificationStatus: 'unverified' as const,
        lastDonationDate: '2026-01-01',
      };

      // Before verification approval: unavailable
      const beforeApproval = calculateDonorAvailability(pendingDonor, 3, '2026-05-01');
      expect(beforeApproval.calculatedAvailability).toBe('unavailable');

      // Admin approves contact verification
      const afterVerificationApproval = calculateDonorAvailability({
        ...pendingDonor,
        contactVerificationStatus: 'verified',
      }, 3, '2026-05-01');

      expect(afterVerificationApproval.calculatedAvailability).toBe('available');
      expect(afterVerificationApproval.isAvailable).toBe(true);
    });

    it('transitions calculated status to available when admin approves both registration and verification together', () => {
      const rawApplicant = {
        approvalStatus: 'pending' as const,
        contactVerificationStatus: 'unverified' as const,
        accountStatus: 'active' as const,
        declaredAvailability: 'available' as const,
        lastDonationDate: '2026-01-01',
      };

      // Initially unavailable
      expect(calculateDonorAvailability(rawApplicant, 3, '2026-05-01').calculatedAvailability).toBe('unavailable');

      // Admin executes full approval (approvalStatus: approved, contactVerificationStatus: verified)
      const fullyApproved = calculateDonorAvailability({
        ...rawApplicant,
        approvalStatus: 'approved',
        contactVerificationStatus: 'verified',
      }, 3, '2026-05-01');

      expect(fullyApproved.calculatedAvailability).toBe('available');
      expect(fullyApproved.isAvailable).toBe(true);
    });
  });
});

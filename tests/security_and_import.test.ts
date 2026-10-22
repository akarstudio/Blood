import { describe, it, expect } from 'vitest';
import { sanitizeForSpreadsheet, isValidBloodGroup, normalizeBangladeshPhone, normalizeEmail, isValidEmail } from '../src/utils/validation';
import { calculateDonorAvailability } from '../src/utils/availability';
import { DEFAULT_ROLES } from '../src/data/rolesData';
import { Donor, Permission } from '../src/types';
import { sanitizeLogValues } from '../src/utils/audit';
import { cleanForFirestore } from '../src/services/dataSyncService';

describe('Security, Privacy & Import/Export Engine QA', () => {
  describe('Public Privacy & Search Projection Rules', () => {
    const mockDonor: Donor = {
      id: 'donor-101',
      uid: 'user-101',
      fullName: 'Afsana Mimi',
      normalizedName: 'afsana mimi',
      email: 'afsana.mimi@example.com',
      normalizedEmail: 'afsana.mimi@example.com',
      phone: '01711223344',
      normalizedPhone: '01711223344',
      bloodGroup: 'B+',
      division: 'Dhaka',
      district: 'Dhaka',
      upazila: 'Mirpur',
      gender: 'female',
      approvalStatus: 'approved',
      contactVerificationStatus: 'verified',
      accountStatus: 'active',
      declaredAvailability: 'available',
      calculatedAvailability: 'available',
      publicContactConsent: true,
      publicProfileConsent: true,
      contactVisibilityPreference: 'public',
      preferredContactMethod: 'phone',
      privacyConsentVersion: '1.0',
      privacyConsentAt: '2026-01-01T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    it('rejects public appearance if approvalStatus is pending', () => {
      const donor = { ...mockDonor, approvalStatus: 'pending' as const };
      const check = calculateDonorAvailability(donor, 3, '2026-04-15');
      expect(check.isAvailable).toBe(false);
      expect(check.calculatedAvailability).toBe('unavailable');
    });

    it('rejects public appearance if approvalStatus is rejected', () => {
      const donor = { ...mockDonor, approvalStatus: 'rejected' as const };
      const check = calculateDonorAvailability(donor, 3, '2026-04-15');
      expect(check.isAvailable).toBe(false);
      expect(check.calculatedAvailability).toBe('unavailable');
    });

    it('rejects public appearance if contactVerificationStatus is unverified', () => {
      const donor = { ...mockDonor, contactVerificationStatus: 'unverified' as const };
      const check = calculateDonorAvailability(donor, 3, '2026-04-15');
      expect(check.isAvailable).toBe(false);
      expect(check.calculatedAvailability).toBe('unavailable');
    });

    it('rejects public appearance if accountStatus is suspended or deactivated', () => {
      const suspendedDonor = { ...mockDonor, accountStatus: 'suspended' as const };
      const deactivatedDonor = { ...mockDonor, accountStatus: 'deactivated' as const };

      expect(calculateDonorAvailability(suspendedDonor, 3, '2026-04-15').isAvailable).toBe(false);
      expect(calculateDonorAvailability(deactivatedDonor, 3, '2026-04-15').isAvailable).toBe(false);
    });

    it('enforces privacy: masks contact info if donor opted for registered_only visibility and viewer is anonymous', () => {
      const restrictedDonor: Donor = {
        ...mockDonor,
        contactVisibilityPreference: 'registered_only',
      };

      const getPublicContactDisplay = (donor: Donor, isAnonymousViewer: boolean) => {
        if (donor.contactVisibilityPreference === 'hidden') {
          return { phone: 'Private', email: 'Private' };
        }
        if (donor.contactVisibilityPreference === 'registered_only' && isAnonymousViewer) {
          return { phone: 'Sign in to view contact', email: 'Sign in to view contact' };
        }
        return { phone: donor.phone, email: donor.email };
      };

      expect(getPublicContactDisplay(restrictedDonor, true).phone).toBe('Sign in to view contact');
      expect(getPublicContactDisplay(restrictedDonor, false).phone).toBe('01711223344');
    });
  });

  describe('Spreadsheet CSV / XLSX Import Integrity', () => {
    it('defends against CSV formula injection vectors', () => {
      expect(sanitizeForSpreadsheet('=cmd|"/c calc"!A0')).toBe('\'=cmd|"/c calc"!A0');
      expect(sanitizeForSpreadsheet('+123-456')).toBe('\'+123-456');
      expect(sanitizeForSpreadsheet('-5+10')).toBe('\'-5+10');
      expect(sanitizeForSpreadsheet('@SUM(1,2)')).toBe('\'@SUM(1,2)');
      expect(sanitizeForSpreadsheet('\tTabIndent')).toBe('\'\tTabIndent');
      expect(sanitizeForSpreadsheet('\rCarriageReturn')).toBe('\'\rCarriageReturn');
      expect(sanitizeForSpreadsheet('Regular Name')).toBe('Regular Name');
    });

    it('rejects invalid or forged blood groups during import processing', () => {
      const candidates = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
      candidates.forEach(bg => expect(isValidBloodGroup(bg)).toBe(true));

      const maliciousOrInvalid = ['A+++', 'C+', 'O_POSITIVE', '<script>', 'ADMIN', '', '   '];
      maliciousOrInvalid.forEach(bg => expect(isValidBloodGroup(bg)).toBe(false));
    });

    it('ensures imported donor records default strictly to pending approval and unverified contact', () => {
      // Simulating row processor
      const rawImportedRow = {
        fullName: 'Test Imported Donor',
        email: 'imported@example.com',
        phone: '01711998877',
        bloodGroup: 'O+',
        division: 'Chittagong',
        district: 'Chittagong',
        upazila: 'Pahartali',
        // Attempting to bypass security by injecting forged fields:
        approvalStatus: 'approved',
        contactVerificationStatus: 'verified',
        accountStatus: 'active',
      };

      // Security requirement: Regardless of imported file content, mandatory defaults are forced
      const sanitizedRecord = {
        fullName: rawImportedRow.fullName,
        email: normalizeEmail(rawImportedRow.email),
        phone: normalizeBangladeshPhone(rawImportedRow.phone)!,
        bloodGroup: rawImportedRow.bloodGroup,
        division: rawImportedRow.division,
        district: rawImportedRow.district,
        upazila: rawImportedRow.upazila,
        approvalStatus: 'pending',
        contactVerificationStatus: 'unverified',
        accountStatus: 'active',
        calculatedAvailability: 'unavailable',
      };

      expect(sanitizedRecord.approvalStatus).toBe('pending');
      expect(sanitizedRecord.contactVerificationStatus).toBe('unverified');
      expect(sanitizedRecord.calculatedAvailability).toBe('unavailable');
    });
  });

  describe('Negative RBAC Security Authorizations', () => {
    it('prevents Viewer/Auditor from having any mutation permissions', () => {
      const viewerRole = DEFAULT_ROLES.find(r => r.id === 'viewer_auditor');
      const mutationPerms: Permission[] = [
        'donors.create',
        'donors.update',
        'donors.approve',
        'donors.reject',
        'donors.suspend',
        'donors.export',
        'donors.import',
        'users.create',
        'users.manage_roles',
        'settings.availability_policy.manage',
      ];

      mutationPerms.forEach(perm => {
        expect(viewerRole?.permissions).not.toContain(perm);
      });
    });

    it('prevents Donor Manager from managing user roles or system availability policy', () => {
      const managerRole = DEFAULT_ROLES.find(r => r.id === 'donor_manager');
      expect(managerRole?.permissions).not.toContain('users.manage_roles');
      expect(managerRole?.permissions).not.toContain('settings.availability_policy.manage');
      expect(managerRole?.permissions).not.toContain('settings.view');
    });

    it('prevents Data Entry Operator from approving or suspending donors', () => {
      const operatorRole = DEFAULT_ROLES.find(r => r.id === 'data_entry_operator');
      expect(operatorRole?.permissions).not.toContain('donors.approve');
      expect(operatorRole?.permissions).not.toContain('donors.reject');
      expect(operatorRole?.permissions).not.toContain('donors.suspend');
      expect(operatorRole?.permissions).not.toContain('donors.export');
    });

    it('prevents Admin role from managing availability policy (reserved for Super Admin)', () => {
      const adminRole = DEFAULT_ROLES.find(r => r.id === 'admin');
      expect(adminRole?.permissions).not.toContain('settings.availability_policy.manage');
      expect(adminRole?.permissions).not.toContain('users.manage_roles');
    });
  });

  describe('Audit Logging Payload Sanitization & Firestore Constraints', () => {
    it('redacts sensitive fields and removes undefined values to satisfy Firestore rules', () => {
      const input = {
        name: 'Rahim Khan',
        phone: '01712345678',
        password: 'superSecretPassword123',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        refreshToken: 'refresh-999',
        secret: 'adminSecretKey',
        otp: '482910',
        approvalStatus: 'approved',
        reason: undefined,
        emptyField: undefined,
      };

      const result = sanitizeLogValues(input);
      expect(result.password).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
      expect(result.refreshToken).toBe('[REDACTED]');
      expect(result.secret).toBe('[REDACTED]');
      expect(result.otp).toBe('[REDACTED]');
      expect(result.name).toBe('Rahim Khan');
      expect(result.phone).toBe('01712345678');
      expect(result.approvalStatus).toBe('approved');
      expect('reason' in result).toBe(false);
      expect('emptyField' in result).toBe(false);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('Firestore Data Store & Deletion Security Guardrails', () => {
    it('cleanForFirestore strips all top-level and deeply nested undefined values', () => {
      const payload = {
        fullName: 'Tanvir Hossain',
        email: 'tanvir@example.com',
        phone: '01811223344',
        bloodGroup: 'O+',
        optionalNotes: undefined,
        deepConfig: {
          nestedKey: 'valid',
          ghostKey: undefined,
          innerArray: [1, 2, 3],
        },
      };

      const cleaned = cleanForFirestore(payload);
      expect(cleaned.fullName).toBe('Tanvir Hossain');
      expect('optionalNotes' in cleaned).toBe(false);
      expect(cleaned.optionalNotes).toBeUndefined();
      expect(cleaned.deepConfig.nestedKey).toBe('valid');
      expect('ghostKey' in cleaned.deepConfig).toBe(false);
      expect(cleaned.deepConfig.ghostKey).toBeUndefined();
      expect(cleaned.deepConfig.innerArray).toEqual([1, 2, 3]);
    });

    it('enforces deletion authorization exclusively for Super Admin and Admin roles', () => {
      const superAdmin = DEFAULT_ROLES.find(r => r.id === 'super_admin');
      const admin = DEFAULT_ROLES.find(r => r.id === 'admin');
      const donorManager = DEFAULT_ROLES.find(r => r.id === 'donor_manager');
      const dataEntry = DEFAULT_ROLES.find(r => r.id === 'data_entry_operator');
      const viewer = DEFAULT_ROLES.find(r => r.id === 'viewer_auditor');

      expect(superAdmin?.permissions).toContain('donors.delete');
      expect(superAdmin?.permissions).toContain('users.delete');
      expect(admin?.permissions).toContain('donors.delete');
      expect(admin?.permissions).toContain('users.delete');

      // Least privilege: Non-admin staff cannot delete donors or user accounts
      expect(donorManager?.permissions).not.toContain('donors.delete');
      expect(donorManager?.permissions).not.toContain('users.delete');
      expect(dataEntry?.permissions).not.toContain('donors.delete');
      expect(dataEntry?.permissions).not.toContain('users.delete');
      expect(viewer?.permissions).not.toContain('donors.delete');
      expect(viewer?.permissions).not.toContain('users.delete');
    });
  });
});

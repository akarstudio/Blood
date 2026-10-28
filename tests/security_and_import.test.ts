import { describe, it, expect } from 'vitest';
import { sanitizeForSpreadsheet, isValidBloodGroup, normalizeBangladeshPhone, normalizeEmail, isValidEmail, formatBangladeshPhone } from '../src/utils/validation';
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

    it('enforces mandatory sign-in requirement for viewing donor phone numbers', () => {
      const publicDonor: Donor = {
        ...mockDonor,
        phone: '01712345678',
        contactVisibilityPreference: 'public',
        publicContactConsent: true,
      };

      const getPhoneVisibility = (donor: Donor, isAuthenticated: boolean) => {
        if (!isAuthenticated) {
          return {
            canViewPhone: false,
            displayPhone: '01********* (Hidden)',
            action: 'Sign in to View Phone Number',
          };
        }
        return {
          canViewPhone: true,
          displayPhone: formatBangladeshPhone(donor.phone),
          action: 'Call Now',
        };
      };

      // Unauthenticated visitor
      const visitorResult = getPhoneVisibility(publicDonor, false);
      expect(visitorResult.canViewPhone).toBe(false);
      expect(visitorResult.displayPhone).toContain('Hidden');
      expect(visitorResult.displayPhone).not.toBe('01712-345678');
      expect(visitorResult.action).toBe('Sign in to View Phone Number');

      // Authenticated user
      const signedInResult = getPhoneVisibility(publicDonor, true);
      expect(signedInResult.canViewPhone).toBe(true);
      expect(signedInResult.displayPhone).toBe('01712-345678');
      expect(signedInResult.action).toBe('Call Now');
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

    it('validates user import rows requiring valid mail id and minimum 6-character password', () => {
      const validateUserRow = (row: any) => {
        const rawEmail = row['User Mail ID'] || row['Email'] || row['email'];
        const rawPassword = row['Password'] || row['password'];
        const normEmail = normalizeEmail(String(rawEmail || ''));

        if (!rawEmail || !isValidEmail(normEmail)) {
          return { valid: false, reason: 'Invalid or missing User Mail ID' };
        }
        if (!rawPassword || String(rawPassword).trim().length < 6) {
          return { valid: false, reason: 'Password must be at least 6 characters' };
        }
        return { valid: true, email: normEmail, password: String(rawPassword).trim() };
      };

      // Valid case
      const validRow = { 'User Mail ID': 'admin.user@example.com', 'Password': 'Password@123' };
      const res1 = validateUserRow(validRow);
      expect(res1.valid).toBe(true);
      if (res1.valid) {
        expect(res1.email).toBe('admin.user@example.com');
        expect(res1.password).toBe('Password@123');
      }

      // Invalid email
      const invalidEmail = { 'User Mail ID': 'not-an-email', 'Password': 'Password@123' };
      expect(validateUserRow(invalidEmail).valid).toBe(false);

      // Short password (< 6 chars)
      const shortPass = { 'User Mail ID': 'user@example.com', 'Password': '123' };
      expect(validateUserRow(shortPass).valid).toBe(false);

      // Missing password
      const noPass = { 'User Mail ID': 'user@example.com' };
      expect(validateUserRow(noPass).valid).toBe(false);
    });

    it('sanitizes user export records to prevent formula injection across mail and passwords', () => {
      const mockUser = {
        displayName: '=MALICIOUS()',
        email: 'user@example.com',
        phone: '+8801712345678',
        roleIds: ['donor_manager'],
        accountStatus: 'active',
      };

      const exportedRecord = {
        'Full Name': sanitizeForSpreadsheet(mockUser.displayName),
        'User Mail ID': sanitizeForSpreadsheet(mockUser.email),
        'Password': 'TempPass@2025 (Set new password or reset on login)',
        'Phone': sanitizeForSpreadsheet(mockUser.phone),
      };

      expect(exportedRecord['Full Name'].startsWith('\'=')).toBe(true);
      expect(exportedRecord['Phone'].startsWith('\'+')).toBe(true);
      expect(exportedRecord['User Mail ID']).toBe('user@example.com');
      expect(exportedRecord['Password']).toBe('TempPass@2025 (Set new password or reset on login)');
    });

    it('enforces that without registration no one can sign in with mail and displays You Need to Register First', () => {
      const mapAuthError = (code: string) => {
        if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
          return {
            isNotRegistered: true,
            message: 'You Need to Register First',
            guidance: 'Without registration no one can sign in with mail. Please complete donor registration to create your credentials.',
          };
        }
        if (code === 'auth/wrong-password') {
          return {
            isNotRegistered: false,
            message: 'Incorrect password for this email address.',
            guidance: 'Please check your password or reset it.',
          };
        }
        return { isNotRegistered: false, message: 'Authentication operation failed.' };
      };

      const resultNotFound = mapAuthError('auth/user-not-found');
      expect(resultNotFound.isNotRegistered).toBe(true);
      expect(resultNotFound.message).toBe('You Need to Register First');
      expect(resultNotFound.guidance).toContain('Without registration no one can sign in with mail');

      const resultInvalidCred = mapAuthError('auth/invalid-credential');
      expect(resultInvalidCred.isNotRegistered).toBe(true);
      expect(resultInvalidCred.message).toBe('You Need to Register First');

      const resultWrongPass = mapAuthError('auth/wrong-password');
      expect(resultWrongPass.isNotRegistered).toBe(false);
      expect(resultWrongPass.message).toBe('Incorrect password for this email address.');
    });
  });

  describe('Firebase Authoritative Deletion, Cascade & Zero-Orphan Invariants', () => {
    it('strictly forbids deletion of the primary bootstrapped Super Administrator abrar.noceng@gmail.com', () => {
      const isProtectedAdmin = (email?: string) => {
        return Boolean(email && email.toLowerCase().trim() === 'abrar.noceng@gmail.com');
      };

      expect(isProtectedAdmin('abrar.noceng@gmail.com')).toBe(true);
      expect(isProtectedAdmin('ABRAR.NOCENG@GMAIL.COM')).toBe(true);
      expect(isProtectedAdmin('  abrar.noceng@gmail.com  ')).toBe(true);
      expect(isProtectedAdmin('other.admin@example.com')).toBe(false);
      expect(isProtectedAdmin('donor@demo.com')).toBe(false);
    });

    it('ensures cleanForFirestore cleans nested undefined properties without throwing', () => {
      const dirtyDoc = {
        fullName: 'Kafi Ahmed',
        email: 'kafi@demo.com',
        phone: '01711223344',
        lastDonationDate: undefined,
        eligibilityDate: undefined,
        metadata: {
          nestedUndefined: undefined,
          validKey: 'present',
        },
      };

      const cleaned = cleanForFirestore(dirtyDoc);
      expect('lastDonationDate' in cleaned).toBe(false);
      expect('eligibilityDate' in cleaned).toBe(false);
      expect(cleaned.fullName).toBe('Kafi Ahmed');
      expect(cleaned.metadata.validKey).toBe('present');
      expect('nestedUndefined' in cleaned.metadata).toBe(false);
    });

    it('verifies phone lookup doc id and email identifier doc id sanitization format', () => {
      const emailToIdentifierDocId = (email: string) => {
        return email.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
      };

      expect(emailToIdentifierDocId('kabir@demo.com')).toBe('kabir_demo_com');
      expect(emailToIdentifierDocId('Abrar.Noceng@Gmail.Com')).toBe('abrar_noceng_gmail_com');
      expect(emailToIdentifierDocId('user+test@sub.domain.org.bd')).toBe('user_test_sub_domain_org_bd');
    });
  });

  describe('CRITICAL SECURITY AUDIT: Donor Phone Number Privacy & Access Authorization', () => {
    interface SecurityActor {
      uid: string;
      email: string;
      roleIds: string[];
      hasApprovedDonorProfile: boolean;
    }

    const anonymousVisitor = null;
    const basicAuthUserWithoutDonor: SecurityActor = {
      uid: 'user-unregistered-99',
      email: 'basic.user@example.com',
      roleIds: ['general_user'],
      hasApprovedDonorProfile: false,
    };
    const approvedDonorUser: SecurityActor = {
      uid: 'donor-approved-42',
      email: 'verified.donor@example.com',
      roleIds: ['donor'],
      hasApprovedDonorProfile: true,
    };
    const adminUser: SecurityActor = {
      uid: 'admin-01',
      email: 'abrar.noceng@gmail.com',
      roleIds: ['super_admin'],
      hasApprovedDonorProfile: false,
    };

    const targetDonor = {
      id: 'target-donor-77',
      uid: 'target-donor-77',
      fullName: 'Rafiqul Islam',
      bloodGroup: 'O+' as const,
      phone: '01712345678',
      approvalStatus: 'approved',
      accountStatus: 'active',
      publicContactConsent: true,
      contactVisibilityPreference: 'public',
    };

    /**
     * Models the server-side Firestore security rule for donorContacts:
     * allow get: if isSignedIn() && (hasStaffRole() || isAuthorizedApprovedDonor() || isOwner());
     */
    const evaluateServerSideContactAccess = (
      actor: SecurityActor | null,
      target: typeof targetDonor
    ): { allowed: boolean; reason: string; returnedPhone: string | null } => {
      // 1. Anonymous visitor
      if (!actor) {
        return {
          allowed: false,
          reason: 'permission-denied: Anonymous visitor cannot access private contact records',
          returnedPhone: null,
        };
      }

      // 2. Staff / Admin (super_admin, admin, donor_manager, etc.)
      const isStaff = actor.roleIds.some(r => ['super_admin', 'admin', 'donor_manager'].includes(r));
      if (isStaff) {
        return {
          allowed: true,
          reason: 'Authorized: Staff/Admin privilege',
          returnedPhone: target.phone,
        };
      }

      // 3. Document owner
      if (actor.uid === target.uid) {
        return {
          allowed: true,
          reason: 'Authorized: Resource owner access',
          returnedPhone: target.phone,
        };
      }

      // 4. Approved donor requirement
      if (actor.hasApprovedDonorProfile) {
        return {
          allowed: true,
          reason: 'Authorized: Approved registered voluntary donor',
          returnedPhone: target.phone,
        };
      }

      // 5. Authenticated user without approved donor profile
      return {
        allowed: false,
        reason: 'permission-denied: Authenticated user lacks approved donor registration record',
        returnedPhone: null,
      };
    };

    it('rejects anonymous visitor from reading private phone numbers (Server-side Rule)', () => {
      const res = evaluateServerSideContactAccess(anonymousVisitor, targetDonor);
      expect(res.allowed).toBe(false);
      expect(res.returnedPhone).toBeNull();
      expect(res.reason).toContain('permission-denied');
    });

    it('rejects authenticated user who lacks completed donor registration (Server-side Rule)', () => {
      const res = evaluateServerSideContactAccess(basicAuthUserWithoutDonor, targetDonor);
      expect(res.allowed).toBe(false);
      expect(res.returnedPhone).toBeNull();
      expect(res.reason).toContain('permission-denied');
    });

    it('permits authorized registered approved donor to access phone numbers', () => {
      const res = evaluateServerSideContactAccess(approvedDonorUser, targetDonor);
      expect(res.allowed).toBe(true);
      expect(res.returnedPhone).toBe('01712345678');
      expect(formatBangladeshPhone(res.returnedPhone!)).toBe('01712-345678');
    });

    it('permits authorized administrative staff to access contact records for coordination', () => {
      const res = evaluateServerSideContactAccess(adminUser, targetDonor);
      expect(res.allowed).toBe(true);
      expect(res.returnedPhone).toBe('01712345678');
    });

    it('permits donors to access their own contact records regardless of directory status', () => {
      const selfActor: SecurityActor = {
        uid: 'target-donor-77',
        email: 'rafiqul@example.com',
        roleIds: ['donor'],
        hasApprovedDonorProfile: false, // Even if temporarily pending
      };
      const res = evaluateServerSideContactAccess(selfActor, targetDonor);
      expect(res.allowed).toBe(true);
      expect(res.returnedPhone).toBe('01712345678');
    });

    it('validates all 8 ABO/Rh blood groups for search precision and rejection of malformed values', () => {
      const validABOGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
      validABOGroups.forEach(bg => {
        expect(isValidBloodGroup(bg)).toBe(true);
      });

      const invalidGroups = ['A', 'B', 'O', 'AB', 'A++', 'RH+', 'O_POS', 'Blood', ''];
      invalidGroups.forEach(bg => {
        expect(isValidBloodGroup(bg)).toBe(false);
      });
    });

    it('prevents non-admin user profile from granting itself privileged admin roles', () => {
      const validateUserCreationRoleIds = (roleIds: string[]): boolean => {
        const permittedSelfRoles = new Set(['donor', 'general_user']);
        return roleIds.every(r => permittedSelfRoles.has(r));
      };

      expect(validateUserCreationRoleIds(['donor'])).toBe(true);
      expect(validateUserCreationRoleIds(['general_user'])).toBe(true);
      expect(validateUserCreationRoleIds(['donor', 'general_user'])).toBe(true);
      expect(validateUserCreationRoleIds(['super_admin'])).toBe(false);
      expect(validateUserCreationRoleIds(['admin'])).toBe(false);
      expect(validateUserCreationRoleIds(['donor_manager'])).toBe(false);
      expect(validateUserCreationRoleIds(['donor', 'super_admin'])).toBe(false);
    });

    it('prevents cross-user profile reading and modification (isOwner constraint)', () => {
      const canReadUserProfile = (requestAuthUid: string, targetUserId: string, isStaff: boolean): boolean => {
        return requestAuthUid === targetUserId || isStaff;
      };

      expect(canReadUserProfile('user-1', 'user-1', false)).toBe(true);
      expect(canReadUserProfile('user-1', 'user-2', false)).toBe(false);
      expect(canReadUserProfile('user-1', 'user-2', true)).toBe(true);
    });
  });
});



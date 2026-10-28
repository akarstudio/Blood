export type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';

export const ALL_BLOOD_GROUPS: BloodGroup[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export type AccountStatus = 'active' | 'suspended' | 'deactivated';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ContactVerificationStatus = 'unverified' | 'pending' | 'verified';
export type AvailabilityStatus = 'available' | 'unavailable';
export type ContactVisibilityPreference = 'registered_only' | 'public' | 'hidden';
export type PreferredContactMethod = 'phone' | 'whatsapp' | 'sms' | 'email';

export interface Donor {
  id: string;
  uid?: string; // Firebase Auth UID if registered by user
  fullName: string;
  normalizedName: string;
  email: string;
  normalizedEmail: string;
  phone: string;
  normalizedPhone: string;
  bloodGroup: BloodGroup;
  division: string;
  district: string;
  upazila: string;
  lastDonationDate?: string; // YYYY-MM-DD
  eligibilityDate?: string;  // YYYY-MM-DD
  declaredAvailability: AvailabilityStatus;
  calculatedAvailability: AvailabilityStatus;
  contactVerificationStatus: ContactVerificationStatus;
  approvalStatus: ApprovalStatus;
  accountStatus: AccountStatus;
  publicContactConsent: boolean;
  publicProfileConsent: boolean;
  contactVisibilityPreference?: ContactVisibilityPreference;
  preferredContactMethod?: PreferredContactMethod;
  gender?: 'male' | 'female' | 'other' | 'unspecified';
  dateOfBirth?: string;
  additionalNotes?: string;
  privacyConsentVersion: string;
  privacyConsentAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type Permission =
  | 'donors.view'
  | 'donors.create'
  | 'donors.update'
  | 'donors.approve'
  | 'donors.reject'
  | 'donors.suspend'
  | 'donors.export'
  | 'donors.import'
  | 'donors.delete'
  | 'users.view'
  | 'users.create'
  | 'users.manage_roles'
  | 'users.delete'
  | 'settings.view'
  | 'settings.availability_policy.view'
  | 'settings.availability_policy.manage'
  | 'audit_logs.view'
  | 'reports.view';

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  createdAt?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  normalizedPhone?: string;
  roleIds: string[];
  accountStatus: AccountStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface AvailabilityPolicy {
  minimumIntervalMonths: number;
  policyVersion: number;
  updatedAt: string;
  updatedBy: string;
  updatedByEmail?: string;
}

export interface SiteConfiguration {
  siteName: string;
  contactEmail: string;
  contactPhone: string;
  emergencyHelplineNotice: string;
  publicSearchEnabled: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorEmail?: string;
  action: string;
  entityType: 'donor' | 'policy' | 'user' | 'role' | 'import' | 'settings';
  entityId: string;
  previousValues?: Record<string, any>;
  newValues?: Record<string, any>;
  timestamp: string;
  outcome: 'success' | 'failure';
  reason?: string;
}

export interface ImportJob {
  id: string;
  createdBy: string;
  createdAt: string;
  status: 'completed' | 'failed' | 'processing';
  totalRows: number;
  successCount: number;
  failureCount: number;
  duplicateCount: number;
  filename: string;
}

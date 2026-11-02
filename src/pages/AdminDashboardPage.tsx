import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Users, 
  Shield, 
  Clock, 
  FileSpreadsheet, 
  Download, 
  Upload, 
  FileText, 
  Sliders, 
  Check, 
  X, 
  AlertTriangle, 
  Search, 
  Filter, 
  Eye, 
  UserCheck, 
  UserX, 
  Calendar, 
  RefreshCw, 
  ShieldAlert, 
  CheckCircle2, 
  AlertCircle,
  Trash2,
  Lock,
  ChevronDown,
  Info,
  ShieldCheck,
  Sparkles,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Key,
  UserPlus
} from 'lucide-react';
import { ManualDonorModal } from '../components/donor/ManualDonorModal';
import { useAuth } from '../context/AuthContext';
import { 
  Donor, 
  UserProfile, 
  Role, 
  AvailabilityPolicy, 
  AuditLog, 
  SiteConfiguration, 
  ALL_BLOOD_GROUPS, 
  BloodGroup,
  ApprovalStatus,
  AccountStatus,
  ContactVerificationStatus,
  AvailabilityStatus,
  PreferredContactMethod,
  ContactVisibilityPreference
} from '../types';
import { DEFAULT_ROLES, ALL_PERMISSIONS } from '../data/rolesData';
import { BANGLADESH_DIVISIONS, getDistrictsForDivision, getUpazilasForDistrict } from '../data/bangladeshGeo';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  addDoc, 
  limit, 
  orderBy, 
  writeBatch,
  getCountFromServer
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, createAuthUserWithoutSwitching } from '../services/firebase';
import { StatusBadge } from '../components/common/StatusBadge';
import { Pagination } from '../components/common/Pagination';
import { 
  calculateDonorAvailability, 
  formatBangladeshDateTime, 
  formatBangladeshDateOnly, 
  formatBangladeshPhone,
  addCalendarMonths,
  parseFlexibleDate,
  getBangladeshCurrentDate
} from '../utils/availability';
import { 
  normalizeBangladeshPhone, 
  normalizeEmail, 
  isValidEmail, 
  isValidBloodGroup, 
  sanitizeForSpreadsheet 
} from '../utils/validation';
import { logAuditEvent } from '../utils/audit';
import { 
  deleteDonorSafely, 
  deleteUserSafely, 
  deleteMultipleDonorsSafely, 
  deleteMultipleUsersSafely, 
  purgeAllNonAdminData, 
  syncRegisteredIdentifier, 
  cleanForFirestore, 
  syncUserToDonor, 
  syncAllUsersToDonors,
  recalculateAllDonorsAvailability
} from '../services/dataSyncService';
import * as XLSX from 'xlsx';

type AdminTab = 'overview' | 'donors' | 'users' | 'policy' | 'import_export' | 'audit' | 'settings';

export const AdminDashboardPage: React.FC<{ onNavigate: (page: string) => void }> = ({ onNavigate }) => {
  const { user, userProfile, hasPermission, isSuperAdmin, isAdmin, isDonorManager, isDataEntryOperator, canRegisterDonor } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [manualDonorModalOpen, setManualDonorModalOpen] = useState(false);
  const tabScrollContainerRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Record<AdminTab, HTMLButtonElement | null>>({
    overview: null,
    donors: null,
    users: null,
    policy: null,
    import_export: null,
    audit: null,
    settings: null,
  });

  const scrollTabIntoView = useCallback((tab: AdminTab) => {
    const el = tabButtonRefs.current[tab];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, []);

  const handleSelectTab = (tab: AdminTab) => {
    setActiveTab(tab);
    scrollTabIntoView(tab);
  };

  const handleScrollTabs = (direction: 'left' | 'right') => {
    if (tabScrollContainerRef.current) {
      const scrollAmount = direction === 'left' ? -220 : 220;
      tabScrollContainerRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollTabIntoView(activeTab);
  }, [activeTab, scrollTabIntoView]);

  // Overview metrics state
  const [metrics, setMetrics] = useState({
    totalDonors: 0,
    approvedDonors: 0,
    pendingDonors: 0,
    verifiedContacts: 0,
    availableDonors: 0,
    unavailableDonors: 0,
    suspendedDonors: 0,
    totalUsers: 0,
  });
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [recentAudits, setRecentAudits] = useState<AuditLog[]>([]);

  // Donors management state
  const [donorsList, setDonorsList] = useState<Donor[]>([]);
  const [donorsLoading, setDonorsLoading] = useState(false);
  const [donorSearch, setDonorSearch] = useState('');
  const [approvalFilter, setApprovalFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [donorPage, setDonorPage] = useState(1);
  const donorPageSize = 10;
  const [selectedDonorDetail, setSelectedDonorDetail] = useState<Donor | null>(null);
  const [donorMobileViewMode, setDonorMobileViewMode] = useState<'cards' | 'table'>('cards');

  // Reject dialog state
  const [rejectDialogDonor, setRejectDialogDonor] = useState<Donor | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Donation date edit dialog state
  const [editDateDonor, setEditDateDonor] = useState<Donor | null>(null);
  const [newDonationDate, setNewDonationDate] = useState('');

  // Users management state
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [roleChangeUser, setRoleChangeUser] = useState<UserProfile | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);

  // Policy state
  const [policy, setPolicy] = useState<AvailabilityPolicy>({
    minimumIntervalMonths: 3,
    policyVersion: 1,
    updatedAt: '',
    updatedBy: '',
  });
  const [policyInput, setPolicyInput] = useState<number>(3);
  const [policyConfirmationOpen, setPolicyConfirmationOpen] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyMessage, setPolicyMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Unified User Accounts (Mail ID & Password) + Blood Donors Import / Export state
  const [unifiedSubTab, setUnifiedSubTab] = useState<'import' | 'export' | 'schema'>('import');
  const [unifiedImportFile, setUnifiedImportFile] = useState<File | null>(null);
  const [unifiedImportPreview, setUnifiedImportPreview] = useState<{
    valid: {
      row: number;
      fullName: string;
      email: string;
      password: string;
      phone: string;
      normalizedPhone: string;
      bloodGroup: BloodGroup;
      division: string;
      district: string;
      upazila: string;
      roleIds: string[];
      accountStatus: AccountStatus;
      approvalStatus: ApprovalStatus;
      verificationStatus: ContactVerificationStatus;
      gender: 'male' | 'female' | 'other' | 'unspecified';
      dateOfBirth?: string;
      lastDonationDate?: string;
      eligibilityDate?: string;
      calculatedAvailability?: AvailabilityStatus;
      contactVisibility: ContactVisibilityPreference;
      preferredContactMethod: PreferredContactMethod;
      additionalNotes?: string;
      isPasswordAutoGenerated?: boolean;
    }[];
    invalid: { row: number; reason: string; data: any }[];
    duplicates: { row: number; reason: string; data: any }[];
  } | null>(null);
  const [unifiedImporting, setUnifiedImporting] = useState<boolean>(false);
  const [unifiedImportProgress, setUnifiedImportProgress] = useState<{ current: number; total: number; email?: string } | null>(null);
  const [unifiedImportResult, setUnifiedImportResult] = useState<string | null>(null);
  const [autoApproveUnified, setAutoApproveUnified] = useState<boolean>(true);
  const [createAuthAccounts, setCreateAuthAccounts] = useState<boolean>(true);

  // Unified Export filters & state
  const [exportFilterGroup, setExportFilterGroup] = useState<string>('');
  const [exportFilterDivision, setExportFilterDivision] = useState<string>('');
  const [exportFilterRole, setExportFilterRole] = useState<string>('');
  const [exportFilterApproval, setExportFilterApproval] = useState<string>('all');
  const [unifiedExporting, setUnifiedExporting] = useState<boolean>(false);
  const [syncingUsersToDonors, setSyncingUsersToDonors] = useState<boolean>(false);
  const [recalculatingAvailability, setRecalculatingAvailability] = useState<boolean>(false);

  // Accessible action notification banner & safe confirmation dialogs (replaces window.alert / window.confirm)
  const [actionBanner, setActionBanner] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [suspendDialogDonor, setSuspendDialogDonor] = useState<{ donor: Donor; targetStatus: AccountStatus } | null>(null);

  // Safe delete dialog states
  const [deleteDonorTarget, setDeleteDonorTarget] = useState<Donor | null>(null);
  const [deleteDonorReason, setDeleteDonorReason] = useState('');
  const [deleteDonorLoading, setDeleteDonorLoading] = useState(false);

  const [deleteUserTarget, setDeleteUserTarget] = useState<UserProfile | null>(null);
  const [deleteUserCascade, setDeleteUserCascade] = useState(true);
  const [deleteUserReason, setDeleteUserReason] = useState('');
  const [deleteUserLoading, setDeleteUserLoading] = useState(false);

  // Batch deletion states
  const [selectedDonorIds, setSelectedDonorIds] = useState<string[]>([]);
  const [batchDeleteDonorsOpen, setBatchDeleteDonorsOpen] = useState(false);
  const [batchDeleteDonorsReason, setBatchDeleteDonorsReason] = useState('');
  const [batchDeleteDonorsLoading, setBatchDeleteDonorsLoading] = useState(false);

  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [batchDeleteUsersOpen, setBatchDeleteUsersOpen] = useState(false);
  const [batchDeleteUsersCascade, setBatchDeleteUsersCascade] = useState(true);
  const [batchDeleteUsersReason, setBatchDeleteUsersReason] = useState('');
  const [batchDeleteUsersLoading, setBatchDeleteUsersLoading] = useState(false);

  // Database Purge / Reset state
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
  const [purgeConfirmationPhrase, setPurgeConfirmationPhrase] = useState('');
  const [purgeLoading, setPurgeLoading] = useState(false);

  // Status approval dialog state (Approve Verification & Calculated Status)
  const [statusDialogDonor, setStatusDialogDonor] = useState<Donor | null>(null);
  const [dialogApprovalStatus, setDialogApprovalStatus] = useState<ApprovalStatus>('approved');
  const [dialogVerificationStatus, setDialogVerificationStatus] = useState<ContactVerificationStatus>('verified');
  const [dialogDeclaredAvailability, setDialogDeclaredAvailability] = useState<'available' | 'unavailable'>('available');
  const [dialogLastDonationDate, setDialogLastDonationDate] = useState<string>('');
  const [dialogRejectionReason, setDialogRejectionReason] = useState<string>('');
  const [dialogStatusSaving, setDialogStatusSaving] = useState<boolean>(false);

  // Real-time live availability calculation preview for the status approval dialog
  const dialogCalcPreview = statusDialogDonor
    ? calculateDonorAvailability(
        {
          approvalStatus: dialogApprovalStatus,
          contactVerificationStatus: dialogVerificationStatus,
          accountStatus: statusDialogDonor.accountStatus,
          declaredAvailability: dialogDeclaredAvailability,
          lastDonationDate: dialogLastDonationDate || undefined,
        },
        policy.minimumIntervalMonths
      )
    : null;

  // Audit logs state
  const [auditLogsList, setAuditLogsList] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditActionFilter, setAuditActionFilter] = useState('');
  const [auditPage, setAuditPage] = useState(1);

  // Settings state
  const [siteConfig, setSiteConfig] = useState<SiteConfiguration>({
    siteName: 'Blood Group Finder Bangladesh',
    contactEmail: 'support@bloodgroupfinder.org.bd',
    contactPhone: '01700-000000',
    emergencyHelplineNotice: 'For urgent hospital inquiries, dial National Emergency 999 or Red Crescent Blood Bank.',
    publicSearchEnabled: true,
    updatedAt: '',
    updatedBy: '',
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);

  const isStaff = isDonorManager || isDataEntryOperator || isAdmin || isSuperAdmin || hasPermission('donors.view') || hasPermission('donors.create') || hasPermission('reports.view');

  // 1. Fetch Overview Metrics
  const loadMetrics = useCallback(async () => {
    if (!user || !isStaff) return;
    setMetricsLoading(true);
    try {
      const donorsCol = collection(db, 'donors');
      const [
        totalSnap,
        appSnap,
        pendSnap,
        verifSnap,
        availSnap,
        unavailSnap,
        suspSnap,
      ] = await Promise.all([
        getCountFromServer(query(donorsCol)),
        getCountFromServer(query(donorsCol, where('approvalStatus', '==', 'approved'))),
        getCountFromServer(query(donorsCol, where('approvalStatus', '==', 'pending'))),
        getCountFromServer(query(donorsCol, where('contactVerificationStatus', '==', 'verified'))),
        getCountFromServer(query(donorsCol, where('calculatedAvailability', '==', 'available'))),
        getCountFromServer(query(donorsCol, where('calculatedAvailability', '==', 'unavailable'))),
        getCountFromServer(query(donorsCol, where('accountStatus', '==', 'suspended'))),
      ]);

      let userCount = 0;
      if (hasPermission('users.view') || isAdmin || isSuperAdmin) {
        try {
          const userSnap = await getCountFromServer(query(collection(db, 'users')));
          userCount = userSnap.data().count;
        } catch (e) {
          console.warn('User metrics unavailable for current user role:', e);
        }
      }

      setMetrics({
        totalDonors: totalSnap.data().count,
        approvedDonors: appSnap.data().count,
        pendingDonors: pendSnap.data().count,
        verifiedContacts: verifSnap.data().count,
        availableDonors: availSnap.data().count,
        unavailableDonors: unavailSnap.data().count,
        suspendedDonors: suspSnap.data().count,
        totalUsers: userCount,
      });

      // Load latest 5 audit logs if user has audit log viewing permission
      if (hasPermission('audit_logs.view') || isAdmin || isSuperAdmin) {
        try {
          const auditQ = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(5));
          const auditSnaps = await getDocs(auditQ);
          const audits: AuditLog[] = [];
          auditSnaps.forEach((d) => audits.push({ id: d.id, ...d.data() } as AuditLog));
          setRecentAudits(audits);
        } catch (e) {
          console.warn('Audit logs preview unavailable:', e);
        }
      }
    } catch (e) {
      console.error('Failed to load metrics:', e);
    } finally {
      setMetricsLoading(false);
    }
  }, [user, hasPermission, isAdmin, isSuperAdmin]);

  // 2. Fetch Donors List from Firestore (Indexed by blood group, cached in-memory for instant search)
  const loadDonors = useCallback(async () => {
    if (!user || !isStaff) return;
    setDonorsLoading(true);
    try {
      const constraints: any[] = [];
      if (groupFilter) {
        constraints.push(where('bloodGroup', '==', groupFilter));
      }

      const q = query(collection(db, 'donors'), ...constraints, limit(1000));
      const snapshot = await getDocs(q);
      const list: Donor[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as Donor);
      });

      setDonorsList(list);
    } catch (err) {
      console.error('Failed to fetch donors list:', err);
    } finally {
      setDonorsLoading(false);
    }
  }, [user, isStaff, groupFilter]);

  // 3. Fetch Users List
  const loadUsers = useCallback(async () => {
    if (!hasPermission('users.view')) return;
    setUsersLoading(true);
    try {
      const q = query(collection(db, 'users'), limit(100));
      const snaps = await getDocs(q);
      const list: UserProfile[] = [];
      snaps.forEach((d) => list.push({ uid: d.id, ...d.data() } as UserProfile));
      setUsersList(list);
    } catch (e) {
      console.error('Failed to load users:', e);
    } finally {
      setUsersLoading(false);
    }
  }, [hasPermission]);

  // 4. Fetch Availability Policy
  const loadPolicy = useCallback(async () => {
    try {
      const snap = await getDoc(doc(db, 'systemSettings', 'availabilityPolicy'));
      if (snap.exists()) {
        const data = snap.data() as AvailabilityPolicy;
        setPolicy(data);
        setPolicyInput(data.minimumIntervalMonths);
      }
    } catch (e) {
      console.error('Failed to load policy:', e);
    }
  }, []);

  // 5. Fetch Audit Logs
  const loadAuditLogs = useCallback(async () => {
    if (!hasPermission('audit_logs.view')) return;
    setAuditLoading(true);
    try {
      const constraints: any[] = [orderBy('timestamp', 'desc'), limit(100)];
      if (auditActionFilter) {
        constraints.unshift(where('entityType', '==', auditActionFilter));
      }
      const q = query(collection(db, 'auditLogs'), ...constraints);
      const snaps = await getDocs(q);
      const logs: AuditLog[] = [];
      snaps.forEach((d) => logs.push({ id: d.id, ...d.data() } as AuditLog));
      setAuditLogsList(logs);
    } catch (e) {
      console.error('Failed to load audit logs:', e);
    } finally {
      setAuditLoading(false);
    }
  }, [hasPermission, auditActionFilter]);

  // 6. Fetch Site Configuration
  const loadSiteConfig = useCallback(async () => {
    try {
      const snap = await getDoc(doc(db, 'systemSettings', 'siteConfiguration'));
      if (snap.exists()) {
        setSiteConfig(snap.data() as SiteConfiguration);
      }
    } catch (e) {
      console.error('Failed to load site config:', e);
    }
  }, []);

  useEffect(() => {
    if (!user || !isStaff) return;
    if (activeTab === 'overview') loadMetrics();
    if (activeTab === 'donors') loadDonors();
    if (activeTab === 'users' && (hasPermission('users.view') || isAdmin || isSuperAdmin)) loadUsers();
    if (activeTab === 'policy' && (hasPermission('settings.availability_policy.view') || isAdmin || isSuperAdmin)) loadPolicy();
    if (activeTab === 'audit' && (hasPermission('audit_logs.view') || isAdmin || isSuperAdmin)) loadAuditLogs();
    if (activeTab === 'settings' && (hasPermission('settings.view') || isAdmin || isSuperAdmin)) loadSiteConfig();
  }, [activeTab, user, isStaff, hasPermission, isAdmin, isSuperAdmin, loadMetrics, loadDonors, loadUsers, loadPolicy, loadAuditLogs, loadSiteConfig]);

  // ACTION: Open Comprehensive Status Review & Approval Dialog
  const handleOpenStatusDialog = (
    donor: Donor,
    preselectApproval?: ApprovalStatus,
    preselectVerification?: ContactVerificationStatus
  ) => {
    setStatusDialogDonor(donor);
    setDialogApprovalStatus(preselectApproval || (donor.approvalStatus === 'pending' ? 'approved' : donor.approvalStatus));
    setDialogVerificationStatus(preselectVerification || (donor.contactVerificationStatus !== 'verified' ? 'verified' : donor.contactVerificationStatus));
    setDialogDeclaredAvailability(donor.declaredAvailability || 'available');
    setDialogLastDonationDate(donor.lastDonationDate || '');
    setDialogRejectionReason(donor.rejectionReason || '');
  };

  // ACTION: Approve Donor Registration & Contact Verification together
  const handleApproveDonor = async (donor: Donor) => {
    if (!hasPermission('donors.approve') && !isAdmin && !isDonorManager && !isSuperAdmin) return;
    try {
      const targetVerification: ContactVerificationStatus = 'verified';
      const calcResult = calculateDonorAvailability(
        {
          approvalStatus: 'approved',
          contactVerificationStatus: targetVerification,
          accountStatus: donor.accountStatus,
          declaredAvailability: donor.declaredAvailability,
          lastDonationDate: donor.lastDonationDate || undefined,
        },
        policy.minimumIntervalMonths
      );

      const updates: Record<string, any> = {
        approvalStatus: 'approved' as const,
        contactVerificationStatus: targetVerification,
        approvedBy: user?.uid,
        approvedAt: new Date().toISOString(),
        calculatedAvailability: calcResult.calculatedAvailability,
        eligibilityDate: calcResult.eligibilityDate || '',
        updatedAt: new Date().toISOString(),
      };

      await updateDoc(doc(db, 'donors', donor.id), updates);

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: 'donor.approve_all',
          entityType: 'donor',
          entityId: donor.id,
          previousValues: {
            approvalStatus: donor.approvalStatus,
            contactVerificationStatus: donor.contactVerificationStatus,
            calculatedAvailability: donor.calculatedAvailability,
          },
          newValues: {
            approvalStatus: 'approved',
            contactVerificationStatus: 'verified',
            calculatedAvailability: calcResult.calculatedAvailability,
          },
          outcome: 'success',
          reason: 'Administrator approved donor registration and contact verification',
        });
      }

      setDonorsList((prev) =>
        prev.map((d) => (d.id === donor.id ? { ...d, ...updates } : d))
      );
      await loadMetrics();
      setActionBanner({
        message: `Donor "${donor.fullName}" approved! Verification set to [verified] and Calculated Availability is now [${calcResult.calculatedAvailability}].`,
        type: 'success',
      });
    } catch (err: any) {
      setActionBanner({ message: `Approval failed: ${err.message}`, type: 'error' });
    }
  };

  // ACTION: Quick Approve Contact Verification Only
  const handleQuickApproveVerification = async (donor: Donor) => {
    if (!hasPermission('donors.approve') && !isAdmin && !isDonorManager && !isSuperAdmin) return;
    try {
      const calcResult = calculateDonorAvailability(
        {
          approvalStatus: donor.approvalStatus,
          contactVerificationStatus: 'verified',
          accountStatus: donor.accountStatus,
          declaredAvailability: donor.declaredAvailability,
          lastDonationDate: donor.lastDonationDate || undefined,
        },
        policy.minimumIntervalMonths
      );

      const updates = {
        contactVerificationStatus: 'verified' as const,
        calculatedAvailability: calcResult.calculatedAvailability,
        eligibilityDate: calcResult.eligibilityDate || '',
        updatedAt: new Date().toISOString(),
      };

      await updateDoc(doc(db, 'donors', donor.id), updates);

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: 'donor.approve_verification',
          entityType: 'donor',
          entityId: donor.id,
          previousValues: {
            contactVerificationStatus: donor.contactVerificationStatus,
            calculatedAvailability: donor.calculatedAvailability,
          },
          newValues: {
            contactVerificationStatus: 'verified',
            calculatedAvailability: calcResult.calculatedAvailability,
          },
          outcome: 'success',
          reason: 'Administrator approved contact verification status',
        });
      }

      setDonorsList((prev) =>
        prev.map((d) => (d.id === donor.id ? { ...d, ...updates } : d))
      );
      await loadMetrics();
      setActionBanner({
        message: `Contact verification for "${donor.fullName}" approved! Calculated Availability evaluated to [${calcResult.calculatedAvailability}].`,
        type: 'success',
      });
    } catch (err: any) {
      setActionBanner({ message: `Verification failed: ${err.message}`, type: 'error' });
    }
  };

  // ACTION: Save Comprehensive Status Dialog
  const handleSaveStatusDialog = async () => {
    if (!statusDialogDonor || !user) return;
    if (dialogApprovalStatus === 'rejected' && !dialogRejectionReason.trim()) {
      setActionBanner({ message: 'A rejection reason is required when setting approval to rejected.', type: 'error' });
      return;
    }

    setDialogStatusSaving(true);
    try {
      const calcResult = calculateDonorAvailability(
        {
          approvalStatus: dialogApprovalStatus,
          contactVerificationStatus: dialogVerificationStatus,
          accountStatus: statusDialogDonor.accountStatus,
          declaredAvailability: dialogDeclaredAvailability,
          lastDonationDate: dialogLastDonationDate || undefined,
        },
        policy.minimumIntervalMonths
      );

      const updates: Record<string, any> = {
        approvalStatus: dialogApprovalStatus,
        contactVerificationStatus: dialogVerificationStatus,
        declaredAvailability: dialogDeclaredAvailability,
        lastDonationDate: dialogLastDonationDate || '',
        eligibilityDate: calcResult.eligibilityDate || '',
        calculatedAvailability: calcResult.calculatedAvailability,
        rejectionReason: dialogApprovalStatus === 'rejected' ? dialogRejectionReason.trim() : '',
        updatedAt: new Date().toISOString(),
      };

      if (dialogApprovalStatus === 'approved' && statusDialogDonor.approvalStatus !== 'approved') {
        updates.approvedBy = user.uid;
        updates.approvedAt = new Date().toISOString();
      }

      await updateDoc(doc(db, 'donors', statusDialogDonor.id), updates);

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: 'donor.approve_statuses',
          entityType: 'donor',
          entityId: statusDialogDonor.id,
          previousValues: {
            approvalStatus: statusDialogDonor.approvalStatus,
            contactVerificationStatus: statusDialogDonor.contactVerificationStatus,
            calculatedAvailability: statusDialogDonor.calculatedAvailability,
            lastDonationDate: statusDialogDonor.lastDonationDate,
          },
          newValues: {
            approvalStatus: dialogApprovalStatus,
            contactVerificationStatus: dialogVerificationStatus,
            calculatedAvailability: calcResult.calculatedAvailability,
            lastDonationDate: dialogLastDonationDate,
          },
          outcome: 'success',
          reason: 'Administrator updated approval, verification, and calculated availability status',
        });
      }

      setDonorsList((prev) =>
        prev.map((d) => (d.id === statusDialogDonor.id ? { ...d, ...updates } : d))
      );
      await loadMetrics();

      setActionBanner({
        message: `Donor "${statusDialogDonor.fullName}" updated: Approval [${dialogApprovalStatus}], Verification [${dialogVerificationStatus}], Calculated Availability [${calcResult.calculatedAvailability}].`,
        type: 'success',
      });
      setStatusDialogDonor(null);
    } catch (err: any) {
      console.error('Failed to save donor statuses:', err);
      setActionBanner({ message: `Status update failed: ${err.message}`, type: 'error' });
    } finally {
      setDialogStatusSaving(false);
    }
  };

  // ACTION: Reject Donor
  const handleConfirmReject = async () => {
    if (!rejectDialogDonor || !hasPermission('donors.reject')) return;
    if (!rejectReason.trim()) {
      setActionBanner({ message: 'A rejection reason is required before rejecting.', type: 'error' });
      return;
    }

    try {
      const updates = {
        approvalStatus: 'rejected',
        rejectionReason: rejectReason.trim(),
        calculatedAvailability: 'unavailable',
        updatedAt: new Date().toISOString(),
      };

      await updateDoc(doc(db, 'donors', rejectDialogDonor.id), updates);

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: 'donor.reject',
          entityType: 'donor',
          entityId: rejectDialogDonor.id,
          previousValues: { approvalStatus: rejectDialogDonor.approvalStatus },
          newValues: { approvalStatus: 'rejected', rejectionReason: rejectReason.trim() },
          outcome: 'success',
          reason: rejectReason.trim(),
        });
      }

      setRejectDialogDonor(null);
      setRejectReason('');
      await loadDonors();
      await loadMetrics();
      setActionBanner({ message: 'Donor application rejected.', type: 'info' });
    } catch (err: any) {
      setActionBanner({ message: `Rejection failed: ${err.message}`, type: 'error' });
    }
  };

  // ACTION: Suspend / Reactivate Donor
  const handleToggleSuspendDonor = (donor: Donor) => {
    if (!hasPermission('donors.suspend')) return;
    const targetStatus: AccountStatus = donor.accountStatus === 'suspended' ? 'active' : 'suspended';
    setSuspendDialogDonor({ donor, targetStatus });
  };

  const handleConfirmSuspend = async () => {
    if (!suspendDialogDonor || !hasPermission('donors.suspend')) return;
    const { donor, targetStatus } = suspendDialogDonor;

    try {
      const calcResult = calculateDonorAvailability(
        {
          approvalStatus: donor.approvalStatus,
          contactVerificationStatus: donor.contactVerificationStatus,
          accountStatus: targetStatus,
          declaredAvailability: donor.declaredAvailability,
          lastDonationDate: donor.lastDonationDate || undefined,
        },
        policy.minimumIntervalMonths
      );

      const updates = {
        accountStatus: targetStatus,
        calculatedAvailability: calcResult.calculatedAvailability,
        updatedAt: new Date().toISOString(),
      };

      await updateDoc(doc(db, 'donors', donor.id), updates);

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: `donor.${targetStatus}`,
          entityType: 'donor',
          entityId: donor.id,
          previousValues: { accountStatus: donor.accountStatus },
          newValues: { accountStatus: targetStatus },
          outcome: 'success',
        });
      }

      setSuspendDialogDonor(null);
      await loadDonors();
      await loadMetrics();
      setActionBanner({
        message: `Donor account status successfully updated to "${targetStatus}".`,
        type: 'success',
      });
    } catch (err: any) {
      setActionBanner({ message: `Status update failed: ${err.message}`, type: 'error' });
    }
  };

  // ACTION: Update Last Donation Date & Recalculate
  const handleSaveDonationDate = async () => {
    if (!editDateDonor || !hasPermission('donors.update')) return;
    try {
      const calcResult = calculateDonorAvailability(
        {
          approvalStatus: editDateDonor.approvalStatus,
          contactVerificationStatus: editDateDonor.contactVerificationStatus,
          accountStatus: editDateDonor.accountStatus,
          declaredAvailability: editDateDonor.declaredAvailability,
          lastDonationDate: newDonationDate || undefined,
        },
        policy.minimumIntervalMonths
      );

      const updates = {
        lastDonationDate: newDonationDate || '',
        eligibilityDate: calcResult.eligibilityDate || '',
        calculatedAvailability: calcResult.calculatedAvailability,
        updatedAt: new Date().toISOString(),
      };

      await updateDoc(doc(db, 'donors', editDateDonor.id), updates);

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: 'donor.update_donation_date',
          entityType: 'donor',
          entityId: editDateDonor.id,
          previousValues: { lastDonationDate: editDateDonor.lastDonationDate },
          newValues: { lastDonationDate: newDonationDate, eligibilityDate: calcResult.eligibilityDate },
          outcome: 'success',
        });
      }

      setEditDateDonor(null);
      setNewDonationDate('');
      await loadDonors();
      setActionBanner({ message: 'Donation date updated and availability recalculated.', type: 'success' });
    } catch (err: any) {
      setActionBanner({ message: `Date update failed: ${err.message}`, type: 'error' });
    }
  };

  // ACTION: Delete Donor Record with Atomic Phone Index Cleanup
  const handleConfirmDeleteDonor = async () => {
    if (!deleteDonorTarget || !user) return;
    setDeleteDonorLoading(true);
    try {
      await deleteDonorSafely(
        db,
        deleteDonorTarget.id,
        { uid: user.uid, email: user.email || undefined },
        deleteDonorReason.trim() || 'Administrative deletion'
      );

      // Instantly synchronize local state
      setDonorsList((prev) => prev.filter((d) => d.id !== deleteDonorTarget.id));
      setMetrics((prev) => ({
        ...prev,
        totalDonors: Math.max(0, prev.totalDonors - 1),
        approvedDonors: deleteDonorTarget.approvalStatus === 'approved' ? Math.max(0, prev.approvedDonors - 1) : prev.approvedDonors,
        pendingDonors: deleteDonorTarget.approvalStatus === 'pending' ? Math.max(0, prev.pendingDonors - 1) : prev.pendingDonors,
      }));

      setActionBanner({
        message: `Donor "${deleteDonorTarget.fullName}" and associated contact index were permanently deleted.`,
        type: 'success',
      });
      setDeleteDonorTarget(null);
      setDeleteDonorReason('');
    } catch (err: any) {
      console.error('Failed to delete donor:', err);
      setActionBanner({ message: `Donor deletion failed: ${err.message}`, type: 'error' });
    } finally {
      setDeleteDonorLoading(false);
    }
  };

  // ACTION: Delete User Account with Optional Cascade to Linked Donor
  const handleConfirmDeleteUser = async () => {
    if (!deleteUserTarget || !user) return;
    setDeleteUserLoading(true);
    try {
      const res = await deleteUserSafely(
        db,
        deleteUserTarget.uid,
        { uid: user.uid, email: user.email || undefined },
        { cascadeDeleteDonor: deleteUserCascade, reason: deleteUserReason.trim() || 'Administrative user account deletion' }
      );

      // Instantly synchronize local state
      setUsersList((prev) => prev.filter((u) => u.uid !== deleteUserTarget.uid));
      setMetrics((prev) => ({
        ...prev,
        totalUsers: Math.max(0, prev.totalUsers - 1),
      }));

      if (res.deletedDonorId) {
        setDonorsList((prev) => prev.filter((d) => d.id !== res.deletedDonorId));
      }

      setActionBanner({
        message: `User account "${deleteUserTarget.email}" was deleted successfully${res.deletedDonorId ? ' along with linked donor profile' : ''}.`,
        type: 'success',
      });
      setDeleteUserTarget(null);
      setDeleteUserReason('');
    } catch (err: any) {
      console.error('Failed to delete user:', err);
      setActionBanner({ message: `User deletion failed: ${err.message}`, type: 'error' });
    } finally {
      setDeleteUserLoading(false);
    }
  };

  const handleToggleSelectDonor = (id: string) => {
    setSelectedDonorIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAllDonors = (pageItems: Donor[]) => {
    const pageIds = pageItems.map((d) => d.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedDonorIds.includes(id));
    if (allSelected) {
      setSelectedDonorIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedDonorIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const handleToggleSelectUser = (uid: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(uid) ? prev.filter((item) => item !== uid) : [...prev, uid]
    );
  };

  const handleToggleSelectAllUsers = () => {
    const selectableUsers = usersList.filter(
      (u) => u.uid !== user?.uid && u.email?.toLowerCase().trim() !== 'abrar.noceng@gmail.com'
    );
    const selectableIds = selectableUsers.map((u) => u.uid);
    const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedUserIds.includes(id));
    if (allSelected) {
      setSelectedUserIds([]);
    } else {
      setSelectedUserIds(selectableIds);
    }
  };

  // ACTION: Batch Delete Selected Donors from Firebase Firestore
  const handleConfirmBatchDeleteDonors = async () => {
    if (selectedDonorIds.length === 0 || !user) return;
    setBatchDeleteDonorsLoading(true);
    try {
      const res = await deleteMultipleDonorsSafely(
        db,
        selectedDonorIds,
        { uid: user.uid, email: user.email || undefined },
        batchDeleteDonorsReason.trim() || 'Administrative bulk donor deletion'
      );

      setDonorsList((prev) => prev.filter((d) => !selectedDonorIds.includes(d.id)));
      setSelectedDonorIds([]);
      setBatchDeleteDonorsOpen(false);
      setBatchDeleteDonorsReason('');
      await loadMetrics();

      setActionBanner({
        message: `Permanently deleted ${res.deleted} donor record(s) and their lookup indexes from Firebase.`,
        type: 'success',
      });
    } catch (err: any) {
      console.error('Batch donor deletion failed:', err);
      setActionBanner({ message: `Bulk donor deletion failed: ${err.message}`, type: 'error' });
    } finally {
      setBatchDeleteDonorsLoading(false);
    }
  };

  // ACTION: Batch Delete Selected Users from Firebase Firestore
  const handleConfirmBatchDeleteUsers = async () => {
    if (selectedUserIds.length === 0 || !user) return;
    setBatchDeleteUsersLoading(true);
    try {
      const res = await deleteMultipleUsersSafely(
        db,
        selectedUserIds,
        { uid: user.uid, email: user.email || undefined },
        batchDeleteUsersReason.trim() || 'Administrative bulk user deletion'
      );

      setUsersList((prev) => prev.filter((u) => !selectedUserIds.includes(u.uid)));
      if (batchDeleteUsersCascade) {
        await loadDonors();
      }
      setSelectedUserIds([]);
      setBatchDeleteUsersOpen(false);
      setBatchDeleteUsersReason('');
      await loadMetrics();

      setActionBanner({
        message: `Successfully deleted ${res.deleted} user account(s) from Firebase${res.protectedSkipped > 0 ? ` (${res.protectedSkipped} protected account(s) preserved)` : ''}.`,
        type: 'success',
      });
    } catch (err: any) {
      console.error('Batch user deletion failed:', err);
      setActionBanner({ message: `Bulk user deletion failed: ${err.message}`, type: 'error' });
    } finally {
      setBatchDeleteUsersLoading(false);
    }
  };

  // ACTION: Purge All Non-Admin Data from Firebase Firestore
  const handleConfirmPurgeAllData = async () => {
    if (purgeConfirmationPhrase.trim() !== 'DELETE ALL DATA' || !user) return;
    setPurgeLoading(true);
    try {
      const res = await purgeAllNonAdminData(db, { uid: user.uid, email: user.email || undefined });
      setPurgeDialogOpen(false);
      setPurgeConfirmationPhrase('');
      setSelectedDonorIds([]);
      setSelectedUserIds([]);
      await loadMetrics();
      await loadDonors();
      await loadUsers();

      setActionBanner({
        message: `Firebase Database Purge Complete: Removed ${res.deletedDonors} donors, ${res.deletedUsers} non-admin users, ${res.deletedPhones} phone indices, and ${res.deletedIdentifiers} email lookups. Super Administrator account preserved!`,
        type: 'success',
      });
    } catch (err: any) {
      console.error('Purge failed:', err);
      setActionBanner({ message: `Database purge failed: ${err.message}`, type: 'error' });
    } finally {
      setPurgeLoading(false);
    }
  };

  // ACTION: Save Availability Policy (Section 6)
  const handleSavePolicy = async () => {
    if (!hasPermission('settings.availability_policy.manage')) {
      setActionBanner({ message: 'You lack permission to manage availability policy.', type: 'error' });
      return;
    }

    if (policyInput < 1 || policyInput > 12) {
      setPolicyMessage({ text: 'Permitted interval must be between 1 and 12 calendar months.', type: 'error' });
      return;
    }

    setPolicySaving(true);
    setPolicyMessage(null);

    try {
      const newVersion = (policy.policyVersion || 1) + 1;
      const nowIso = new Date().toISOString();
      const updatedPolicy: AvailabilityPolicy = {
        minimumIntervalMonths: policyInput,
        policyVersion: newVersion,
        updatedAt: nowIso,
        updatedBy: user?.uid || 'admin',
        updatedByEmail: user?.email || undefined,
      };

      await setDoc(doc(db, 'systemSettings', 'availabilityPolicy'), updatedPolicy);

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: 'policy.update_interval',
          entityType: 'policy',
          entityId: 'availabilityPolicy',
          previousValues: { minimumIntervalMonths: policy.minimumIntervalMonths, version: policy.policyVersion },
          newValues: { minimumIntervalMonths: policyInput, version: newVersion },
          outcome: 'success',
        });
      }

      setPolicy(updatedPolicy);
      setPolicyConfirmationOpen(false);
      setPolicyMessage({
        text: `Policy successfully updated to ${policyInput} calendar months (Version ${newVersion}).`,
        type: 'success',
      });
      setActionBanner({
        message: `Availability policy updated to ${policyInput} calendar months.`,
        type: 'success',
      });
    } catch (err: any) {
      setPolicyMessage({ text: err.message || 'Failed to update policy.', type: 'error' });
    } finally {
      setPolicySaving(false);
    }
  };

  // ACTION: Assign / Update User Roles (with Super Admin protection)
  const handleSaveUserRoles = async () => {
    if (!roleChangeUser || !hasPermission('users.manage_roles')) return;

    // Protection: Prevent removing Super Admin if this is the user editing themselves and they are the only Super Admin
    if (roleChangeUser.uid === user?.uid && !selectedRoles.includes('super_admin')) {
      // Check total super admins
      const superAdmins = usersList.filter(u => u.roleIds.includes('super_admin'));
      if (superAdmins.length <= 1) {
        setActionBanner({
          message: 'Action prevented: You are the last active Super Admin. You cannot remove your own Super Admin privileges.',
          type: 'error',
        });
        return;
      }
    }

    try {
      await updateDoc(doc(db, 'users', roleChangeUser.uid), {
        roleIds: selectedRoles,
        updatedAt: new Date().toISOString(),
      });

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: 'user.update_roles',
          entityType: 'user',
          entityId: roleChangeUser.uid,
          previousValues: { roleIds: roleChangeUser.roleIds },
          newValues: { roleIds: selectedRoles },
          outcome: 'success',
        });
      }

      setRoleChangeUser(null);
      await loadUsers();
      setActionBanner({ message: 'User roles updated successfully.', type: 'success' });
    } catch (err: any) {
      setActionBanner({ message: `Role assignment failed: ${err.message}`, type: 'error' });
    }
  };

  // ACTION: Synchronize all existing users into the Find Donors section
  const handleSyncUsersToDonors = async () => {
    if (!user) return;
    setSyncingUsersToDonors(true);
    try {
      const res = await syncAllUsersToDonors(db, { uid: user.uid, email: user.email || undefined });
      await loadDonors();
      await loadMetrics();
      setActionBanner({
        message: `Sync completed: ${res.synced} users successfully added to Find Donors (${res.alreadyExisted} already had profiles, total ${res.total} accounts verified).`,
        type: 'success',
      });
    } catch (err: any) {
      console.error('Failed to sync users to donors:', err);
      setActionBanner({ message: `Sync failed: ${err.message}`, type: 'error' });
    } finally {
      setSyncingUsersToDonors(false);
    }
  };

  // ACTION: Recalculate & Synchronize availability & donation dates for all existing donors
  const handleRecalculateDonorsAvailability = async () => {
    if (!user) return;
    setRecalculatingAvailability(true);
    try {
      const res = await recalculateAllDonorsAvailability(db, policy.minimumIntervalMonths, {
        uid: user.uid,
        email: user.email || undefined,
      });
      await loadDonors();
      await loadMetrics();
      setActionBanner({
        message: `Availability synchronized: ${res.updated} donor profile${res.updated === 1 ? '' : 's'} updated (out of ${res.total} total).`,
        type: 'success',
      });
    } catch (err: any) {
      console.error('Failed to recalculate donor availability:', err);
      setActionBanner({ message: `Recalculate failed: ${err.message}`, type: 'error' });
    } finally {
      setRecalculatingAvailability(false);
    }
  };

  // Helper for flexible, case-insensitive, symbol-tolerant column name extraction
  const extractRowField = (row: Record<string, any>, possibleKeys: string[]): any => {
    for (const k of possibleKeys) {
      if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
        return row[k];
      }
    }
    const rowKeys = Object.keys(row);
    for (const target of possibleKeys) {
      const cleanTarget = target.toLowerCase().replace(/[\s_\-\:\/]/g, '');
      for (const rk of rowKeys) {
        const cleanRk = rk.toLowerCase().replace(/[\s_\-\:\/]/g, '');
        if (cleanRk === cleanTarget && row[rk] !== undefined && row[rk] !== null && String(row[rk]).trim() !== '') {
          return row[rk];
        }
      }
    }
    return undefined;
  };

  // ACTION: Download Unified Sample Spreadsheet Template (Users & Donors combined)
  const downloadUnifiedTemplate = (format: 'csv' | 'xlsx') => {
    const sampleRows = [
      {
        'Full Name': 'Rahim Ahmed',
        'User Mail ID': 'rahim.ahmed@example.com',
        'Password': 'RahimPass@2025',
        'Phone': '01711223344',
        'Blood Group': 'O+',
        'Division': 'Dhaka',
        'District': 'Dhaka',
        'Upazila': 'Dhanmondi',
        'Role': 'donor_manager',
        'Status': 'active',
        'Approval Status': 'approved',
        'Verification Status': 'verified',
        'Gender': 'male',
        'Date of Birth': '1992-04-10',
        'Last Donation Date': '2024-08-15',
        'Contact Visibility': 'public',
        'Preferred Contact Method': 'phone',
        'Additional Notes': 'Regular voluntary donor & Dhaka community coordinator',
      },
      {
        'Full Name': 'Fatima Begum',
        'User Mail ID': 'fatima.begum@example.com',
        'Password': 'FatimaSecure!123',
        'Phone': '01811223344',
        'Blood Group': 'A+',
        'Division': 'Chattogram',
        'District': 'Chattogram',
        'Upazila': 'Panchlaish',
        'Role': 'general_user',
        'Status': 'active',
        'Approval Status': 'approved',
        'Verification Status': 'verified',
        'Gender': 'female',
        'Date of Birth': '1996-08-22',
        'Last Donation Date': '2024-06-10',
        'Contact Visibility': 'public',
        'Preferred Contact Method': 'whatsapp',
        'Additional Notes': 'Available for emergency blood calls',
      },
      {
        'Full Name': 'Dr. Kabir Hossain',
        'User Mail ID': 'kabir.hossain@example.com',
        'Password': 'KabirDoc@2025',
        'Phone': '01911223344',
        'Blood Group': 'B+',
        'Division': 'Rajshahi',
        'District': 'Rajshahi',
        'Upazila': 'Boalia',
        'Role': 'data_entry_operator',
        'Status': 'active',
        'Approval Status': 'approved',
        'Verification Status': 'verified',
        'Gender': 'male',
        'Date of Birth': '1990-11-05',
        'Last Donation Date': '2024-07-20',
        'Contact Visibility': 'public',
        'Preferred Contact Method': 'phone',
        'Additional Notes': 'Verified medical professional and voluntary donor',
      },
      {
        'Full Name': 'Tanvir Hasan',
        'User Mail ID': 'tanvir.hasan@example.com',
        'Password': 'TanvirPass#2025',
        'Phone': '01611223344',
        'Blood Group': 'AB+',
        'Division': 'Sylhet',
        'District': 'Sylhet',
        'Upazila': 'Kotwali',
        'Role': 'general_user',
        'Status': 'active',
        'Approval Status': 'approved',
        'Verification Status': 'verified',
        'Gender': 'male',
        'Date of Birth': '1998-02-14',
        'Last Donation Date': '2024-05-18',
        'Contact Visibility': 'public',
        'Preferred Contact Method': 'phone',
        'Additional Notes': 'Rare blood group voluntary donor',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Unified_Users_And_Donors');
    XLSX.writeFile(workbook, `unified_user_and_blood_donor_template.${format}`);
  };

  // ACTION: Unified File Parsing & Pre-Import Validation (User Credentials + Blood Donor Records)
  const handleUnifiedFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUnifiedImportFile(file);
    setUnifiedImportResult(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = evt.target?.result;
        // Parse with cellDates to naturally extract Excel dates, while parseFlexibleDate handles serials, strings, and custom formats
        const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false }) as any[];

        if (!rows || rows.length === 0) {
          setActionBanner({ message: 'The uploaded spreadsheet contains no data rows.', type: 'error' });
          return;
        }

        // Pre-fetch existing emails and phones across both donors and users
        const [donorsSnap, usersSnap] = await Promise.all([
          getDocs(query(collection(db, 'donors'), limit(1500))),
          getDocs(query(collection(db, 'users'), limit(1500))),
        ]);

        const existingEmails = new Set<string>();
        const existingPhones = new Set<string>();

        donorsSnap.forEach((d) => {
          const docData = d.data();
          if (docData.normalizedEmail) existingEmails.add(docData.normalizedEmail);
          if (docData.email) existingEmails.add(normalizeEmail(docData.email));
          if (docData.normalizedPhone) existingPhones.add(docData.normalizedPhone);
          if (docData.phone) {
            const p = normalizeBangladeshPhone(docData.phone);
            if (p) existingPhones.add(p);
          }
        });

        usersSnap.forEach((u) => {
          const docData = u.data();
          if (docData.email) existingEmails.add(normalizeEmail(docData.email));
          if (docData.normalizedPhone) existingPhones.add(docData.normalizedPhone);
          if (docData.phone) {
            const p = normalizeBangladeshPhone(docData.phone);
            if (p) existingPhones.add(p);
          }
        });

        const valid: any[] = [];
        const invalid: { row: number; reason: string; data: any }[] = [];
        const duplicates: { row: number; reason: string; data: any }[] = [];

        rows.forEach((row, idx) => {
          const rowNum = idx + 2;

          // Field extraction supporting flexible, case-insensitive column names
          const rawName = extractRowField(row, ['Full Name', 'Name', 'Display Name', 'Donor Name', 'fullName', 'displayName', 'DonorName']);
          const rawEmail = extractRowField(row, ['User Mail ID', 'User Email', 'Mail ID', 'Email', 'email', 'mail', 'UserMailID', 'Mail', 'User Mail']);
          const rawPassword = extractRowField(row, ['Password', 'password', 'Pass', 'pass', 'Initial Password', 'Temp Password', 'InitialPassword', 'User Password']);
          const rawPhone = extractRowField(row, ['Phone', 'Mobile', 'phone', 'mobile', 'Mobile Number', 'Phone Number', 'Contact', 'Contact Number', 'phoneNumber', 'mobileNumber']);
          const rawBg = extractRowField(row, ['Blood Group', 'Blood', 'bloodGroup', 'Group', 'BloodGroup', 'Blood Type', 'blood_group']) || '';
          const division = extractRowField(row, ['Division', 'division', 'Div']) || 'Dhaka';
          const district = extractRowField(row, ['District', 'district', 'Dist']) || 'Dhaka';
          const upazila = extractRowField(row, ['Upazila', 'upazila', 'Area', 'Thana', 'upazila/area']) || district || 'Sadar';
          const rawRole = extractRowField(row, ['Role', 'Roles', 'role', 'roles', 'Assigned Roles', 'Assigned Role', 'assigned_role']);
          const rawStatus = extractRowField(row, ['Status', 'Account Status', 'status', 'accountStatus', 'account_status']) || 'active';
          const rawApproval = extractRowField(row, ['Approval Status', 'approvalStatus', 'approval_status', 'Approval']) || 'approved';
          const rawVerification = extractRowField(row, ['Verification Status', 'contactVerificationStatus', 'verification_status', 'Verification']) || 'verified';
          const rawGender = String(extractRowField(row, ['Gender', 'gender', 'Sex', 'sex']) || '').toLowerCase().trim();
          const gender: 'male' | 'female' | 'other' | 'unspecified' = 
            ['male', 'female', 'other'].includes(rawGender) ? (rawGender as any) : 'unspecified';

          const rawDob = extractRowField(row, ['Date of Birth', 'DOB', 'dateOfBirth', 'date_of_birth', 'Birth Date', 'BirthDate', 'DateOfBirth']);
          const dateOfBirth = parseFlexibleDate(rawDob);

          const rawLastDonation = extractRowField(row, [
            'Last Donation Date',
            'Last Donation',
            'lastDonationDate',
            'last_donation_date',
            'LastDonation',
            'LastDonationDate',
            'Last Donated',
            'Last Donated Date',
            'Donation Date',
            'donation_date',
            'Previous Donation',
            'Date of Last Donation',
            'Last Blood Donation'
          ]);
          const parsedLastDonation = parseFlexibleDate(rawLastDonation);

          const rawEligibility = extractRowField(row, [
            'Next Eligibility Date',
            'Eligibility Date',
            'eligibilityDate',
            'eligibility_date',
            'Next Eligibility',
            'Next Donation Date',
            'Next Donation'
          ]);
          let parsedEligibility = parseFlexibleDate(rawEligibility);
          if (!parsedEligibility && parsedLastDonation) {
            try {
              parsedEligibility = addCalendarMonths(parsedLastDonation, policy.minimumIntervalMonths || 3);
            } catch (e) {
              parsedEligibility = '';
            }
          }

          const contactVisibility = String(extractRowField(row, ['Contact Visibility', 'contactVisibilityPreference', 'contact_visibility']) || 'public').toLowerCase().trim() as ContactVisibilityPreference;
          const preferredContactMethod = String(extractRowField(row, ['Preferred Contact Method', 'preferredContactMethod', 'preferred_contact_method', 'Preferred Contact']) || 'phone').toLowerCase().trim() as PreferredContactMethod;
          const additionalNotes = String(extractRowField(row, ['Additional Notes', 'Notes', 'Comment', 'Comments', 'Note', 'additional_notes']) || '').trim();

          // 1. Validate Email (User Mail ID)
          if (!rawEmail || !String(rawEmail).trim()) {
            invalid.push({ row: rowNum, reason: 'User Mail ID (Email) is missing', data: row });
            return;
          }

          const normEmail = normalizeEmail(String(rawEmail));
          if (!isValidEmail(normEmail)) {
            invalid.push({ row: rowNum, reason: `Invalid email address "${rawEmail}"`, data: row });
            return;
          }

          // 2. Validate Bangladesh Phone Number
          if (!rawPhone || !String(rawPhone).trim()) {
            invalid.push({ row: rowNum, reason: 'Phone number is missing', data: row });
            return;
          }

          const normPhone = normalizeBangladeshPhone(String(rawPhone));
          if (!normPhone) {
            invalid.push({ row: rowNum, reason: `Invalid Bangladesh phone "${rawPhone}" (must be 11 digits starting with 01[3-9])`, data: row });
            return;
          }

          // 3. Duplicate Detection across existing records and within file batch
          if (existingEmails.has(normEmail)) {
            duplicates.push({ row: rowNum, reason: `User Mail ID "${normEmail}" is already registered`, data: row });
            return;
          }

          if (existingPhones.has(normPhone)) {
            duplicates.push({ row: rowNum, reason: `Phone number "${normPhone}" is already registered`, data: row });
            return;
          }

          existingEmails.add(normEmail);
          existingPhones.add(normPhone);

          // 4. Resolve Password (Firebase Auth requires >= 6 chars; fallback provided if omitted)
          let finalPassword = '';
          let isPasswordAutoGenerated = false;
          if (rawPassword && String(rawPassword).trim().length >= 6) {
            finalPassword = String(rawPassword).trim();
          } else {
            finalPassword = 'Donor@Pass2025';
            isPasswordAutoGenerated = true;
          }

          // 5. Blood Group validation & fallback
          const upperBg = String(rawBg).trim().toUpperCase();
          const bloodGroup: BloodGroup = isValidBloodGroup(upperBg) ? (upperBg as BloodGroup) : 'O+';

          // 6. Name resolution
          const fullName = rawName && String(rawName).trim().length >= 2 
            ? String(rawName).trim() 
            : normEmail.split('@')[0];

          // 7. Role resolution
          let roleIds: string[] = ['general_user'];
          if (rawRole) {
            const tokens = String(rawRole).split(/[,;|]/).map(t => t.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean);
            const matched = tokens.filter(t => DEFAULT_ROLES.some(dr => dr.id === t || dr.name.toLowerCase() === t));
            if (matched.length > 0) roleIds = matched;
          }

          // 8. Statuses resolution
          const statusLower = String(rawStatus || '').toLowerCase().trim();
          const accountStatus: AccountStatus = 
            statusLower === 'suspended' ? 'suspended' : statusLower === 'deactivated' ? 'deactivated' : 'active';

          const appLower = String(rawApproval || '').toLowerCase().trim();
          const approvalStatus: ApprovalStatus = 
            appLower === 'pending' ? 'pending' : appLower === 'rejected' ? 'rejected' : 'approved';

          const verLower = String(rawVerification || '').toLowerCase().trim();
          const verificationStatus: ContactVerificationStatus = 
            verLower === 'unverified' ? 'unverified' : 'verified';

          // Pre-calculate availability for the verified preview row
          const previewCalc = calculateDonorAvailability(
            {
              approvalStatus,
              contactVerificationStatus: verificationStatus,
              accountStatus,
              declaredAvailability: 'available',
              lastDonationDate: parsedLastDonation || undefined,
            },
            policy.minimumIntervalMonths || 3
          );

          valid.push({
            row: rowNum,
            fullName,
            email: normEmail,
            password: finalPassword,
            phone: normPhone,
            normalizedPhone: normPhone,
            bloodGroup,
            division: String(division).trim(),
            district: String(district).trim(),
            upazila: String(upazila).trim(),
            roleIds,
            accountStatus,
            approvalStatus,
            verificationStatus,
            gender,
            dateOfBirth,
            lastDonationDate: parsedLastDonation,
            eligibilityDate: parsedEligibility,
            calculatedAvailability: previewCalc.calculatedAvailability,
            contactVisibility: ['public', 'registered_only', 'hidden'].includes(contactVisibility) ? contactVisibility : 'public',
            preferredContactMethod: ['phone', 'whatsapp', 'sms', 'email'].includes(preferredContactMethod) ? preferredContactMethod : 'phone',
            additionalNotes,
            isPasswordAutoGenerated,
          });
        });

        setUnifiedImportPreview({ valid, invalid, duplicates });
      } catch (err: any) {
        setActionBanner({ message: `Failed to parse file: ${err.message}`, type: 'error' });
      }
    };
    reader.readAsBinaryString(file);
  };

  // ACTION: Process Unified Batch Import (Creates User Credentials AND Blood Donor Profiles simultaneously)
  const handleProcessUnifiedImport = async () => {
    if (!unifiedImportPreview || unifiedImportPreview.valid.length === 0) return;
    setUnifiedImporting(true);
    setUnifiedImportProgress({ current: 0, total: unifiedImportPreview.valid.length });

    let successCount = 0;
    const failures: { email: string; reason: string }[] = [];
    const nowIso = new Date().toISOString();

    try {
      for (let i = 0; i < unifiedImportPreview.valid.length; i++) {
        const item = unifiedImportPreview.valid[i];
        setUnifiedImportProgress({ current: i + 1, total: unifiedImportPreview.valid.length, email: item.email });

        try {
          // 1. Create or retrieve Firebase Authentication account with Mail ID & Password
          let authUid = '';
          if (createAuthAccounts) {
            authUid = await createAuthUserWithoutSwitching(item.email, item.password);
          } else {
            authUid = doc(collection(db, 'users')).id;
          }

          // 2. Atomically write User Account profile in /users
          const userDocData = cleanForFirestore({
            uid: authUid,
            email: item.email,
            displayName: item.fullName,
            roleIds: item.roleIds,
            accountStatus: item.accountStatus,
            phone: item.phone,
            normalizedPhone: item.normalizedPhone,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          await setDoc(doc(db, 'users', authUid), userDocData, { merge: true });

          // 3. Effective approval and verification for donor profile
          const effectiveApproval: ApprovalStatus = autoApproveUnified ? 'approved' : item.approvalStatus;
          const effectiveVerification: ContactVerificationStatus = autoApproveUnified ? 'verified' : item.verificationStatus;

          // 4. Calculate donor availability according to current waiting policy
          const calc = calculateDonorAvailability(
            {
              approvalStatus: effectiveApproval,
              contactVerificationStatus: effectiveVerification,
              accountStatus: item.accountStatus,
              declaredAvailability: 'available',
              lastDonationDate: item.lastDonationDate || undefined,
            },
            policy.minimumIntervalMonths
          );

          // 5. Create Blood Donor clinical profile in /donors
          const donorDocData = cleanForFirestore({
            id: authUid,
            uid: authUid,
            fullName: item.fullName,
            normalizedName: item.fullName.toLowerCase(),
            email: item.email,
            normalizedEmail: item.email.toLowerCase().trim(),
            phone: item.phone,
            normalizedPhone: item.normalizedPhone,
            bloodGroup: item.bloodGroup,
            division: item.division,
            district: item.district,
            upazila: item.upazila,
            gender: item.gender,
            dateOfBirth: item.dateOfBirth || '',
            lastDonationDate: item.lastDonationDate || '',
            eligibilityDate: item.eligibilityDate || calc.eligibilityDate || '',
            declaredAvailability: 'available',
            calculatedAvailability: calc.calculatedAvailability,
            contactVerificationStatus: effectiveVerification,
            approvalStatus: effectiveApproval,
            accountStatus: item.accountStatus,
            publicContactConsent: true,
            publicProfileConsent: true,
            contactVisibilityPreference: item.contactVisibility,
            preferredContactMethod: item.preferredContactMethod,
            additionalNotes: item.additionalNotes || '',
            privacyConsentVersion: '1.0',
            privacyConsentAt: nowIso,
            approvedBy: effectiveApproval === 'approved' ? (user?.uid || 'admin') : undefined,
            approvedAt: effectiveApproval === 'approved' ? nowIso : undefined,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          await setDoc(doc(db, 'donors', authUid), donorDocData, { merge: true });

          // 6. Write donorContacts record for phone privacy shield
          await setDoc(doc(db, 'donorContacts', authUid), {
            donorId: authUid,
            phone: item.normalizedPhone,
            normalizedPhone: item.normalizedPhone,
            email: item.email.toLowerCase().trim(),
            createdAt: nowIso,
            updatedAt: nowIso,
          }, { merge: true });

          // 7. Index phone in registeredPhones for fast unique lookup
          if (item.normalizedPhone) {
            await setDoc(doc(db, 'registeredPhones', item.normalizedPhone), {
              uid: authUid,
              phone: item.normalizedPhone,
              email: item.email.toLowerCase().trim(),
              createdAt: nowIso,
              updatedAt: nowIso,
            }, { merge: true });
          }

          // 8. Sync registeredIdentifier for instant email matching
          await syncRegisteredIdentifier(db, item.email, authUid);

          successCount++;
        } catch (itemErr: any) {
          console.error(`Failed to register unified record for ${item.email}:`, itemErr);
          failures.push({ email: item.email, reason: itemErr.message || 'Registration error' });
        }
      }

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: 'unified_data.batch_import',
          entityType: 'import',
          entityId: 'unifiedImportJobs',
          newValues: {
            filename: unifiedImportFile?.name,
            totalRows: unifiedImportPreview.valid.length + unifiedImportPreview.invalid.length + unifiedImportPreview.duplicates.length,
            successCount,
            failureCount: failures.length,
            duplicateCount: unifiedImportPreview.duplicates.length,
            autoApproved: autoApproveUnified,
            createAuthAccounts,
          },
          outcome: failures.length === 0 ? 'success' : 'failure',
        });
      }

      const statusDesc = autoApproveUnified 
        ? 'All records were registered in Firebase Authentication and are now live in Find Donors!' 
        : 'All records were registered in Firebase Authentication and placed in the pending review queue.';

      if (failures.length === 0) {
        setUnifiedImportResult(`Successfully registered all ${successCount} unified User Accounts & Blood Donors! ${statusDesc}`);
        setActionBanner({
          message: `Unified import complete: ${successCount} accounts registered with login credentials & donor profiles!`,
          type: 'success',
        });
      } else {
        setUnifiedImportResult(`Registered ${successCount} unified records. ${failures.length} failed: ${failures.map(f => `${f.email} (${f.reason})`).join(', ')}`);
        setActionBanner({
          message: `Unified import finished with issues: ${successCount} succeeded, ${failures.length} failed.`,
          type: 'info',
        });
      }

      setUnifiedImportPreview(null);
      setUnifiedImportFile(null);
      await loadDonors();
      await loadUsers();
      await loadMetrics();
    } catch (err: any) {
      setActionBanner({ message: `Unified import failed: ${err.message}`, type: 'error' });
    } finally {
      setUnifiedImporting(false);
      setUnifiedImportProgress(null);
    }
  };

  // ACTION: Unified Data Export (Merges User Accounts & Blood Donors into Complete Dataset)
  const handleExportUnified = async (format: 'csv' | 'xlsx' | 'json') => {
    if (!hasPermission('donors.export') && !hasPermission('users.view') && !isAdmin && !isSuperAdmin) {
      setActionBanner({ message: 'You do not have permission to export user and donor data.', type: 'error' });
      return;
    }

    setUnifiedExporting(true);
    try {
      // 1. Fetch all donors and users in parallel
      const [donorsSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, 'donors'), limit(2500))),
        getDocs(query(collection(db, 'users'), limit(2500))),
      ]);

      const donorsByUid = new Map<string, Donor>();
      const donorsByEmail = new Map<string, Donor>();
      donorsSnap.forEach((d) => {
        const data = d.data() as Donor;
        const uidKey = data.uid || data.id || d.id;
        donorsByUid.set(uidKey, data);
        if (data.email) donorsByEmail.set(normalizeEmail(data.email), data);
        if (data.normalizedEmail) donorsByEmail.set(data.normalizedEmail, data);
      });

      const usersByUid = new Map<string, UserProfile>();
      const usersByEmail = new Map<string, UserProfile>();
      usersSnap.forEach((u) => {
        const data = u.data() as UserProfile;
        usersByUid.set(u.id, data);
        if (data.email) usersByEmail.set(normalizeEmail(data.email), data);
      });

      // 2. Merge into unified records
      const allKeys = new Set<string>();
      donorsByUid.forEach((_, uid) => allKeys.add(uid));
      usersByUid.forEach((_, uid) => allKeys.add(uid));

      const mergedRows: any[] = [];
      allKeys.forEach((key) => {
        const donor = donorsByUid.get(key) || (usersByUid.has(key) && usersByUid.get(key)?.email ? donorsByEmail.get(normalizeEmail(usersByUid.get(key)!.email)) : undefined);
        const usr = usersByUid.get(key) || (donor?.email ? usersByEmail.get(normalizeEmail(donor.email)) : undefined);

        // Apply filters
        if (exportFilterGroup && donor && donor.bloodGroup !== exportFilterGroup) return;
        if (exportFilterDivision && donor && donor.division !== exportFilterDivision) return;
        if (exportFilterApproval !== 'all' && donor && donor.approvalStatus !== exportFilterApproval) return;
        if (exportFilterRole && usr && !usr.roleIds.includes(exportFilterRole)) return;

        const email = usr?.email || donor?.email || '';
        const fullName = usr?.displayName || donor?.fullName || email.split('@')[0] || 'User';
        const phone = donor?.phone || usr?.phone || '';
        const bloodGroup = donor?.bloodGroup || 'O+';
        const division = donor?.division || 'Dhaka';
        const district = donor?.district || 'Dhaka';
        const upazila = donor?.upazila || 'Sadar';
        const roleStr = usr?.roleIds ? usr.roleIds.join(', ') : 'general_user';
        const accountStatus = usr?.accountStatus || donor?.accountStatus || 'active';
        const approvalStatus = donor?.approvalStatus || 'approved';
        const verificationStatus = donor?.contactVerificationStatus || 'verified';
        const calculatedAvailability = donor?.calculatedAvailability || 'available';

        mergedRows.push({
          'UID': sanitizeForSpreadsheet(key),
          'Full Name': sanitizeForSpreadsheet(fullName),
          'User Mail ID': sanitizeForSpreadsheet(email),
          'Password': 'TempPass@2025 (Reset on login)',
          'Phone': sanitizeForSpreadsheet(phone ? formatBangladeshPhone(phone) : ''),
          'Blood Group': sanitizeForSpreadsheet(bloodGroup),
          'Division': sanitizeForSpreadsheet(division),
          'District': sanitizeForSpreadsheet(district),
          'Upazila': sanitizeForSpreadsheet(upazila),
          'Gender': sanitizeForSpreadsheet(donor?.gender || 'unspecified'),
          'Date of Birth': sanitizeForSpreadsheet(donor?.dateOfBirth || ''),
          'Last Donation Date': sanitizeForSpreadsheet(donor?.lastDonationDate || ''),
          'Next Eligibility Date': sanitizeForSpreadsheet(donor?.eligibilityDate || ''),
          'Availability Status': sanitizeForSpreadsheet(calculatedAvailability),
          'Assigned Role': sanitizeForSpreadsheet(roleStr),
          'Account Status': sanitizeForSpreadsheet(accountStatus),
          'Approval Status': sanitizeForSpreadsheet(approvalStatus),
          'Verification Status': sanitizeForSpreadsheet(verificationStatus),
          'Contact Visibility': sanitizeForSpreadsheet(donor?.contactVisibilityPreference || 'public'),
          'Preferred Contact Method': sanitizeForSpreadsheet(donor?.preferredContactMethod || 'phone'),
          'Additional Notes': sanitizeForSpreadsheet(donor?.additionalNotes || ''),
          'Account Created At': sanitizeForSpreadsheet(donor?.createdAt || usr?.createdAt || ''),
          'Last Login At': sanitizeForSpreadsheet(usr?.lastLoginAt ? formatBangladeshDateTime(usr.lastLoginAt) : 'Never'),
        });
      });

      // 3. Format output
      const dateStr = new Date().toISOString().split('T')[0];
      if (format === 'json') {
        const jsonContent = JSON.stringify(mergedRows, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `unified_user_and_blood_donor_database_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const worksheet = XLSX.utils.json_to_sheet(mergedRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Users_And_Donors');
        const fileName = `unified_user_and_blood_donor_database_${dateStr}.${format}`;
        XLSX.writeFile(workbook, fileName);
      }

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: `unified_data.export_${format}`,
          entityType: 'import',
          entityId: 'unifiedExport',
          newValues: {
            format,
            recordCount: mergedRows.length,
            filters: { group: exportFilterGroup, division: exportFilterDivision, role: exportFilterRole, approval: exportFilterApproval },
          },
          outcome: 'success',
        });
      }

      setActionBanner({
        message: `Successfully exported ${mergedRows.length} unified records (User Accounts & Blood Donors) in ${format.toUpperCase()} format.`,
        type: 'success',
      });
    } catch (err: any) {
      setActionBanner({ message: `Unified export failed: ${err.message}`, type: 'error' });
    } finally {
      setUnifiedExporting(false);
    }
  };

  // ACTION: Save Website Settings (Section 11)
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasPermission('settings.view') || !isAdmin) return;

    setSettingsSaving(true);
    setSettingsNotice(null);
    try {
      const updated = {
        ...siteConfig,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.uid || 'admin',
      };
      await setDoc(doc(db, 'systemSettings', 'siteConfiguration'), updated);

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: 'settings.update',
          entityType: 'settings',
          entityId: 'siteConfiguration',
          newValues: updated,
          outcome: 'success',
        });
      }

      setSettingsNotice('Website settings successfully updated.');
    } catch (err: any) {
      setSettingsNotice(`Failed to save settings: ${err.message}`);
    } finally {
      setSettingsSaving(false);
    }
  };

  // Instant in-memory search and approval filtering across all donor fields (0ms latency)
  const filteredDonors = useMemo(() => {
    return donorsList.filter((donor) => {
      if (approvalFilter !== 'all' && donor.approvalStatus !== approvalFilter) {
        return false;
      }
      if (!donorSearch.trim()) return true;
      const s = donorSearch.toLowerCase().trim();
      return (
        (donor.fullName || '').toLowerCase().includes(s) ||
        (donor.email || '').toLowerCase().includes(s) ||
        (donor.phone || '').includes(s) ||
        (donor.district || '').toLowerCase().includes(s) ||
        (donor.upazila || '').toLowerCase().includes(s) ||
        (donor.division || '').toLowerCase().includes(s)
      );
    });
  }, [donorsList, approvalFilter, donorSearch]);

  // Paginated donors for table and mobile card views
  const paginatedDonors = useMemo(() => {
    return filteredDonors.slice((donorPage - 1) * donorPageSize, donorPage * donorPageSize);
  }, [filteredDonors, donorPage, donorPageSize]);

  const totalDonorPages = Math.max(1, Math.ceil(filteredDonors.length / donorPageSize));

  // Check access permission
  if (!isStaff) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-rose-50 text-rose-600 flex items-center justify-center">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Access Restricted</h2>
        <p className="text-xs text-slate-500">
          You do not possess administrative permissions to view this console. Please sign in with an authorized administrator or staff account.
        </p>
        <button
          onClick={() => onNavigate('home')}
          className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
        >
          Return to Home
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Console Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Administrative Control Center
            </h1>
            <span className="text-xs font-medium px-2 py-0.5 rounded-sm bg-slate-100 text-slate-700 border border-slate-200">
              {isSuperAdmin ? 'Super Admin' : isAdmin ? 'Admin' : isDonorManager ? 'Donor Manager' : 'Staff / Auditor'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Role-Based Management · Bangladesh Standard Time · Zero-Slop Medical Records
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate('home')}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            Public Site
          </button>
        </div>
      </div>

      {/* Accessible Action Feedback Banner */}
      {actionBanner && (
        <div
          role="alert"
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs transition-all ${
            actionBanner.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : actionBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionBanner.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            ) : actionBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-blue-600 shrink-0" />
            )}
            <span className="font-medium leading-relaxed">{actionBanner.message}</span>
          </div>
          <button
            onClick={() => setActionBanner(null)}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-sm focus:outline-hidden"
            aria-label="Dismiss message"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Responsive Navigation Tabs with Mobile Quick-Select & Scroll Indicators */}
      <div className="space-y-2">
        {/* Mobile Quick Dropdown Jump (for ultra-fast navigation on narrow screens) */}
        <div className="sm:hidden flex items-center gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-2xs">
          <label htmlFor="admin-mobile-tab-select" className="text-[11px] font-bold uppercase tracking-wider text-slate-500 shrink-0 pl-1">
            Section:
          </label>
          <div className="relative flex-1">
            <select
              id="admin-mobile-tab-select"
              value={activeTab}
              onChange={(e) => handleSelectTab(e.target.value as AdminTab)}
              className="w-full appearance-none bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-xs font-semibold text-slate-900 pr-8 focus:outline-hidden focus:ring-2 focus:ring-rose-500 min-h-[44px]"
            >
              <option value="overview">📊 System Overview</option>
              <option value="donors">👥 Donor Records ({metrics.totalDonors})</option>
              {hasPermission('users.view') && (
                <option value="users">🛡️ Users &amp; Roles ({metrics.totalUsers})</option>
              )}
              {hasPermission('settings.availability_policy.view') && (
                <option value="policy">⏱️ Availability Policy ({policy.minimumIntervalMonths}mo)</option>
              )}
              {(hasPermission('donors.import') || hasPermission('donors.export') || hasPermission('users.view') || isAdmin || isSuperAdmin) && (
                <option value="import_export">📁 Unified Import &amp; Export (Users &amp; Donors)</option>
              )}
              {hasPermission('audit_logs.view') && (
                <option value="audit">📜 Audit Trail</option>
              )}
              {hasPermission('settings.view') && (
                <option value="settings">⚙️ Website Settings</option>
              )}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Segmented Tab Strip with Chevrons and Overflow Auto-Scroll */}
        <div className="relative group/tabnav bg-slate-100 p-1.5 rounded-xl border border-slate-200/80 -mx-4 px-2 sm:mx-0 sm:px-1.5">
          {/* Left Scroll Chevron (Hidden on smallest mobile, accessible on scrollable containers) */}
          <button
            type="button"
            onClick={() => handleScrollTabs('left')}
            className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 z-20 w-7 h-7 items-center justify-center rounded-lg bg-white/95 text-slate-600 hover:text-slate-900 shadow-xs border border-slate-200/90 hover:scale-105 transition-all opacity-0 group-hover/tabnav:opacity-100 focus:opacity-100"
            aria-label="Scroll tabs left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Right Scroll Chevron */}
          <button
            type="button"
            onClick={() => handleScrollTabs('right')}
            className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 z-20 w-7 h-7 items-center justify-center rounded-lg bg-white/95 text-slate-600 hover:text-slate-900 shadow-xs border border-slate-200/90 hover:scale-105 transition-all opacity-0 group-hover/tabnav:opacity-100 focus:opacity-100"
            aria-label="Scroll tabs right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Tab Button List */}
          <div
            ref={tabScrollContainerRef}
            role="tablist"
            aria-label="Admin Navigation Tabs"
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth px-1 py-0.5"
          >
            <button
              ref={(el) => { tabButtonRefs.current.overview = el; }}
              role="tab"
              aria-selected={activeTab === 'overview'}
              onClick={() => handleSelectTab('overview')}
              className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 min-h-[44px] focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                activeTab === 'overview'
                  ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200/80 font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <BarChart3 className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'overview' ? 'text-rose-600' : 'text-slate-500'}`} />
              <span>System Overview</span>
            </button>

            <button
              ref={(el) => { tabButtonRefs.current.donors = el; }}
              role="tab"
              aria-selected={activeTab === 'donors'}
              onClick={() => handleSelectTab('donors')}
              className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 min-h-[44px] focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                activeTab === 'donors'
                  ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200/80 font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Users className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'donors' ? 'text-rose-600' : 'text-slate-500'}`} />
              <span>Donor Records</span>
              <span
                className={`ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-md tabular-nums ${
                  activeTab === 'donors'
                    ? 'bg-rose-50 text-rose-700 border border-rose-200/60'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {metricsLoading ? '…' : metrics.totalDonors}
              </span>
            </button>

            {hasPermission('users.view') && (
              <button
                ref={(el) => { tabButtonRefs.current.users = el; }}
                role="tab"
                aria-selected={activeTab === 'users'}
                onClick={() => handleSelectTab('users')}
                className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 min-h-[44px] focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                  activeTab === 'users'
                    ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200/80 font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Shield className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'users' ? 'text-rose-600' : 'text-slate-500'}`} />
                <span>Users &amp; Roles</span>
                {metrics.totalUsers > 0 && (
                  <span
                    className={`ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-md tabular-nums ${
                      activeTab === 'users'
                        ? 'bg-rose-50 text-rose-700 border border-rose-200/60'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {metrics.totalUsers}
                  </span>
                )}
              </button>
            )}

            {hasPermission('settings.availability_policy.view') && (
              <button
                ref={(el) => { tabButtonRefs.current.policy = el; }}
                role="tab"
                aria-selected={activeTab === 'policy'}
                onClick={() => handleSelectTab('policy')}
                className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 min-h-[44px] focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                  activeTab === 'policy'
                    ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200/80 font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Clock className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'policy' ? 'text-rose-600' : 'text-slate-500'}`} />
                <span>Availability Policy</span>
                <span
                  className={`ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-md ${
                    activeTab === 'policy'
                      ? 'bg-rose-50 text-rose-700 border border-rose-200/60'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {policy.minimumIntervalMonths}mo
                </span>
              </button>
            )}

            {(hasPermission('donors.import') || hasPermission('donors.export') || hasPermission('users.view') || isAdmin || isSuperAdmin) && (
              <button
                ref={(el) => { tabButtonRefs.current.import_export = el; }}
                role="tab"
                aria-selected={activeTab === 'import_export'}
                onClick={() => handleSelectTab('import_export')}
                className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 min-h-[44px] focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                  activeTab === 'import_export'
                    ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200/80 font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <FileSpreadsheet className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'import_export' ? 'text-rose-600' : 'text-slate-500'}`} />
                <span>Unified Import &amp; Export</span>
              </button>
            )}

            {hasPermission('audit_logs.view') && (
              <button
                ref={(el) => { tabButtonRefs.current.audit = el; }}
                role="tab"
                aria-selected={activeTab === 'audit'}
                onClick={() => handleSelectTab('audit')}
                className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 min-h-[44px] focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                  activeTab === 'audit'
                    ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200/80 font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <FileText className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'audit' ? 'text-rose-600' : 'text-slate-500'}`} />
                <span>Audit Trail</span>
              </button>
            )}

            {hasPermission('settings.view') && (
              <button
                ref={(el) => { tabButtonRefs.current.settings = el; }}
                role="tab"
                aria-selected={activeTab === 'settings'}
                onClick={() => handleSelectTab('settings')}
                className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 min-h-[44px] focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                  activeTab === 'settings'
                    ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200/80 font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Sliders className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'settings' ? 'text-rose-600' : 'text-slate-500'}`} />
                <span>Website Settings</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Key Metrics Strip (Real queries, tabular numbers) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-1">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Donors</span>
              <p className="text-2xl font-bold text-slate-900 tabular-nums">
                {metricsLoading ? '…' : metrics.totalDonors}
              </p>
              <span className="text-[11px] text-slate-400">All registered profiles</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-1">
              <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">Approved Donors</span>
              <p className="text-2xl font-bold text-emerald-800 tabular-nums">
                {metricsLoading ? '…' : metrics.approvedDonors}
              </p>
              <span className="text-[11px] text-slate-400">Reviewed & validated</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-1">
              <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">Pending Approval</span>
              <p className="text-2xl font-bold text-amber-800 tabular-nums">
                {metricsLoading ? '…' : metrics.pendingDonors}
              </p>
              <span className="text-[11px] text-slate-400">Awaiting coordinator review</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-1">
              <span className="text-[11px] font-semibold text-rose-700 uppercase tracking-wider">Currently Available</span>
              <p className="text-2xl font-bold text-rose-800 tabular-nums">
                {metricsLoading ? '…' : metrics.availableDonors}
              </p>
              <span className="text-[11px] text-slate-400">Passed 3-mo resting rule</span>
            </div>
          </div>

          {/* Secondary stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white p-3.5 rounded-lg border border-slate-200 text-xs">
              <span className="text-slate-500 block">Verified Contacts</span>
              <span className="text-base font-bold text-slate-900 tabular-nums">{metrics.verifiedContacts}</span>
            </div>
            <div className="bg-white p-3.5 rounded-lg border border-slate-200 text-xs">
              <span className="text-slate-500 block">Resting Interval (Unavailable)</span>
              <span className="text-base font-bold text-slate-900 tabular-nums">{metrics.unavailableDonors}</span>
            </div>
            <div className="bg-white p-3.5 rounded-lg border border-slate-200 text-xs">
              <span className="text-slate-500 block">Suspended Accounts</span>
              <span className="text-base font-bold text-slate-900 tabular-nums">{metrics.suspendedDonors}</span>
            </div>
            <div className="bg-white p-3.5 rounded-lg border border-slate-200 text-xs">
              <span className="text-slate-500 block">Platform Users</span>
              <span className="text-base font-bold text-slate-900 tabular-nums">{metrics.totalUsers}</span>
            </div>
          </div>

          {/* Quick Actions & Policy Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">Recent Security & Admin Activity</h3>
                <button
                  onClick={() => setActiveTab('audit')}
                  className="text-xs font-semibold text-rose-700 hover:text-rose-800"
                >
                  View Full Audit Log
                </button>
              </div>

              {recentAudits.length > 0 ? (
                <div className="space-y-2">
                  {recentAudits.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs"
                    >
                      <div className="space-y-0.5">
                        <span className="font-semibold text-slate-800">{a.action}</span>
                        <p className="text-[11px] text-slate-500">
                          Actor: {a.actorEmail || a.actorUid} · Entity: {a.entityType}/{a.entityId}
                        </p>
                      </div>
                      <span className="text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
                        {formatBangladeshDateTime(a.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 py-4 text-center">No recent audit events recorded.</p>
              )}
            </div>

            <div className="bg-slate-50 rounded-xl border border-slate-200 p-6 space-y-4 text-xs">
              <h3 className="text-sm font-bold text-slate-900">Availability Policy Status</h3>
              <p className="text-slate-600 leading-relaxed">
                Centralized donor availability waiting period is currently set to:
              </p>
              <div className="p-4 bg-white rounded-lg border border-slate-200 text-center">
                <span className="text-2xl font-bold text-rose-700 tabular-nums">
                  {policy.minimumIntervalMonths} Calendar Months
                </span>
                <span className="block text-[11px] text-slate-400 mt-1">
                  Policy Version {policy.policyVersion || 1}
                </span>
              </div>
              {hasPermission('settings.availability_policy.manage') && (
                <button
                  onClick={() => setActiveTab('policy')}
                  className="w-full py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
                >
                  Adjust Waiting Period
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DONOR MANAGEMENT */}
      {activeTab === 'donors' && (
        <div className="space-y-4">
          {/* Responsive Donor Controls & Sub-Tabs Bar */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            {/* Top Row: Responsive Segmented Approval Sub-Tabs & View Mode Switcher */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-slate-100">
              <div
                role="tablist"
                aria-label="Filter Donors by Approval Status"
                className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth p-1 bg-slate-100 rounded-xl -mx-2 px-2 sm:mx-0 sm:px-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={approvalFilter === 'all'}
                  onClick={() => { setApprovalFilter('all'); setDonorPage(1); }}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg shrink-0 transition-all min-h-[40px] focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                    approvalFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200/80 font-bold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  <span>All Records</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] tabular-nums font-bold ${
                      approvalFilter === 'all' ? 'bg-slate-100 text-slate-800' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {donorsList.length}
                  </span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={approvalFilter === 'pending'}
                  onClick={() => { setApprovalFilter('pending'); setDonorPage(1); }}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg shrink-0 transition-all min-h-[40px] focus:outline-hidden focus:ring-2 focus:ring-amber-500 ${
                    approvalFilter === 'pending'
                      ? 'bg-amber-500 text-white shadow-xs font-bold'
                      : 'text-amber-800 hover:text-amber-900 hover:bg-amber-100/60'
                  }`}
                >
                  <span>Pending Review</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] tabular-nums font-bold ${
                      approvalFilter === 'pending' ? 'bg-amber-600 text-white' : 'bg-amber-200 text-amber-900'
                    }`}
                  >
                    {donorsList.filter((d) => d.approvalStatus === 'pending').length}
                  </span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={approvalFilter === 'approved'}
                  onClick={() => { setApprovalFilter('approved'); setDonorPage(1); }}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg shrink-0 transition-all min-h-[40px] focus:outline-hidden focus:ring-2 focus:ring-emerald-500 ${
                    approvalFilter === 'approved'
                      ? 'bg-emerald-600 text-white shadow-xs font-bold'
                      : 'text-emerald-800 hover:text-emerald-900 hover:bg-emerald-100/60'
                  }`}
                >
                  <span>Approved</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] tabular-nums font-bold ${
                      approvalFilter === 'approved' ? 'bg-emerald-700 text-white' : 'bg-emerald-200 text-emerald-900'
                    }`}
                  >
                    {donorsList.filter((d) => d.approvalStatus === 'approved').length}
                  </span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={approvalFilter === 'rejected'}
                  onClick={() => { setApprovalFilter('rejected'); setDonorPage(1); }}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg shrink-0 transition-all min-h-[40px] focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                    approvalFilter === 'rejected'
                      ? 'bg-rose-600 text-white shadow-xs font-bold'
                      : 'text-rose-800 hover:text-rose-900 hover:bg-rose-100/60'
                  }`}
                >
                  <span>Rejected</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] tabular-nums font-bold ${
                      approvalFilter === 'rejected' ? 'bg-rose-700 text-white' : 'bg-rose-200 text-rose-900'
                    }`}
                  >
                    {donorsList.filter((d) => d.approvalStatus === 'rejected').length}
                  </span>
                </button>
              </div>

              {/* Mobile View Toggle Segmented Tabs & Refresh */}
              <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                <div role="tablist" aria-label="Donor View Mode" className="md:hidden flex items-center p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={donorMobileViewMode === 'cards'}
                    onClick={() => setDonorMobileViewMode('cards')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all min-h-[38px] ${
                      donorMobileViewMode === 'cards'
                        ? 'bg-white text-slate-900 shadow-2xs font-bold ring-1 ring-slate-200/80'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Cards
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={donorMobileViewMode === 'table'}
                    onClick={() => setDonorMobileViewMode('table')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all min-h-[38px] ${
                      donorMobileViewMode === 'table'
                        ? 'bg-white text-slate-900 shadow-2xs font-bold ring-1 ring-slate-200/80'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Table
                  </button>
                </div>

                <button
                  onClick={() => loadDonors()}
                  className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors flex items-center gap-1.5 min-h-[38px]"
                  title="Refresh donors list from Firestore"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              </div>
            </div>

            {/* Bottom Row: Search, Blood Group Filter & Manual Donor Entry */}
            <div className="flex flex-col sm:flex-row items-center gap-2.5 text-xs">
              <div className="relative flex-1 w-full">
                <input
                  type="text"
                  value={donorSearch}
                  onChange={(e) => { setDonorSearch(e.target.value); setDonorPage(1); }}
                  placeholder="Search donors by name, mobile, district, upazila..."
                  className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden min-h-[40px]"
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              </div>

              <select
                value={groupFilter}
                onChange={(e) => { setGroupFilter(e.target.value); setDonorPage(1); }}
                className="w-full sm:w-auto px-3 py-2 border border-slate-300 rounded-lg bg-white min-h-[40px] font-medium"
              >
                <option value="">All Blood Groups</option>
                {ALL_BLOOD_GROUPS.map((bg) => (
                  <option key={bg} value={bg}>
                    {bg}
                  </option>
                ))}
              </select>

              {canRegisterDonor && (
                <button
                  type="button"
                  onClick={() => setManualDonorModalOpen(true)}
                  className="w-full sm:w-auto px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-lg shadow-2xs transition-colors flex items-center justify-center gap-1.5 min-h-[40px] shrink-0"
                  title="Super Admin, Admin, Donor Manager, or Data Entry Operator manual registration"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Manual Donor Entry</span>
                </button>
              )}
            </div>
          </div>

          {/* Batch Selection Banner */}
          {selectedDonorIds.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs shadow-xs animate-in fade-in duration-150">
              <div className="flex items-center gap-2 text-rose-900 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{selectedDonorIds.length} donor record{selectedDonorIds.length > 1 ? 's' : ''} selected</span>
                <button
                  type="button"
                  onClick={() => setSelectedDonorIds([])}
                  className="text-[11px] text-rose-600 hover:underline font-normal ml-2"
                >
                  Clear selection
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBatchDeleteDonorsOpen(true)}
                  className="px-3.5 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 min-h-[36px]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Selected from Firebase ({selectedDonorIds.length})</span>
                </button>
              </div>
            </div>
          )}

          {/* Mobile Donor Cards View (Shown on mobile when cards mode active) */}
          {donorMobileViewMode === 'cards' && (
            <div className="md:hidden space-y-3">
              {donorsLoading ? (
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-xs text-slate-400">
                  Loading donor records from Firestore...
                </div>
              ) : paginatedDonors.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-xs text-slate-500">
                  No donor records matching search criteria.
                </div>
              ) : (
                paginatedDonors.map((donor) => (
                  <div key={donor.id} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-2xs">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Select donor ${donor.fullName}`}
                          checked={selectedDonorIds.includes(donor.id)}
                          onChange={() => handleToggleSelectDonor(donor.id)}
                          className="rounded-sm border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                        />
                        <div className="w-10 h-10 rounded-lg bg-rose-50 border border-rose-100 text-rose-700 font-bold flex items-center justify-center text-sm shadow-2xs">
                          {donor.bloodGroup}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-slate-900">{donor.fullName}</h4>
                          <p className="text-[11px] text-slate-400">{donor.email}</p>
                        </div>
                      </div>
                      <StatusBadge status={donor.calculatedAvailability} type="availability" size="sm" />
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                      <div>
                        <span className="text-slate-400 block text-[10px]">Location:</span>
                        <span className="font-medium text-slate-800 truncate block">{donor.upazila}, {donor.district}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Phone:</span>
                        <a href={`tel:${donor.phone}`} className="font-semibold text-rose-600 hover:underline">
                          {formatBangladeshPhone(donor.phone)}
                        </a>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Approval:</span>
                        <button
                          type="button"
                          onClick={() => handleOpenStatusDialog(donor)}
                          className="hover:opacity-80 text-left"
                        >
                          <StatusBadge status={donor.approvalStatus} type="approval" size="sm" />
                        </button>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Verification:</span>
                        <button
                          type="button"
                          onClick={() => handleOpenStatusDialog(donor, undefined, 'verified')}
                          className="hover:opacity-80 text-left"
                        >
                          <StatusBadge status={donor.contactVerificationStatus} type="verification" size="sm" />
                        </button>
                      </div>
                    </div>

                    {/* Action Buttons for Mobile Card */}
                    <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2">
                      {donor.approvalStatus !== 'approved' && hasPermission('donors.approve') && (
                        <button
                          onClick={() => handleApproveDonor(donor)}
                          className="flex-1 min-h-[38px] py-1.5 px-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1 shadow-2xs"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Approve</span>
                        </button>
                      )}

                      {donor.contactVerificationStatus !== 'verified' && hasPermission('donors.approve') && (
                        <button
                          onClick={() => handleQuickApproveVerification(donor)}
                          className="flex-1 min-h-[38px] py-1.5 px-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1 shadow-2xs"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Verify</span>
                        </button>
                      )}

                      {hasPermission('donors.approve') && (
                        <button
                          onClick={() => handleOpenStatusDialog(donor)}
                          className="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium min-h-[38px] flex items-center justify-center gap-1"
                          title="Manage Status"
                        >
                          <Sliders className="w-3.5 h-3.5 text-slate-600" />
                          <span>Status</span>
                        </button>
                      )}

                      <button
                        onClick={() => setSelectedDonorDetail(donor)}
                        className="py-1.5 px-3 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium min-h-[38px] flex items-center justify-center gap-1"
                        title="View Details"
                      >
                        <Eye className="w-3.5 h-3.5 text-slate-500" />
                        <span>Details</span>
                      </button>

                      <button
                        onClick={() => {
                          setEditDateDonor(donor);
                          setNewDonationDate(donor.lastDonationDate || '');
                        }}
                        className="py-1.5 px-2.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium min-h-[38px] flex items-center justify-center"
                        title="Edit Donation Date"
                      >
                        <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      </button>

                      {(hasPermission('donors.delete') || isAdmin || isSuperAdmin) && (
                        <button
                          onClick={() => {
                            setDeleteDonorTarget(donor);
                            setDeleteDonorReason('');
                          }}
                          className="py-1.5 px-2.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-medium min-h-[38px] flex items-center justify-center"
                          title="Permanently Delete Donor Record from Firebase"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Donors Table (Always visible on desktop, or on mobile when table mode selected) */}
          <div className={`bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs ${donorMobileViewMode === 'cards' ? 'hidden md:block' : 'block'}`}>
            <div className="md:hidden text-[11px] text-slate-500 px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <span>Swipe horizontally to view all columns</span>
              <span className="font-semibold text-rose-600">&rarr;</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600 min-w-[780px]">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-800 font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        aria-label="Select all donors on this page"
                        checked={paginatedDonors.length > 0 && paginatedDonors.every((d) => selectedDonorIds.includes(d.id))}
                        onChange={() => handleToggleSelectAllDonors(paginatedDonors)}
                        className="rounded-sm border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                      />
                    </th>
                    <th className="py-3 px-4">Donor Name</th>
                    <th className="py-3 px-3">Blood Group</th>
                    <th className="py-3 px-4">Location</th>
                    <th className="py-3 px-4">Phone</th>
                    <th className="py-3 px-3">Approval</th>
                    <th className="py-3 px-3">Verification</th>
                    <th className="py-3 px-3">Last Donation</th>
                    <th className="py-3 px-3">Calculated Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {donorsLoading ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-slate-400">
                        Loading donor records from Firestore...
                      </td>
                    </tr>
                  ) : paginatedDonors.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-slate-500">
                        No donor records matching search criteria.
                      </td>
                    </tr>
                  ) : (
                    paginatedDonors.map((donor) => (
                      <tr key={donor.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-3 text-center">
                          <input
                            type="checkbox"
                            aria-label={`Select donor ${donor.fullName}`}
                            checked={selectedDonorIds.includes(donor.id)}
                            onChange={() => handleToggleSelectDonor(donor.id)}
                            className="rounded-sm border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          <div>{donor.fullName}</div>
                          <span className="text-[11px] text-slate-400 font-normal">{donor.email}</span>
                        </td>
                        <td className="py-3 px-3 font-bold text-rose-700">
                          {donor.bloodGroup}
                        </td>
                        <td className="py-3 px-4">
                          <div>{donor.upazila}, {donor.district}</div>
                          <span className="text-[11px] text-slate-400">{donor.division} Div.</span>
                        </td>
                        <td className="py-3 px-4 tabular-nums">
                          {formatBangladeshPhone(donor.phone)}
                        </td>
                        <td className="py-3 px-3">
                          <button
                            type="button"
                            onClick={() => handleOpenStatusDialog(donor)}
                            className="cursor-pointer hover:opacity-80 transition-opacity"
                            title="Click to review/approve registration status"
                          >
                            <StatusBadge status={donor.approvalStatus} type="approval" size="sm" />
                          </button>
                        </td>
                        <td className="py-3 px-3">
                          <button
                            type="button"
                            onClick={() => handleOpenStatusDialog(donor, undefined, 'verified')}
                            className="cursor-pointer hover:opacity-80 transition-opacity"
                            title="Click to approve contact verification"
                          >
                            <StatusBadge status={donor.contactVerificationStatus} type="verification" size="sm" />
                          </button>
                        </td>
                        <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                          {donor.lastDonationDate ? (
                            <div className="flex items-center gap-1 text-[11px]">
                              <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                              <span>{formatBangladeshDateOnly(donor.lastDonationDate)}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">None</span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <button
                            type="button"
                            onClick={() => handleOpenStatusDialog(donor)}
                            className="cursor-pointer hover:opacity-80 transition-opacity"
                            title="Click to inspect and manage calculated availability"
                          >
                            <StatusBadge status={donor.calculatedAvailability} type="availability" size="sm" />
                          </button>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Approve Registration & Verification together */}
                            {donor.approvalStatus !== 'approved' && hasPermission('donors.approve') && (
                              <button
                                onClick={() => handleApproveDonor(donor)}
                                className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-md transition-colors"
                                title="Approve Registration & Contact Verification"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                            )}

                            {/* Quick Approve Verification */}
                            {donor.contactVerificationStatus !== 'verified' && hasPermission('donors.approve') && (
                              <button
                                onClick={() => handleQuickApproveVerification(donor)}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                                title="Quick Approve Contact Verification"
                              >
                                <ShieldCheck className="w-4 h-4" />
                              </button>
                            )}

                            {/* Approve Verification & Calculated Status Dialog */}
                            {hasPermission('donors.approve') && (
                              <button
                                onClick={() => handleOpenStatusDialog(donor)}
                                className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                                title="Approve Verification & Calculated Status"
                              >
                                <Sliders className="w-4 h-4" />
                              </button>
                            )}

                            {/* Reject button */}
                            {donor.approvalStatus !== 'rejected' && hasPermission('donors.reject') && (
                              <button
                                onClick={() => {
                                  setRejectDialogDonor(donor);
                                  setRejectReason('');
                                }}
                                className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                                title="Reject Registration"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}

                            {/* Update Donation Date */}
                            {hasPermission('donors.update') && (
                              <button
                                onClick={() => {
                                  setEditDateDonor(donor);
                                  setNewDonationDate(donor.lastDonationDate || '');
                                }}
                                className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                                title="Update Donation Date & Recalculate"
                              >
                                <Calendar className="w-4 h-4" />
                              </button>
                            )}

                            {/* Suspend / Reactivate */}
                            {hasPermission('donors.suspend') && (
                              <button
                                onClick={() => handleToggleSuspendDonor(donor)}
                                className={`p-1.5 rounded-md transition-colors ${
                                  donor.accountStatus === 'suspended'
                                    ? 'text-emerald-700 hover:bg-emerald-50'
                                    : 'text-amber-600 hover:bg-amber-50'
                                }`}
                                title={donor.accountStatus === 'suspended' ? 'Reactivate Donor' : 'Suspend Account'}
                              >
                                {donor.accountStatus === 'suspended' ? (
                                  <UserCheck className="w-4 h-4" />
                                ) : (
                                  <UserX className="w-4 h-4" />
                                )}
                              </button>
                            )}

                            {/* Details view */}
                            <button
                              onClick={() => setSelectedDonorDetail(donor)}
                              className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-md transition-colors"
                              title="View Full Record"
                            >
                              <Eye className="w-4 h-4" />
                            </button>

                            {/* Permanently Delete Donor */}
                            {(hasPermission('donors.delete') || isAdmin || isSuperAdmin) && (
                              <button
                                onClick={() => {
                                  setDeleteDonorTarget(donor);
                                  setDeleteDonorReason('');
                                }}
                                className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                                title="Permanently Delete Donor Record"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={donorPage}
              totalPages={totalDonorPages}
              totalItems={filteredDonors.length}
              pageSize={donorPageSize}
              onPageChange={(p) => setDonorPage(p)}
            />
          </div>
        </div>
      )}

      {/* TAB 3: USER & ROLE MANAGEMENT */}
      {activeTab === 'users' && hasPermission('users.view') && (
        <div className="space-y-6">
          <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Administrative System Users</h3>
              <p className="text-slate-500">Configure roles, permissions, and synchronize user accounts with the Find Donors directory.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleSyncUsersToDonors}
                disabled={syncingUsersToDonors}
                className="px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg flex items-center gap-1.5 transition-colors min-h-[38px] shadow-2xs"
                title="Sync all system users into the Find Donors section as verified donors"
              >
                <Sparkles className={`w-3.5 h-3.5 text-emerald-600 ${syncingUsersToDonors ? 'animate-spin' : ''}`} />
                <span>{syncingUsersToDonors ? 'Syncing to Donors...' : 'Sync Users to Find Donors'}</span>
              </button>
              <button
                onClick={() => {
                  setUnifiedSubTab('import');
                  setActiveTab('import_export');
                }}
                className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg flex items-center gap-1.5 transition-colors min-h-[38px]"
                title="Batch Import User Mail IDs, Passwords & Blood Donors"
              >
                <Upload className="w-3.5 h-3.5" />
                Unified Import
              </button>
              <button
                onClick={() => handleExportUnified('csv')}
                disabled={unifiedExporting}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1.5 transition-colors min-h-[38px]"
                title="Export Unified Records to CSV"
              >
                <FileText className="w-3.5 h-3.5" />
                Export CSV
              </button>
              <button
                onClick={() => handleExportUnified('xlsx')}
                disabled={unifiedExporting}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1.5 transition-colors min-h-[38px]"
                title="Export Unified Records to Excel (XLSX)"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Export XLSX
              </button>
              <button
                onClick={() => loadUsers()}
                className="px-3 py-2 font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1.5 min-h-[38px]"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
            </div>
          </div>

          {/* User Batch Selection Banner */}
          {selectedUserIds.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs shadow-xs animate-in fade-in duration-150">
              <div className="flex items-center gap-2 text-rose-900 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{selectedUserIds.length} user account{selectedUserIds.length > 1 ? 's' : ''} selected</span>
                <button
                  type="button"
                  onClick={() => setSelectedUserIds([])}
                  className="text-[11px] text-rose-600 hover:underline font-normal ml-2"
                >
                  Clear selection
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBatchDeleteUsersOpen(true)}
                  className="px-3.5 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 min-h-[36px]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Selected Users from Firebase ({selectedUserIds.length})</span>
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-800 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      aria-label="Select all eligible users"
                      checked={
                        usersList.filter((u) => u.uid !== user?.uid && u.email?.toLowerCase().trim() !== 'abrar.noceng@gmail.com').length > 0 &&
                        usersList
                          .filter((u) => u.uid !== user?.uid && u.email?.toLowerCase().trim() !== 'abrar.noceng@gmail.com')
                          .every((u) => selectedUserIds.includes(u.uid))
                      }
                      onChange={handleToggleSelectAllUsers}
                      className="rounded-sm border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                    />
                  </th>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Assigned Roles</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usersLoading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      Loading users...
                    </td>
                  </tr>
                ) : (
                  usersList.map((usr) => (
                    <tr key={usr.uid} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-3 text-center">
                        {usr.uid !== user?.uid && usr.email?.toLowerCase().trim() !== 'abrar.noceng@gmail.com' ? (
                          <input
                            type="checkbox"
                            aria-label={`Select user ${usr.email}`}
                            checked={selectedUserIds.includes(usr.uid)}
                            onChange={() => handleToggleSelectUser(usr.uid)}
                            className="rounded-sm border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                          />
                        ) : (
                          <span className="text-slate-300 text-[10px] font-mono" title="Protected account">&mdash;</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {usr.displayName || 'User'}
                        {usr.uid === user?.uid && (
                          <span className="ml-2 text-[10px] text-rose-700 font-normal">(Current You)</span>
                        )}
                      </td>
                      <td className="py-3 px-4">{usr.email}</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {usr.roleIds.map((rId) => {
                            const rDef = DEFAULT_ROLES.find((r) => r.id === rId);
                            return (
                              <span
                                key={rId}
                                className="px-2 py-0.5 rounded-sm bg-slate-100 text-slate-700 text-[11px] border border-slate-200"
                              >
                                {rDef ? rDef.name : rId}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <StatusBadge status={usr.accountStatus} type="account" size="sm" />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {hasPermission('users.manage_roles') && (
                            <button
                              onClick={() => {
                                setRoleChangeUser(usr);
                                setSelectedRoles([...usr.roleIds]);
                              }}
                              className="px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition-colors"
                            >
                              Edit Roles
                            </button>
                          )}
                          {(hasPermission('users.delete') || isSuperAdmin) &&
                            usr.uid !== user?.uid &&
                            usr.email.toLowerCase() !== 'abrar.noceng@gmail.com' && (
                              <button
                                onClick={() => {
                                  setDeleteUserTarget(usr);
                                  setDeleteUserCascade(true);
                                  setDeleteUserReason('');
                                }}
                                className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                                title="Delete User Account"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Reference: Defined RBAC Roles */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Defined Role Capabilities (RBAC)</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {DEFAULT_ROLES.map((r) => (
                <div key={r.id} className="bg-white p-4 rounded-lg border border-slate-200 space-y-2 text-xs">
                  <span className="font-bold text-slate-900 block">{r.name}</span>
                  <p className="text-[11px] text-slate-500 leading-relaxed">{r.description}</p>
                  <div className="pt-2 border-t border-slate-100 text-[10px] text-slate-400">
                    {r.permissions.length} capabilities assigned
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: AVAILABILITY POLICY MANAGEMENT (Section 6) */}
      {activeTab === 'policy' && hasPermission('settings.availability_policy.view') && (
        <div className="max-w-2xl mx-auto bg-white rounded-xl border border-slate-200 p-8 space-y-6 shadow-2xs">
          <div className="border-b border-slate-200 pb-4">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-rose-600" />
              Donor Availability Policy Management
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Configures the statutory resting period after blood donation. Enforced using Asia/Dhaka calendar months.
            </p>
          </div>

          {policyMessage && (
            <div
              className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
                policyMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {policyMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{policyMessage.text}</span>
            </div>
          )}

          {/* Current Policy Overview */}
          <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Current Minimum Interval:</span>
              <span className="font-bold text-slate-900 text-sm tabular-nums">
                {policy.minimumIntervalMonths} Calendar Months
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Policy Version:</span>
              <span className="font-semibold text-slate-800 tabular-nums">
                v{policy.policyVersion || 1}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Last Modified (Dhaka Time):</span>
              <span className="text-slate-700 tabular-nums">
                {formatBangladeshDateTime(policy.updatedAt)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Modified By Administrator:</span>
              <span className="text-slate-700 font-mono text-[11px]">
                {policy.updatedByEmail || policy.updatedBy || 'System Bootstrap'}
              </span>
            </div>
          </div>

          {/* Policy Adjustment Form */}
          {hasPermission('settings.availability_policy.manage') ? (
            <div className="space-y-4 pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  New Waiting Period (1–12 Calendar Months)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={policyInput}
                    onChange={(e) => setPolicyInput(parseInt(e.target.value, 10) || 1)}
                    className="w-32 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 tabular-nums bg-white"
                  />
                  <span className="text-xs text-slate-600">months</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  The default medical benchmark in Bangladesh is 3 calendar months (e.g. donation on Jan 31 gives eligibility on Apr 30).
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPolicyInput(policy.minimumIntervalMonths)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setPolicyConfirmationOpen(true)}
                  className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors"
                >
                  Save Policy Changes
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              Only administrators with the explicit <code className="font-mono font-semibold">settings.availability_policy.manage</code> capability may modify this policy.
            </div>
          )}
        </div>
      )}

      {/* TAB 5: UNIFIED IMPORT & EXPORT (User Accounts & Blood Donors Joined) */}
      {activeTab === 'import_export' && (
        <div className="space-y-6">
          {/* Top Unified Data Center Header & Quick Sync Toolbar */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Unified Import &amp; Export Data Center
                    </h2>
                    <p className="text-xs text-slate-500">
                      User Accounts (Mail ID &amp; Password) and Blood Donors integrated into a single unified workflow.
                    </p>
                  </div>
                </div>
              </div>

              {/* Quick Sync & Count Strip */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSyncUsersToDonors}
                  disabled={syncingUsersToDonors}
                  className="px-3.5 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center gap-2 min-h-[38px] disabled:opacity-50"
                  title="Automatically pairs and links all standalone user accounts with active donor directory profiles"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingUsersToDonors ? 'animate-spin' : ''}`} />
                  <span>{syncingUsersToDonors ? 'Linking Accounts...' : 'Link & Sync All Users & Donors'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleRecalculateDonorsAvailability}
                  disabled={recalculatingAvailability}
                  className="px-3.5 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors flex items-center gap-2 min-h-[38px] disabled:opacity-50"
                  title="Recalculates eligibility dates and availability status for all donors using their last donation dates"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${recalculatingAvailability ? 'animate-spin' : ''}`} />
                  <span>{recalculatingAvailability ? 'Recalculating...' : 'Recalculate & Sync Availability'}</span>
                </button>
              </div>
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-100 text-xs">
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/60">
                <span className="text-slate-500 block text-[11px]">System Users</span>
                <span className="text-sm font-bold text-slate-900 tabular-nums">{usersList.length || metrics.totalUsers} accounts</span>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/60">
                <span className="text-slate-500 block text-[11px]">Blood Donors</span>
                <span className="text-sm font-bold text-slate-900 tabular-nums">{donorsList.length || metrics.totalDonors} profiles</span>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/60">
                <span className="text-slate-500 block text-[11px]">Search-Ready Donors</span>
                <span className="text-sm font-bold text-emerald-700 tabular-nums">{metrics.approvedDonors} active</span>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/60">
                <span className="text-slate-500 block text-[11px]">Architecture</span>
                <span className="text-sm font-bold text-rose-700">Unified Auth &amp; Clinical</span>
              </div>
            </div>
          </div>

          {/* Unified Sub-Tabs Navigation */}
          <div role="tablist" aria-label="Unified Data Modes" className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl overflow-x-auto no-scrollbar">
            <button
              type="button"
              role="tab"
              aria-selected={unifiedSubTab === 'import'}
              onClick={() => setUnifiedSubTab('import')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg transition-all min-h-[42px] whitespace-nowrap shrink-0 ${
                unifiedSubTab === 'import'
                  ? 'bg-white text-slate-900 shadow-xs font-bold ring-1 ring-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Upload className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              <span>Import Unified Data (CSV / XLSX)</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={unifiedSubTab === 'export'}
              onClick={() => setUnifiedSubTab('export')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg transition-all min-h-[42px] whitespace-nowrap shrink-0 ${
                unifiedSubTab === 'export'
                  ? 'bg-white text-slate-900 shadow-xs font-bold ring-1 ring-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Download className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              <span>Export Unified Database</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={unifiedSubTab === 'schema'}
              onClick={() => setUnifiedSubTab('schema')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg transition-all min-h-[42px] whitespace-nowrap shrink-0 ${
                unifiedSubTab === 'schema'
                  ? 'bg-white text-slate-900 shadow-xs font-bold ring-1 ring-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span>Template &amp; Field Guide</span>
            </button>
          </div>

          {/* SUB-TAB 1: UNIFIED IMPORT */}
          {unifiedSubTab === 'import' && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6 shadow-2xs">
              <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Upload className="w-4 h-4 text-rose-600" />
                    Unified Batch Import: User Credentials &amp; Blood Donors
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Upload a single spreadsheet. Every row provisions a Firebase Authentication user account (Mail ID &amp; Password) and creates a searchable Blood Donor profile.
                  </p>
                </div>

                {/* Sample Template Downloads */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => downloadUnifiedTemplate('csv')}
                    className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center gap-1.5"
                    title="Download Unified CSV Template"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Sample CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadUnifiedTemplate('xlsx')}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors flex items-center gap-1.5"
                    title="Download Unified Excel Template"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Sample XLSX
                  </button>
                </div>
              </div>

              {unifiedImportResult && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 leading-relaxed flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{unifiedImportResult}</span>
                </div>
              )}

              {/* Import Settings Options */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-start gap-2.5 p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-xl text-xs cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={autoApproveUnified}
                    onChange={(e) => setAutoApproveUnified(e.target.checked)}
                    className="mt-0.5 rounded text-rose-600 focus:ring-rose-500 w-4 h-4 shrink-0"
                  />
                  <div>
                    <span className="font-bold text-slate-900 block">Auto-Approve &amp; Verify for "Find Donors"</span>
                    <span className="text-[11px] text-slate-500 leading-relaxed block mt-0.5">
                      Directly sets approval and contact verification to active status so donors are immediately discoverable by patients.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-xl text-xs cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={createAuthAccounts}
                    onChange={(e) => setCreateAuthAccounts(e.target.checked)}
                    className="mt-0.5 rounded text-rose-600 focus:ring-rose-500 w-4 h-4 shrink-0"
                  />
                  <div>
                    <span className="font-bold text-slate-900 block">Create Firebase Auth Login Accounts</span>
                    <span className="text-[11px] text-slate-500 leading-relaxed block mt-0.5">
                      Provisions email and password authentication records so donors can log in immediately to manage their own profiles.
                    </span>
                  </div>
                </label>
              </div>

              {/* File Upload Zone */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Select Unified Spreadsheet (.csv, .xlsx, .xls)
                </label>
                <input
                  type="file"
                  accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                  onChange={handleUnifiedFileChange}
                  className="block w-full text-xs text-slate-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-rose-50 file:text-rose-700 hover:file:bg-rose-100 border border-slate-200 rounded-xl p-2 bg-slate-50/50"
                />
              </div>

              {/* Pre-Import Preview & Validation Screen */}
              {unifiedImportPreview && (
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-3 gap-3 text-center text-xs">
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                      <span className="block font-bold text-emerald-800 text-lg tabular-nums">
                        {unifiedImportPreview.valid.length}
                      </span>
                      <span className="text-[11px] font-semibold text-emerald-700">Valid Unified Accounts</span>
                    </div>
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                      <span className="block font-bold text-amber-800 text-lg tabular-nums">
                        {unifiedImportPreview.duplicates.length}
                      </span>
                      <span className="text-[11px] font-semibold text-amber-700">Duplicates Skipped</span>
                    </div>
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl">
                      <span className="block font-bold text-rose-800 text-lg tabular-nums">
                        {unifiedImportPreview.invalid.length}
                      </span>
                      <span className="text-[11px] font-semibold text-rose-700">Invalid Rows</span>
                    </div>
                  </div>

                  {/* Pre-Import Issues Table */}
                  {(unifiedImportPreview.invalid.length > 0 || unifiedImportPreview.duplicates.length > 0) && (
                    <div className="max-h-48 overflow-y-auto p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-[11px] space-y-1.5">
                      <p className="font-bold text-slate-800">Pre-Import Validation Warnings:</p>
                      {unifiedImportPreview.invalid.map((inv, idx) => (
                        <div key={idx} className="text-rose-600 flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span><strong>Row {inv.row}:</strong> {inv.reason}</span>
                        </div>
                      ))}
                      {unifiedImportPreview.duplicates.map((dup, idx) => (
                        <div key={idx} className="text-amber-700 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span><strong>Row {dup.row}:</strong> {dup.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Sample Valid Records Preview */}
                  {unifiedImportPreview.valid.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-xs font-bold text-slate-700 block">
                        Preview of Verified Records to be Created:
                      </span>
                      <div className="overflow-x-auto border border-slate-200 rounded-xl">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                            <tr>
                              <th className="px-3 py-2">Full Name</th>
                              <th className="px-3 py-2">User Mail ID</th>
                              <th className="px-3 py-2">Password</th>
                              <th className="px-3 py-2">Phone</th>
                              <th className="px-3 py-2">Blood Group</th>
                              <th className="px-3 py-2">Location</th>
                              <th className="px-3 py-2">Last Donation</th>
                              <th className="px-3 py-2">Availability</th>
                              <th className="px-3 py-2">Role</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {unifiedImportPreview.valid.slice(0, 5).map((row, idx) => (
                              <tr key={idx} className="hover:bg-slate-50/60">
                                <td className="px-3 py-2 font-medium text-slate-900">{row.fullName}</td>
                                <td className="px-3 py-2 text-slate-600">{row.email}</td>
                                <td className="px-3 py-2 text-slate-500 font-mono text-[11px]">
                                  {row.isPasswordAutoGenerated ? 'Donor@Pass2025 (auto)' : '••••••••'}
                                </td>
                                <td className="px-3 py-2 text-slate-600 tabular-nums">{row.phone}</td>
                                <td className="px-3 py-2">
                                  <span className="px-1.5 py-0.5 rounded-sm bg-rose-50 text-rose-700 font-bold border border-rose-200 text-[10px]">
                                    {row.bloodGroup}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-slate-600">{row.district}, {row.division}</td>
                                <td className="px-3 py-2 text-slate-700 font-medium">
                                  {row.lastDonationDate ? (
                                    <span className="inline-flex items-center gap-1 text-slate-800 text-[11px]">
                                      <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                                      {formatBangladeshDateOnly(row.lastDonationDate)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400 italic text-[11px]">None (First-time)</span>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-bold ${
                                    row.calculatedAvailability === 'available'
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                                  }`}>
                                    {row.calculatedAvailability === 'available' ? 'Available' : 'Resting'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-slate-600 font-mono text-[10px]">{row.roleIds.join(', ')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {unifiedImportPreview.valid.length > 5 && (
                        <p className="text-[11px] text-slate-400 italic">
                          Showing first 5 of {unifiedImportPreview.valid.length} valid records.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Confirmation and Import Execution Button */}
                  <button
                    type="button"
                    onClick={handleProcessUnifiedImport}
                    disabled={unifiedImporting || unifiedImportPreview.valid.length === 0}
                    className="w-full py-3 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition-colors disabled:opacity-50 min-h-[48px] flex items-center justify-center gap-2"
                  >
                    {unifiedImporting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>
                          Registering Unified Accounts {unifiedImportProgress ? `(${unifiedImportProgress.current} / ${unifiedImportProgress.total} - ${unifiedImportProgress.email})...` : '...'}
                        </span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Confirm &amp; Register {unifiedImportPreview.valid.length} Unified Accounts</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* SUB-TAB 2: UNIFIED EXPORT */}
          {unifiedSubTab === 'export' && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6 shadow-2xs">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Download className="w-4 h-4 text-rose-600" />
                  Unified Database Export (User Accounts &amp; Blood Donors)
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Export merged dataset containing Full Name, User Mail ID, Password template, Phone, Blood Group, District, Availability, Assigned Roles, and Clinical Status.
                </p>
              </div>

              {/* Export Filters Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Filter by Blood Group
                  </label>
                  <select
                    value={exportFilterGroup}
                    onChange={(e) => setExportFilterGroup(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">All Blood Groups</option>
                    {ALL_BLOOD_GROUPS.map((bg) => (
                      <option key={bg} value={bg}>{bg}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Filter by Division
                  </label>
                  <select
                    value={exportFilterDivision}
                    onChange={(e) => setExportFilterDivision(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">All Divisions</option>
                    {BANGLADESH_DIVISIONS.map((d) => (
                      <option key={d.name} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Filter by Role
                  </label>
                  <select
                    value={exportFilterRole}
                    onChange={(e) => setExportFilterRole(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">All Assigned Roles</option>
                    {DEFAULT_ROLES.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Filter by Approval Status
                  </label>
                  <select
                    value={exportFilterApproval}
                    onChange={(e) => setExportFilterApproval(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="all">All Approval States</option>
                    <option value="approved">Approved Only</option>
                    <option value="pending">Pending Review Only</option>
                    <option value="rejected">Rejected Only</option>
                  </select>
                </div>
              </div>

              {/* Export Specifications & Safeguards */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs text-slate-600">
                <div className="flex justify-between items-center">
                  <span>Combined Database Records:</span>
                  <strong className="text-slate-900">{Math.max(donorsList.length, usersList.length, metrics.totalDonors)} joined profiles</strong>
                </div>
                <div className="flex justify-between items-center">
                  <span>Included Account Columns:</span>
                  <span className="font-semibold text-rose-700">Full Name, User Mail ID, Password, Phone, Blood Group, Role, Location</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Security &amp; Re-import:</span>
                  <span className="text-emerald-700 font-medium">Spreadsheet formula sanitized · Ready for 1-click re-import</span>
                </div>
              </div>

              {/* Action Buttons for CSV, XLSX, and JSON */}
              <div className="pt-2 flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => handleExportUnified('csv')}
                  disabled={unifiedExporting}
                  className="flex-1 py-2.5 px-4 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-xl transition-colors flex items-center justify-center gap-2 min-h-[44px]"
                >
                  <FileText className="w-4 h-4 text-slate-600" />
                  <span>{unifiedExporting ? 'Exporting...' : 'Export Unified CSV'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExportUnified('xlsx')}
                  disabled={unifiedExporting}
                  className="flex-1 py-2.5 px-4 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors flex items-center justify-center gap-2 min-h-[44px] shadow-2xs"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>{unifiedExporting ? 'Exporting...' : 'Export Unified XLSX (Excel)'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExportUnified('json')}
                  disabled={unifiedExporting}
                  className="flex-1 py-2.5 px-4 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition-colors flex items-center justify-center gap-2 min-h-[44px]"
                >
                  <Download className="w-4 h-4 text-slate-600" />
                  <span>{unifiedExporting ? 'Exporting...' : 'Export Full JSON Backup'}</span>
                </button>
              </div>
            </div>
          )}

          {/* SUB-TAB 3: SCHEMA & FIELD SPECIFICATIONS GUIDE */}
          {unifiedSubTab === 'schema' && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6 shadow-2xs">
              <div className="border-b border-slate-100 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-rose-600" />
                    Unified Spreadsheet Column Specifications
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Headers and data requirements for importing or batch synchronizing User Accounts and Blood Donors.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => downloadUnifiedTemplate('csv')}
                    className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download CSV Template
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadUnifiedTemplate('xlsx')}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download XLSX Template
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
                    <tr>
                      <th className="px-3.5 py-2.5">Column Header</th>
                      <th className="px-3.5 py-2.5">Category</th>
                      <th className="px-3.5 py-2.5">Requirement</th>
                      <th className="px-3.5 py-2.5">Accepted Values &amp; Fallback</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-600">
                    <tr className="hover:bg-slate-50/50">
                      <td className="px-3.5 py-2 font-mono font-bold text-rose-700">User Mail ID</td>
                      <td className="px-3.5 py-2">User Account</td>
                      <td className="px-3.5 py-2 font-semibold text-rose-600">Required</td>
                      <td className="px-3.5 py-2">Valid email format (e.g., donor@example.com). Used for login.</td>
                    </tr>
                    <tr className="hover:bg-slate-50/50">
                      <td className="px-3.5 py-2 font-mono font-bold text-rose-700">Password</td>
                      <td className="px-3.5 py-2">User Account</td>
                      <td className="px-3.5 py-2 text-slate-500">Optional</td>
                      <td className="px-3.5 py-2">Min 6 characters. If omitted, default initial password <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-[11px]">Donor@Pass2025</code> is set.</td>
                    </tr>
                    <tr className="hover:bg-slate-50/50">
                      <td className="px-3.5 py-2 font-mono font-bold text-rose-700">Phone</td>
                      <td className="px-3.5 py-2">Clinical &amp; Contact</td>
                      <td className="px-3.5 py-2 font-semibold text-rose-600">Required</td>
                      <td className="px-3.5 py-2">11-digit Bangladesh mobile number (<code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-[11px]">01XXXXXXXXX</code>). Protected by privacy shield.</td>
                    </tr>
                    <tr className="hover:bg-slate-50/50">
                      <td className="px-3.5 py-2 font-mono font-bold text-slate-900">Full Name</td>
                      <td className="px-3.5 py-2">General Profile</td>
                      <td className="px-3.5 py-2 text-slate-500">Optional</td>
                      <td className="px-3.5 py-2">Donor's display name. If blank, defaults to email username.</td>
                    </tr>
                    <tr className="hover:bg-slate-50/50">
                      <td className="px-3.5 py-2 font-mono font-bold text-slate-900">Blood Group</td>
                      <td className="px-3.5 py-2">Clinical</td>
                      <td className="px-3.5 py-2 text-slate-500">Optional</td>
                      <td className="px-3.5 py-2">A+, A-, B+, B-, AB+, AB-, O+, O-. Defaults to O+ if unspecified.</td>
                    </tr>
                    <tr className="hover:bg-slate-50/50">
                      <td className="px-3.5 py-2 font-mono font-bold text-slate-900">Division</td>
                      <td className="px-3.5 py-2">Location</td>
                      <td className="px-3.5 py-2 text-slate-500">Optional</td>
                      <td className="px-3.5 py-2">e.g., Dhaka, Chattogram, Rajshahi, Sylhet. Defaults to Dhaka.</td>
                    </tr>
                    <tr className="hover:bg-slate-50/50">
                      <td className="px-3.5 py-2 font-mono font-bold text-slate-900">District</td>
                      <td className="px-3.5 py-2">Location</td>
                      <td className="px-3.5 py-2 text-slate-500">Optional</td>
                      <td className="px-3.5 py-2">e.g., Dhaka, Gazipur, Cumilla. Defaults to Dhaka.</td>
                    </tr>
                    <tr className="hover:bg-slate-50/50">
                      <td className="px-3.5 py-2 font-mono font-bold text-slate-900">Role</td>
                      <td className="px-3.5 py-2">User Account</td>
                      <td className="px-3.5 py-2 text-slate-500">Optional</td>
                      <td className="px-3.5 py-2">e.g., general_user, donor_manager, data_entry_operator. Defaults to general_user.</td>
                    </tr>
                    <tr className="hover:bg-slate-50/50">
                      <td className="px-3.5 py-2 font-mono font-bold text-slate-900">Status</td>
                      <td className="px-3.5 py-2">Account State</td>
                      <td className="px-3.5 py-2 text-slate-500">Optional</td>
                      <td className="px-3.5 py-2">active, suspended, or deactivated. Defaults to active.</td>
                    </tr>
                    <tr className="hover:bg-slate-50/50">
                      <td className="px-3.5 py-2 font-mono font-bold text-slate-900">Last Donation Date</td>
                      <td className="px-3.5 py-2">Clinical</td>
                      <td className="px-3.5 py-2 text-slate-500">Optional</td>
                      <td className="px-3.5 py-2">YYYY-MM-DD. Used to compute resting period and availability date.</td>
                    </tr>
                    <tr className="hover:bg-slate-50/50">
                      <td className="px-3.5 py-2 font-mono font-bold text-slate-900">Contact Visibility</td>
                      <td className="px-3.5 py-2">Privacy</td>
                      <td className="px-3.5 py-2 text-slate-500">Optional</td>
                      <td className="px-3.5 py-2">public, registered_only, or hidden. Defaults to public.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 6: AUDIT TRAIL (Section 7 & 12) */}
      {activeTab === 'audit' && hasPermission('audit_logs.view') && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="font-bold text-slate-900 text-sm">Immutable Audit Logs</span>

              <button
                onClick={() => loadAuditLogs()}
                className="self-end sm:self-auto px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1.5 min-h-[38px]"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh Log</span>
              </button>
            </div>

            {/* Responsive Entity Filter Sub-Tabs */}
            <div
              role="tablist"
              aria-label="Filter Audit Logs by Entity"
              className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth p-1 bg-slate-100 rounded-xl -mx-2 px-2 sm:mx-0 sm:px-1"
            >
              {[
                { id: '', label: 'All Entities' },
                { id: 'donor', label: 'Donors' },
                { id: 'policy', label: 'Policy Changes' },
                { id: 'user', label: 'User Roles' },
                { id: 'import', label: 'Imports' },
                { id: 'settings', label: 'Settings' },
              ].map((ent) => {
                const isSelected = auditActionFilter === ent.id;
                return (
                  <button
                    key={ent.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setAuditActionFilter(ent.id)}
                    className={`px-3 py-2 text-xs font-semibold rounded-lg shrink-0 transition-all min-h-[40px] focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                      isSelected
                        ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200/80 font-bold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    {ent.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-800 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Timestamp (Dhaka)</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-3">Entity</th>
                  <th className="py-3 px-3">Outcome</th>
                  <th className="py-3 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLoading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      Loading audit events...
                    </td>
                  </tr>
                ) : auditLogsList.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No audit logs found.
                    </td>
                  </tr>
                ) : (
                  auditLogsList.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 tabular-nums whitespace-nowrap text-slate-700">
                        {formatBangladeshDateTime(log.timestamp)}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900 font-mono text-[11px]">
                        {log.action}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {log.actorEmail || log.actorUid}
                      </td>
                      <td className="py-3 px-3 uppercase text-[10px] font-semibold text-slate-500">
                        {log.entityType}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                            log.outcome === 'success' ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {log.outcome === 'success' ? 'Success' : 'Failure'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[11px] text-slate-500 max-w-xs truncate">
                        {log.reason ? `Reason: ${log.reason}` : log.newValues ? JSON.stringify(log.newValues) : '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 7: WEBSITE SETTINGS (Section 11) */}
      {activeTab === 'settings' && hasPermission('settings.view') && (
        <div className="max-w-2xl mx-auto bg-white rounded-xl border border-slate-200 p-8 space-y-6 shadow-2xs">
          <div className="border-b border-slate-200 pb-4">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Sliders className="w-5 h-5 text-rose-600" />
              Website Identity & Public Notice Settings
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Configure public support emails, helpline instructions, and platform notices.
            </p>
          </div>

          {settingsNotice && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 rounded-lg">
              {settingsNotice}
            </div>
          )}

          <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Platform Name</label>
              <input
                type="text"
                value={siteConfig.siteName}
                onChange={(e) => setSiteConfig({ ...siteConfig, siteName: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Public Support Email</label>
                <input
                  type="email"
                  value={siteConfig.contactEmail}
                  onChange={(e) => setSiteConfig({ ...siteConfig, contactEmail: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Support Phone Helpline</label>
                <input
                  type="text"
                  value={siteConfig.contactPhone}
                  onChange={(e) => setSiteConfig({ ...siteConfig, contactPhone: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Emergency Medical Helpline Notice
              </label>
              <textarea
                rows={3}
                value={siteConfig.emergencyHelplineNotice}
                onChange={(e) => setSiteConfig({ ...siteConfig, emergencyHelplineNotice: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
              />
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                disabled={settingsSaving}
                className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors disabled:opacity-50"
              >
                {settingsSaving ? 'Saving...' : 'Save Site Settings'}
              </button>
            </div>
          </form>

          {/* Firebase Database Management & Data Deletion Integrity */}
          {(isSuperAdmin || isAdmin) && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 space-y-5 shadow-2xs">
              <div className="border-b border-slate-200 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center font-bold">
                      <ShieldAlert className="w-5 h-5 text-rose-600" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-slate-900">
                        Firebase Database Management & Zero-Orphan Integrity
                      </h2>
                      <p className="text-xs text-slate-500">
                        Authoritative Cloud Firestore &bull; Real-time synchronization &bull; 4-way atomic deletion
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-sm bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                    Firestore Live
                  </span>
                </div>
              </div>

              {/* 4-way collection status */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <span className="text-slate-500 text-[11px] block">donors</span>
                  <span className="text-lg font-bold text-slate-900 tabular-nums">{metrics.totalDonors}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Voluntary profiles</span>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <span className="text-slate-500 text-[11px] block">users</span>
                  <span className="text-lg font-bold text-slate-900 tabular-nums">{metrics.totalUsers}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Auth profiles</span>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <span className="text-slate-500 text-[11px] block">registeredPhones</span>
                  <span className="text-lg font-bold text-slate-900 tabular-nums">{metrics.verifiedContacts}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Unique phone lookup</span>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <span className="text-slate-500 text-[11px] block">Audit Integrity</span>
                  <span className="text-lg font-bold text-emerald-600">Enforced</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Immutable logs</span>
                </div>
              </div>

              {/* Integrity Explainer */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-xs text-slate-700 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Info className="w-4 h-4 text-slate-600" />
                  <span>Authoritative Firebase Deletion Guarantee</span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  When any donor record or user account is deleted from this console, atomic Firestore transactions immediately delete the donor document (<code className="text-rose-700 font-mono">donors/{'{id}'}</code>), release the phone lookup index (<code className="text-rose-700 font-mono">registeredPhones/{'{phone}'}</code>), clear the email identifier index (<code className="text-rose-700 font-mono">registeredIdentifiers/{'{email}'}</code>), and optionally cascade to user accounts. No orphaned phone locks or stale documents remain in Firebase.
                </p>
              </div>

              {/* Danger Zone: Purge Non-Admin Test Data */}
              <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-rose-900 text-xs flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>Danger Zone: Purge Non-Admin Test Data</span>
                    </h3>
                    <p className="text-[11px] text-rose-700 mt-1 leading-relaxed">
                      Permanently wipes all non-admin donors, test users, registered phones, and email identifiers directly from Firebase Firestore.
                      The primary Super Administrator (<span className="font-bold font-mono">abrar.noceng@gmail.com</span>) and system policy are strictly preserved.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPurgeConfirmationPhrase('');
                      setPurgeDialogOpen(true);
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-lg shadow-2xs transition-colors shrink-0 flex items-center gap-1.5 min-h-[38px]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Purge Test Data</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* DIALOG: Reject Reason */}
      {rejectDialogDonor && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900">
              Reject Donor Application: {rejectDialogDonor.fullName}
            </h3>
            <p className="text-xs text-slate-500">
              Provide an official rejection reason for the audit trail (e.g. invalid phone number, unreachable, or underage).
            </p>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter rejection reason..."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRejectDialogDonor(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReject}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG: Update Donation Date */}
      {editDateDonor && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900">
              Update Donation Date: {editDateDonor.fullName}
            </h3>
            <p className="text-xs text-slate-500">
              Updating the recorded donation date will automatically recalculate this donor's eligibility using the {policy.minimumIntervalMonths}-month policy.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Last Blood Donation Date
              </label>
              <input
                type="date"
                value={newDonationDate}
                onChange={(e) => setNewDonationDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditDateDonor(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDonationDate}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
              >
                Save & Recalculate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG: Policy Change Confirmation */}
      {policyConfirmationOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <div className="flex items-center gap-2 text-rose-700 font-bold text-base">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
              <span>Confirm Availability Policy Change</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              You are about to change the nationwide donor waiting interval from{' '}
              <span className="font-bold text-slate-900">{policy.minimumIntervalMonths} months</span> to{' '}
              <span className="font-bold text-rose-700">{policyInput} months</span>.
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              This will create an immutable audit record with your administrator ID and immediately govern future public search calculations.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setPolicyConfirmationOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePolicy}
                disabled={policySaving}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs"
              >
                {policySaving ? 'Saving...' : 'Confirm Policy Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG: Role Assignment */}
      {roleChangeUser && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <h3 className="text-base font-bold text-slate-900">
              Assign Roles: {roleChangeUser.displayName || roleChangeUser.email}
            </h3>
            <p className="text-xs text-slate-500">
              Select all administrative roles that should apply to this account:
            </p>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {DEFAULT_ROLES.map((r) => {
                const checked = selectedRoles.includes(r.id);
                return (
                  <label
                    key={r.id}
                    className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedRoles([...selectedRoles, r.id]);
                        } else {
                          setSelectedRoles(selectedRoles.filter((id) => id !== r.id));
                        }
                      }}
                      className="mt-0.5 rounded-sm border-slate-300 text-rose-600 focus:ring-rose-500"
                    />
                    <div>
                      <span className="font-bold text-slate-900">{r.name}</span>
                      <p className="text-[11px] text-slate-500">{r.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setRoleChangeUser(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveUserRoles}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs"
              >
                Save Role Assignments
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG: Donor Full Detail Modal */}
      {selectedDonorDetail && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4 border border-slate-200 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-700 font-bold flex items-center justify-center">
                  {selectedDonorDetail.bloodGroup}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">{selectedDonorDetail.fullName}</h3>
                  <p className="text-slate-500 text-[11px]">{selectedDonorDetail.email}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedDonorDetail(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 rounded-lg">
                <div>
                  <span className="text-slate-500 block">Phone:</span>
                  <span className="font-semibold text-slate-900">{formatBangladeshPhone(selectedDonorDetail.phone)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Location:</span>
                  <span className="font-semibold text-slate-900">
                    {selectedDonorDetail.upazila}, {selectedDonorDetail.district} ({selectedDonorDetail.division})
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Approval Status:</span>
                  <StatusBadge status={selectedDonorDetail.approvalStatus} type="approval" />
                </div>
                <div>
                  <span className="text-slate-500 block">Verification Status:</span>
                  <StatusBadge status={selectedDonorDetail.contactVerificationStatus} type="verification" />
                </div>
                <div>
                  <span className="text-slate-500 block">Last Donation:</span>
                  <span className="font-semibold text-slate-900">
                    {formatBangladeshDateOnly(selectedDonorDetail.lastDonationDate)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Next Calculated Eligibility:</span>
                  <span className="font-semibold text-slate-900">
                    {formatBangladeshDateOnly(selectedDonorDetail.eligibilityDate)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-slate-100">
              {hasPermission('donors.approve') && (
                <button
                  type="button"
                  onClick={() => {
                    const d = selectedDonorDetail;
                    setSelectedDonorDetail(null);
                    handleOpenStatusDialog(d);
                  }}
                  className="px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Approve Verification & Status</span>
                </button>
              )}
              <button
                onClick={() => setSelectedDonorDetail(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG: Suspend / Reactivate Confirmation Modal (Replaces window.confirm) */}
      {suspendDialogDonor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                suspendDialogDonor.targetStatus === 'suspended' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
              }`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  Confirm {suspendDialogDonor.targetStatus === 'suspended' ? 'Account Suspension' : 'Account Reactivation'}
                </h3>
                <p className="text-slate-500 text-xs">Donor: {suspendDialogDonor.donor.fullName}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {suspendDialogDonor.targetStatus === 'suspended'
                ? 'Suspending this donor will instantly hide their profile from all public donor searches and prevent contact visibility until reactivated.'
                : 'Reactivating this donor will restore their account standing. If verified and approved, availability will be evaluated based on the current policy interval.'}
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSuspendDialogDonor(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSuspend}
                className={`px-3.5 py-2 text-xs font-semibold text-white rounded-lg transition-colors ${
                  suspendDialogDonor.targetStatus === 'suspended'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                Confirm {suspendDialogDonor.targetStatus === 'suspended' ? 'Suspension' : 'Reactivation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG: Permanently Delete Donor Confirmation Modal */}
      {deleteDonorTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200 animate-in fade-in zoom-in duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Permanently Delete Donor Record</h3>
                  <p className="text-slate-500 text-xs">Donor: {deleteDonorTarget.fullName}</p>
                </div>
              </div>
              <button
                onClick={() => setDeleteDonorTarget(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-rose-50 rounded-xl p-3 border border-rose-100 text-xs text-rose-800 space-y-1.5">
              <p className="font-bold">Atomic Database Cleanup:</p>
              <ul className="list-disc pl-4 space-y-1 text-rose-700 text-[11px]">
                <li>Removes donor document: <span className="font-mono">{deleteDonorTarget.id}</span></li>
                <li>Frees phone lookup index: <span className="font-mono">{deleteDonorTarget.phone}</span></li>
                <li>Appends immutable audit record with previous state</li>
              </ul>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">Reason for Deletion:</label>
              <input
                type="text"
                value={deleteDonorReason}
                onChange={(e) => setDeleteDonorReason(e.target.value)}
                placeholder="e.g. Duplicate profile, donor requested removal, invalid contact"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteDonorTarget(null)}
                disabled={deleteDonorLoading}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteDonor}
                disabled={deleteDonorLoading}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deleteDonorLoading ? 'Deleting...' : 'Confirm Deletion'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG: Permanently Delete User Confirmation Modal */}
      {deleteUserTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200 animate-in fade-in zoom-in duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Delete User Account</h3>
                  <p className="text-slate-500 text-xs">User: {deleteUserTarget.email}</p>
                </div>
              </div>
              <button
                onClick={() => setDeleteUserTarget(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              This will permanently remove the administrative/viewer profile for <span className="font-semibold text-slate-900">{deleteUserTarget.email}</span> from Firestore.
            </p>

            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={deleteUserCascade}
                onChange={(e) => setDeleteUserCascade(e.target.checked)}
                className="mt-0.5 rounded-sm border-slate-300 text-rose-600 focus:ring-rose-500"
              />
              <div>
                <span className="font-bold text-slate-900">Cascade delete linked donor profile</span>
                <p className="text-[11px] text-slate-500">
                  Also removes any linked blood donor record and frees their phone index.
                </p>
              </div>
            </label>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">Reason for Removal:</label>
              <input
                type="text"
                value={deleteUserReason}
                onChange={(e) => setDeleteUserReason(e.target.value)}
                placeholder="e.g. Account deactivated, employee departed, spam account"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteUserTarget(null)}
                disabled={deleteUserLoading}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteUser}
                disabled={deleteUserLoading}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deleteUserLoading ? 'Deleting...' : 'Delete User Account'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG: Approve Verification & Calculated Status */}
      {statusDialogDonor && dialogCalcPreview && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6 space-y-5 border border-slate-200 animate-in fade-in zoom-in duration-150">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Approve Verification & Calculated Status
                  </h3>
                  <p className="text-xs text-slate-500">
                    Donor: <span className="font-semibold text-slate-800">{statusDialogDonor.fullName}</span> ({statusDialogDonor.bloodGroup}) &bull; {statusDialogDonor.phone}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setStatusDialogDonor(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick 1-Click Approve Everything Button */}
            <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-blue-50 border border-emerald-200/80 rounded-xl p-3.5 flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-emerald-900 font-bold text-xs">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                  <span>1-Click Full Eligibility Approval</span>
                </div>
                <p className="text-[11px] text-emerald-700 leading-tight">
                  Approves registration, marks contact verified, and ensures donor evaluates as <strong>Available</strong>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDialogApprovalStatus('approved');
                  setDialogVerificationStatus('verified');
                  setDialogDeclaredAvailability('available');
                  const d = new Date();
                  d.setMonth(d.getMonth() - (policy.minimumIntervalMonths || 3) - 1);
                  setDialogLastDonationDate(d.toISOString().split('T')[0]);
                }}
                className="px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-2xs shrink-0 transition-colors"
              >
                Approve All
              </button>
            </div>

            {/* SECTION 1: Application Approval Status */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                1. Application Approval Status
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'approved', label: 'Approved', desc: 'Permits public listing' },
                  { id: 'pending', label: 'Pending', desc: 'Awaiting review' },
                  { id: 'rejected', label: 'Rejected', desc: 'Declined' }
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDialogApprovalStatus(item.id as ApprovalStatus)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      dialogApprovalStatus === item.id
                        ? item.id === 'approved'
                          ? 'border-emerald-600 bg-emerald-50/60 ring-2 ring-emerald-500/20'
                          : item.id === 'pending'
                          ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20'
                          : 'border-rose-600 bg-rose-50/60 ring-2 ring-rose-500/20'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-slate-900">{item.label}</span>
                      {dialogApprovalStatus === item.id && (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 block mt-0.5">{item.desc}</span>
                  </button>
                ))}
              </div>

              {dialogApprovalStatus === 'rejected' && (
                <div className="pt-2">
                  <label className="block text-xs font-semibold text-rose-700 mb-1">
                    Rejection Reason (Required for audit trail):
                  </label>
                  <textarea
                    value={dialogRejectionReason}
                    onChange={(e) => setDialogRejectionReason(e.target.value)}
                    placeholder="e.g. Ineligible age, incorrect medical history, unreachable phone"
                    rows={2}
                    className="w-full px-3 py-2 text-xs border border-rose-300 rounded-lg focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              )}
            </div>

            {/* SECTION 2: Contact Verification Status */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                2. Contact Verification Status
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'verified', label: 'Verified', desc: 'Contact validated' },
                  { id: 'pending', label: 'Pending', desc: 'In progress' },
                  { id: 'unverified', label: 'Unverified', desc: 'Not yet confirmed' }
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDialogVerificationStatus(item.id as ContactVerificationStatus)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      dialogVerificationStatus === item.id
                        ? item.id === 'verified'
                          ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20'
                          : item.id === 'pending'
                          ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20'
                          : 'border-slate-400 bg-slate-100 ring-2 ring-slate-400/20'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-slate-900">{item.label}</span>
                      {dialogVerificationStatus === item.id && (
                        <Check className="w-3.5 h-3.5 text-blue-600" />
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 block mt-0.5">{item.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* SECTION 3: Calculated Status & Eligibility Policy */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  3. Calculated Availability Status
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Engine Output:</span>
                  <StatusBadge status={dialogCalcPreview.calculatedAvailability} type="availability" size="sm" />
                </div>
              </div>

              {/* Status explanation box */}
              <div className={`p-3 rounded-xl border text-xs leading-relaxed space-y-1 ${
                dialogCalcPreview.isAvailable
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50/70 border-amber-200 text-amber-800'
              }`}>
                <div className="font-bold flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" />
                  <span>Calculation Engine Diagnosis:</span>
                </div>
                <p className="text-[11px]">{dialogCalcPreview.reason}</p>
                {dialogCalcPreview.eligibilityDate && (
                  <p className="text-[11px] font-semibold">
                    Eligibility Date: {formatBangladeshDateOnly(dialogCalcPreview.eligibilityDate)}
                  </p>
                )}
              </div>

              {/* Last Donation Date & Waiting Interval */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">
                    Last Donation Date (Policy Interval: {policy.minimumIntervalMonths} months):
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setMonth(d.getMonth() - (policy.minimumIntervalMonths || 3) - 1);
                      setDialogLastDonationDate(d.toISOString().split('T')[0]);
                    }}
                    className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 underline"
                  >
                    Set Eligible Date (4 months ago)
                  </button>
                </div>
                <input
                  type="date"
                  value={dialogLastDonationDate}
                  onChange={(e) => setDialogLastDonationDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
                />
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setStatusDialogDonor(null)}
                disabled={dialogStatusSaving}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveStatusDialog}
                disabled={dialogStatusSaving}
                className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>{dialogStatusSaving ? 'Saving...' : 'Save & Apply Statuses'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG: Batch Delete Donors Confirmation Modal */}
      {batchDeleteDonorsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200 animate-in fade-in zoom-in duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Batch Delete Donors from Firebase</h3>
                  <p className="text-slate-500 text-xs">{selectedDonorIds.length} donor record{selectedDonorIds.length > 1 ? 's' : ''} selected</p>
                </div>
              </div>
              <button
                onClick={() => setBatchDeleteDonorsOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-rose-50 rounded-xl p-3 border border-rose-100 text-xs text-rose-800 space-y-1.5">
              <p className="font-bold">Permanent Cloud Deletion:</p>
              <ul className="list-disc pl-4 space-y-1 text-rose-700 text-[11px]">
                <li>Deletes <span className="font-bold">{selectedDonorIds.length}</span> donor documents from <span className="font-mono">donors</span> collection.</li>
                <li>Frees all associated phone numbers from <span className="font-mono">registeredPhones</span> lookup index.</li>
                <li>Frees all email identifiers from <span className="font-mono">registeredIdentifiers</span> index.</li>
                <li>Super Admin (<span className="font-mono font-bold">abrar.noceng@gmail.com</span>) is strictly protected.</li>
              </ul>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">Reason for Bulk Deletion:</label>
              <input
                type="text"
                value={batchDeleteDonorsReason}
                onChange={(e) => setBatchDeleteDonorsReason(e.target.value)}
                placeholder="e.g. Batch cleanup of inactive / expired test records"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setBatchDeleteDonorsOpen(false)}
                disabled={batchDeleteDonorsLoading}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBatchDeleteDonors}
                disabled={batchDeleteDonorsLoading}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{batchDeleteDonorsLoading ? 'Deleting in Firebase...' : `Delete ${selectedDonorIds.length} Donors`}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG: Batch Delete Users Confirmation Modal */}
      {batchDeleteUsersOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-200 animate-in fade-in zoom-in duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Batch Delete Users from Firebase</h3>
                  <p className="text-slate-500 text-xs">{selectedUserIds.length} user account{selectedUserIds.length > 1 ? 's' : ''} selected</p>
                </div>
              </div>
              <button
                onClick={() => setBatchDeleteUsersOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              This will permanently delete <span className="font-semibold text-slate-900">{selectedUserIds.length}</span> user profiles and their authentication identifier entries from Firebase Firestore.
            </p>

            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={batchDeleteUsersCascade}
                onChange={(e) => setBatchDeleteUsersCascade(e.target.checked)}
                className="mt-0.5 rounded-sm border-slate-300 text-rose-600 focus:ring-rose-500"
              />
              <div>
                <span className="font-bold text-slate-900">Cascade delete linked donor profiles</span>
                <p className="text-[11px] text-slate-500">
                  Also removes any linked blood donor records and frees their phone lookup index.
                </p>
              </div>
            </label>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">Reason for Removal:</label>
              <input
                type="text"
                value={batchDeleteUsersReason}
                onChange={(e) => setBatchDeleteUsersReason(e.target.value)}
                placeholder="e.g. Administrative user cleanup, test accounts purge"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setBatchDeleteUsersOpen(false)}
                disabled={batchDeleteUsersLoading}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBatchDeleteUsers}
                disabled={batchDeleteUsersLoading}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{batchDeleteUsersLoading ? 'Deleting...' : `Delete ${selectedUserIds.length} Users`}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG: Purge All Non-Admin Test Data */}
      {purgeDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-rose-300 animate-in fade-in zoom-in duration-150">
            <div className="flex items-start justify-between border-b border-rose-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-rose-600" />
                </div>
                <div>
                  <h3 className="font-bold text-rose-950 text-base">Purge Non-Admin Test Data</h3>
                  <p className="text-rose-700 text-xs">Authoritative Firebase Firestore Reset</p>
                </div>
              </div>
              <button
                onClick={() => setPurgeDialogOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-rose-50 rounded-xl p-4 border border-rose-200 text-xs text-rose-900 space-y-2">
              <p className="font-bold text-sm text-rose-950">Warning: This action is permanent and cannot be undone.</p>
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-rose-800">
                <li>All non-admin donor profiles in <span className="font-mono font-bold">donors</span> will be deleted.</li>
                <li>All non-admin user profiles in <span className="font-mono font-bold">users</span> will be deleted.</li>
                <li>All temporary lookup mappings in <span className="font-mono font-bold">registeredPhones</span> and <span className="font-mono font-bold">registeredIdentifiers</span> will be purged.</li>
                <li>The Super Administrator account (<span className="font-mono font-bold text-emerald-800">abrar.noceng@gmail.com</span>) and availability policy will remain untouched.</li>
              </ul>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-800">
                To confirm, type <span className="font-mono font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">DELETE ALL DATA</span> below:
              </label>
              <input
                type="text"
                value={purgeConfirmationPhrase}
                onChange={(e) => setPurgeConfirmationPhrase(e.target.value)}
                placeholder="DELETE ALL DATA"
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setPurgeDialogOpen(false)}
                disabled={purgeLoading}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPurgeAllData}
                disabled={purgeConfirmationPhrase.trim() !== 'DELETE ALL DATA' || purgeLoading}
                className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg shadow-2xs transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{purgeLoading ? 'Purging Firebase...' : 'Permanently Purge Data'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Donor Registration Modal */}
      {manualDonorModalOpen && (
        <ManualDonorModal
          isOpen={manualDonorModalOpen}
          onClose={() => setManualDonorModalOpen(false)}
          onSuccess={(newDonor) => {
            setDonorsList((prev) => [newDonor, ...prev.filter((d) => d.id !== newDonor.id)]);
            setMetrics((prev) => ({
              ...prev,
              totalDonors: prev.totalDonors + 1,
              approvedDonors: newDonor.approvalStatus === 'approved' ? prev.approvedDonors + 1 : prev.approvedDonors,
              availableDonors: newDonor.calculatedAvailability === 'available' ? prev.availableDonors + 1 : prev.availableDonors,
            }));
            setActionBanner({
              message: `Donor "${newDonor.fullName}" (${newDonor.bloodGroup}) was manually registered into Firebase! Approval status is [${newDonor.approvalStatus}], availability is [${newDonor.calculatedAvailability}].`,
              type: 'success',
            });
          }}
        />
      )}
    </div>
  );
};

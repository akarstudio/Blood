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
  addCalendarMonths
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
  syncAllUsersToDonors 
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

  // Import / Export state
  const [importExportDataset, setImportExportDataset] = useState<'donors' | 'users'>('users');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{
    valid: any[];
    invalid: { row: number; reason: string; data: any }[];
    duplicates: { row: number; reason: string; data: any }[];
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [autoApproveImport, setAutoApproveImport] = useState<boolean>(true);
  const [exportFilterGroup, setExportFilterGroup] = useState<string>('');
  const [exportFilterDivision, setExportFilterDivision] = useState<string>('');
  const [exporting, setExporting] = useState(false);
  const [importExportSubTab, setImportExportSubTab] = useState<'import' | 'export'>('import');

  // User Accounts Import / Export state (Mail ID & Password)
  const [userImportFile, setUserImportFile] = useState<File | null>(null);
  const [userImportPreview, setUserImportPreview] = useState<{
    valid: {
      row: number;
      fullName: string;
      email: string;
      password: string;
      roleIds: string[];
      phone?: string;
      accountStatus: AccountStatus;
      bloodGroup?: BloodGroup;
      division?: string;
      district?: string;
      upazila?: string;
      gender?: 'male' | 'female' | 'other' | 'unspecified';
      dateOfBirth?: string;
      lastDonationDate?: string;
      approvalStatus?: ApprovalStatus;
      verificationStatus?: ContactVerificationStatus;
      preferredContactMethod?: PreferredContactMethod;
      contactVisibility?: ContactVisibilityPreference;
      additionalNotes?: string;
    }[];
    invalid: { row: number; reason: string; data: any }[];
    duplicates: { row: number; reason: string; data: any }[];
  } | null>(null);
  const [userImporting, setUserImporting] = useState(false);
  const [userImportProgress, setUserImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [userImportResult, setUserImportResult] = useState<string | null>(null);
  const [userExporting, setUserExporting] = useState(false);
  const [syncingUsersToDonors, setSyncingUsersToDonors] = useState<boolean>(false);

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

  // ACTION: CSV / XLSX File Parsing & Validation (Section 9) - Supporting ALL Database Fields
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFile(file);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false }) as any[];

        // Pre-fetch existing emails and phones for duplicate detection
        const donorsSnap = await getDocs(query(collection(db, 'donors'), limit(1000)));
        const existingEmails = new Set<string>();
        const existingPhones = new Set<string>();
        donorsSnap.forEach(d => {
          const docData = d.data();
          if (docData.normalizedEmail) existingEmails.add(docData.normalizedEmail);
          if (docData.normalizedPhone) existingPhones.add(docData.normalizedPhone);
        });

        const valid: any[] = [];
        const invalid: { row: number; reason: string; data: any }[] = [];
        const duplicates: { row: number; reason: string; data: any }[] = [];

        rows.forEach((row, idx) => {
          const rowNum = idx + 2; // 1-indexed, header is row 1
          const fullName = row['Full Name'] || row['Name'] || row['fullName'] || row['Donor Name'];
          const rawEmail = row['Email'] || row['email'] || row['User Mail ID'] || row['Mail ID'];
          const rawPhone = row['Phone'] || row['phone'] || row['Mobile'] || row['Mobile Number'] || row['Phone Number'];
          const rawBg = (row['Blood Group'] || row['bloodGroup'] || row['Blood'] || row['Group'] || '').toString().trim().toUpperCase();
          const division = row['Division'] || row['division'] || 'Dhaka';
          const district = row['District'] || row['district'] || 'Dhaka';
          const upazila = row['Upazila'] || row['upazila'] || row['Area'] || district || 'Sadar';
          const donationDate = row['Last Donation Date'] || row['lastDonationDate'] || '';
          const eligibilityDate = row['Next Eligibility Date'] || row['Eligibility Date'] || row['eligibilityDate'] || '';
          const rawGender = (row['Gender'] || row['gender'] || '').toString().toLowerCase().trim();
          const gender: 'male' | 'female' | 'other' | 'unspecified' = 
            ['male', 'female', 'other'].includes(rawGender) ? (rawGender as any) : 'unspecified';
          const dateOfBirth = row['Date of Birth'] || row['DOB'] || row['dateOfBirth'] || '';
          const declaredAvailability = (row['Declared Availability'] || row['Availability'] || row['declaredAvailability'] || 'available').toString().toLowerCase().trim() === 'unavailable' ? 'unavailable' : 'available';
          const rawApproval = (row['Approval Status'] || row['approvalStatus'] || '').toString().toLowerCase().trim();
          const approvalStatus: ApprovalStatus = 
            rawApproval === 'pending' ? 'pending' : rawApproval === 'rejected' ? 'rejected' : 'approved';
          const rawVerification = (row['Verification Status'] || row['contactVerificationStatus'] || '').toString().toLowerCase().trim();
          const contactVerificationStatus: ContactVerificationStatus = 
            rawVerification === 'unverified' ? 'unverified' : rawVerification === 'pending' ? 'pending' : 'verified';
          const rawAccountStatus = (row['Account Status'] || row['accountStatus'] || row['Status'] || '').toString().toLowerCase().trim();
          const accountStatus: AccountStatus = 
            rawAccountStatus === 'suspended' ? 'suspended' : rawAccountStatus === 'deactivated' ? 'deactivated' : 'active';
          const contactVisibility = (row['Contact Visibility'] || row['contactVisibilityPreference'] || 'public').toString().toLowerCase().trim() as ContactVisibilityPreference;
          const preferredContactMethod = (row['Preferred Contact Method'] || row['preferredContactMethod'] || 'phone').toString().toLowerCase().trim() as PreferredContactMethod;
          const publicContactConsent = String(row['Public Contact Consent'] ?? 'Yes').toLowerCase() !== 'no' && String(row['Public Contact Consent'] ?? 'true') !== 'false';
          const publicProfileConsent = String(row['Public Profile Consent'] ?? 'Yes').toLowerCase() !== 'no' && String(row['Public Profile Consent'] ?? 'true') !== 'false';
          const additionalNotes = row['Additional Notes'] || row['Notes'] || row['Comment'] || '';

          // 1. Validation
          if (!fullName || String(fullName).trim().length < 2) {
            invalid.push({ row: rowNum, reason: 'Missing or invalid full name', data: row });
            return;
          }

          const normEmail = normalizeEmail(rawEmail);
          if (!isValidEmail(normEmail)) {
            invalid.push({ row: rowNum, reason: `Invalid email address "${rawEmail}"`, data: row });
            return;
          }

          const normPhone = normalizeBangladeshPhone(String(rawPhone));
          if (!normPhone) {
            invalid.push({ row: rowNum, reason: `Invalid Bangladesh phone "${rawPhone}"`, data: row });
            return;
          }

          if (!isValidBloodGroup(rawBg)) {
            invalid.push({ row: rowNum, reason: `Invalid blood group "${rawBg}"`, data: row });
            return;
          }

          // 2. Duplicate Detection
          if (existingEmails.has(normEmail)) {
            duplicates.push({ row: rowNum, reason: `Duplicate email: ${normEmail} already registered`, data: row });
            return;
          }

          if (existingPhones.has(normPhone)) {
            duplicates.push({ row: rowNum, reason: `Duplicate phone: ${normPhone} already registered`, data: row });
            return;
          }

          // Optional password in donor spreadsheet
          const rawPassword = row['Password'] || row['password'] || row['Pass'];
          const donorPassword = rawPassword && String(rawPassword).trim().length >= 6 ? String(rawPassword).trim() : undefined;

          // Remember for subsequent rows in this batch
          existingEmails.add(normEmail);
          existingPhones.add(normPhone);

          valid.push({
            fullName: String(fullName).trim(),
            normalizedName: String(fullName).trim().toLowerCase(),
            email: normEmail,
            normalizedEmail: normEmail,
            phone: normPhone,
            normalizedPhone: normPhone,
            bloodGroup: rawBg as BloodGroup,
            division: String(division).trim(),
            district: String(district).trim(),
            upazila: String(upazila).trim(),
            gender,
            dateOfBirth: String(dateOfBirth).trim(),
            lastDonationDate: donationDate && /^\d{4}-\d{2}-\d{2}$/.test(donationDate) ? donationDate : '',
            eligibilityDate: eligibilityDate && /^\d{4}-\d{2}-\d{2}$/.test(eligibilityDate) ? eligibilityDate : '',
            declaredAvailability,
            approvalStatus,
            contactVerificationStatus,
            accountStatus,
            contactVisibilityPreference: ['public', 'registered_only', 'hidden'].includes(contactVisibility) ? contactVisibility : 'public',
            preferredContactMethod: ['phone', 'whatsapp', 'sms', 'email'].includes(preferredContactMethod) ? preferredContactMethod : 'phone',
            publicContactConsent,
            publicProfileConsent,
            additionalNotes: String(additionalNotes).trim(),
            password: donorPassword,
          });
        });

        setImportPreview({ valid, invalid, duplicates });
      } catch (err: any) {
        setActionBanner({ message: `Failed to parse file: ${err.message}`, type: 'error' });
      }
    };
    reader.readAsBinaryString(file);
  };

  // ACTION: Process Confirmed Import Batch with Full Field Support & Find Donor Sync
  const handleProcessImport = async () => {
    if (!importPreview || importPreview.valid.length === 0) return;
    setImporting(true);

    try {
      const nowIso = new Date().toISOString();

      for (const row of importPreview.valid) {
        // Auto-sync every imported donor with Firebase Authentication email and password
        const donorPassword = row.password || 'Donor@Pass2025';
        let linkedUid: string | undefined = undefined;
        try {
          linkedUid = await createAuthUserWithoutSwitching(row.email, donorPassword);
          await setDoc(doc(db, 'users', linkedUid), {
            uid: linkedUid,
            email: row.email,
            displayName: row.fullName,
            roleIds: ['general_user'],
            phone: row.phone,
            normalizedPhone: row.normalizedPhone,
            accountStatus: row.accountStatus || 'active',
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          await syncRegisteredIdentifier(db, row.email, linkedUid);
        } catch (authErr) {
          console.warn(`Auth account sync for donor ${row.email}:`, authErr);
        }

        const donorDocId = linkedUid || doc(collection(db, 'donors')).id;
        const donorRef = doc(db, 'donors', donorDocId);

        // Effective approval and verification statuses
        const effectiveApproval: ApprovalStatus = autoApproveImport 
          ? (row.approvalStatus || 'approved') 
          : (row.approvalStatus || 'pending');
        const effectiveVerification: ContactVerificationStatus = autoApproveImport 
          ? (row.contactVerificationStatus || 'verified') 
          : (row.contactVerificationStatus || 'unverified');

        // Recalculate eligibility with current policy
        const calc = calculateDonorAvailability(
          {
            approvalStatus: effectiveApproval,
            contactVerificationStatus: effectiveVerification,
            accountStatus: row.accountStatus || 'active',
            declaredAvailability: row.declaredAvailability || 'available',
            lastDonationDate: row.lastDonationDate || undefined,
          },
          policy.minimumIntervalMonths
        );

        const donorDocData = cleanForFirestore({
          id: donorDocId,
          uid: linkedUid || donorDocId,
          fullName: row.fullName,
          normalizedName: row.normalizedName,
          email: row.email,
          normalizedEmail: row.normalizedEmail,
          phone: row.phone,
          normalizedPhone: row.normalizedPhone,
          bloodGroup: row.bloodGroup,
          division: row.division,
          district: row.district,
          upazila: row.upazila,
          gender: row.gender || 'unspecified',
          dateOfBirth: row.dateOfBirth || '',
          lastDonationDate: row.lastDonationDate || '',
          eligibilityDate: row.eligibilityDate || calc.eligibilityDate || '',
          declaredAvailability: row.declaredAvailability || 'available',
          calculatedAvailability: calc.calculatedAvailability,
          contactVerificationStatus: effectiveVerification,
          approvalStatus: effectiveApproval,
          accountStatus: row.accountStatus || 'active',
          publicContactConsent: row.publicContactConsent ?? true,
          publicProfileConsent: row.publicProfileConsent ?? true,
          contactVisibilityPreference: row.contactVisibilityPreference || 'public',
          preferredContactMethod: row.preferredContactMethod || 'phone',
          additionalNotes: row.additionalNotes || '',
          privacyConsentVersion: '1.0',
          privacyConsentAt: nowIso,
          approvedBy: effectiveApproval === 'approved' ? (user?.uid || 'admin') : undefined,
          approvedAt: effectiveApproval === 'approved' ? nowIso : undefined,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        await setDoc(donorRef, donorDocData, { merge: true });

        // Index phone for lookup
        if (row.normalizedPhone) {
          try {
            await setDoc(doc(db, 'registeredPhones', row.normalizedPhone), {
              uid: linkedUid || donorDocId,
              phone: row.normalizedPhone,
              email: row.email,
              createdAt: nowIso,
              updatedAt: nowIso,
            }, { merge: true });
          } catch (phoneErr) {
            console.warn('Phone indexing error:', phoneErr);
          }
        }
      }

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: 'donor.batch_import',
          entityType: 'import',
          entityId: 'importJobs',
          newValues: {
            filename: importFile?.name,
            totalRows: importPreview.valid.length + importPreview.invalid.length + importPreview.duplicates.length,
            successCount: importPreview.valid.length,
            failureCount: importPreview.invalid.length,
            duplicateCount: importPreview.duplicates.length,
            autoApproved: autoApproveImport,
          },
          outcome: 'success',
        });
      }

      const statusDesc = autoApproveImport 
        ? 'All records were auto-approved & verified and are now live in Find Donors!' 
        : 'All records entered the pending review queue.';
      setImportResult(`Successfully imported ${importPreview.valid.length} donors. ${statusDesc}`);
      setActionBanner({
        message: `Import complete: ${importPreview.valid.length} donors processed. ${statusDesc}`,
        type: 'success',
      });
      setImportPreview(null);
      setImportFile(null);
      await loadDonors();
      await loadMetrics();
    } catch (err: any) {
      setActionBanner({ message: `Import failed: ${err.message}`, type: 'error' });
    } finally {
      setImporting(false);
    }
  };

  // ACTION: Export Filtered Donors with ALL Database Fields (Section 10)
  const handleExportDonors = async (format: 'csv' | 'xlsx') => {
    if (!hasPermission('donors.export')) {
      setActionBanner({ message: 'You do not have permission to export donor data.', type: 'error' });
      return;
    }

    setExporting(true);
    try {
      const constraints: any[] = [];
      if (exportFilterGroup) {
        constraints.push(where('bloodGroup', '==', exportFilterGroup));
      }
      if (exportFilterDivision) {
        constraints.push(where('division', '==', exportFilterDivision));
      }

      const q = query(collection(db, 'donors'), ...constraints, limit(2000));
      const snaps = await getDocs(q);

      const rows: any[] = [];
      snaps.forEach((d) => {
        const data = d.data() as Donor;
        // Formula injection protection and full database field mapping
        rows.push({
          'UID': sanitizeForSpreadsheet(data.uid || data.id || d.id),
          'Full Name': sanitizeForSpreadsheet(data.fullName),
          'Email': sanitizeForSpreadsheet(data.email),
          'Phone': sanitizeForSpreadsheet(formatBangladeshPhone(data.phone)),
          'Blood Group': sanitizeForSpreadsheet(data.bloodGroup),
          'Division': sanitizeForSpreadsheet(data.division),
          'District': sanitizeForSpreadsheet(data.district),
          'Upazila': sanitizeForSpreadsheet(data.upazila),
          'Gender': sanitizeForSpreadsheet(data.gender || 'unspecified'),
          'Date of Birth': sanitizeForSpreadsheet(data.dateOfBirth || ''),
          'Last Donation Date': sanitizeForSpreadsheet(data.lastDonationDate || ''),
          'Next Eligibility Date': sanitizeForSpreadsheet(data.eligibilityDate || ''),
          'Declared Availability': sanitizeForSpreadsheet(data.declaredAvailability || 'available'),
          'Calculated Availability': sanitizeForSpreadsheet(data.calculatedAvailability || 'available'),
          'Approval Status': sanitizeForSpreadsheet(data.approvalStatus || 'approved'),
          'Verification Status': sanitizeForSpreadsheet(data.contactVerificationStatus || 'verified'),
          'Account Status': sanitizeForSpreadsheet(data.accountStatus || 'active'),
          'Contact Visibility': sanitizeForSpreadsheet(data.contactVisibilityPreference || 'public'),
          'Preferred Contact Method': sanitizeForSpreadsheet(data.preferredContactMethod || 'phone'),
          'Public Contact Consent': data.publicContactConsent ? 'Yes' : 'No',
          'Public Profile Consent': data.publicProfileConsent ? 'Yes' : 'No',
          'Additional Notes': sanitizeForSpreadsheet(data.additionalNotes || ''),
          'Created At': sanitizeForSpreadsheet(data.createdAt || ''),
          'Updated At': sanitizeForSpreadsheet(data.updatedAt || ''),
        });
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Donors');

      const fileName = `blood_donors_full_database_${new Date().toISOString().split('T')[0]}.${format}`;
      XLSX.writeFile(workbook, fileName);

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: `donor.export_${format}`,
          entityType: 'donor',
          entityId: 'export',
          newValues: {
            format,
            recordCount: rows.length,
            filters: { group: exportFilterGroup, division: exportFilterDivision },
          },
          outcome: 'success',
        });
      }

      setActionBanner({
        message: `Successfully exported ${rows.length} donor records with all 24 database fields in ${format.toUpperCase()} format.`,
        type: 'success',
      });
    } catch (err: any) {
      setActionBanner({ message: `Export failed: ${err.message}`, type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  // ACTION: Download Sample Template for User Accounts with Donor Fields Included
  const downloadSampleUserTemplate = (format: 'csv' | 'xlsx') => {
    const sampleRows = [
      {
        'Full Name': 'Rahim Ahmed',
        'User Mail ID': 'rahim.ahmed@example.com',
        'Password': 'UserPass@2025',
        'Role': 'donor_manager',
        'Phone': '01711223344',
        'Blood Group': 'O+',
        'Division': 'Dhaka',
        'District': 'Dhaka',
        'Upazila': 'Dhanmondi',
        'Gender': 'male',
        'Date of Birth': '1992-04-10',
        'Last Donation Date': '2024-08-15',
        'Status': 'active',
        'Approval Status': 'approved',
        'Verification Status': 'verified',
        'Contact Visibility': 'public',
        'Preferred Contact Method': 'phone',
      },
      {
        'Full Name': 'Fatima Begum',
        'User Mail ID': 'fatima.begum@example.com',
        'Password': 'FatimaSecure!123',
        'Role': 'general_user',
        'Phone': '01811223344',
        'Blood Group': 'A+',
        'Division': 'Chattogram',
        'District': 'Chattogram',
        'Upazila': 'Panchlaish',
        'Gender': 'female',
        'Date of Birth': '1996-08-22',
        'Last Donation Date': '2024-06-10',
        'Status': 'active',
        'Approval Status': 'approved',
        'Verification Status': 'verified',
        'Contact Visibility': 'public',
        'Preferred Contact Method': 'whatsapp',
      },
      {
        'Full Name': 'Kabir Hossain',
        'User Mail ID': 'kabir@demo.com',
        'Password': 'UserPass@2025',
        'Role': 'general_user',
        'Phone': '01911223344',
        'Blood Group': 'B+',
        'Division': 'Rajshahi',
        'District': 'Rajshahi',
        'Upazila': 'Boalia',
        'Gender': 'male',
        'Date of Birth': '1994-11-05',
        'Last Donation Date': '2024-07-20',
        'Status': 'active',
        'Approval Status': 'approved',
        'Verification Status': 'verified',
        'Contact Visibility': 'public',
        'Preferred Contact Method': 'phone',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'User_Credentials');
    XLSX.writeFile(workbook, `sample_user_credentials_template.${format}`);
  };

  // ACTION: Download Sample Template for Donors with ALL Database Fields
  const downloadSampleDonorTemplate = (format: 'csv' | 'xlsx') => {
    const sampleRows = [
      {
        'Full Name': 'Kamal Hossain',
        'Email': 'kamal.donor@example.com',
        'Password': 'KamalSecure@2025',
        'Phone': '01712345678',
        'Blood Group': 'O+',
        'Division': 'Dhaka',
        'District': 'Dhaka',
        'Upazila': 'Dhanmondi',
        'Gender': 'male',
        'Date of Birth': '1995-05-12',
        'Last Donation Date': '2024-08-15',
        'Next Eligibility Date': '2024-11-15',
        'Declared Availability': 'available',
        'Approval Status': 'approved',
        'Verification Status': 'verified',
        'Account Status': 'active',
        'Contact Visibility': 'public',
        'Preferred Contact Method': 'phone',
        'Public Contact Consent': 'Yes',
        'Public Profile Consent': 'Yes',
        'Additional Notes': 'Regular voluntary donor',
      },
      {
        'Full Name': 'Nasrin Akter',
        'Email': 'nasrin.donor@example.com',
        'Password': 'NasrinSecure#123',
        'Phone': '01812345678',
        'Blood Group': 'B+',
        'Division': 'Chattogram',
        'District': 'Chattogram',
        'Upazila': 'Panchlaish',
        'Gender': 'female',
        'Date of Birth': '1998-10-20',
        'Last Donation Date': '2024-05-10',
        'Next Eligibility Date': '2024-08-10',
        'Declared Availability': 'available',
        'Approval Status': 'approved',
        'Verification Status': 'verified',
        'Account Status': 'active',
        'Contact Visibility': 'public',
        'Preferred Contact Method': 'whatsapp',
        'Public Contact Consent': 'Yes',
        'Public Profile Consent': 'Yes',
        'Additional Notes': 'Available for emergency requests',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Donor_Template');
    XLSX.writeFile(workbook, `sample_donors_all_fields_template.${format}`);
  };

  // ACTION: Parse & Validate User Accounts Import File (Mail ID, Password, and Donor Fields)
  const handleUserFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUserImportFile(file);
    setUserImportResult(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false }) as any[];

        if (!rows || rows.length === 0) {
          setActionBanner({ message: 'The uploaded file contains no data rows.', type: 'error' });
          return;
        }

        // Fetch existing users for duplicate detection
        const usersSnap = await getDocs(collection(db, 'users'));
        const existingEmails = new Set<string>();
        usersSnap.forEach((u) => {
          const docData = u.data();
          if (docData.email) existingEmails.add(normalizeEmail(docData.email));
        });

        const valid: any[] = [];
        const invalid: { row: number; reason: string; data: any }[] = [];
        const duplicates: { row: number; reason: string; data: any }[] = [];

        rows.forEach((row, idx) => {
          const rowNum = idx + 2;
          const rawEmail = row['User Mail ID'] || row['User Email'] || row['Mail ID'] || row['Email'] || row['email'] || row['mail'];
          const rawPassword = row['Password'] || row['password'] || row['Pass'] || row['pass'] || row['Initial Password'] || row['Temp Password'];
          const rawName = row['Full Name'] || row['Name'] || row['Display Name'] || row['fullName'] || row['displayName'];
          const rawRole = row['Role'] || row['Roles'] || row['role'] || row['roles'] || row['Assigned Roles'];
          const rawPhone = row['Phone'] || row['Mobile'] || row['phone'] || row['mobile'] || row['Phone Number'];
          const rawStatus = row['Status'] || row['Account Status'] || row['status'] || row['accountStatus'];

          // Donor fields support in User Accounts import:
          const rawBg = row['Blood Group'] || row['Blood'] || row['bloodGroup'] || row['Group'];
          const parsedBg: BloodGroup | undefined = rawBg && isValidBloodGroup(String(rawBg).trim().toUpperCase()) 
            ? (String(rawBg).trim().toUpperCase() as BloodGroup) 
            : undefined;
          const division = row['Division'] || row['division'];
          const district = row['District'] || row['district'];
          const upazila = row['Upazila'] || row['upazila'] || row['Area'];
          const rawGender = (row['Gender'] || row['gender'] || '').toString().toLowerCase().trim();
          const gender: 'male' | 'female' | 'other' | 'unspecified' = 
            ['male', 'female', 'other'].includes(rawGender) ? (rawGender as any) : 'unspecified';
          const dateOfBirth = row['Date of Birth'] || row['DOB'] || row['dateOfBirth'];
          const lastDonationDate = row['Last Donation Date'] || row['lastDonationDate'];
          const rawApproval = (row['Approval Status'] || row['approvalStatus'] || 'approved').toString().toLowerCase().trim();
          const approvalStatus: ApprovalStatus = rawApproval === 'pending' ? 'pending' : rawApproval === 'rejected' ? 'rejected' : 'approved';
          const rawVerification = (row['Verification Status'] || row['contactVerificationStatus'] || 'verified').toString().toLowerCase().trim();
          const verificationStatus: ContactVerificationStatus = rawVerification === 'unverified' ? 'unverified' : 'verified';
          const contactVisibility = (row['Contact Visibility'] || row['contactVisibilityPreference'] || 'public').toString().toLowerCase().trim() as ContactVisibilityPreference;
          const preferredContactMethod = (row['Preferred Contact Method'] || row['preferredContactMethod'] || 'phone').toString().toLowerCase().trim() as PreferredContactMethod;
          const additionalNotes = row['Additional Notes'] || row['Notes'] || '';

          // 1. Validate Email
          if (!rawEmail || !String(rawEmail).trim()) {
            invalid.push({ row: rowNum, reason: 'User Mail ID (email) is missing', data: row });
            return;
          }

          const normEmail = normalizeEmail(String(rawEmail));
          if (!isValidEmail(normEmail)) {
            invalid.push({ row: rowNum, reason: `Invalid email address "${rawEmail}"`, data: row });
            return;
          }

          // 2. Validate Password (Firebase Auth requires >= 6 chars)
          const passStr = rawPassword !== undefined && rawPassword !== null ? String(rawPassword).trim() : '';
          if (!passStr || passStr.length < 6) {
            invalid.push({ row: rowNum, reason: `Password must be at least 6 characters (received ${passStr.length} chars)`, data: row });
            return;
          }

          // 3. Duplicate detection
          if (existingEmails.has(normEmail)) {
            duplicates.push({ row: rowNum, reason: `User Mail ID "${normEmail}" is already registered`, data: row });
            return;
          }

          // Track in batch to avoid duplicate emails in the same spreadsheet
          existingEmails.add(normEmail);

          // 4. Role parsing
          let parsedRoles: string[] = ['general_user'];
          if (rawRole) {
            const roleTokens = String(rawRole)
              .split(/[,;|]/)
              .map(r => r.trim().toLowerCase().replace(/\s+/g, '_'))
              .filter(Boolean);
            const validTokens = roleTokens.filter(tok => 
              DEFAULT_ROLES.some(dr => dr.id === tok || dr.name.toLowerCase() === tok)
            );
            if (validTokens.length > 0) {
              parsedRoles = validTokens;
            }
          }

          // 5. Phone normalization
          let cleanPhone: string | undefined = undefined;
          if (rawPhone) {
            const normPhone = normalizeBangladeshPhone(String(rawPhone));
            if (normPhone) {
              cleanPhone = normPhone;
            }
          }

          // 6. Name resolution
          const displayName = rawName && String(rawName).trim().length >= 2 
            ? String(rawName).trim() 
            : normEmail.split('@')[0];

          // 7. Status resolution
          const statusLower = String(rawStatus || '').toLowerCase().trim();
          const accountStatus: AccountStatus = 
            statusLower === 'suspended' ? 'suspended' : statusLower === 'deactivated' ? 'deactivated' : 'active';

          valid.push({
            row: rowNum,
            fullName: displayName,
            email: normEmail,
            password: passStr,
            roleIds: parsedRoles,
            phone: cleanPhone,
            accountStatus,
            bloodGroup: parsedBg,
            division: division ? String(division).trim() : undefined,
            district: district ? String(district).trim() : undefined,
            upazila: upazila ? String(upazila).trim() : undefined,
            gender,
            dateOfBirth: dateOfBirth ? String(dateOfBirth).trim() : undefined,
            lastDonationDate: lastDonationDate ? String(lastDonationDate).trim() : undefined,
            approvalStatus,
            verificationStatus,
            contactVisibility: ['public', 'registered_only', 'hidden'].includes(contactVisibility) ? contactVisibility : 'public',
            preferredContactMethod: ['phone', 'whatsapp', 'sms', 'email'].includes(preferredContactMethod) ? preferredContactMethod : 'phone',
            additionalNotes: additionalNotes ? String(additionalNotes).trim() : undefined,
          });
        });

        setUserImportPreview({ valid, invalid, duplicates });
      } catch (err: any) {
        setActionBanner({ message: `Failed to parse user file: ${err.message}`, type: 'error' });
      }
    };
    reader.readAsBinaryString(file);
  };

  // ACTION: Process User Accounts Import Batch & Automatically Add to Find Donors Section
  const handleProcessUserImport = async () => {
    if (!userImportPreview || userImportPreview.valid.length === 0) return;
    setUserImporting(true);
    setUserImportProgress({ current: 0, total: userImportPreview.valid.length });

    let successCount = 0;
    const failures: { email: string; reason: string }[] = [];
    const nowIso = new Date().toISOString();

    try {
      for (let i = 0; i < userImportPreview.valid.length; i++) {
        const item = userImportPreview.valid[i];
        setUserImportProgress({ current: i + 1, total: userImportPreview.valid.length });

        try {
          // 1. Creates Firebase Auth user account without disrupting current admin login
          const authUid = await createAuthUserWithoutSwitching(item.email, item.password);

          // 2. Write Firestore users profile
          const rawNormPhone = item.phone ? normalizeBangladeshPhone(item.phone) : '';
          const userDocData = cleanForFirestore({
            uid: authUid,
            email: item.email,
            displayName: item.fullName,
            roleIds: item.roleIds,
            accountStatus: item.accountStatus,
            phone: item.phone || '',
            normalizedPhone: rawNormPhone || '',
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          await setDoc(doc(db, 'users', authUid), userDocData);

          // 3. Sync identifier for real-time Firebase Auth identifier matching
          await syncRegisteredIdentifier(db, item.email, authUid);

          // 4. CRITICAL: Automatically add into Find Donors section as an active, approved donor!
          await syncUserToDonor(db, {
            uid: authUid,
            email: item.email,
            displayName: item.fullName,
            phone: item.phone,
            bloodGroup: item.bloodGroup || 'O+',
            division: item.division || 'Dhaka',
            district: item.district || 'Dhaka',
            upazila: item.upazila || 'Sadar',
            gender: item.gender || 'unspecified',
            dateOfBirth: item.dateOfBirth,
            lastDonationDate: item.lastDonationDate,
            approvalStatus: item.approvalStatus || 'approved',
            contactVerificationStatus: item.verificationStatus || 'verified',
            accountStatus: item.accountStatus || 'active',
            contactVisibilityPreference: item.contactVisibility || 'public',
            preferredContactMethod: item.preferredContactMethod || 'phone',
            additionalNotes: item.additionalNotes,
          }, { uid: user?.uid || 'admin', email: user?.email || undefined });

          successCount++;
        } catch (itemErr: any) {
          console.error(`Failed to import user ${item.email}:`, itemErr);
          failures.push({ email: item.email, reason: itemErr.message || 'Authentication error' });
        }
      }

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: 'user.batch_import',
          entityType: 'user',
          entityId: 'batch_import',
          newValues: {
            filename: userImportFile?.name,
            totalRows: userImportPreview.valid.length,
            successCount,
            failureCount: failures.length,
            addedToFindDonors: true,
          },
          outcome: failures.length === 0 ? 'success' : 'failure',
        });
      }

      if (failures.length === 0) {
        setUserImportResult(`Successfully registered all ${successCount} user accounts in Firebase Authentication and added them into the Find Donors section!`);
        setActionBanner({
          message: `Batch import complete: ${successCount} user accounts created and added to Find Donors!`,
          type: 'success',
        });
      } else {
        setUserImportResult(`Imported ${successCount} user accounts into Users and Find Donors. ${failures.length} failed: ${failures.map(f => `${f.email} (${f.reason})`).join(', ')}`);
        setActionBanner({
          message: `Import partially completed: ${successCount} registered into Users & Find Donors, ${failures.length} failed.`,
          type: 'info',
        });
      }

      setUserImportPreview(null);
      setUserImportFile(null);
      await loadUsers();
      await loadMetrics();
    } catch (err: any) {
      setActionBanner({ message: `User import failed: ${err.message}`, type: 'error' });
    } finally {
      setUserImporting(false);
      setUserImportProgress(null);
    }
  };

  // ACTION: Export User Accounts with Mail ID & Password Column
  const handleExportUsers = async (format: 'csv' | 'xlsx') => {
    if (!hasPermission('users.view') && !isAdmin && !isSuperAdmin) {
      setActionBanner({ message: 'You do not have permission to view or export user credentials.', type: 'error' });
      return;
    }

    setUserExporting(true);
    try {
      let users = usersList;
      if (users.length === 0) {
        const snap = await getDocs(collection(db, 'users'));
        const fetched: UserProfile[] = [];
        snap.forEach(d => fetched.push({ uid: d.id, ...d.data() } as UserProfile));
        users = fetched;
      }

      const rows = users.map((usr) => ({
        'Full Name': sanitizeForSpreadsheet(usr.displayName || 'User'),
        'User Mail ID': sanitizeForSpreadsheet(usr.email),
        'Password': 'TempPass@2025 (Set new password or reset on login)',
        'Assigned Roles': sanitizeForSpreadsheet(usr.roleIds.join(', ')),
        'Account Status': sanitizeForSpreadsheet(usr.accountStatus),
        'Phone': sanitizeForSpreadsheet(usr.phone ? formatBangladeshPhone(usr.phone) : ''),
        'Created At': sanitizeForSpreadsheet(usr.createdAt ? formatBangladeshDateTime(usr.createdAt) : ''),
        'Last Login At': sanitizeForSpreadsheet(usr.lastLoginAt ? formatBangladeshDateTime(usr.lastLoginAt) : 'Never'),
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'User_Accounts');

      const fileName = `user_accounts_mail_password_${new Date().toISOString().split('T')[0]}.${format}`;
      XLSX.writeFile(workbook, fileName);

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: `user.export_${format}`,
          entityType: 'user',
          entityId: 'export',
          newValues: {
            format,
            recordCount: rows.length,
          },
          outcome: 'success',
        });
      }

      setActionBanner({
        message: `Successfully exported ${rows.length} user account records with Mail ID & Password in ${format.toUpperCase()} format.`,
        type: 'success',
      });
    } catch (err: any) {
      setActionBanner({ message: `User export failed: ${err.message}`, type: 'error' });
    } finally {
      setUserExporting(false);
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
              {(hasPermission('donors.import') || hasPermission('donors.export')) && (
                <option value="import_export">📁 Import &amp; Export</option>
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

            {(hasPermission('donors.import') || hasPermission('donors.export')) && (
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
                <span>Import &amp; Export</span>
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
                    <th className="py-3 px-3">Calculated Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {donorsLoading ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400">
                        Loading donor records from Firestore...
                      </td>
                    </tr>
                  ) : paginatedDonors.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500">
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
                  setImportExportDataset('users');
                  setImportExportSubTab('import');
                  setActiveTab('import_export');
                }}
                className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg flex items-center gap-1.5 transition-colors min-h-[38px]"
                title="Batch Import User Mail IDs and Passwords"
              >
                <Upload className="w-3.5 h-3.5" />
                Import Users
              </button>
              <button
                onClick={() => handleExportUsers('csv')}
                disabled={userExporting}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1.5 transition-colors min-h-[38px]"
                title="Export Users to CSV"
              >
                <FileText className="w-3.5 h-3.5" />
                Export CSV
              </button>
              <button
                onClick={() => handleExportUsers('xlsx')}
                disabled={userExporting}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1.5 transition-colors min-h-[38px]"
                title="Export Users to Excel (XLSX)"
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

      {/* TAB 5: IMPORT & EXPORT (User Credentials & Donors) */}
      {activeTab === 'import_export' && (
        <div className="space-y-6">
          {/* Top Dataset Type Selector */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-rose-600" />
                  Import & Export Data Center
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Select dataset to export or bulk import with spreadsheet safeguards.
                </p>
              </div>

              {/* Dataset switcher pill buttons */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setImportExportDataset('users');
                    setImportExportSubTab('import');
                  }}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 min-h-[38px] ${
                    importExportDataset === 'users'
                      ? 'bg-white text-rose-700 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>User Accounts (Mail ID & Password)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImportExportDataset('donors');
                    setImportExportSubTab('import');
                  }}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 min-h-[38px] ${
                    importExportDataset === 'donors'
                      ? 'bg-white text-rose-700 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Blood Donors</span>
                </button>
              </div>
            </div>
          </div>

          {/* Responsive Segmented Sub-Tabs for Import vs Export (Mobile/Tablet) */}
          <div role="tablist" aria-label="Import & Export Modes" className="lg:hidden grid grid-cols-2 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              role="tab"
              aria-selected={importExportSubTab === 'import'}
              onClick={() => setImportExportSubTab('import')}
              className={`py-2.5 px-3 text-xs font-semibold rounded-lg transition-all min-h-[44px] flex items-center justify-center gap-2 focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                importExportSubTab === 'import'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold ring-1 ring-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Upload className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              <span>Import {importExportDataset === 'users' ? 'Users' : 'Donors'}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={importExportSubTab === 'export'}
              onClick={() => setImportExportSubTab('export')}
              className={`py-2.5 px-3 text-xs font-semibold rounded-lg transition-all min-h-[44px] flex items-center justify-center gap-2 focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                importExportSubTab === 'export'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold ring-1 ring-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Download className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              <span>Export {importExportDataset === 'users' ? 'Users' : 'Donors'}</span>
            </button>
          </div>

          {/* DATASET 1: USER ACCOUNTS (Mail ID & Password) */}
          {importExportDataset === 'users' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* User Accounts Import Card */}
              <div className={`${importExportSubTab !== 'import' ? 'hidden lg:block' : ''} bg-white rounded-xl border border-slate-200 p-6 space-y-6 shadow-2xs`}>
                <div className="border-b border-slate-100 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Key className="w-4 h-4 text-rose-600" />
                      User Accounts Import (Mail ID & Password)
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      Batch create user accounts with Mail ID & Password in Firebase Authentication and Firestore.
                    </p>
                  </div>
                  {/* Sample template download buttons */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => downloadSampleUserTemplate('csv')}
                      className="px-2.5 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition-colors flex items-center gap-1"
                      title="Download Sample User CSV Template"
                    >
                      <Download className="w-3 h-3" />
                      Sample CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadSampleUserTemplate('xlsx')}
                      className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors flex items-center gap-1"
                      title="Download Sample User XLSX Template"
                    >
                      <Download className="w-3 h-3" />
                      Sample XLSX
                    </button>
                  </div>
                </div>

                {userImportResult && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 leading-relaxed">
                    {userImportResult}
                  </div>
                )}

                <div className="space-y-3">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-600 space-y-1">
                    <p className="font-semibold text-slate-800">Supported Spreadsheet Columns:</p>
                    <ul className="list-disc list-inside text-[11px] space-y-0.5 text-slate-600">
                      <li><strong className="text-slate-800">User Mail ID</strong> (or Email): Valid email address</li>
                      <li><strong className="text-slate-800">Password</strong>: Minimum 6 characters for Firebase Auth</li>
                      <li><strong className="text-slate-800">Full Name</strong> (or Display Name): Optional user name</li>
                      <li><strong className="text-slate-800">Role</strong>: e.g. donor_manager, viewer, general_user</li>
                      <li><strong className="text-slate-800">Status</strong>: active, suspended, or deactivated</li>
                      <li><strong className="text-slate-800">Phone</strong>: Optional Bangladesh mobile number</li>
                    </ul>
                  </div>

                  <input
                    type="file"
                    accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                    onChange={handleUserFileChange}
                    className="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-rose-50 file:text-rose-700 hover:file:bg-rose-100"
                  />

                  {userImportPreview && (
                    <div className="space-y-4 pt-2">
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                          <span className="block font-bold text-emerald-800 text-sm tabular-nums">
                            {userImportPreview.valid.length}
                          </span>
                          <span className="text-[11px] text-emerald-600">Valid Users</span>
                        </div>
                        <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                          <span className="block font-bold text-amber-800 text-sm tabular-nums">
                            {userImportPreview.duplicates.length}
                          </span>
                          <span className="text-[11px] text-amber-600">Duplicates</span>
                        </div>
                        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                          <span className="block font-bold text-rose-800 text-sm tabular-nums">
                            {userImportPreview.invalid.length}
                          </span>
                          <span className="text-[11px] text-rose-600">Invalid Rows</span>
                        </div>
                      </div>

                      {/* Validation errors and duplicates list */}
                      {(userImportPreview.invalid.length > 0 || userImportPreview.duplicates.length > 0) && (
                        <div className="max-h-40 overflow-y-auto p-3 bg-slate-50 rounded-lg border border-slate-200 text-[11px] space-y-1 text-slate-700">
                          <p className="font-semibold text-rose-700">Pre-Import Validation Issues:</p>
                          {userImportPreview.invalid.map((inv, idx) => (
                            <div key={idx} className="text-rose-600">
                              Row {inv.row}: {inv.reason}
                            </div>
                          ))}
                          {userImportPreview.duplicates.map((dup, idx) => (
                            <div key={idx} className="text-amber-700">
                              Row {dup.row}: {dup.reason}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Import execution button */}
                      <button
                        onClick={handleProcessUserImport}
                        disabled={userImporting || userImportPreview.valid.length === 0}
                        className="w-full py-2.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors disabled:opacity-50 min-h-[44px] flex items-center justify-center gap-2"
                      >
                        {userImporting ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>
                              Registering Users {userImportProgress ? `(${userImportProgress.current} / ${userImportProgress.total})...` : '...'}
                            </span>
                          </>
                        ) : (
                          <>
                            <Key className="w-3.5 h-3.5" />
                            <span>Confirm & Register {userImportPreview.valid.length} Users</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* User Accounts Export Card */}
              <div className={`${importExportSubTab !== 'export' ? 'hidden lg:block' : ''} bg-white rounded-xl border border-slate-200 p-6 space-y-6 shadow-2xs`}>
                <div className="border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Download className="w-4 h-4 text-rose-600" />
                    User Accounts Export (Mail ID & Password Column)
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Export registered system users with Full Name, User Mail ID, Assigned Roles, Account Status, and initial/temporary Password placeholder column for easy batch re-import.
                  </p>
                </div>

                <div className="space-y-4 text-xs">
                  <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                    <div className="flex justify-between items-center text-slate-700">
                      <span>Total Accounts in System:</span>
                      <strong className="text-slate-900">{usersList.length} users</strong>
                    </div>
                    <div className="flex justify-between items-center text-slate-700">
                      <span>Included Credentials:</span>
                      <span className="font-semibold text-rose-700">User Mail ID, Password template, Roles</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-700">
                      <span>Security Protection:</span>
                      <span className="text-emerald-700 font-medium">Spreadsheet formula sanitized</span>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex gap-3">
                    <button
                      onClick={() => handleExportUsers('csv')}
                      disabled={userExporting}
                      className="flex-1 py-2 px-3 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors flex items-center justify-center gap-1.5 min-h-[44px]"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{userExporting ? 'Exporting...' : 'Export Users CSV'}</span>
                    </button>

                    <button
                      onClick={() => handleExportUsers('xlsx')}
                      disabled={userExporting}
                      className="flex-1 py-2 px-3 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors flex items-center justify-center gap-1.5 min-h-[44px]"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>{userExporting ? 'Exporting...' : 'Export Users XLSX'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* DATASET 2: BLOOD DONORS */}
          {importExportDataset === 'donors' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* CSV / XLSX Donor Import */}
              {hasPermission('donors.import') && (
                <div className={`${importExportSubTab !== 'import' ? 'hidden lg:block' : ''} bg-white rounded-xl border border-slate-200 p-6 space-y-6 shadow-2xs`}>
                  <div className="border-b border-slate-100 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <Upload className="w-4 h-4 text-rose-600" />
                        Donor Dataset Import (CSV / XLSX)
                      </h3>
                      <p className="text-xs text-slate-500 mt-1">
                        Upload spreadsheet. Optional Password column will automatically generate login credentials!
                      </p>
                    </div>
                    {/* Sample template download buttons */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => downloadSampleDonorTemplate('csv')}
                        className="px-2.5 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition-colors flex items-center gap-1"
                        title="Download Sample Donor CSV Template"
                      >
                        <Download className="w-3 h-3" />
                        Sample CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadSampleDonorTemplate('xlsx')}
                        className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors flex items-center gap-1"
                        title="Download Sample Donor XLSX Template"
                      >
                        <Download className="w-3 h-3" />
                        Sample XLSX
                      </button>
                    </div>
                  </div>

                  {importResult && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
                      {importResult}
                    </div>
                  )}

                  <div className="space-y-3">
                    <label className="flex items-start gap-2.5 p-3 bg-rose-50/80 border border-rose-200 rounded-lg text-xs text-rose-900 cursor-pointer shadow-2xs">
                      <input
                        type="checkbox"
                        checked={autoApproveImport}
                        onChange={(e) => setAutoApproveImport(e.target.checked)}
                        className="mt-0.5 rounded text-rose-600 focus:ring-rose-500 w-4 h-4 shrink-0"
                      />
                      <div>
                        <span className="font-bold text-slate-900">Auto-Approve &amp; Verify for "Find Donors" Section</span>
                        <p className="text-[11px] text-slate-600 mt-0.5">
                          When checked, imported donors are automatically set to approved and verified, making them immediately searchable in the Find Donor directory.
                        </p>
                      </div>
                    </label>

                    <input
                      type="file"
                      accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                      onChange={handleFileChange}
                      className="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-rose-50 file:text-rose-700 hover:file:bg-rose-100"
                    />

                    {importPreview && (
                      <div className="space-y-4 pt-2">
                        <div className="grid grid-cols-3 gap-2 text-center text-xs">
                          <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                            <span className="block font-bold text-emerald-800 text-sm tabular-nums">
                              {importPreview.valid.length}
                            </span>
                            <span className="text-[11px] text-emerald-600">Valid Rows</span>
                          </div>
                          <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                            <span className="block font-bold text-amber-800 text-sm tabular-nums">
                              {importPreview.duplicates.length}
                            </span>
                            <span className="text-[11px] text-amber-600">Duplicates</span>
                          </div>
                          <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                            <span className="block font-bold text-rose-800 text-sm tabular-nums">
                              {importPreview.invalid.length}
                            </span>
                            <span className="text-[11px] text-rose-600">Invalid Rows</span>
                          </div>
                        </div>

                        {/* Invalid / duplicate errors preview */}
                        {(importPreview.invalid.length > 0 || importPreview.duplicates.length > 0) && (
                          <div className="max-h-40 overflow-y-auto p-3 bg-slate-50 rounded-lg border border-slate-200 text-[11px] space-y-1 text-slate-700">
                            <p className="font-semibold text-rose-700">Pre-Import Validation Issues:</p>
                            {importPreview.invalid.map((inv, idx) => (
                              <div key={idx} className="text-rose-600">
                                Row {inv.row}: {inv.reason}
                              </div>
                            ))}
                            {importPreview.duplicates.map((dup, idx) => (
                              <div key={idx} className="text-amber-700">
                                Row {dup.row}: {dup.reason}
                              </div>
                            ))}
                          </div>
                        )}

                        <button
                          onClick={handleProcessImport}
                          disabled={importing || importPreview.valid.length === 0}
                          className="w-full py-2.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors disabled:opacity-50"
                        >
                          {importing
                            ? 'Importing into Database...'
                            : `Confirm & Import ${importPreview.valid.length} Records`}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* CSV / XLSX Donor Export */}
              {hasPermission('donors.export') && (
                <div className={`${importExportSubTab !== 'export' ? 'hidden lg:block' : ''} bg-white rounded-xl border border-slate-200 p-6 space-y-6 shadow-2xs`}>
                  <div className="border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Download className="w-4 h-4 text-rose-600" />
                      Filtered Donor Export
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Export approved donors to CSV or Excel with spreadsheet formula-injection safeguards.
                    </p>
                  </div>

                  <div className="space-y-4 text-xs">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Filter by Blood Group
                      </label>
                      <select
                        value={exportFilterGroup}
                        onChange={(e) => setExportFilterGroup(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="">All Blood Groups</option>
                        {ALL_BLOOD_GROUPS.map((bg) => (
                          <option key={bg} value={bg}>
                            {bg}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Filter by Division
                      </label>
                      <select
                        value={exportFilterDivision}
                        onChange={(e) => setExportFilterDivision(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="">All Divisions</option>
                        {BANGLADESH_DIVISIONS.map((d) => (
                          <option key={d.name} value={d.name}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="pt-4 border-t border-slate-100 flex gap-3">
                      <button
                        onClick={() => handleExportDonors('csv')}
                        disabled={exporting}
                        className="flex-1 py-2 px-3 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors flex items-center justify-center gap-1.5 min-h-[44px]"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Export CSV</span>
                      </button>

                      <button
                        onClick={() => handleExportDonors('xlsx')}
                        disabled={exporting}
                        className="flex-1 py-2 px-3 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors flex items-center justify-center gap-1.5 min-h-[44px]"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        <span>Export XLSX</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
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

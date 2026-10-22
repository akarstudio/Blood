import React, { useState, useEffect, useCallback } from 'react';
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
  Sparkles
} from 'lucide-react';
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
  AvailabilityStatus
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
import { db, handleFirestoreError, OperationType } from '../services/firebase';
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
import { deleteDonorSafely, deleteUserSafely } from '../services/dataSyncService';
import * as XLSX from 'xlsx';

type AdminTab = 'overview' | 'donors' | 'users' | 'policy' | 'import_export' | 'audit' | 'settings';

export const AdminDashboardPage: React.FC<{ onNavigate: (page: string) => void }> = ({ onNavigate }) => {
  const { user, userProfile, hasPermission, isSuperAdmin, isAdmin, isDonorManager } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

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
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{
    valid: any[];
    invalid: { row: number; reason: string; data: any }[];
    duplicates: { row: number; reason: string; data: any }[];
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [exportFilterGroup, setExportFilterGroup] = useState<string>('');
  const [exportFilterDivision, setExportFilterDivision] = useState<string>('');
  const [exporting, setExporting] = useState(false);

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

  // 1. Fetch Overview Metrics
  const loadMetrics = useCallback(async () => {
    if (!user) return;
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

  // 2. Fetch Donors List
  const loadDonors = useCallback(async () => {
    setDonorsLoading(true);
    try {
      const constraints: any[] = [];
      if (approvalFilter !== 'all') {
        constraints.push(where('approvalStatus', '==', approvalFilter));
      }
      if (groupFilter) {
        constraints.push(where('bloodGroup', '==', groupFilter));
      }

      const q = query(collection(db, 'donors'), ...constraints);
      const snapshot = await getDocs(q);
      const list: Donor[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as Donor);
      });

      // Local keyword filter if provided
      let filtered = list;
      if (donorSearch.trim()) {
        const s = donorSearch.toLowerCase().trim();
        filtered = list.filter(
          (donor) =>
            donor.fullName.toLowerCase().includes(s) ||
            donor.email.toLowerCase().includes(s) ||
            donor.phone.includes(s) ||
            donor.district.toLowerCase().includes(s) ||
            donor.upazila.toLowerCase().includes(s)
        );
      }

      setDonorsList(filtered);
      setDonorPage(1);
    } catch (err) {
      console.error('Failed to fetch donors list:', err);
    } finally {
      setDonorsLoading(false);
    }
  }, [approvalFilter, groupFilter, donorSearch]);

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
    if (!user) return;
    if (activeTab === 'overview') loadMetrics();
    if (activeTab === 'donors') loadDonors();
    if (activeTab === 'users' && (hasPermission('users.view') || isAdmin || isSuperAdmin)) loadUsers();
    if (activeTab === 'policy' && (hasPermission('settings.availability_policy.view') || isAdmin || isSuperAdmin)) loadPolicy();
    if (activeTab === 'audit' && (hasPermission('audit_logs.view') || isAdmin || isSuperAdmin)) loadAuditLogs();
    if (activeTab === 'settings' && (hasPermission('settings.view') || isAdmin || isSuperAdmin)) loadSiteConfig();
  }, [activeTab, user, hasPermission, isAdmin, isSuperAdmin, loadMetrics, loadDonors, loadUsers, loadPolicy, loadAuditLogs, loadSiteConfig]);

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

  // ACTION: CSV / XLSX File Parsing & Validation (Section 9)
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

        // Pre-fetch all existing emails and phones for duplicate detection
        const donorsSnap = await getDocs(query(collection(db, 'donors'), limit(500)));
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
          const fullName = row['Full Name'] || row['Name'] || row['fullName'];
          const rawEmail = row['Email'] || row['email'];
          const rawPhone = row['Phone'] || row['phone'] || row['Mobile'];
          const rawBg = (row['Blood Group'] || row['bloodGroup'] || '').toString().trim().toUpperCase();
          const division = row['Division'] || row['division'];
          const district = row['District'] || row['district'];
          const upazila = row['Upazila'] || row['upazila'] || district || 'Sadar';
          const donationDate = row['Last Donation Date'] || row['lastDonationDate'] || '';

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

          if (!division || !district) {
            invalid.push({ row: rowNum, reason: 'Division and District are required', data: row });
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

          // Remember for subsequent rows in this same batch
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
            lastDonationDate: donationDate && /^\d{4}-\d{2}-\d{2}$/.test(donationDate) ? donationDate : '',
          });
        });

        setImportPreview({ valid, invalid, duplicates });
      } catch (err: any) {
        setActionBanner({ message: `Failed to parse file: ${err.message}`, type: 'error' });
      }
    };
    reader.readAsBinaryString(file);
  };

  // ACTION: Process Confirmed Import Batch
  const handleProcessImport = async () => {
    if (!importPreview || importPreview.valid.length === 0) return;
    setImporting(true);

    try {
      const batch = writeBatch(db);
      const nowIso = new Date().toISOString();

      importPreview.valid.forEach((row) => {
        const donorRef = doc(collection(db, 'donors'));
        // Recalculate eligibility with current policy
        const calc = calculateDonorAvailability(
          {
            approvalStatus: 'pending',
            contactVerificationStatus: 'unverified',
            accountStatus: 'active',
            declaredAvailability: 'available',
            lastDonationDate: row.lastDonationDate || undefined,
          },
          policy.minimumIntervalMonths
        );

        // Security requirement: Imported rows MUST NOT forge approval or verification!
        batch.set(donorRef, {
          ...row,
          approvalStatus: 'pending',
          contactVerificationStatus: 'unverified',
          accountStatus: 'active',
          declaredAvailability: 'available',
          calculatedAvailability: 'unavailable',
          eligibilityDate: calc.eligibilityDate || '',
          publicContactConsent: true,
          publicProfileConsent: true,
          contactVisibilityPreference: 'public',
          preferredContactMethod: 'phone',
          privacyConsentVersion: '1.0',
          privacyConsentAt: nowIso,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      });

      await batch.commit();

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
          },
          outcome: 'success',
        });
      }

      setImportResult(`Successfully imported ${importPreview.valid.length} donors. All imported records enter as pending verification.`);
      setActionBanner({
        message: `Import complete: ${importPreview.valid.length} donors imported into pending approval queue.`,
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

  // ACTION: Export Filtered Donors (Section 10)
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

      const q = query(collection(db, 'donors'), ...constraints, limit(1000));
      const snaps = await getDocs(q);

      const rows: any[] = [];
      snaps.forEach((d) => {
        const data = d.data() as Donor;
        // Formula injection protection and private secrets exclusion
        rows.push({
          'Full Name': sanitizeForSpreadsheet(data.fullName),
          'Blood Group': sanitizeForSpreadsheet(data.bloodGroup),
          'Division': sanitizeForSpreadsheet(data.division),
          'District': sanitizeForSpreadsheet(data.district),
          'Upazila': sanitizeForSpreadsheet(data.upazila),
          'Phone': sanitizeForSpreadsheet(formatBangladeshPhone(data.phone)),
          'Email': sanitizeForSpreadsheet(data.email),
          'Approval Status': sanitizeForSpreadsheet(data.approvalStatus),
          'Verification Status': sanitizeForSpreadsheet(data.contactVerificationStatus),
          'Availability': sanitizeForSpreadsheet(data.calculatedAvailability),
          'Last Donation Date': sanitizeForSpreadsheet(data.lastDonationDate || ''),
          'Next Eligibility Date': sanitizeForSpreadsheet(data.eligibilityDate || ''),
        });
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Donors');

      const fileName = `blood_donors_bd_${new Date().toISOString().split('T')[0]}.${format}`;
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
        message: `Successfully exported ${rows.length} donor records in ${format.toUpperCase()} format.`,
        type: 'success',
      });
    } catch (err: any) {
      setActionBanner({ message: `Export failed: ${err.message}`, type: 'error' });
    } finally {
      setExporting(false);
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

  // Check access permission
  const isStaff = isDonorManager || isAdmin || isSuperAdmin || hasPermission('donors.view') || hasPermission('reports.view');
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

  // Paginated donors for table view
  const paginatedDonors = donorsList.slice((donorPage - 1) * donorPageSize, donorPage * donorPageSize);
  const totalDonorPages = Math.ceil(donorsList.length / donorPageSize);

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

      {/* Navigation Tabs (Functional segmented buttons, not pill badge links) */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'overview' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          System Overview
        </button>

        <button
          onClick={() => setActiveTab('donors')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'donors' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Donor Records ({metrics.totalDonors})
        </button>

        {hasPermission('users.view') && (
          <button
            onClick={() => setActiveTab('users')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'users' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Users & Roles
          </button>
        )}

        {hasPermission('settings.availability_policy.view') && (
          <button
            onClick={() => setActiveTab('policy')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'policy' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Availability Policy ({policy.minimumIntervalMonths}mo)
          </button>
        )}

        {(hasPermission('donors.import') || hasPermission('donors.export')) && (
          <button
            onClick={() => setActiveTab('import_export')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'import_export' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Import & Export
          </button>
        )}

        {hasPermission('audit_logs.view') && (
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'audit' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Audit Trail
          </button>
        )}

        {hasPermission('settings.view') && (
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'settings' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Website Settings
          </button>
        )}
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
          {/* Controls Bar */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="flex flex-1 items-center gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:max-w-xs">
                <input
                  type="text"
                  value={donorSearch}
                  onChange={(e) => setDonorSearch(e.target.value)}
                  placeholder="Search by name, phone, district..."
                  className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              </div>

              <select
                value={approvalFilter}
                onChange={(e) => setApprovalFilter(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
              >
                <option value="all">All Approval States</option>
                <option value="pending">Pending Approval</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>

              <select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
              >
                <option value="">All Blood Groups</option>
                {ALL_BLOOD_GROUPS.map((bg) => (
                  <option key={bg} value={bg}>
                    {bg}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                onClick={() => loadDonors()}
                className="px-3 py-1.5 font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
            </div>
          </div>

          {/* Donors Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-800 font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
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
                      <td colSpan={8} className="py-8 text-center text-slate-400">
                        Loading donor records from Firestore...
                      </td>
                    </tr>
                  ) : paginatedDonors.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        No donor records matching search criteria.
                      </td>
                    </tr>
                  ) : (
                    paginatedDonors.map((donor) => (
                      <tr key={donor.id} className="hover:bg-slate-50/80 transition-colors">
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
              totalItems={donorsList.length}
              pageSize={donorPageSize}
              onPageChange={(p) => setDonorPage(p)}
            />
          </div>
        </div>
      )}

      {/* TAB 3: USER & ROLE MANAGEMENT */}
      {activeTab === 'users' && hasPermission('users.view') && (
        <div className="space-y-6">
          <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
            <div>
              <h3 className="font-bold text-slate-900">Administrative System Users</h3>
              <p className="text-slate-500">Configure roles and assign fine-grained capabilities.</p>
            </div>
            <button
              onClick={() => loadUsers()}
              className="px-3 py-1.5 font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-800 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
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
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      Loading users...
                    </td>
                  </tr>
                ) : (
                  usersList.map((usr) => (
                    <tr key={usr.uid} className="hover:bg-slate-50/80 transition-colors">
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

      {/* TAB 5: IMPORT & EXPORT (Section 9 & 10) */}
      {activeTab === 'import_export' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* CSV / XLSX Import */}
          {hasPermission('donors.import') && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6 shadow-2xs">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-rose-600" />
                  Donor Dataset Import (CSV / XLSX)
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Upload spreadsheet with columns: Full Name, Email, Phone, Blood Group, Division, District, Upazila, Last Donation Date.
                </p>
              </div>

              {importResult && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
                  {importResult}
                </div>
              )}

              <div className="space-y-3">
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

          {/* CSV / XLSX Export */}
          {hasPermission('donors.export') && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6 shadow-2xs">
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
                    className="flex-1 py-2 px-3 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>

                  <button
                    onClick={() => handleExportDonors('xlsx')}
                    disabled={exporting}
                    className="flex-1 py-2 px-3 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors flex items-center justify-center gap-1.5"
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

      {/* TAB 6: AUDIT TRAIL (Section 7 & 12) */}
      {activeTab === 'audit' && hasPermission('audit_logs.view') && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3">
              <span className="font-bold text-slate-900">Immutable Audit Logs</span>
              <select
                value={auditActionFilter}
                onChange={(e) => setAuditActionFilter(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
              >
                <option value="">All Entity Types</option>
                <option value="donor">Donor Records</option>
                <option value="policy">Policy Changes</option>
                <option value="user">User Roles</option>
                <option value="import">Imports</option>
                <option value="settings">Site Settings</option>
              </select>
            </div>

            <button
              onClick={() => loadAuditLogs()}
              className="px-3 py-1.5 font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
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
    </div>
  );
};

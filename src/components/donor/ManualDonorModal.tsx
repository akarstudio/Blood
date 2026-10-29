import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Droplet, 
  User, 
  Phone, 
  Mail, 
  MapPin, 
  Calendar, 
  ShieldCheck, 
  Check, 
  AlertCircle, 
  Info, 
  Lock, 
  CheckCircle2, 
  UserPlus,
  Clock,
  Sparkles
} from 'lucide-react';
import { 
  ALL_BLOOD_GROUPS, 
  BloodGroup, 
  ApprovalStatus, 
  ContactVerificationStatus, 
  AccountStatus, 
  AvailabilityStatus, 
  PreferredContactMethod, 
  ContactVisibilityPreference, 
  Donor 
} from '../../types';
import { BANGLADESH_DIVISIONS, getDistrictsForDivision, getUpazilasForDistrict } from '../../data/bangladeshGeo';
import { normalizeBangladeshPhone, normalizeEmail, isValidEmail, isValidBloodGroup } from '../../utils/validation';
import { calculateDonorAvailability } from '../../utils/availability';
import { storeDonorWithPhoneIndex, cleanForFirestore, syncRegisteredIdentifier } from '../../services/dataSyncService';
import { db, createAuthUserWithoutSwitching } from '../../services/firebase';
import { logAuditEvent } from '../../utils/audit';
import { useAuth } from '../../context/AuthContext';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface ManualDonorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newDonor: Donor) => void;
  defaultDivision?: string;
  defaultDistrict?: string;
}

export const ManualDonorModal: React.FC<ManualDonorModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  defaultDivision = '',
  defaultDistrict = '',
}) => {
  const { user, userProfile, isSuperAdmin, isAdmin, isDonorManager } = useAuth();

  // Form states
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'other' | 'unspecified'>('unspecified');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [createAccount, setCreateAccount] = useState(true);
  const [password, setPassword] = useState('Donor@123456');
  const [preferredContactMethod, setPreferredContactMethod] = useState<PreferredContactMethod>('phone');
  const [contactVisibility, setContactVisibility] = useState<ContactVisibilityPreference>('public');

  const [bloodGroup, setBloodGroup] = useState<BloodGroup | ''>('');
  const [division, setDivision] = useState(defaultDivision || 'Dhaka');
  const [district, setDistrict] = useState(defaultDistrict || 'Dhaka');
  const [upazila, setUpazila] = useState('');

  const [lastDonationDate, setLastDonationDate] = useState('');
  const [declaredAvailability, setDeclaredAvailability] = useState<AvailabilityStatus>('available');

  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>('approved');
  const [contactVerificationStatus, setContactVerificationStatus] = useState<ContactVerificationStatus>('verified');
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('active');
  const [additionalNotes, setAdditionalNotes] = useState('');

  // Status & validation states
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Cascading geographic lists
  const districts = useMemo(() => (division ? getDistrictsForDivision(division) : []), [division]);
  const upazilas = useMemo(() => (division && district ? getUpazilasForDistrict(division, district) : []), [division, district]);

  // Ensure district and upazila remain valid when division changes
  useEffect(() => {
    if (districts.length > 0 && !districts.some(d => d.name === district)) {
      setDistrict(districts[0].name);
      setUpazila('');
    }
  }, [districts, district]);

  useEffect(() => {
    if (upazilas.length > 0 && !upazilas.includes(upazila)) {
      setUpazila(upazilas[0]);
    }
  }, [upazilas, upazila]);

  // Reactive Availability Preview based on current selections
  const availabilityPreview = useMemo(() => {
    return calculateDonorAvailability(
      {
        approvalStatus,
        contactVerificationStatus,
        accountStatus,
        declaredAvailability,
        lastDonationDate: lastDonationDate || undefined,
      },
      3 // Default 3-month Bangladesh resting interval
    );
  }, [approvalStatus, contactVerificationStatus, accountStatus, declaredAvailability, lastDonationDate]);

  if (!isOpen) return null;

  const validate = () => {
    const errs: Record<string, string> = {};

    if (!fullName.trim() || fullName.trim().length < 2) {
      errs.fullName = 'Full Name must be at least 2 characters.';
    }

    const normEm = normalizeEmail(email);
    if (!normEm || !isValidEmail(normEm)) {
      errs.email = 'Valid email address is required (e.g. donor@example.com).';
    }

    const normPh = normalizeBangladeshPhone(phone);
    if (!normPh) {
      errs.phone = 'Valid Bangladesh mobile number required (013, 014, 015, 016, 017, 018, 019 followed by 8 digits).';
    }

    if (createAccount && (!password || password.length < 6)) {
      errs.password = 'Account password must be at least 6 characters.';
    }

    if (!bloodGroup || !isValidBloodGroup(bloodGroup)) {
      errs.bloodGroup = 'Please select a valid ABO/Rh blood group.';
    }

    if (!division) errs.division = 'Division is required.';
    if (!district) errs.district = 'District is required.';
    if (!upazila) errs.upazila = 'Upazila / Area is required.';

    if (lastDonationDate) {
      const today = new Date().toISOString().split('T')[0];
      if (lastDonationDate > today) {
        errs.lastDonationDate = 'Last blood donation date cannot be in the future.';
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!validate()) {
      return;
    }

    setSubmitting(true);

    try {
      const normEmail = normalizeEmail(email);
      const normPhone = normalizeBangladeshPhone(phone)!;
      const nowIso = new Date().toISOString();

      // 1. Duplicate phone check in registeredPhones
      const phoneSnap = await getDoc(doc(db, 'registeredPhones', normPhone));
      if (phoneSnap.exists()) {
        setErrors((prev) => ({
          ...prev,
          phone: `A donor with mobile number ${normPhone} is already registered in the system.`,
        }));
        setFormError(`Duplicate mobile number: ${normPhone} is already assigned to a donor profile.`);
        setSubmitting(false);
        return;
      }

      // 2. Optional: Create or connect Firebase Auth User account
      let linkedUid: string | undefined = undefined;
      if (createAccount) {
        try {
          linkedUid = await createAuthUserWithoutSwitching(normEmail, password);
          // Set user document in users collection
          await setDoc(doc(db, 'users', linkedUid), {
            uid: linkedUid,
            email: normEmail,
            displayName: fullName.trim(),
            roleIds: ['donor', 'general_user'],
            phone: normPhone,
            normalizedPhone: normPhone,
            accountStatus: accountStatus,
            createdAt: nowIso,
            updatedAt: nowIso,
          }, { merge: true });

          await syncRegisteredIdentifier(db, normEmail, linkedUid);
        } catch (authErr: any) {
          console.warn('Auth user registration warning:', authErr);
          // If auth creation fails because email already exists in Auth, generate unique ID
          if (!linkedUid) {
            linkedUid = `manual_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          }
        }
      }

      const donorDocId = linkedUid || `donor_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      // 3. Construct pristine donor data
      const newDonorData: Donor = cleanForFirestore({
        id: donorDocId,
        uid: linkedUid || donorDocId,
        fullName: fullName.trim(),
        normalizedName: fullName.trim().toLowerCase(),
        email: normEmail,
        normalizedEmail: normEmail,
        phone: normPhone,
        normalizedPhone: normPhone,
        bloodGroup: bloodGroup as BloodGroup,
        division,
        district,
        upazila,
        gender,
        dateOfBirth: dateOfBirth || '',
        lastDonationDate: lastDonationDate || '',
        eligibilityDate: availabilityPreview.eligibilityDate || '',
        declaredAvailability,
        calculatedAvailability: availabilityPreview.calculatedAvailability,
        contactVerificationStatus,
        approvalStatus,
        accountStatus,
        publicContactConsent: true,
        publicProfileConsent: true,
        contactVisibilityPreference: contactVisibility,
        preferredContactMethod,
        additionalNotes: additionalNotes.trim(),
        privacyConsentVersion: '1.0',
        privacyConsentAt: nowIso,
        approvedBy: approvalStatus === 'approved' ? (user?.uid || 'operator') : undefined,
        approvedAt: approvalStatus === 'approved' ? nowIso : undefined,
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      // 4. Save donor with atomic phone index and protected contact info
      await storeDonorWithPhoneIndex(
        db,
        newDonorData,
        donorDocId,
        normPhone,
        user ? { uid: user.uid, email: user.email || undefined } : undefined
      );

      // 5. Write audit log
      if (user) {
        try {
          await logAuditEvent({
            actorUid: user.uid,
            actorEmail: user.email || undefined,
            action: 'donor.manual_register',
            entityType: 'donor',
            entityId: donorDocId,
            newValues: {
              fullName: newDonorData.fullName,
              email: newDonorData.email,
              phone: newDonorData.phone,
              bloodGroup: newDonorData.bloodGroup,
              division: newDonorData.division,
              district: newDonorData.district,
              upazila: newDonorData.upazila,
              approvalStatus: newDonorData.approvalStatus,
              calculatedAvailability: newDonorData.calculatedAvailability,
            },
            reason: `Manual registration entered by operator (${userProfile?.displayName || user.email})`,
            outcome: 'success',
          });
        } catch (auditErr) {
          console.warn('Audit trail note:', auditErr);
        }
      }

      onSuccess(newDonorData);
      onClose();
    } catch (err: any) {
      console.error('Manual donor registration failed:', err);
      setFormError(err.message || 'Failed to save donor record. Please check inputs and database permissions.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-2xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-donor-modal-title"
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl my-8 overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="bg-slate-900 text-white px-5 sm:px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="manual-donor-modal-title" className="text-base sm:text-lg font-bold text-white tracking-tight">
                  Manual Donor Registration
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Staff Entry
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Authorized entry for Super Admin, Admin, Donor Manager &amp; Data Entry Operator
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center justify-center"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body - Scrollable */}
        <form onSubmit={handleSubmit} className="overflow-y-auto p-5 sm:p-6 space-y-6 flex-1 text-xs">
          {formError && (
            <div className="p-3.5 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <p className="font-bold">Registration Issue</p>
                <p className="text-rose-800 mt-0.5">{formError}</p>
              </div>
            </div>
          )}

          {/* Section 1: Personal Information */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-slate-100">
              <User className="w-4 h-4 text-rose-600" />
              <h3 className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                1. Personal Information
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  Full Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Mohammad Rafiqul Islam"
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden ${
                    errors.fullName ? 'border-rose-400 bg-rose-50/50' : 'border-slate-300'
                  }`}
                />
                {errors.fullName && <p className="text-[11px] text-rose-600 mt-1">{errors.fullName}</p>}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Gender
                </label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
                >
                  <option value="unspecified">Unspecified / Other</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Date of Birth <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Preferred Contact Method
                </label>
                <select
                  value={preferredContactMethod}
                  onChange={(e) => setPreferredContactMethod(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
                >
                  <option value="phone">Direct Phone Call</option>
                  <option value="whatsapp">WhatsApp Message</option>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Contact & Authentication */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-slate-100">
              <Phone className="w-4 h-4 text-rose-600" />
              <h3 className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                2. Contact &amp; Account Access
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Email Address <span className="text-rose-600">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="donor@example.com"
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden ${
                    errors.email ? 'border-rose-400 bg-rose-50/50' : 'border-slate-300'
                  }`}
                />
                {errors.email && <p className="text-[11px] text-rose-600 mt-1">{errors.email}</p>}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Bangladesh Mobile Phone <span className="text-rose-600">*</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="017XXXXXXXX"
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden ${
                    errors.phone ? 'border-rose-400 bg-rose-50/50' : 'border-slate-300'
                  }`}
                />
                {errors.phone && <p className="text-[11px] text-rose-600 mt-1">{errors.phone}</p>}
              </div>
            </div>

            {/* Account Provisioning Option */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
              <label className="flex items-center gap-2 text-slate-800 font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={createAccount}
                  onChange={(e) => setCreateAccount(e.target.checked)}
                  className="rounded-sm border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <span>Provision Firebase Auth Account for this donor</span>
              </label>

              {createAccount && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Initial Password <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-rose-500 bg-white ${
                        errors.password ? 'border-rose-400' : 'border-slate-300'
                      }`}
                    />
                    {errors.password && <p className="text-[11px] text-rose-600 mt-1">{errors.password}</p>}
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Phone Visibility Preference
                    </label>
                    <select
                      value={contactVisibility}
                      onChange={(e) => setContactVisibility(e.target.value as any)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
                    >
                      <option value="public">Visible in public search</option>
                      <option value="registered_only">Visible to registered users only</option>
                      <option value="hidden">Hidden (Shielded)</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Blood Group & Geographic Location */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-slate-100">
              <MapPin className="w-4 h-4 text-rose-600" />
              <h3 className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                3. Blood Group &amp; Bangladesh Location
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Blood Group <span className="text-rose-600">*</span>
                </label>
                <select
                  value={bloodGroup}
                  onChange={(e) => setBloodGroup(e.target.value as BloodGroup)}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-rose-500 bg-white ${
                    errors.bloodGroup ? 'border-rose-400 bg-rose-50/50' : 'border-slate-300'
                  }`}
                >
                  <option value="">Select Blood Group</option>
                  {ALL_BLOOD_GROUPS.map((bg) => (
                    <option key={bg} value={bg}>
                      {bg}
                    </option>
                  ))}
                </select>
                {errors.bloodGroup && <p className="text-[11px] text-rose-600 mt-1">{errors.bloodGroup}</p>}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Division <span className="text-rose-600">*</span>
                </label>
                <select
                  value={division}
                  onChange={(e) => {
                    setDivision(e.target.value);
                    setDistrict('');
                    setUpazila('');
                  }}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-rose-500 bg-white ${
                    errors.division ? 'border-rose-400' : 'border-slate-300'
                  }`}
                >
                  <option value="">Select Division</option>
                  {BANGLADESH_DIVISIONS.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
                {errors.division && <p className="text-[11px] text-rose-600 mt-1">{errors.division}</p>}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  District <span className="text-rose-600">*</span>
                </label>
                <select
                  value={district}
                  onChange={(e) => {
                    setDistrict(e.target.value);
                    setUpazila('');
                  }}
                  disabled={!division}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-rose-500 bg-white disabled:bg-slate-50 ${
                    errors.district ? 'border-rose-400' : 'border-slate-300'
                  }`}
                >
                  <option value="">Select District</option>
                  {districts.map((dst) => (
                    <option key={dst.name} value={dst.name}>
                      {dst.name}
                    </option>
                  ))}
                </select>
                {errors.district && <p className="text-[11px] text-rose-600 mt-1">{errors.district}</p>}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Upazila / Area <span className="text-rose-600">*</span>
                </label>
                <select
                  value={upazila}
                  onChange={(e) => setUpazila(e.target.value)}
                  disabled={!district}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-rose-500 bg-white disabled:bg-slate-50 ${
                    errors.upazila ? 'border-rose-400' : 'border-slate-300'
                  }`}
                >
                  <option value="">Select Upazila</option>
                  {upazilas.map((upz) => (
                    <option key={upz} value={upz}>
                      {upz}
                    </option>
                  ))}
                </select>
                {errors.upazila && <p className="text-[11px] text-rose-600 mt-1">{errors.upazila}</p>}
              </div>
            </div>
          </div>

          {/* Section 4: Donation History & Availability */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-slate-100">
              <Calendar className="w-4 h-4 text-rose-600" />
              <h3 className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                4. Donation History &amp; Availability Calculation
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Last Blood Donation Date
                </label>
                <input
                  type="date"
                  value={lastDonationDate}
                  onChange={(e) => setLastDonationDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
                />
                <p className="text-[11px] text-slate-400 mt-1">Leave empty if first-time donor.</p>
                {errors.lastDonationDate && (
                  <p className="text-[11px] text-rose-600 mt-1">{errors.lastDonationDate}</p>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Declared Availability
                </label>
                <select
                  value={declaredAvailability}
                  onChange={(e) => setDeclaredAvailability(e.target.value as AvailabilityStatus)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
                >
                  <option value="available">Available (Willing to donate)</option>
                  <option value="unavailable">Unavailable (Temporarily paused)</option>
                </select>
              </div>
            </div>

            {/* Live Reactive Availability Banner */}
            <div className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
              availabilityPreview.isAvailable 
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900' 
                : 'bg-amber-50/70 border-amber-200 text-amber-900'
            }`}>
              <div className="flex items-center gap-2.5">
                <Clock className={`w-4 h-4 ${availabilityPreview.isAvailable ? 'text-emerald-600' : 'text-amber-600'}`} />
                <div>
                  <span className="font-bold">
                    Calculated Availability: {availabilityPreview.calculatedAvailability.toUpperCase()}
                  </span>
                  <p className="text-[11px] opacity-90 mt-0.5">
                    {availabilityPreview.reason}
                    {availabilityPreview.eligibilityDate && ` (Next eligible date: ${availabilityPreview.eligibilityDate})`}
                  </p>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-md text-[11px] font-bold uppercase ${
                availabilityPreview.isAvailable ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'
              }`}>
                {availabilityPreview.calculatedAvailability}
              </span>
            </div>
          </div>

          {/* Section 5: Administrative Decision */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 pb-1.5 border-b border-slate-100">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <h3 className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                5. Administrative Decisions &amp; Statuses
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Approval Status
                </label>
                <select
                  value={approvalStatus}
                  onChange={(e) => setApprovalStatus(e.target.value as ApprovalStatus)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
                >
                  <option value="approved">Approved (Active in Directory)</option>
                  <option value="pending">Pending (Awaiting Review)</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Contact Verification Status
                </label>
                <select
                  value={contactVerificationStatus}
                  onChange={(e) => setContactVerificationStatus(e.target.value as ContactVerificationStatus)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
                >
                  <option value="verified">Verified (Confirmed authenticity)</option>
                  <option value="pending">Pending Verification</option>
                  <option value="unverified">Unverified</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Account Status
                </label>
                <select
                  value={accountStatus}
                  onChange={(e) => setAccountStatus(e.target.value as AccountStatus)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="deactivated">Deactivated</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Clinical or Regional Notes <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <textarea
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                rows={2}
                placeholder="e.g. Registered at Dhaka Medical College voluntary blood donation drive."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
              />
            </div>
          </div>

          {/* Modal Actions */}
          <div className="pt-4 border-t border-slate-200 flex flex-col-reverse sm:flex-row items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="w-full sm:w-auto px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold transition-colors shadow-xs flex items-center justify-center gap-2 min-h-[42px] disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Registering in Firestore...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Register Donor Now</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

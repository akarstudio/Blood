import React, { useState, useEffect } from 'react';
import { 
  Droplet, 
  UserCheck, 
  ShieldAlert, 
  CheckCircle, 
  AlertCircle, 
  Info,
  Calendar,
  Lock,
  Phone,
  Mail,
  User,
  MapPin
} from 'lucide-react';
import { ALL_BLOOD_GROUPS, BloodGroup, ContactVisibilityPreference, PreferredContactMethod } from '../types';
import { BANGLADESH_DIVISIONS, getDistrictsForDivision, getUpazilasForDistrict } from '../data/bangladeshGeo';
import { normalizeEmail, isValidEmail, normalizeBangladeshPhone, formatBangladeshPhone } from '../utils/validation';
import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { storeDonorWithPhoneIndex } from '../services/dataSyncService';
import { useAuth } from '../context/AuthContext';
import { calculateDonorAvailability } from '../utils/availability';

interface RegisterDonorPageProps {
  onNavigate: (page: string) => void;
}

export const RegisterDonorPage: React.FC<RegisterDonorPageProps> = ({ onNavigate }) => {
  const { user, signUp, signInWithGoogle, sendVerificationEmail, refreshProfiles } = useAuth();

  // Form Fields
  const [fullName, setFullName] = useState(user?.displayName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [bloodGroup, setBloodGroup] = useState<BloodGroup | ''>('');
  const [division, setDivision] = useState('');
  const [district, setDistrict] = useState('');
  const [upazila, setUpazila] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'other' | 'unspecified'>('unspecified');
  const [lastDonationDate, setLastDonationDate] = useState('');
  const [preferredContactMethod, setPreferredContactMethod] = useState<PreferredContactMethod>('phone');
  const [contactVisibility, setContactVisibility] = useState<ContactVisibilityPreference>('public');
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [termsConsent, setTermsConsent] = useState(false);

  // Status & Validation
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successResult, setSuccessResult] = useState<{
    donorId: string;
    email: string;
  } | null>(null);

  useEffect(() => {
    if (user?.email && !email) setEmail(user.email);
    if (user?.displayName && !fullName) setFullName(user.displayName);
  }, [user]);

  const districts = division ? getDistrictsForDivision(division) : [];
  const upazilas = division && district ? getUpazilasForDistrict(division, district) : [];

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!fullName.trim()) newErrors.fullName = 'Full name is required.';
    if (!email.trim() || !isValidEmail(email)) newErrors.email = 'Please enter a valid email address.';

    const normPhone = normalizeBangladeshPhone(phone);
    if (!normPhone) {
      newErrors.phone = 'Valid Bangladesh mobile number required (e.g. 017XXXXXXXX, 018XXXXXXXX).';
    }

    if (!user) {
      if (!password || password.length < 6) {
        newErrors.password = 'Password must be at least 6 characters.';
      }
      if (password !== confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match.';
      }
    }

    if (!bloodGroup) newErrors.bloodGroup = 'Please select your blood group.';
    if (!division) newErrors.division = 'Please select your division.';
    if (!district) newErrors.district = 'Please select your district.';
    if (!upazila) newErrors.upazila = 'Please select your upazila.';

    if (!privacyConsent) {
      newErrors.privacyConsent = 'You must consent to the Privacy Policy.';
    }
    if (!termsConsent) {
      newErrors.termsConsent = 'You must accept the Donor Terms of Service.';
    }

    if (lastDonationDate) {
      const today = new Date().toISOString().split('T')[0];
      if (lastDonationDate > today) {
        newErrors.lastDonationDate = 'Last donation date cannot be in the future.';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    setErrors({});

    try {
      const normalizedEm = normalizeEmail(email);
      const normalizedPh = normalizeBangladeshPhone(phone)!;

      // 1. Authenticate or create user first if not already signed in
      let uid = user?.uid;
      if (!uid) {
        try {
          const newUser = await signUp(normalizedEm, password, fullName.trim());
          uid = newUser.uid;
          try {
            await sendVerificationEmail();
          } catch (e) {
            console.warn('Could not dispatch immediate verification email:', e);
          }
        } catch (signupErr: any) {
          if (signupErr.code === 'auth/operation-not-allowed') {
            setErrors({
              form: 'Email/Password registration is not enabled in Firebase Authentication. Please use the "Continue with Google" button above to complete your registration in 1 click.',
            });
            setSubmitting(false);
            return;
          }
          if (signupErr.code === 'auth/email-already-in-use') {
            setErrors({
              email: 'An account with this email address already exists. Please sign in first, then complete registration.',
            });
            setSubmitting(false);
            return;
          }
          setErrors({ form: signupErr.message || 'Account registration failed.' });
          setSubmitting(false);
          return;
        }
      }

      // 2. Direct duplicate checks for this authenticated user and phone
      const [userDonorSnap, phoneSnap] = await Promise.all([
        getDoc(doc(db, 'donors', uid)),
        getDoc(doc(db, 'registeredPhones', normalizedPh)),
      ]);

      if (userDonorSnap.exists()) {
        setErrors({ form: 'You already have a registered blood donor profile linked to this account.' });
        setSubmitting(false);
        return;
      }

      if (phoneSnap.exists() && phoneSnap.data()?.uid !== uid) {
        setErrors({ phone: 'A donor with this mobile number is already registered.' });
        setSubmitting(false);
        return;
      }

      // 3. Compute initial calculated availability using the standard pure function
      const availabilityCheck = calculateDonorAvailability({
        approvalStatus: 'pending',
        contactVerificationStatus: 'unverified',
        accountStatus: 'active',
        declaredAvailability: 'available',
        lastDonationDate: lastDonationDate || undefined,
      });

      // 4. Save donor record at donors/{uid} and register phone lookup
      const nowIso = new Date().toISOString();
      const donorDocData = {
        id: uid,
        uid,
        fullName: fullName.trim(),
        normalizedName: fullName.trim().toLowerCase(),
        email: normalizedEm,
        normalizedEmail: normalizedEm,
        phone: normalizedPh,
        normalizedPhone: normalizedPh,
        bloodGroup: bloodGroup as BloodGroup,
        division,
        district,
        upazila,
        gender,
        lastDonationDate: lastDonationDate || '',
        eligibilityDate: availabilityCheck.eligibilityDate || '',
        declaredAvailability: 'available',
        calculatedAvailability: 'unavailable', // Starts unavailable until verified & approved!
        contactVerificationStatus: 'unverified', // Requires real email confirmation
        approvalStatus: 'pending',               // Requires administrator approval
        accountStatus: 'active',
        publicContactConsent: true,
        publicProfileConsent: true,
        contactVisibilityPreference: contactVisibility,
        preferredContactMethod,
        privacyConsentVersion: '1.0',
        privacyConsentAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      await storeDonorWithPhoneIndex(
        db,
        donorDocData,
        uid,
        normalizedPh,
        user ? { uid: user.uid, email: user.email || undefined } : undefined
      );

      await refreshProfiles();

      setSuccessResult({
        donorId: uid,
        email: normalizedEm,
      });
    } catch (err: any) {
      console.error('Registration failed:', err);
      setErrors({ form: err.message || 'Registration failed. Please check details and try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (successResult) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-slate-900">Registration Submitted Successfully</h2>
            <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
              Thank you for volunteering to save lives in Bangladesh. Your donor application has been securely recorded.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-left text-xs text-slate-700 space-y-3">
            <div className="flex items-center gap-2 font-semibold text-slate-900 text-sm">
              <Info className="w-4 h-4 text-rose-600" />
              <span>Next Mandatory Steps Before Public Search:</span>
            </div>

            <ol className="list-decimal pl-5 space-y-2 text-slate-600">
              <li>
                <span className="font-semibold text-slate-800">Email Verification:</span> A verification link has been sent to <span className="font-semibold text-slate-900">{successResult.email}</span>. Click the link in your inbox to confirm your email.
              </li>
              <li>
                <span className="font-semibold text-slate-800">Administrator Approval:</span> A regional health administrator will verify your profile and contact authenticity.
              </li>
              <li>
                <span className="font-semibold text-slate-800">Availability Activation:</span> Once verified, approved, and when your 3-calendar-month resting interval is satisfied, your profile will appear in public donor searches across Bangladesh.
              </li>
            </ol>
          </div>

          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={() => onNavigate('profile')}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors"
            >
              View My Donor Status
            </button>
            <button
              onClick={() => onNavigate('find-donors')}
              className="px-5 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Browse Donor Directory
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      {/* Header */}
      <div className="border-b border-slate-200 pb-5">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-md mb-2">
          <Droplet className="w-3.5 h-3.5 fill-current" />
          <span>Voluntary Blood Donor Registration</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Register as a Voluntary Blood Donor
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Your details are validated according to the Bangladesh Standard Time calendar and protected under our privacy rules.
        </p>
      </div>

      {/* Safety Notice Banner */}
      <div className="bg-rose-50/60 border border-rose-200/80 rounded-xl p-4 flex items-start gap-3 text-xs text-rose-900">
        <Info className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <p className="font-semibold">Verification & Review Notice</p>
          <p className="text-rose-800 mt-0.5">
            New registrations do not appear immediately in public search. You must complete email contact verification and receive administrator review. If you have never donated or the last date is unrecorded, clinical guidelines require initial health verification.
          </p>
        </div>
      </div>

      {errors.form && (
        <div className="p-4 bg-rose-100 border border-rose-300 rounded-xl text-xs text-rose-900 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errors.form}</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xs border border-slate-200 p-4 sm:p-8 space-y-6 sm:space-y-8">
        {/* Mobile Quick Form Step Indicator */}
        <div className="md:hidden flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-[11px] font-medium text-slate-500">
          <span className="bg-rose-50 text-rose-700 font-bold px-2 py-1 rounded-md shrink-0 border border-rose-100">1. Personal</span>
          <span className="text-slate-300">&rarr;</span>
          <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded-md shrink-0">2. Account</span>
          <span className="text-slate-300">&rarr;</span>
          <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded-md shrink-0">3. Blood &amp; Area</span>
          <span className="text-slate-300">&rarr;</span>
          <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded-md shrink-0">4. Consents</span>
        </div>

        {/* Personal Details */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <User className="w-4 h-4 text-rose-600" />
            1. Personal Information
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Full Name <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Tanvir Ahmed"
                className={`w-full px-3 py-2 text-xs border rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden ${
                  errors.fullName ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
                }`}
              />
              {errors.fullName && <p className="text-[11px] text-rose-600 mt-1">{errors.fullName}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Gender <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as any)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
              >
                <option value="unspecified">Prefer not to say</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
        </div>

        {/* Contact & Authentication */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <Mail className="w-4 h-4 text-rose-600" />
            2. Contact & Account Access
          </h2>

          {!user && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <span className="text-slate-600">Want instant 1-click registration without setting a password?</span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await signInWithGoogle();
                  } catch (e: any) {
                    setErrors({ form: e.message || 'Google sign-in failed' });
                  }
                }}
                className="px-3 py-1.5 font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-md shadow-2xs transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span>Continue with Google</span>
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Email Address <span className="text-rose-600">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={Boolean(user?.email)}
                placeholder="name@example.com"
                className={`w-full px-3 py-2 text-xs border rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden disabled:bg-slate-50 ${
                  errors.email ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
                }`}
              />
              {errors.email && <p className="text-[11px] text-rose-600 mt-1">{errors.email}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Bangladesh Mobile Phone <span className="text-rose-600">*</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 01712345678"
                className={`w-full px-3 py-2 text-xs border rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden ${
                  errors.phone ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
                }`}
              />
              {errors.phone && <p className="text-[11px] text-rose-600 mt-1">{errors.phone}</p>}
            </div>
          </div>

          {!user && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Create Password <span className="text-rose-600">*</span>
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className={`w-full px-3 py-2 text-xs border rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden ${
                    errors.password ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
                  }`}
                />
                {errors.password && <p className="text-[11px] text-rose-600 mt-1">{errors.password}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Confirm Password <span className="text-rose-600">*</span>
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className={`w-full px-3 py-2 text-xs border rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden ${
                    errors.confirmPassword ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
                  }`}
                />
                {errors.confirmPassword && <p className="text-[11px] text-rose-600 mt-1">{errors.confirmPassword}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Blood & Geographic Location */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <MapPin className="w-4 h-4 text-rose-600" />
            3. Blood Group & Bangladesh Location
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Blood Group <span className="text-rose-600">*</span>
              </label>
              <select
                value={bloodGroup}
                onChange={(e) => setBloodGroup(e.target.value as BloodGroup)}
                className={`w-full px-3 py-2 text-xs border rounded-lg focus:ring-2 focus:ring-rose-500 bg-white ${
                  errors.bloodGroup ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
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
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Division <span className="text-rose-600">*</span>
              </label>
              <select
                value={division}
                onChange={(e) => {
                  setDivision(e.target.value);
                  setDistrict('');
                  setUpazila('');
                }}
                className={`w-full px-3 py-2 text-xs border rounded-lg focus:ring-2 focus:ring-rose-500 bg-white ${
                  errors.division ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
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
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                District <span className="text-rose-600">*</span>
              </label>
              <select
                value={district}
                onChange={(e) => {
                  setDistrict(e.target.value);
                  setUpazila('');
                }}
                disabled={!division}
                className={`w-full px-3 py-2 text-xs border rounded-lg focus:ring-2 focus:ring-rose-500 bg-white disabled:bg-slate-50 ${
                  errors.district ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
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
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Upazila / Area <span className="text-rose-600">*</span>
              </label>
              <select
                value={upazila}
                onChange={(e) => setUpazila(e.target.value)}
                disabled={!district}
                className={`w-full px-3 py-2 text-xs border rounded-lg focus:ring-2 focus:ring-rose-500 bg-white disabled:bg-slate-50 ${
                  errors.upazila ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
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

        {/* Donation History & Availability */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <Calendar className="w-4 h-4 text-rose-600" />
            4. Donation History & Preferences
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Last Blood Donation Date
              </label>
              <input
                type="date"
                value={lastDonationDate}
                onChange={(e) => setLastDonationDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
              />
              <p className="text-[11px] text-slate-400 mt-1">Leave empty if first-time donor.</p>
              {errors.lastDonationDate && (
                <p className="text-[11px] text-rose-600 mt-1">{errors.lastDonationDate}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Preferred Contact Channel
              </label>
              <select
                value={preferredContactMethod}
                onChange={(e) => setPreferredContactMethod(e.target.value as any)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
              >
                <option value="phone">Direct Phone Call</option>
                <option value="whatsapp">WhatsApp Message</option>
                <option value="sms">SMS</option>
                <option value="email">Email</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Phone Visibility Preference
              </label>
              <select
                value={contactVisibility}
                onChange={(e) => setContactVisibility(e.target.value as any)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
              >
                <option value="public">Visible in public search</option>
                <option value="registered_only">Visible to registered users only</option>
                <option value="hidden">Hidden (Shielded)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Consents & Terms */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={privacyConsent}
              onChange={(e) => setPrivacyConsent(e.target.checked)}
              className="mt-0.5 rounded-sm border-slate-300 text-rose-600 focus:ring-rose-500"
            />
            <span>
              I consent to the <button type="button" onClick={() => onNavigate('privacy')} className="text-rose-700 underline font-semibold">Privacy Policy</button> and authorize Blood Group Finder Bangladesh to store my contact and blood group information.
            </span>
          </label>
          {errors.privacyConsent && <p className="text-[11px] text-rose-600 pl-6">{errors.privacyConsent}</p>}

          <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={termsConsent}
              onChange={(e) => setTermsConsent(e.target.checked)}
              className="mt-0.5 rounded-sm border-slate-300 text-rose-600 focus:ring-rose-500"
            />
            <span>
              I confirm that blood donation is entirely voluntary, altruistic, and uncompensated. I accept the <button type="button" onClick={() => onNavigate('terms')} className="text-rose-700 underline font-semibold">Platform Terms of Service</button>.
            </span>
          </label>
          {errors.termsConsent && <p className="text-[11px] text-rose-600 pl-6">{errors.termsConsent}</p>}
        </div>

        {/* Submit Button */}
        <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-[11px] text-slate-500">
            All data processed in accordance with Bangladesh healthcare standards.
          </p>
          <button
            type="submit"
            disabled={submitting}
            className="w-full sm:w-auto px-6 py-3 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-lg shadow-xs transition-colors disabled:opacity-50 flex items-center justify-center gap-2 min-h-[46px]"
          >
            {submitting ? 'Validating & Registering...' : 'Complete Donor Registration'}
          </button>
        </div>
      </form>
    </div>
  );
};

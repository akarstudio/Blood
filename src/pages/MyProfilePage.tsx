import React, { useState, useEffect } from 'react';
import { 
  User, 
  Droplet, 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  ShieldCheck, 
  Mail, 
  Phone, 
  Calendar,
  Save,
  Send,
  Eye,
  Info,
  Trash2,
  AlertTriangle,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/common/StatusBadge';
import { calculateDonorAvailability, formatBangladeshDateOnly, formatBangladeshPhone } from '../utils/availability';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { logAuditEvent } from '../utils/audit';
import { deleteDonorSafely, updateDonorWithPhoneSync } from '../services/dataSyncService';
import { AvailabilityPolicy, ContactVisibilityPreference, PreferredContactMethod } from '../types';

interface MyProfilePageProps {
  onNavigate: (page: string) => void;
}

export const MyProfilePage: React.FC<MyProfilePageProps> = ({ onNavigate }) => {
  const { user, userProfile, donorProfile, sendVerificationEmail, refreshProfiles } = useAuth();

  const [saving, setSaving] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Editable donor preferences
  const [declaredAvailability, setDeclaredAvailability] = useState<'available' | 'unavailable'>(
    donorProfile?.declaredAvailability || 'available'
  );
  const [lastDonationDate, setLastDonationDate] = useState<string>(
    donorProfile?.lastDonationDate || ''
  );
  const [contactVisibility, setContactVisibility] = useState<ContactVisibilityPreference>(
    donorProfile?.contactVisibilityPreference || 'public'
  );
  const [preferredContact, setPreferredContact] = useState<PreferredContactMethod>(
    donorProfile?.preferredContactMethod || 'phone'
  );

  const [policyInterval, setPolicyInterval] = useState(3);
  const [profileMobileTab, setProfileMobileTab] = useState<'status' | 'preferences' | 'privacy'>('status');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');

  const handleDeleteDonorProfile = async () => {
    if (!donorProfile || !user) return;
    setDeleting(true);
    setErrorMessage(null);
    try {
      await deleteDonorSafely(
        db,
        donorProfile.id,
        { uid: user.uid, email: user.email || undefined },
        'Donor self-requested profile removal'
      );
      setShowDeleteModal(false);
      setDeleteConfirmationText('');
      await refreshProfiles();
      setSuccessMessage('Your blood donor profile and indexed contact records have been completely and securely removed.');
    } catch (err: any) {
      console.error('Delete donor failed:', err);
      setErrorMessage(err.message || 'Failed to delete donor profile.');
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    async function loadPolicy() {
      try {
        const snap = await getDoc(doc(db, 'systemSettings', 'availabilityPolicy'));
        if (snap.exists()) {
          const pol = snap.data() as AvailabilityPolicy;
          if (pol.minimumIntervalMonths) setPolicyInterval(pol.minimumIntervalMonths);
        }
      } catch (e) {
        // default 3
      }
    }
    loadPolicy();
  }, []);

  useEffect(() => {
    if (donorProfile) {
      setDeclaredAvailability(donorProfile.declaredAvailability);
      setLastDonationDate(donorProfile.lastDonationDate || '');
      setContactVisibility(donorProfile.contactVisibilityPreference || 'public');
      setPreferredContact(donorProfile.preferredContactMethod || 'phone');
    }
  }, [donorProfile]);

  const handleResendVerification = async () => {
    setResendingEmail(true);
    setEmailNotice(null);
    try {
      await sendVerificationEmail();
      setEmailNotice('Verification email sent! Check your inbox and spam folder.');
    } catch (e: any) {
      setEmailNotice(e.message || 'Unable to send verification email. Please try again later.');
    } finally {
      setResendingEmail(false);
    }
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!donorProfile) return;

    setSaving(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const today = new Date().toISOString().split('T')[0];
      if (lastDonationDate && lastDonationDate > today) {
        setErrorMessage('Last donation date cannot be in the future.');
        setSaving(false);
        return;
      }

      // Authoritative recalculated availability
      const calcResult = calculateDonorAvailability(
        {
          approvalStatus: donorProfile.approvalStatus,
          contactVerificationStatus: donorProfile.contactVerificationStatus,
          accountStatus: donorProfile.accountStatus,
          declaredAvailability: declaredAvailability,
          lastDonationDate: lastDonationDate || undefined,
        },
        policyInterval
      );

      const updatedFields = {
        declaredAvailability,
        lastDonationDate: lastDonationDate || '',
        eligibilityDate: calcResult.eligibilityDate || '',
        calculatedAvailability: calcResult.calculatedAvailability,
        contactVisibilityPreference: contactVisibility,
        preferredContactMethod: preferredContact,
        updatedAt: new Date().toISOString(),
      };

      await updateDoc(doc(db, 'donors', donorProfile.id), updatedFields);

      if (user) {
        await logAuditEvent({
          actorUid: user.uid,
          actorEmail: user.email || undefined,
          action: 'donor.update_self_preferences',
          entityType: 'donor',
          entityId: donorProfile.id,
          previousValues: {
            declaredAvailability: donorProfile.declaredAvailability,
            lastDonationDate: donorProfile.lastDonationDate,
          },
          newValues: updatedFields,
          outcome: 'success',
        });
      }

      await refreshProfiles();
      setSuccessMessage('Donor profile preferences updated successfully.');
    } catch (err: any) {
      console.error('Update failed:', err);
      setErrorMessage(err.message || 'Failed to update preferences.');
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center space-y-4">
        <h2 className="text-xl font-bold text-slate-900">Sign In Required</h2>
        <p className="text-xs text-slate-500">Please sign in to view your donor profile and manage availability.</p>
        <button
          onClick={() => onNavigate('signin')}
          className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700"
        >
          Go to Sign In
        </button>
      </div>
    );
  }

  // Calculate live preview of availability
  const currentCalc = donorProfile
    ? calculateDonorAvailability(
        {
          approvalStatus: donorProfile.approvalStatus,
          contactVerificationStatus: donorProfile.contactVerificationStatus,
          accountStatus: donorProfile.accountStatus,
          declaredAvailability: declaredAvailability,
          lastDonationDate: lastDonationDate || undefined,
        },
        policyInterval
      )
    : null;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6 sm:space-y-8">
      {/* Page Title */}
      <div className="border-b border-slate-200 pb-4 sm:pb-5">
        <h1 className="text-xl sm:text-3xl font-bold tracking-tight text-slate-900">
          My Donor Profile & Status
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Review your verification milestones, update your last donation date, and toggle availability.
        </p>
      </div>

      {successMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {donorProfile ? (
        <div className="space-y-6">
          {/* Responsive Mobile Tab Navigation Strip */}
          <div role="tablist" aria-label="Profile Sections" className="md:hidden grid grid-cols-3 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              role="tab"
              aria-selected={profileMobileTab === 'status'}
              onClick={() => setProfileMobileTab('status')}
              className={`py-2 px-2 text-xs font-semibold rounded-lg transition-all min-h-[44px] flex items-center justify-center text-center focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                profileMobileTab === 'status'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold ring-1 ring-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Status &amp; Verification
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={profileMobileTab === 'preferences'}
              onClick={() => setProfileMobileTab('preferences')}
              className={`py-2 px-2 text-xs font-semibold rounded-lg transition-all min-h-[44px] flex items-center justify-center text-center focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                profileMobileTab === 'preferences'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold ring-1 ring-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Preferences
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={profileMobileTab === 'privacy'}
              onClick={() => setProfileMobileTab('privacy')}
              className={`py-2 px-2 text-xs font-semibold rounded-lg transition-all min-h-[44px] flex items-center justify-center text-center focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                profileMobileTab === 'privacy'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold ring-1 ring-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Data Privacy
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Left Column: Status Overview Card */}
            <div className={`md:col-span-1 space-y-6 ${profileMobileTab !== 'status' ? 'hidden md:block' : ''}`}>
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 shadow-2xs">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-rose-50 border border-rose-100 text-rose-700 flex items-center justify-center font-bold text-lg">
                  {donorProfile.bloodGroup}
                </div>
                <div className="space-y-0.5">
                  <h3 className="text-sm font-bold text-slate-900">{donorProfile.fullName}</h3>
                  <p className="text-xs text-slate-500">{donorProfile.upazila}, {donorProfile.district}</p>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-3 text-xs">
                <div>
                  <span className="text-slate-500 block mb-1">Calculated Availability:</span>
                  {currentCalc && (
                    <StatusBadge status={currentCalc.calculatedAvailability} type="availability" />
                  )}
                  {currentCalc?.reason && (
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      {currentCalc.reason}
                    </p>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <span className="text-slate-500 block mb-1">Admin Approval:</span>
                  <StatusBadge status={donorProfile.approvalStatus} type="approval" />
                  {donorProfile.rejectionReason && (
                    <p className="text-[11px] text-rose-600 mt-1">{donorProfile.rejectionReason}</p>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <span className="text-slate-500 block mb-1">Contact Verification:</span>
                  <StatusBadge status={donorProfile.contactVerificationStatus} type="verification" />
                </div>
              </div>
            </div>

            {/* Email Verification Box */}
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 space-y-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <Mail className="w-4 h-4 text-rose-600" />
                <span>Email Verification</span>
              </div>
              <p className="text-slate-600 leading-relaxed text-[11px]">
                {user.emailVerified
                  ? 'Your email address has been verified successfully.'
                  : 'Your email address is unverified. Verification is mandatory before your profile can appear in public searches.'}
              </p>
              {!user.emailVerified && (
                <button
                  onClick={handleResendVerification}
                  disabled={resendingEmail}
                  className="w-full py-2 px-3 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{resendingEmail ? 'Sending...' : 'Resend Verification Email'}</span>
                </button>
              )}
              {emailNotice && (
                <p className="text-[11px] text-slate-700 italic">{emailNotice}</p>
              )}
            </div>

            {/* Phone Verification Status Info */}
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <Phone className="w-4 h-4 text-slate-500" />
                <span>Phone Verification Status</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Registered phone: <span className="font-semibold text-slate-800">{formatBangladeshPhone(donorProfile.phone)}</span>.
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                SMS OTP verification is available when external provider credentials are tied to the environment. Primary contact verification is fulfilled via verified email and admin review.
              </p>
            </div>
          </div>

          {/* Right Column: Editable Profile Preferences */}
          <div className={`md:col-span-2 space-y-6 ${profileMobileTab === 'status' ? 'hidden md:block' : ''}`}>
            <form onSubmit={handleSavePreferences} className={`${profileMobileTab === 'privacy' ? 'hidden md:block' : ''} bg-white rounded-xl border border-slate-200 shadow-2xs p-6 space-y-6`}>
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 border-b border-slate-100 pb-2">
                Availability &amp; Privacy Settings
              </h2>

              {/* Declared Availability Toggle */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-800">
                  Voluntary Availability Toggle
                </label>
                <p className="text-xs text-slate-500">
                  If you are traveling, busy, or unwell, switch your status to "Unavailable". The system will honor your choice and keep your profile hidden until you choose to switch back.
                </p>
                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setDeclaredAvailability('available')}
                    className={`flex-1 py-2.5 px-4 text-xs font-semibold rounded-lg border transition-all ${
                      declaredAvailability === 'available'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-500'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Available to Donate
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeclaredAvailability('unavailable')}
                    className={`flex-1 py-2.5 px-4 text-xs font-semibold rounded-lg border transition-all ${
                      declaredAvailability === 'unavailable'
                        ? 'border-rose-500 bg-rose-50 text-rose-800 ring-1 ring-rose-500'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Temporarily Unavailable
                  </button>
                </div>
              </div>

              {/* Last Donation Date */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <label className="block text-xs font-semibold text-slate-800">
                  Last Blood Donation Date
                </label>
                <p className="text-xs text-slate-500">
                  Updating this date will automatically recalculate your next eligibility date based on the platform's {policyInterval}-calendar-month interval.
                </p>
                <input
                  type="date"
                  value={lastDonationDate}
                  onChange={(e) => setLastDonationDate(e.target.value)}
                  className="w-full sm:w-1/2 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
                />
              </div>

              {/* Contact Visibility */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <label className="block text-xs font-semibold text-slate-800">
                  Phone Visibility in Search Results
                </label>
                <select
                  value={contactVisibility}
                  onChange={(e) => setContactVisibility(e.target.value as any)}
                  className="w-full sm:w-2/3 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
                >
                  <option value="public">Public (Show phone number to anyone searching)</option>
                  <option value="registered_only">Show only to registered platform users</option>
                  <option value="hidden">Hide phone number (Shielded)</option>
                </select>
              </div>

              {/* Preferred Contact Method */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <label className="block text-xs font-semibold text-slate-800">
                  Preferred Contact Method
                </label>
                <select
                  value={preferredContact}
                  onChange={(e) => setPreferredContact(e.target.value as any)}
                  className="w-full sm:w-2/3 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white"
                >
                  <option value="phone">Direct Phone Call</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                </select>
              </div>

              {/* Save Button */}
              <div className="pt-4 border-t border-slate-100 flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'Saving Changes...' : 'Save Preferences'}</span>
                </button>
              </div>
            </form>

            {/* Danger Zone: Right to be Forgotten / Remove Donor Record */}
            <div className={`${profileMobileTab === 'preferences' ? 'hidden md:block' : ''} bg-rose-50/60 rounded-xl border border-rose-200 p-5 space-y-3`}>
              <div className="flex items-center gap-2 text-rose-800">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <h4 className="text-xs font-bold uppercase tracking-wider">Privacy &amp; Data Management (Right to be Forgotten)</h4>
              </div>
              <p className="text-xs text-rose-700 leading-relaxed">
                If you no longer wish to be listed as a voluntary blood donor in Bangladesh, you can permanently delete your donor registration. This atomically deletes your donor record and unlinks your registered phone number from our lookup index.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteConfirmationText('');
                    setShowDeleteModal(true);
                  }}
                  className="px-4 py-2.5 text-xs font-bold text-rose-700 bg-white border border-rose-300 hover:bg-rose-100 rounded-lg shadow-2xs transition-colors flex items-center gap-2 min-h-[44px]"
                >
                  <Trash2 className="w-4 h-4 text-rose-600" />
                  <span>Delete Donor Registration</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-slate-100 text-slate-600 flex items-center justify-center">
            <User className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900">No Donor Profile Linked Yet</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            You are signed in as <span className="font-semibold text-slate-700">{user.email}</span>, but you have not yet registered as a blood donor.
          </p>
          <button
            onClick={() => onNavigate('register')}
            className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors"
          >
            Register as a Donor
          </button>
        </div>
      )}

      {/* Self Delete Confirmation Modal */}
      {showDeleteModal && donorProfile && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 shadow-xl border border-slate-200 animate-in fade-in zoom-in duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Delete Donor Registration?</h3>
                  <p className="text-xs text-slate-500">This action is immediate and cannot be undone.</p>
                </div>
              </div>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-rose-50 rounded-xl p-3.5 border border-rose-100 text-xs text-rose-800 space-y-2">
              <p className="font-semibold">What will be deleted:</p>
              <ul className="list-disc pl-4 space-y-1 text-rose-700">
                <li>Your blood donor listing ({donorProfile.bloodGroup}, {donorProfile.district})</li>
                <li>Your phone registration ({donorProfile.phone}) from the duplicate prevention index</li>
                <li>All donation eligibility calculations and verification records</li>
              </ul>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Type <span className="font-mono text-rose-700 font-bold">DELETE</span> to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirmationText}
                onChange={(e) => setDeleteConfirmationText(e.target.value)}
                placeholder="DELETE"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteDonorProfile}
                disabled={deleteConfirmationText !== 'DELETE' || deleting}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deleting ? 'Deleting...' : 'Permanently Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

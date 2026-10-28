import React, { useState, useEffect } from 'react';
import { X, Droplet, MapPin, Calendar, Phone, Mail, MessageSquare, ShieldCheck, AlertCircle, Share2, Check, Lock, LogIn, ShieldAlert } from 'lucide-react';
import { Donor } from '../../types';
import { StatusBadge } from '../common/StatusBadge';
import { formatBangladeshDateOnly, formatBangladeshPhone } from '../../utils/availability';
import { useAuth } from '../../context/AuthContext';
import { fetchDonorContact } from '../../services/dataSyncService';
import { db } from '../../services/firebase';

interface DonorProfileModalProps {
  donor: Donor | null;
  onClose: () => void;
  onNavigate?: (page: string) => void;
}

export const DonorProfileModal: React.FC<DonorProfileModalProps> = ({ donor, onClose, onNavigate }) => {
  const { user } = useAuth();
  const [copiedShare, setCopiedShare] = useState(false);
  const [contactData, setContactData] = useState<{ phone: string; email: string } | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const [contactPermissionDenied, setContactPermissionDenied] = useState(false);

  useEffect(() => {
    if (!donor || !user) {
      setContactData(null);
      setContactPermissionDenied(false);
      return;
    }

    let isMounted = true;
    setContactLoading(true);
    setContactPermissionDenied(false);

    fetchDonorContact(db, donor.id)
      .then((data) => {
        if (isMounted) {
          setContactData(data);
          setContactLoading(false);
        }
      })
      .catch((err: any) => {
        if (isMounted) {
          if (err.code === 'permission-denied') {
            setContactPermissionDenied(true);
          }
          setContactLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [donor?.id, user]);

  if (!donor) return null;

  const isAuthenticated = Boolean(user);
  const canShowContact = donor.publicContactConsent && donor.contactVisibilityPreference !== 'hidden';
  const canShowDonationDate = donor.publicProfileConsent && Boolean(donor.lastDonationDate);
  const resolvedPhone = contactData?.phone || donor.phone;

  const handleShare = async () => {
    const phoneDisplay = isAuthenticated && !contactPermissionDenied && resolvedPhone
      ? formatBangladeshPhone(resolvedPhone)
      : 'Protected (Sign in to view number)';

    const text = `🩸 Voluntary Blood Donor (${donor.bloodGroup})
Name: ${donor.fullName}
Location: ${donor.upazila}, ${donor.district} (${donor.division} Div.)
Phone: ${phoneDisplay}
Availability: ${donor.calculatedAvailability.toUpperCase()}
Verified on Blood Group Finder Bangladesh`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Blood Donor ${donor.bloodGroup} - ${donor.fullName}`,
          text: text,
          url: window.location.href,
        });
        return;
      } catch (err) {
        // Fallback to clipboard if user dismissed or share failed
      }
    }

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2500);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl max-w-lg w-full max-h-[92vh] sm:max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 animate-in slide-in-from-bottom-4 sm:fade-in duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="donor-modal-title"
      >
        {/* Mobile Pull Bar */}
        <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mt-2.5 sm:hidden shrink-0" />

        {/* Header bar */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center font-bold text-sm shrink-0">
              {donor.bloodGroup}
            </div>
            <div>
              <h3 id="donor-modal-title" className="text-sm sm:text-base font-semibold text-slate-900 leading-tight">
                {donor.fullName}
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500">
                {donor.upazila}, {donor.district}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content body */}
        <div className="p-4 sm:p-6 space-y-5 sm:space-y-6 overflow-y-auto flex-1">
          {/* Availability and Verification Status row */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs">
            <div>
              <span className="text-slate-500 block mb-1">Availability</span>
              <StatusBadge status={donor.calculatedAvailability} type="availability" />
            </div>
            <div>
              <span className="text-slate-500 block mb-1">Admin Verification</span>
              <StatusBadge status={donor.approvalStatus} type="approval" />
            </div>
          </div>

          {/* Demographics & Preferences */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs">
            <div>
              <span className="text-slate-500 block text-[11px]">Gender</span>
              <span className="font-semibold text-slate-800 capitalize">
                {donor.gender && donor.gender !== 'unspecified' ? donor.gender : 'Unspecified'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Preferred Contact</span>
              <span className="font-semibold text-slate-800 capitalize">
                {donor.preferredContactMethod || 'Phone Call'}
              </span>
            </div>
            {donor.dateOfBirth && (
              <div>
                <span className="text-slate-500 block text-[11px]">Date of Birth</span>
                <span className="font-semibold text-slate-800 tabular-nums">
                  {formatBangladeshDateOnly(donor.dateOfBirth)}
                </span>
              </div>
            )}
          </div>

          {/* Location details */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Location in Bangladesh</h4>
            <div className="flex items-start gap-2.5 text-sm text-slate-800">
              <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-slate-900">{donor.upazila}, {donor.district}</p>
                <p className="text-xs text-slate-500">{donor.division} Division, Bangladesh</p>
              </div>
            </div>
          </div>

          {/* Donation History */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Donation History</h4>
            <div className="flex items-center gap-2.5 text-xs text-slate-700">
              <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
              {canShowDonationDate ? (
                <div>
                  <span className="text-slate-500">Last donated on: </span>
                  <span className="font-semibold text-slate-900">{formatBangladeshDateOnly(donor.lastDonationDate)}</span>
                  {donor.eligibilityDate && (
                    <span className="block text-[11px] text-slate-500">
                      Calculated next eligibility: {formatBangladeshDateOnly(donor.eligibilityDate)}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-slate-500 italic">
                  Donation history kept private per donor consent settings.
                </span>
              )}
            </div>
          </div>

          {/* Additional Notes */}
          {donor.additionalNotes && (
            <div className="space-y-1 p-3 bg-amber-50/50 rounded-lg border border-amber-200/60 text-xs">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">Donor Notes & Comments</h4>
              <p className="text-slate-700 leading-relaxed">{donor.additionalNotes}</p>
            </div>
          )}

          {/* Contact Section */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Direct Contact Options</h4>
              {!isAuthenticated && (
                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  <span>Sign In Required</span>
                </span>
              )}
            </div>

            {!isAuthenticated ? (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3.5">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-lg bg-rose-100 text-rose-700 shrink-0 mt-0.5">
                    <Lock className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-900">Phone Number Shielded</p>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      To safeguard voluntary blood donors from spam and unverified callers, direct mobile numbers and WhatsApp links are only visible to authenticated members.
                    </p>
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-slate-200 p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 text-slate-400">
                    <Phone className="w-4 h-4" />
                    <span className="font-mono text-xs sm:text-sm tracking-widest font-semibold text-slate-500">
                      01********* (Hidden)
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                    Sign in to unlock
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      if (onNavigate) {
                        onNavigate('signin');
                      } else {
                        window.location.hash = '#/signin';
                      }
                    }}
                    className="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 shadow-2xs transition-colors min-h-[44px]"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>Sign In to View Phone Number</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      if (onNavigate) {
                        onNavigate('register');
                      } else {
                        window.location.hash = '#/register';
                      }
                    }}
                    className="py-2.5 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold flex items-center justify-center transition-colors min-h-[44px]"
                  >
                    <span>Register</span>
                  </button>
                </div>
              </div>
            ) : contactLoading ? (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center gap-2 text-xs text-slate-500 min-h-[70px]">
                <div className="w-4 h-4 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
                <span>Verifying donor contact authorization...</span>
              </div>
            ) : contactPermissionDenied ? (
              <div className="p-4 bg-amber-50/90 border border-amber-200 rounded-xl space-y-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-amber-100 rounded-lg text-amber-800 shrink-0 mt-0.5">
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-amber-950">Approved Donor Membership Required</p>
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      To protect voluntary donors from spam and unsolicited calls, direct phone numbers are reserved for registered, approved donors and verified staff.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    if (onNavigate) {
                      onNavigate('register');
                    } else {
                      window.location.hash = '#/register';
                    }
                  }}
                  className="w-full py-2.5 px-3 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-2xs transition-colors min-h-[42px]"
                >
                  <span>Complete Donor Registration to Unlock</span>
                </button>
              </div>
            ) : canShowContact && resolvedPhone ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white shadow-2xs">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-rose-50 text-rose-600">
                      <Phone className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Phone Number (Verified)</p>
                      <p className="text-sm font-semibold tabular-nums text-slate-900">
                        {formatBangladeshPhone(resolvedPhone)}
                      </p>
                    </div>
                  </div>
                  <a
                    href={`tel:${resolvedPhone}`}
                    className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-lg transition-colors min-h-[44px] flex items-center justify-center shadow-2xs"
                  >
                    Call Now
                  </a>
                </div>

                {resolvedPhone && (
                  <a
                    href={`https://wa.me/88${resolvedPhone.replace(/^0/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 rounded-lg border border-emerald-200 transition-colors min-h-[44px]"
                  >
                    <MessageSquare className="w-4 h-4 text-emerald-600" />
                    <span>Chat on WhatsApp</span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={handleShare}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 rounded-lg transition-colors min-h-[44px]"
                >
                  {copiedShare ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span className="text-emerald-700 font-bold">Donor Details Copied!</span>
                    </>
                  ) : (
                    <>
                      <Share2 className="w-4 h-4 text-slate-600" />
                      <span>Share Donor Details</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-lg text-xs text-amber-800">
                <p className="font-medium">Direct contact details are currently private.</p>
                <p className="text-[11px] text-amber-700 mt-1">
                  This donor has requested that personal contact details remain shielded to prevent spam. Please coordinate via community coordinators or registered healthcare channels.
                </p>
              </div>
            )}
          </div>

          {/* Medical Notice */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-600 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-slate-800">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>Safety & Clinical Eligibility Notice</span>
            </div>
            <p className="leading-relaxed">
              Availability calculation on this platform reflects the 3-calendar-month donation waiting policy. It does NOT guarantee clinical eligibility. The recipient and hospital must perform medical screening, hemoglobin checks, and blood cross-matching prior to donation.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

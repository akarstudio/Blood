import React, { useState } from 'react';
import { X, Droplet, MapPin, Calendar, Phone, Mail, MessageSquare, ShieldCheck, AlertCircle, Share2, Check } from 'lucide-react';
import { Donor } from '../../types';
import { StatusBadge } from '../common/StatusBadge';
import { formatBangladeshDateOnly, formatBangladeshPhone } from '../../utils/availability';

interface DonorProfileModalProps {
  donor: Donor | null;
  onClose: () => void;
}

export const DonorProfileModal: React.FC<DonorProfileModalProps> = ({ donor, onClose }) => {
  if (!donor) return null;

  const canShowContact = donor.publicContactConsent && donor.contactVisibilityPreference !== 'hidden';
  const canShowDonationDate = donor.publicProfileConsent && Boolean(donor.lastDonationDate);
  const [copiedShare, setCopiedShare] = useState(false);

  const handleShare = async () => {
    const text = `🩸 Voluntary Blood Donor (${donor.bloodGroup})
Name: ${donor.fullName}
Location: ${donor.upazila}, ${donor.district} (${donor.division} Div.)
Phone: ${donor.phone ? formatBangladeshPhone(donor.phone) : 'Shielded'}
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

          {/* Contact Section */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Direct Contact Options</h4>
            {canShowContact ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-white">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-rose-50 text-rose-600">
                      <Phone className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Phone Number</p>
                      <p className="text-sm font-semibold tabular-nums text-slate-900">
                        {formatBangladeshPhone(donor.phone)}
                      </p>
                    </div>
                  </div>
                  <a
                    href={`tel:${donor.phone}`}
                    className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-lg transition-colors min-h-[44px] flex items-center justify-center shadow-2xs"
                  >
                    Call Now
                  </a>
                </div>

                {donor.phone && (
                  <a
                    href={`https://wa.me/88${donor.phone.replace(/^0/, '')}`}
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

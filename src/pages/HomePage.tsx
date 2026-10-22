import React, { useEffect, useState } from 'react';
import { 
  Droplet, 
  Search, 
  UserPlus, 
  ShieldCheck, 
  Clock, 
  MapPin, 
  CheckCircle2, 
  ArrowRight, 
  Heart,
  Users
} from 'lucide-react';
import { ALL_BLOOD_GROUPS, BloodGroup } from '../types';
import { BANGLADESH_DIVISIONS, getDistrictsForDivision } from '../data/bangladeshGeo';
import { collection, query, where, getCountFromServer } from 'firebase/firestore';
import { db } from '../services/firebase';

interface HomePageProps {
  onNavigate: (page: string, params?: Record<string, string>) => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onNavigate }) => {
  const [selectedDivision, setSelectedDivision] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [selectedBloodGroup, setSelectedBloodGroup] = useState<BloodGroup | ''>('');
  
  // Real database metrics (only real queries, no fake stats)
  const [realMetrics, setRealMetrics] = useState<{
    approvedCount: number | null;
    availableCount: number | null;
  }>({
    approvedCount: null,
    availableCount: null,
  });

  useEffect(() => {
    async function fetchRealStats() {
      try {
        const approvedQ = query(
          collection(db, 'donors'),
          where('approvalStatus', '==', 'approved'),
          where('contactVerificationStatus', '==', 'verified'),
          where('accountStatus', '==', 'active')
        );
        const availableQ = query(
          collection(db, 'donors'),
          where('approvalStatus', '==', 'approved'),
          where('contactVerificationStatus', '==', 'verified'),
          where('accountStatus', '==', 'active'),
          where('calculatedAvailability', '==', 'available')
        );
        const [appSnap, availSnap] = await Promise.all([
          getCountFromServer(approvedQ),
          getCountFromServer(availableQ),
        ]);
        setRealMetrics({
          approvedCount: appSnap.data().count,
          availableCount: availSnap.data().count,
        });
      } catch (e) {
        // Fallback: omit statistics rather than displaying fabricated numbers
        setRealMetrics({ approvedCount: null, availableCount: null });
      }
    }
    fetchRealStats();
  }, []);

  const handleQuickSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params: Record<string, string> = {};
    if (selectedBloodGroup) params.bloodGroup = selectedBloodGroup;
    if (selectedDivision) params.division = selectedDivision;
    if (selectedDistrict) params.district = selectedDistrict;
    onNavigate('find-donors', params);
  };

  const districts = selectedDivision ? getDistrictsForDivision(selectedDivision) : [];

  return (
    <div className="space-y-16 pb-16">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-b from-rose-50/60 via-white to-white border-b border-slate-200/80 pt-12 pb-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left Content */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-rose-700 bg-rose-50 px-3 py-1 rounded-md border border-rose-200/80">
                <Droplet className="w-3.5 h-3.5 fill-current" />
                <span>Voluntary Blood Donor Network in Bangladesh</span>
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 text-balance leading-tight">
                Find verified blood donors across Bangladesh when every minute counts.
              </h1>

              <p className="text-base text-slate-600 leading-relaxed max-w-2xl">
                A secure, non-profit community directory enabling patients and families to connect directly with voluntary, uncompensated blood donors across all 8 divisions and 64 districts.
              </p>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-4 pt-2">
                <button
                  onClick={() => onNavigate('find-donors')}
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm hover:shadow transition-all"
                >
                  <Search className="w-4 h-4" />
                  <span>Find Blood Donors</span>
                </button>
                <button
                  onClick={() => onNavigate('register')}
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-all"
                >
                  <UserPlus className="w-4 h-4 text-rose-600" />
                  <span>Register as a Donor</span>
                </button>
              </div>

              {/* Verified policy trust badges */}
              <div className="pt-4 flex flex-wrap items-center gap-6 text-xs text-slate-500">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Admin-approved profiles only</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-slate-500" />
                  <span>3-month calendar waiting interval</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-slate-500" />
                  <span>Privacy-controlled contact details</span>
                </div>
              </div>
            </div>

            {/* Right Hero Image Card */}
            <div className="lg:col-span-5">
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 shadow-md bg-white">
                <img
                  src="/src/assets/images/hero_blood_donation_1792468900689.jpg"
                  alt="Blood donation center in Dhaka, Bangladesh"
                  className="w-full h-80 object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="p-4 bg-white/95 backdrop-blur-xs border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-rose-600" />
                    <span>Serving all 8 Divisions of Bangladesh</span>
                  </div>
                  <span className="text-slate-400">Dhaka Standard Time</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Location & Blood Group Filter Box */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8">
        <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-4 flex items-center gap-2">
            <Search className="w-4 h-4 text-rose-600" />
            Quick Donor Search
          </h2>
          <form onSubmit={handleQuickSearch} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Blood Group</label>
              <select
                value={selectedBloodGroup}
                onChange={(e) => setSelectedBloodGroup(e.target.value as BloodGroup)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden bg-white text-slate-800"
              >
                <option value="">Any Blood Group</option>
                {ALL_BLOOD_GROUPS.map((bg) => (
                  <option key={bg} value={bg}>
                    {bg}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Division</label>
              <select
                value={selectedDivision}
                onChange={(e) => {
                  setSelectedDivision(e.target.value);
                  setSelectedDistrict('');
                }}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden bg-white text-slate-800"
              >
                <option value="">All Divisions</option>
                {BANGLADESH_DIVISIONS.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">District</label>
              <select
                value={selectedDistrict}
                onChange={(e) => setSelectedDistrict(e.target.value)}
                disabled={!selectedDivision}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden bg-white text-slate-800 disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">All Districts</option>
                {districts.map((dst) => (
                  <option key={dst.name} value={dst.name}>
                    {dst.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <button
                type="submit"
                className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-sm rounded-lg shadow-xs transition-colors flex items-center justify-center gap-2"
              >
                <Search className="w-4 h-4" />
                Search Donors
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Select by Blood Group Cards */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Explore by Blood Group</h2>
            <p className="text-xs text-slate-500 mt-1">
              Select your required ABO and Rh blood type to quickly filter eligible donors.
            </p>
          </div>
          <button
            onClick={() => onNavigate('find-donors')}
            className="text-xs font-semibold text-rose-700 hover:text-rose-800 flex items-center gap-1 self-start sm:self-auto"
          >
            <span>View All Blood Groups</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {ALL_BLOOD_GROUPS.map((group) => (
            <button
              key={group}
              onClick={() => onNavigate('find-donors', { bloodGroup: group })}
              className="p-4 rounded-xl border border-slate-200 bg-white hover:border-rose-300 hover:shadow-md transition-all text-center group focus:outline-hidden focus:ring-2 focus:ring-rose-500"
            >
              <div className="w-10 h-10 mx-auto rounded-lg bg-rose-50 border border-rose-100 text-rose-600 group-hover:bg-rose-600 group-hover:text-white transition-colors flex items-center justify-center font-bold text-base mb-2">
                {group}
              </div>
              <span className="text-xs font-semibold text-slate-700 block">Blood Group</span>
              <span className="text-[11px] text-slate-400">Click to filter</span>
            </button>
          ))}
        </div>
      </section>

      {/* How the platform works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200/80">
          <div className="text-center max-w-xl mx-auto mb-10">
            <h2 className="text-xl font-bold text-slate-900">How Blood Group Finder Works</h2>
            <p className="text-xs text-slate-500 mt-1">
              Engineered to make finding voluntary donors in Bangladesh transparent, safe, and reliable.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-3">
              <div className="w-10 h-10 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center font-bold text-base">
                01
              </div>
              <h3 className="text-sm font-bold text-slate-900">Search by Group & Location</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Filter donors by division, district, and upazila across Bangladesh. Our system guarantees you only see approved and active profiles.
              </p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-3">
              <div className="w-10 h-10 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center font-bold text-base">
                02
              </div>
              <h3 className="text-sm font-bold text-slate-900">Automated 3-Month Waiting Interval</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Availability is calculated using our central calendar-month policy in Asia/Dhaka time. Donors who donated recently are automatically shielded.
              </p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-3">
              <div className="w-10 h-10 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center font-bold text-base">
                03
              </div>
              <h3 className="text-sm font-bold text-slate-900">Safe Direct Contact</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Connect via phone or WhatsApp if the donor has given consent. Personal data is never sold, and unverified accounts remain invisible.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Dual Story Section: Awareness & Community Volunteer */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
          {/* Awareness Card */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col justify-between shadow-2xs">
            <img
              src="/src/assets/images/awareness_blood_care_1792468899762.jpg"
              alt="Clinical laboratory testing for blood transfusion safety"
              className="w-full h-48 object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="p-6 space-y-3 flex-1 flex flex-col justify-between">
              <div className="space-y-2">
                <span className="text-[11px] font-semibold text-rose-700 uppercase tracking-wider">Clinical Standards</span>
                <h3 className="text-base font-bold text-slate-900">
                  Donor Health & Waiting Intervals
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  In Bangladesh, maintaining a strict 3-calendar-month resting interval protects donor hemoglobin and erythrocyte levels. Our platform enforces this calculation so donors are never pressured to donate ahead of schedule.
                </p>
              </div>
              <button
                onClick={() => onNavigate('about')}
                className="text-xs font-semibold text-rose-700 hover:text-rose-800 flex items-center gap-1 pt-3 border-t border-slate-100"
              >
                <span>Read Medical Criteria</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Volunteer / Community Callout */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col justify-between shadow-2xs">
            <div className="p-6 flex items-start gap-4">
              <img
                src="/src/assets/images/community_volunteer_bd_1792468900535.jpg"
                alt="Community Blood Donor Volunteer in Bangladesh"
                className="w-20 h-20 rounded-xl object-cover shrink-0 border border-slate-200"
                referrerPolicy="no-referrer"
              />
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Join Our Mission</span>
                <h3 className="text-base font-bold text-slate-900">Become a Regular Voluntary Donor</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Thousands of patients in hospitals across Dhaka, Chattogram, Sylhet, and every district need voluntary blood. Your single donation can save up to three lives.
                </p>
              </div>
            </div>

            <div className="p-6 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">Takes less than 2 minutes</span>
              <button
                onClick={() => onNavigate('register')}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors"
              >
                Register Now
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Safety & Medical Notice Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-amber-50/70 border border-amber-200/90 rounded-xl p-6 flex flex-col sm:flex-row items-start gap-4">
          <div className="p-2.5 rounded-lg bg-amber-100 text-amber-800 shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div className="space-y-1 text-xs text-amber-900">
            <h4 className="font-bold text-sm">Transparency & Medical Safety Protocol</h4>
            <p className="leading-relaxed">
              Blood Group Finder Bangladesh operates strictly as a discovery intermediary. We never charge money, take fees, or facilitate commercial blood selling (which is illegal under the Blood Transfusion Act of Bangladesh). Hospital screening, hepatitis/HIV cross-matching, and doctor oversight are mandatory before any transfusion.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

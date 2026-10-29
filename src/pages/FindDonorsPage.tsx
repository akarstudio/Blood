import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Search, 
  Filter, 
  RotateCcw, 
  MapPin, 
  Droplet, 
  Phone, 
  ShieldCheck, 
  Calendar,
  AlertCircle,
  Eye,
  CheckCircle2,
  Users,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  Lock,
  LogIn,
  UserPlus
} from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  limit, 
  getDocs, 
  doc, 
  getDoc 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../services/firebase';
import { Donor, BloodGroup, ALL_BLOOD_GROUPS, AvailabilityPolicy } from '../types';
import { BANGLADESH_DIVISIONS, getDistrictsForDivision, getUpazilasForDistrict } from '../data/bangladeshGeo';
import { StatusBadge } from '../components/common/StatusBadge';
import { Pagination } from '../components/common/Pagination';
import { DonorProfileModal } from '../components/donor/DonorProfileModal';
import { ManualDonorModal } from '../components/donor/ManualDonorModal';
import { calculateDonorAvailability, formatBangladeshDateOnly, formatBangladeshPhone } from '../utils/availability';
import { useAuth } from '../context/AuthContext';

interface FindDonorsPageProps {
  initialFilters?: {
    bloodGroup?: string;
    division?: string;
    district?: string;
  };
  onNavigate: (page: string) => void;
}

export const FindDonorsPage: React.FC<FindDonorsPageProps> = ({ initialFilters, onNavigate }) => {
  const { user, canRegisterDonor } = useAuth();
  const isAuthenticated = Boolean(user);
  const [manualRegisterOpen, setManualRegisterOpen] = useState(false);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const [bloodGroup, setBloodGroup] = useState<string>(initialFilters?.bloodGroup || '');
  const [division, setDivision] = useState<string>(initialFilters?.division || '');
  const [district, setDistrict] = useState<string>(initialFilters?.district || '');
  const [upazila, setUpazila] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [availabilityFilter, setAvailabilityFilter] = useState<'available_only' | 'all'>('available_only');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const bloodGroupContainerRef = useRef<HTMLDivElement>(null);
  const bloodGroupRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (bloodGroup && bloodGroupRefs.current[bloodGroup]) {
      bloodGroupRefs.current[bloodGroup]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [bloodGroup]);

  const [rawDonors, setRawDonors] = useState<Donor[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDonor, setSelectedDonor] = useState<Donor | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 8;

  // System availability policy
  const [minimumIntervalMonths, setMinimumIntervalMonths] = useState<number>(3);

  // Fetch policy once
  useEffect(() => {
    async function loadPolicy() {
      try {
        const snap = await getDoc(doc(db, 'systemSettings', 'availabilityPolicy'));
        if (snap.exists()) {
          const pol = snap.data() as AvailabilityPolicy;
          if (pol.minimumIntervalMonths) {
            setMinimumIntervalMonths(pol.minimumIntervalMonths);
          }
        }
      } catch (e) {
        console.warn('Using default 3-month availability interval');
      }
    }
    loadPolicy();
  }, []);

  // Authoritative Firestore Query: Fetches donors using compound indices
  const fetchDonorsFromFirestore = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let snapshot;
      try {
        const constraints: any[] = [
          where('approvalStatus', '==', 'approved'),
          where('contactVerificationStatus', '==', 'verified'),
          where('accountStatus', '==', 'active')
        ];

        if (bloodGroup) {
          constraints.push(where('bloodGroup', '==', bloodGroup));
        }

        constraints.push(limit(500));
        const q = query(collection(db, 'donors'), ...constraints);
        snapshot = await getDocs(q);
      } catch (compoundErr) {
        console.warn('Using resilient index fallback for donor search:', compoundErr);
        const fallbackQ = query(
          collection(db, 'donors'),
          where('approvalStatus', '==', 'approved'),
          where('contactVerificationStatus', '==', 'verified'),
          where('accountStatus', '==', 'active'),
          limit(500)
        );
        snapshot = await getDocs(fallbackQ);
      }

      const list: Donor[] = [];
      snapshot.forEach((d) => {
        const data = d.data() as Donor;
        if (bloodGroup && data.bloodGroup !== bloodGroup) {
          return;
        }
        list.push({ ...data, id: d.id });
      });

      setRawDonors(list);
    } catch (err: any) {
      console.error('Error fetching donors from Firestore:', err);
      setError('Unable to load donor records. Please verify search parameters or network connection.');
    } finally {
      setLoading(false);
    }
  }, [bloodGroup]);

  useEffect(() => {
    fetchDonorsFromFirestore();
  }, [fetchDonorsFromFirestore]);

  // High-performance instant in-memory query evaluation (0ms search latency)
  const filteredDonors = useMemo(() => {
    const cleanSearch = searchQuery.trim().toLowerCase();
    const normDiv = division.trim().toLowerCase();
    const normDist = district.trim().toLowerCase();
    const normUpz = upazila.trim().toLowerCase();

    const list: Donor[] = [];

    for (const data of rawDonors) {
      // 1. Geographical matching
      if (normDiv && data.division?.trim().toLowerCase() !== normDiv) continue;
      if (normDist && data.district?.trim().toLowerCase() !== normDist) continue;
      if (normUpz && data.upazila?.trim().toLowerCase() !== normUpz) continue;

      // 2. Multi-field keyword query (phone search requires authentication)
      if (cleanSearch) {
        const matchName = data.fullName?.toLowerCase().includes(cleanSearch);
        const matchPhone = isAuthenticated && Boolean(data.phone?.includes(cleanSearch));
        const matchEmail = data.email?.toLowerCase().includes(cleanSearch);
        const matchUpz = data.upazila?.toLowerCase().includes(cleanSearch);
        const matchDist = data.district?.toLowerCase().includes(cleanSearch);
        const matchNotes = data.additionalNotes?.toLowerCase().includes(cleanSearch);
        if (!matchName && !matchPhone && !matchEmail && !matchUpz && !matchDist && !matchNotes) {
          continue;
        }
      }

      // 3. Centralized calculation engine
      const calcResult = calculateDonorAvailability(data, minimumIntervalMonths);
      const recalculatedDonor: Donor = {
        ...data,
        calculatedAvailability: calcResult.calculatedAvailability,
        eligibilityDate: calcResult.eligibilityDate || data.eligibilityDate,
      };

      if (availabilityFilter === 'available_only') {
        if (calcResult.isAvailable) {
          list.push(recalculatedDonor);
        }
      } else {
        list.push(recalculatedDonor);
      }
    }

    return list;
  }, [rawDonors, division, district, upazila, searchQuery, availabilityFilter, minimumIntervalMonths, isAuthenticated]);

  // Reset page to 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [bloodGroup, division, district, upazila, searchQuery, availabilityFilter]);

  const handleClearFilters = () => {
    setBloodGroup('');
    setDivision('');
    setDistrict('');
    setUpazila('');
    setSearchQuery('');
    setAvailabilityFilter('available_only');
  };

  const districts = division ? getDistrictsForDivision(division) : [];
  const upazilas = division && district ? getUpazilasForDistrict(division, district) : [];

  // Client-side window for current page
  const paginatedDonors = filteredDonors.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const totalPages = Math.ceil(filteredDonors.length / pageSize);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8">
      {/* Page Title & Context */}
      <div className="border-b border-slate-200 pb-4 sm:pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Find Blood Donors in Bangladesh
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5 sm:mt-1">
              Search approved voluntary donors. Enforcing the {minimumIntervalMonths}-month calendar waiting interval.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            {canRegisterDonor && (
              <button
                type="button"
                onClick={() => setManualRegisterOpen(true)}
                className="px-4 py-2.5 sm:py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-lg shadow-xs transition-colors text-center min-h-[44px] flex items-center justify-center gap-1.5"
                title="Super Admin, Admin, Donor Manager, or Data Entry Operator manual registration"
              >
                <UserPlus className="w-4 h-4" />
                <span>Manual Donor Entry</span>
              </button>
            )}
            <button
              onClick={() => onNavigate('register')}
              className="px-4 py-2.5 sm:py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-lg shadow-xs transition-colors text-center min-h-[44px] flex items-center justify-center"
            >
              Register as a Donor
            </button>
          </div>
        </div>
      </div>

      {/* Manual Registration Success Banner */}
      {successBanner && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between gap-3 shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="font-semibold">{successBanner}</span>
          </div>
          <button
            onClick={() => setSuccessBanner(null)}
            className="text-emerald-700 hover:text-emerald-900 p-1 font-bold text-sm"
          >
            ✕
          </button>
        </div>
      )}

      {/* Responsive Blood Group Tab Filter (Grid on tablet/desktop, smooth scrolling strip on mobile) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Blood Group Quick Filter
            </span>
            {bloodGroup && (
              <span className="text-[10px] font-bold bg-rose-50 text-rose-700 px-2 py-0.5 rounded-full border border-rose-200">
                Filtered: {bloodGroup}
              </span>
            )}
          </div>
          {bloodGroup && (
            <button
              onClick={() => setBloodGroup('')}
              className="text-[11px] font-semibold text-rose-600 hover:text-rose-800 transition-colors p-1"
            >
              Reset to All
            </button>
          )}
        </div>

        {/* Tab strip: Mobile horizontal scrolling with touch cues, Tablet/Desktop responsive 9-col segmented grid */}
        <div className="relative">
          <div
            ref={bloodGroupContainerRef}
            role="tablist"
            aria-label="Filter donors by blood group"
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-5 md:grid-cols-9 sm:gap-2 py-1"
          >
            <button
              ref={(el) => { bloodGroupRefs.current['ALL'] = el; }}
              role="tab"
              aria-selected={bloodGroup === ''}
              onClick={() => setBloodGroup('')}
              className={`px-3 py-2.5 rounded-xl text-xs font-bold shrink-0 transition-all border min-h-[44px] flex items-center justify-center gap-1.5 focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                bloodGroup === ''
                  ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span>All Groups</span>
            </button>

            {ALL_BLOOD_GROUPS.map((bg) => {
              const isSelected = bloodGroup === bg;
              return (
                <button
                  key={bg}
                  ref={(el) => { bloodGroupRefs.current[bg] = el; }}
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setBloodGroup(isSelected ? '' : bg)}
                  className={`px-3 py-2.5 rounded-xl text-xs font-bold shrink-0 transition-all border min-h-[44px] flex items-center justify-center gap-1.5 focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                    isSelected
                      ? 'bg-rose-600 text-white border-rose-600 shadow-xs ring-2 ring-rose-200'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-rose-300 hover:text-rose-700 hover:bg-rose-50/40'
                  }`}
                >
                  <Droplet className={`w-3.5 h-3.5 ${isSelected ? 'fill-white text-white' : 'text-rose-500'}`} />
                  <span>{bg}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Filter Bar with Mobile Collapsible Accordion */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-rose-600" />
              <span>Location & Availability</span>
            </span>
            {/* Active filters count badge */}
            {(division || district || upazila || availabilityFilter === 'available_only') && (
              <span className="text-[10px] bg-rose-50 text-rose-700 font-semibold px-2 py-0.5 rounded-full border border-rose-100">
                Active
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleClearFilters}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>

            {/* Toggle button on mobile */}
            <button
              onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
              className="md:hidden flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg min-h-[36px]"
              aria-expanded={mobileFiltersOpen}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{mobileFiltersOpen ? 'Hide' : 'Refine'}</span>
              {mobileFiltersOpen ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Filter fields: Always visible on desktop (md), collapsible on mobile */}
        <div className={`space-y-4 ${mobileFiltersOpen ? 'block' : 'hidden md:block'}`}>
          {/* Direct Search Bar */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                isAuthenticated
                  ? "Search donors by name, area, mobile phone, or keywords..."
                  : "Search donors by name, division, district, or area..."
              }
              className="w-full pl-10 pr-9 py-2.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-slate-50/50 hover:bg-white text-slate-900 placeholder:text-slate-400 min-h-[42px] transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-3 text-slate-400 hover:text-slate-700 text-xs font-bold w-4 h-4 flex items-center justify-center rounded-full bg-slate-100"
                aria-label="Clear search text"
              >
                ×
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            {/* Blood group */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Blood Group</label>
              <select
                value={bloodGroup}
                onChange={(e) => setBloodGroup(e.target.value)}
                className="w-full px-3 py-2.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white text-slate-800 min-h-[42px]"
              >
                <option value="">Any Blood Group</option>
                {ALL_BLOOD_GROUPS.map((bg) => (
                  <option key={bg} value={bg}>
                    {bg}
                  </option>
                ))}
              </select>
            </div>

            {/* Division */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Division</label>
              <select
                value={division}
                onChange={(e) => {
                  setDivision(e.target.value);
                  setDistrict('');
                  setUpazila('');
                }}
                className="w-full px-3 py-2.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white text-slate-800 min-h-[42px]"
              >
                <option value="">All Divisions</option>
                {BANGLADESH_DIVISIONS.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {/* District */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">District</label>
              <select
                value={district}
                onChange={(e) => {
                  setDistrict(e.target.value);
                  setUpazila('');
                }}
                disabled={!division}
                className="w-full px-3 py-2.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white text-slate-800 disabled:bg-slate-50 disabled:text-slate-400 min-h-[42px]"
              >
                <option value="">All Districts</option>
                {districts.map((dst) => (
                  <option key={dst.name} value={dst.name}>
                    {dst.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Upazila */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Upazila / Area</label>
              <select
                value={upazila}
                onChange={(e) => setUpazila(e.target.value)}
                disabled={!district}
                className="w-full px-3 py-2.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white text-slate-800 disabled:bg-slate-50 disabled:text-slate-400 min-h-[42px]"
              >
                <option value="">All Upazilas</option>
                {upazilas.map((upz) => (
                  <option key={upz} value={upz}>
                    {upz}
                  </option>
                ))}
              </select>
            </div>

            {/* Availability Status Filter (Segmented responsive tabs) */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Availability Status</label>
              <div role="tablist" aria-label="Availability Status" className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  role="tab"
                  aria-selected={availabilityFilter === 'available_only'}
                  onClick={() => setAvailabilityFilter('available_only')}
                  className={`py-2 px-2 text-[11px] font-semibold rounded-lg transition-all min-h-[42px] flex items-center justify-center text-center gap-1.5 focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                    availabilityFilter === 'available_only'
                      ? 'bg-white text-emerald-800 shadow-2xs font-bold ring-1 ring-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Available Only</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={availabilityFilter === 'all'}
                  onClick={() => setAvailabilityFilter('all')}
                  className={`py-2 px-2 text-[11px] font-semibold rounded-lg transition-all min-h-[42px] flex items-center justify-center text-center gap-1.5 focus:outline-hidden focus:ring-2 focus:ring-rose-500 ${
                    availabilityFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-2xs font-bold ring-1 ring-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Users className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>All Verified</span>
                </button>
              </div>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-slate-100">
            <span className="text-[11px] text-slate-500">
              Only showing contact-verified &amp; active donors
            </span>
            <button
              onClick={() => {
                fetchDonorsFromFirestore();
                setMobileFiltersOpen(false);
              }}
              className="w-full sm:w-auto px-5 py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-2xs min-h-[42px]"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Apply Filters</span>
            </button>
          </div>
        </div>
      </div>

      {/* Privacy Status & Phone Protection Banner */}
      {!isAuthenticated ? (
        <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-2xs">
          <div className="flex items-start gap-3 text-amber-950">
            <div className="p-2 bg-amber-100/90 rounded-lg text-amber-800 shrink-0 mt-0.5">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold block text-sm sm:text-xs text-amber-900">
                Donor Phone Numbers are Protected
              </span>
              <span className="text-amber-800 text-[11px] leading-relaxed">
                Direct phone numbers are shielded to protect voluntary blood donors from spam. Sign in to your free account to view contact numbers and call donors.
              </span>
            </div>
          </div>
          <button
            onClick={() => onNavigate('signin')}
            className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-lg shadow-2xs transition-colors shrink-0 flex items-center justify-center gap-1.5 min-h-[38px]"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In to View Numbers</span>
          </button>
        </div>
      ) : (
        <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl px-4 py-2.5 flex items-center justify-between gap-2 text-xs text-emerald-950 shadow-2xs">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              Signed in as <strong className="text-emerald-900">{user?.email}</strong> &bull; Direct phone numbers and WhatsApp contact are unlocked.
            </span>
          </div>
        </div>
      )}

      {/* Results Header */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <div>
          Found <span className="font-semibold text-slate-900 tabular-nums">{filteredDonors.length}</span> verified donors matching criteria
        </div>
        <div className="text-[11px] text-slate-400">
          Enforcing {minimumIntervalMonths}-month interval
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 bg-slate-200 rounded-lg" />
                <div className="w-16 h-4 bg-slate-200 rounded-sm" />
              </div>
              <div className="space-y-1.5">
                <div className="w-28 h-4 bg-slate-200 rounded-sm" />
                <div className="w-20 h-3 bg-slate-200 rounded-sm" />
              </div>
              <div className="w-full h-8 bg-slate-100 rounded-lg" />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Unable to Complete Search</p>
            <p className="mt-0.5 text-rose-700">{error}</p>
            <button
              onClick={() => fetchDonorsFromFirestore()}
              className="mt-2 font-semibold underline hover:text-rose-900"
            >
              Retry Search
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filteredDonors.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-4 max-w-lg mx-auto">
          <div className="w-12 h-12 mx-auto rounded-full bg-rose-50 text-rose-600 flex items-center justify-center">
            <Droplet className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-900">No Donors Found</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              No donors currently match your selected blood group and location filters. Try broadening your location to the district or division level.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={handleClearFilters}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Reset Filters
            </button>
            <button
              onClick={() => onNavigate('register')}
              className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors"
            >
              Register as Donor
            </button>
          </div>
        </div>
      )}

      {/* Donors Grid */}
      {!loading && !error && paginatedDonors.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {paginatedDonors.map((donor) => {
            const hasPhone = donor.publicContactConsent && donor.contactVisibilityPreference !== 'hidden';
            return (
              <div
                key={donor.id}
                className="bg-white rounded-xl border border-slate-200 hover:border-rose-300 hover:shadow-md transition-all p-5 flex flex-col justify-between space-y-4"
              >
                {/* Top Row: Blood Group & Status */}
                <div className="flex items-start justify-between">
                  <div className="w-11 h-11 rounded-lg bg-rose-50 border border-rose-100 text-rose-700 flex items-center justify-center font-bold text-base shadow-2xs">
                    {donor.bloodGroup}
                  </div>
                  <StatusBadge status={donor.calculatedAvailability} type="availability" size="sm" />
                </div>

                {/* Donor Details */}
                <div className="space-y-1.5 flex-1">
                  <h3 className="text-sm font-bold text-slate-900 truncate" title={donor.fullName}>
                    {donor.fullName}
                  </h3>
                  <div className="flex items-center gap-1.5 text-xs text-slate-600">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{donor.upazila}, {donor.district}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    <span>{donor.division} Division</span>
                  </div>

                  {/* Demographic & Contact Badges */}
                  <div className="flex flex-wrap items-center gap-1 pt-1">
                    {donor.gender && donor.gender !== 'unspecified' && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600 capitalize">
                        {donor.gender}
                      </span>
                    )}
                    {donor.preferredContactMethod && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-50 text-rose-700 capitalize">
                        {donor.preferredContactMethod}
                      </span>
                    )}
                  </div>

                  {donor.lastDonationDate && donor.publicProfileConsent && (
                    <div className="text-[11px] text-slate-500 pt-1 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      <span>Last: {formatBangladeshDateOnly(donor.lastDonationDate)}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center gap-1.5">
                  <button
                    onClick={() => setSelectedDonor(donor)}
                    className="flex-1 py-2 px-2.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 border border-slate-200 rounded-lg transition-colors flex items-center justify-center gap-1.5 min-h-[42px]"
                  >
                    <Eye className="w-4 h-4 text-slate-500" />
                    <span>Profile</span>
                  </button>

                  {isAuthenticated ? (
                    hasPhone ? (
                      <>
                        <a
                          href={`tel:${donor.phone}`}
                          className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 active:bg-rose-200 rounded-lg border border-rose-200 transition-colors flex items-center justify-center gap-1 min-h-[42px] shrink-0"
                          title="Call Donor directly"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          <span>Call</span>
                        </a>
                        <a
                          href={`https://wa.me/88${donor.phone.replace(/^0/, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 rounded-lg border border-emerald-200 transition-colors flex items-center justify-center min-h-[42px] shrink-0"
                          title="WhatsApp Chat"
                        >
                          WA
                        </a>
                      </>
                    ) : null
                  ) : (
                    <button
                      onClick={() => onNavigate('signin')}
                      className="px-2.5 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 active:bg-rose-200 rounded-lg border border-rose-200 transition-colors flex items-center justify-center gap-1 min-h-[42px] shrink-0"
                      title="Sign in to view phone number and call donor directly"
                    >
                      <Lock className="w-3.5 h-3.5 text-rose-600" />
                      <span>Sign In</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && filteredDonors.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredDonors.length}
          pageSize={pageSize}
          onPageChange={(page) => setCurrentPage(page)}
        />
      )}

      {/* Donor Profile Modal */}
      <DonorProfileModal
        donor={selectedDonor}
        onClose={() => setSelectedDonor(null)}
        onNavigate={onNavigate}
      />

      {/* Manual Donor Registration Modal */}
      {manualRegisterOpen && (
        <ManualDonorModal
          isOpen={manualRegisterOpen}
          onClose={() => setManualRegisterOpen(false)}
          defaultDivision={division}
          defaultDistrict={district}
          onSuccess={(newDonor) => {
            setRawDonors((prev) => [newDonor, ...prev.filter((d) => d.id !== newDonor.id)]);
            setSuccessBanner(
              `Donor "${newDonor.fullName}" (${newDonor.bloodGroup}) registered successfully in Firebase! Availability is [${newDonor.calculatedAvailability}].`
            );
          }}
        />
      )}
    </div>
  );
};

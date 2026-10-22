import React, { useState, useEffect, useCallback } from 'react';
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
  Users
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
import { calculateDonorAvailability, formatBangladeshDateOnly, formatBangladeshPhone } from '../utils/availability';

interface FindDonorsPageProps {
  initialFilters?: {
    bloodGroup?: string;
    division?: string;
    district?: string;
  };
  onNavigate: (page: string) => void;
}

export const FindDonorsPage: React.FC<FindDonorsPageProps> = ({ initialFilters, onNavigate }) => {
  const [bloodGroup, setBloodGroup] = useState<string>(initialFilters?.bloodGroup || '');
  const [division, setDivision] = useState<string>(initialFilters?.division || '');
  const [district, setDistrict] = useState<string>(initialFilters?.district || '');
  const [upazila, setUpazila] = useState<string>('');
  const [availabilityFilter, setAvailabilityFilter] = useState<'available_only' | 'all'>('available_only');

  const [donors, setDonors] = useState<Donor[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDonor, setSelectedDonor] = useState<Donor | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 8;
  const [totalCount, setTotalCount] = useState<number>(0);

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

  const searchDonors = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Build secured Firestore query: Only approved, verified, active donors
      const constraints: any[] = [
        where('approvalStatus', '==', 'approved'),
        where('contactVerificationStatus', '==', 'verified'),
        where('accountStatus', '==', 'active')
      ];

      if (bloodGroup) {
        constraints.push(where('bloodGroup', '==', bloodGroup));
      }
      if (division) {
        constraints.push(where('division', '==', division));
      }
      if (district) {
        constraints.push(where('district', '==', district));
      }
      if (upazila) {
        constraints.push(where('upazila', '==', upazila));
      }

      // Safe limit on results to avoid client overload
      constraints.push(limit(50));

      const q = query(collection(db, 'donors'), ...constraints);
      const snapshot = await getDocs(q);

      const loadedDonors: Donor[] = [];
      snapshot.forEach((d) => {
        const data = d.data() as Donor;
        // Calculate authoritative availability using the centralized policy
        const calcResult = calculateDonorAvailability(data, minimumIntervalMonths);
        const recalculatedDonor: Donor = {
          ...data,
          id: d.id,
          calculatedAvailability: calcResult.calculatedAvailability,
          eligibilityDate: calcResult.eligibilityDate || data.eligibilityDate,
        };

        // Filter by availability if requested
        if (availabilityFilter === 'available_only') {
          if (calcResult.isAvailable) {
            loadedDonors.push(recalculatedDonor);
          }
        } else {
          loadedDonors.push(recalculatedDonor);
        }
      });

      setTotalCount(loadedDonors.length);
      setDonors(loadedDonors);
      setCurrentPage(1);
    } catch (err: any) {
      console.error('Error fetching donors:', err);
      setError('Unable to load donor records. Please verify search parameters or network connection.');
    } finally {
      setLoading(false);
    }
  }, [bloodGroup, division, district, upazila, availabilityFilter, minimumIntervalMonths]);

  useEffect(() => {
    searchDonors();
  }, [searchDonors]);

  const handleClearFilters = () => {
    setBloodGroup('');
    setDivision('');
    setDistrict('');
    setUpazila('');
    setAvailabilityFilter('available_only');
  };

  const districts = division ? getDistrictsForDivision(division) : [];
  const upazilas = division && district ? getUpazilasForDistrict(division, district) : [];

  // Client-side window for current page
  const paginatedDonors = donors.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const totalPages = Math.ceil(donors.length / pageSize);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Page Title & Context */}
      <div className="border-b border-slate-200 pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Find Blood Donors in Bangladesh
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Search approved voluntary donors. Profiles adhere to the {minimumIntervalMonths}-month calendar waiting interval.
            </p>
          </div>
          <button
            onClick={() => onNavigate('register')}
            className="self-start sm:self-auto px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors"
          >
            Register as a Donor
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-rose-600" />
            Filter Donors
          </span>
          <button
            onClick={handleClearFilters}
            className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Clear Filters
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          {/* Blood group */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Blood Group</label>
            <select
              value={bloodGroup}
              onChange={(e) => setBloodGroup(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white text-slate-800"
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
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white text-slate-800"
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
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white text-slate-800 disabled:bg-slate-50 disabled:text-slate-400"
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
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white text-slate-800 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">All Upazilas</option>
              {upazilas.map((upz) => (
                <option key={upz} value={upz}>
                  {upz}
                </option>
              ))}
            </select>
          </div>

          {/* Availability Status Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Availability Status</label>
            <select
              value={availabilityFilter}
              onChange={(e) => setAvailabilityFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 bg-white text-slate-800"
            >
              <option value="available_only">Available Donors Only</option>
              <option value="all">All Verified Donors</option>
            </select>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={() => searchDonors()}
            className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs"
          >
            <Search className="w-3.5 h-3.5" />
            Apply Filters
          </button>
        </div>
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <div>
          Found <span className="font-semibold text-slate-900 tabular-nums">{donors.length}</span> verified donors matching criteria
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
              onClick={() => searchDonors()}
              className="mt-2 font-semibold underline hover:text-rose-900"
            >
              Retry Search
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && donors.length === 0 && (
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

                  {donor.lastDonationDate && donor.publicProfileConsent && (
                    <div className="text-[11px] text-slate-500 pt-1 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      <span>Last: {formatBangladeshDateOnly(donor.lastDonationDate)}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                  <button
                    onClick={() => setSelectedDonor(donor)}
                    className="flex-1 py-2 px-3 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Eye className="w-3.5 h-3.5 text-slate-500" />
                    <span>View Profile</span>
                  </button>

                  {hasPhone ? (
                    <a
                      href={`tel:${donor.phone}`}
                      className="p-2 text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200 transition-colors"
                      title="Call Donor"
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && donors.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={donors.length}
          pageSize={pageSize}
          onPageChange={(page) => setCurrentPage(page)}
        />
      )}

      {/* Donor Profile Modal */}
      <DonorProfileModal
        donor={selectedDonor}
        onClose={() => setSelectedDonor(null)}
      />
    </div>
  );
};

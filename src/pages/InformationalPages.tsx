import React from 'react';
import { 
  ShieldCheck, 
  Heart, 
  AlertCircle, 
  Mail, 
  Phone, 
  MapPin, 
  Clock, 
  FileText, 
  Lock,
  ArrowRight
} from 'lucide-react';

interface InfoPageProps {
  page: 'about' | 'contact' | 'privacy' | 'terms';
  onNavigate: (page: string) => void;
}

export const InformationalPages: React.FC<InfoPageProps> = ({ page, onNavigate }) => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-12">
      {/* 1. ABOUT PAGE */}
      {page === 'about' && (
        <div className="space-y-8">
          <div className="border-b border-slate-200 pb-5">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-700">Mission & Medical Guidelines</span>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 mt-1">
              About Blood Group Finder Bangladesh
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              Empowering voluntary, uncompensated blood donor discovery across all 64 districts of Bangladesh.
            </p>
          </div>

          <div className="prose prose-slate max-w-none text-xs sm:text-sm text-slate-700 space-y-6 leading-relaxed">
            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900">1. Our Non-Profit Purpose</h2>
              <p>
                In Bangladesh, finding safe, matching blood during surgical emergencies, thalassemia treatments, or postpartum hemorrhage remains one of the greatest hurdles for patients' families. Blood Group Finder Bangladesh provides a community registry connecting voluntary donors with those in legitimate medical need.
              </p>
              <p>
                We operate under strict zero-commercial principles: blood donation must be 100% voluntary and altruistic. Commercial blood selling or brokering is strictly forbidden and illegal under the laws of Bangladesh.
              </p>
            </section>

            <section className="space-y-3 bg-slate-50 p-6 rounded-xl border border-slate-200">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-rose-600" />
                2. The 3-Calendar-Month Resting Rule
              </h2>
              <p>
                Clinical hematology guidelines dictate that a healthy adult donor requires sufficient time to replenish erythrocyte mass and iron stores following a whole blood donation (typically 350ml–450ml).
              </p>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li><strong className="text-slate-800">Whole Blood Interval:</strong> Minimum 3 full calendar months between donations.</li>
                <li><strong className="text-slate-800">Calendar Month Logic:</strong> Rather than a generic 90-day count, calculations respect actual month endings (e.g. donation on January 31 leads to eligibility on April 30).</li>
                <li><strong className="text-slate-800">Timezone Anchoring:</strong> All dates are calculated in Bangladesh Standard Time (Asia/Dhaka, UTC+6).</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900">3. General Medical Eligibility Criteria</h2>
              <p>To safely donate blood in Bangladesh, donors generally need to meet the following benchmarks:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="p-4 bg-white rounded-lg border border-slate-200 space-y-1">
                  <span className="font-semibold text-slate-900 block">Age & Weight</span>
                  <p className="text-xs text-slate-500">Age between 18 and 60 years. Body weight at least 45 kg for females, at least 50 kg for males.</p>
                </div>
                <div className="p-4 bg-white rounded-lg border border-slate-200 space-y-1">
                  <span className="font-semibold text-slate-900 block">Hemoglobin Level</span>
                  <p className="text-xs text-slate-500">Minimum 12.5 g/dL measured by hospital laboratory prior to donation.</p>
                </div>
                <div className="p-4 bg-white rounded-lg border border-slate-200 space-y-1">
                  <span className="font-semibold text-slate-900 block">Vitals</span>
                  <p className="text-xs text-slate-500">Normal blood pressure (systolic 100–140 mmHg, diastolic 60–90 mmHg), pulse 60–100 bpm.</p>
                </div>
                <div className="p-4 bg-white rounded-lg border border-slate-200 space-y-1">
                  <span className="font-semibold text-slate-900 block">Health History</span>
                  <p className="text-xs text-slate-500">Free from infectious diseases (Hepatitis B/C, HIV, Syphilis, Malaria). No major surgery within past 6 months.</p>
                </div>
              </div>
            </section>

            <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 text-xs text-rose-900 space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Crucial Medical Disclaimer</span>
              </div>
              <p className="leading-relaxed">
                Blood Group Finder Bangladesh is an informational directory, NOT a hospital, blood bank, pathology lab, or medical provider. Our availability indicator indicates the passage of the platform waiting period; it does NOT certify that a donor is medically fit. Mandatory clinical screening and laboratory blood cross-matching must be conducted by certified physicians prior to any transfusion.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 2. CONTACT & SUPPORT PAGE */}
      {page === 'contact' && (
        <div className="space-y-8">
          <div className="border-b border-slate-200 pb-5">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-700">Support & Inquiries</span>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 mt-1">
              Contact Platform Administrators
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              Have questions about registration, volunteer coordination, or account privacy? Reach out to our team.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-2">
              <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-700 flex items-center justify-center">
                <Mail className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Email Support</h3>
              <p className="text-xs text-slate-500">Inquiries regarding donor accounts and policy:</p>
              <p className="text-xs font-semibold text-rose-700 pt-1">support@bloodgroupfinder.org.bd</p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-2">
              <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-700 flex items-center justify-center">
                <Phone className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Emergency Helplines</h3>
              <p className="text-xs text-slate-500">For urgent hospital transfusions:</p>
              <p className="text-xs font-semibold text-slate-800 pt-1">Dial 999 (National Emergency)</p>
              <p className="text-[11px] text-slate-500">or contact your nearest Red Crescent Unit</p>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-2">
              <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-700 flex items-center justify-center">
                <MapPin className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Coverage Area</h3>
              <p className="text-xs text-slate-500">National operating boundary:</p>
              <p className="text-xs font-semibold text-slate-800 pt-1">All 8 Divisions</p>
              <p className="text-[11px] text-slate-500">Dhaka, Ctg, Rajshahi, Khulna, Sylhet, Barishal, Rangpur, Mymensingh</p>
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-6 border border-slate-200 space-y-3 text-xs text-slate-600">
            <h3 className="text-sm font-bold text-slate-900">Are you a Hospital or Certified Blood Bank?</h3>
            <p className="leading-relaxed">
              If your medical institution requires bulk voluntary donor coordination in Bangladesh, please contact our administrative team with your clinical license number. Institutional inquiries receive priority coordinator assignment.
            </p>
          </div>
        </div>
      )}

      {/* 3. PRIVACY POLICY */}
      {page === 'privacy' && (
        <div className="space-y-8">
          <div className="border-b border-slate-200 pb-5">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-700">Data Governance</span>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 mt-1">
              Privacy Policy & Donor Data Protection
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              Version 1.0 · Enacted for Blood Group Finder Bangladesh
            </p>
          </div>

          <div className="prose prose-slate max-w-none text-xs sm:text-sm text-slate-700 space-y-6 leading-relaxed">
            <section className="space-y-2">
              <h2 className="text-base font-bold text-slate-900">1. Information We Collect</h2>
              <p>
                When you register as a donor, we collect your full name, email address, mobile phone number, blood group (ABO and Rh), geographic location (division, district, upazila), and previous donation date.
              </p>
              <p>
                We do NOT collect national identity card numbers, financial details, or sensitive biometric records.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-slate-900">2. How Contact Data is Shared</h2>
              <p>
                To prevent unsolicited telemarketing or harassment, we give donors granular control over their phone number visibility:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Public:</strong> Accessible only to searchers seeking blood donors in your upazila/district.</li>
                <li><strong>Registered Users Only:</strong> Accessible only to verified, signed-in users.</li>
                <li><strong>Hidden:</strong> Your phone number is masked. Inquiries must go through regional coordinators.</li>
              </ul>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-slate-900">3. Security & Non-Disclosure</h2>
              <p>
                All data is stored in Cloud Firestore guarded by zero-trust security rules and backend authentication. We will never sell, lease, or monetize donor data to pharmaceutical companies, advertisers, or third-party brokers.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-slate-900">4. Right to Deletion & Opt-Out</h2>
              <p>
                You can toggle your availability to "Unavailable" at any time from your profile dashboard, which instantly removes your record from public search. You may also request complete account deactivation at any time.
              </p>
            </section>
          </div>
        </div>
      )}

      {/* 4. TERMS OF SERVICE */}
      {page === 'terms' && (
        <div className="space-y-8">
          <div className="border-b border-slate-200 pb-5">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-700">Platform Agreement</span>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 mt-1">
              Terms of Service
            </h1>
            <p className="text-sm text-slate-500 mt-2">
              Standard rules governing voluntary blood donor discovery in Bangladesh
            </p>
          </div>

          <div className="prose prose-slate max-w-none text-xs sm:text-sm text-slate-700 space-y-6 leading-relaxed">
            <section className="space-y-2">
              <h2 className="text-base font-bold text-slate-900">1. Acceptance of Terms</h2>
              <p>
                By accessing or registering with Blood Group Finder Bangladesh, you agree to comply with all applicable laws of Bangladesh, including medical regulations and anti-commercial blood donation policies.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-slate-900">2. Voluntary & Uncompensated Standard</h2>
              <p>
                Blood donation arranged through this platform is purely humanitarian and voluntary. Demanding money, financial rewards, or gifts in exchange for blood donation is strictly prohibited and constitutes an immediate violation resulting in permanent account termination and referral to law enforcement.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-slate-900">3. Verification & Administrative Prerogative</h2>
              <p>
                Registration does not confer an automatic right to appear in public search. Platform administrators reserve the right to review, approve, reject, suspend, or remove any donor profile that fails verification or violates conduct guidelines.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-bold text-slate-900">4. Limitation of Liability</h2>
              <p>
                The platform does not perform medical diagnostic procedures. The recipient, patient party, and treating medical facility are solely responsible for testing donor eligibility, compatibility, and blood safety before transfusion.
              </p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
};

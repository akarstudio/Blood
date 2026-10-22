import React from 'react';
import { Droplet, Shield, HeartHandshake, PhoneCall } from 'lucide-react';

interface FooterProps {
  onNavigate: (page: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  return (
    <footer className="bg-slate-900 text-slate-400 text-sm border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 pb-16 md:pb-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Col 1: Brand & Purpose */}
          <div className="md:col-span-1 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-rose-600 flex items-center justify-center text-white">
                <Droplet className="w-4 h-4 fill-current" />
              </div>
              <span className="font-bold text-white text-base">Blood Group Finder BD</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              A community healthcare donor discovery directory for Bangladesh. Helping individuals find voluntary blood donors across all 8 divisions and 64 districts.
            </p>
            <div className="text-xs text-slate-500 pt-1">
              Timezone: Asia/Dhaka (BST)
            </div>
          </div>

          {/* Col 2: Navigation */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200 mb-3">Directory</h4>
            <ul className="space-y-2 text-xs">
              <li>
                <button onClick={() => onNavigate('find-donors')} className="hover:text-white transition-colors">
                  Find Blood Donors
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('register')} className="hover:text-white transition-colors">
                  Register as a Donor
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('about')} className="hover:text-white transition-colors">
                  Donation Eligibility Guidelines
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('signin')} className="hover:text-white transition-colors">
                  Donor Login
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Legal & Privacy */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200 mb-3">Governance</h4>
            <ul className="space-y-2 text-xs">
              <li>
                <button onClick={() => onNavigate('privacy')} className="hover:text-white transition-colors">
                  Privacy Policy & Data Rights
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('terms')} className="hover:text-white transition-colors">
                  Terms of Service
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('contact')} className="hover:text-white transition-colors">
                  Contact & Support
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('about')} className="hover:text-white transition-colors">
                  Waiting Period Policy (3 Months)
                </button>
              </li>
            </ul>
          </div>

          {/* Col 4: Important Medical Disclaimer */}
          <div className="bg-slate-800/60 p-4 rounded-lg border border-slate-700/60 text-xs space-y-2">
            <div className="flex items-center gap-1.5 text-rose-400 font-medium">
              <Shield className="w-4 h-4 shrink-0" />
              <span>Medical Disclaimer</span>
            </div>
            <p className="text-slate-300 leading-relaxed text-[11px]">
              Blood Group Finder Bangladesh is a public voluntary discovery platform, NOT a hospital, blood bank, or emergency medical facility. Calculated availability does not certify medical fitness to donate. Always undergo professional medical screening and blood cross-matching at an accredited hospital or transfusion clinic before transfusion.
            </p>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} Blood Group Finder Bangladesh. Dedicated to voluntary, uncompensated blood donation.</p>
          <div className="flex items-center gap-4">
            <button onClick={() => onNavigate('privacy')} className="hover:text-slate-400">Privacy</button>
            <span>·</span>
            <button onClick={() => onNavigate('terms')} className="hover:text-slate-400">Terms</button>
            <span>·</span>
            <button onClick={() => onNavigate('contact')} className="hover:text-slate-400">Support</button>
          </div>
        </div>
      </div>
    </footer>
  );
};

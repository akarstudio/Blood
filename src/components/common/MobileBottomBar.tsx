import React from 'react';
import { Droplet, Search, UserPlus, User, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface MobileBottomBarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

export const MobileBottomBar: React.FC<MobileBottomBarProps> = ({ currentPage, onNavigate }) => {
  const { user, isDonorManager, isDataEntryOperator } = useAuth();
  const canAccessAdmin = isDonorManager || isDataEntryOperator;

  const navItems = [
    {
      id: 'home',
      label: 'Home',
      icon: Droplet,
      active: currentPage === 'home',
    },
    {
      id: 'find-donors',
      label: 'Find Donors',
      icon: Search,
      active: currentPage === 'find-donors',
    },
    {
      id: 'register',
      label: 'Register',
      icon: UserPlus,
      active: currentPage === 'register',
    },
    ...(canAccessAdmin
      ? [
          {
            id: 'admin',
            label: 'Admin',
            icon: ShieldCheck,
            active: currentPage === 'admin',
          },
        ]
      : []),
    {
      id: user ? 'profile' : 'signin',
      label: user ? 'Profile' : 'Sign In',
      icon: User,
      active: user ? currentPage === 'profile' : currentPage === 'signin' || currentPage === 'signup',
    },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-lg px-2 pt-1 pb-[max(0.375rem,env(safe-area-inset-bottom))]"
      aria-label="Mobile Navigation"
    >
      <div className="flex items-center justify-around max-w-md mx-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`flex flex-col items-center justify-center py-1 px-3 min-w-[56px] min-h-[46px] rounded-lg transition-all active:scale-90 relative ${
                item.active
                  ? 'text-rose-600 font-semibold'
                  : 'text-slate-500 hover:text-slate-900 active:bg-slate-100'
              }`}
            >
              <Icon
                className={`w-5 h-5 transition-transform ${
                  item.active ? 'scale-110 fill-rose-50 stroke-rose-600' : ''
                }`}
              />
              <span className="text-[10px] tracking-tight mt-0.5 leading-none">
                {item.label}
              </span>
              {item.active && (
                <span className="w-1 h-1 bg-rose-600 rounded-full mt-0.5" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

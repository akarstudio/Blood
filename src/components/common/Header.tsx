import React, { useState } from 'react';
import { Droplet, User, LogOut, ShieldCheck, Heart, Menu, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface HeaderProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ currentPage, onNavigate }) => {
  const { user, userProfile, isDonorManager, isDataEntryOperator, signOut } = useAuth();
  const canAccessAdmin = isDonorManager || isDataEntryOperator;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { id: 'home', label: 'Home' },
    { id: 'find-donors', label: 'Find Donors' },
    { id: 'register', label: 'Register as Donor' },
    { id: 'about', label: 'About & Criteria' },
    { id: 'contact', label: 'Contact' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-8 h-16">
          {/* Zone 1: Single text wordmark brand */}
          <button
            onClick={() => {
              onNavigate('home');
              setMobileMenuOpen(false);
            }}
            className="flex items-center gap-2 sm:gap-2.5 text-left group focus:outline-hidden focus-visible:ring-2 focus-visible:ring-rose-500 rounded-md shrink-0"
          >
            <div className="w-8 h-8 rounded-lg bg-rose-600 flex items-center justify-center text-white shadow-xs shrink-0">
              <Droplet className="w-5 h-5 fill-current" />
            </div>
            <span className="text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
              Blood Finder <span className="text-rose-600 font-semibold">BD</span>
            </span>
          </button>

          {/* Zone 2: 4-5 single-line clean navigation links (Desktop) */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            {navLinks.map((link) => {
              const isActive = currentPage === link.id;
              return (
                <button
                  key={link.id}
                  onClick={() => onNavigate(link.id)}
                  className={`whitespace-nowrap shrink-0 transition-colors py-1 relative ${
                    isActive ? 'text-rose-700 font-semibold' : 'hover:text-slate-900'
                  }`}
                >
                  {link.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-rose-600 rounded-full" />
                  )}
                </button>
              );
            })}
            {canAccessAdmin && (
              <button
                onClick={() => onNavigate('admin')}
                className={`flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors py-1 ${
                  currentPage === 'admin' ? 'text-rose-700 font-semibold' : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                <ShieldCheck className="w-4 h-4 text-rose-600" />
                Admin Console
              </button>
            )}
          </nav>

          {/* Zone 3: 1 primary action or user profile menu */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {user ? (
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  onClick={() => onNavigate('profile')}
                  className={`inline-flex items-center gap-1.5 sm:gap-2 text-xs font-medium px-2.5 sm:px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
                    currentPage === 'profile'
                      ? 'border-rose-300 bg-rose-50 text-rose-900'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                  title={user.email || 'My Profile'}
                >
                  <User className="w-3.5 h-3.5 text-slate-500" />
                  <span className="max-w-[80px] sm:max-w-[120px] truncate">
                    {userProfile?.displayName || user.email?.split('@')[0]}
                  </span>
                </button>

                <button
                  onClick={() => signOut()}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors hidden sm:inline-flex"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-2">
                <button
                  onClick={() => onNavigate('signin')}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 transition-colors whitespace-nowrap"
                >
                  Sign In
                </button>
                <button
                  onClick={() => onNavigate('register')}
                  className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors whitespace-nowrap"
                >
                  Register Donor
                </button>
              </div>
            )}

            {/* Mobile menu toggle button (Touch target 44px) */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden w-11 h-11 flex items-center justify-center text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile nav drawer & Backdrop */}
      {mobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 top-16 bg-slate-900/40 backdrop-blur-2xs z-30 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-40 md:hidden border-t border-slate-200 bg-white px-4 pt-3 pb-6 space-y-2 shadow-xl animate-in slide-in-from-top-2 duration-150 max-h-[calc(100vh-4rem)] overflow-y-auto">
            {/* User status card on mobile */}
            {user ? (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-rose-100 text-rose-700 font-bold flex items-center justify-center text-sm">
                    {(userProfile?.displayName || user.email || 'U')[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-900 truncate max-w-[170px]">
                      {userProfile?.displayName || user.email}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {isDonorManager ? 'System Administrator' : 'Donor / Community Member'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    signOut();
                    setMobileMenuOpen(false);
                  }}
                  className="px-2.5 py-1 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-md transition-colors"
                >
                  Sign Out
                </button>
              </div>
            ) : null}

            {/* Navigation items (min 44px touch targets) */}
            <div className="space-y-1">
              {navLinks.map((link) => (
                <button
                  key={link.id}
                  onClick={() => {
                    onNavigate(link.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full text-left px-3.5 py-2.5 text-sm rounded-lg font-medium transition-colors flex items-center justify-between ${
                    currentPage === link.id
                      ? 'bg-rose-50 text-rose-700 font-semibold'
                      : 'text-slate-700 hover:bg-slate-50 active:bg-slate-100'
                  }`}
                >
                  <span>{link.label}</span>
                  {currentPage === link.id && (
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
                  )}
                </button>
              ))}

              {canAccessAdmin && (
                <button
                  onClick={() => {
                    onNavigate('admin');
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center gap-2 w-full text-left px-3.5 py-2.5 text-sm rounded-lg font-medium transition-colors ${
                    currentPage === 'admin'
                      ? 'bg-rose-100/70 text-rose-800 font-semibold'
                      : 'text-slate-800 bg-slate-100 hover:bg-slate-200'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4 text-rose-600" />
                  <span>Admin Console</span>
                </button>
              )}
            </div>

            {/* Action buttons if logged out */}
            {!user && (
              <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    onNavigate('signin');
                    setMobileMenuOpen(false);
                  }}
                  className="py-2.5 px-3 text-xs font-semibold border border-slate-300 text-slate-800 hover:bg-slate-50 rounded-lg text-center active:bg-slate-100"
                >
                  Sign In
                </button>
                <button
                  onClick={() => {
                    onNavigate('register');
                    setMobileMenuOpen(false);
                  }}
                  className="py-2.5 px-3 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-center shadow-xs active:bg-rose-800"
                >
                  Register Donor
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </header>
  );
};

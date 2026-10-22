import React, { useState } from 'react';
import { Droplet, User, LogOut, ShieldCheck, Heart, Menu, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface HeaderProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ currentPage, onNavigate }) => {
  const { user, userProfile, isDonorManager, signOut } = useAuth();
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
            onClick={() => onNavigate('home')}
            className="flex items-center gap-2.5 text-left group focus:outline-hidden focus-visible:ring-2 focus-visible:ring-rose-500 rounded-md"
          >
            <div className="w-8 h-8 rounded-lg bg-rose-600 flex items-center justify-center text-white shadow-xs">
              <Droplet className="w-5 h-5 fill-current" />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              Blood Group Finder <span className="text-rose-600 font-semibold">BD</span>
            </span>
          </button>

          {/* Zone 2: 4-5 single-line clean navigation links */}
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
            {isDonorManager && (
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
          <div className="flex items-center gap-3 shrink-0">
            {user ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onNavigate('profile')}
                  className={`inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
                    currentPage === 'profile'
                      ? 'border-rose-300 bg-rose-50 text-rose-900'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                  title={user.email || 'My Profile'}
                >
                  <User className="w-3.5 h-3.5 text-slate-500" />
                  <span className="max-w-[120px] truncate">{userProfile?.displayName || user.email?.split('@')[0]}</span>
                </button>

                <button
                  onClick={() => signOut()}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
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

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile nav drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 pt-2 pb-4 space-y-1">
          {navLinks.map((link) => (
            <button
              key={link.id}
              onClick={() => {
                onNavigate(link.id);
                setMobileMenuOpen(false);
              }}
              className={`block w-full text-left px-3 py-2 text-sm rounded-md font-medium ${
                currentPage === link.id
                  ? 'bg-rose-50 text-rose-700 font-semibold'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {link.label}
            </button>
          ))}
          {isDonorManager && (
            <button
              onClick={() => {
                onNavigate('admin');
                setMobileMenuOpen(false);
              }}
              className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm rounded-md font-medium text-slate-900 bg-slate-100"
            >
              <ShieldCheck className="w-4 h-4 text-rose-600" />
              Admin Console
            </button>
          )}
          {!user && (
            <div className="pt-2 border-t border-slate-100 flex gap-2">
              <button
                onClick={() => {
                  onNavigate('signin');
                  setMobileMenuOpen(false);
                }}
                className="flex-1 py-2 text-xs font-medium border border-slate-200 text-slate-700 rounded-lg text-center"
              >
                Sign In
              </button>
              <button
                onClick={() => {
                  onNavigate('register');
                  setMobileMenuOpen(false);
                }}
                className="flex-1 py-2 text-xs font-semibold bg-rose-600 text-white rounded-lg text-center"
              >
                Register
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
};

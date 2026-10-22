import React, { useState, useEffect } from 'react';
import { AuthProvider } from './context/AuthContext';
import { Header } from './components/common/Header';
import { Footer } from './components/common/Footer';
import { HomePage } from './pages/HomePage';
import { FindDonorsPage } from './pages/FindDonorsPage';
import { RegisterDonorPage } from './pages/RegisterDonorPage';
import { MyProfilePage } from './pages/MyProfilePage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AuthPages } from './pages/AuthPages';
import { InformationalPages } from './pages/InformationalPages';

export default function App() {
  const [currentPage, setCurrentPage] = useState<string>('home');
  const [navParams, setNavParams] = useState<Record<string, string>>({});

  // Sync with window.location.hash for shareable links
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, '');
      if (hash) {
        const [page, query] = hash.split('?');
        setCurrentPage(page || 'home');
        if (query) {
          const params = new URLSearchParams(query);
          const pObj: Record<string, string> = {};
          params.forEach((v, k) => {
            pObj[k] = v;
          });
          setNavParams(pObj);
        }
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleNavigate = (page: string, params?: Record<string, string>) => {
    setCurrentPage(page);
    setNavParams(params || {});
    if (params && Object.keys(params).length > 0) {
      const q = new URLSearchParams(params).toString();
      window.location.hash = `#/${page}?${q}`;
    } else {
      window.location.hash = `#/${page}`;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <AuthProvider>
      <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans selection:bg-rose-100 selection:text-rose-900">
        <Header currentPage={currentPage} onNavigate={handleNavigate} />

        <main className="flex-1">
          {currentPage === 'home' && <HomePage onNavigate={handleNavigate} />}

          {currentPage === 'find-donors' && (
            <FindDonorsPage initialFilters={navParams} onNavigate={handleNavigate} />
          )}

          {currentPage === 'register' && <RegisterDonorPage onNavigate={handleNavigate} />}

          {currentPage === 'profile' && <MyProfilePage onNavigate={handleNavigate} />}

          {currentPage === 'admin' && <AdminDashboardPage onNavigate={handleNavigate} />}

          {currentPage === 'signin' && (
            <AuthPages mode="signin" onNavigate={handleNavigate} />
          )}

          {currentPage === 'signup' && (
            <AuthPages mode="signup" onNavigate={handleNavigate} />
          )}

          {currentPage === 'forgot' && (
            <AuthPages mode="forgot" onNavigate={handleNavigate} />
          )}

          {currentPage === 'about' && (
            <InformationalPages page="about" onNavigate={handleNavigate} />
          )}

          {currentPage === 'contact' && (
            <InformationalPages page="contact" onNavigate={handleNavigate} />
          )}

          {currentPage === 'privacy' && (
            <InformationalPages page="privacy" onNavigate={handleNavigate} />
          )}

          {currentPage === 'terms' && (
            <InformationalPages page="terms" onNavigate={handleNavigate} />
          )}
        </main>

        <Footer onNavigate={handleNavigate} />
      </div>
    </AuthProvider>
  );
}

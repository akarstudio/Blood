import React, { useState } from 'react';
import { 
  Droplet, 
  Lock, 
  Mail, 
  User, 
  AlertCircle, 
  CheckCircle, 
  ArrowLeft,
  Sparkles,
  ExternalLink,
  Copy,
  Check
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isValidEmail } from '../utils/validation';

interface AuthPagesProps {
  mode: 'signin' | 'signup' | 'forgot';
  onNavigate: (page: string) => void;
}

export const AuthPages: React.FC<AuthPagesProps> = ({ mode, onNavigate }) => {
  const { signIn, signUp, signInWithGoogle, sendPasswordReset } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOperationNotAllowed, setIsOperationNotAllowed] = useState(false);
  const [isInvalidCredential, setIsInvalidCredential] = useState(false);
  const [isUnauthorizedDomain, setIsUnauthorizedDomain] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const currentHostname = typeof window !== 'undefined' ? window.location.hostname : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsOperationNotAllowed(false);
    setIsInvalidCredential(false);
    setIsUnauthorizedDomain(false);
    setSuccessMessage(null);

    if (!isValidEmail(email)) {
      setError('Please provide a valid email address.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signin') {
        if (!password) {
          setError('Password is required.');
          setLoading(false);
          return;
        }
        await signIn(email.trim(), password);
        onNavigate('home');
      } else if (mode === 'signup') {
        if (!password || password.length < 6) {
          setError('Password must be at least 6 characters.');
          setLoading(false);
          return;
        }
        await signUp(email.trim(), password, displayName.trim());
        onNavigate('home');
      } else if (mode === 'forgot') {
        await sendPasswordReset(email.trim());
        setSuccessMessage('Password reset instructions have been sent to your email.');
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      let msg = 'Authentication operation failed.';
      if (err.code === 'auth/unauthorized-domain') {
        setIsUnauthorizedDomain(true);
        msg = `Domain "${currentHostname || 'this domain'}" is not authorized for Firebase Authentication.`;
      } else if (err.code === 'auth/operation-not-allowed') {
        setIsOperationNotAllowed(true);
        msg = 'Email/Password sign-in is not enabled in Firebase Console. Please use "Continue with Google" above, or enable Email/Password in the Firebase Console.';
      } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        setIsInvalidCredential(true);
        msg = 'Incorrect password or account not found for this email address.';
      } else if (err.code === 'auth/email-already-in-use') {
        msg = 'An account with this email address already exists. Please sign in instead.';
      } else if (err.code === 'auth/weak-password') {
        msg = 'The password is too weak. Please use at least 6 characters.';
      } else if (err.code === 'auth/user-disabled') {
        msg = 'This account has been disabled. Please contact system support.';
      } else if (err.message) {
        msg = err.message;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsOperationNotAllowed(false);
    setIsUnauthorizedDomain(false);
    setLoading(true);
    try {
      await signInWithGoogle();
      onNavigate('home');
    } catch (err: any) {
      console.error('Google sign-in error:', err);
      if (err.code === 'auth/unauthorized-domain') {
        setIsUnauthorizedDomain(true);
        setError(`Domain "${currentHostname || 'this domain'}" is not authorized for Firebase Authentication.`);
      } else {
        setError(err.message || 'Unable to sign in with Google.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-8 sm:py-16">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-8 space-y-5 sm:space-y-6">
        {/* Brand Lockup */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 mx-auto rounded-xl bg-rose-600 flex items-center justify-center text-white shadow-xs">
            <Droplet className="w-7 h-7 fill-current" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">
            {mode === 'signin' && 'Sign In to Your Account'}
            {mode === 'signup' && 'Create Donor Account'}
            {mode === 'forgot' && 'Reset Your Password'}
          </h1>
          <p className="text-xs text-slate-500">
            {mode === 'signin' && 'Access your voluntary donor profile or administrative duty console.'}
            {mode === 'signup' && 'Register your account to manage blood donation availability.'}
            {mode === 'forgot' && 'Enter your registered email and we will send you a password reset link.'}
          </p>
        </div>

        {/* Primary Recommended Option: Google Sign-in */}
        {mode !== 'forgot' && (
          <div className="space-y-3">
            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full py-2.5 px-4 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-2xs transition-colors flex items-center justify-center gap-2 relative group focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
              <span className="ml-auto text-[10px] font-normal text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded-sm border border-rose-100">
                Recommended
              </span>
            </button>

            <div className="relative flex items-center justify-center my-2">
              <div className="border-t border-slate-200 w-full" />
              <span className="bg-white px-2 text-[11px] text-slate-400 uppercase tracking-wider relative">
                or with email & password
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>

            {isInvalidCredential && mode === 'signin' && (
              <div className="pt-2 border-t border-rose-200/60 text-[11px] space-y-2">
                <p className="text-rose-900 font-medium">
                  Don't have a password set up for this email yet?
                </p>
                <div className="flex flex-col gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    className="w-full py-1.5 px-3 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-md transition-colors text-xs text-center"
                  >
                    Continue with Google (Instant Sign In)
                  </button>
                  <div className="flex items-center justify-between pt-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => onNavigate('signup')}
                      className="text-rose-700 underline font-semibold hover:text-rose-900"
                    >
                      Create account (Sign Up)
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate('forgot')}
                      className="text-slate-600 underline hover:text-slate-900"
                    >
                      Reset password
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isOperationNotAllowed && (
              <div className="pt-2 border-t border-rose-200/60 text-[11px] space-y-2">
                <p className="text-rose-900 font-medium">
                  By default, Google Authentication is active. To use email/password:
                </p>
                <ol className="list-decimal pl-4 space-y-0.5 text-rose-800">
                  <li>Open Firebase Console &gt; Authentication &gt; Sign-in method</li>
                  <li>Enable "Email/Password" and save</li>
                </ol>
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  className="w-full mt-1 py-1.5 px-3 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-md transition-colors text-xs text-center"
                >
                  Sign in with Google Instead
                </button>
              </div>
            )}

            {isUnauthorizedDomain && (
              <div className="pt-2 border-t border-rose-200/60 text-[11px] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-rose-900 font-bold">Domain Not Whitelisted in Firebase</span>
                </div>
                <p className="text-rose-800 leading-relaxed">
                  Firebase Authentication requires any domain your app is hosted on (e.g. Vercel) to be added to Authorized Domains for security.
                </p>

                <div className="bg-white/90 p-2.5 rounded-lg border border-rose-200 space-y-1.5 shadow-2xs">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-600 font-medium">Domain to authorize:</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (currentHostname) {
                          navigator.clipboard.writeText(currentHostname);
                          setCopiedDomain(true);
                          setTimeout(() => setCopiedDomain(false), 2500);
                        }
                      }}
                      className="inline-flex items-center gap-1 text-rose-700 hover:text-rose-900 font-semibold cursor-pointer"
                    >
                      {copiedDomain ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-700 font-bold">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy domain</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="font-mono text-xs text-rose-950 bg-rose-50/80 px-2 py-1.5 rounded border border-rose-200 select-all font-semibold break-all">
                    {currentHostname || 'your-project.vercel.app'}
                  </div>
                </div>

                <div className="space-y-1 text-slate-700">
                  <p className="font-semibold text-slate-900">3-Step Quick Fix in Firebase Console:</p>
                  <ol className="list-decimal pl-4 space-y-1 text-slate-700">
                    <li>Click <strong>Open Firebase Settings</strong> below.</li>
                    <li>Scroll down to <strong>Authorized domains</strong> and click <strong>Add domain</strong>.</li>
                    <li>Paste <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-[10px] text-slate-800">{currentHostname || 'your-project.vercel.app'}</code> and click <strong>Done/Save</strong>.</li>
                  </ol>
                  <p className="text-[10px] text-slate-500 italic pt-0.5">
                    Takes effect immediately — no code re-deployment needed!
                  </p>
                </div>

                <div className="pt-1 flex flex-col sm:flex-row gap-2">
                  <a
                    href="https://console.firebase.google.com/project/valiant-azimuth-472710-n7/authentication/settings"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex-1 py-2 px-3 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg transition-colors text-xs text-center inline-flex items-center justify-center gap-1.5 shadow-2xs"
                  >
                    <span>Open Firebase Settings</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    className="py-2 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-semibold rounded-lg transition-colors text-xs text-center cursor-pointer"
                  >
                    Try Again
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {successMessage && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{successMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Display Name</label>
              <div className="relative">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Tanvir Ahmed"
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                />
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
            <div className="relative">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
              />
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
          </div>

          {mode !== 'forgot' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-700">Password</label>
                {mode === 'signin' && (
                  <button
                    type="button"
                    onClick={() => onNavigate('forgot')}
                    className="text-[11px] text-rose-600 hover:text-rose-800 font-medium"
                  >
                    Forgot Password?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:outline-hidden"
                />
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors disabled:opacity-50"
          >
            {loading ? 'Processing...' : mode === 'signin' ? 'Sign In with Email' : mode === 'signup' ? 'Create Account with Email' : 'Send Reset Link'}
          </button>
        </form>

        {/* Footer toggles */}
        <div className="pt-4 border-t border-slate-100 text-center text-xs text-slate-500">
          {mode === 'signin' ? (
            <p>
              Don't have an account yet?{' '}
              <button
                onClick={() => onNavigate('signup')}
                className="text-rose-600 font-semibold hover:text-rose-700"
              >
                Sign Up
              </button>
            </p>
          ) : (
            <button
              onClick={() => onNavigate('signin')}
              className="text-rose-600 font-semibold hover:text-rose-700 inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>Back to Sign In</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

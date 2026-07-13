import { useState, useEffect } from 'react';
import { NavigationProps } from '../types';
import {
  auth,
  googleProvider,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
} from '../lib/firebase';
import { useAuth } from '../context/AuthContext';

type Screen = 'auth' | 'verify-email' | 'forgot-password';

export default function AuthPage({ onNavigate }: NavigationProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [screen, setScreen] = useState<Screen>('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const { user, emailVerified, resendVerificationEmail } = useAuth();

  // If user is logged in but unverified (e.g., persisted session), jump to verify screen
  useEffect(() => {
    if (user && !emailVerified) {
      setScreen('verify-email');
    }
  }, [user, emailVerified]);

  // If already verified, let App.tsx redirect
  if (emailVerified) return null;

  async function handleGoogle() {
    setError(''); setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
      onNavigate('nexus');
    } catch (e: any) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/cancelled-popup-request') {
        await signInWithRedirect(auth, googleProvider);
      } else {
        setError(e.message || 'Google sign-in failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
        onNavigate('nexus');
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
        onNavigate('nexus');
      }
    } catch (err: any) {
      const msg = (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential')
        ? 'Invalid email or password.'
        : err.message || 'Authentication failed.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setError(''); setBusy(true);
    try {
      await resendVerificationEmail();
      setInfo('Verification email sent. Check your inbox.');
    } catch (e: any) {
      setError(e.message || 'Could not send email.');
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setInfo('Password reset email sent. Check your inbox.');
    } catch (err: any) {
      setError(err.message || 'Could not send reset email.');
    } finally {
      setBusy(false);
    }
  }

  // ── Verify Email Screen ──────────────────────────────────────────────────
  if (screen === 'verify-email') {
    return (
      <div className="bg-surface text-on-surface min-h-screen flex flex-col">
        <header className="w-full">
          <div className="flex justify-between items-baseline w-full px-10 py-8 mx-auto">
            <div className="font-serif text-2xl tracking-[4px] uppercase text-on-surface cursor-pointer" onClick={() => onNavigate('landing')}>
              The Lyceum
            </div>
          </div>
        </header>
        <main className="flex-grow flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-md">
            <div className="bg-surface border border-outline/10 p-12 shadow-sm relative text-center">
              <div className="absolute top-0 left-0 w-8 h-8 border-t border-l border-on-surface/20" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-on-surface/20" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b border-l border-on-surface/20" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b border-r border-on-surface/20" />

              <div className="text-4xl mb-6">✉️</div>
              <h1 className="font-serif text-2xl text-on-surface tracking-[2px] mb-3">VERIFY YOUR EMAIL</h1>
              <p className="font-sans text-xs text-on-surface/60 uppercase tracking-[1px] mb-8">
                We sent a verification link to your inbox.<br />
                Open it, then come back here.
              </p>

              {error && (
                <p className="text-red-600 text-xs text-center mb-4 font-sans border border-red-200 bg-red-50 px-4 py-2">{error}</p>
              )}
              {info && (
                <p className="text-green-700 text-xs text-center mb-4 font-sans border border-green-200 bg-green-50 px-4 py-2">{info}</p>
              )}

              <button
                onClick={handleResend}
                disabled={busy}
                className="w-full border border-outline/20 py-3 px-6 font-sans text-[10px] uppercase tracking-[2px] hover:bg-surface-container-highest transition-all mb-4 disabled:opacity-40"
              >
                {busy ? 'Sending…' : 'Resend Email'}
              </button>

              <button
                onClick={() => { setScreen('auth'); setError(''); setInfo(''); }}
                className="font-sans text-[10px] text-on-surface/40 hover:text-on-surface/70 uppercase tracking-[1px] transition-colors"
              >
                ← Back to Sign In
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Forgot Password Screen ───────────────────────────────────────────────
  if (screen === 'forgot-password') {
    return (
      <div className="bg-surface text-on-surface min-h-screen flex flex-col">
        <header className="w-full">
          <div className="flex justify-between items-baseline w-full px-10 py-8 mx-auto">
            <div className="font-serif text-2xl tracking-[4px] uppercase text-on-surface cursor-pointer" onClick={() => onNavigate('landing')}>
              The Lyceum
            </div>
          </div>
        </header>
        <main className="flex-grow flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-md">
            <div className="bg-surface border border-outline/10 p-12 shadow-sm relative">
              <div className="absolute top-0 left-0 w-8 h-8 border-t border-l border-on-surface/20" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-on-surface/20" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b border-l border-on-surface/20" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b border-r border-on-surface/20" />

              <h1 className="font-serif text-2xl text-on-surface tracking-[2px] mb-2 text-center">RESET PASSWORD</h1>
              <p className="font-sans text-xs text-on-surface/60 uppercase tracking-[1px] text-center mb-8">
                Enter your email — we'll send a reset link.
              </p>

              {error && (
                <p className="text-red-600 text-xs text-center mb-4 font-sans border border-red-200 bg-red-50 px-4 py-2">{error}</p>
              )}
              {info && (
                <p className="text-green-700 text-xs text-center mb-4 font-sans border border-green-200 bg-green-50 px-4 py-2">{info}</p>
              )}

              <form className="space-y-6" onSubmit={handleForgotPassword}>
                <div className="space-y-1">
                  <label className="font-sans text-[10px] text-on-surface uppercase tracking-[2px] block opacity-70">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="socrates@academy.edu"
                    required
                    className="w-full bg-transparent border-t-0 border-x-0 border-b border-outline-variant/50 py-3 font-sans text-sm focus:border-on-surface transition-colors placeholder:text-outline-variant/80 outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full bg-on-surface text-surface font-sans text-[10px] uppercase tracking-[2px] py-4 hover:opacity-80 transition-opacity disabled:opacity-40"
                >
                  {busy ? 'Sending…' : 'Send Reset Link'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <button
                  onClick={() => { setScreen('auth'); setError(''); setInfo(''); }}
                  className="font-sans text-[10px] text-on-surface/40 hover:text-on-surface/70 uppercase tracking-[1px] transition-colors"
                >
                  ← Back to Sign In
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Main Auth Screen ─────────────────────────────────────────────────────
  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col">
      <header className="w-full">
        <div className="flex justify-between items-baseline w-full px-10 py-8 mx-auto">
          <div
            className="font-serif text-2xl tracking-[4px] uppercase text-on-surface cursor-pointer"
            onClick={() => onNavigate('landing')}
          >
            The Lyceum
          </div>
        </div>
      </header>

      <main className="flex-grow flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="bg-surface border border-outline/10 p-12 shadow-sm relative">
            <div className="absolute top-0 left-0 w-8 h-8 border-t border-l border-on-surface/20" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-on-surface/20" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b border-l border-on-surface/20" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b border-r border-on-surface/20" />

            <div className="flex flex-col items-center mb-10">
              <div className="w-24 h-24 mb-6">
                <img
                  className="w-full h-full object-contain grayscale opacity-80"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuBrMRMQplboPg8Qif0otOm4qABvXmkxRZ69RL-kGUcFczQIcwCp6cSMCM0xAZ1DYLvMoqtCoeL0FUO_Qe8YpL04WKUkwXkBQiTEoXY1jZ2jHHA8RyUl2EhTPbNt1jXyyG-QsSGq3cPgdMehqixoS6-zBZbISveX2FG51SIG0G4hHOGyc27OVDOH56nDeGqLSa2kGeluwq1pQaLqKbuTMKXqA1DX1hGAyeLsAJuz82PmgvUADiG--GM_7YypoynYC7oLzARQEvHQVSdt"
                  alt="Hermes"
                />
              </div>
              <h1 className="font-serif text-3xl text-on-surface text-center tracking-[2px]">
                {isLogin ? 'ENTER ACADEMY' : 'ENROLLMENT'}
              </h1>
              <p className="font-sans text-xs text-on-surface opacity-60 text-center mt-3 uppercase tracking-[1px]">
                {isLogin
                  ? 'The unexamined life is not worth living.'
                  : 'Begin your journey into the realm of forms.'}
              </p>
            </div>

            {error && (
              <p className="text-red-600 text-xs text-center mb-6 font-sans border border-red-200 bg-red-50 px-4 py-2">
                {error}
              </p>
            )}

            <button
              onClick={handleGoogle}
              disabled={busy}
              className="w-full border border-outline/20 py-3 px-6 flex items-center justify-center gap-3 hover:bg-surface-container-highest transition-all active:scale-95 mb-8 disabled:opacity-40"
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              <span className="font-sans text-[10px] uppercase tracking-[2px] text-on-surface">
                {busy ? 'Signing in…' : 'Continue with Google'}
              </span>
            </button>

            <div className="flex items-center gap-4 mb-8">
              <div className="h-[1px] bg-outline-variant/50 flex-grow" />
              <span className="font-sans text-[10px] text-on-surface/50 uppercase tracking-[2px]">or</span>
              <div className="h-[1px] bg-outline-variant/50 flex-grow" />
            </div>

            <form className="space-y-6" onSubmit={handleEmail}>
              <div className="space-y-1">
                <label className="font-sans text-[10px] text-on-surface uppercase tracking-[2px] block opacity-70">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="socrates@academy.edu"
                  required
                  className="w-full bg-transparent border-t-0 border-x-0 border-b border-outline-variant/50 py-3 font-sans text-sm focus:border-on-surface transition-colors placeholder:text-outline-variant/80 outline-none"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <label className="font-sans text-[10px] text-on-surface uppercase tracking-[2px] block opacity-70">
                    Password
                  </label>
                  {isLogin && (
                    <button
                      type="button"
                      onClick={() => { setScreen('forgot-password'); setError(''); setInfo(''); }}
                      className="font-sans text-[9px] text-on-surface/40 hover:text-on-surface/70 uppercase tracking-[1px] transition-colors"
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full bg-transparent border-t-0 border-x-0 border-b border-outline-variant/50 py-3 font-sans text-sm focus:border-on-surface transition-colors placeholder:text-outline-variant/80 outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full bg-on-surface text-surface font-sans text-[10px] uppercase tracking-[2px] py-4 hover:opacity-80 transition-opacity disabled:opacity-40"
              >
                {busy ? 'Please wait…' : isLogin ? 'Sign In' : 'Enroll'}
              </button>
            </form>

            <div className="mt-8 text-center">
              <p className="font-sans text-[10px] uppercase tracking-[1px] text-on-surface opacity-70">
                {isLogin ? 'New seeker? ' : 'Already a scholar? '}
                <button
                  onClick={() => { setIsLogin(!isLogin); setError(''); }}
                  className="text-on-surface font-bold hover:opacity-80 ml-1 border-b border-on-surface pb-[1px]"
                >
                  {isLogin ? 'Enroll' : 'Sign In'}
                </button>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

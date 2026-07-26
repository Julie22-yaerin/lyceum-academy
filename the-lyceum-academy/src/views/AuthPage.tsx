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
import { checkLoginAttempt, requestOtp, verifyOtp } from '../lib/api';
import { redeemAccessCode } from '../lib/lyceumApi';
import { getRecaptchaToken } from '../lib/recaptcha';
import { useTranslation } from '../i18n/I18nContext';
import { LiquidMetalButton } from '../../components/ui/liquid-metal-button';

type Screen = 'auth' | 'verify-email' | 'verify-otp' | 'forgot-password';
type OtpPurpose = 'signup' | 'login';

export default function AuthPage({ onNavigate }: NavigationProps) {
  const { t } = useTranslation();
  const [isLogin, setIsLogin] = useState(true);
  const [screen, setScreen] = useState<Screen>('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCodeEntry, setShowCodeEntry] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeInfo, setCodeInfo] = useState('');
  const { user, emailVerified, resendVerificationEmail } = useAuth();

  // Email OTP — required at both signup and every login, on top of (not
  // instead of) Firebase's own auth. Pending until a code is verified.
  const [otpPurpose, setOtpPurpose] = useState<OtpPurpose>('login');
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [otpInfo, setOtpInfo] = useState('');

  function otpVerifiedKey(forEmail: string) { return `lyceum_otp_verified_${forEmail.toLowerCase()}`; }

  async function beginOtpChallenge(forEmail: string, purpose: OtpPurpose) {
    setOtpEmail(forEmail);
    setOtpPurpose(purpose);
    setOtpCode('');
    setOtpError('');
    setOtpInfo('');
    setScreen('verify-otp');
    try {
      const r = await requestOtp(forEmail, purpose);
      setOtpInfo(r.delivered ? 'Đã gửi mã tới email của bạn.' : 'Không gửi được email — thử "Gửi lại mã" sau ít phút.');
    } catch (e: any) {
      setOtpError(e?.message || 'Không gửi được mã.');
    }
  }

  async function handleVerifyOtp() {
    if (!otpCode.trim() || otpBusy) return;
    setOtpBusy(true); setOtpError('');
    try {
      const ok = await verifyOtp(otpEmail, otpPurpose, otpCode.trim());
      if (!ok) { setOtpError('Mã không đúng hoặc đã hết hạn.'); return; }
      try { sessionStorage.setItem(otpVerifiedKey(otpEmail), '1'); } catch { /* ignore */ }
      onNavigate('problem-sets');
    } finally {
      setOtpBusy(false);
    }
  }

  async function handleResendOtp() {
    if (otpBusy) return;
    setOtpBusy(true); setOtpError(''); setOtpInfo('');
    try {
      const r = await requestOtp(otpEmail, otpPurpose);
      setOtpInfo(r.delivered ? 'Đã gửi mã mới.' : 'Không gửi được email — thử lại sau ít phút.');
    } catch (e: any) {
      setOtpError(e?.message || 'Không gửi được mã.');
    } finally {
      setOtpBusy(false);
    }
  }

  // Manual override for the accepted-application gate: an admin-issued
  // one-time code, for when the normal review pipeline hasn't fired yet.
  async function handleRedeemCode() {
    if (!accessCode.trim() || !email.trim() || codeBusy) return;
    setCodeBusy(true); setError(''); setCodeInfo('');
    try {
      await redeemAccessCode(accessCode.trim(), email.trim());
      setCodeInfo('✓ Mã hợp lệ — bạn có thể đăng ký tài khoản ngay bây giờ.');
      setShowCodeEntry(false);
    } catch (e: any) {
      setError(e?.message || 'Mã không hợp lệ hoặc đã được sử dụng.');
    } finally {
      setCodeBusy(false);
    }
  }

  // If user is logged in but unverified (e.g., persisted session), jump to verify screen
  useEffect(() => {
    if (user && !emailVerified) {
      setScreen('verify-email');
    }
  }, [user, emailVerified]);

  function isOtpVerifiedThisSession(forEmail: string): boolean {
    try { return sessionStorage.getItem(otpVerifiedKey(forEmail)) === '1'; } catch { return true; }
  }

  // Firebase considers this a valid, verified session (e.g. a persisted
  // login surviving a page reload) but the OTP challenge hasn't been
  // cleared yet this browser session — App.tsx's gate sends them back here
  // for exactly this reason. Fire the challenge automatically rather than
  // showing the normal sign-in form to someone who's already signed in.
  useEffect(() => {
    if (user?.email && emailVerified && screen === 'auth' && !isOtpVerifiedThisSession(user.email)) {
      beginOtpChallenge(user.email, 'login');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, emailVerified, screen]);

  // If already verified (Firebase + OTP), let App.tsx redirect
  if (emailVerified && user?.email && isOtpVerifiedThisSession(user.email)) return null;

  async function handleGoogle() {
    setError(''); setBusy(true);
    try {
      // Registration is open — no waitlist, no application review. Anyone
      // can create an account and go straight to setting their week.
      const cred = await signInWithPopup(auth, googleProvider);
      const isNew = cred.user.metadata.creationTime === cred.user.metadata.lastSignInTime;
      await beginOtpChallenge(cred.user.email || '', isNew ? 'signup' : 'login');
    } catch (e: any) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/cancelled-popup-request') {
        await signInWithRedirect(auth, googleProvider);
      } else {
        setError(e.message || t('auth.googleFailed'));
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
        const token = await getRecaptchaToken('login');
        await checkLoginAttempt(token);
        await signInWithEmailAndPassword(auth, email, password);
        await beginOtpChallenge(email, 'login');
      } else {
        const token = await getRecaptchaToken('signup');
        await checkLoginAttempt(token);
        await createUserWithEmailAndPassword(auth, email, password);
        await beginOtpChallenge(email, 'signup');
      }
    } catch (err: any) {
      const msg = (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential')
        ? t('auth.invalidCredentials')
        : err.message || t('auth.authFailed');
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setError(''); setBusy(true);
    try {
      await resendVerificationEmail();
      setInfo(t('auth.verificationSent'));
    } catch (e: any) {
      setError(e.message || t('auth.couldNotSend'));
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setInfo(t('auth.resetSent'));
    } catch (err: any) {
      setError(err.message || t('auth.couldNotReset'));
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
              {t('landing.title')}
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
              <h1 className="font-serif text-2xl text-on-surface tracking-[2px] mb-3">{t('auth.verifyEmail')}</h1>
              <p className="font-sans text-xs text-on-surface/60 uppercase tracking-[1px] mb-8">
                {t('auth.verifySent')}<br />
                {t('auth.verifyOpen')}
              </p>

              {error && (
                <p className="text-red-600 text-xs text-center mb-4 font-sans border border-red-200 bg-red-50 px-4 py-2">{error}</p>
              )}
              {info && (
                <p className="text-green-700 text-xs text-center mb-4 font-sans border border-green-200 bg-green-50 px-4 py-2">{info}</p>
              )}

              <LiquidMetalButton
                label={busy ? t('auth.sending') : t('auth.resendEmail')}
                disabled={busy}
                fullWidth
                onClick={handleResend}
              />

              <button
                onClick={() => { setScreen('auth'); setError(''); setInfo(''); }}
                className="font-sans text-[10px] text-on-surface/40 hover:text-on-surface/70 uppercase tracking-[1px] transition-colors"
              >
                {t('auth.backToSignIn')}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Email OTP Screen — required at both signup and every login ──────────
  if (screen === 'verify-otp') {
    return (
      <div className="bg-surface text-on-surface min-h-screen flex flex-col">
        <header className="w-full">
          <div className="flex justify-between items-baseline w-full px-10 py-8 mx-auto">
            <div className="font-serif text-2xl tracking-[4px] uppercase text-on-surface cursor-pointer" onClick={() => onNavigate('landing')}>
              {t('landing.title')}
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

              <div className="text-4xl mb-6">🔐</div>
              <h1 className="font-serif text-2xl text-on-surface tracking-[2px] mb-3">Nhập mã xác nhận</h1>
              <p className="font-sans text-xs text-on-surface/60 uppercase tracking-[1px] mb-8">
                Mã 6 số vừa gửi tới<br />{otpEmail}
              </p>

              <input
                value={otpCode}
                onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={e => { if (e.key === 'Enter') handleVerifyOtp(); }}
                placeholder="000000"
                inputMode="numeric"
                autoFocus
                className="w-full text-center text-2xl tracking-[8px] font-mono border border-outline/20 bg-transparent px-4 py-3 mb-4 outline-none focus:border-on-surface/40"
              />

              {otpError && (
                <p className="text-red-600 text-xs text-center mb-4 font-sans border border-red-200 bg-red-50 px-4 py-2">{otpError}</p>
              )}
              {otpInfo && !otpError && (
                <p className="text-green-700 text-xs text-center mb-4 font-sans border border-green-200 bg-green-50 px-4 py-2">{otpInfo}</p>
              )}

              <LiquidMetalButton
                label={otpBusy ? t('common.loading') : 'Xác nhận'}
                disabled={otpBusy || otpCode.length !== 6}
                fullWidth
                onClick={handleVerifyOtp}
              />

              <button
                onClick={handleResendOtp}
                disabled={otpBusy}
                className="block w-full mt-4 font-sans text-[10px] text-on-surface/40 hover:text-on-surface/70 uppercase tracking-[1px] transition-colors"
              >
                Gửi lại mã
              </button>
              <button
                onClick={() => { setScreen('auth'); setOtpError(''); setOtpInfo(''); }}
                className="mt-2 font-sans text-[10px] text-on-surface/40 hover:text-on-surface/70 uppercase tracking-[1px] transition-colors"
              >
                {t('auth.backToSignIn')}
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
              {t('landing.title')}
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

              <h1 className="font-serif text-2xl text-on-surface tracking-[2px] mb-2 text-center">{t('auth.resetPassword')}</h1>
              <p className="font-sans text-xs text-on-surface/60 uppercase tracking-[1px] text-center mb-8">
                {t('auth.resetDesc')}
              </p>

              {error && (
                <p className="text-red-600 text-xs text-center mb-4 font-sans border border-red-200 bg-red-50 px-4 py-2">{error}</p>
              )}
              {info && (
                <p className="text-green-700 text-xs text-center mb-4 font-sans border border-green-200 bg-green-50 px-4 py-2">{info}</p>
              )}

              <form className="space-y-6" onSubmit={handleForgotPassword}>
                <div className="space-y-1">
                  <label className="font-sans text-[10px] text-on-surface uppercase tracking-[2px] block opacity-70">{t('auth.emailAddress')}</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="socrates@academy.edu"
                    required
                    className="w-full bg-transparent border-t-0 border-x-0 border-b border-outline-variant/50 py-3 font-sans text-sm focus:border-on-surface transition-colors placeholder:text-outline-variant/80 outline-none"
                  />
                </div>
                <LiquidMetalButton
                  label={busy ? t('auth.sending') : t('auth.sendResetLink')}
                  disabled={busy}
                  fullWidth
                  type="submit"
                />
              </form>

              <div className="mt-6 text-center">
                <button
                  onClick={() => { setScreen('auth'); setError(''); setInfo(''); }}
                  className="font-sans text-[10px] text-on-surface/40 hover:text-on-surface/70 uppercase tracking-[1px] transition-colors"
                >
                  {t('auth.backToSignIn')}
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
            {t('landing.title')}
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
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
              <h1 className="font-serif text-3xl text-on-surface text-center tracking-[2px]">
                {isLogin ? t('auth.enterAcademy') : t('auth.enrollment')}
              </h1>
              <p className="font-sans text-xs text-on-surface opacity-60 text-center mt-3 uppercase tracking-[1px]">
                {isLogin
                  ? t('auth.loginQuote')
                  : t('auth.signupQuote')}
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
                {busy ? t('auth.signingIn') : t('auth.google')}
              </span>
            </button>

            <div className="flex items-center gap-4 mb-8">
              <div className="h-[1px] bg-outline-variant/50 flex-grow" />
              <span className="font-sans text-[10px] text-on-surface/50 uppercase tracking-[2px]">{t('auth.orContinueWith')}</span>
              <div className="h-[1px] bg-outline-variant/50 flex-grow" />
            </div>

            <form className="space-y-6" onSubmit={handleEmail}>
              <div className="space-y-1">
                <label className="font-sans text-[10px] text-on-surface uppercase tracking-[2px] block opacity-70">
                  {t('auth.emailAddress')}
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
                    {t('auth.password')}
                  </label>
                  {isLogin && (
                    <button
                      type="button"
                      onClick={() => { setScreen('forgot-password'); setError(''); setInfo(''); }}
                      className="font-sans text-[9px] text-on-surface/40 hover:text-on-surface/70 uppercase tracking-[1px] transition-colors"
                    >
                      {t('auth.forgot')}
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
              <LiquidMetalButton
                label={busy ? t('common.loading') : isLogin ? t('auth.signInBtn') : t('auth.enrollBtn')}
                disabled={busy}
                fullWidth
                type="submit"
              />
            </form>

            <div className="mt-8 text-center">
              <p className="font-sans text-[10px] uppercase tracking-[1px] text-on-surface opacity-70">
                {isLogin ? t('auth.newSeeker') : t('auth.alreadyScholar')}
                <button
                  onClick={() => { setIsLogin(!isLogin); setError(''); }}
                  className="text-on-surface font-bold hover:opacity-80 ml-1 border-b border-on-surface pb-[1px]"
                >
                  {isLogin ? t('auth.enrollBtn') : t('auth.signInBtn')}
                </button>
              </p>
              {!isLogin && (
                <>
                  <p className="font-sans text-[10px] uppercase tracking-[1px] text-on-surface opacity-50 mt-3">
                    Chưa nộp đơn?
                    <button
                      onClick={() => onNavigate('apply')}
                      className="text-on-surface font-bold hover:opacity-80 ml-1 border-b border-on-surface pb-[1px]"
                    >
                      Ứng tuyển tại đây
                    </button>
                  </p>
                  <button
                    onClick={() => setShowCodeEntry(v => !v)}
                    className="font-sans text-[10px] uppercase tracking-[1px] text-on-surface opacity-40 hover:opacity-70 transition-opacity mt-2"
                  >
                    {showCodeEntry ? '← Ẩn' : 'Đã được duyệt nhưng chưa vào được? Nhập mã truy cập'}
                  </button>
                </>
              )}

              {!isLogin && showCodeEntry && (
                <div className="mt-4 border border-on-surface/15 p-4 flex flex-col gap-2">
                  <input
                    value={accessCode} onChange={e => setAccessCode(e.target.value)}
                    placeholder="Mã truy cập (do đội ngũ Lyceum cấp)"
                    className="w-full bg-transparent border border-on-surface/20 px-3 py-2 text-xs text-on-surface outline-none focus:border-on-surface/50"
                  />
                  <LiquidMetalButton
                    label={codeBusy ? 'Đang kiểm tra…' : 'Kích hoạt mã'}
                    disabled={codeBusy}
                    fullWidth
                    onClick={handleRedeemCode}
                  />
                  {codeInfo && <p className="text-[10px] text-center text-emerald-700">{codeInfo}</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

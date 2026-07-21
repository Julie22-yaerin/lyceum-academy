import { useEffect, useRef, useState } from 'react';
import { View } from './types';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { getApiBaseUrl } from './lib/apiBase';
import { ThemeProvider } from './context/ThemeContext';
import { I18nProvider } from './i18n/I18nContext';
import { migrateLegacySubjectTags } from './lib/workspace';
import LandingPage from './views/LandingPage';
import AuthPage from './views/AuthPage';
import ApplyView from './views/ApplyView';
import LibraryPage from './views/LibraryPage';
import SecondBrainPage from './views/SecondBrainPage';
import MainLayout from './components/MainLayout';
import DialogueView from './views/DialogueView';
import ExerciseView from './views/ExerciseView';
import ProblemSetsView from './views/ProblemSetsView';
import NoteView from './views/NoteView';
import ProgressView from './views/ProgressView';
import NotepadWindow from './views/NotepadWindow';
import OnboardingModal from './components/OnboardingModal';
import MistakeBankView from './views/MistakeBankView';
// import ReferenceBankView from './views/ReferenceBankView';  // disabled, coming soon
import SettingsView from './views/SettingsView';
import TermsModal from './components/TermsModal';
import ProductTour from './components/ProductTour';
import { buildTourSteps } from './lib/tourSteps';
import { detectLocale, setDocumentLocale } from './lib/locale';
import { scopedGateKey } from './lib/persist';
import { shouldShowPaywall, trialDaysRemaining, getTrialStart, chooseFree } from './lib/trial';
import { useSubscription } from './lib/useSubscription';
import TrialPaywall from './components/TrialPaywall';
import SupportChatWidget from './components/SupportChatWidget';


function AppInner() {
  const [view, setView] = useState<View>('landing');
  const { user, loading, devMode, emailVerified } = useAuth();
  const { activeTab } = useWorkspace();
  const { hasActiveSubscription, loading: subLoading } = useSubscription();
  const [showTerms, setShowTerms] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [manualUpgradeOpen, setManualUpgradeOpen] = useState(false);
  const tourCheckedRef = useRef(false);

  useEffect(() => {
    setDocumentLocale(detectLocale());
  }, []);

  // Tell the backend a study session ended so it can pre-generate exercises
  // for whatever's next on the schedule. sendBeacon fires reliably even as
  // the tab is closing (a normal fetch would get cancelled mid-flight).
  const beaconStateRef = useRef({ uid: '', subject: null as string | null });
  beaconStateRef.current = { uid: user?.uid || '', subject: activeTab };
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== 'hidden') return;
      const { uid, subject } = beaconStateRef.current;
      if (!uid) return;
      navigator.sendBeacon?.(
        `${getApiBaseUrl()}/session/end`,
        JSON.stringify({ uid, subject, ts: Date.now() }),
      );
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Invite link (?invite=CODE): once the invited user is signed in, redeem
  // the code exactly once — the inviter earns +5 Quanta server-side.
  useEffect(() => {
    if (loading || !user || !emailVerified) return;
    const code = new URLSearchParams(window.location.search).get('invite');
    if (!code) return;
    import('./lib/lyceumApi').then(({ redeemReferral }) =>
      redeemReferral(code).catch(() => { /* already redeemed / own code */ })
    );
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    window.history.replaceState({}, '', url.toString());
  }, [loading, user, emailVerified]);

  // One-time backfill of subject tags on pre-existing data, once we know
  // who's signed in (scopedGateKey needs a resolved uid to namespace against).
  useEffect(() => {
    if (!loading && ((user && emailVerified) || devMode)) migrateLegacySubjectTags();
  }, [loading, user, emailVerified, devMode]);

  // After auth resolves: redirect verified users out of auth page
  useEffect(() => {
    if (!loading && ((user && emailVerified) || devMode) && view === 'auth') {
      setView('problem-sets');
    }
  }, [user, emailVerified, loading, devMode, view]);

  // First workspace entry ever (per account/browser): terms gate comes before
  // anything else, including onboarding. Once agreed, never shown again.
  useEffect(() => {
    if (!loading && ((user && emailVerified) || devMode) && view !== 'landing' && view !== 'auth') {
      try {
        if (!localStorage.getItem(scopedGateKey('lyceum_terms_accepted'))) {
          setShowTerms(true);
          return;
        }
        if (!localStorage.getItem(scopedGateKey('lyceum_onboarding_done'))) {
          setShowOnboarding(true);
        }
      } catch { /* ignore */ }
    }
  }, [loading, user, devMode, view]);

  // First-ever real visit to the workspace (not mid terms/onboarding gate):
  // a one-time spotlight tour of the main features. tourCheckedRef guards
  // against re-checking on every render of the same page load.
  useEffect(() => {
    if (loading || showTerms || showOnboarding) return;
    if (!((user && emailVerified) || devMode) || view === 'landing' || view === 'auth') return;
    if (tourCheckedRef.current) return;
    tourCheckedRef.current = true;
    try {
      if (!localStorage.getItem(scopedGateKey('lyceum_tour_done'))) setShowTour(true);
    } catch { /* ignore */ }
  }, [loading, user, emailVerified, devMode, view, showTerms, showOnboarding]);

  function handleTourFinish() {
    try { localStorage.setItem(scopedGateKey('lyceum_tour_done'), '1'); } catch { /* ignore */ }
    setShowTour(false);
  }

  function handleAgreeTerms() {
    try { localStorage.setItem(scopedGateKey('lyceum_terms_accepted'), '1'); } catch { /* ignore */ }
    setShowTerms(false);
    try {
      if (!localStorage.getItem(scopedGateKey('lyceum_onboarding_done'))) {
        setShowOnboarding(true);
      }
    } catch { /* ignore */ }
  }

  function handleOnboardingClose() {
    setShowOnboarding(false);
  }

  // Trial paywall: check after auth + subscription load
  useEffect(() => {
    if (loading || subLoading || devMode) return;
    if (!user) return;
    if (shouldShowPaywall(user.uid, hasActiveSubscription)) {
      setShowPaywall(true);
    } else {
      setShowPaywall(false);
    }
  }, [loading, subLoading, devMode, user, hasActiveSubscription]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="font-serif text-2xl tracking-[4px] uppercase text-on-surface opacity-40 animate-pulse">
          The Lyceum
        </div>
      </div>
    );
  }

  if (view === 'landing') return <LandingPage onNavigate={setView} currentView={view} />;
  if (view === 'apply') return <ApplyView onNavigate={setView} currentView={view} />;
  if (view === 'auth') return <AuthPage onNavigate={setView} currentView={view} />;

  // Guard: unauthenticated or unverified email users get sent to auth
  if ((!user || !emailVerified) && !devMode) {
    return <AuthPage onNavigate={setView} currentView={view} />;
  }

  // First-ever onboarding: don't mount the workspace behind it at all — the
  // student sees a blank page with the Lyceum advisor, not a blurred
  // dashboard, until the interview is done.
  if (showOnboarding) {
    return <OnboardingModal onClose={handleOnboardingClose} />;
  }

  // Trial expired paywall: block workspace until user subscribes.
  // Also reachable voluntarily (mid-trial) via the Settings "Upgrade" button —
  // that path gets a close button instead of forcing a plan/Free decision.
  if ((showPaywall || manualUpgradeOpen) && user) {
    return (
      <TrialPaywall
        daysRemaining={trialDaysRemaining(user.uid)}
        onSubscribe={() => {}}
        onChooseFree={() => { chooseFree(user.uid); setShowPaywall(false); setManualUpgradeOpen(false); }}
        onClose={manualUpgradeOpen ? () => setManualUpgradeOpen(false) : undefined}
      />
    );
  }

  return (
    <>
      {showTour && <ProductTour steps={buildTourSteps(setView)} onFinish={handleTourFinish} />}
      <MainLayout
        currentView={view}
        onNavigate={setView}
        tourActive={showTour}
      >
        {view === 'dialogue' && <DialogueView />}
        {view === 'exercise' && <ExerciseView />}
        {view === 'problem-sets' && <ProblemSetsView onNavigate={setView} />}
        {view === 'notes' && <NoteView />}
        {view === 'mistake-bank' && <MistakeBankView />}
        {/* Reference Bank disabled, coming soon
        {view === 'reference-bank' && <ReferenceBankView />}
        */}
        {view === 'progress' && <ProgressView />}
        {view === 'settings' && <SettingsView onUpgrade={() => setManualUpgradeOpen(true)} />}
      </MainLayout>
      <SupportChatWidget context="workspace" />
    </>
  );
}

export default function App() {
  // If this window was opened as the detached notepad popup, skip auth/nav entirely
  if (new URLSearchParams(window.location.search).get('panel') === 'notepad') {
    return <NotepadWindow />;
  }

  // Standalone public/gated subpages (thelyceum.site/library,
  // thelyceum.site/secondbrain) — real URLs outside the internal workspace's
  // view-state navigation, each with its own auth gating.
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/library' || path.startsWith('/library/')) {
    return (
      <I18nProvider><ThemeProvider><AuthProvider><LibraryPage /></AuthProvider></ThemeProvider></I18nProvider>
    );
  }
  if (path === '/secondbrain' || path.startsWith('/secondbrain/')) {
    return (
      <I18nProvider><ThemeProvider><AuthProvider><SecondBrainPage /></AuthProvider></ThemeProvider></I18nProvider>
    );
  }

  return (
    <I18nProvider>
    <ThemeProvider>
      <AuthProvider>
        <WorkspaceProvider>
          <AppInner />
        </WorkspaceProvider>
      </AuthProvider>
    </ThemeProvider>
    </I18nProvider>
  );
}

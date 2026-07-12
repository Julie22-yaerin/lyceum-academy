import { useEffect, useRef, useState } from 'react';
import { View } from './types';
import { AuthProvider, useAuth } from './context/AuthContext';
import LandingPage from './views/LandingPage';
import AuthPage from './views/AuthPage';
import MainLayout from './components/MainLayout';
import DialogueView from './views/DialogueView';
import ExerciseView from './views/ExerciseView';
import ProblemSetsView from './views/ProblemSetsView';
import KnowledgeMapView from './views/KnowledgeMapView';
import NoteView from './views/NoteView';
import ProgressView from './views/ProgressView';
import NotepadWindow from './views/NotepadWindow';
import OnboardingModal from './components/OnboardingModal';
import NexusView from './views/NexusView';
import MistakeBankView from './views/MistakeBankView';
import ReferenceBankView from './views/ReferenceBankView';
import TermsModal from './components/TermsModal';
import FeedbackModal from './components/FeedbackModal';


function AppInner() {
  const [view, setView] = useState<View>('landing');
  const { user, loading, devMode, emailVerified } = useAuth();
  const [showTerms, setShowTerms] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const loginCountedRef = useRef(false);

  // After auth resolves: redirect verified users out of auth page
  useEffect(() => {
    if (!loading && ((user && emailVerified) || devMode) && view === 'auth') {
      setView('nexus');
    }
  }, [user, emailVerified, loading, devMode, view]);

  // First workspace entry ever (per account/browser): terms gate comes before
  // anything else, including onboarding. Once agreed, never shown again.
  useEffect(() => {
    if (!loading && ((user && emailVerified) || devMode) && view !== 'landing' && view !== 'auth') {
      try {
        if (!localStorage.getItem('lyceum_terms_accepted')) {
          setShowTerms(true);
          return;
        }
        if (!localStorage.getItem('lyceum_onboarding_done')) {
          setShowOnboarding(true);
        }
      } catch { /* ignore */ }
    }
  }, [loading, user, devMode, view]);

  // Every 2nd time a student actually reaches the workspace (not mid
  // terms/onboarding gate), pop up a quick anonymous feedback ask.
  // loginCountedRef guards against double-counting the same page load.
  useEffect(() => {
    if (loading || showTerms || showOnboarding) return;
    if (!((user && emailVerified) || devMode) || view === 'landing' || view === 'auth') return;
    if (loginCountedRef.current) return;
    loginCountedRef.current = true;
    try {
      const count = (Number(localStorage.getItem('lyceum_login_count')) || 0) + 1;
      localStorage.setItem('lyceum_login_count', String(count));
      if (count % 2 === 0) setShowFeedback(true);
    } catch { /* ignore */ }
  }, [loading, user, emailVerified, devMode, view, showTerms, showOnboarding]);

  function handleAgreeTerms() {
    try { localStorage.setItem('lyceum_terms_accepted', '1'); } catch { /* ignore */ }
    setShowTerms(false);
    try {
      if (!localStorage.getItem('lyceum_onboarding_done')) {
        setShowOnboarding(true);
      }
    } catch { /* ignore */ }
  }

  function handleOnboardingClose() {
    setShowOnboarding(false);
  }

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

  return (
    <>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      <MainLayout currentView={view} onNavigate={setView}>
        {view === 'nexus' && <NexusView currentView={view} onNavigate={setView} />}
        {view === 'dialogue' && <DialogueView />}
        {view === 'exercise' && <ExerciseView />}
        {view === 'problem-sets' && <ProblemSetsView onNavigate={setView} />}
        {view === 'knowledge-map' && <KnowledgeMapView />}
        {view === 'notes' && <NoteView />}
        {view === 'mistake-bank' && <MistakeBankView />}
        {view === 'reference-bank' && <ReferenceBankView />}
        {view === 'progress' && <ProgressView />}
      </MainLayout>
    </>
  );
}

export default function App() {
  // If this window was opened as the detached notepad popup, skip auth/nav entirely
  if (new URLSearchParams(window.location.search).get('panel') === 'notepad') {
    return <NotepadWindow />;
  }
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

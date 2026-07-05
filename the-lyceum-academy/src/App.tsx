import { useEffect, useState } from 'react';
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
import CommunityView from './views/CommunityView';
import NexusView from './views/NexusView';
import MistakeBankView from './views/MistakeBankView';
import ReferenceBankView from './views/ReferenceBankView';
import GoalSettingView from './views/GoalSettingView';
import TaskSetupModal from './components/TaskSetupModal';
import TermsModal from './components/TermsModal';


function AppInner() {
  const [view, setView] = useState<View>('landing');
  const { user, loading, devMode, emailVerified } = useAuth();
  const [showTerms, setShowTerms] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showTaskSetup, setShowTaskSetup] = useState(false);

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
    try {
      if (!localStorage.getItem('lyceum_task_config')) {
        setShowTaskSetup(true);
      }
    } catch { /* ignore */ }
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

  return (
    <>
      {showOnboarding && (
        <OnboardingModal onClose={handleOnboardingClose} />
      )}
      {showTaskSetup && (
        <TaskSetupModal onClose={() => setShowTaskSetup(false)} />
      )}
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
        {view === 'community' && <CommunityView />}
        {view === 'goal-setting' && <GoalSettingView />}
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

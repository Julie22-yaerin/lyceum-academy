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


function AppInner() {
  const [view, setView] = useState<View>('landing');
  const { user, loading, devMode } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(false);

  // After auth resolves: redirect authenticated users out of auth page
  useEffect(() => {
    if (!loading && (user || devMode) && view === 'auth') {
      setView('dialogue');
    }
  }, [user, loading, devMode, view]);

  // Show onboarding once after first login
  useEffect(() => {
    if (!loading && (user || devMode) && view !== 'landing' && view !== 'auth') {
      try {
        if (!localStorage.getItem('lyceum_onboarding_done')) {
          setShowOnboarding(true);
        }
      } catch { /* ignore */ }
    }
  }, [loading, user, devMode, view]);

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

  // Guard: non-dev, non-authed users get sent to auth
  if (!user && !devMode) {
    return <AuthPage onNavigate={setView} currentView={view} />;
  }

  return (
    <>
      {showOnboarding && (
        <OnboardingModal onClose={() => setShowOnboarding(false)} />
      )}
      <MainLayout currentView={view} onNavigate={setView}>
        {view === 'dialogue' && <DialogueView />}
        {view === 'exercise' && <ExerciseView />}
        {view === 'problem-sets' && <ProblemSetsView onNavigate={setView} />}
        {view === 'knowledge-map' && <KnowledgeMapView />}
        {view === 'notes' && <NoteView />}
        {view === 'progress' && <ProgressView />}
        {view === 'community' && <CommunityView />}
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

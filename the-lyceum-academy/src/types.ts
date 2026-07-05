export type View = 'landing' | 'auth' | 'nexus' | 'dialogue' | 'exercise' | 'problem-sets' | 'knowledge-map' | 'notes' | 'mistake-bank' | 'reference-bank' | 'progress' | 'community' | 'goal-setting';

export interface NavigationProps {
  currentView: View;
  onNavigate: (view: View) => void;
}

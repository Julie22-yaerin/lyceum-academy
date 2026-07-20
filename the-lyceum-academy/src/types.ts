export type View = 'landing' | 'auth' | 'dialogue' | 'exercise' | 'problem-sets' | 'notes' | 'mistake-bank' | 'reference-bank' | 'progress' | 'settings';

export interface NavigationProps {
  currentView: View;
  onNavigate: (view: View) => void;
}

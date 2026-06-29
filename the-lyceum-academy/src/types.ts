export type View = 'landing' | 'auth' | 'dialogue' | 'exercise' | 'problem-sets' | 'knowledge-map' | 'notes' | 'progress' | 'community';

export interface NavigationProps {
  currentView: View;
  onNavigate: (view: View) => void;
}

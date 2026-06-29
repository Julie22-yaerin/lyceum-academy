import { ReactNode } from 'react';
import TopNavBar from './TopNavBar';
import { NavigationProps } from '../types';

interface MainLayoutProps extends NavigationProps {
  children: ReactNode;
}

export default function MainLayout({ currentView, onNavigate, children }: MainLayoutProps) {
  // Knowledge map needs its own full-bleed layout (contains its own toolbar, drawer, etc.)
  const isFullBleed = currentView === 'knowledge-map';

  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col relative overflow-hidden">
      <TopNavBar currentView={currentView} onNavigate={onNavigate} />
      <main className={`flex flex-1 overflow-hidden w-full relative ${isFullBleed ? '' : 'max-w-7xl mx-auto px-10 py-10'}`}>
        <div className={`flex-1 overflow-hidden relative ${isFullBleed ? '' : 'bg-surface-container-lowest border border-outline/10 p-8 overflow-y-auto'}`}>
          {children}
        </div>
      </main>
      {!isFullBleed && <div className="editorial-sidebar-text">Curated Academic Essence</div>}
    </div>
  );
}

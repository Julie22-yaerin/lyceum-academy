import { View, NavigationProps } from '../types';

export default function SideNavBar({ currentView, onNavigate }: NavigationProps) {
  return (
    <aside className="hidden md:flex flex-col h-full w-48 pr-8 gap-8 bg-surface">
      <div className="flex flex-col gap-2">
        <span className="text-[10px] uppercase tracking-[2px] opacity-50 font-semibold">Active Session</span>
        <div className="font-serif text-2xl text-on-surface italic">Hermes</div>
      </div>
      
      <nav className="flex flex-col gap-6 mt-8 items-start">
        <a onClick={() => onNavigate('exercise')} className={`editorial-nav-link text-left cursor-pointer ${currentView === 'exercise' ? 'active' : ''}`}>
          Current Thesis
        </a>
        <a onClick={() => onNavigate('dialogue')} className={`editorial-nav-link text-left cursor-pointer ${currentView === 'dialogue' ? 'active' : ''}`}>
          Socratic Method
        </a>
        <a className="editorial-nav-link text-left cursor-pointer">
          Library
        </a>
        <a className="editorial-nav-link text-left cursor-pointer">
          History
        </a>
      </nav>

      <div className="mt-auto pb-4">
        <button 
          onClick={() => onNavigate('dialogue')}
          className="w-full bg-on-surface text-surface py-3 text-[10px] uppercase tracking-[2px] font-semibold hover:opacity-80 transition-opacity"
        >
          Initiate
        </button>
      </div>
    </aside>
  );
}

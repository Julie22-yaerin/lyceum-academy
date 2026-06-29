import { NavigationProps } from '../types';

export default function LandingPage({ onNavigate }: NavigationProps) {
  return (
    <div className="font-sans text-base min-h-screen bg-surface flex flex-col p-10 relative overflow-hidden max-w-[1440px] mx-auto">
      <header className="flex justify-between items-baseline mb-[60px] z-10 relative">
        <div className="font-serif text-2xl tracking-[4px] uppercase text-on-surface">The Lyceum Academy</div>
        <nav className="hidden md:flex gap-8">
          <a onClick={() => onNavigate('auth')} className="editorial-nav-link cursor-pointer">Dialogue</a>
          <a onClick={() => onNavigate('auth')} className="editorial-nav-link cursor-pointer">Knowledge Graph</a>
          <a onClick={() => onNavigate('auth')} className="editorial-nav-link cursor-pointer">Problem Sets</a>
          <a onClick={() => onNavigate('auth')} className="editorial-nav-link cursor-pointer">Notes</a>
          <a onClick={() => onNavigate('auth')} className="editorial-nav-link cursor-pointer active">Begin Journey</a>
        </nav>
      </header>
      
      <main className="flex-1 flex gap-10 flex-col md:flex-row relative z-10">
        <div className="flex-[1.2] flex flex-col justify-center">
          <h1 className="font-serif text-[clamp(4rem,8vw,140px)] leading-[0.85] tracking-[-4px] font-normal mb-5 text-on-surface">
            INNER<span className="block ml-[80px] text-secondary">PHILOSOPHER</span>
          </h1>
          <p className="max-w-[320px] text-sm leading-[1.6] ml-[85px] opacity-80 text-on-surface">
            The Royal Road to Mastery through Socratic Inquiry. Engage with ancient wisdom refined by modern intelligence to unlock the architecture of thought.
          </p>
          <div className="flex gap-6 mt-12 ml-[85px]">
            <button onClick={() => onNavigate('auth')} className="bg-on-surface text-surface px-8 py-4 font-sans text-xs font-semibold tracking-widest uppercase hover:opacity-80 transition-opacity">
              Enter Academy
            </button>
          </div>
        </div>
        
        <div className="flex-[0.8] relative flex items-center justify-center min-h-[500px]">
          <div className="editorial-accent-line absolute top-1/2 -left-5 z-20"></div>
          <div className="w-full h-full min-h-[500px] bg-surface-container-highest rounded-[2px] relative overflow-hidden image-placeholder-gradient shadow-sm border border-outline-variant/30">
             <img alt="The Hermes Bust" className="w-full h-full object-cover grayscale mix-blend-multiply transition-transform duration-[8000ms] hover:scale-105 opacity-80" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDTA0QLErkxlP_BeIM7mD78KLJuFW_lmt3Q3IP1G4AmduUjxICVSCA-virbpO9jqxN5k4WrF-nUvMyf677HA54EBarVhFqXyrIln_i81IGqtJD6qoSO-8Y_RLQ4KviudLDh_Azlhxw-pyOEHGGtDkGstuCNLXbQIalyUdX3AJtswI1Js2TljBEPpy1KH_9XmEJHwHCgJkhncI_3cz4DUbgQMpYWj2NbfsLgbDCY3jes4sWw_64mvONTBXNesTZCNbM-mJK_zf8VoIUr" />
          </div>
        </div>
      </main>

      <footer className="flex justify-between items-end mt-16 z-10 relative">
        <div className="flex gap-[60px]">
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-[1px] opacity-50">Methodology</span>
            <span className="font-serif text-lg italic">Socratic Dialectic</span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-[1px] opacity-50">Focus</span>
            <span className="font-serif text-lg italic">Knowledge Graph</span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-[1px] opacity-50">Status</span>
            <span className="font-serif text-lg italic">Active</span>
          </div>
        </div>
        <div className="font-serif text-[32px]">
          01<span className="text-[14px] font-sans ml-[10px] opacity-40">/ 03</span>
        </div>
      </footer>
      
      <div className="editorial-sidebar-text">Curated Academic Essence</div>
    </div>
  );
}

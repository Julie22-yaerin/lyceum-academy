import { NavigationProps } from '../types';

export default function LandingPage({ onNavigate }: NavigationProps) {
  return (
    <div className="bg-[#050508] text-slate-200 font-sans antialiased overflow-x-hidden selection:bg-purple-500/30 min-h-screen">
      {/* Background ambient blobs */}
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[45%] h-[45%] bg-indigo-600/15 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[50%] h-[50%] bg-blue-600/15 rounded-full blur-[120px]" />
        <div className="absolute top-[40%] left-[55%] w-[35%] h-[35%] bg-violet-500/10 rounded-full blur-[120px]" />
      </div>

      {/* Nav */}
      <nav className="fixed w-full z-50 top-0 px-6 py-4">
        <div className="max-w-7xl mx-auto rounded-full px-6 py-3 flex justify-between items-center glass-strong">
          <div className="text-xl font-bold tracking-wider text-white">Lyceum</div>
          <div className="hidden md:flex space-x-8 text-sm font-medium text-slate-300">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#tree" className="hover:text-white transition-colors">Tree</a>
            <a href="#cohort" className="hover:text-white transition-colors">Cohort</a>
          </div>
          <button
            onClick={() => onNavigate('auth')}
            className="px-6 py-2 rounded-full text-sm font-medium text-white glass-btn"
          >
            Launch Workspace
          </button>
        </div>
      </nav>

      {/* Hero */}
      <main className="relative max-w-7xl mx-auto px-6 pt-32 pb-20 min-h-screen flex items-center">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left: headline + CTA */}
          <div className="space-y-8 z-10">
            <h1 className="text-5xl md:text-7xl font-extrabold leading-[1.1] tracking-tight">
              <span className="text-metallic">READY TO</span>
              <br />
              <span className="text-metallic">CONQUER YOUR</span>
              <br />
              <span className="text-metallic">STUDIES?</span>
            </h1>
            <p className="text-lg text-slate-400 max-w-lg leading-relaxed">
              An elite ecosystem designed for autonomous researchers, independent thinkers, and top-tier student scientists.
            </p>
            <div className="pt-4 flex items-center gap-4">
              <button
                onClick={() => onNavigate('auth')}
                className="inline-block px-8 py-4 rounded-full text-sm font-semibold tracking-wide text-white uppercase glass-btn shadow-[0_0_30px_rgba(167,139,250,0.25)]"
              >
                Join the Cohort
              </button>
            </div>
          </div>

          {/* Right: decorative globe + caduceus */}
          <div className="relative w-full flex justify-center lg:justify-end z-10">
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 to-purple-500/20 rounded-full blur-3xl transform scale-75" />
            <div
              className="absolute w-72 h-72 rounded-full glass-strong opacity-60"
              style={{ boxShadow: '0 0 80px rgba(59,130,246,0.25), inset 0 0 60px rgba(139,92,246,0.15)' }}
            />
            {/* Globe lines */}
            <svg viewBox="0 0 200 200" className="absolute w-72 h-72 opacity-30">
              <defs>
                <linearGradient id="globeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#60A5FA" />
                  <stop offset="100%" stopColor="#A78BFA" />
                </linearGradient>
              </defs>
              <circle cx="100" cy="100" r="90" fill="none" stroke="url(#globeGrad)" strokeWidth="0.5" />
              <ellipse cx="100" cy="100" rx="90" ry="35" fill="none" stroke="url(#globeGrad)" strokeWidth="0.5" />
              <ellipse cx="100" cy="100" rx="90" ry="60" fill="none" stroke="url(#globeGrad)" strokeWidth="0.5" />
              <line x1="10" y1="100" x2="190" y2="100" stroke="url(#globeGrad)" strokeWidth="0.5" />
            </svg>
            {/* Inner caduceus-style SVG */}
            <div className="relative z-10 w-full max-w-lg aspect-square drop-shadow-2xl flex items-center justify-center">
              <svg viewBox="0 0 200 200" className="w-64 h-64 opacity-90">
                <defs>
                  <linearGradient id="snakeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#60A5FA" />
                    <stop offset="100%" stopColor="#A78BFA" />
                  </linearGradient>
                </defs>
                <path d="M100 10 C140 10 180 50 180 90 C180 130 140 170 100 170 C60 170 20 130 20 90 C20 50 60 10 100 10Z" fill="none" stroke="url(#snakeGrad)" strokeWidth="2" opacity="0.3" />
                <path d="M100 30 C130 30 160 60 160 90 C160 120 130 150 100 150 C70 150 40 120 40 90 C40 60 70 30 100 30Z" fill="none" stroke="url(#snakeGrad)" strokeWidth="1.5" opacity="0.5" />
                <path d="M60 90 Q80 60 100 90 Q120 120 140 90" fill="none" stroke="url(#snakeGrad)" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
                <circle cx="60" cy="90" r="4" fill="#60A5FA" opacity="0.8" />
                <circle cx="140" cy="90" r="4" fill="#A78BFA" opacity="0.8" />
                <text x="100" y="105" textAnchor="middle" fill="url(#snakeGrad)" fontSize="11" fontWeight="300" letterSpacing="4" opacity="0.6">LYCEUM</text>
              </svg>
            </div>
          </div>
        </div>
      </main>

      {/* Features section */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-20">
        <div className="mb-12 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-metallic mb-3">Built for how you actually learn</h2>
          <p className="text-slate-400 max-w-xl mx-auto">Three core methodologies, fused into a single research workspace.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 md:grid-rows-2 gap-6">
          {/* Large card: Feynman */}
          <div className="md:col-span-2 md:row-span-2 p-8 rounded-3xl hover:-translate-y-0.5 transition-all duration-300 glass flex flex-col justify-between min-h-[280px]">
            <div>
              <span className="material-symbols-outlined text-3xl text-purple-300 mb-4 block">psychology</span>
              <h3 className="text-2xl font-bold text-white mb-3">Feynman Technique Simulator</h3>
              <p className="text-sm text-slate-400 max-w-md leading-relaxed">
                Master complex concepts by teaching them back in plain language. Our Socratic AI probes every explanation for gaps, forcing true understanding rather than memorization — instantly surfacing what you don't actually know.
              </p>
            </div>
            <div className="mt-6 rounded-2xl glass-strong p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-blue-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="h-2 w-3/4 bg-white/15 rounded-full mb-1.5" />
                <div className="h-2 w-1/2 bg-white/8 rounded-full" />
              </div>
              <span className="material-symbols-outlined text-white/30 text-lg">graphic_eq</span>
            </div>
          </div>

          {/* Mistake Bank */}
          <div className="p-8 rounded-3xl hover:-translate-y-0.5 transition-all duration-300 glass flex flex-col">
            <span className="material-symbols-outlined text-2xl text-amber-300 mb-3 block">error_outline</span>
            <h3 className="text-lg font-bold text-white mb-2">Mistake Bank Tracker</h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">Log errors, categorize conceptual blind spots, and systematically clear them.</p>
            <div className="mt-auto space-y-2">
              {['Sign error · Calc II', 'Unit mismatch · Physics', 'Off-by-one · Recursion'].map((item, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg glass-strong px-3 py-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                  <span className="text-[10px] text-white/60 truncate">{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Peer Review */}
          <div className="p-8 rounded-3xl hover:-translate-y-0.5 transition-all duration-300 glass flex flex-col">
            <span className="material-symbols-outlined text-2xl text-cyan-300 mb-3 block">diversity_3</span>
            <h3 className="text-lg font-bold text-white mb-2">Peer-Review Hub</h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">High-level verification of problem sets by fellow independent researchers.</p>
            <div className="mt-auto flex items-center">
              <div className="flex -space-x-3">
                {(['#60A5FA', '#A78BFA', '#34D399', '#F59E0B'] as const).map((color, i) => (
                  <div
                    key={i}
                    className="w-8 h-8 rounded-full border-2 border-[#0a0a0c] flex items-center justify-center text-[9px] font-semibold text-white/80"
                    style={{ background: color + '55' }}
                  >
                    {['A', 'K', 'M', 'S'][i]}
                  </div>
                ))}
              </div>
              <span className="ml-3 text-[10px] text-white/40">4 reviewing now</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

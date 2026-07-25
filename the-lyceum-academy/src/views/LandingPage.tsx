import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Atom,
  BookMarked,
  Brain,
  CalendarClock,
  Compass,
  FlaskConical,
  Gauge,
  Library,
  MessagesSquare,
  Moon,
  ScanSearch,
  ShieldQuestion,
  Sparkles,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { NavigationProps } from '../types';
import FeedbackWidget from '../components/FeedbackWidget';
import SupportChatWidget from '../components/SupportChatWidget';
import { useTheme } from '../context/ThemeContext';
import { LiquidMetalButton } from '../../components/ui/liquid-metal-button';
import { TextReveal } from '../../components/ui/text-reveal';
import BookCallButton from '../components/BookCallButton';
import AboutSection from '../components/landing/AboutSection';
import { WindowStarsScene, DeskLampScene, OrbitScene } from '../components/landing/LandingScenes';
import FeaturedVideoSection from '../components/landing/FeaturedVideoSection';
import PhilosophySection from '../components/landing/PhilosophySection';
import ServicesSection from '../components/landing/ServicesSection';

// ── Hero background video — placeholder footage. Swap for real Lyceum
// campus/session footage before shipping to production. ──────────────────
const HERO_VIDEO_SRC = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_074625_a81f018a-956b-43fb-9aee-4d1508e30e6a.mp4';

// Vanilla-JS crossfade loop (no CSS transitions): fades in once the video
// is playable, fades to black in the final ~0.55s of each play-through,
// then pauses 100ms before looping — avoids the jump-cut a plain `loop`
// attribute leaves. Opacity is written directly to the DOM node rather than
// through a React `style` prop, so re-renders elsewhere on the page (e.g.
// the email field's onChange) can't stomp on the animation mid-flight.
function useHeroVideoLoop(videoRef: RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.style.opacity = '0';
    let raf = 0;
    let fadingOut = false;

    function animateOpacity(from: number, to: number, duration: number) {
      cancelAnimationFrame(raf);
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        video!.style.opacity = String(from + (to - from) * t);
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    function handleCanPlay() {
      video!.play().catch(() => {});
      animateOpacity(0, 1, 500);
    }
    function handleTimeUpdate() {
      const remaining = video!.duration - video!.currentTime;
      if (remaining <= 0.55 && !fadingOut) {
        fadingOut = true;
        animateOpacity(parseFloat(video!.style.opacity || '1'), 0, 500);
      }
    }
    function handleEnded() {
      fadingOut = false;
      video!.style.opacity = '0';
      setTimeout(() => {
        video!.currentTime = 0;
        video!.play().catch(() => {});
        animateOpacity(0, 1, 500);
      }, 100);
    }

    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    return () => {
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      cancelAnimationFrame(raf);
    };
  }, [videoRef]);
}

const QUOTES = [
  { text: 'The unexamined life is not worth living.', by: 'Socrates' },
  { text: 'I cannot teach anybody anything. I can only make them think.', by: 'Socrates' },
  { text: 'Take nobody’s word for it.', by: 'Nullius in verba' },
  { text: 'What you cannot derive, you do not own.', by: 'The house rule' },
  { text: 'Rigor is a courtesy. We extend it only to the serious.', by: '—' },
];

const METHOD_STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ShieldQuestion,
    title: 'You bring the question',
    body: 'Any subject. Any material. The point where you are actually stuck.',
  },
  {
    icon: MessagesSquare,
    title: 'We return a question',
    body: 'Not the answer. One question, placed where your understanding breaks.',
  },
  {
    icon: Sparkles,
    title: 'You derive it',
    body: 'What you build under your own power, you keep. The rest does not count.',
  },
];

// ── The Faculty — five native AI personas, each with hard role boundaries
// (see backend app/services/ai_roles) — the visual centerpiece replacing a
// generic "features grid." ──────────────────────────────────────────────
const FACULTY: { icon: LucideIcon; name: string; role: string; accent: string; body: string }[] = [
  {
    icon: Compass, name: 'Socrat', role: 'Lead Concierge', accent: 'text-purple-300',
    body: 'Does not answer. Asks the one question that exposes the hinge.',
  },
  {
    icon: Gauge, name: 'Coach', role: 'Curriculum Architect', accent: 'text-blue-300',
    body: 'Reads your errors overnight. Sequences the fix. Gaps first.',
  },
  {
    icon: Brain, name: 'Leo', role: 'The Feynman Child', accent: 'text-amber-300',
    body: 'Explain it plainly. Where Leo stops following, your understanding ends.',
  },
  {
    icon: FlaskConical, name: 'The Peer', role: 'Debate Partner', accent: 'text-cyan-300',
    body: 'Argues in good faith. Attacks the load-bearing assumption, nothing else.',
  },
  {
    icon: ScanSearch, name: 'The Grader', role: 'Solution Auditor', accent: 'text-rose-300',
    body: 'Audits every step. No false pass. Kindness is accuracy.',
  },
];

const EQUATIONS = [
  'E = mc²', '∇·E = ρ/ε₀', 'a² + b² = c²', 'iħ∂ψ/∂t = Ĥψ',
  'F = ma', 'ΔG = ΔH − TΔS', 'PV = nRT', '∫f′(x)dx = f(x) + C', 'S = k log W',
];

function EquationMarquee() {
  const doubled = [...EQUATIONS, ...EQUATIONS];
  return (
    <div className="relative overflow-hidden py-3 border-y border-white/5">
      <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#050508] to-transparent z-10" />
      <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#050508] to-transparent z-10" />
      <motion.div
        className="flex gap-14 whitespace-nowrap font-garamond text-lg text-white/25 italic"
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 32, repeat: Infinity, ease: 'linear' }}
      >
        {doubled.map((eq, i) => <span key={i}>{eq}</span>)}
      </motion.div>
    </div>
  );
}

function RotatingQuote() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % QUOTES.length), 5000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="relative h-28 flex items-center justify-center text-center">
      <AnimatePresence mode="wait">
        <motion.figure
          key={i}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.5 }}
          className="max-w-2xl"
        >
          <blockquote className="font-garamond text-xl md:text-2xl text-white/90 italic leading-snug">
            &ldquo;{QUOTES[i].text}&rdquo;
          </blockquote>
          <figcaption className="mt-3 text-xs uppercase tracking-[0.2em] text-white/40">
            {QUOTES[i].by}
          </figcaption>
        </motion.figure>
      </AnimatePresence>
    </div>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0 },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
};



export default function LandingPage({ onNavigate }: NavigationProps) {
  const { theme, toggleTheme } = useTheme();
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const [email, setEmail] = useState('');
  useHeroVideoLoop(heroVideoRef);

  function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    if (email.trim()) {
      try { window.localStorage.setItem('lyceum_prefill_email', email.trim()); } catch { /* best-effort only */ }
    }
    onNavigate('apply');
  }

  return (
    <div className="relative bg-[#050508] text-slate-200 font-sans antialiased overflow-x-hidden selection:bg-purple-500/30 min-h-screen transition-colors duration-500">
      {/* Ambient background orbs */}
      <div className="ambient-orbs">
        <div className="orb-1" />
        <div className="orb-2" />
        <div className="orb-3" />
      </div>

      <FeedbackWidget context="landing" />

      {/* Cinematic marketing block — Hero + About + Featured Video +
          Philosophy + Services. Deliberately committed to bg-black
          regardless of the app's light/dark toggle (see .lyceum-cinematic
          overrides in index.css). */}
      <div className="lyceum-cinematic relative bg-black">
        {/* Nav */}
        <motion.nav
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="fixed w-full z-50 top-0 px-6 py-4"
        >
          <div className="max-w-5xl mx-auto liquid-glass rounded-full px-6 py-3 flex justify-between items-center">
            <div className="flex items-center gap-2.5">
              <img src="/logo.png" alt="" className="w-6 h-6 object-contain" />
              <span className="text-white font-semibold text-lg">The Lyceum</span>
              <div className="hidden md:flex items-center gap-8 ml-8">
                <a href="#method" className="text-white/80 hover:text-white text-sm font-medium transition-colors">The Method</a>
                <a href="#faculty" className="text-white/80 hover:text-white text-sm font-medium transition-colors">The Faculty</a>
                <a href="/library" className="text-white/80 hover:text-white text-sm font-medium transition-colors">Library</a>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate('auth')}
                className="text-white text-sm font-medium hover:text-white/80 transition-colors"
              >
                Log in
              </button>
              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={toggleTheme}
                aria-label="Toggle light / dark mode"
                className="liquid-glass w-9 h-9 flex items-center justify-center rounded-full text-white"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={theme}
                    initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
                    animate={{ opacity: 1, rotate: 0, scale: 1 }}
                    exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
                    transition={{ duration: 0.25 }}
                    className="flex items-center justify-center"
                  >
                    {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
              <button
                type="button"
                onClick={() => onNavigate('apply')}
                className="liquid-glass rounded-full px-6 py-2 text-white text-sm font-medium"
              >
                Apply
              </button>
            </div>
          </div>
        </motion.nav>

        {/* Hero */}
        <main className="relative min-h-screen overflow-hidden flex flex-col">
          <video
            ref={heroVideoRef}
            className="absolute inset-0 w-full h-full object-cover object-bottom"
            src={HERO_VIDEO_SRC}
            muted
            autoPlay
            playsInline
            preload="auto"
          />
          <div className="absolute inset-0 bg-black/30" />

          <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-12 text-center gap-8">
            <span className="text-[11px] uppercase tracking-[0.25em] text-white/40">Toán &amp; Khoa học · Lớp 10 → năm nhất đại học</span>

            <h1 className="font-instrument text-6xl md:text-7xl lg:text-8xl text-white tracking-tight leading-[1.05] whitespace-nowrap">
              Know it. Then <em className="italic">derive</em> it.
            </h1>

            <form onSubmit={handleEmailSubmit} className="w-full max-w-xl liquid-glass rounded-full pl-6 pr-2 py-2 flex items-center gap-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="flex-1 bg-transparent text-white placeholder:text-white/40 text-sm outline-none"
              />
              <button type="submit" aria-label="Continue to application" className="bg-white rounded-full p-3 text-black shrink-0">
                <ArrowRight className="w-5 h-5" />
              </button>
            </form>

            <p className="max-w-md text-white text-sm leading-relaxed px-4">
              Nhận email khi hồ sơ tuyển sinh mở, cùng ghi chú ngắn từ Coach về cách tự học Toán và Khoa học cho đúng.
            </p>

            <a
              href="#method"
              className="liquid-glass rounded-full px-8 py-3 text-white text-sm font-medium hover:bg-white/5 transition-colors"
            >
              Đọc Tuyên ngôn
            </a>
          </div>

          {/* Quick links — real internal destinations, not fabricated social accounts */}
          <div className="relative z-10 flex justify-center gap-4 pb-12">
            <a href="/library" aria-label="Library" className="liquid-glass rounded-full p-4 text-white/80 hover:text-white hover:bg-white/5 transition-all">
              <Library className="w-5 h-5" />
            </a>
            <a href="/secondbrain" aria-label="Second Brain" className="liquid-glass rounded-full p-4 text-white/80 hover:text-white hover:bg-white/5 transition-all">
              <BookMarked className="w-5 h-5" />
            </a>
            <BookCallButton label="Book a call" className="liquid-glass rounded-full p-4 text-white/80 hover:text-white hover:bg-white/5 transition-all">
              <CalendarClock className="w-5 h-5" />
            </BookCallButton>
          </div>
        </main>

        <AboutSection />
        <FeaturedVideoSection />
        <PhilosophySection />
        <ServicesSection />
      </div>

      <EquationMarquee />

      {/* The Method */}
      <section id="method" className="max-w-7xl mx-auto px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="mb-14 text-center"
        >
          <p className="text-[11px] uppercase tracking-[0.25em] text-purple-300/70 mb-3">The method</p>
          <h2 className="font-garamond text-3xl md:text-4xl text-metallic mb-3">
            <TextReveal per="word" preset="fade" delay={0.1}>
              {"Three steps. No shortcuts."}
            </TextReveal>
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">Every session is the same experiment, run on your own mind.</p>
          <div className="w-56 h-36 mx-auto mt-8 rounded-2xl overflow-hidden glass">
            <WindowStarsScene className="w-full h-full" />
          </div>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          variants={stagger}
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {METHOD_STEPS.map((step, i) => (
            <motion.div
              key={step.title}
              variants={fadeUp}
              transition={{ duration: 0.5 }}
              whileHover={{ y: -6 }}
              className="relative p-8 rounded-3xl glass flex flex-col gap-4"
            >
              <span className="text-xs font-mono text-white/25">{String(i + 1).padStart(2, '0')}</span>
              <step.icon className="w-7 h-7 text-purple-300" strokeWidth={1.5} />
              <h3 className="text-lg font-bold text-white">{step.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{step.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* The Faculty — five native AI personas */}
      <section id="faculty" className="max-w-7xl mx-auto px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="mb-12 text-center"
        >
          <p className="text-[11px] uppercase tracking-[0.25em] text-purple-300/70 mb-3">Not a chatbot. A faculty.</p>
          <h2 className="font-garamond text-3xl md:text-4xl text-metallic mb-3">
            <TextReveal per="word" preset="slide" delay={0.1}>
              {"Five minds. One office each."}
            </TextReveal>
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">Each is a specialist, native to its subject. Hard boundaries — the Grader never coaches, Leo never knows calculus.</p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          variants={stagger}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {FACULTY.map((f) => (
            <motion.div
              key={f.name}
              variants={fadeUp}
              transition={{ duration: 0.5 }}
              whileHover={{ y: -6 }}
              className="p-8 rounded-3xl glass flex flex-col gap-3 hover:shadow-[0_0_40px_rgba(139,92,246,0.12)] transition-shadow duration-300"
            >
              <f.icon className={`w-7 h-7 ${f.accent}`} strokeWidth={1.5} />
              <div>
                <h3 className="text-lg font-bold text-white">{f.name}</h3>
                <p className="text-[10px] uppercase tracking-[0.15em] text-white/35">{f.role}</p>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">{f.body}</p>
            </motion.div>
          ))}

          {/* Second Brain callout — fills the 6th grid slot */}
          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.5 }}
            whileHover={{ y: -6 }}
            className="relative overflow-hidden p-8 rounded-3xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-400/20 flex flex-col gap-3 justify-between"
          >
            <OrbitScene className="absolute inset-0 w-full h-full opacity-40 pointer-events-none" />
            <div className="relative z-10">
              <BookMarked className="w-7 h-7 text-emerald-300 mb-3" strokeWidth={1.5} />
              <h3 className="text-lg font-bold text-white mb-1">Your Second Brain</h3>
              <p className="text-sm text-slate-400 leading-relaxed">Every note, quest, and past mistake feeds the Faculty’s judgment. Add your own material any time, or let Coach request a plan built entirely around it.</p>
            </div>
            <a href="/secondbrain" className="relative z-10 text-xs font-medium text-emerald-300 inline-flex items-center gap-1 hover:text-emerald-200 transition-colors">
              Open your Second Brain <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </motion.div>
        </motion.div>
      </section>

      {/* Library teaser */}
      <section className="max-w-7xl mx-auto px-6 py-4">
        <motion.a
          href="/library"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          whileHover={{ y: -4 }}
          className="block rounded-3xl glass-strong p-10 flex flex-col md:flex-row items-center justify-between gap-6"
        >
          <div className="flex items-center gap-5">
            <div className="hidden sm:block w-20 h-20 rounded-2xl overflow-hidden flex-shrink-0">
              <DeskLampScene className="w-full h-full" />
            </div>
            <Library className="w-10 h-10 text-amber-300 flex-shrink-0" strokeWidth={1.3} />
            <div>
              <h3 className="font-garamond text-2xl text-white mb-1">The Library</h3>
              <p className="text-sm text-slate-400 max-w-lg">Blog write-ups and research papers shared by the community — open to read, no admission required. React, discuss, and publish once you’re in.</p>
            </div>
          </div>
          <span className="text-sm font-medium text-amber-300 inline-flex items-center gap-1.5 shrink-0">
            Browse the Library <ArrowUpRight className="w-4 h-4" />
          </span>
        </motion.a>
      </section>

      {/* Wisdom / rotating quotes band */}
      <section id="voices" className="relative max-w-5xl mx-auto px-6 py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="rounded-3xl glass-strong px-8 py-14"
        >
          <RotatingQuote />
        </motion.div>
      </section>

      {/* Final CTA */}
      <section className="max-w-4xl mx-auto px-6 pb-28 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="rounded-3xl glass p-12 flex flex-col items-center gap-6"
        >
          <Atom className="w-9 h-9 text-purple-300" strokeWidth={1.3} />
          <h2 className="font-garamond text-3xl md:text-4xl text-metallic">
            <TextReveal per="word" preset="blur" delay={0.1}>
              {"Admission is not open."}
            </TextReveal>
          </h2>
          <p className="text-slate-400 max-w-md">One application. Reviewed by hand. Most are declined.</p>
          <LiquidMetalButton
            label="Request Admission"
            onClick={() => onNavigate('apply')}
          />
          <p className="text-xs text-slate-500">We accept those who intend to be excellent.</p>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-sm font-semibold tracking-wider text-white/60">LYCEUM</span>
          <div className="flex items-center gap-6 text-xs text-white/40">
            <a href="/library" className="hover:text-white/70 transition-colors">Library</a>
            <a href="/privacy" className="hover:text-white/70 transition-colors">Quyền riêng tư</a>
            <a href="/terms" className="hover:text-white/70 transition-colors">Điều khoản</a>
            <span className="text-white/30">&copy; {new Date().getFullYear()} The Lyceum Academy</span>
          </div>
        </div>
      </footer>

      <SupportChatWidget context="landing" />
    </div>
  );
}

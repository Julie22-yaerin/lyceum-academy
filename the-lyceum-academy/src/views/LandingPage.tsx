import { useEffect, useState, useRef } from 'react';
import { AnimatePresence, motion, useScroll, useTransform } from 'motion/react';
import {
  ArrowDown,
  AudioLines,
  Brain,
  HelpCircle,
  MessageCircle,
  Sparkles,
  Share2,
  AlertCircle,
  BookOpen,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { NavigationProps } from '../types';
import FeedbackWidget from '../components/FeedbackWidget';
import SupportChatWidget from '../components/SupportChatWidget';
import { useTheme } from '../context/ThemeContext';
import { ShaderAnimation } from '../components/ui/shader-lines';
import { LiquidMetalButton } from '../../components/ui/liquid-metal-button';

// ── Socratic dialogue demo — a scripted exchange showing the method, not the answer ──
const DIALOGUE_SCRIPT: { role: 'student' | 'lyceum'; text: string }[] = [
  { role: 'student', text: 'Why does a ball thrown upward eventually fall back down?' },
  { role: 'lyceum', text: 'What is pulling on the ball the moment it leaves your hand?' },
  { role: 'student', text: 'I guess... gravity? It never really stops acting on it.' },
  { role: 'lyceum', text: 'Exactly — so what does that tell you about the ball’s velocity over time?' },
  { role: 'student', text: 'It keeps decreasing going up, hits zero, then reverses.' },
  { role: 'lyceum', text: 'You found it yourself. What would change if we did this on the Moon?' },
];

const QUOTES = [
  { text: 'The unexamined life is not worth living.', by: 'Socrates' },
  { text: 'I cannot teach anybody anything. I can only make them think.', by: 'Socrates' },
  { text: 'Wonder is the feeling of the philosopher, and philosophy begins in wonder.', by: 'Plato, Theaetetus' },
  { text: 'Education is the kindling of a flame, not the filling of a vessel.', by: 'after Plutarch' },
];

const METHOD_STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: HelpCircle,
    title: 'You bring a question',
    body: 'Not something to memorize — a real question you’re stuck on, from any of ten subjects.',
  },
  {
    icon: MessageCircle,
    title: 'Lyceum asks you back',
    body: 'Instead of giving you the answer, Lyceum asks another question — one that shows what you really understand.',
  },
  {
    icon: Sparkles,
    title: 'You figure it out yourself',
    body: 'It sticks because you found it, not because someone told you. That’s why you still remember it at test time.',
  },
];

const FEATURES: { span: 'lg' | 'sm'; icon: LucideIcon; accent: string; title: string; body: string; list?: string[] }[] = [
  {
    span: 'lg',
    icon: Brain,
    accent: 'text-purple-300',
    title: 'Explain-It-Back Practice',
    body: 'Explain what you learned in your own simple words. Lyceum AI listens for gaps and asks more questions, so you really understand it — instead of just memorizing it.',
  },
  {
    span: 'sm',
    icon: Share2,
    accent: 'text-blue-300',
    title: 'Knowledge Map',
    body: 'Every idea you learn connects to a big map, like branches on a tree — so you always see how everything fits together.',
  },
  {
    span: 'sm',
    icon: AlertCircle,
    accent: 'text-amber-300',
    title: 'Mistake Vault',
    body: 'Your mistakes get saved and sorted. Lyceum brings them back later so you can practice until you get them right for good.',
    list: ['Sign error · Calc II', 'Unit mismatch · Physics', 'Off-by-one · Recursion'],
  },
  {
    span: 'sm',
    icon: BookOpen,
    accent: 'text-cyan-300',
    title: 'Reference Bank',
    body: 'Every source and answer you check gets saved and organized — your own private library you can search anytime.',
  },
];

function DialogueDemo() {
  const [step, setStep] = useState(1);

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => (s >= DIALOGUE_SCRIPT.length ? 1 : s + 1));
    }, 2200);
    return () => clearInterval(id);
  }, []);

  const visible = DIALOGUE_SCRIPT.slice(0, step);

  return (
    <div className="relative w-full max-w-md rounded-3xl glass-strong p-5 flex flex-col gap-3 min-h-[340px]">
      <div className="flex items-center gap-2 pb-2 mb-1 border-b border-white/10">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[11px] uppercase tracking-[0.15em] text-white/40">See it in action</span>
      </div>
      <div className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {visible.map((m, i) => (
            <motion.div
              key={`${step >= i ? 'a' : 'b'}-${i}`}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className={
                m.role === 'student'
                  ? 'self-end max-w-[85%] rounded-2xl rounded-br-sm bg-white/10 px-4 py-2.5 text-[13px] leading-relaxed text-white/90'
                  : 'self-start max-w-[85%] rounded-2xl rounded-bl-sm bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-400/20 px-4 py-2.5 text-[13px] leading-relaxed text-purple-100'
              }
            >
              {m.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
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

// ── Headline word-reveal — splits into words, each rises + sharpens into
// focus. Short headline only (per motion guidance: reserve for <8 words). ──
const wordContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
};

const wordUp = {
  hidden: { opacity: 0, y: 18, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } },
};

function HeadlineReveal({ text }: { text: string }) {
  const words = text.split(' ');
  return (
    <motion.span variants={wordContainer} initial="hidden" animate="show" className="inline">
      {words.map((w, i) => (
        <motion.span key={i} variants={wordUp} className="inline-block mr-[0.28em] will-change-transform">
          {w}
        </motion.span>
      ))}
    </motion.span>
  );
}

// ── Light burst — a radial flash that expands and fades behind the
// headline once on mount, like the "spark" the copy talks about. ──────────
function LightBurst() {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute -z-10"
      style={{
        left: '-10%', top: '-40%', width: '70%', height: '180%',
        background: 'radial-gradient(circle, rgba(216,204,255,0.9) 0%, rgba(167,139,250,0.5) 22%, rgba(139,92,246,0.15) 45%, transparent 70%)',
      }}
      initial={{ opacity: 0, scale: 0.2 }}
      animate={{ opacity: [0, 1, 0.55], scale: [0.2, 1.15, 1] }}
      transition={{ duration: 1.1, times: [0, 0.4, 1], ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
    />
  );
}

// ── Mascot — pinned in the corner and turns to face wherever you've
// scrolled to, via a scroll-linked 3D perspective tilt (not a real 3D
// model — a cheap, GPU-only transform on a single image, tracked across
// the hero + method sections so the "turn" reads clearly as you scroll). ──
function ScrollMascot() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const rotateY = useTransform(scrollYProgress, [0, 1], [-25, 25]);
  const rotateX = useTransform(scrollYProgress, [0, 1], [8, -12]);

  return (
    <div ref={ref} className="hidden lg:block absolute right-8 top-0 w-56 h-[160vh] pointer-events-none z-10" aria-hidden>
      <div className="sticky top-32 flex justify-end" style={{ perspective: 1000 }}>
        <motion.img
          src="/chibi_cat_closeup_portrait.webp"
          alt=""
          className="w-48 drop-shadow-[0_20px_60px_rgba(139,92,246,0.35)] select-none"
          style={{ rotateY, rotateX, transformStyle: 'preserve-3d' }}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          draggable={false}
        />
      </div>
    </div>
  );
}

export default function LandingPage({ onNavigate }: NavigationProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="relative bg-[#050508] text-slate-200 font-sans antialiased overflow-x-hidden selection:bg-purple-500/30 min-h-screen transition-colors duration-500">
      {/* Ambient background orbs */}
      <div className="ambient-orbs">
        <div className="orb-1" />
        <div className="orb-2" />
        <div className="orb-3" />
      </div>

      <ScrollMascot />

      <FeedbackWidget context="landing" />

      {/* Nav */}
      <motion.nav
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="fixed w-full z-50 top-0 px-6 py-4"
      >
        <div className="max-w-7xl mx-auto rounded-full px-6 py-3 flex justify-between items-center glass-strong">
          <div className="flex items-center gap-2 text-xl font-bold tracking-wider text-white">
            <span className="text-metallic">Lyceum</span>
          </div>
          <div className="hidden md:flex space-x-8 text-sm font-medium text-slate-300">
            <a href="#method" className="nav-link">The Method</a>
            <a href="#features" className="nav-link">Features</a>
            <a href="#voices" className="nav-link">Wisdom</a>
          </div>
          <div className="flex items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={toggleTheme}
              aria-label="Toggle light / dark mode"
              className="w-9 h-9 flex items-center justify-center rounded-full text-white glass-btn"
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
            <LiquidMetalButton
              label="Launch Workspace"
              onClick={() => onNavigate('auth')}
            />
          </div>
        </div>
      </motion.nav>

      {/* Hero */}
      <main className="relative max-w-7xl mx-auto px-6 pt-40 pb-24 min-h-screen flex items-center">
        <div className="hero-shader pointer-events-none absolute inset-0 -z-0 overflow-hidden flex items-center justify-center">
          <div className="relative w-full max-w-6xl aspect-[16/10]">
            <ShaderAnimation />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center w-full">
          {/* Left: headline + CTA */}
          <motion.div
            initial="hidden"
            animate="show"
            variants={stagger}
            className="space-y-7 z-10"
          >
            <motion.div variants={fadeUp} transition={{ duration: 0.5 }} className="flex items-center gap-3">
              <div className="relative w-14 h-14 flex-shrink-0">
                <LightBurst />
                <motion.img
                  src="/chibi_cat_closeup_portrait.webp"
                  alt="Lyceum mascot"
                  className="relative w-14 h-14 object-contain drop-shadow-[0_4px_18px_rgba(139,92,246,0.5)]"
                  initial={{ opacity: 0, scale: 0.6, rotate: -8 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  draggable={false}
                />
              </div>
              <span className="text-[11px] uppercase tracking-[0.25em] text-white/40">An AI Tutor That Asks Questions</span>
            </motion.div>

            <div className="relative">
              <h1 className="font-garamond text-5xl md:text-6xl font-medium leading-[1.15] tracking-tight text-metallic">
                <HeadlineReveal text="Great minds aren’t filled," />
                <br />
                <HeadlineReveal text="they’re sparked." />
              </h1>
            </div>

            <motion.p
              variants={fadeUp}
              transition={{ duration: 0.6 }}
              className="text-lg text-slate-400 max-w-lg leading-relaxed"
            >
              Lyceum never just gives you the answer. It asks you one more question — until you find the answer yourself. And what you find yourself, you don&rsquo;t forget.
            </motion.p>

            <motion.div variants={fadeUp} transition={{ duration: 0.6 }} className="pt-2 flex flex-wrap items-center gap-4">
              <LiquidMetalButton
                label="Start Learning"
                onClick={() => onNavigate('auth')}
              />
              <a
                href="#method"
                className="text-sm font-medium text-slate-400 hover:text-white transition-colors inline-flex items-center gap-1.5"
              >
                See how it teaches
                <ArrowDown className="w-4 h-4" />
              </a>
            </motion.div>
          </motion.div>

          {/* Right: live dialogue demo */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="relative w-full flex justify-center lg:justify-end z-10"
          >
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 to-purple-500/20 rounded-full blur-3xl transform scale-75" />
            <DialogueDemo />
          </motion.div>
        </div>
      </main>

      {/* The Method */}
      <section id="method" className="max-w-7xl mx-auto px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="mb-14 text-center"
        >
          <p className="text-[11px] uppercase tracking-[0.25em] text-purple-300/70 mb-3">Questions, not lectures</p>
          <h2 className="font-garamond text-3xl md:text-4xl text-metallic mb-3">How Lyceum teaches</h2>
          <p className="text-slate-400 max-w-xl mx-auto">Every Lyceum session follows the same three simple steps.</p>
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

      {/* Features */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="mb-12 text-center"
        >
          <h2 className="font-garamond text-3xl md:text-4xl text-metallic mb-3">Built for how you actually learn</h2>
          <p className="text-slate-400 max-w-xl mx-auto">Four tools, all working together in one place.</p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          variants={stagger}
          className="grid grid-cols-1 md:grid-cols-3 md:grid-rows-2 gap-6"
        >
          {FEATURES.map((f) => (
            <motion.div
              key={f.title}
              variants={fadeUp}
              transition={{ duration: 0.5 }}
              whileHover={{ y: -6 }}
              className={
                (f.span === 'lg' ? 'md:col-span-2 md:row-span-2 min-h-[280px] ' : '') +
                'p-8 rounded-3xl transition-shadow duration-300 glass flex flex-col justify-between hover:shadow-[0_0_40px_rgba(139,92,246,0.12)]'
              }
            >
              <div>
                <f.icon className={`w-7 h-7 mb-4 ${f.accent}`} strokeWidth={1.5} />
                <h3 className={f.span === 'lg' ? 'text-2xl font-bold text-white mb-3' : 'text-lg font-bold text-white mb-2'}>
                  {f.title}
                </h3>
                <p className={f.span === 'lg' ? 'text-sm text-slate-400 max-w-md leading-relaxed' : 'text-xs text-slate-400 mb-4 leading-relaxed'}>
                  {f.body}
                </p>
              </div>
              {f.list && (
                <div className="mt-auto space-y-2">
                  {f.list.map((item) => (
                    <div key={item} className="flex items-center gap-2 rounded-lg glass-strong px-3 py-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                      <span className="text-[10px] text-white/60 truncate">{item}</span>
                    </div>
                  ))}
                </div>
              )}
              {f.span === 'lg' && (
                <div className="mt-6 rounded-2xl glass-strong p-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-blue-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="h-2 w-3/4 bg-white/15 rounded-full mb-1.5" />
                    <div className="h-2 w-1/2 bg-white/8 rounded-full" />
                  </div>
                  <AudioLines className="w-5 h-5 text-white/30" strokeWidth={1.5} />
                </div>
              )}
            </motion.div>
          ))}
        </motion.div>
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
          <h2 className="font-garamond text-3xl md:text-4xl text-metallic">Start asking questions.</h2>
          <p className="text-slate-400 max-w-md">Ten subjects. One method. No lectures — just the right question, at the right time.</p>
          <LiquidMetalButton
            label="Get Started"
            onClick={() => onNavigate('auth')}
          />
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-sm font-semibold tracking-wider text-white/60">LYCEUM</span>
          <span className="text-xs text-white/30">&copy; {new Date().getFullYear()} The Lyceum Academy &middot; named after the school Aristotle founded</span>
        </div>
      </footer>

      <SupportChatWidget context="landing" />
    </div>
  );
}

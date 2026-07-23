import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDown,
  ArrowUpRight,
  Atom,
  BookMarked,
  Brain,
  Compass,
  FlaskConical,
  Gauge,
  Hammer,
  Landmark,
  Library,
  Lightbulb,
  MessagesSquare,
  Moon,
  Rocket,
  ScanSearch,
  ShieldQuestion,
  Sparkles,
  Sun,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { NavigationProps } from '../types';
import FeedbackWidget from '../components/FeedbackWidget';
import SupportChatWidget from '../components/SupportChatWidget';
import { useTheme } from '../context/ThemeContext';
import { ShaderAnimation } from '../components/ui/shader-lines';
import { LiquidMetalButton } from '../../components/ui/liquid-metal-button';
import { TextReveal } from '../../components/ui/text-reveal';

// ── Socratic dialogue demo — the same method, cycled across the real
// decisions a founder actually gets stuck on, to make the point that this
// isn't generic startup advice: it's one method, aimed at your business. ──
const DIALOGUE_SETS: { role: 'student' | 'lyceum'; text: string }[][] = [
  [
    { role: 'student', text: 'Should I charge $9 or $29 a month for this?' },
    { role: 'lyceum', text: 'Which of your users would cancel at $29 — and why haven’t you asked them?' },
    { role: 'student', text: 'The free-tier ones who never got real value from it.' },
    { role: 'lyceum', text: 'So what does that tell you about who $29 is actually priced for?' },
    { role: 'student', text: 'Not everyone — just the ones already getting value.' },
    { role: 'lyceum', text: 'Exactly. Now — how many of those do you actually have today?' },
  ],
  [
    { role: 'student', text: 'Should I raise a seed round now, or wait?' },
    { role: 'lyceum', text: 'What would $500K let you prove that you can’t prove with $0?' },
    { role: 'student', text: 'Honestly... nothing. I can already test demand with what I have.' },
    { role: 'lyceum', text: 'So what’s actually driving the urge to raise right now?' },
    { role: 'student', text: 'Seeing other founders announce rounds, if I’m being honest.' },
    { role: 'lyceum', text: 'That’s a feeling, not a strategy. What does your own data say?' },
  ],
  [
    { role: 'student', text: 'Why does my MVP feel like it’s taking forever to ship?' },
    { role: 'lyceum', text: 'How many of those features does your first paying customer actually need?' },
    { role: 'student', text: 'Maybe two, out of the eight I’ve built.' },
    { role: 'lyceum', text: 'So what are the other six actually protecting you from?' },
    { role: 'student', text: 'Shipping before it feels "ready."' },
    { role: 'lyceum', text: 'There’s your real blocker. What ships this week if you cut to two?' },
  ],
];

const QUOTES = [
  { text: 'The unexamined life is not worth living.', by: 'Socrates' },
  { text: 'I cannot teach anybody anything. I can only make them think.', by: 'Socrates' },
  { text: 'Do things that don’t scale.', by: 'Paul Graham' },
  { text: 'If you are not embarrassed by the first version of your product, you’ve launched too late.', by: 'Reid Hoffman' },
  { text: 'Make something people want.', by: 'motto, Y Combinator' },
];

const METHOD_STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ShieldQuestion,
    title: 'You bring a real decision',
    body: 'Pricing, hiring, positioning, fundraising — whatever you’re stuck on this week, at this stage.',
  },
  {
    icon: MessagesSquare,
    title: 'We answer with a question',
    body: 'Never advice. One question, aimed exactly at the assumption your decision is resting on.',
  },
  {
    icon: Sparkles,
    title: 'You decide for yourself',
    body: 'Judgment you build under your own power compounds. Borrowed advice doesn’t.',
  },
];

// ── The Faculty — five native AI personas, each with hard role boundaries
// (see backend app/services/ai_roles) — the visual centerpiece replacing a
// generic "features grid." ──────────────────────────────────────────────
const FACULTY: { icon: LucideIcon; name: string; role: string; accent: string; body: string }[] = [
  {
    icon: Compass, name: 'Socrat', role: 'Lead Concierge', accent: 'text-purple-300',
    body: 'Never hands you the playbook. Only asks the question that gets you to your own.',
  },
  {
    icon: Gauge, name: 'Coach', role: 'Curriculum Architect', accent: 'text-blue-300',
    body: 'Reads what you got wrong yesterday. Sequences tomorrow’s stage — gaps first.',
  },
  {
    icon: Brain, name: 'Leo', role: 'The Feynman Child', accent: 'text-amber-300',
    body: 'Explain your business model to Leo in plain words. If he’s confused, so are your customers.',
  },
  {
    icon: FlaskConical, name: 'The Peer', role: 'Debate Partner', accent: 'text-cyan-300',
    body: 'Argues in good faith. Attacks the assumption your whole plan is resting on.',
  },
  {
    icon: ScanSearch, name: 'The Grader', role: 'Solution Auditor', accent: 'text-rose-300',
    body: 'Audits every decision’s logic. Never a false pass.',
  },
];

// ── The Stages — the founder journey Coach actually sequences against.
// This is the core repositioning: not a fixed course, a stage-aware
// curriculum that changes as the business changes. ──────────────────────
const STAGES: { icon: LucideIcon; name: string; body: string }[] = [
  { icon: Lightbulb, name: 'Idea', body: 'Validate before you build. Learn to test demand, not your own ego.' },
  { icon: Hammer, name: 'MVP', body: 'Ship the smallest thing that proves the point. Learn what to cut.' },
  { icon: TrendingUp, name: 'Traction', body: 'First customers, first churn. Learn what retention is actually telling you.' },
  { icon: Landmark, name: 'Fundraising', body: 'Learn the story investors need — and the metrics that make it true.' },
  { icon: Rocket, name: 'Scale', body: 'Learn to hire, delegate, and stop being the bottleneck.' },
];

const PRINCIPLES = [
  'PMF > growth', 'CAC < LTV', 'Runway = Cash / Burn', 'Distribution > Product',
  'Talk to users', 'MRR > vanity metrics', 'Do things that don’t scale', 'Default alive',
];

function DialogueDemo() {
  const [setIdx, setSetIdx] = useState(0);
  const [step, setStep] = useState(1);

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => {
        const script = DIALOGUE_SETS[setIdx];
        if (s >= script.length) {
          setSetIdx((si) => (si + 1) % DIALOGUE_SETS.length);
          return 1;
        }
        return s + 1;
      });
    }, 2200);
    return () => clearInterval(id);
  }, [setIdx]);

  const script = DIALOGUE_SETS[setIdx];
  const visible = script.slice(0, step);

  return (
    <div className="relative w-full max-w-md rounded-3xl glass-strong p-5 flex flex-col gap-3 min-h-[340px]">
      <div className="flex items-center gap-2 pb-2 mb-1 border-b border-white/10">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[11px] uppercase tracking-[0.15em] text-white/40">Same method, every stage of the build</span>
      </div>
      <div className="flex flex-col gap-3">
        <AnimatePresence initial={false} mode="popLayout">
          {visible.map((m, i) => (
            <motion.div
              key={`${setIdx}-${i}`}
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

function PrincipleMarquee() {
  const doubled = [...PRINCIPLES, ...PRINCIPLES];
  return (
    <div className="relative overflow-hidden py-3 border-y border-white/5">
      <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#050508] to-transparent z-10" />
      <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#050508] to-transparent z-10" />
      <motion.div
        className="flex gap-14 whitespace-nowrap font-garamond text-lg text-white/25 italic"
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 32, repeat: Infinity, ease: 'linear' }}
      >
        {doubled.map((p, i) => <span key={i}>{p}</span>)}
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

  return (
    <div className="relative bg-[#050508] text-slate-200 font-sans antialiased overflow-x-hidden selection:bg-purple-500/30 min-h-screen transition-colors duration-500">
      {/* Ambient background orbs */}
      <div className="ambient-orbs">
        <div className="orb-1" />
        <div className="orb-2" />
        <div className="orb-3" />
      </div>

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
            <a href="#stages" className="nav-link">The Stages</a>
            <a href="#faculty" className="nav-link">The Faculty</a>
            <a href="#voices" className="nav-link">Wisdom</a>
            <a href="/library" className="nav-link">Library</a>
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
      <main className="relative max-w-7xl mx-auto px-6 pt-40 pb-16 min-h-screen flex items-center">
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
            <motion.div variants={fadeUp} transition={{ duration: 0.5 }}>
              <span className="text-[11px] uppercase tracking-[0.25em] text-white/40">For founders, by application only</span>
            </motion.div>

            <div className="relative">
              <h1 className="font-garamond text-5xl md:text-6xl font-medium leading-[1.15] tracking-tight text-metallic">
                <TextReveal
                  as="span"
                  className="inline"
                  per="word"
                  preset="fade-in-blur"
                  delay={0.2}
                  speedReveal={1.2}
                >
                  {"We don't teach you everything."}
                </TextReveal>
                <br />
                <TextReveal
                  as="span"
                  className="inline"
                  per="word"
                  preset="fade-in-blur"
                  delay={0.6}
                  speedReveal={1.2}
                >
                  {"We teach you what's next."}
                </TextReveal>
              </h1>
            </div>

            <motion.p
              variants={fadeUp}
              transition={{ duration: 0.6 }}
              className="text-lg text-slate-400 max-w-lg leading-relaxed"
            >
              The Socratic method, 2,400 years old, aimed at exactly one thing: knowing what a
              founder needs to learn right now — and forcing you to actually learn it, stage by stage.
            </motion.p>

            <motion.div variants={fadeUp} transition={{ duration: 0.6 }} className="pt-2 flex flex-wrap items-center gap-4">
              <LiquidMetalButton
                label="Apply as a Founder"
                onClick={() => onNavigate('apply')}
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

      <PrincipleMarquee />

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
          <p className="text-slate-400 max-w-xl mx-auto">Every session is run on your real business, not a hypothetical case study.</p>
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

      {/* The Stages — Coach sequences against wherever the business actually is */}
      <section id="stages" className="max-w-7xl mx-auto px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="mb-14 text-center"
        >
          <p className="text-[11px] uppercase tracking-[0.25em] text-purple-300/70 mb-3">Wherever you are</p>
          <h2 className="font-garamond text-3xl md:text-4xl text-metallic mb-3">
            <TextReveal per="word" preset="slide" delay={0.1}>
              {"Every stage has a different lesson."}
            </TextReveal>
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">
            Coach reads your Second Brain and sequences exactly what this stage demands — not a fixed curriculum.
          </p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          variants={stagger}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5"
        >
          {STAGES.map((s, i) => (
            <motion.div
              key={s.name}
              variants={fadeUp}
              transition={{ duration: 0.5 }}
              whileHover={{ y: -6 }}
              className="relative p-6 rounded-3xl glass flex flex-col gap-3"
            >
              <span className="text-xs font-mono text-white/25">{String(i + 1).padStart(2, '0')}</span>
              <s.icon className="w-6 h-6 text-blue-300" strokeWidth={1.5} />
              <h3 className="text-base font-bold text-white">{s.name}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{s.body}</p>
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
              {"Five minds. One job each."}
            </TextReveal>
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">Hard boundaries. The Grader never coaches. Leo never touches your cap table.</p>
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

          {/* Startup Second Brain callout — fills the 6th grid slot */}
          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.5 }}
            whileHover={{ y: -6 }}
            className="p-8 rounded-3xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-400/20 flex flex-col gap-3 justify-between"
          >
            <div>
              <BookMarked className="w-7 h-7 text-emerald-300 mb-3" strokeWidth={1.5} />
              <h3 className="text-lg font-bold text-white mb-1">Your Startup Second Brain</h3>
              <p className="text-sm text-slate-400 leading-relaxed">Every note, decision, and past mistake feeds the Faculty's judgment. Add your own material any time — pitch decks, customer interviews, financials — or let Coach build a plan around exactly where your startup is.</p>
            </div>
            <a href="/secondbrain" className="text-xs font-medium text-emerald-300 inline-flex items-center gap-1 hover:text-emerald-200 transition-colors">
              Open your Startup Second Brain <ArrowUpRight className="w-3.5 h-3.5" />
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
            <Library className="w-10 h-10 text-amber-300 flex-shrink-0" strokeWidth={1.3} />
            <div>
              <h3 className="font-garamond text-2xl text-white mb-1">The Library</h3>
              <p className="text-sm text-slate-400 max-w-lg">Write-ups and playbooks shared by other founders in the program — open to read, no admission required. React, discuss, and publish once you're in.</p>
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
              {"We don’t open for everyone."}
            </TextReveal>
          </h2>
          <p className="text-slate-400 max-w-md">One application. One minute. Reviewed by hand.</p>
          <LiquidMetalButton
            label="Apply as a Founder"
            onClick={() => onNavigate('apply')}
          />
          <p className="text-xs text-slate-500">Not everyone is accepted.</p>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-sm font-semibold tracking-wider text-white/60">LYCEUM</span>
          <div className="flex items-center gap-6 text-xs text-white/40">
            <a href="/library" className="hover:text-white/70 transition-colors">Library</a>
            <span className="text-white/30">&copy; {new Date().getFullYear()} The Lyceum Academy &middot; named after the school Aristotle founded</span>
          </div>
        </div>
      </footer>

      <SupportChatWidget context="landing" />
    </div>
  );
}

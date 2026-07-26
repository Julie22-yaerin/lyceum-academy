import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDown,
  ArrowUpRight,
  Atom,
  BookMarked,
  Brain,
  CalendarDays,
  Compass,
  Dna,
  FlaskConical,
  Gauge,
  Library,
  MessagesSquare,
  Moon,
  ScanSearch,
  Sigma,
  Sun,
  Timer,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { NavigationProps } from '../types';
import FeedbackWidget from '../components/FeedbackWidget';
import SupportChatWidget from '../components/SupportChatWidget';
import { useTheme } from '../context/ThemeContext';
import { ShaderAnimation } from '../components/ui/shader-lines';
import { LiquidMetalButton } from '../../components/ui/liquid-metal-button';
import { TextReveal } from '../../components/ui/text-reveal';
import { DeskLampScene, OrbitScene } from '../components/landing/LandingScenes';

// ── Socratic dialogue demo — the same method, cycled across unrelated
// domains to make the point that this isn't a "physics tutor with extras":
// it's one method applied to anything. ──────────────────────────────────
const DIALOGUE_SETS: { role: 'student' | 'lyceum'; text: string }[][] = [
  [
    { role: 'student', text: 'Why does a ball thrown upward eventually fall back down?' },
    { role: 'lyceum', text: 'What is pulling on the ball the moment it leaves your hand?' },
    { role: 'student', text: 'Gravity — it never really stops acting on it.' },
    { role: 'lyceum', text: 'So what does that tell you about its velocity over time?' },
    { role: 'student', text: 'It keeps decreasing going up, hits zero, then reverses.' },
    { role: 'lyceum', text: 'You found it yourself. What changes on the Moon?' },
  ],
  [
    { role: 'student', text: 'Why does adding salt make water boil at a higher temperature?' },
    { role: 'lyceum', text: 'What do the salt ions do to the water molecules trying to escape as vapor?' },
    { role: 'student', text: 'They get in the way — fewer molecules can leave the surface.' },
    { role: 'lyceum', text: 'So to reach the same escaping rate, what has to change?' },
    { role: 'student', text: 'You need more heat — a higher temperature.' },
    { role: 'lyceum', text: 'You derived it. Now — what happens to the freezing point?' },
  ],
  [
    { role: 'student', text: 'Why does my proof by induction feel like cheating?' },
    { role: 'lyceum', text: 'What exactly are you assuming true before you’ve proven the next case?' },
    { role: 'student', text: 'That it holds for n — but I haven’t shown that for every n yet.' },
    { role: 'lyceum', text: 'Right — so what makes the base case non-negotiable?' },
    { role: 'student', text: 'Without it the whole chain has nothing to start from.' },
    { role: 'lyceum', text: 'Exactly. Now — where would this argument break for real numbers?' },
  ],
];

const QUOTES = [
  { text: 'The unexamined life is not worth living.', by: 'Socrates' },
  { text: 'I cannot teach anybody anything. I can only make them think.', by: 'Socrates' },
  { text: 'Take nobody’s word for it.', by: 'Nullius in verba' },
  { text: 'What you cannot derive, you do not own.', by: 'The house rule' },
  { text: 'Rigor is a courtesy. We extend it only to the serious.', by: '—' },
];

const METHOD_STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: CalendarDays,
    title: 'You set the week',
    body: 'Pick your days and hours. Three sessions a day, maximum — a plan you can actually keep.',
  },
  {
    icon: Timer,
    title: '45 on. 5–10 off.',
    body: 'Every session runs the same cycle. The break is not optional; it is what makes the next 45 possible.',
  },
  {
    icon: MessagesSquare,
    title: 'One question at a time',
    body: 'Never a wall of text. You get the next question only once you have answered this one.',
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
        <span className="text-[11px] uppercase tracking-[0.15em] text-white/40">Một phương pháp · Toán &amp; Khoa học</span>
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

// Sitewide reveal direction: everything slides in from the left as it
// scrolls into view, text and cards alike.
const fadeUp = {
  hidden: { opacity: 0, x: -40 },
  show: { opacity: 1, x: 0 },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
};

// TRIP — the free, no-login taste of the workspace: one preset concept per
// subject, at /math, /chemistry, /biology, /physics.
const TRIP_SUBJECTS: { path: string; icon: LucideIcon; label: string; concept: string; accent: string }[] = [
  { path: '/math', icon: Sigma, label: 'Toán', concept: 'Hàm hợp', accent: 'text-violet-300' },
  { path: '/chemistry', icon: FlaskConical, label: 'Hoá', concept: 'Orbital nguyên tử', accent: 'text-cyan-300' },
  { path: '/biology', icon: Dna, label: 'Sinh', concept: 'Điện thế hoạt động', accent: 'text-emerald-300' },
  { path: '/physics', icon: Waves, label: 'Lý', concept: 'Dao động điều hoà', accent: 'text-amber-300' },
];



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
          <div className="flex items-center gap-2.5 text-xl font-bold tracking-wider text-white">
            <img src="/logo.png" alt="" className="w-8 h-8 object-contain" />
            <span className="text-metallic">The Lyceum</span>
          </div>
          <div className="hidden md:flex space-x-8 text-sm font-medium text-slate-300">
            <a href="#method" className="nav-link">The Method</a>
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
              <span className="text-[11px] uppercase tracking-[0.25em] text-white/40">Toán &amp; Khoa học · cho người ADHD và khó tập trung</span>
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
                  {"Focus is not willpower."}
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
                  {"It is structure."}
                </TextReveal>
              </h1>
            </div>

            <motion.p
              variants={fadeUp}
              transition={{ duration: 0.6 }}
              className="text-lg text-slate-400 max-w-lg leading-relaxed"
            >
              Dành cho người có ADHD hoặc khó tập trung, học Toán và Khoa học.
              Bạn tự đặt lịch tuần — tối đa 3 buổi mỗi ngày. Mỗi buổi chạy đúng
              một nhịp: 45 phút học, 5–10 phút nghỉ. Không chờ xét duyệt.
            </motion.p>

            <motion.div variants={fadeUp} transition={{ duration: 0.6 }} className="pt-2 flex flex-wrap items-center gap-4">
              <LiquidMetalButton
                label="Bắt đầu học"
                onClick={() => onNavigate('auth')}
              />
              <a
                href="#method"
                className="text-sm font-medium text-slate-400 hover:text-white transition-colors inline-flex items-center gap-1.5"
              >
                Xem cách dạy
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

      <EquationMarquee />

      {/* The Method */}
      <section id="method" className="max-w-7xl mx-auto px-6 py-20">
        <motion.div
          initial={{ opacity: 0, x: -60 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="mb-14 text-center"
        >
          <p className="text-[11px] uppercase tracking-[0.25em] text-purple-300/70 mb-3">The method</p>
          <h2 className="font-garamond text-3xl md:text-4xl text-metallic mb-3">
            <TextReveal per="word" preset="fade" delay={0.1}>
              {"Three rules. Nothing to negotiate."}
            </TextReveal>
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">Attention is a budget, not a virtue. The structure spends yours carefully.</p>
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

      {/* TRIP — free no-login demo, one preset concept per subject */}
      <section id="trip" className="max-w-7xl mx-auto px-6 py-20">
        <motion.div
          initial={{ opacity: 0, x: -60 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="mb-14 text-center"
        >
          <p className="text-[11px] uppercase tracking-[0.25em] text-purple-300/70 mb-3">Không cần đăng nhập</p>
          <h2 className="font-garamond text-3xl md:text-4xl text-metallic mb-3">
            <TextReveal per="word" preset="fade" delay={0.1}>
              {"TRIP — thử trước khi tin."}
            </TextReveal>
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">
            Một khái niệm mẫu cho mỗi môn — tài liệu, podcast, reel, giảng lại cho AI, Lotus Map. Miễn phí, không cần tài khoản.
          </p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          variants={stagger}
          className="grid grid-cols-2 md:grid-cols-4 gap-5"
        >
          {TRIP_SUBJECTS.map(s => (
            <motion.a
              key={s.path}
              href={s.path}
              variants={fadeUp}
              transition={{ duration: 0.5 }}
              whileHover={{ y: -6 }}
              className="relative p-6 rounded-3xl glass flex flex-col gap-3 text-left"
            >
              <s.icon className={`w-7 h-7 ${s.accent}`} strokeWidth={1.5} />
              <span className="text-base font-bold text-white">{s.label}</span>
              <span className="text-xs text-slate-400 leading-relaxed">{s.concept}</span>
              <span className="mt-1 text-[10px] uppercase tracking-[2px] text-white/40 flex items-center gap-1">
                Vào TRIP <ArrowUpRight className="w-3 h-3" />
              </span>
            </motion.a>
          ))}
        </motion.div>
      </section>

      {/* The Faculty — five native AI personas */}
      <section id="faculty" className="max-w-7xl mx-auto px-6 py-20">
        <motion.div
          initial={{ opacity: 0, x: -60 }}
          whileInView={{ opacity: 1, x: 0 }}
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
          initial={{ opacity: 0, x: -60 }}
          whileInView={{ opacity: 1, x: 0 }}
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
          initial={{ opacity: 0, x: -60 }}
          whileInView={{ opacity: 1, x: 0 }}
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
          initial={{ opacity: 0, x: -60 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="rounded-3xl glass p-12 flex flex-col items-center gap-6"
        >
          <Atom className="w-9 h-9 text-purple-300" strokeWidth={1.3} />
          <h2 className="font-garamond text-3xl md:text-4xl text-metallic">
            <TextReveal per="word" preset="blur" delay={0.1}>
              {"No application. No waiting."}
            </TextReveal>
          </h2>
          <p className="text-slate-400 max-w-md">Set your week, then start. Most plans fail for being too big — yours caps at three sessions a day.</p>
          <LiquidMetalButton
            label="Bắt đầu học"
            onClick={() => onNavigate('auth')}
          />
          <p className="text-xs text-slate-500">Bring the difficulty concentrating. We will build around it.</p>
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

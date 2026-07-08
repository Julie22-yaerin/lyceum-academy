import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

type Phase = 'closed' | 'opening' | 'tree' | 'fruit' | 'revealed';

// Trunk first, then branches, then twigs — each wave waits for the previous to mostly finish.
const BRANCHES: { d: string; delay: number; width: number }[] = [
  { d: 'M110,300 C108,258 112,228 110,192', delay: 0, width: 5 },
  { d: 'M110,192 C92,172 72,150 48,118', delay: 0.55, width: 2.6 },
  { d: 'M110,192 C128,172 148,150 172,118', delay: 0.55, width: 2.6 },
  { d: 'M110,192 C111,160 108,128 110,86', delay: 0.55, width: 2.6 },
  { d: 'M72,150 C60,138 44,128 26,110', delay: 1.05, width: 1.8 },
  { d: 'M148,150 C160,138 176,128 194,110', delay: 1.05, width: 1.8 },
  { d: 'M109,128 C98,116 86,106 74,90', delay: 1.05, width: 1.8 },
  { d: 'M111,128 C122,116 134,106 146,90', delay: 1.05, width: 1.8 },
];

const SPARKLES = [
  { x: 26, y: 110 }, { x: 194, y: 110 }, { x: 74, y: 90 }, { x: 146, y: 90 },
  { x: 48, y: 118 }, { x: 172, y: 118 }, { x: 110, y: 86 }, { x: 110, y: 60 },
];

export default function BookTreeIntro({
  onEnter,
  theme = 'dark',
}: {
  onEnter: () => void;
  theme?: 'dark' | 'light';
}) {
  const [phase, setPhase] = useState<Phase>('closed');
  const isLight = theme === 'light';

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase('opening'), 350),
      setTimeout(() => setPhase('tree'), 1250),
      setTimeout(() => setPhase('fruit'), 3050),
      setTimeout(() => setPhase('revealed'), 4150),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const open = phase !== 'closed';
  const showTree = phase === 'tree' || phase === 'fruit' || phase === 'revealed';
  const dropFruit = phase === 'fruit' || phase === 'revealed';

  return (
    <motion.div
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: 'easeInOut' }}
      className={
        'fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden ' +
        (isLight ? 'bg-white' : 'bg-[#050508]')
      }
    >
      <div
        className={
          'absolute w-[520px] h-[520px] rounded-full blur-[100px] pointer-events-none ' +
          (isLight
            ? 'bg-gradient-to-br from-sky-300/30 to-blue-400/25'
            : 'bg-gradient-to-br from-cyan-500/10 to-purple-500/10')
        }
      />

      <div className="relative flex flex-col items-center">
        <svg width="240" height="300" viewBox="0 0 240 300" className="overflow-visible">
          <defs>
            <linearGradient id="glassBranch" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.5" />
              <stop offset="60%" stopColor="#c4b5fd" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#ffffff" />
            </linearGradient>
            <linearGradient id="glassBranchLight" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.55" />
              <stop offset="60%" stopColor="#4f46e5" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#1e293b" />
            </linearGradient>
            <radialGradient id="fruitGlow">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="60%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
            </radialGradient>
          </defs>

          {showTree && BRANCHES.map((b, i) => (
            <motion.path
              key={b.d}
              d={b.d}
              fill="none"
              stroke={isLight ? 'url(#glassBranchLight)' : 'url(#glassBranch)'}
              strokeWidth={b.width}
              strokeLinecap="round"
              style={{
                filter: isLight
                  ? 'drop-shadow(0 0 6px rgba(79,70,229,0.35))'
                  : 'drop-shadow(0 0 6px rgba(196,181,253,0.65))',
              }}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.7, delay: b.delay, ease: 'easeOut' }}
            />
          ))}

          {showTree && SPARKLES.map((s, i) => (
            <motion.circle
              key={`${s.x}-${s.y}`}
              cx={s.x}
              cy={s.y}
              r={2.4}
              fill={isLight ? '#0284c7' : '#e0f2fe'}
              style={{
                filter: isLight
                  ? 'drop-shadow(0 0 4px rgba(2,132,199,0.7))'
                  : 'drop-shadow(0 0 4px rgba(224,242,254,0.9))',
              }}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: [0, 1, 0.5, 1], scale: [0, 1.2, 1, 1.15] }}
              transition={{ duration: 1.8, delay: 1.6 + i * 0.12, repeat: Infinity, repeatType: 'mirror' }}
            />
          ))}

          {dropFruit && (
            <motion.circle
              r={7}
              fill="url(#fruitGlow)"
              style={{ filter: 'drop-shadow(0 0 10px rgba(251,191,36,0.8))' }}
              initial={{ cx: 110, cy: 88, opacity: 0 }}
              animate={{ cx: 110, cy: [88, 88, 296], opacity: [0, 1, 1] }}
              transition={{ duration: 1, delay: 0.1, times: [0, 0.15, 1], ease: ['easeOut', 'easeIn'] }}
            />
          )}
        </svg>

        {/* Book */}
        <div
          className="relative -mt-1 w-[168px] h-[92px]"
          style={{ transformStyle: 'preserve-3d', perspective: 700 }}
        >
          <motion.div
            className="absolute inset-y-0 left-1/2 w-1/2 origin-left rounded-r-lg glass-strong"
            style={{ transformStyle: 'preserve-3d', backfaceVisibility: 'hidden' }}
            animate={{ rotateY: open ? -58 : 0 }}
            transition={{ duration: 0.9, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute inset-y-0 right-1/2 w-1/2 origin-right rounded-l-lg glass-strong"
            style={{ transformStyle: 'preserve-3d', backfaceVisibility: 'hidden' }}
            animate={{ rotateY: open ? 58 : 0 }}
            transition={{ duration: 0.9, ease: 'easeInOut' }}
          />
          <motion.div
            className={
              'absolute top-0 bottom-0 left-1/2 w-1 -translate-x-1/2 rounded-full blur-[1px] bg-gradient-to-b ' +
              (isLight ? 'from-indigo-500 via-sky-500/80 to-purple-500/40' : 'from-white via-cyan-200/70 to-purple-300/30')
            }
            initial={{ opacity: 0 }}
            animate={{ opacity: open ? 1 : 0 }}
            transition={{ duration: 1 }}
          />
        </div>
      </div>

      <AnimatePresence>
        {phase === 'revealed' && (
          <motion.button
            initial={{ opacity: 0, y: 16, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            whileHover={{ scale: 1.05, boxShadow: '0 0 40px rgba(103,232,249,0.4)' }}
            whileTap={{ scale: 0.97 }}
            onClick={onEnter}
            className="mt-10 px-9 py-4 rounded-full text-sm font-semibold tracking-[0.25em] text-white uppercase glass-btn shadow-[0_0_30px_rgba(103,232,249,0.25)]"
          >
            Enter the Pagoda
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

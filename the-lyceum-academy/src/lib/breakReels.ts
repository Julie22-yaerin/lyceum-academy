/**
 * The break-time reel catalogue.
 *
 * One 12-15s vertical short per subject, pre-rendered into
 * public/reels by tools/reels/render.mjs. Each one states a single idea
 * (hook → the idea → four steps → the payoff), which is what makes it usable
 * as passive review during a break rather than just filler.
 *
 * The files are static assets, so no key, no quota and no generation latency
 * at break time — the break starts instantly.
 */

export type ReelId = 'math' | 'chemistry' | 'biology' | 'physics';

export type BreakReel = {
  id: ReelId;
  subject: string;
  emoji: string;
  /** What the reel actually teaches — shown as a caption under the player. */
  headline: string;
  src: string;
  poster: string;
};

export const BREAK_REELS: BreakReel[] = [
  {
    id: 'math',
    subject: 'Toán',
    emoji: '🧠',
    headline: 'Hàm hợp: bóc từng lớp, nhân đạo hàm lại.',
    src: '/reels/math.mp4',
    poster: '/reels/math-poster.jpg',
  },
  {
    id: 'chemistry',
    subject: 'Hoá',
    emoji: '⚛️',
    headline: 'Orbital là vùng xác suất, không phải quỹ đạo.',
    src: '/reels/chemistry.mp4',
    poster: '/reels/chemistry-poster.jpg',
  },
  {
    id: 'biology',
    subject: 'Sinh',
    emoji: '⚡',
    headline: 'Điện thế hoạt động: tất cả hoặc không.',
    src: '/reels/biology.mp4',
    poster: '/reels/biology-poster.jpg',
  },
  {
    id: 'physics',
    subject: 'Lý',
    emoji: '🎢',
    headline: 'Dao động điều hoà là vòng tròn nhìn từ cạnh.',
    src: '/reels/physics.mp4',
    poster: '/reels/physics-poster.jpg',
  },
];

const ROTATION_KEY = 'lyceum_break_reel_rotation';

function nextRotation(): number {
  try {
    const n = Number(localStorage.getItem(ROTATION_KEY) || '0') + 1;
    localStorage.setItem(ROTATION_KEY, String(n));
    return n;
  } catch {
    return 0;
  }
}

/**
 * The playlist for one break: 3-4 reels, the subject being studied first (its
 * idea is the one still warm in working memory), then the others rotated so
 * consecutive breaks don't open with the same clip.
 */
export function pickBreakReels(activeSubject: string | null, count = 4): BreakReel[] {
  const rot = nextRotation();
  const matched = BREAK_REELS.filter(r => r.id === activeSubject);
  const rest = BREAK_REELS.filter(r => r.id !== activeSubject);
  const rotated = rest.map((_, i) => rest[(i + rot) % rest.length]);
  return [...matched, ...rotated].slice(0, Math.max(1, Math.min(count, BREAK_REELS.length)));
}

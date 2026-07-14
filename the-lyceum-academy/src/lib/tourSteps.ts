import type { View } from '../types';
import type { TourStep } from '../components/ProductTour';

function click(selector: string) {
  (document.querySelector(selector) as HTMLElement | null)?.click();
}

/**
 * First-login product tour — left to right across the main dock, then
 * outward to the corner utilities (with two of those drilling into the
 * nested panel they reveal — the same spotlight format applied to a
 * smaller feature inside a bigger one), then one in-page widget.
 */
export function buildTourSteps(onNavigate: (v: View) => void): TourStep[] {
  return [
    {
      target: '[data-tour="dock-nexus"]',
      title: 'Nexus — your dashboard',
      bullets: [
        'Your home base every time you log in.',
        "Shows today's roadmap, streak, and what to study next.",
      ],
      onEnter: () => onNavigate('nexus'),
    },
    {
      target: '[data-tour="dock-dialogue"]',
      title: 'Dialogue',
      bullets: [
        'Talk through a problem with Lyceum AI.',
        "It asks what you think first, then builds a real discussion from your answer — it won't just hand you the answer.",
      ],
    },
    {
      target: '[data-tour="dock-knowledge-map"]',
      title: 'Knowledge Tree',
      bullets: [
        'A visual map of how concepts connect.',
        'Click any node for a quick summary and source.',
      ],
    },
    {
      target: '[data-tour="dock-problem-sets"]',
      title: 'Problem Sets',
      bullets: [
        'Upload a PDF problem set and work through it question by question.',
        'Wrong answers get graded immediately — no waiting until the end.',
        'Stuck? Use the rescue button (max 3 per set) to see the solution and rebuild the reasoning yourself.',
      ],
    },
    {
      target: '[data-tour="dock-notes"]',
      title: 'Feynman Notes',
      bullets: [
        'Turn a PDF, image, or video into a structured note.',
        'Explain it back in your own words to check you actually understood it.',
      ],
    },
    {
      target: '[data-tour="dock-mistake-bank"]',
      title: 'Mistake Vault',
      bullets: [
        'Every wrong answer gets logged here automatically.',
        'Review past mistakes so the same one doesn’t repeat.',
      ],
    },
    {
      target: '[data-tour="dock-reference-bank"]',
      title: 'Reference Bank',
      bullets: [
        'Saved articles, images, and sources ARI finds for you.',
        'Auto-sorted by subject.',
      ],
    },
    {
      target: '[data-tour="dock-progress"]',
      title: 'Progress',
      bullets: [
        'Your grading history and pass rate over time.',
        'Broken down by subject and concept.',
      ],
    },
    {
      target: '[data-tour="corner-brand"]',
      title: 'Lyceum',
      bullets: ['Click anytime to jump straight back to Nexus.'],
    },
    {
      target: '[data-tour="corner-streak"]',
      title: 'Study streak',
      bullets: [
        'Counts the days you’ve shown up in a row.',
        'Click it to see your streak toward the target date you set during onboarding.',
      ],
    },
    {
      target: '[data-tour="streak-panel"]',
      title: 'Streak detail',
      bullets: [
        'A glass pawn for every day you show up.',
        'Reach your target date and it becomes a glass king.',
      ],
      onEnter: () => click('[data-tour="corner-streak"]'),
      onExit: () => click('[data-tour="corner-streak"]'),
    },
    {
      target: '[data-tour="corner-usage"]',
      title: 'AI usage',
      bullets: ['See which AI models have been answering you this session.'],
    },
    {
      target: '[data-tour="usage-panel"]',
      title: 'Usage breakdown',
      bullets: [
        'Per-provider split of calls and tokens used.',
        'Purely informational — nothing here is limited.',
      ],
      onEnter: () => click('[data-tour="corner-usage"]'),
      onExit: () => click('[data-tour="corner-usage"]'),
    },
    {
      target: '[data-tour="roadmap-widget"]',
      title: 'Your learning roadmap',
      bullets: [
        'Type any topic and Lyceum builds a study order for it.',
        'Blended across top-down, bottom-up, and just-in-time based on how you actually learn.',
      ],
      onEnter: () => onNavigate('nexus'),
    },
  ];
}

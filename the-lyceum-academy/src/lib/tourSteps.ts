import type { View } from '../types';
import type { TourStep } from '../components/ProductTour';

/**
 * First-login product tour — walks the student straight into the three
 * core work surfaces in order (Problem Sets, Notes, Mistake Vault),
 * actually navigating into each one so the spotlight sits over live
 * content, not just a dock icon on the Nexus dashboard.
 */
export function buildTourSteps(onNavigate: (v: View) => void): TourStep[] {
  return [
    {
      target: '[data-tour="dock-problem-sets"]',
      title: 'Problem Sets',
      bullets: [
        'Upload a PDF problem set and work through it question by question.',
        'Wrong answers get graded immediately — no waiting until the end.',
        'Stuck? Use the rescue button (max 3 per set) to see the solution and rebuild the reasoning yourself.',
      ],
      onEnter: () => onNavigate('problem-sets'),
    },
    {
      target: '[data-tour="dock-notes"]',
      title: 'Notes',
      bullets: [
        'Turn a PDF, image, or video into a structured note.',
        'Explain it back in your own words to check you actually understood it.',
      ],
      onEnter: () => onNavigate('notes'),
    },
    {
      target: '[data-tour="dock-mistake-bank"]',
      title: 'Mistake Vault',
      bullets: [
        'Every wrong answer gets logged here automatically.',
        'Review past mistakes so the same one doesn’t repeat.',
      ],
      onEnter: () => onNavigate('mistake-bank'),
    },
  ];
}

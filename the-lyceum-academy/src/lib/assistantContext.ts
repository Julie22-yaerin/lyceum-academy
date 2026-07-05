import type { View } from '../types';
import { loadNotes, loadPSets, SUBJECT_META, loadTodayStudySubject } from './persist';
import { loadMistakes } from './mistakes';
import { loadProgress } from './progress';

const VIEW_LABELS: Record<string, string> = {
  nexus: 'Nexus Dashboard (overview)',
  dialogue: 'Socratic Dialogue (chat with AI)',
  'knowledge-map': 'Knowledge Tree (concept map)',
  'problem-sets': 'Problem Sets (assignment sets)',
  exercise: 'Current Thesis (active exercise)',
  'goal-setting': 'Goal Setting',
  notes: 'Feynman Notes',
  progress: 'Progress (study progress)',
  'mistake-bank': 'Mistake Bank',
  community: 'Peer Terminal (community)',
};

const MAIN_CONTENT_SELECTOR = '#lyceum-workspace-content';
const MAX_SCREEN_CHARS = 1400;

function grabVisibleScreenText(): string {
  try {
    const el = document.querySelector(MAIN_CONTENT_SELECTOR);
    if (!el) return '';
    const text = (el as HTMLElement).innerText.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return text.slice(0, MAX_SCREEN_CHARS);
  } catch {
    return '';
  }
}

/** Builds a compact text snapshot of what's on screen + saved app data, for injection into the S2S system prompt. */
export function buildAssistantContext(currentView: View): string {
  const parts: string[] = [];

  parts.push(`The student is currently on screen: ${VIEW_LABELS[currentView] || currentView}.`);

  try {
    const todaySubject = loadTodayStudySubject();
    if (todaySubject) {
      const meta = SUBJECT_META[todaySubject];
      parts.push(`Subject the student chose to focus on today: ${meta ? `${meta.icon} ${meta.label}` : todaySubject}.`);
    }
  } catch { /* ignore */ }

  const screenText = grabVisibleScreenText();
  if (screenText) {
    parts.push(`--- Content currently visible on screen ---\n${screenText}\n--- End of screen content ---`);
  }

  try {
    const notes = loadNotes().slice(0, 3);
    if (notes.length) {
      parts.push('Recently saved notes:\n' + notes.map(n => `• "${n.title}" — ${n.note?.tldr || ''}`).join('\n'));
    }
  } catch { /* ignore */ }

  try {
    const mistakes = loadMistakes().slice(0, 5);
    if (mistakes.length) {
      parts.push('Recent Mistake Bank entries:\n' + mistakes.map(m => `• ${m.mistake} (${m.location})`).join('\n'));
    }
  } catch { /* ignore */ }

  try {
    const psets = loadPSets().slice(0, 3);
    if (psets.length) {
      parts.push('Saved problem sets: ' + psets.map(p => p.id).join(', '));
    }
  } catch { /* ignore */ }

  try {
    const records = loadProgress();
    if (records.length) {
      const allGrades = records.flatMap(r => r.grades);
      const rate = allGrades.length ? Math.round(allGrades.filter(g => g.passed).length / allGrades.length * 100) : 0;
      parts.push(`Overall pass rate: ${rate}% across ${allGrades.length} questions (${records.length} sessions).`);
    }
  } catch { /* ignore */ }

  return parts.join('\n\n');
}

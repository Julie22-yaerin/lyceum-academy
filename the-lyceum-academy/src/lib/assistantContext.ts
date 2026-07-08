import type { View } from '../types';
import { loadNotes, loadPSets, SUBJECT_META, loadTodayStudySubject } from './persist';
import { loadMistakes } from './mistakes';
import { loadProgress } from './progress';
import { getFullProfile } from './profile';

const VIEW_LABELS: Record<string, string> = {
  nexus: 'Nexus Dashboard (overview)',
  dialogue: 'Socratic Dialogue (chat with AI)',
  'knowledge-map': 'Knowledge Tree (concept map)',
  'problem-sets': 'Problem Sets (assignment sets)',
  exercise: 'Current Thesis (active exercise)',
  notes: 'Feynman Notes',
  progress: 'Progress (study progress)',
  'mistake-bank': 'Mistake Bank',
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

/**
 * Builds a compact text snapshot of what's on screen + saved app data, for
 * injection into the S2S system prompt. Async because the personalization
 * profile (lib/profile.ts) is a shared backend store — every AI feature in
 * the app reads the SAME bars, so ARI's behavior stays consistent with what
 * dialogue/grading/Feynman have already measured about this student.
 */
export async function buildAssistantContext(currentView: View): Promise<string> {
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

  // ── Shared personalization profile — same bars every AI feature reads ──
  try {
    const profile = await getFullProfile();
    if (profile) {
      const lines: string[] = [];

      if (profile.needs_attention.length) {
        lines.push('Concepts most needing attention right now: ' +
          profile.needs_attention.map(n => `${n.concept} (${n.subject})`).join(', ') + '.');
      }

      const feared = profile.subjects.filter(s => s.fear_bar >= 12).map(s => s.subject);
      const loved = profile.subjects.filter(s => s.love_bar >= 14).map(s => s.subject);
      if (feared.length) lines.push(`Subjects the student shows avoidance/anxiety signals toward: ${feared.join(', ')} — be extra encouraging, no pressure, celebrate small wins.`);
      if (loved.length) lines.push(`Subjects the student actively engages with (frequent study + peer discussion): ${loved.join(', ')} — safe to go deeper, they're motivated here.`);
      if (profile.discovery_interest_subjects.length) {
        lines.push(`Subjects the student explores beyond what's required: ${profile.discovery_interest_subjects.join(', ')} — worth proactively offering extra material here.`);
      }

      // Teaching style for the concept most in need, as a concrete example
      // of how to calibrate — the same 1-20 bars apply to every concept.
      const top = profile.needs_attention[0];
      const topConcept = top ? profile.concepts.find(c => c.concept === top.concept) : null;
      if (topConcept) {
        const ts = topConcept.teaching_style;
        lines.push(
          `For "${topConcept.concept}": baseline proficiency ${topConcept.baseline_proficiency_bar}/20, ` +
          `confusion frequency ${topConcept.confusion_frequency_bar}/20, knowledge gap ${topConcept.knowledge_gap_bar}/20. ` +
          `Recommended teaching mix — ${ts.baby_mode_pct}% explain-like-5-year-old, ${ts.cross_subject_link_pct}% cross-subject analogies (especially math), ` +
          `${ts.reverse_hypothesis_pct}% reverse-hypothesis/debate. Question-asking frequency: ${topConcept.question_frequency_bar}/20 — ` +
          `${topConcept.question_frequency_bar >= 12 ? 'check in often, this student needs frequent probing.' : 'let them work before interjecting.'}`
        );
      }

      if (lines.length) {
        parts.push('--- Personalization profile (shared across all AI features — same data dialogue/grading/notes use) ---\n' + lines.join('\n'));
      }
    }
  } catch { /* profile fetch failing must never block ARI from starting */ }

  return parts.join('\n\n');
}

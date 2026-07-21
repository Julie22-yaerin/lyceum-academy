/**
 * Spaced Repetition — a lightweight Leitner-style review queue built from
 * the Mistake Bank (past errors) and saved Notes' key concepts. No SRS
 * algorithm needed here beyond leveled intervals: each card has a `level`
 * (0-5); a correct review pushes it to a longer interval, an incorrect
 * review resets it to level 0.
 */
import { loadMistakes } from './mistakes';
import { loadNotes } from './persist';

const KEY = 'lyceum_srs_v1';

// Days until next review, indexed by level (Leitner-box style).
const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];

export interface SrsCard {
  id: string;             // stable id derived from source (mistake id / note+concept)
  front: string;          // the question/prompt side
  back: string;           // the explanation/answer side
  subject: string;
  source: 'mistake' | 'note';
  level: number;          // 0-5
  dueAt: number;           // epoch ms
  createdAt: number;
}

function loadCards(): SrsCard[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

function saveCards(cards: SrsCard[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(cards.slice(0, 500))); } catch { /* quota */ }
}

/** Pull in any new mistakes/notes as level-0 cards due immediately; keeps existing review progress untouched. */
export function syncSrsDeck(): SrsCard[] {
  const existing = loadCards();
  const existingIds = new Set(existing.map(c => c.id));
  const fresh: SrsCard[] = [];

  for (const m of loadMistakes()) {
    const id = `mistake_${m.id}`;
    if (existingIds.has(id)) continue;
    fresh.push({
      id, front: m.mistake, back: m.explanation || '(no explanation saved)',
      subject: m.subject, source: 'mistake', level: 0, dueAt: Date.now(), createdAt: Date.now(),
    });
  }

  for (const n of loadNotes()) {
    const concepts = (n.note?.key_concepts || []) as { concept: string; definition?: string; explanation?: string }[];
    for (const kc of concepts.slice(0, 5)) {
      if (!kc.concept) continue;
      const id = `note_${n.id}_${kc.concept}`;
      if (existingIds.has(id)) continue;
      fresh.push({
        id, front: kc.concept, back: kc.definition || kc.explanation || '(no definition saved)',
        subject: n.subject || 'general', source: 'note', level: 0, dueAt: Date.now(), createdAt: Date.now(),
      });
    }
  }

  const merged = [...existing, ...fresh];
  saveCards(merged);
  return merged;
}

export function loadDueCards(limit = 20): SrsCard[] {
  const now = Date.now();
  return syncSrsDeck().filter(c => c.dueAt <= now).slice(0, limit);
}

export function reviewCard(id: string, correct: boolean): void {
  const cards = loadCards();
  const idx = cards.findIndex(c => c.id === id);
  if (idx === -1) return;
  const card = cards[idx];
  const nextLevel = correct ? Math.min(card.level + 1, INTERVAL_DAYS.length - 1) : 0;
  const days = INTERVAL_DAYS[nextLevel];
  cards[idx] = { ...card, level: nextLevel, dueAt: Date.now() + days * 86400000 };
  saveCards(cards);
}

export function deckStats(): { total: number; due: number } {
  const cards = syncSrsDeck();
  return { total: cards.length, due: cards.filter(c => c.dueAt <= Date.now()).length };
}

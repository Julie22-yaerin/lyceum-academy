import type { View } from '../types';
import { loadNotes, loadPSets, SUBJECT_META, loadTodayStudySubject } from './persist';
import { loadMistakes } from './mistakes';
import { loadProgress } from './progress';

const VIEW_LABELS: Record<string, string> = {
  nexus: 'Nexus Dashboard (trang tổng quan)',
  dialogue: 'Socratic Dialogue (chat với AI)',
  'knowledge-map': 'Knowledge Tree (bản đồ kiến thức)',
  'problem-sets': 'Problem Sets (bộ bài tập)',
  exercise: 'Current Thesis (bài tập đang làm)',
  'goal-setting': 'Goal Setting (đặt mục tiêu)',
  notes: 'Feynman Notes (ghi chú)',
  progress: 'Progress (tiến độ học tập)',
  'mistake-bank': 'Mistake Bank (ngân hàng lỗi sai)',
  community: 'Peer Terminal (cộng đồng)',
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

  parts.push(`Người dùng hiện đang ở màn hình: ${VIEW_LABELS[currentView] || currentView}.`);

  try {
    const todaySubject = loadTodayStudySubject();
    if (todaySubject) {
      const meta = SUBJECT_META[todaySubject];
      parts.push(`Môn học học sinh chọn tập trung hôm nay: ${meta ? `${meta.icon} ${meta.label}` : todaySubject}.`);
    }
  } catch { /* ignore */ }

  const screenText = grabVisibleScreenText();
  if (screenText) {
    parts.push(`--- Nội dung đang hiển thị trên màn hình ---\n${screenText}\n--- Hết nội dung màn hình ---`);
  }

  try {
    const notes = loadNotes().slice(0, 3);
    if (notes.length) {
      parts.push('Ghi chú gần đây đã lưu:\n' + notes.map(n => `• "${n.title}" — ${n.note?.tldr || ''}`).join('\n'));
    }
  } catch { /* ignore */ }

  try {
    const mistakes = loadMistakes().slice(0, 5);
    if (mistakes.length) {
      parts.push('Lỗi sai gần đây trong Mistake Bank:\n' + mistakes.map(m => `• ${m.mistake} (${m.location})`).join('\n'));
    }
  } catch { /* ignore */ }

  try {
    const psets = loadPSets().slice(0, 3);
    if (psets.length) {
      parts.push('Problem sets đang lưu: ' + psets.map(p => p.id).join(', '));
    }
  } catch { /* ignore */ }

  try {
    const records = loadProgress();
    if (records.length) {
      const allGrades = records.flatMap(r => r.grades);
      const rate = allGrades.length ? Math.round(allGrades.filter(g => g.passed).length / allGrades.length * 100) : 0;
      parts.push(`Tỷ lệ đúng tổng thể: ${rate}% trên ${allGrades.length} câu hỏi (${records.length} phiên học).`);
    }
  } catch { /* ignore */ }

  return parts.join('\n\n');
}

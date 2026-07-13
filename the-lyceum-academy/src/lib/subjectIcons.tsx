import {
  Calculator, Zap, FlaskConical, Dna, Code, ScrollText,
  BookOpen, TrendingUp, Brain, Languages, FileText, type LucideIcon,
} from 'lucide-react';

/** SUBJECT_META key -> SVG icon, replacing the old emoji icons. */
export const SUBJECT_ICONS: Record<string, LucideIcon> = {
  math: Calculator,
  physics: Zap,
  chemistry: FlaskConical,
  biology: Dna,
  cs: Code,
  history: ScrollText,
  literature: BookOpen,
  economics: TrendingUp,
  philosophy: Brain,
  english: Languages,
  other: FileText,
};

export function SubjectIcon({ subject, className = 'w-4 h-4' }: { subject: string; className?: string }) {
  const Icon = SUBJECT_ICONS[subject] || FileText;
  return <Icon className={className} />;
}

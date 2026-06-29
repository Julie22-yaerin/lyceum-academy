const toneStyles = {
  accent: "border-sky-400/20 bg-sky-400/10 text-sky-100",
  success: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
  warning: "border-amber-400/20 bg-amber-400/10 text-amber-100",
  neutral: "border-white/10 bg-white/5 text-zinc-200"
} as const;

export function Pill({
  tone = "neutral",
  children
}: {
  tone?: keyof typeof toneStyles;
  children: React.ReactNode;
}) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${toneStyles[tone]}`}>
      {children}
    </span>
  );
}

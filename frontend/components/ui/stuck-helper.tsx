"use client";

import { useState } from "react";
import { ArrowDownToLine, Lightbulb, LineChart, MessageCircleQuestion, X } from "lucide-react";

import type { DemoProblem } from "@/lib/mock-data";

export type StuckHelperAction = "hint" | "visualization" | "alternative" | "simpler";

export function StuckHelper({
  problem,
  onDismiss,
  onAction
}: {
  problem: DemoProblem;
  onDismiss: () => void;
  /** Fired on any action — caller treats this as activity, re-arming the hesitation timer. */
  onAction?: (action: StuckHelperAction) => void;
}) {
  const [expanded, setExpanded] = useState<StuckHelperAction | null>(null);

  function handleAction(action: StuckHelperAction) {
    onAction?.(action);
    if (action === "hint") {
      const el = document.getElementById("hint-ladder-section");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.classList.add("ring-2", "ring-emerald-400/60");
      setTimeout(() => el?.classList.remove("ring-2", "ring-emerald-400/60"), 1500);
      onDismiss();
      return;
    }
    setExpanded(action);
  }

  return (
    <div role="status" className="rounded-[28px] border border-sky-400/20 bg-sky-400/5 p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-zinc-200">Taking a moment? No rush — here are a few ways in, whenever you want.</p>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-zinc-500 hover:text-zinc-300">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionChip icon={Lightbulb} label="Hint" onClick={() => handleAction("hint")} />
        <ActionChip icon={LineChart} label="Visualization" onClick={() => handleAction("visualization")} />
        <ActionChip
          icon={MessageCircleQuestion}
          label="Alternative explanation"
          onClick={() => handleAction("alternative")}
        />
        <ActionChip icon={ArrowDownToLine} label="Simpler prerequisite" onClick={() => handleAction("simpler")} />
      </div>

      {expanded === "visualization" ? <ExpandedCard text={problem.visualizationNote} /> : null}
      {expanded === "alternative" ? <ExpandedCard text={problem.alternativeExplanation} /> : null}
      {expanded === "simpler" ? (
        <ExpandedCard title={problem.simplerPrerequisite.concept} text={problem.simplerPrerequisite.explanation} />
      ) : null}
    </div>
  );
}

function ActionChip({
  icon: Icon,
  label,
  onClick
}: {
  icon: typeof Lightbulb;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 transition-colors hover:bg-white/10"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function ExpandedCard({ title, text }: { title?: string; text: string }) {
  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-[#091022] p-4">
      {title ? <p className="text-sm font-medium text-white">{title}</p> : null}
      <p className="mt-1 text-sm leading-6 text-zinc-400">{text}</p>
    </div>
  );
}

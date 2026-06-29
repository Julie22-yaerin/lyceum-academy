"use client";

import { useState } from "react";
import { Lightbulb } from "lucide-react";

import { mockDelay, useOptimisticAction } from "@/lib/hooks/use-progressive-reveal";
import type { ProblemHint } from "@/lib/mock-data";

/** Render with `key={problemId}` from the caller so state resets when the active problem changes. */
export function HintLadder({
  hints,
  problemId,
  onReveal
}: {
  hints: ProblemHint[];
  problemId: string;
  /** Fired after a hint is revealed — treat as learner activity for hesitation tracking. */
  onReveal?: () => void;
}) {
  const [revealedLevel, setRevealedLevel] = useState(0);

  const { status, trigger } = useOptimisticAction({
    onOptimisticUpdate: () => {
      setRevealedLevel((level) => level + 1);
      onReveal?.();
    },
    action: () => mockDelay(true, 400)
  });

  const visibleHints = hints.filter((hint) => hint.level <= revealedLevel);
  const nextHint = hints.find((hint) => hint.level === revealedLevel + 1);

  return (
    <div id="hint-ladder-section" className="rounded-[28px] border border-white/10 bg-white/5 p-6" data-problem-id={problemId}>
      <div className="flex items-center gap-2 text-zinc-300">
        <Lightbulb className="h-4 w-4" />
        Hint ladder
      </div>

      <div className="mt-6 space-y-3">
        {visibleHints.map((hint) => (
          <div key={hint.level} className="rounded-2xl border border-white/10 bg-[#091022] p-4">
            <p className="text-sm font-medium text-white">{hint.label}</p>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{hint.text}</p>
          </div>
        ))}
      </div>

      {nextHint ? (
        <button
          type="button"
          onClick={trigger}
          disabled={status === "pending"}
          className="mt-4 inline-flex w-full items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
        >
          Reveal hint {nextHint.level} of {hints.length}
        </button>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">That&apos;s all the hints for this problem.</p>
      )}
    </div>
  );
}

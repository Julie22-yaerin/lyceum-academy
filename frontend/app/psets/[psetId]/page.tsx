"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { useGuestProgress } from "@/lib/hooks/use-guest-progress";
import { demoPset } from "@/lib/mock-data";

export default function PsetDetailPage() {
  const routeParams = useParams<{ psetId: string }>();
  const router = useRouter();
  const psetId = routeParams?.psetId ?? "";

  const [activeProblemIndex, setActiveProblemIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // Guest progress — saved to localStorage, persists across sessions
  const { completedIds, markComplete } = useGuestProgress(psetId);

  if (psetId !== demoPset.id) {
    router.replace("/dashboard");
    return null;
  }

  const problem = demoPset.problems[activeProblemIndex];
  const total = demoPset.problems.length;
  const isLast = activeProblemIndex === total - 1;
  const progress = ((activeProblemIndex + 1) / total) * 100;
  const alreadyDone = completedIds.has(problem.id);

  function handleSubmit() {
    if (!answer.trim()) return;
    markComplete(problem.id);
    setSubmitted(true);
  }

  function handleNext() {
    if (!isLast) {
      setActiveProblemIndex((i) => i + 1);
      setAnswer("");
      setSubmitted(false);
    } else {
      router.push("/dashboard");
    }
  }

  return (
    /* Phone-frame wrapper */
    <div className="flex min-h-screen items-center justify-center bg-[#030710] px-4 py-8">
      <div className="relative flex h-[812px] w-[390px] flex-col overflow-hidden rounded-[44px] bg-[#050816] shadow-2xl ring-1 ring-white/10">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-14 pb-3">
          <Link
            href="/dashboard"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/8 text-zinc-400 transition-colors hover:bg-white/15 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="text-[13px] font-medium text-zinc-400">
            {activeProblemIndex + 1} / {total}
          </span>
          <div className="w-9" />
        </div>

        {/* Progress bar */}
        <div className="mx-6 h-[3px] overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Question */}
        <div className="flex-1 overflow-y-auto px-6 pt-8 pb-6">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-400">
            Problem {problem.ordinal}
          </p>
          <h2 className="mb-6 text-[22px] font-bold leading-tight text-white">
            {problem.title}
          </h2>
          <p className="text-[15px] leading-[1.8] text-zinc-300">
            {problem.prompt}
          </p>

          {/* Already completed badge */}
          {alreadyDone && !submitted && (
            <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-[13px] text-emerald-300">
              ✓ Completed — answer again or move on
            </div>
          )}
        </div>

        {/* Fixed bottom: answer + submit */}
        <div className="border-t border-white/8 bg-[#050816] px-6 pb-10 pt-4">
          {!submitted ? (
            <>
              <textarea
                key={`answer-${problem.id}`}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Write your answer…"
                rows={3}
                className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[14px] text-white placeholder-zinc-500 focus:border-emerald-500/40 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!answer.trim()}
                className="mt-3 w-full rounded-2xl bg-emerald-500 py-[15px] text-[15px] font-semibold text-white transition-all disabled:opacity-25 hover:bg-emerald-400 active:scale-[0.98]"
              >
                Submit
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-300">
                Answer submitted ✓ — saved to your device
              </div>
              <button
                type="button"
                onClick={handleNext}
                className="w-full rounded-2xl bg-emerald-500 py-[15px] text-[15px] font-semibold text-white transition-all hover:bg-emerald-400 active:scale-[0.98]"
              >
                {isLast ? "Back to map →" : "Next →"}
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Sun, Moon } from "lucide-react";

import { useGuestProgress } from "@/lib/hooks/use-guest-progress";
import { demoPset } from "@/lib/mock-data";

export default function PsetDetailPage() {
  const routeParams = useParams<{ psetId: string }>();
  const router = useRouter();
  const psetId = routeParams?.psetId ?? "";

  const [activeProblemIndex, setActiveProblemIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [lightMode, setLightMode] = useState(false);
  // Store answers per problem (temporary, lost on page refresh)
  const [savedAnswers, setSavedAnswers] = useState<Record<string, string>>({});

  // Guest progress — saved to localStorage, persists across sessions
  const { completedIds, markComplete } = useGuestProgress(psetId);

  if (psetId !== demoPset.id) {
    router.replace("/dashboard");
    return null;
  }

  const problem = demoPset.problems[activeProblemIndex];
  const total = demoPset.problems.length;
  const isLast = activeProblemIndex === total - 1;
  const isFirst = activeProblemIndex === 0;
  const progress = ((activeProblemIndex + 1) / total) * 100;
  const alreadyDone = completedIds.has(problem.id);

  function saveCurrentAnswer() {
    setSavedAnswers((prev) => ({ ...prev, [problem.id]: answer }));
  }

  function goToProblem(newIndex: number) {
    saveCurrentAnswer();
    setActiveProblemIndex(newIndex);
    // Load saved answer for the target problem
    const targetProblem = demoPset.problems[newIndex];
    setAnswer(savedAnswers[targetProblem.id] ?? "");
    setSubmitted(false);
  }

  function handlePrev() {
    if (!isFirst) goToProblem(activeProblemIndex - 1);
  }

  function handleNext() {
    if (!isLast) goToProblem(activeProblemIndex + 1);
    else router.push("/dashboard");
  }

  function handleSubmit() {
    if (!answer.trim()) return;
    markComplete(problem.id);
    setSubmitted(true);
  }

  // Light mode color schemes
  const bg = lightMode ? "bg-[#f0f2f5]" : "bg-[#030710]";
  const cardBg = lightMode ? "bg-white" : "bg-[#050816]";
  const cardBorder = lightMode ? "ring-1 ring-black/8 shadow-xl" : "ring-1 ring-white/10 shadow-2xl";
  const headerBg = lightMode ? "bg-white/80 backdrop-blur-md" : "bg-[#050816]";
  const bottomBg = lightMode ? "bg-white border-black/8" : "bg-[#050816] border-white/8";
  const textColor = lightMode ? "text-gray-900" : "text-white";
  const subtextColor = lightMode ? "text-gray-500" : "text-zinc-400";
  const promptColor = lightMode ? "text-gray-700" : "text-zinc-300";
  const inputBg = lightMode ? "bg-gray-100 border-black/10 text-gray-900 placeholder-gray-400" : "bg-white/5 border-white/10 text-white placeholder-zinc-500";
  const backBtnBg = lightMode ? "bg-black/8 text-gray-500 hover:bg-black/15 hover:text-gray-900" : "bg-white/8 text-zinc-400 hover:bg-white/15 hover:text-white";
  const progressBg = lightMode ? "bg-black/8" : "bg-white/8";
  const toggleBg = lightMode ? "bg-black/8 text-gray-500 hover:bg-black/15" : "bg-white/8 text-zinc-400 hover:bg-white/15";
  const navBtnDisabled = lightMode ? "opacity-30 cursor-not-allowed" : "opacity-30 cursor-not-allowed";
  const navBtnEnabled = lightMode ? "text-gray-500 hover:text-gray-900 hover:bg-black/8" : "text-zinc-400 hover:text-white hover:bg-white/8";

  return (
    /* Phone-frame wrapper */
    <div className={`flex min-h-screen items-center justify-center ${bg} px-4 py-8 transition-colors`}>
      <div className={`relative flex h-[812px] w-[390px] flex-col overflow-hidden rounded-[44px] ${cardBg} ${cardBorder} transition-colors`}>

        {/* Header */}
        <div className={`flex items-center justify-between px-6 pt-14 pb-3 ${headerBg} transition-colors`}>
          <Link
            href="/dashboard"
            className={`flex h-9 w-9 items-center justify-center rounded-full ${backBtnBg} transition-colors`}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className={`text-[13px] font-medium ${subtextColor}`}>
            {activeProblemIndex + 1} / {total}
          </span>
          {/* Light mode toggle */}
          <button
            type="button"
            onClick={() => setLightMode((v) => !v)}
            className={`flex h-9 w-9 items-center justify-center rounded-full ${toggleBg} transition-colors`}
          >
            {lightMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
        </div>

        {/* Progress bar */}
        <div className={`mx-6 h-[3px] overflow-hidden rounded-full ${progressBg}`}>
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Question */}
        <div className="flex-1 overflow-y-auto px-6 pt-8 pb-6">
          <p className={`mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-500`}>
            Problem {problem.ordinal}
          </p>
          <h2 className={`mb-6 text-[22px] font-bold leading-tight ${textColor}`}>
            {problem.title}
          </h2>
          <p className={`text-[15px] leading-[1.8] ${promptColor}`}>
            {problem.prompt}
          </p>

          {/* Already completed badge */}
          {alreadyDone && !submitted && (
            <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-[13px] text-emerald-500">
              ✓ Completed — answer again or move on
            </div>
          )}
        </div>

        {/* Fixed bottom: answer + submit + navigation */}
        <div className={`border-t ${bottomBg} px-6 pb-10 pt-4 transition-colors`}>
          {!submitted ? (
            <>
              <textarea
                key={`answer-${problem.id}`}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Write your answer…"
                rows={3}
                className={`w-full resize-none rounded-2xl border px-4 py-3 text-[14px] focus:border-emerald-500/40 focus:outline-none transition-colors ${inputBg}`}
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
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-500">
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

          {/* Prev / Next navigation */}
          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={handlePrev}
              disabled={isFirst}
              className={`flex items-center gap-1 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors ${isFirst ? navBtnDisabled : navBtnEnabled}`}
            >
              <ChevronLeft className="h-4 w-4" />
              Câu trước
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={isLast}
              className={`flex items-center gap-1 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors ${isLast ? navBtnDisabled : navBtnEnabled}`}
            >
              Câu tiếp
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

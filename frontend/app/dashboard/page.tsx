"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Flame, Brain, BookOpen, X, LogOut, User } from "lucide-react";

import { LearningTree } from "@/components/ui/learning-tree";
import { IntroAnimation } from "@/components/ui/intro-animation";
import { OnboardingModal, ONBOARDING_DONE_KEY } from "@/components/onboarding/onboarding-modal";
import { useFirebaseAuth } from "@/components/providers/firebase-auth";
import { firebaseSignOut } from "@/lib/firebase/auth";
import { demoPset } from "@/lib/mock-data";
import type { TreeSection } from "@/components/ui/learning-tree";

// ─── Map data ─────────────────────────────────────────────────────────────────

const MAP_SECTIONS: TreeSection[] = [
  {
    id: "foundations",
    title: "Foundations",
    subtitle: "Sets, Logic & Proof",
    nodes: [
      { id: "sets",      label: "Set Theory",          sublabel: "Basics",           state: "mastered",     mastery: 100, href: `/psets/${demoPset.id}` },
      { id: "logic",     label: "Propositional Logic",  sublabel: "Truth tables",     state: "mastered",     mastery: 88,  href: `/psets/${demoPset.id}` },
      { id: "proofs",    label: "Proof Techniques",     sublabel: "Induction",        state: "in_progress",  mastery: 62,  href: `/psets/${demoPset.id}` },
      { id: "induction", label: "Strong Induction",     sublabel: "Advanced proofs",  state: "available",                  href: `/psets/${demoPset.id}` },
    ],
  },
  {
    id: "calculus",
    title: "Calculus",
    subtitle: "Limits, Derivatives & Integrals",
    nodes: [
      { id: "limits",       label: "Limits",         sublabel: "ε–δ definition",       state: "available", href: `/psets/${demoPset.id}` },
      { id: "derivatives",  label: "Derivatives",    sublabel: "Rules & applications",  state: "locked" },
      { id: "integrals",    label: "Integrals",      sublabel: "Definite & indefinite", state: "locked" },
      { id: "multivariable",label: "Multivariable",  sublabel: "Partial derivatives",   state: "locked" },
    ],
  },
  {
    id: "linalg",
    title: "Linear Algebra",
    subtitle: "Vectors, Matrices & Spaces",
    nodes: [
      { id: "vectors",     label: "Vectors & Spaces",   state: "locked" },
      { id: "matrices",    label: "Matrix Operations",  state: "locked" },
      { id: "eigenvalues", label: "Eigenvalues",        state: "locked" },
    ],
  },
];

// ─── Account dropdown ──────────────────────────────────────────────────────────

function AccountMenu() {
  const { user, loading } = useFirebaseAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function handleSignOut() {
    await firebaseSignOut();
    setOpen(false);
  }

  if (loading) return <div className="h-8 w-8 rounded-full bg-white/10 animate-pulse" />;

  // Guest: show Sign in button
  if (!user) {
    return (
      <Link
        href="/login"
        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/10"
      >
        Sign in
      </Link>
    );
  }

  // Logged in: avatar + dropdown
  const initials = (user.displayName ?? user.email ?? "U")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-300 ring-2 ring-emerald-500/30 transition-all hover:ring-emerald-500/60"
      >
        {initials}
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* dropdown */}
          <div className="absolute right-0 top-10 z-50 w-56 rounded-2xl border border-white/10 bg-[#0e1628] p-2 shadow-xl">
            <div className="px-3 py-2">
              <p className="text-sm font-medium text-white truncate">
                {user.displayName ?? "Learner"}
              </p>
              <p className="text-xs text-zinc-500 truncate">{user.email}</p>
            </div>
            <div className="my-1 h-px bg-white/8" />
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-white/8 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const INTRO_KEY = "pclick:intro:seen";

export default function DashboardPage() {
  const { user, loading } = useFirebaseAuth();
  const [showIntro, setShowIntro] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Intro animation (session-scoped)
  useEffect(() => {
    if (!sessionStorage.getItem(INTRO_KEY)) {
      setShowIntro(true);
    }
  }, []);

  // Onboarding modal — show once per account for signed-in users
  useEffect(() => {
    if (loading || !user) return;
    if (!localStorage.getItem(ONBOARDING_DONE_KEY)) {
      setShowOnboarding(true);
    }
  }, [user, loading]);

  const handleIntroDone = useCallback(() => {
    sessionStorage.setItem(INTRO_KEY, "1");
    setShowIntro(false);
  }, []);

  return (
    <div className="min-h-screen" style={{ background: "#050816" }}>
      {showIntro && <IntroAnimation onComplete={handleIntroDone} />}
      {showOnboarding && (
        <OnboardingModal onComplete={() => setShowOnboarding(false)} />
      )}

      {/* ── Top nav ── */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#050816]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-3">

          {/* Logo */}
          <span className="text-sm font-bold tracking-widest text-emerald-400 uppercase">
            Pclick
          </span>

          {/* Stats */}
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-1.5">
              <Flame className="h-4 w-4 text-orange-400" />
              <span className="text-sm font-bold text-white">4</span>
              <span className="text-xs text-zinc-500">day streak</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Brain className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-bold text-white">18</span>
              <span className="text-xs text-zinc-500">concepts</span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5">
              <BookOpen className="h-4 w-4 text-sky-400" />
              <span className="text-sm font-bold text-white">7</span>
              <span className="text-xs text-zinc-500">psets</span>
            </div>
          </div>

          {/* Account */}
          <AccountMenu />
        </div>
      </header>

      {/* ── Guest banner ── */}
      {!user && (
        <div className="mx-auto max-w-2xl px-6 pt-4">
          <div className="flex items-center justify-between rounded-2xl border border-emerald-500/15 bg-emerald-500/8 px-4 py-3 text-sm">
            <div className="flex items-center gap-2 text-emerald-200">
              <User className="h-4 w-4 shrink-0" />
              <span>Playing as guest — progress saved locally</span>
            </div>
            <Link
              href="/login"
              className="shrink-0 rounded-xl bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/30"
            >
              Save progress →
            </Link>
          </div>
        </div>
      )}

      {/* ── Map ── */}
      <main className="mx-auto max-w-2xl px-4 py-6">
        <LearningTree sections={MAP_SECTIONS} />
      </main>

    </div>
  );
}

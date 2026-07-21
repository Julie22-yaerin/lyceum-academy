"use client";

import Link from "next/link";
import ParticlesComponent from "@/components/ui/particles-bg";
import { TiltCard } from "@/components/ui/be-ui-tilt-card";
import {
  Sparkles,
  Brain,
  ArrowRight,
  MessageCircle,
  GitBranch,
  AlertTriangle,
  BookOpen,
} from "lucide-react";

const features = [
  {
    icon: MessageCircle,
    title: "Socratic Dialogue",
    description:
      "AI-guided questioning that leads you to discover answers yourself, building deeper understanding.",
    gradient: "from-cyan-500/20 to-blue-600/20",
    iconColor: "text-cyan-400",
  },
  {
    icon: GitBranch,
    title: "Knowledge Graph",
    description:
      "Visual concept maps that show how ideas connect, revealing the hidden structure of your subject.",
    gradient: "from-blue-500/20 to-indigo-600/20",
    iconColor: "text-blue-400",
  },
  {
    icon: AlertTriangle,
    title: "Mistake Vault",
    description:
      "Capture and revisit errors with targeted explanations so you never repeat the same mistake.",
    gradient: "from-indigo-500/20 to-purple-600/20",
    iconColor: "text-indigo-400",
  },
  {
    icon: BookOpen,
    title: "Reasoning Paths",
    description:
      "Decompose complex problems into structured step-by-step reasoning chains.",
    gradient: "from-purple-500/20 to-cyan-600/20",
    iconColor: "text-purple-400",
  },
];

export default function HomePage() {
  return (
    <main className="relative overflow-hidden">
      <ParticlesComponent />

      <div className="relative z-10">
        <section className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-1.5 text-sm text-cyan-300 backdrop-blur-sm">
            <Sparkles className="h-4 w-4" />
            AI-Powered Learning
          </div>

          <h1 className="max-w-3xl text-5xl font-bold tracking-tight text-white md:text-7xl">
            Think{" "}
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              Deeper
            </span>
            , Learn{" "}
            <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
              Smarter
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-lg text-blue-100/70">
            Decompose difficult problem sets into structured reasoning paths.
            Master concepts through guided Socratic dialogue.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
            <Link
              href="/dashboard"
              className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 transition-all hover:shadow-cyan-500/40 hover:brightness-110"
            >
              Get Started
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="#features"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-8 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/10"
            >
              <Brain className="h-4 w-4" />
              How It Works
            </Link>
          </div>
        </section>

        <section
          id="features"
          className="relative mx-auto max-w-6xl px-6 pb-32 pt-16"
        >
          <div className="mb-14 text-center">
            <h2 className="text-3xl font-bold text-white md:text-4xl">
              How{" "}
              <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                Pclick
              </span>{" "}
              Works
            </h2>
            <p className="mt-3 text-blue-100/60">
              Four pillars of effective learning
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            {features.map((f) => (
              <TiltCard
                key={f.title}
                className={`border border-white/10 bg-gradient-to-br ${f.gradient} p-8 backdrop-blur-xl`}
              >
                <f.icon className={`h-8 w-8 ${f.iconColor}`} />
                <h3 className="mt-4 text-xl font-semibold text-white">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-blue-100/60">
                  {f.description}
                </p>
              </TiltCard>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

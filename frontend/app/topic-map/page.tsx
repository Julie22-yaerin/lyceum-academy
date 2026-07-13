"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Loader2, Network, Search } from "lucide-react";

import { NODE_COLORS, type TopicMap } from "@/lib/topic-map";

// Lazy-load the graph (ReactFlow needs browser APIs)
const TopicMapFlow = dynamic(
  () => import("@/components/ui/topic-map-flow").then((m) => m.TopicMapFlow),
  { ssr: false, loading: () => <GraphSkeleton /> }
);

// ── Skeleton ───────────────────────────────────────────────────────────────────

function GraphSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
    </div>
  );
}

// ── Suggested topics ───────────────────────────────────────────────────────────

const SUGGESTED = [
  "Integral Calculus",
  "Quantum Mechanics",
  "Machine Learning",
  "Number Theory",
  "Linear Algebra",
  "Thermodynamics",
];

// ── Page ───────────────────────────────────────────────────────────────────────

export default function TopicMapPage() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<TopicMap | null>(null);

  async function generate(topic: string) {
    if (!topic.trim()) return;
    setLoading(true);
    setError(null);
    setMap(null);

    try {
      const res = await fetch("http://localhost:8000/ai/topic-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }

      const data: TopicMap = await res.json();
      if (data.error) throw new Error("AI returned invalid JSON — retry");
      setMap(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    generate(input);
  }

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: "#050816" }}
    >
      {/* ── Header ── */}
      <header className="border-b border-white/5 bg-[#050816]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-4">
          <Network className="h-5 w-5 text-emerald-400" />
          <span className="text-sm font-bold tracking-widest text-emerald-400 uppercase">
            Topic Map
          </span>
          <span className="text-xs text-zinc-600 ml-1">powered by Qwen 2.5 14B</span>
        </div>
      </header>

      {/* ── Search bar ── */}
      <div className="mx-auto w-full max-w-2xl px-6 pt-10 pb-6">
        <h1 className="mb-2 text-center text-2xl font-bold text-white">
          Turn any topic into a knowledge graph
        </h1>
        <p className="mb-6 text-center text-sm text-zinc-500">
          AI analyses the topic and builds an Obsidian-style node map of concepts, sub-topics, and connections
        </p>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. Integral Calculus, Machine Learning, Quantum Mechanics…"
              className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-9 pr-4 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-emerald-500/50 focus:bg-white/8 focus:ring-1 focus:ring-emerald-500/30"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="flex items-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Generate"
            )}
          </button>
        </form>

        {/* Suggestions */}
        {!map && !loading && (
          <div className="mt-4 flex flex-wrap gap-2 justify-center">
            {SUGGESTED.map((s) => (
              <button
                key={s}
                onClick={() => { setInput(s); generate(s); }}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-400 transition hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            ⚠ {error}
          </div>
        )}
      </div>

      {/* ── Loading state ── */}
      {loading && (
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 py-16 text-zinc-500">
          <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
          <p className="text-sm">Analysing topic with Qwen 2.5 14B…</p>
          <p className="text-xs text-zinc-600">Building node map, this takes ~10s</p>
        </div>
      )}

      {/* ── Graph ── */}
      {map && !loading && (
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-8">
          {/* Stats bar */}
          <div className="mb-4 flex items-center gap-6 px-2 text-xs text-zinc-500">
            <span className="text-white font-semibold text-base">{map.topic}</span>
            <span>{map.nodes.length} nodes</span>
            <span>{map.edges.length} connections</span>
            <div className="ml-auto flex items-center gap-4">
              {(["root","concept","subtopic","application","prerequisite"] as const).map((t) => {
                const count = map.nodes.filter((n) => n.type === t).length;
                if (!count) return null;
                return (
                  <span key={t} className="flex items-center gap-1">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: NODE_COLORS[t].border }}
                    />
                    {t} ({count})
                  </span>
                );
              })}
            </div>
          </div>

          {/* Graph canvas */}
          <div className="h-[600px] w-full overflow-hidden rounded-2xl border border-white/8 bg-[#080f20]">
            <TopicMapFlow map={map} />
          </div>

          {/* Retry / new topic */}
          <div className="mt-4 flex justify-center gap-3">
            <button
              onClick={() => generate(map.topic)}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-zinc-400 hover:bg-white/10 hover:text-white transition"
            >
              ↻ Regenerate
            </button>
            <button
              onClick={() => { setMap(null); setInput(""); }}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-zinc-400 hover:bg-white/10 hover:text-white transition"
            >
              ＋ New topic
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { NotebookPen, Network, PenTool, StickyNote } from "lucide-react";

import { ConceptMap } from "@/components/workspace/concept-map";
import { DiagramCanvas } from "@/components/workspace/diagram-canvas";
import { Notes } from "@/components/workspace/notes";
import { Scratchpad } from "@/components/workspace/scratchpad";
import type { MasteryItem } from "@/components/ui/knowledge-graph";
import type { ConceptEdge } from "@/lib/mock-data";

type WorkspaceTab = "scratchpad" | "notes" | "diagram" | "concept-map";

const TABS: { id: WorkspaceTab; label: string; icon: typeof NotebookPen }[] = [
  { id: "scratchpad", label: "Scratchpad", icon: NotebookPen },
  { id: "notes", label: "Notes", icon: StickyNote },
  { id: "diagram", label: "Diagram", icon: PenTool },
  { id: "concept-map", label: "Concept map", icon: Network }
];

/** Render with `key={problemId}` from the caller so each problem starts on the default tab. */
export function WorkspacePanel({
  problemId,
  mastery,
  conceptEdges,
  onActivity
}: {
  problemId: string;
  mastery: MasteryItem[];
  conceptEdges: ConceptEdge[];
  onActivity?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("scratchpad");

  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
              activeTab === tab.id ? "bg-emerald-500/15 text-emerald-100" : "text-zinc-400 hover:bg-white/5"
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {activeTab === "scratchpad" ? <Scratchpad problemId={problemId} onActivity={onActivity} /> : null}
        {activeTab === "notes" ? <Notes problemId={problemId} onActivity={onActivity} /> : null}
        {activeTab === "diagram" ? <DiagramCanvas problemId={problemId} onActivity={onActivity} /> : null}
        {activeTab === "concept-map" ? <ConceptMap mastery={mastery} edges={conceptEdges} /> : null}
      </div>
    </div>
  );
}

"use client";

import { useMemo } from "react";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { GROWTH_BAND_LABEL, masteryToGrowthBand } from "@/lib/learning-journey";
import type { MasteryItem } from "@/components/ui/knowledge-graph";
import type { ConceptEdge } from "@/lib/mock-data";

const BAND_COLOR: Record<string, { bg: string; border: string }> = {
  developing: { bg: "#1f2937", border: "#f59e0b" },
  solid: { bg: "#0f2a24", border: "#10b981" },
  strong: { bg: "#0a2e22", border: "#34d399" }
};

export function ConceptMap({ mastery, edges: prerequisiteEdges }: { mastery: MasteryItem[]; edges: ConceptEdge[] }) {
  const nodes: Node[] = useMemo(
    () =>
      mastery.map((item, index) => {
        const band = masteryToGrowthBand(item.mastery);
        const palette = BAND_COLOR[band];
        return {
          id: item.concept,
          position: { x: (index % 2) * 220, y: Math.floor(index / 2) * 140 },
          data: { label: `${item.concept}\n${GROWTH_BAND_LABEL[band]} · ${item.mastery}%` },
          style: {
            background: palette.bg,
            border: `2px solid ${palette.border}`,
            borderRadius: 16,
            color: "#e2e8f0",
            fontSize: 12,
            padding: 10,
            whiteSpace: "pre-line" as const,
            width: 180
          }
        };
      }),
    [mastery]
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      prerequisiteEdges.map((edge) => ({
        id: `${edge.from}->${edge.to}`,
        source: edge.from,
        target: edge.to,
        animated: false,
        style: { stroke: "rgba(255,255,255,0.25)" }
      })),
    [prerequisiteEdges]
  );

  return (
    <div className="h-[420px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#091022]">
      <ReactFlow nodes={nodes} edges={flowEdges} fitView proOptions={{ hideAttribution: true }}>
        <Background color="#1e293b" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

// Shared topic-map domain types and the node color map.
//
// These used to live in `app/topic-map/page.tsx`, but Next.js App Router page
// files may only export a default component plus a fixed set of config fields —
// exporting types/consts from a page breaks the production build. Keeping them
// here lets both the page and the ReactFlow graph component import them.

export interface MapNode {
  id: string;
  label: string;
  type: "root" | "concept" | "subtopic" | "application" | "prerequisite";
  description: string;
}

export interface MapEdge {
  source: string;
  target: string;
  label: string;
}

export interface TopicMap {
  topic: string;
  nodes: MapNode[];
  edges: MapEdge[];
  // Present only when the AI backend returned an error payload instead of a
  // valid map (e.g. unparseable JSON) — checked before render.
  error?: string;
}

// Node color map, shared by the page legend and the graph nodes.
export const NODE_COLORS: Record<MapNode["type"], { bg: string; border: string; text: string }> = {
  root:         { bg: "#0a2e22", border: "#34d399", text: "#a7f3d0" },
  concept:      { bg: "#0f1f3a", border: "#60a5fa", text: "#bfdbfe" },
  subtopic:     { bg: "#1a1a2e", border: "#818cf8", text: "#c7d2fe" },
  application:  { bg: "#1f2a14", border: "#86efac", text: "#bbf7d0" },
  prerequisite: { bg: "#2a1f0a", border: "#fbbf24", text: "#fde68a" },
};

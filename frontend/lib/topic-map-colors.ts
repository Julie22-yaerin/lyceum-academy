import type { MapNode } from "@/app/topic-map/page";

export const NODE_COLORS: Record<MapNode["type"], { bg: string; border: string; text: string }> = {
  root: { bg: "#0a2e22", border: "#34d399", text: "#a7f3d0" },
  concept: { bg: "#0f1f3a", border: "#60a5fa", text: "#bfdbfe" },
  subtopic: { bg: "#1a1a2e", border: "#818cf8", text: "#c7d2fe" },
  application: { bg: "#1f2a14", border: "#86efac", text: "#bbf7d0" },
  prerequisite: { bg: "#2a1f0a", border: "#fbbf24", text: "#fde68a" },
};

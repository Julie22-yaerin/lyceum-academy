"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { TopicMap, MapNode } from "@/lib/topic-map";
import { NODE_COLORS } from "@/lib/topic-map";

// ── Layout: simple radial layout ─────────────────────────────────────────────

function layoutNodes(nodes: MapNode[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const root = nodes.find((n) => n.type === "root");
  const rest = nodes.filter((n) => n.type !== "root");

  const CX = 600, CY = 300;
  if (root) positions[root.id] = { x: CX, y: CY };

  // Group by type, spread in rings
  const byType: Record<string, MapNode[]> = {};
  for (const n of rest) {
    byType[n.type] = [...(byType[n.type] ?? []), n];
  }

  const rings: [string, number][] = [
    ["concept",      200],
    ["subtopic",     350],
    ["application",  280],
    ["prerequisite", 420],
  ];

  for (const [type, radius] of rings) {
    const group = byType[type] ?? [];
    group.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / group.length - Math.PI / 2;
      // offset angle per type to avoid collisions
      const typeOffset = rings.findIndex(([t]) => t === type) * (Math.PI / 4);
      const a = angle + typeOffset;
      positions[n.id] = {
        x: CX + radius * Math.cos(a),
        y: CY + radius * Math.sin(a),
      };
    });
  }

  return positions;
}

// ── Custom node ───────────────────────────────────────────────────────────────

type NodeData = {
  label: string;
  type: MapNode["type"];
  description: string;
};

function TopicNode({ data, selected }: NodeProps<Node<NodeData>>) {
  const colors = NODE_COLORS[data.type];
  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div
        style={{
          background: colors.bg,
          border: `1.5px solid ${selected ? "#fff" : colors.border}`,
          borderRadius: 14,
          padding: "8px 14px",
          minWidth: 120,
          maxWidth: 180,
          boxShadow: selected ? `0 0 12px ${colors.border}66` : `0 0 6px ${colors.border}33`,
          transition: "box-shadow 0.15s",
        }}
      >
        <div
          style={{
            fontSize: data.type === "root" ? 13 : 11,
            fontWeight: data.type === "root" ? 700 : 500,
            color: colors.text,
            textAlign: "center",
            lineHeight: 1.3,
          }}
        >
          {data.label}
        </div>
        {data.type !== "root" && (
          <div
            style={{
              fontSize: 9,
              color: colors.border + "99",
              textAlign: "center",
              marginTop: 2,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {data.type}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </>
  );
}

const nodeTypes = { topicNode: TopicNode };

// ── Main component ────────────────────────────────────────────────────────────

export function TopicMapFlow({ map }: { map: TopicMap }) {
  const [selectedNode, setSelectedNode] = useState<MapNode | null>(null);

  const positions = useMemo(() => layoutNodes(map.nodes), [map.nodes]);

  const initialNodes: Node[] = useMemo(
    () =>
      map.nodes.map((n) => ({
        id: n.id,
        type: "topicNode",
        position: positions[n.id] ?? { x: 0, y: 0 },
        data: { label: n.label, type: n.type, description: n.description },
      })),
    [map.nodes, positions]
  );

  const initialEdges: Edge[] = useMemo(
    () =>
      map.edges.map((e, i) => ({
        id: `e${i}`,
        source: e.source,
        target: e.target,
        label: e.label,
        style: { stroke: "rgba(255,255,255,0.18)", strokeWidth: 1.2 },
        labelStyle: { fill: "rgba(255,255,255,0.35)", fontSize: 9 },
        labelBgStyle: { fill: "transparent" },
        animated: false,
      })),
    [map.edges]
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const found = map.nodes.find((n) => n.id === node.id) ?? null;
      setSelectedNode((prev) => (prev?.id === found?.id ? null : found));
    },
    [map.nodes]
  );

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
      >
        <Background color="#1e293b" gap={28} size={1} />
        <Controls
          showInteractive={false}
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
          }}
        />
        <MiniMap
          nodeColor={(n) => {
            const t = (n.data as NodeData).type as MapNode["type"];
            return NODE_COLORS[t]?.border ?? "#ffffff";
          }}
          style={{
            background: "#080f20",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
          }}
          maskColor="rgba(0,0,0,0.6)"
        />
      </ReactFlow>

      {/* Node detail panel */}
      {selectedNode && (
        <div
          className="absolute bottom-4 left-4 z-10 max-w-xs rounded-2xl border border-white/10 p-4 backdrop-blur-md"
          style={{ background: NODE_COLORS[selectedNode.type].bg + "ee" }}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p
                className="text-sm font-semibold"
                style={{ color: NODE_COLORS[selectedNode.type].text }}
              >
                {selectedNode.label}
              </p>
              <p
                className="text-xs uppercase tracking-widest mt-0.5"
                style={{ color: NODE_COLORS[selectedNode.type].border + "99" }}
              >
                {selectedNode.type}
              </p>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-zinc-500 hover:text-white text-xs mt-0.5"
            >
              ✕
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
            {selectedNode.description}
          </p>
        </div>
      )}
    </div>
  );
}

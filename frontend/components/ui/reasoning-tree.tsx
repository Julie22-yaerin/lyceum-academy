"use client";

import { useState } from "react";

export type ReasoningTreeNode = {
  id: string;
  label: string;
  nodeType: string;
  hintText?: string;
  children?: ReasoningTreeNode[];
};

export function ReasoningTree({
  nodes,
  mode = "full",
  onNodeReveal
}: {
  nodes: ReasoningTreeNode[];
  mode?: "full" | "step";
  onNodeReveal?: (nodeId: string) => void;
}) {
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());

  function reveal(nodeId: string) {
    setRevealedIds((prev) => new Set(prev).add(nodeId));
    onNodeReveal?.(nodeId);
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#091022] p-4">
      <p className="text-sm uppercase tracking-[0.2em] text-zinc-500">Reasoning tree</p>
      <ul className="mt-4 space-y-3">
        {nodes.map((node) => (
          <ReasoningNodeItem
            key={node.id}
            node={node}
            depth={0}
            mode={mode}
            revealedIds={revealedIds}
            onReveal={reveal}
          />
        ))}
      </ul>
    </div>
  );
}

function ReasoningNodeItem({
  node,
  depth,
  mode,
  revealedIds,
  onReveal
}: {
  node: ReasoningTreeNode;
  depth: number;
  mode: "full" | "step";
  revealedIds: Set<string>;
  onReveal: (nodeId: string) => void;
}) {
  const hasChildren = Boolean(node.children?.length);
  const childrenVisible = mode === "full" || revealedIds.has(node.id);

  return (
    <li style={{ marginLeft: depth * 16 }}>
      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
        <p className="text-sm font-medium text-white">{node.label}</p>
        <p className="text-xs uppercase tracking-wide text-zinc-500">{node.nodeType}</p>
        {node.hintText ? <p className="mt-1 text-sm text-zinc-400">{node.hintText}</p> : null}
        {mode === "step" && hasChildren && !childrenVisible ? (
          <button
            type="button"
            onClick={() => onReveal(node.id)}
            className="mt-2 inline-flex items-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20"
          >
            Reveal next step
          </button>
        ) : null}
      </div>
      {hasChildren && childrenVisible ? (
        <ul className="mt-2 space-y-2">
          {node.children!.map((child) => (
            <ReasoningNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              mode={mode}
              revealedIds={revealedIds}
              onReveal={onReveal}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

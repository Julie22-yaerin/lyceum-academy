"use client";

import Link from "next/link";
import { useState } from "react";
import { Lock, Star, BookOpen, Zap, Trophy, Flame } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NodeState = "locked" | "available" | "in_progress" | "mastered";

export type TreeNode = {
  id: string;
  label: string;
  sublabel?: string;
  state: NodeState;
  mastery?: number;
  href?: string;
  icon?: "book" | "zap" | "star" | "trophy";
};

export type TreeSection = {
  id: string;
  title: string;
  subtitle?: string;
  nodes: TreeNode[];
};

// ─── Layout constants ─────────────────────────────────────────────────────────

const W = 340;          // container width (px)
const R = 44;           // circle radius (px)
const STEP = 130;       // vertical gap between node centers (px)
const BANNER_H = 68;    // section banner height (px)
const BANNER_GAP = 28;  // gap below banner before first node
const SECTION_GAP = 48; // gap after last node of a section before next banner

// Zigzag X positions (center of circle, px from left edge of container)
const ZIGZAG_X = [170, 256, 280, 256, 170, 84, 60, 84, 170];

function xAt(globalIndex: number) {
  return ZIGZAG_X[globalIndex % ZIGZAG_X.length];
}

// ─── Curved path between two node centers ────────────────────────────────────

function curvePath(x1: number, y1: number, x2: number, y2: number) {
  const hy = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${hy} ${x2} ${hy} ${x2} ${y2}`;
}

// ─── Node styles ─────────────────────────────────────────────────────────────

const STATE_CIRCLE: Record<NodeState, string> = {
  locked:      "bg-zinc-700 shadow-[0_5px_0_#111827]",
  available:   "bg-emerald-500 shadow-[0_5px_0_#047857] ring-[5px] ring-emerald-400/25",
  in_progress: "bg-emerald-500 shadow-[0_5px_0_#047857] ring-[5px] ring-emerald-400/25",
  mastered:    "bg-yellow-400 shadow-[0_5px_0_#b45309]",
};

const STATE_LABEL: Record<NodeState, string> = {
  locked:      "text-zinc-600",
  available:   "text-zinc-200",
  in_progress: "text-zinc-200",
  mastered:    "text-zinc-200",
};

// ─── Single map node ─────────────────────────────────────────────────────────

function MapNode({
  node,
  cx,
  cy,
}: {
  node: TreeNode;
  cx: number;
  cy: number;
}) {
  const [tip, setTip] = useState(false);

  const circleContent = (
    <>
      {/* Tooltip */}
      {tip && (
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-xl bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-xs text-white z-30 shadow-2xl pointer-events-none">
          {node.label}
        </div>
      )}

      {/* Circle */}
      <div
        className={`flex items-center justify-center rounded-full transition-all duration-150 active:translate-y-[3px] active:shadow-none ${STATE_CIRCLE[node.state]}`}
        style={{ width: R * 2, height: R * 2 }}
      >
        {node.state === "locked" && (
          <Lock className="h-6 w-6 text-zinc-500" />
        )}
        {(node.state === "available" || node.state === "in_progress") && (
          <Star className="h-7 w-7 fill-white/20 text-white stroke-[1.5]" />
        )}
        {node.state === "mastered" && (
          <Star className="h-7 w-7 fill-yellow-700/40 text-yellow-800 stroke-[1.5]" />
        )}

        {/* Animated ring for active node */}
        {node.state === "in_progress" && (
          <div className="absolute inset-0 rounded-full border-4 border-emerald-300/40 animate-ping" />
        )}
      </div>

      {/* Label */}
      <p
        className={`mt-2 text-center text-[11px] font-semibold leading-tight ${STATE_LABEL[node.state]}`}
        style={{ width: 110, marginLeft: -(110 / 2 - R) }}
      >
        {node.label}
      </p>
    </>
  );

  const positionStyle: React.CSSProperties = {
    position: "absolute",
    left: cx - R,
    top: cy - R,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    cursor: node.state === "locked" ? "not-allowed" : "pointer",
  };

  if (node.href && node.state !== "locked") {
    return (
      <Link
        href={node.href}
        style={positionStyle}
        onMouseEnter={() => setTip(true)}
        onMouseLeave={() => setTip(false)}
      >
        {circleContent}
      </Link>
    );
  }

  return (
    <div
      style={positionStyle}
      onMouseEnter={() => setTip(true)}
      onMouseLeave={() => setTip(false)}
    >
      {circleContent}
    </div>
  );
}

// ─── Section banner ───────────────────────────────────────────────────────────

function SectionBanner({
  title,
  subtitle,
  y,
}: {
  title: string;
  subtitle?: string;
  y: number;
}) {
  return (
    <div
      className="absolute left-0 right-0 flex items-center gap-3 rounded-2xl bg-emerald-600 px-5 py-0"
      style={{ top: y, height: BANNER_H }}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 border-2 border-emerald-400">
        <BookOpen className="h-5 w-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-200/70">
          Chapter
        </p>
        <p className="truncate font-bold text-white text-[15px]">{title}</p>
        {subtitle && (
          <p className="text-[11px] text-emerald-200/60 truncate">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-1 rounded-xl border border-emerald-400/30 bg-emerald-700/50 px-3 py-1.5">
        <Zap className="h-3.5 w-3.5 text-emerald-300" />
        <span className="text-[11px] font-semibold text-emerald-200">Active</span>
      </div>
    </div>
  );
}

// ─── Checkpoint node (every ~4 lessons) ──────────────────────────────────────

function CheckpointNode({ cx, cy, unlocked }: { cx: number; cy: number; unlocked: boolean }) {
  return (
    <div
      className="absolute flex flex-col items-center gap-2"
      style={{ left: cx - R, top: cy - R }}
    >
      <div
        className={`flex items-center justify-center rounded-full transition-all ${
          unlocked
            ? "bg-amber-500 shadow-[0_5px_0_#92400e]"
            : "bg-zinc-700 shadow-[0_5px_0_#111827]"
        }`}
        style={{ width: R * 2, height: R * 2 }}
      >
        <Trophy className={`h-7 w-7 ${unlocked ? "text-amber-900" : "text-zinc-500"}`} />
      </div>
      <p className="text-[11px] font-semibold text-zinc-400 mt-1">Checkpoint</p>
    </div>
  );
}

// ─── Mascot characters ───────────────────────────────────────────────────────

function SnakeCharacter() {
  return (
    <svg width="68" height="80" viewBox="0 0 68 80" fill="none">
      {/* coil body */}
      <circle cx="34" cy="54" r="20" stroke="#10b981" strokeWidth="10" strokeLinecap="round" />
      {/* neck */}
      <path d="M 34 34 Q 32 23 38 13" stroke="#10b981" strokeWidth="10" strokeLinecap="round" />
      {/* tail end inside coil */}
      <path d="M 34 34 Q 47 38 47 50" stroke="#10b981" strokeWidth="7" strokeLinecap="round" />
      {/* head */}
      <ellipse cx="43" cy="9" rx="13" ry="9" fill="#059669" transform="rotate(-22,43,9)" />
      {/* eye */}
      <circle cx="50" cy="6" r="3.5" fill="#fef08a" />
      <circle cx="51" cy="6" r="2" fill="#111" />
      {/* tongue */}
      <path d="M 54 11 L 61 8" stroke="#f43f5e" strokeWidth="2" strokeLinecap="round" />
      <path d="M 54 11 L 61 14" stroke="#f43f5e" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CatCharacter() {
  return (
    <svg width="68" height="84" viewBox="0 0 68 84" fill="none">
      {/* body */}
      <ellipse cx="34" cy="64" rx="20" ry="20" fill="#111" />
      {/* head */}
      <circle cx="34" cy="32" r="20" fill="#111" />
      {/* ears */}
      <polygon points="15,20 8,4 23,16" fill="#111" />
      <polygon points="53,20 60,4 45,16" fill="#111" />
      <polygon points="16,19 10,7 21,15" fill="#f9a8d4" opacity="0.55" />
      <polygon points="52,19 58,7 47,15" fill="#f9a8d4" opacity="0.55" />
      {/* eyes */}
      <ellipse cx="25" cy="30" rx="5" ry="6" fill="#f59e0b" />
      <ellipse cx="43" cy="30" rx="5" ry="6" fill="#f59e0b" />
      <ellipse cx="25" cy="30" rx="2.5" ry="6" fill="#111" />
      <ellipse cx="43" cy="30" rx="2.5" ry="6" fill="#111" />
      <circle cx="27" cy="27" r="1.5" fill="white" opacity="0.9" />
      <circle cx="45" cy="27" r="1.5" fill="white" opacity="0.9" />
      {/* nose */}
      <path d="M 31 38 L 34 41 L 37 38" stroke="#f9a8d4" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {/* paws */}
      <ellipse cx="22" cy="81" rx="9" ry="5" fill="#1c1c1c" />
      <ellipse cx="46" cy="81" rx="9" ry="5" fill="#1c1c1c" />
      {/* tail */}
      <path d="M 52 77 Q 68 66 60 50" stroke="#111" strokeWidth="7" strokeLinecap="round" fill="none" />
    </svg>
  );
}

type CharacterDef = {
  type: "snake" | "cat";
  cy: number;
  side: "left" | "right";
  unlocked: boolean;
};

function CharacterSpot({ type, cy, side, unlocked }: CharacterDef) {
  const charH = type === "snake" ? 80 : 84;
  const left = side === "left" ? -(68 + 10) : W + 10;
  return (
    <div
      style={{
        position: "absolute",
        left,
        top: cy - charH / 2,
        pointerEvents: "none",
        filter: unlocked
          ? `drop-shadow(0 0 10px ${type === "snake" ? "#10b981" : "#f59e0b"}) drop-shadow(0 4px 8px rgba(0,0,0,0.7))`
          : "grayscale(1) brightness(0.22)",
        transition: "filter 0.3s ease",
      }}
    >
      {type === "snake" ? <SnakeCharacter /> : <CatCharacter />}
    </div>
  );
}

// ─── Main LearningTree ────────────────────────────────────────────────────────

export function LearningTree({ sections }: { sections: TreeSection[] }) {
  // Pre-compute all node positions
  type NodePos = { node: TreeNode; cx: number; cy: number; globalIndex: number };
  type BannerPos = { section: TreeSection; y: number };

  const nodePosArr: NodePos[] = [];
  const bannerPosArr: BannerPos[] = [];
  const checkpointPosArr: Array<{ cx: number; cy: number; unlocked: boolean }> = [];
  const characterArr: CharacterDef[] = [];

  let currentY = 0;
  let globalIndex = 0;
  let sectionIdx = 0;

  for (const section of sections) {
    // Banner
    bannerPosArr.push({ section, y: currentY });
    currentY += BANNER_H + BANNER_GAP;

    // Nodes
    for (let i = 0; i < section.nodes.length; i++) {
      const cx = xAt(globalIndex);
      const cy = currentY + R;
      nodePosArr.push({ node: section.nodes[i], cx, cy, globalIndex });
      currentY += STEP;
      globalIndex++;

      // Checkpoint after every 4 nodes
      if ((i + 1) % 4 === 0 && i < section.nodes.length - 1) {
        const ccx = xAt(globalIndex);
        const ccy = currentY + R;
        const unlocked = section.nodes[i].state === "mastered";
        checkpointPosArr.push({ cx: ccx, cy: ccy, unlocked });
        currentY += STEP;
        globalIndex++;
      }
    }

    // ── Character between sections ──────────────────────────────────────────
    if (sectionIdx < sections.length - 1) {
      const nextSection = sections[sectionIdx + 1];
      const unlocked = nextSection.nodes[0].state !== "locked";
      characterArr.push({
        type: sectionIdx % 2 === 0 ? "snake" : "cat",
        cy: currentY + 14,   // 14px into the section gap
        side: sectionIdx % 2 === 0 ? "right" : "left",
        unlocked,
      });
    }

    currentY += SECTION_GAP;
    sectionIdx++;
  }

  const totalH = currentY + 80;

  return (
    <div className="relative mx-auto select-none" style={{ width: W, height: totalH }}>
      {/* ── SVG connecting path ── */}
      <svg
        className="absolute inset-0 pointer-events-none overflow-visible"
        width={W}
        height={totalH}
      >
        {nodePosArr.map((np, i) => {
          if (i === nodePosArr.length - 1) return null;
          const next = nodePosArr[i + 1];
          const unlocked = np.node.state !== "locked";
          return (
            <path
              key={`path-${i}`}
              d={curvePath(np.cx, np.cy, next.cx, next.cy)}
              stroke={unlocked ? "#10b981" : "#374151"}
              strokeWidth="3.5"
              strokeDasharray={unlocked ? undefined : "7 5"}
              fill="none"
              opacity={0.45}
              strokeLinecap="round"
            />
          );
        })}
      </svg>

      {/* ── Section banners ── */}
      {bannerPosArr.map(({ section, y }) => (
        <SectionBanner
          key={section.id}
          title={section.title}
          subtitle={section.subtitle}
          y={y}
        />
      ))}

      {/* ── Checkpoint nodes ── */}
      {checkpointPosArr.map((cp, i) => (
        <CheckpointNode key={`cp-${i}`} {...cp} />
      ))}

      {/* ── Pset nodes ── */}
      {nodePosArr.map(({ node, cx, cy }) => (
        <MapNode key={node.id} node={node} cx={cx} cy={cy} />
      ))}

      {/* ── Mascot characters ── */}
      {characterArr.map((ch, i) => (
        <CharacterSpot key={`char-${i}`} {...ch} />
      ))}

      {/* ── End flourish ── */}
      <div
        className="absolute left-0 right-0 flex flex-col items-center gap-2"
        style={{ top: totalH - 70 }}
      >
        <Flame className="h-8 w-8 text-emerald-500 opacity-40" />
        <p className="text-[11px] text-zinc-600">More psets unlocking soon…</p>
      </div>
    </div>
  );
}

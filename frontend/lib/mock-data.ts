import type { MasteryItem } from "@/components/ui/knowledge-graph";
import type { ReasoningTreeNode } from "@/components/ui/reasoning-tree";

export type ProblemHint = {
  level: 1 | 2 | 3;
  label: string;
  text: string;
};

export type DemoProblem = {
  id: string;
  ordinal: number;
  title: string;
  prompt: string;
  difficulty: "easy" | "medium" | "hard" | "extreme";
  cognitiveDepth: string;
  requiredSkills: string[];
  concepts: string[];
  reasoningTree: ReasoningTreeNode[];
  hints: ProblemHint[];
  visualizationNote: string;
  alternativeExplanation: string;
  simplerPrerequisite: {
    concept: string;
    explanation: string;
  };
};

export type DemoPset = {
  id: string;
  title: string;
  course: string;
  field: string;
  subfield: string;
  status: string;
  summary: string;
  problems: DemoProblem[];
};

export const demoPset: DemoPset = {
  id: "demo-pset-1",
  title: "Optimization & Constrained Extrema",
  course: "MATH 21A",
  field: "mathematics",
  subfield: "calculus",
  status: "ready",
  summary: "5 problems on constrained extrema — AI-decomposed into a reasoning tree with concept tagging.",
  problems: [
    {
      id: "problem-1",
      ordinal: 1,
      title: "Maximize area of inscribed rectangle",
      prompt:
        "Find the dimensions of the rectangle with maximum area inscribed in the semi-ellipse x²/a² + y²/b² = 1, y ≥ 0.",
      difficulty: "hard",
      cognitiveDepth: "level_3",
      requiredSkills: ["Partial derivatives", "Lagrange multiplier"],
      concepts: ["Constrained extrema", "Partial derivatives"],
      reasoningTree: [
        {
          id: "node-1",
          label: "Define objective function",
          nodeType: "setup",
          hintText: "Area S = 2x·y with (x, y) on the ellipse.",
          children: [
            {
              id: "node-2",
              label: "Apply the constraint",
              nodeType: "constraint",
              hintText: "Use x²/a² + y²/b² = 1 to eliminate one variable.",
              children: [
                {
                  id: "node-3",
                  label: "Solve derivative = 0",
                  nodeType: "solve"
                }
              ]
            }
          ]
        }
      ],
      hints: [
        {
          level: 1,
          label: "Nudge",
          text: "Identify the type of mathematical object being optimized before choosing a tool."
        },
        {
          level: 2,
          label: "Strategy",
          text: "There is a constraint — decide whether you're working in the interior or on the boundary."
        },
        {
          level: 3,
          label: "Reasoning scaffold",
          text: "Use the constraint to eliminate one variable, then set the derivative of the remaining single-variable expression to zero."
        }
      ],
      visualizationNote:
        "Sketch the semi-ellipse and an inscribed rectangle with one corner at (x, y) on the curve — label x, y, a, b on your scratchpad or diagram.",
      alternativeExplanation:
        "Think of it as: you have one degree of freedom (a single point on the curve), and you're trying to make a rectangle as big as possible around it. The constraint just tells you which (x, y) pairs are even allowed.",
      simplerPrerequisite: {
        concept: "Single-variable optimization",
        explanation: "Before constraints enter the picture, practice finding the max of a one-variable function by setting its derivative to zero — that's the core move you'll reuse here."
      }
    },
    {
      id: "problem-2",
      ordinal: 2,
      title: "Unconstrained extrema of two-variable function",
      prompt: "Find the extrema of f(x, y) = x³ + y³ − 3xy.",
      difficulty: "medium",
      cognitiveDepth: "level_2",
      requiredSkills: ["Partial derivatives", "Hessian matrix"],
      concepts: ["Critical points", "Hessian test"],
      reasoningTree: [
        {
          id: "node-4",
          label: "Find critical points",
          nodeType: "setup",
          children: [
            {
              id: "node-5",
              label: "Classify via Hessian",
              nodeType: "solve"
            }
          ]
        }
      ],
      hints: [
        {
          level: 1,
          label: "Nudge",
          text: "Start by setting both partial derivatives to zero — critical points come first."
        },
        {
          level: 2,
          label: "Strategy",
          text: "Once you have the critical points, you need a second-order test to classify each one."
        },
        {
          level: 3,
          label: "Reasoning scaffold",
          text: "Build the Hessian matrix at each critical point and check its determinant and sign to classify max, min, or saddle."
        }
      ],
      visualizationNote:
        "Picture the surface z = f(x, y) near each critical point — sketch whether it curves up in both directions (bowl), down in both (dome), or up in one and down in the other (saddle).",
      alternativeExplanation:
        "A critical point is just where the surface is momentarily flat. The Hessian test is the 2D version of the second-derivative test you already know from single-variable calculus — it tells you which kind of 'flat' you found.",
      simplerPrerequisite: {
        concept: "Second-derivative test (1D)",
        explanation: "Review how the sign of f''(x) classifies a critical point as a max or min in one variable — the Hessian test generalizes exactly this idea to two variables."
      }
    }
  ]
};

export const mastery: MasteryItem[] = [
  { concept: "Partial derivatives", mastery: 78, confidence: 82 },
  { concept: "Constrained extrema", mastery: 64, confidence: 70 },
  { concept: "Hessian matrix", mastery: 55, confidence: 60 },
  { concept: "Lagrange multiplier", mastery: 41, confidence: 50 }
];

export type ConceptEdge = { from: string; to: string };

export const conceptPrerequisites: ConceptEdge[] = [
  { from: "Partial derivatives", to: "Hessian matrix" },
  { from: "Partial derivatives", to: "Lagrange multiplier" },
  { from: "Lagrange multiplier", to: "Constrained extrema" },
  { from: "Hessian matrix", to: "Constrained extrema" }
];

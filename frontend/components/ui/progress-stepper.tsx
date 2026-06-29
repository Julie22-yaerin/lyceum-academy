import { Check } from "lucide-react";

export type ProgressStepperItem = {
  id: string;
  ordinal: number;
  title: string;
  state: "completed" | "active" | "upcoming";
};

export function ProgressStepper({
  items,
  onSelect
}: {
  items: ProgressStepperItem[];
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 p-5">
      <p className="text-sm uppercase tracking-[0.2em] text-zinc-500">Problems</p>
      <div className="mt-4 space-y-2">
        {items.map((item) => {
          const clickable = item.state !== "upcoming" && Boolean(onSelect);
          return (
            <button
              key={item.id}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelect?.(item.id)}
              className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                item.state === "active"
                  ? "border-emerald-500/40 bg-emerald-500/10"
                  : item.state === "completed"
                    ? "border-white/10 bg-[#091022] hover:bg-white/5"
                    : "border-white/5 bg-transparent opacity-50"
              } ${clickable ? "cursor-pointer" : "cursor-default"}`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                  item.state === "completed"
                    ? "border-emerald-500 bg-emerald-900/40 text-emerald-300"
                    : item.state === "active"
                      ? "ring-pulse border-emerald-400 bg-emerald-500/20 text-emerald-200"
                      : "border-zinc-700 bg-zinc-800/60 text-zinc-500"
                }`}
              >
                {item.state === "completed" ? <Check className="h-3.5 w-3.5" /> : item.ordinal}
              </span>
              <span className={`truncate text-sm ${item.state === "upcoming" ? "text-zinc-500" : "text-white"}`}>
                {item.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

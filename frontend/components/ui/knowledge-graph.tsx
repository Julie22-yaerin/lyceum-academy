import { GROWTH_BAND_LABEL, masteryToGrowthBand } from "@/lib/learning-journey";

export type MasteryItem = {
  concept: string;
  mastery: number;
  confidence: number;
};

export function KnowledgeGraph({ items }: { items: MasteryItem[] }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
      <p className="text-sm uppercase tracking-[0.2em] text-zinc-500">Knowledge graph</p>
      <div className="mt-6 space-y-4">
        {items.map((item) => {
          const band = masteryToGrowthBand(item.mastery);
          return (
            <div key={item.concept}>
              <div className="flex items-center justify-between text-sm text-zinc-300">
                <span>{item.concept}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-emerald-400">{GROWTH_BAND_LABEL[band]}</span>
                  <span className="text-zinc-500">{item.mastery}%</span>
                </span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-white/10">
                <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${item.mastery}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

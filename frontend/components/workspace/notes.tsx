"use client";

import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";

export function Notes({ problemId, onActivity }: { problemId: string; onActivity?: () => void }) {
  const [value, setValue] = useLocalStorageState(`pclick:notes:${problemId}`, "");

  return (
    <textarea
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        onActivity?.();
      }}
      placeholder="Notes — takeaways, formulas, things to remember."
      rows={10}
      className="w-full resize-none rounded-2xl border border-white/10 bg-[#091022] p-4 text-sm leading-6 text-zinc-200 outline-none focus:border-emerald-400/40"
    />
  );
}

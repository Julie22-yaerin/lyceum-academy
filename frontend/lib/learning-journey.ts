export type GrowthBand = "developing" | "solid" | "strong";

export const GROWTH_BAND_LABEL: Record<GrowthBand, string> = {
  developing: "Developing",
  solid: "Solid",
  strong: "Strong"
};

/** Thresholds chosen to favor qualitative growth framing over raw-score anxiety. */
export function masteryToGrowthBand(mastery: number): GrowthBand {
  if (mastery >= 75) return "strong";
  if (mastery >= 45) return "solid";
  return "developing";
}

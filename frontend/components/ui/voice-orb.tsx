"use client";

import { useState, useEffect, useCallback } from "react";

type OrbState = "idle" | "listening" | "thinking" | "speaking";

export function VoiceOrb() {
  const [state, setState] = useState<OrbState>("idle");

  const cycleState = useCallback(() => {
    setState("listening");
    setTimeout(() => setState("thinking"), 2000);
    setTimeout(() => setState("speaking"), 3500);
    setTimeout(() => setState("idle"), 5500);
  }, []);

  useEffect(() => {
    const interval = setInterval(cycleState, 10000);
    return () => clearInterval(interval);
  }, [cycleState]);

  const isActive = state !== "idle";

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-float">
      <div className="orb-container">
        <div
          className={`orb-ring-expand ${state === "listening" ? "listening" : ""}`}
          style={{ display: isActive ? "block" : "none" }}
        />
        <div className="orb-glass" />
        <div className="orb-core">
          <div className="orb-core-inner" />
        </div>
        <div
          className="orb-ring"
          style={{
            animationDuration: state === "idle" ? "4s" : "2s",
            opacity: isActive ? 1 : 0.4,
            borderColor: state === "speaking"
              ? "rgba(52,211,153,0.3)"
              : state === "thinking"
                ? "rgba(167,139,250,0.3)"
                : "rgba(129,140,248,0.15)"
          }}
        />
        {state === "speaking" && (
          <div className="orb-waveform">
            <span /><span /><span /><span /><span />
          </div>
        )}
      </div>
    </div>
  );
}

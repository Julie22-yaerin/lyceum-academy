/**
 * LandingScenes — small looping SVG vignettes for the spots on the landing
 * page that don't have real photography/video yet. Pure CSS/SMIL loops
 * (see the .scene-* keyframes in index.css), no external assets, no video
 * generation dependency — a stand-in until real footage exists.
 */

export function WindowStarsScene({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 280 180" className={className} preserveAspectRatio="xMidYMid slice">
      <rect width="280" height="180" fill="#0b0e1c" />
      {/* stars */}
      {STAR_POSITIONS.map((s, i) => (
        <circle
          key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff"
          className="scene-twinkle" style={{ animationDelay: `${s.delay}s` }}
        />
      ))}
      {/* moon */}
      <circle cx="226" cy="34" r="14" fill="#f3e9c8" className="scene-moon-glow" />
      {/* shooting star */}
      <line x1="40" y1="30" x2="66" y2="42" stroke="#fff" strokeWidth="2" strokeLinecap="round"
        className="scene-shooting-star" opacity="0" />
      {/* window frame */}
      <rect x="90" y="10" width="100" height="130" rx="6" fill="none" stroke="#e8e6df" strokeWidth="5" />
      <line x1="140" y1="10" x2="140" y2="140" stroke="#e8e6df" strokeWidth="4" />
      <line x1="90" y1="75" x2="190" y2="75" stroke="#e8e6df" strokeWidth="4" />
      {/* sill */}
      <rect x="82" y="140" width="116" height="8" rx="2" fill="#e8e6df" />
      {/* boy silhouette, standing at the sill looking up */}
      <g className="scene-boy-bob">
        <circle cx="140" cy="122" r="9" fill="#0b0e1c" />
        <path d="M126 148 Q140 118 154 148 L152 160 Q140 152 128 160 Z" fill="#0b0e1c" />
      </g>
    </svg>
  );
}

const STAR_POSITIONS = [
  { x: 30, y: 20, r: 1.4, delay: 0 }, { x: 55, y: 55, r: 1, delay: 0.6 },
  { x: 18, y: 90, r: 1.6, delay: 1.2 }, { x: 70, y: 18, r: 1, delay: 1.8 },
  { x: 105, y: 25, r: 1.2, delay: 0.3 }, { x: 175, y: 22, r: 1.3, delay: 2.1 },
  { x: 205, y: 60, r: 1, delay: 0.9 }, { x: 250, y: 90, r: 1.5, delay: 1.5 },
  { x: 260, y: 40, r: 1, delay: 2.6 }, { x: 15, y: 140, r: 1.2, delay: 3.1 },
  { x: 240, y: 130, r: 1.4, delay: 1.0 }, { x: 195, y: 100, r: 1, delay: 3.6 },
];

export function DeskLampScene({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 280 180" className={className} preserveAspectRatio="xMidYMid slice">
      <rect width="280" height="180" fill="#12100c" />
      {/* warm glow */}
      <circle cx="150" cy="70" r="46" fill="#f5a623" opacity="0.25" className="scene-lamp-glow" />
      {/* rising dust/light motes */}
      {DUST_POSITIONS.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.r} fill="#f5c877"
          className="scene-dust-rise" style={{ animationDelay: `${p.delay}s` }} />
      ))}
      {/* lamp arm + shade */}
      <line x1="70" y1="150" x2="70" y2="95" stroke="#e8e6df" strokeWidth="4" />
      <line x1="70" y1="95" x2="140" y2="70" stroke="#e8e6df" strokeWidth="4" />
      <path d="M118 58 L164 58 L154 82 L128 82 Z" fill="#e8e6df" />
      <rect x="58" y="148" width="24" height="8" rx="2" fill="#e8e6df" />
      {/* open book */}
      <path d="M90 152 Q140 138 190 152 L190 160 Q140 148 90 160 Z" fill="#e8e6df" />
      <line x1="140" y1="140" x2="140" y2="154" stroke="#12100c" strokeWidth="1.5" opacity="0.5" />
    </svg>
  );
}

const DUST_POSITIONS = [
  { x: 140, y: 120, r: 1.4, delay: 0 }, { x: 160, y: 130, r: 1, delay: 1.4 },
  { x: 125, y: 128, r: 1.2, delay: 2.6 }, { x: 150, y: 116, r: 1, delay: 0.7 },
];

export function OrbitScene({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 280 180" className={className} preserveAspectRatio="xMidYMid meet">
      <ellipse id="orbitA" cx="140" cy="90" rx="110" ry="34" fill="none" stroke="#a78bfa" strokeOpacity="0.35" />
      <ellipse id="orbitB" cx="140" cy="90" rx="34" ry="66" fill="none" stroke="#818cf8" strokeOpacity="0.35"
        transform="rotate(20 140 90)" />
      <circle cx="140" cy="90" r="6" fill="#f87171" />
      <circle r="4.5" fill="#c4b5fd">
        <animateMotion dur="5s" repeatCount="indefinite">
          <mpath href="#orbitA" />
        </animateMotion>
      </circle>
      <circle r="4" fill="#a5b4fc">
        <animateMotion dur="5s" repeatCount="indefinite" begin="-1.6s">
          <mpath href="#orbitB" />
        </animateMotion>
      </circle>
    </svg>
  );
}

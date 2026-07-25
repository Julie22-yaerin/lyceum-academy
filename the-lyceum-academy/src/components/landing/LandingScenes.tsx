/**
 * LandingScenes — small looping SVG vignettes for the spots on the landing
 * page that don't have real photography/video yet. Pure CSS/SMIL loops
 * (see the .scene-* keyframes in index.css), no external assets, no video
 * generation dependency — a stand-in until real footage exists.
 */

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

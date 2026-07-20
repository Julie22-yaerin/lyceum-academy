interface PegtopLoaderProps {
  size?: number;
  color?: string;
  className?: string;
}

function StarSvg({ id, className }: { id: string; className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
    >
      <defs>
        <filter id={`shine-${id}`}>
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <mask id={`mask-${id}`}>
          <path
            d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z"
            fill="white"
          />
        </mask>
        <radialGradient
          id={`gradient-1-${id}`}
          cx="50"
          cy="66"
          fx="50"
          fy="66"
          r="30"
          gradientTransform="translate(0 35) scale(1 0.5)"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="black" stopOpacity="0.3" />
          <stop offset="50%" stopColor="black" stopOpacity="0.1" />
          <stop offset="100%" stopColor="black" stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id={`gradient-2-${id}`}
          cx="55"
          cy="20"
          fx="55"
          fy="20"
          r="30"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="white" stopOpacity="0.3" />
          <stop offset="50%" stopColor="white" stopOpacity="0.1" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id={`gradient-3-${id}`}
          cx="85"
          cy="50"
          fx="85"
          fy="50"
        >
          <stop offset="0%" stopColor="white" stopOpacity="0.3" />
          <stop offset="50%" stopColor="white" stopOpacity="0.1" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id={`gradient-4-${id}`}
          cx="50"
          cy="58"
          fx="50"
          fy="58"
          r="60"
          gradientTransform="translate(0 47) scale(1 0.2)"
        >
          <stop offset="0%" stopColor="white" stopOpacity="0.3" />
          <stop offset="50%" stopColor="white" stopOpacity="0.1" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id={`gradient-5-${id}`}
          x1="50"
          y1="90"
          x2="50"
          y2="10"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="black" stopOpacity="0.2" />
          <stop offset="40%" stopColor="black" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g>
        <path
          d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z"
          fill="currentColor"
        />
        <path
          d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z"
          fill={`url(#gradient-1-${id})`}
        />
        <path
          d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z"
          fill="none"
          stroke="white"
          opacity="0.3"
          strokeWidth="3"
          filter={`url(#shine-${id})`}
          mask={`url(#mask-${id})`}
        />
        <path
          d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z"
          fill={`url(#gradient-2-${id})`}
        />
        <path
          d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z"
          fill={`url(#gradient-3-${id})`}
        />
        <path
          d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z"
          fill={`url(#gradient-4-${id})`}
        />
        <path
          d="M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z"
          fill={`url(#gradient-5-${id})`}
        />
      </g>
    </svg>
  );
}

export default function PegtopLoader({
  size = 48,
  color = "currentColor",
  className = "",
}: PegtopLoaderProps) {
  return (
    <div
      className={`pegtop-loader ${className}`}
      style={{
        width: size,
        height: size,
        color,
      }}
    >
      <StarSvg id="a" className="pegtop-star pegtop-star-1" />
      <StarSvg id="b" className="pegtop-star pegtop-star-2" />
      <StarSvg id="c" className="pegtop-star pegtop-star-3" />
    </div>
  );
}

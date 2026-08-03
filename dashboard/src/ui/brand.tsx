import { useId } from "react";

// The Reasonix brand mark: three concentric diamonds (outer hollow, middle
// hollow, inner solid) filled with the signature cyan → indigo → fuchsia
// gradient. Mirrors docs/logo.svg (minus the animated pulse/rotation).
export function BrandMark({
  size = 58,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const gid = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 92 92"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${gid}-g`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5eead4" />
          <stop offset="50%" stopColor="#93c5fd" />
          <stop offset="100%" stopColor="#c4b5fd" />
        </linearGradient>
      </defs>
      <g transform="translate(46, 46)">
        <path
          d="M 0,-38 L 38,0 L 0,38 L -38,0 Z"
          fill="none"
          stroke={`url(#${gid}-g)`}
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
        <path
          d="M 0,-22 L 22,0 L 0,22 L -22,0 Z"
          fill="none"
          stroke={`url(#${gid}-g)`}
          strokeWidth="2"
          strokeLinejoin="round"
          opacity="0.7"
        />
        <path
          d="M 0,-9 L 9,0 L 0,9 L -9,0 Z"
          fill={`url(#${gid}-g)`}
        />
      </g>
    </svg>
  );
}

/**
 * An original cartoon chess-coach mascot (not modeled on any real person) —
 * used to present analysis feedback in a friendlier, more personable voice.
 */
export default function CoachAvatar({ size = 56 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Coach"
      style={{ flexShrink: 0, borderRadius: '50%', background: '#fed7aa' }}
    >
      <circle cx="32" cy="32" r="32" fill="#fed7aa" />
      {/* neck/shoulders */}
      <path d="M14 60c2-9 8-14 18-14s16 5 18 14z" fill="#fb923c" />
      {/* head */}
      <ellipse cx="32" cy="28" rx="14" ry="15" fill="#e8b98a" />
      {/* ears */}
      <circle cx="18.5" cy="29" r="2.6" fill="#e8b98a" />
      <circle cx="45.5" cy="29" r="2.6" fill="#e8b98a" />
      {/* hair */}
      <path d="M18 24c0-9 6-14 14-14s14 5 14 14c-3-3-8-5-14-5s-11 2-14 5z" fill="#5a4634" />
      <path d="M18.5 22c-1 3-1 6-.5 9-2-1-3-4-3-7 0-3 1-5 3.5-6z" fill="#5a4634" />
      <path d="M45.5 22c1 3 1 6 .5 9 2-1 3-4 3-7 0-3-1-5-3.5-6z" fill="#5a4634" />
      {/* glasses */}
      <circle cx="26" cy="27" r="4.6" fill="none" stroke="#20262f" strokeWidth="1.6" />
      <circle cx="38" cy="27" r="4.6" fill="none" stroke="#20262f" strokeWidth="1.6" />
      <line x1="30.6" y1="27" x2="33.4" y2="27" stroke="#20262f" strokeWidth="1.6" />
      {/* smile */}
      <path d="M26 35c2 2.5 10 2.5 12 0" fill="none" stroke="#7a4a33" strokeWidth="1.8" strokeLinecap="round" />
      {/* beanie with a crown/king emblem */}
      <path d="M17 19c0-9 7-15 15-15s15 6 15 15c-4-2.5-9.5-4-15-4s-11 1.5-15 4z" fill="#2563eb" />
      <rect x="15.5" y="17.5" width="33" height="4" rx="2" fill="#1d4ed8" />
      <path d="M29 8l3 4 3-4-1 6h-4z" fill="#fbbf24" />
    </svg>
  );
}

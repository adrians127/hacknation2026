const RIBBONS = [
  "M-100 330 C 150 230, 330 330, 560 470 S 1000 700, 1250 560 S 1600 380, 1800 430",
  "M-100 700 C 200 440, 520 520, 800 640 S 1300 760, 1500 560 S 1700 400, 1800 400",
  "M-100 480 C 250 560, 550 700, 900 640 S 1400 360, 1800 260",
  "M900 -80 C 1000 120, 1200 200, 1450 150 S 1700 120, 1800 150",
] as const;

export function WaveBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden bg-background">
      <svg
        className="size-full"
        viewBox="0 0 1672 941"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        <defs>
          <linearGradient id="wave-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fd5200" stopOpacity="0.9" />
            <stop offset="0.5" stopColor="#ff8a4c" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffa545" stopOpacity="0.95" />
          </linearGradient>
          <radialGradient id="wave-glow" cx="0.5" cy="0.45" r="0.6">
            <stop offset="0" stopColor="#ffe3d6" stopOpacity="0.9" />
            <stop offset="1" stopColor="#fff1eb" stopOpacity="0" />
          </radialGradient>
          <filter id="wave-blur" x="-10%" y="-30%" width="120%" height="160%">
            <feGaussianBlur stdDeviation="22" />
          </filter>
          <filter id="wave-soft" x="-10%" y="-30%" width="120%" height="160%">
            <feGaussianBlur stdDeviation="2.5" />
          </filter>
        </defs>

        <rect width="1672" height="941" fill="url(#wave-glow)" />
        {RIBBONS.map((d, index) => (
          <g key={d} className={`wave-ribbon wave-ribbon-${index % 3}`}>
            <path d={d} stroke="url(#wave-stroke)" strokeWidth="90" filter="url(#wave-blur)" />
            <path d={d} stroke="url(#wave-stroke)" strokeWidth="2" filter="url(#wave-soft)" />
          </g>
        ))}
      </svg>
      <div className="absolute inset-0 bg-linear-to-b from-transparent via-transparent to-background/80" />
    </div>
  );
}

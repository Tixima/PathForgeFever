interface CompassRoseProps {
  x: number
  y: number
  size?: number
  className?: string
}

/** Norden zeigt immer nach oben (Spiel-Y-Achse, north-up-Projektion). */
export function CompassRose({ x, y, size = 52, className = '' }: CompassRoseProps) {
  const r = size / 2

  return (
    <g className={`compass-rose ${className}`.trim()} transform={`translate(${x - r}, ${y - r})`}>
      <circle cx={r} cy={r} r={r} className="compass-rose__bg" />
      <polygon
        points={`${r},${r * 0.12} ${r * 0.72},${r * 1.45} ${r},${r * 1.05} ${r * 1.28},${r * 1.45}`}
        className="compass-rose__north"
      />
      <polygon
        points={`${r},${r * 1.88} ${r * 0.78},${r * 1.08} ${r},${r * 1.35} ${r * 1.22},${r * 1.08}`}
        className="compass-rose__south"
      />
      <text x={r} y={r * 0.38} className="compass-rose__label compass-rose__label--n">
        N
      </text>
      <text x={r} y={size - 4} className="compass-rose__label">
        S
      </text>
      <text x={4} y={r + 3} className="compass-rose__label">
        W
      </text>
      <text x={size - 8} y={r + 3} className="compass-rose__label">
        O
      </text>
    </g>
  )
}

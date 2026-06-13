import type { CSSProperties } from 'react'
import type { LineDirectionAtStop } from '../../lib/station/stationLineDirections'

interface HubStopDirectionsProps {
  directions: LineDirectionAtStop[]
  maxVisible?: number
  compact?: boolean
}

export function HubStopDirections({
  directions,
  maxVisible = 4,
  compact = false,
}: HubStopDirectionsProps) {
  if (directions.length === 0) return null

  const visible = directions.slice(0, maxVisible)
  const extra = directions.length - visible.length

  return (
    <div className={`hub-strip-lines ${compact ? 'hub-strip-lines--compact' : ''}`}>
      {visible.map((line) => (
        <div
          key={`${line.lineId}:${line.stopIndex}:${line.prevStop ?? ''}:${line.nextStop ?? ''}`}
          className="hub-strip-line"
          title={`${line.lineName}: ${line.prevStop ?? '—'} ↔ ${line.nextStop ?? '—'}`}
        >
          <span
            className="hub-strip-line__badge"
            style={{ '--line-color': line.lineColor } as CSSProperties}
          >
            {line.lineShort}
          </span>
          <span className="hub-strip-line__dirs" aria-hidden>
            {line.prevInitial && (
              <span className="hub-strip-line__dir hub-strip-line__dir--prev" title={line.prevStop ?? undefined}>
                {line.prevInitial}
                <span className="hub-strip-line__arrow">←</span>
              </span>
            )}
            {line.prevInitial && line.nextInitial && (
              <span className="hub-strip-line__sep">·</span>
            )}
            {line.nextInitial && (
              <span className="hub-strip-line__dir hub-strip-line__dir--next" title={line.nextStop ?? undefined}>
                <span className="hub-strip-line__arrow">→</span>
                {line.nextInitial}
              </span>
            )}
          </span>
        </div>
      ))}
      {extra > 0 && <span className="hub-strip-lines__more">+{extra}</span>}
    </div>
  )
}

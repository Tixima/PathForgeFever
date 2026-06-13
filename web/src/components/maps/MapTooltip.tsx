import { motion } from 'framer-motion'
import type { LineShape, MapHover, NetworkMapData } from '../../lib/maps/types'

const SHAPE_HINT: Record<LineShape, string> = {
  pingpong: 'Strecke (betrieblich Hin & Zurück)',
  partial_return: 'Teilstrecken-Rückfahrt (A→…→G→…→A)',
  ring: 'Ringlinie',
  linear: 'Streckenlinie',
}

interface MapTooltipProps {
  hover: MapHover | null
  mapData: NetworkMapData
  extra?: string
}

export function MapTooltip({ hover, mapData, extra }: MapTooltipProps) {
  if (!hover) return null

  if (hover.type === 'station') {
    const s = hover.station
    return (
      <motion.div
        className="netmap-tooltip"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
      >
        <strong>{s.name}</strong>
        <span>
          {s.interchange ? 'Umsteigebahnhof' : 'Bahnhof'}
          {' · '}
          {s.degree} Verbindungen
        </span>
        <div className="netmap-tooltip__lines">
          {s.lineNames.map((name, i) => (
            <span key={`${name}-${i}`} className="netmap-tooltip__line-tag">
              <span className="line-dot" style={{ backgroundColor: s.lineColors[i] }} />
              {name}
            </span>
          ))}
        </div>
      </motion.div>
    )
  }

  const line = hover.line
  const stopNames = line.layoutStationIds
    .map((id) => mapData.stationById.get(id)?.name)
    .filter(Boolean) as string[]

  return (
    <motion.div
      className="netmap-tooltip"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
    >
      <strong style={{ color: line.color }}>{line.name}</strong>
      <span>
        {SHAPE_HINT[line.shape]} · {line.stopCount} Halte · {stopNames.length} Stationen
        {extra && <> · {extra}</>}
      </span>
      {hover.edge && (
        <span>
          Abschnitt: {hover.edge.fromName} → {hover.edge.toName}
        </span>
      )}
      <span className="netmap-tooltip__route-preview">
        {stopNames.length > 8
          ? `${stopNames.slice(0, 4).join(' → ')} → … → ${stopNames[stopNames.length - 1]}`
          : stopNames.join(' → ')}
      </span>
    </motion.div>
  )
}

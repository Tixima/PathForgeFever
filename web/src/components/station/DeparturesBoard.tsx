import { useMemo } from 'react'
import { motion } from 'framer-motion'
import type { ScaleSettings } from '../../lib/scale'
import type { StationIntel } from '../../lib/station/stationIntel'
import type { NetworkExport } from '../../types/network'
import { buildDepartureTrackIndex, getDepartureTrack } from '../../lib/platform/platformIntel'
import { formatDuration, formatDistanceKm } from '../../lib/format'
import { getScaledRouteValues } from '../../lib/scale'

interface DeparturesBoardProps {
  network: NetworkExport
  intel: StationIntel
  scale: ScaleSettings
  onSelectDestination?: (stationId: number, name: string) => void
}

export function DeparturesBoard({
  network,
  intel,
  scale,
  onSelectDestination,
}: DeparturesBoardProps) {
  const trackIndex = useMemo(() => buildDepartureTrackIndex(network), [network])

  const departures = useMemo(() => {
    const outbound = intel.connections
      .filter((c) => c.direction === 'out')
      .sort((a, b) => a.travelSeconds - b.travelSeconds)

    return outbound.map((conn) => {
      const scaled = getScaledRouteValues(conn.travelSeconds, conn.distanceKm * 1000, scale)
      const track = getDepartureTrack(trackIndex, conn.lineId, intel.id, conn.neighborId)

      return {
        ...conn,
        gleis: track?.trackDisplay ?? '—',
        towards: track?.towardsName ?? conn.neighborName,
        scaledDuration: scaled.durationSeconds,
        scaledKm: scaled.distanceMeters / 1000,
      }
    })
  }, [intel.connections, intel.id, scale, trackIndex])

  if (departures.length === 0) return null

  return (
    <section className="departures-board">
      <div className="departures-board__header">
        <span className="departures-board__live">LIVE</span>
        <h4>Abfahrtstafel — {intel.name}</h4>
        <span className="departures-board__clock">
          {new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      <div className="departures-board__columns">
        <span>Zeit</span>
        <span>Gleis</span>
        <span>Linie</span>
        <span>Ziel</span>
        <span>Info</span>
      </div>

      <ul className="departures-board__list">
        {departures.map((dep, i) => (
          <motion.li
            key={`${dep.lineId}-${dep.neighborId}-${i}`}
            className="departures-board__row"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03 }}
          >
            <button
              type="button"
              className="departures-board__row-btn"
              onClick={() => onSelectDestination?.(dep.neighborId, dep.neighborName)}
            >
              <span className="departures-board__time">
                {formatDuration(dep.scaledDuration)}
              </span>
              <span className="departures-board__gleis" title={dep.gleis}>
                {dep.gleis}
              </span>
              <span className="departures-board__line">
                <span className="line-dot" style={{ backgroundColor: dep.lineColor }} />
                {dep.lineName}
              </span>
              <span className="departures-board__dest">{dep.towards}</span>
              <span className="departures-board__info">
                {formatDistanceKm(dep.scaledKm)}
              </span>
            </button>
          </motion.li>
        ))}
      </ul>
    </section>
  )
}

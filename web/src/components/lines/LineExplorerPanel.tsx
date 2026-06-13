import { useMemo, useState, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { Gauge, GitCompare, Repeat, Timer, Train, Users } from 'lucide-react'
import { LineCompareView } from './LineCompareView'
import { FavoriteButton } from '../FavoriteButton'
import type { NetworkExport } from '../../types/network'
import type { ScaleSettings } from '../../lib/scale'
import type { StationOption } from '../../lib/routing/types'
import { buildLineExplorerDetails } from '../../lib/lines/lineExplorer'
import { shapeLabel } from '../../lib/maps/lineTopology'
import { formatDuration, formatDistanceKm } from '../../lib/format'
import { getScaledRouteValues } from '../../lib/scale'

interface LineExplorerPanelProps {
  network: NetworkExport
  scale: ScaleSettings
  onOpenStation: (stationId: number) => void
  onPlanFrom: (station: StationOption) => void
  stations: StationOption[]
  isLineFavorite?: (id: number) => boolean
  onToggleLineFavorite?: (id: number) => void
}

const SHAPE_LABEL: Record<import('../../lib/maps/types').LineShape, string> = {
  pingpong: shapeLabel('pingpong'),
  partial_return: shapeLabel('partial_return'),
  ring: shapeLabel('ring'),
  linear: shapeLabel('linear'),
}

export function LineExplorerPanel({
  network,
  scale,
  onOpenStation,
  onPlanFrom,
  stations,
  isLineFavorite,
  onToggleLineFavorite,
}: LineExplorerPanelProps) {
  const lines = useMemo(() => buildLineExplorerDetails(network), [network])
  const [selectedId, setSelectedId] = useState(lines[0]?.id ?? 0)
  const [compareMode, setCompareMode] = useState(false)
  const [compareA, setCompareA] = useState(lines[0]?.id ?? 0)
  const [compareB, setCompareB] = useState(lines[1]?.id ?? lines[0]?.id ?? 0)

  const line = lines.find((l) => l.id === selectedId) ?? lines[0]
  if (!line) return null

  const scaled = getScaledRouteValues(line.totalSeconds, line.totalKm * 1000, scale)
  const layoutStops = line.stops.filter(
    (s, i, arr) => arr.findIndex((x) => x.stationId === s.stationId) === i,
  )

  return (
    <section className="line-explorer">
      <header className="line-explorer__header">
        <div>
          <p className="line-explorer__eyebrow">Linien-Explorer</p>
          <h2>Jede Linie im Detail</h2>
          <p className="line-explorer__subtitle">
            Haltestellenfolge, Segmentzeiten, Wendepunkte und Spielstatistik — direkt aus dem Export.
          </p>
        </div>
        <button
          type="button"
          className={`line-explorer__compare-toggle ${compareMode ? 'is-active' : ''}`}
          onClick={() => setCompareMode((v) => !v)}
        >
          <GitCompare size={16} />
          {compareMode ? 'Einzelansicht' : 'Linien-Duell'}
        </button>
      </header>

      {compareMode && (
        <LineCompareView
          network={network}
          lineAId={compareA}
          lineBId={compareB}
          onLineAChange={setCompareA}
          onLineBChange={setCompareB}
        />
      )}

      <div className="line-explorer__picker">
        {lines.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`line-explorer__chip ${l.id === line.id ? 'is-active' : ''}`}
            style={{ '--chip-color': l.color } as CSSProperties}
            onClick={() => setSelectedId(l.id)}
          >
            <span className="line-dot" style={{ backgroundColor: l.color }} />
            {l.name}
            <small>{l.stopCount}</small>
          </button>
        ))}
      </div>

      {!compareMode && (
      <motion.article
        key={line.id}
        className="line-explorer__hero"
        style={{ '--line-color': line.color } as CSSProperties}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="line-explorer__hero-top">
          <div>
            <h3>
              {line.name}
              {onToggleLineFavorite && isLineFavorite && (
                <FavoriteButton
                  active={isLineFavorite(line.id)}
                  onToggle={() => onToggleLineFavorite(line.id)}
                />
              )}
            </h3>
            <p>
              {line.terminusFrom} → {line.terminusTo}
              {line.turnaroundName && line.shape === 'partial_return' && (
                <> · Scheitel <strong>{line.turnaroundName}</strong></>
              )}
              {line.turnaroundName && line.shape !== 'partial_return' && (
                <> · Wende <strong>{line.turnaroundName}</strong></>
              )}
            </p>
            <span className="line-explorer__shape">{SHAPE_LABEL[line.shape]}</span>
          </div>
          <button
            type="button"
            className="line-explorer__plan-btn"
            onClick={() => {
              const start = stations.find((s) => s.name === line.terminusFrom)
              if (start) onPlanFrom(start)
            }}
          >
            <Train size={15} />
            Ab {line.terminusFrom} planen
          </button>
        </div>

        <div className="line-explorer__stats">
          <div><Timer size={15} /><strong>{formatDuration(scaled.durationSeconds)}</strong><span>Gesamtfahrt</span></div>
          <div><Gauge size={15} /><strong>{formatDistanceKm(scaled.distanceMeters / 1000)}</strong><span>Strecke</span></div>
          <div><Repeat size={15} /><strong>{line.uniqueStations}</strong><span>Stationen</span></div>
          {line.passengers !== null && (
            <div><Users size={15} /><strong>{line.passengers.toLocaleString('de-DE')}</strong><span>Passagiere</span></div>
          )}
        </div>
      </motion.article>

      )}

      {!compareMode && (
      <>
      <div className="line-explorer__strip">
        {layoutStops.map((stop, i) => (
          <button
            key={`${stop.stationId}-${i}`}
            type="button"
            className="line-explorer__strip-node"
            onClick={() => onOpenStation(stop.stationId)}
            title={stop.name}
          >
            <span className="line-explorer__strip-dot" />
            <span className="line-explorer__strip-label">{stop.name}</span>
          </button>
        ))}
      </div>

      <div className="line-explorer__stops-card">
        <h4>Fahrplan & Segmente</h4>
        <ol className="line-explorer__stops">
          {line.stops.map((stop, i) => (
            <li key={`${stop.stationId}-${stop.index}`}>
              <button type="button" className="line-explorer__stop-btn" onClick={() => onOpenStation(stop.stationId)}>
                <span className="line-explorer__stop-idx">{stop.index + 1}</span>
                <span className="line-explorer__stop-name">
                  {stop.name}
                  {stop.trackDisplay && (
                    <small className="line-explorer__stop-gleis">{stop.trackDisplay}</small>
                  )}
                </span>
              </button>
              {stop.segmentSeconds !== null && i < line.stops.length - 1 && (
                <span className="line-explorer__segment">
                  ↓ {formatDuration(getScaledRouteValues(stop.segmentSeconds, (stop.segmentKm ?? 0) * 1000, scale).durationSeconds)}
                  {stop.segmentKm !== null && ` · ${formatDistanceKm(stop.segmentKm)}`}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
      </>
      )}
    </section>
  )
}

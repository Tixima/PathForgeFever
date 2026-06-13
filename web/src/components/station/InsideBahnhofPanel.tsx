import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Gauge,
  MapPin,
  Radio,
  Shuffle,
  Train,
  Waypoints,
} from 'lucide-react'
import type { NetworkExport } from '../../types/network'
import type { ScaleSettings } from '../../lib/scale'
import type { StationOption } from '../../lib/routing/types'
import { buildStationIntelIndex, type StationConnection } from '../../lib/station/stationIntel'
import { DeparturesBoard } from './DeparturesBoard'
import { PlatformBoard } from './PlatformBoard'
import { shapeLabel } from '../../lib/maps/lineTopology'
import { StationAutocomplete } from '../StationAutocomplete'
import { FavoriteButton } from '../FavoriteButton'
import { formatDistance, formatDuration } from '../../lib/format'
import { getScaledRouteValues, getTransferDisplaySeconds } from '../../lib/scale'

interface InsideBahnhofPanelProps {
  network: NetworkExport
  stations: StationOption[]
  scale: ScaleSettings
  focusStationId: number | null
  onFocusStation: (id: number | null) => void
  onPlanFrom: (station: StationOption) => void
  onPlanTo: (station: StationOption) => void
  onPlanTrip?: (from: StationOption, to: StationOption) => void
  isStationFavorite?: (id: number) => boolean
  onToggleStationFavorite?: (id: number) => void
  favoriteStations?: StationOption[]
}

interface GroupedConnection {
  neighborId: number
  neighborName: string
  bestSeconds: number
  bestKm: number
  lines: Array<{ lineName: string; lineColor: string; seconds: number }>
}

function groupConnections(connections: StationConnection[]): GroupedConnection[] {
  const map = new Map<number, GroupedConnection>()

  for (const conn of connections) {
    const existing = map.get(conn.neighborId)
    if (!existing) {
      map.set(conn.neighborId, {
        neighborId: conn.neighborId,
        neighborName: conn.neighborName,
        bestSeconds: conn.travelSeconds,
        bestKm: conn.distanceKm,
        lines: [{ lineName: conn.lineName, lineColor: conn.lineColor, seconds: conn.travelSeconds }],
      })
      continue
    }

    if (conn.travelSeconds < existing.bestSeconds) {
      existing.bestSeconds = conn.travelSeconds
      existing.bestKm = conn.distanceKm
    }
    if (!existing.lines.some((l) => l.lineName === conn.lineName)) {
      existing.lines.push({
        lineName: conn.lineName,
        lineColor: conn.lineColor,
        seconds: conn.travelSeconds,
      })
    }
  }

  return [...map.values()].sort((a, b) => a.bestSeconds - b.bestSeconds)
}

export function InsideBahnhofPanel({
  network,
  stations,
  scale,
  focusStationId,
  onFocusStation,
  onPlanFrom,
  onPlanTo,
  onPlanTrip,
  isStationFavorite,
  onToggleStationFavorite,
  favoriteStations = [],
}: InsideBahnhofPanelProps) {
  const intelIndex = useMemo(() => buildStationIntelIndex(network), [network])

  const selectedStation = useMemo(() => {
    if (!focusStationId) return stations[0] ?? null
    return stations.find((s) => s.id === focusStationId) ?? stations[0] ?? null
  }, [focusStationId, stations])

  const intel = selectedStation ? intelIndex.byId.get(selectedStation.id) : undefined
  const groupedConnections = useMemo(
    () => (intel ? groupConnections(intel.connections) : []),
    [intel],
  )

  const [pickerValue, setPickerValue] = useState<StationOption | null>(selectedStation)

  useEffect(() => {
    setPickerValue(selectedStation)
  }, [selectedStation])

  function handlePick(station: StationOption | null) {
    setPickerValue(station)
    onFocusStation(station?.id ?? null)
  }

  if (!intel || !selectedStation) {
    return (
      <section className="inside-bahnhof inside-bahnhof--empty">
        <p>Keine Bahnhöfe im Export gefunden.</p>
      </section>
    )
  }

  const lineColors = intel.lines.map((l) => l.lineColor)
  const gradient =
    lineColors.length > 1
      ? `linear-gradient(120deg, ${lineColors.slice(0, 4).join(', ')})`
      : lineColors[0] ?? 'var(--accent)'

  return (
    <section className="inside-bahnhof">
      <header className="inside-bahnhof__intro">
        <div>
          <p className="inside-bahnhof__eyebrow">Inside Bahnhof</p>
          <h2>Tiefenanalyse jedes Knotens</h2>
          <p className="inside-bahnhof__subtitle">
            Linien, Direktverbindungen, Umsteigezeiten und Rollen im Netz — alles aus dem TF2-Export.
          </p>
        </div>
        <div className="inside-bahnhof__picker">
          <StationAutocomplete
            label="Bahnhof wählen"
            placeholder="Station suchen…"
            stations={stations}
            value={pickerValue}
            onChange={handlePick}
          />
        </div>
      </header>

      {favoriteStations.length > 0 && (
        <div className="inside-bahnhof__hub-chips">
          <span className="inside-bahnhof__chips-label">Favoriten</span>
          {favoriteStations.map((fav) => (
            <button
              key={fav.id}
              type="button"
              className={`inside-bahnhof__chip inside-bahnhof__chip--fav ${fav.id === intel.id ? 'is-active' : ''}`}
              onClick={() => handlePick(fav)}
            >
              ★ {fav.name}
            </button>
          ))}
        </div>
      )}

      <div className="inside-bahnhof__hub-chips">
        <span className="inside-bahnhof__chips-label">Top-Umsteiger</span>
        {intelIndex.topHubs.slice(0, 10).map((hub) => (
          <button
            key={hub.id}
            type="button"
            className={`inside-bahnhof__chip ${hub.id === intel.id ? 'is-active' : ''}`}
            onClick={() => handlePick(stations.find((s) => s.id === hub.id) ?? null)}
          >
            {hub.name}
            <small>{hub.degree}</small>
          </button>
        ))}
      </div>

      <motion.article
        key={intel.id}
        className="inside-bahnhof__hero"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="inside-bahnhof__hero-glow" style={{ background: gradient }} aria-hidden />
        <div className="inside-bahnhof__hero-content">
          <div className="inside-bahnhof__hero-top">
            <div>
              <h3>
                {intel.name}
                {onToggleStationFavorite && isStationFavorite && (
                  <FavoriteButton
                    active={isStationFavorite(intel.id)}
                    onToggle={() => onToggleStationFavorite(intel.id)}
                  />
                )}
              </h3>
              <div className="inside-bahnhof__badges">
                {intel.interchange && (
                  <span className="inside-bahnhof__badge inside-bahnhof__badge--hub">
                    <Shuffle size={12} /> Umsteigebahnhof
                  </span>
                )}
                {intel.hubRank && (
                  <span className="inside-bahnhof__badge">
                    #{intel.hubRank} Mega-Hub
                  </span>
                )}
                <span className="inside-bahnhof__badge">
                  <Waypoints size={12} /> {intel.degree} Verbindungen
                </span>
                <span className="inside-bahnhof__badge">
                  <Train size={12} /> {intel.lines.length} Linien
                </span>
              </div>
            </div>
            <div className="inside-bahnhof__actions">
              <button type="button" className="inside-bahnhof__action" onClick={() => onPlanFrom(selectedStation)}>
                <ArrowUpRight size={15} />
                Von hier
              </button>
              <button type="button" className="inside-bahnhof__action" onClick={() => onPlanTo(selectedStation)}>
                <ArrowDownLeft size={15} />
                Nach hier
              </button>
            </div>
          </div>

          <div className="inside-bahnhof__stats-row">
            <div className="inside-bahnhof__stat">
              <Radio size={16} />
              <strong>{intel.uniqueDestinations}</strong>
              <span>Direktziele</span>
            </div>
            <div className="inside-bahnhof__stat">
              <Gauge size={16} />
              <strong>
                {intel.transferTimeSeconds
                  ? formatDuration(getTransferDisplaySeconds(intel.transferTimeSeconds))
                  : '—'}
              </strong>
              <span>Umsteigezeit</span>
            </div>
            <div className="inside-bahnhof__stat">
              <MapPin size={16} />
              <strong>
                {intel.position[0].toFixed(0)} / {intel.position[1].toFixed(0)}
              </strong>
              <span>Spielposition X/Y (Nord/Süd)</span>
            </div>
          </div>
        </div>
      </motion.article>

      <DeparturesBoard
        network={network}
        intel={intel}
        scale={scale}
        onSelectDestination={(neighborId) => {
          const dest = stations.find((s) => s.id === neighborId)
          if (!dest) return
          if (onPlanTrip) onPlanTrip(selectedStation, dest)
          else {
            onPlanFrom(selectedStation)
            onPlanTo(dest)
          }
        }}
      />

      <PlatformBoard
        network={network}
        stationGroupId={intel.id}
        stationName={intel.name}
      />

      <div className="inside-bahnhof__grid">
        <section className="inside-bahnhof__card inside-bahnhof__card--wide">
          <h4>Linien-Tafel</h4>
          <p className="inside-bahnhof__card-desc">Alle Linien, Endhaltestellen und Rolle an diesem Knoten</p>
          <div className="line-board">
            {intel.lines.map((line) => (
              <div key={line.lineId} className="line-board__row" style={{ '--line-color': line.lineColor } as CSSProperties}>
                <span className="line-board__badge">{line.lineName}</span>
                <span className="line-board__route">
                  {line.terminusFrom} → {line.terminusTo}
                </span>
                <span className={`line-board__role ${line.isTurnaround ? 'line-board__role--turn' : ''}`}>
                  {line.role}
                </span>
                <span className="line-board__shape">{shapeLabel(line.shape)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="inside-bahnhof__card">
          <h4>Verbindungs-Radar</h4>
          <p className="inside-bahnhof__card-desc">
            {groupedConnections.length} Nachbarstationen direkt erreichbar
          </p>
          <ul className="conn-radar">
            {groupedConnections.slice(0, 14).map((conn) => {
              const scaled = getScaledRouteValues(conn.bestSeconds, conn.bestKm * 1000, scale)
              return (
                <li key={conn.neighborId} className="conn-radar__item">
                  <div className="conn-radar__main">
                    <strong>{conn.neighborName}</strong>
                    <span>
                      {formatDuration(scaled.durationSeconds)} · {formatDistance(scaled.distanceMeters)}
                    </span>
                  </div>
                  <div className="conn-radar__lines">
                    {conn.lines.map((l) => (
                      <span key={l.lineName} className="conn-radar__line-tag">
                        <span className="line-dot" style={{ backgroundColor: l.lineColor }} />
                        {l.lineName}
                      </span>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        {intel.interchange && (
          <section className="inside-bahnhof__card inside-bahnhof__card--matrix">
            <h4>Umsteige-Matrix</h4>
            <p className="inside-bahnhof__card-desc">
              Welche Linien sich hier treffen — ideal für Routen mit Umstieg
            </p>
            <div className="transfer-matrix">
              {intel.lines.flatMap((a, i) =>
                intel.lines.slice(i + 1).map((b) => (
                  <div key={`${a.lineId}-${b.lineId}`} className="transfer-matrix__pair">
                    <span className="line-dot" style={{ backgroundColor: a.lineColor }} />
                    {a.lineName}
                    <Shuffle size={12} />
                    <span className="line-dot" style={{ backgroundColor: b.lineColor }} />
                    {b.lineName}
                  </div>
                )),
              )}
            </div>
          </section>
        )}
      </div>
    </section>
  )
}

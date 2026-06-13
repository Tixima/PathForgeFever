import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Filter, Map, Radar, Search } from 'lucide-react'
import { IsochroneMap } from './IsochroneMap'
import type { NetworkExport } from '../../types/network'
import type { RouteCriterion, RouteResult, StationOption } from '../../lib/routing/types'
import type { ScaleSettings } from '../../lib/scale'
import { findAllRoutesFromStation } from '../../lib/routing/pathfinder'
import { StationAutocomplete } from '../StationAutocomplete'
import { formatRouteStats } from '../../lib/format'

interface ReachabilityPanelProps {
  network: NetworkExport
  stations: StationOption[]
  scale: ScaleSettings
  focusStationId: number | null
  onFocusStation: (id: number | null) => void
  onPlanTrip: (from: StationOption, to: StationOption) => void
  onOpenStation?: (stationId: number) => void
}

const CRITERIA: Array<{ id: RouteCriterion; label: string }> = [
  { id: 'fastest', label: 'Schnellste' },
  { id: 'fewest_transfers', label: 'Wenig Umstieg' },
  { id: 'fewest_stops', label: 'Wenig Halte' },
]

export function ReachabilityPanel({
  network,
  stations,
  scale,
  focusStationId,
  onFocusStation,
  onPlanTrip,
  onOpenStation,
}: ReachabilityPanelProps) {
  const [criterion, setCriterion] = useState<RouteCriterion>('fastest')
  const [directOnly, setDirectOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [showMap, setShowMap] = useState(true)

  const origin = useMemo(() => {
    if (focusStationId) return stations.find((s) => s.id === focusStationId) ?? stations[0]
    return stations[0] ?? null
  }, [focusStationId, stations])

  const routes = useMemo(() => {
    if (!origin) return []
    return findAllRoutesFromStation(network, origin.id, criterion)
  }, [network, origin, criterion])

  const filtered = useMemo(() => {
    let list = routes
    if (directOnly) list = list.filter((r) => r.isDirect)
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((r) => r.stationNames[r.stationNames.length - 1].toLowerCase().includes(q))
    return list
  }, [routes, directOnly, query])

  if (!origin) return null

  return (
    <section className="reach-panel">
      <header className="reach-panel__header">
        <div>
          <p className="reach-panel__eyebrow">Erreichbarkeit</p>
          <h2>Von hier überall hin</h2>
          <p className="reach-panel__subtitle">
            Berechnet optimale Routen von einem Bahnhof zu <strong>allen</strong> {routes.length} erreichbaren Zielen im Netz.
          </p>
        </div>
        <div className="reach-panel__origin">
          <StationAutocomplete
            label="Startbahnhof"
            placeholder="Von wo?"
            stations={stations}
            value={origin}
            onChange={(s) => onFocusStation(s?.id ?? null)}
          />
        </div>
      </header>

      <div className="reach-panel__toolbar">
        <div className="reach-panel__criteria">
          {CRITERIA.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`reach-panel__crit ${criterion === c.id ? 'is-active' : ''}`}
              onClick={() => setCriterion(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <label className="reach-panel__filter">
          <input type="checkbox" checked={directOnly} onChange={(e) => setDirectOnly(e.target.checked)} />
          <Filter size={14} />
          Nur Direktverbindungen
        </label>
        <div className="reach-panel__search">
          <Search size={15} />
          <input
            type="text"
            placeholder="Ziel filtern…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="reach-panel__summary">
        <Radar size={18} />
        <strong>{filtered.length}</strong> Ziele von <strong>{origin.name}</strong>
        {directOnly && ' (direkt)'}
        <button
          type="button"
          className={`reach-panel__map-toggle ${showMap ? 'is-active' : ''}`}
          onClick={() => setShowMap((v) => !v)}
        >
          <Map size={14} />
          Isochronen-Karte
        </button>
      </div>

      {showMap && (
        <IsochroneMap
          network={network}
          originId={origin.id}
          criterion={criterion}
          scale={scale}
          onStationClick={onOpenStation}
        />
      )}

      <div className="reach-panel__table-wrap">
        <table className="reach-panel__table">
          <thead>
            <tr>
              <th>Ziel</th>
              <th>Dauer</th>
              <th>Strecke</th>
              <th>Umst.</th>
              <th>Linien</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((route, i) => (
              <ReachRow
                key={route.id}
                route={route}
                scale={scale}
                index={i}
                onPlan={() => {
                  const dest = stations.find((s) => s.id === route.stationIds[route.stationIds.length - 1])
                  if (dest) onPlanTrip(origin, dest)
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ReachRow({
  route,
  scale,
  index,
  onPlan,
}: {
  route: RouteResult
  scale: ScaleSettings
  index: number
  onPlan: () => void
}) {
  const stats = formatRouteStats(route.totalDurationSeconds, route.totalDistanceMeters, scale)
  const dest = route.stationNames[route.stationNames.length - 1]

  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: Math.min(index * 0.015, 0.4) }}
    >
      <td><strong>{dest}</strong></td>
      <td>{stats.duration}</td>
      <td>{stats.distance}</td>
      <td>{route.transferCount}×</td>
      <td>
        <div className="reach-panel__lines">
          {route.legs.map((leg) => (
            <span key={leg.lineId} className="reach-panel__line-tag" title={leg.lineName}>
              <span className="line-dot" style={{ backgroundColor: leg.lineColor }} />
              {leg.lineName.replace('Linie ', 'L')}
            </span>
          ))}
        </div>
      </td>
      <td>
        <button type="button" className="reach-panel__go" onClick={onPlan}>
          Planen <ArrowRight size={13} />
        </button>
      </td>
    </motion.tr>
  )
}

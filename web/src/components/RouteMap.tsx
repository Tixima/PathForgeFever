import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { NetworkMapMeta } from '../types/network'
import type { RouteResult, StationOption } from '../lib/routing/types'
import type { ScaleSettings } from '../lib/scale'
import { formatDistance, formatDuration } from '../lib/format'
import { getScaledRouteValues } from '../lib/scale'
import {
  buildGeoViewBox,
  GEO_PAD,
  GEO_VIEW_H,
  GEO_VIEW_W,
  gameX,
  gameY,
  projectGeoPoint,
  resolveGeoBounds,
} from '../lib/maps/geoProjection'
import { CompassRose } from './maps/CompassRose'

interface RouteMapProps {
  route: RouteResult
  stations: StationOption[]
  scale: ScaleSettings
  boundingBox?: NetworkMapMeta['bounding_box']
  embedded?: boolean
}

interface MapNode {
  x: number
  y: number
  name: string
  stationId: number
  index: number
  kind: 'start' | 'end' | 'via' | 'stop'
  interchange: boolean
  lineNames: string[]
}

interface MapSegment {
  points: string
  x1: number
  y1: number
  x2: number
  y2: number
  lineId: number
  lineName: string
  lineColor: string
  durationSeconds: number
  distanceMeters: number
  fromName: string
  toName: string
  stopCount: number
  legDurationSeconds: number
  legDistanceMeters: number
}

type HoverInfo =
  | { type: 'station'; data: MapNode }
  | { type: 'segment'; data: MapSegment }

const VIEW_W = GEO_VIEW_W
const PAD = GEO_PAD

function mapHeight(embedded: boolean): number {
  return embedded ? 420 : GEO_VIEW_H
}

export function RouteMap({ route, stations, scale, boundingBox, embedded = false }: RouteMapProps) {
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const viewH = mapHeight(embedded)

  const mapData = useMemo(() => {
    const stationById = new Map(stations.map((s) => [s.id, s]))
    const viaSet = new Set(route.viaStationIds ?? [])

    const coords = route.stationIds
      .map((id) => {
        const s = stationById.get(id)
        if (!s?.position) return null
        return {
          stationId: id,
          name: s.name,
          geoX: gameX(s.position),
          geoY: gameY(s.position),
        }
      })
      .filter(Boolean) as Array<{ stationId: number; name: string; geoX: number; geoY: number }>

    if (coords.length < 2) return null

    const bounds = resolveGeoBounds(coords, { boundingBox, fitToPoints: true })
    const projection = {
      width: VIEW_W,
      height: viewH,
      padding: PAD,
      northUp: true,
      preserveAspectRatio: true,
    }

    const positions = new Map<string, { x: number; y: number }>()
    for (const c of coords) {
      positions.set(`${c.stationId}`, projectGeoPoint(c.geoX, c.geoY, bounds, projection))
    }

    const nodes: MapNode[] = route.stationIds
      .map((id, index) => {
        const s = stationById.get(id)
        const pos = positions.get(`${id}`)
        if (!s || !pos) return null

        let kind: MapNode['kind'] = 'stop'
        if (index === 0) kind = 'start'
        else if (index === route.stationIds.length - 1) kind = 'end'
        else if (viaSet.has(id)) kind = 'via'

        return {
          ...pos,
          name: s.name,
          stationId: id,
          index,
          kind,
          interchange: s.interchange,
          lineNames: s.lineNames,
        }
      })
      .filter(Boolean) as MapNode[]

    const segments: MapSegment[] = []

    for (const leg of route.legs) {
      const legStationIds = [leg.fromStationId]
      for (const stop of leg.stops.slice(1)) {
        const match = stations.find((s) => s.name === stop)
        if (match) legStationIds.push(match.id)
      }

      for (let i = 0; i < legStationIds.length - 1; i++) {
        const fromId = legStationIds[i]
        const toId = legStationIds[i + 1]
        const p1 = positions.get(`${fromId}`)
        const p2 = positions.get(`${toId}`)
        if (!p1 || !p2) continue

        const fromStation = stationById.get(fromId)
        const toStation = stationById.get(toId)

        segments.push({
          points: `${p1.x},${p1.y} ${p2.x},${p2.y}`,
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          lineId: leg.lineId,
          lineName: leg.lineName,
          lineColor: leg.lineColor,
          durationSeconds: leg.durationSeconds,
          distanceMeters: leg.distanceMeters,
          fromName: fromStation?.name ?? leg.fromStationName,
          toName: toStation?.name ?? leg.toStationName,
          stopCount: leg.stops.length,
          legDurationSeconds: leg.durationSeconds,
          legDistanceMeters: leg.distanceMeters,
        })
      }
    }

    return { nodes, segments, viewBox: buildGeoViewBox(VIEW_W, viewH) }
  }, [route, stations, boundingBox, viewH])

  if (!mapData) return null

  const { nodes, segments, viewBox } = mapData

  return (
    <div className={`route-map ${embedded ? 'route-map--embedded' : ''}`}>
      {!embedded && (
        <>
          <div className="route-map__header">
            <span>Streckenverlauf</span>
            <div className="route-map__legend">
              {route.legs.map((leg) => (
                <span key={leg.lineId} className="route-map__legend-item">
                  <span className="line-dot" style={{ backgroundColor: leg.lineColor }} />
                  {leg.lineName}
                </span>
              ))}
            </div>
          </div>

          <p className="route-map__info">
            Geografische Karte (Norden oben) — Stationen auf echten TF2-Koordinaten aus dem Export.
          </p>
        </>
      )}

      {embedded && (
        <div className="route-map__legend route-map__legend--embedded">
          {route.legs.map((leg) => (
            <span key={leg.lineId} className="route-map__legend-item">
              <span className="line-dot" style={{ backgroundColor: leg.lineColor }} />
              {leg.lineName}
            </span>
          ))}
        </div>
      )}

      <div className="route-map__canvas">
        <svg viewBox={viewBox} className="route-map__svg" role="img" aria-label="Streckenverlauf Norden oben">
          <defs>
            <pattern id="routeGeoGrid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={VIEW_W} height={viewH} fill="url(#routeGeoGrid)" />

          {segments.map((seg, i) => (
            <g key={`${seg.lineId}-${i}`}>
              <line
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                className="route-map__segment-glow"
                stroke={seg.lineColor}
              />
              <line
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                className="route-map__segment-hit"
                stroke="transparent"
                onMouseEnter={() => setHover({ type: 'segment', data: seg })}
                onMouseLeave={() => setHover(null)}
              />
              <line
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                className="route-map__segment"
                stroke={seg.lineColor}
                style={{ animationDelay: `${i * 0.08}s` }}
              />
            </g>
          ))}

          {nodes.map((node) => {
            const r = node.kind === 'start' || node.kind === 'end' ? 7 : node.kind === 'via' ? 5.5 : 4
            const showLabel = node.kind === 'start' || node.kind === 'end'

            return (
              <g
                key={node.stationId}
                className="route-map__node-group"
                onMouseEnter={() => setHover({ type: 'station', data: node })}
                onMouseLeave={() => setHover(null)}
              >
                <circle cx={node.x} cy={node.y} r={r + 6} className="route-map__node-hit" />
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r}
                  className={`route-map__node route-map__node--${node.kind}`}
                />
                {showLabel && (
                  <text x={node.x} y={node.y - 14} className="route-map__label">
                    {node.name}
                  </text>
                )}
              </g>
            )
          })}

          <CompassRose x={VIEW_W - PAD + 8} y={PAD + 4} size={48} />
        </svg>

        <AnimatePresence>
          {hover && (
            <motion.div
              className="route-map__tooltip"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
            >
              {hover.type === 'station' ? (
                <>
                  <strong>{hover.data.name}</strong>
                  <span>
                    {hover.data.kind === 'start' && 'Startbahnhof'}
                    {hover.data.kind === 'end' && 'Zielbahnhof'}
                    {hover.data.kind === 'via' && 'Zwischenhalt (ÜBER)'}
                    {hover.data.kind === 'stop' && `Zwischenstation ${hover.data.index + 1}`}
                  </span>
                  {hover.data.interchange && <span className="route-map__tooltip-tag">Umsteigebahnhof</span>}
                  {hover.data.lineNames.length > 0 && (
                    <span className="route-map__tooltip-lines">
                      Linien: {hover.data.lineNames.join(', ')}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <strong style={{ color: hover.data.lineColor }}>{hover.data.lineName}</strong>
                  <span>
                    {hover.data.fromName} → {hover.data.toName}
                  </span>
                  <span>
                    {formatDuration(getScaledRouteValues(hover.data.legDurationSeconds, hover.data.legDistanceMeters, scale).durationSeconds)}
                    {' · '}
                    {formatDistance(getScaledRouteValues(hover.data.legDurationSeconds, hover.data.legDistanceMeters, scale).distanceMeters)}
                    {' · '}
                    {hover.data.stopCount} Stationen
                  </span>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

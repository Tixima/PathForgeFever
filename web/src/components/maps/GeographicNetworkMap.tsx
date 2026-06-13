import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { buildGeographicLayout } from '../../lib/maps/geoLayout'
import type { NetworkMapMeta } from '../../types/network'
import type { LayoutStation, MapHover, NetworkMapData } from '../../lib/maps/types'
import { MapTooltip } from './MapTooltip'
import { CompassRose } from './CompassRose'
import { ZoomableMapViewport } from './ZoomableMapViewport'

interface GeographicNetworkMapProps {
  mapData: NetworkMapData
  boundingBox?: NetworkMapMeta['bounding_box']
  highlightStationIds?: number[]
  highlightLineIds?: number[]
  onStationClick?: (station: LayoutStation) => void
}

export function GeographicNetworkMap({
  mapData,
  boundingBox,
  highlightStationIds = [],
  highlightLineIds = [],
  onStationClick,
}: GeographicNetworkMapProps) {
  const [hover, setHover] = useState<MapHover | null>(null)
  const [hoveredLineId, setHoveredLineId] = useState<number | null>(null)

  const layout = useMemo(
    () =>
      buildGeographicLayout(mapData.stations, {
        boundingBox,
        preserveAspectRatio: true,
      }),
    [mapData.stations, boundingBox],
  )

  const posById = useMemo(
    () => new Map(layout.stations.map((s) => [s.id, { x: s.x, y: s.y }])),
    [layout.stations],
  )

  const highlightStationSet = useMemo(() => new Set(highlightStationIds), [highlightStationIds])
  const highlightLineSet = useMemo(() => new Set(highlightLineIds), [highlightLineIds])
  const dimLines = hoveredLineId !== null || highlightLineIds.length > 0

  return (
    <div className="netmap netmap--geo">
      <ZoomableMapViewport
        contentWidth={layout.width}
        contentHeight={layout.height}
        viewBox={layout.viewBox}
      >
        <defs>
          <pattern id="geoGrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={layout.width} height={layout.height} fill="url(#geoGrid)" />

        {mapData.edges.map((edge) => {
          const p1 = posById.get(edge.fromId)
          const p2 = posById.get(edge.toId)
          if (!p1 || !p2) return null

          const active = hoveredLineId === edge.lineId || highlightLineSet.has(edge.lineId)
          const dim = dimLines && !active

          return (
            <g key={edge.id}>
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                className="netmap__edge-glow"
                stroke={edge.lineColor}
                style={{ opacity: dim ? 0.08 : active ? 0.45 : 0.2 }}
              />
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                className="netmap__edge-hit"
                stroke="transparent"
                onMouseEnter={() => {
                  setHoveredLineId(edge.lineId)
                  const line = mapData.lines.find((l) => l.id === edge.lineId)
                  if (line) setHover({ type: 'line', line, edge })
                }}
                onMouseLeave={() => {
                  setHoveredLineId(null)
                  setHover(null)
                }}
              />
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                className="netmap__edge"
                stroke={edge.lineColor}
                style={{ opacity: dim ? 0.15 : active ? 1 : 0.55 }}
              />
            </g>
          )
        })}

        {layout.stations.map((station) => {
          const highlighted = highlightStationSet.has(station.id)
          const r = station.interchange ? 7 : highlighted ? 8 : 5

          return (
            <g
              key={station.id}
              className="netmap__station-group"
              onMouseEnter={() => setHover({ type: 'station', station })}
              onMouseLeave={() => setHover(null)}
              onClick={() => onStationClick?.(station)}
            >
              <circle cx={station.x} cy={station.y} r={r + 8} className="netmap__station-hit" />
              {highlighted && (
                <circle cx={station.x} cy={station.y} r={r + 4} className="netmap__station-highlight-ring" />
              )}
              <circle
                cx={station.x}
                cy={station.y}
                r={r}
                className={`netmap__station ${station.interchange ? 'netmap__station--hub' : ''}`}
              />
              {(station.interchange || highlighted) && (
                <text x={station.x} y={station.y - r - 8} className="netmap__station-label">
                  {station.name}
                </text>
              )}
            </g>
          )
        })}
        <CompassRose x={layout.width - 56} y={56} size={52} />
      </ZoomableMapViewport>

      <AnimatePresence mode="wait">
        {hover && <MapTooltip hover={hover} mapData={mapData} />}
      </AnimatePresence>
    </div>
  )
}

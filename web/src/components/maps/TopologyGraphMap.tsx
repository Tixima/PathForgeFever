import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { buildGeographicLayout } from '../../lib/maps/geoLayout'
import { resolveGeoBounds } from '../../lib/maps/geoProjection'
import type { NetworkMapMeta } from '../../types/network'
import type { TerrainExport } from '../../types/terrain'
import type { LayoutStation, MapHover, NetworkMapData } from '../../lib/maps/types'
import { buildNetworkMapOverlay } from '../../lib/maps/map3dOverlay'
import { MapTooltip } from './MapTooltip'
import { CompassRose } from './CompassRose'
import { GeographicMapFrame } from './GeographicMapFrame'
import { TerrainMapBackground } from './TerrainMapBackground'
import { ZoomableMapViewport } from './ZoomableMapViewport'

interface TopologyGraphMapProps {
  mapData: NetworkMapData
  boundingBox?: NetworkMapMeta['bounding_box']
  terrain?: TerrainExport | null
  highlightStationIds?: number[]
  highlightLineIds?: number[]
  onStationClick?: (station: LayoutStation) => void
}

export function TopologyGraphMap({
  mapData,
  boundingBox,
  terrain,
  highlightStationIds = [],
  highlightLineIds = [],
  onStationClick,
}: TopologyGraphMapProps) {
  const [hover, setHover] = useState<MapHover | null>(null)
  const [hoveredLineId, setHoveredLineId] = useState<number | null>(null)
  const [hoveredStationId, setHoveredStationId] = useState<number | null>(null)

  const layout = useMemo(
    () =>
      buildGeographicLayout(mapData.stations, {
        boundingBox,
        preserveAspectRatio: true,
      }),
    [mapData.stations, boundingBox],
  )

  const geoBounds = useMemo(
    () => resolveGeoBounds(mapData.stations, { boundingBox, preserveAspectRatio: true }),
    [mapData.stations, boundingBox],
  )

  const posById = useMemo(
    () => new Map(layout.stations.map((s) => [s.id, { x: s.x, y: s.y }])),
    [layout.stations],
  )

  const highlightStationSet = useMemo(() => new Set(highlightStationIds), [highlightStationIds])
  const highlightLineSet = useMemo(() => new Set(highlightLineIds), [highlightLineIds])
  const dimLines = hoveredLineId !== null || highlightLineIds.length > 0

  const overlay3d = useMemo(
    () =>
      buildNetworkMapOverlay(mapData.stations, mapData.edges, terrain, {
        highlightStationIds,
        highlightLineIds,
        dimUnhighlighted: dimLines,
        stationBounds: geoBounds,
      }),
    [mapData.stations, mapData.edges, terrain, highlightStationIds, highlightLineIds, dimLines, geoBounds],
  )

  return (
    <GeographicMapFrame terrain={terrain} overlay={overlay3d} stationBounds={geoBounds} className="netmap netmap--topology">
      <ZoomableMapViewport
        contentWidth={layout.width}
        contentHeight={layout.height}
        viewBox={layout.viewBox}
      >
        <defs>
          <pattern id="topologyGeoGrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={layout.width} height={layout.height} fill="#1a2838" />
        <TerrainMapBackground
          terrain={terrain}
          bounds={geoBounds}
          width={layout.width}
          height={layout.height}
        />
        <rect width={layout.width} height={layout.height} fill="url(#topologyGeoGrid)" opacity={0.12} />

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
                style={{ opacity: dim ? 0.05 : active ? 0.4 : 0.12 }}
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
                  setHover({
                    type: 'line',
                    line: mapData.lines.find((l) => l.id === edge.lineId)!,
                    edge,
                  })
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
                className="netmap__edge netmap__edge--topology"
                stroke={edge.lineColor}
                style={{ opacity: dim ? 0.1 : active ? 1 : 0.45 }}
              />
            </g>
          )
        })}

        {layout.stations.map((station) => {
          const highlighted = highlightStationSet.has(station.id)
          const isHovered = hoveredStationId === station.id
          const isHub = station.interchange || station.lineIds.length > 1
          const r = isHub ? 12 : highlighted ? 11 : 8

          return (
            <g
              key={station.id}
              className="netmap__station-group"
              onMouseEnter={() => {
                setHoveredStationId(station.id)
                setHover({ type: 'station', station })
              }}
              onMouseLeave={() => {
                setHoveredStationId(null)
                setHover(null)
              }}
              onClick={() => onStationClick?.(station)}
            >
              <circle cx={station.x} cy={station.y} r={r + 14} className="netmap__station-hit" />
              {isHub && (
                <circle cx={station.x} cy={station.y} r={r + 5} className="netmap__station-hub-ring" />
              )}
              {highlighted && (
                <circle cx={station.x} cy={station.y} r={r + 8} className="netmap__station-highlight-ring" />
              )}
              <circle
                cx={station.x}
                cy={station.y}
                r={r}
                className={`netmap__station ${isHub ? 'netmap__station--hub' : ''} ${isHovered ? 'is-hovered' : ''}`}
              />
              {(isHovered || isHub || highlighted) && (
                <text x={station.x} y={station.y - r - 10} className="netmap__station-label netmap__station-label--large">
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
    </GeographicMapFrame>
  )
}

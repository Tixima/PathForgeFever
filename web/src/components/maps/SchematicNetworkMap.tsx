import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  buildLineSegmentPaths,
  buildSchematicLayout,
  buildStationConnectors,
  getLayoutPadding,
  getLineLocalX,
  getLineTrackY,
} from '../../lib/maps/schematicLayout'
import type { LayoutStation, MapHover, MapLine, NetworkMapData } from '../../lib/maps/types'
import { MapTooltip } from './MapTooltip'
import { ZoomableMapViewport } from './ZoomableMapViewport'

interface SchematicNetworkMapProps {
  mapData: NetworkMapData
  highlightStationIds?: number[]
  highlightLineIds?: number[]
  onStationClick?: (station: LayoutStation) => void
}

export function SchematicNetworkMap({
  mapData,
  highlightStationIds = [],
  highlightLineIds = [],
  onStationClick,
}: SchematicNetworkMapProps) {
  const [hover, setHover] = useState<MapHover | null>(null)
  const [hoveredLineId, setHoveredLineId] = useState<number | null>(null)
  const [hoveredStationId, setHoveredStationId] = useState<number | null>(null)

  const layout = useMemo(
    () => buildSchematicLayout(mapData.stations, mapData.lines),
    [mapData.stations, mapData.lines],
  )

  const { padX } = getLayoutPadding()

  const posById = useMemo(
    () => new Map(layout.stations.map((s) => [s.id, { x: s.x, y: s.y }])),
    [layout.stations],
  )

  const segmentPaths = useMemo(
    () => buildLineSegmentPaths(mapData.lines, layout.lineLocalX, layout.lineTracks),
    [mapData.lines, layout.lineLocalX, layout.lineTracks],
  )

  const connectors = useMemo(
    () =>
      buildStationConnectors(
        mapData.lines,
        layout.lineLocalX,
        layout.lineTracks,
        posById,
      ),
    [mapData.lines, layout.lineLocalX, layout.lineTracks, posById],
  )

  const trackLines = useMemo(
    () =>
      mapData.lines.map((line) => ({
        line,
        y: getLineTrackY(line.id, layout.lineTracks),
      })),
    [mapData.lines, layout.lineTracks],
  )

  const terminusIds = useMemo(
    () =>
      new Set(
        mapData.lines
          .map((l) => l.layoutStationIds[l.layoutStationIds.length - 1])
          .filter(Boolean),
      ),
    [mapData.lines],
  )

  const lineById = useMemo(() => new Map(mapData.lines.map((l) => [l.id, l])), [mapData.lines])

  const highlightStationSet = useMemo(() => new Set(highlightStationIds), [highlightStationIds])
  const highlightLineSet = useMemo(() => new Set(highlightLineIds), [highlightLineIds])
  const dimLines = hoveredLineId !== null || highlightLineIds.length > 0

  return (
    <div className="netmap netmap--schematic">
      <ZoomableMapViewport
        contentWidth={layout.width}
        contentHeight={layout.height}
        viewBox={layout.viewBox}
      >
        <rect width={layout.width} height={layout.height} fill="rgba(255,255,255,0.02)" />

        {trackLines.map(({ line, y }) => (
          <g key={`track-${line.id}`}>
            <line
              x1={padX - 40}
              y1={y}
              x2={layout.width - padX + 40}
              y2={y}
              className="netmap__track-guide"
              stroke={line.color}
            />
            <LineEndLabels
              line={line}
              lineLocalX={layout.lineLocalX}
              trackY={y}
              mapData={mapData}
            />
          </g>
        ))}

        {segmentPaths.map((seg, idx) => {
          const line = lineById.get(seg.lineId)
          if (!line) return null

          const active = hoveredLineId === seg.lineId || highlightLineSet.has(seg.lineId)
          const dim = dimLines && !active

          return (
            <g key={`${seg.lineId}-${idx}`}>
              <path
                d={seg.path}
                className="netmap__line-glow"
                stroke={line.color}
                style={{ opacity: dim ? 0.04 : active ? 0.45 : 0.15 }}
              />
              <path
                d={seg.path}
                className="netmap__line-hit"
                stroke="transparent"
                onMouseEnter={() => {
                  setHoveredLineId(seg.lineId)
                  setHover({ type: 'line', line })
                }}
                onMouseLeave={() => {
                  setHoveredLineId(null)
                  setHover(null)
                }}
              />
              <path
                d={seg.path}
                className="netmap__line-path"
                stroke={line.color}
                style={{ opacity: dim ? 0.15 : active ? 1 : 0.85 }}
              />
            </g>
          )
        })}

        {connectors.map((conn) => {
          const line = lineById.get(conn.lineId)
          if (!line) return null
          const active = hoveredLineId === conn.lineId || highlightLineSet.has(conn.lineId)
          const dim = dimLines && !active

          return (
            <line
              key={`conn-${conn.lineId}-${conn.stationId}`}
              x1={conn.trackX}
              y1={conn.trackY}
              x2={conn.nodeX}
              y2={conn.nodeY}
              className="netmap__station-connector"
              stroke={line.color}
              style={{ opacity: dim ? 0.1 : active ? 0.55 : 0.28 }}
            />
          )
        })}

        {layout.stations.map((station) => {
          const highlighted = highlightStationSet.has(station.id)
          const isHovered = hoveredStationId === station.id
          const isHub = station.interchange || station.lineIds.length > 1
          const isTerminus = terminusIds.has(station.id)
          const showLabel = isHovered || highlighted || isHub || isTerminus
          const r = isTerminus ? 10 : isHub ? 9 : highlighted ? 8 : 6

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
              <circle cx={station.x} cy={station.y} r={r + 16} className="netmap__station-hit" />
              {isTerminus && (
                <rect
                  x={station.x - r - 3}
                  y={station.y - r - 3}
                  width={(r + 3) * 2}
                  height={(r + 3) * 2}
                  className="netmap__terminus-marker"
                  transform={`rotate(45 ${station.x} ${station.y})`}
                />
              )}
              {isHub && !isTerminus && (
                <circle cx={station.x} cy={station.y} r={r + 4} className="netmap__station-hub-ring" />
              )}
              {highlighted && (
                <circle cx={station.x} cy={station.y} r={r + 7} className="netmap__station-highlight-ring" />
              )}
              <circle
                cx={station.x}
                cy={station.y}
                r={r}
                className={`netmap__station netmap__station--schematic ${isHub ? 'netmap__station--hub' : ''} ${isHovered ? 'is-hovered' : ''}`}
              />
              {showLabel && (
                <text
                  x={station.x}
                  y={station.y - r - 12}
                  className={`netmap__station-label netmap__station-label--large ${isHub ? 'netmap__station-label--hub' : ''}`}
                >
                  {station.name}
                </text>
              )}
            </g>
          )
        })}
      </ZoomableMapViewport>

      <AnimatePresence mode="wait">
        {hover && <MapTooltip hover={hover} mapData={mapData} />}
      </AnimatePresence>
    </div>
  )
}

function LineEndLabels({
  line,
  lineLocalX,
  trackY,
  mapData,
}: {
  line: MapLine
  lineLocalX: Map<number, Map<number, number>>
  trackY: number
  mapData: NetworkMapData
}) {
  const firstId = line.layoutStationIds[0]
  const lastId = line.layoutStationIds[line.layoutStationIds.length - 1]
  const start = firstId ? mapData.stationById.get(firstId) : undefined
  const end = lastId ? mapData.stationById.get(lastId) : undefined
  const startX = firstId ? getLineLocalX(line.id, firstId, lineLocalX) : undefined
  const endX = lastId ? getLineLocalX(line.id, lastId, lineLocalX) : undefined
  const label = line.name.replace('Linie ', 'L')

  return (
    <g className="netmap__line-ends">
      {startX !== undefined && start && (
        <g>
          <rect
            x={startX - 56}
            y={trackY - 48}
            width={112}
            height={20}
            rx={5}
            fill={line.color}
            opacity={0.92}
          />
          <text x={startX} y={trackY - 34} className="netmap__line-end-text">
            {label} · {start.name}
          </text>
        </g>
      )}
      {endX !== undefined && end && lastId !== firstId && (
        <g>
          <rect
            x={endX - 56}
            y={trackY + 30}
            width={112}
            height={20}
            rx={5}
            fill={line.color}
            opacity={0.72}
          />
          <text x={endX} y={trackY + 44} className="netmap__line-end-text">
            {end.name}
          </text>
        </g>
      )}
    </g>
  )
}

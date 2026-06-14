import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  buildLineSegmentPaths,
  buildLineStopMarkers,
  buildSchematicLayout,
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
  const [hoveredStopKey, setHoveredStopKey] = useState<string | null>(null)

  const layout = useMemo(
    () => buildSchematicLayout(mapData.stations, mapData.lines),
    [mapData.stations, mapData.lines],
  )

  const { padX } = getLayoutPadding()

  const segmentPaths = useMemo(
    () => buildLineSegmentPaths(mapData.lines, layout.lineLocalX, layout.lineTracks),
    [mapData.lines, layout.lineLocalX, layout.lineTracks],
  )

  const lineStops = useMemo(
    () => buildLineStopMarkers(mapData.lines, layout.lineLocalX, layout.lineTracks),
    [mapData.lines, layout.lineLocalX, layout.lineTracks],
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
  const stationById = mapData.stationById

  const hubLabelPositions = useMemo(() => {
    const groups = new Map<
      number,
      { minY: number; maxY: number; station: LayoutStation }
    >()

    for (const stop of lineStops) {
      const station = stationById.get(stop.stationId)
      if (!station) continue
      const existing = groups.get(stop.stationId)
      if (!existing) {
        groups.set(stop.stationId, {
          minY: stop.y,
          maxY: stop.y,
          station: { ...station, x: stop.x, y: stop.y },
        })
        continue
      }
      existing.minY = Math.min(existing.minY, stop.y)
      existing.maxY = Math.max(existing.maxY, stop.y)
    }

    return [...groups.values()]
      .filter((g) => g.station.interchange || g.maxY - g.minY > 8)
      .map((g) => ({
        station: g.station,
        labelY: g.minY - 12,
      }))
  }, [lineStops, stationById])

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
              x1={padX - 32}
              y1={y}
              x2={layout.width - padX + 32}
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
                style={{ opacity: dim ? 0.04 : active ? 0.4 : 0.12 }}
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
                strokeWidth={active ? 4 : 3}
                style={{ opacity: dim ? 0.2 : active ? 1 : 0.88 }}
              />
            </g>
          )
        })}

        {lineStops.map((stop) => {
          const line = lineById.get(stop.lineId)
          const station = stationById.get(stop.stationId)
          if (!line || !station) return null

          const stopKey = `${stop.lineId}-${stop.stationId}`
          const lineActive = hoveredLineId === stop.lineId || highlightLineSet.has(stop.lineId)
          const stopHovered = hoveredStopKey === stopKey
          const dim = dimLines && !lineActive
          const isTerminus = terminusIds.has(stop.stationId)
          const isHub = station.interchange || station.lineIds.length > 1
          const r = isTerminus ? 5 : isHub ? 4.5 : 3.5

          const layoutStation: LayoutStation = {
            ...station,
            x: stop.x,
            y: stop.y,
          }

          return (
            <g
              key={stopKey}
              className="netmap__station-group"
              onMouseEnter={() => {
                setHoveredStopKey(stopKey)
                setHoveredLineId(stop.lineId)
                setHover({ type: 'station', station: layoutStation })
              }}
              onMouseLeave={() => {
                setHoveredStopKey(null)
                setHoveredLineId(null)
                setHover(null)
              }}
              onClick={() => onStationClick?.(layoutStation)}
            >
              <circle
                cx={stop.x}
                cy={stop.y}
                r={r + 10}
                className="netmap__station-hit"
                style={{ opacity: dim ? 0.35 : 1 }}
              />
              <circle
                cx={stop.x}
                cy={stop.y}
                r={r}
                fill={line.color}
                stroke="rgba(15,23,42,0.85)"
                strokeWidth={1.5}
                className={`netmap__station netmap__station--schematic ${stopHovered ? 'is-hovered' : ''}`}
                style={{ opacity: dim ? 0.25 : 1 }}
              />
            </g>
          )
        })}

        {hubLabelPositions.map(({ station, labelY }) => {
          const highlighted = highlightStationSet.has(station.id)
          const show =
            highlighted ||
            hoveredStopKey?.endsWith(`-${station.id}`) ||
            station.interchange

          if (!show) return null

          return (
            <text
              key={`label-${station.id}`}
              x={station.x}
              y={labelY}
              textAnchor="middle"
              className={`netmap__station-label netmap__station-label--large ${station.interchange ? 'netmap__station-label--hub' : ''}`}
            >
              {station.name}
            </text>
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
  const label = line.name.replace(/^Linie\s*/i, 'L')

  return (
    <g className="netmap__line-ends">
      {startX !== undefined && start && (
        <g>
          <rect
            x={startX - 52}
            y={trackY - 42}
            width={104}
            height={18}
            rx={4}
            fill={line.color}
            opacity={0.92}
          />
          <text x={startX} y={trackY - 29} className="netmap__line-end-text">
            {label} · {start.name}
          </text>
        </g>
      )}
      {endX !== undefined && end && lastId !== firstId && (
        <g>
          <rect
            x={endX - 52}
            y={trackY + 26}
            width={104}
            height={18}
            rx={4}
            fill={line.color}
            opacity={0.72}
          />
          <text x={endX} y={trackY + 39} className="netmap__line-end-text">
            {end.name}
          </text>
        </g>
      )}
    </g>
  )
}

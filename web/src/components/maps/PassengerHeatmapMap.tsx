import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { buildLineSegmentPaths, buildSchematicLayout } from '../../lib/maps/schematicLayout'
import type { LayoutStation, MapHover, NetworkMapData } from '../../lib/maps/types'
import { MapTooltip } from './MapTooltip'
import { ZoomableMapViewport } from './ZoomableMapViewport'

interface PassengerHeatmapMapProps {
  mapData: NetworkMapData
  passengerByLineId: Map<number, number>
  onStationClick?: (station: LayoutStation) => void
}

export function PassengerHeatmapMap({
  mapData,
  passengerByLineId,
  onStationClick,
}: PassengerHeatmapMapProps) {
  const [hover, setHover] = useState<MapHover | null>(null)
  const [hoveredLineId, setHoveredLineId] = useState<number | null>(null)

  const layout = useMemo(
    () => buildSchematicLayout(mapData.stations, mapData.lines),
    [mapData.stations, mapData.lines],
  )

  const maxPax = useMemo(() => {
    let max = 1
    for (const v of passengerByLineId.values()) {
      if (v > max) max = v
    }
    return max
  }, [passengerByLineId])

  const segmentPaths = useMemo(
    () => buildLineSegmentPaths(mapData.lines, layout.lineLocalX, layout.lineTracks),
    [mapData.lines, layout.lineLocalX, layout.lineTracks],
  )

  return (
    <div className="netmap netmap--heatmap">
      <ZoomableMapViewport
        contentWidth={layout.width}
        contentHeight={layout.height}
        viewBox={layout.viewBox}
      >
        {segmentPaths.map((seg) => {
          const line = mapData.lines.find((l) => l.id === seg.lineId)
          if (!line) return null

          const pax = passengerByLineId.get(line.id) ?? 0
          const intensity = 0.25 + (pax / maxPax) * 0.75
          const width = 2 + (pax / maxPax) * 10
          const active = hoveredLineId === line.id

          return (
            <g key={`${line.id}-${seg.direction}`}>
              <path
                d={seg.path}
                fill="none"
                stroke={line.color}
                strokeWidth={width + 6}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={active ? intensity * 0.35 : intensity * 0.2}
                style={{ filter: 'blur(4px)' }}
              />
              <path
                d={seg.path}
                fill="none"
                stroke={line.color}
                strokeWidth={width}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={active ? 1 : intensity}
                className="netmap__heatmap-line"
                onMouseEnter={() => {
                  setHoveredLineId(line.id)
                  setHover({ type: 'line', line })
                }}
                onMouseLeave={() => {
                  setHoveredLineId(null)
                  setHover(null)
                }}
              />
            </g>
          )
        })}

        {layout.stations.map((station) => {
          const r = station.interchange ? 6 : 4
          return (
            <g
              key={station.id}
              onMouseEnter={() => setHover({ type: 'station', station })}
              onMouseLeave={() => setHover(null)}
              onClick={() => onStationClick?.(station)}
            >
              <circle cx={station.x} cy={station.y} r={r + 6} className="netmap__station-hit" />
              <circle
                cx={station.x}
                cy={station.y}
                r={r}
                className={`netmap__station ${station.interchange ? 'netmap__station--hub' : ''}`}
              />
            </g>
          )
        })}
      </ZoomableMapViewport>

      <AnimatePresence mode="wait">
        {hover && (
          <MapTooltip
            hover={hover}
            mapData={mapData}
            extra={
              hover.type === 'line'
                ? `${(passengerByLineId.get(hover.line.id) ?? 0).toLocaleString('de-DE')} Passagiere`
                : undefined
            }
          />
        )}
      </AnimatePresence>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { NetworkExport } from '../../types/network'
import type { RouteCriterion } from '../../lib/routing/types'
import type { ScaleSettings } from '../../lib/scale'
import { buildGeographicLayout } from '../../lib/maps/geoLayout'
import { resolveGeoBounds } from '../../lib/maps/geoProjection'
import { buildNetworkMapData } from '../../lib/maps/buildNetworkMapData'
import type { LayoutStation } from '../../lib/maps/types'
import { placeMapLabels } from '../../lib/maps/mapLabelPlacement'
import {
  buildIsochroneData,
  countByBucket,
  getIsochroneBuckets,
} from '../../lib/reach/isochrone'
import { buildIsochroneOverlay } from '../../lib/maps/map3dOverlay'
import { GeographicMapFrame } from '../maps/GeographicMapFrame'
import { TerrainMapBackground } from '../maps/TerrainMapBackground'
import { formatDuration, formatDurationCompact } from '../../lib/format'
import { ZoomableMapViewport } from '../maps/ZoomableMapViewport'
import { CompassRose } from '../maps/CompassRose'

interface IsochroneMapProps {
  network: NetworkExport
  originId: number
  criterion: RouteCriterion
  scale: ScaleSettings
  onStationClick?: (stationId: number) => void
}

interface IsochroneHover {
  station: LayoutStation
  durationSeconds?: number
}

export function IsochroneMap({
  network,
  originId,
  criterion,
  scale,
  onStationClick,
}: IsochroneMapProps) {
  const [hover, setHover] = useState<IsochroneHover | null>(null)
  const mapData = useMemo(() => buildNetworkMapData(network), [network])
  const layout = useMemo(
    () =>
      buildGeographicLayout(mapData.stations, {
        boundingBox: network.network_map?.bounding_box,
      }),
    [mapData.stations, network.network_map?.bounding_box],
  )

  const geoBounds = useMemo(
    () =>
      resolveGeoBounds(mapData.stations, {
        boundingBox: network.network_map?.bounding_box,
      }),
    [mapData.stations, network.network_map?.bounding_box],
  )
  const buckets = useMemo(() => getIsochroneBuckets(scale), [scale])
  const isochrone = useMemo(
    () => buildIsochroneData(network, originId, criterion, scale),
    [network, originId, criterion, scale],
  )

  const colorByStation = useMemo(
    () => new Map(isochrone.map((i) => [i.stationId, i.bucket.color])),
    [isochrone],
  )

  const durationByStation = useMemo(
    () => new Map(isochrone.map((i) => [i.stationId, i.durationSeconds])),
    [isochrone],
  )

  const bucketCounts = useMemo(() => countByBucket(isochrone), [isochrone])

  const posById = useMemo(
    () => new Map(layout.stations.map((s) => [s.id, { x: s.x, y: s.y }])),
    [layout.stations],
  )

  const labelByStation = useMemo(() => {
    const requests = layout.stations
      .filter((station) => durationByStation.has(station.id))
      .map((station) => {
        const isOrigin = station.id === originId
        const durationSeconds = durationByStation.get(station.id)
        const r = isOrigin ? 10 : station.interchange ? 8 : 6
        return {
          id: station.id,
          x: station.x,
          y: station.y,
          primary: station.name,
          secondary:
            durationSeconds !== undefined && durationSeconds > 0
              ? formatDurationCompact(durationSeconds)
              : isOrigin
                ? 'Start'
                : undefined,
          priority: isOrigin ? 10_000 : station.interchange ? 1_000 + station.degree : 100,
          markerRadius: r + 6,
          forceVisible: isOrigin,
        }
      })

    const placed = placeMapLabels(requests, {
      width: layout.width,
      height: layout.height,
    })
    return new Map(placed.map((label) => [label.id, label]))
  }, [layout.stations, layout.width, layout.height, durationByStation, originId])

  const overlay3d = useMemo(
    () =>
      buildIsochroneOverlay(mapData.stations, network.terrain, {
        originId,
        colorByStationId: new Map(
          isochrone.map((i) => [i.stationId, i.bucket.color]),
        ),
        reachableIds: new Set(isochrone.map((i) => i.stationId)),
        stationBounds: geoBounds,
      }),
    [mapData.stations, network.terrain, originId, isochrone, geoBounds],
  )

  return (
    <div className="isochrone-map">
      <div className="isochrone-map__legend">
        {buckets.map((bucket, i) => (
          <span key={bucket.label} className="isochrone-map__legend-item">
            <span className="isochrone-map__swatch" style={{ backgroundColor: bucket.color }} />
            {bucket.label}
            <small>{bucketCounts[i] ?? 0}</small>
          </span>
        ))}
      </div>

      <GeographicMapFrame terrain={network.terrain} overlay={overlay3d} stationBounds={geoBounds}>
        <div className="netmap netmap--geo isochrone-map__canvas">
        <ZoomableMapViewport
          contentWidth={layout.width}
          contentHeight={layout.height}
          viewBox={layout.viewBox}
        >
          <rect width={layout.width} height={layout.height} fill="#1a2838" />
          <TerrainMapBackground
            terrain={network.terrain}
            bounds={geoBounds}
            width={layout.width}
            height={layout.height}
          />
          {mapData.edges.map((edge) => {
            const p1 = posById.get(edge.fromId)
            const p2 = posById.get(edge.toId)
            if (!p1 || !p2) return null
            return (
              <line
                key={edge.id}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={1.5}
              />
            )
          })}

          {layout.stations.map((station) => {
            const color = colorByStation.get(station.id) ?? 'rgba(255,255,255,0.2)'
            const durationSeconds = durationByStation.get(station.id)
            const isOrigin = station.id === originId
            const isReachable = durationByStation.has(station.id)
            const r = isOrigin ? 10 : station.interchange ? 8 : 6

            return (
              <g
                key={station.id}
                className="isochrone-map__station"
                onMouseEnter={() => setHover({ station, durationSeconds })}
                onMouseLeave={() => setHover(null)}
                onClick={() => onStationClick?.(station.id)}
              >
                <circle cx={station.x} cy={station.y} r={r + 10} fill="transparent" />
                <circle
                  cx={station.x}
                  cy={station.y}
                  r={r + 6}
                  fill={color}
                  opacity={isReachable ? 0.25 : 0.12}
                />
                <circle
                  cx={station.x}
                  cy={station.y}
                  r={r}
                  fill={color}
                  stroke={isOrigin ? '#fff' : 'rgba(0,0,0,0.3)'}
                  strokeWidth={isOrigin ? 2.5 : 1}
                />
                <title>
                  {station.name}
                  {durationSeconds !== undefined && durationSeconds > 0
                    ? ` · ${formatDuration(durationSeconds)}`
                    : isOrigin
                      ? ' · Start'
                      : ''}
                </title>
              </g>
            )
          })}

          {layout.stations.map((station) => {
            const label = labelByStation.get(station.id)
            if (!label?.visible) return null

            return (
              <text
                key={`label-${station.id}`}
                x={label.labelX}
                y={label.labelY}
                textAnchor={label.textAnchor}
                dominantBaseline="hanging"
                className={`isochrone-map__label${station.id === originId ? ' isochrone-map__label--origin' : ''}`}
              >
                <tspan x={label.labelX} dy={0}>
                  {label.primary}
                </tspan>
                {label.secondary && (
                  <tspan x={label.labelX} dy={13} className="isochrone-map__time">
                    {label.secondary}
                  </tspan>
                )}
              </text>
            )
          })}

          <CompassRose x={layout.width - 56} y={56} size={48} />
        </ZoomableMapViewport>

        <AnimatePresence mode="wait">
          {hover && (
            <motion.div
              className="netmap-tooltip isochrone-map__tooltip"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <strong>{hover.station.name}</strong>
              <span>
                {hover.durationSeconds !== undefined && hover.durationSeconds > 0
                  ? formatDuration(hover.durationSeconds)
                  : hover.station.id === originId
                    ? 'Startbahnhof'
                    : 'Nicht erreichbar'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </GeographicMapFrame>
    </div>
  )
}

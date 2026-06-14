import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { buildGeographicLayout } from '../../lib/maps/geoLayout'
import { projectGeoPoint, resolveGeoBounds, type GeoBounds } from '../../lib/maps/geoProjection'
import type { NetworkMapMeta } from '../../types/network'
import type { TerrainExport } from '../../types/terrain'
import type { LayoutStation, MapHover, NetworkMapData } from '../../lib/maps/types'
import {
  buildGeneralMapLayersData,
  generalMapLayersAvailable,
} from '../../lib/maps/buildGeneralMapData'
import {
  buildGeneralMapOverlay,
  DEFAULT_GENERAL_MAP_LAYERS,
  type GeneralMapLayerVisibility,
} from '../../lib/maps/generalMapOverlay'
import { hasTerrainData } from '../../lib/terrain/terrainAvailability'
import { MapTooltip } from './MapTooltip'
import { CompassRose } from './CompassRose'
import { GeographicMapFrame } from './GeographicMapFrame'
import { TerrainMapBackground } from './TerrainMapBackground'
import { ZoomableMapViewport } from './ZoomableMapViewport'
import { MapLayerPanel } from './MapLayerPanel'
import type { NetworkExport } from '../../types/network'

interface GeneralMapProps {
  network: NetworkExport
  mapData: NetworkMapData
  boundingBox?: NetworkMapMeta['bounding_box']
  terrain?: TerrainExport | null
  highlightStationIds?: number[]
  highlightLineIds?: number[]
  onStationClick?: (station: LayoutStation) => void
}

function polylinePath(
  points: Array<{ geoX: number; geoY: number }>,
  layoutWidth: number,
  layoutHeight: number,
  bounds: GeoBounds,
): string {
  const segments = points.map((p) => {
    const { x, y } = projectGeoPoint(p.geoX, p.geoY, bounds, {
      width: layoutWidth,
      height: layoutHeight,
      preserveAspectRatio: true,
    })
    return `${x},${y}`
  })
  return `M ${segments.join(' L ')}`
}

export function GeneralMap({
  network,
  mapData,
  boundingBox,
  terrain,
  highlightStationIds = [],
  highlightLineIds = [],
  onStationClick,
}: GeneralMapProps) {
  const [hover, setHover] = useState<MapHover | null>(null)
  const [layers, setLayers] = useState<GeneralMapLayerVisibility>(DEFAULT_GENERAL_MAP_LAYERS)

  const lineColorById = useMemo(() => {
    const map = new Map<number, string>()
    for (const line of mapData.lines) map.set(line.id, line.color)
    return map
  }, [mapData.lines])

  const layerData = useMemo(
    () => buildGeneralMapLayersData(network, lineColorById),
    [network, lineColorById],
  )

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

  const highlightStationSet = useMemo(() => new Set(highlightStationIds), [highlightStationIds])
  const highlightLineSet = useMemo(() => new Set(highlightLineIds), [highlightLineIds])
  const dimLines = highlightLineIds.length > 0

  const overlay3d = useMemo(
    () =>
      buildGeneralMapOverlay(
        mapData.stations,
        layerData.tracks,
        layerData.lines,
        terrain,
        layers,
        {
          highlightStationIds,
          highlightLineIds,
          stationBounds: geoBounds,
        },
      ),
    [
      mapData.stations,
      layerData.tracks,
      layerData.lines,
      terrain,
      layers,
      highlightStationIds,
      highlightLineIds,
      geoBounds,
    ],
  )

  const trackDataAvailable = generalMapLayersAvailable(network)

  return (
    <div className="general-map">
      <MapLayerPanel
        layers={layers}
        onChange={setLayers}
        hasTerrain={hasTerrainData(terrain)}
        hasTracks={layerData.hasTracks}
        hasLinePaths={layerData.hasLinePaths}
      />

      {!trackDataAvailable && (
        <p className="general-map__notice">
          Kein Schienennetz im Export — bitte mit Exporter v1.5+ neu exportieren für Gleise und
          Linien entlang der Schienen.
        </p>
      )}

      <GeographicMapFrame
        terrain={terrain}
        overlay={overlay3d}
        stationBounds={geoBounds}
        className="netmap netmap--general"
      >
        <ZoomableMapViewport
          contentWidth={layout.width}
          contentHeight={layout.height}
          viewBox={layout.viewBox}
        >
          <defs>
            <pattern id="generalGrid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={layout.width} height={layout.height} fill="#1a2838" />

          {layers.terrain && (
            <TerrainMapBackground
              terrain={terrain}
              bounds={geoBounds}
              width={layout.width}
              height={layout.height}
            />
          )}

          {layers.grid && (
            <rect width={layout.width} height={layout.height} fill="url(#generalGrid)" opacity={0.12} />
          )}

          {layers.tracks &&
            layerData.tracks.map((track) => (
              <path
                key={track.id}
                d={polylinePath(track.geoPoints, layout.width, layout.height, geoBounds)}
                fill="none"
                stroke={track.color}
                strokeWidth={track.width}
                strokeOpacity={track.opacity}
                className="general-map__track"
              />
            ))}

          {layers.lines &&
            layerData.lines.map((linePath) => {
              const active = linePath.lineId != null && highlightLineSet.has(linePath.lineId)
              const dim = dimLines && !active
              return (
                <path
                  key={linePath.id}
                  d={polylinePath(linePath.geoPoints, layout.width, layout.height, geoBounds)}
                  fill="none"
                  stroke={linePath.color}
                  strokeWidth={linePath.width}
                  strokeOpacity={dim ? linePath.opacity * 0.4 : linePath.opacity}
                  strokeDasharray={linePath.dashed ? '8 6' : undefined}
                  className="general-map__line-path"
                  onMouseEnter={() => {
                    if (linePath.lineId == null) return
                    const line = mapData.lines.find((l) => l.id === linePath.lineId)
                    if (line) setHover({ type: 'line', line })
                  }}
                  onMouseLeave={() => setHover(null)}
                />
              )
            })}

          {layers.stations &&
            layout.stations.map((station) => {
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
                    <circle
                      cx={station.x}
                      cy={station.y}
                      r={r + 4}
                      className="netmap__station-highlight-ring"
                    />
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
      </GeographicMapFrame>
    </div>
  )
}

import { useMemo } from 'react'
import type { NetworkMapMeta } from '../../types/network'
import { buildGeographicLayout } from '../../lib/maps/geoLayout'
import type { LayoutStation, NetworkMapData } from '../../lib/maps/types'
import type { ComplexJourneyLineProposal } from '../../lib/routing/complexJourneyRemedies'
import { CompassRose } from './CompassRose'
import { ZoomableMapViewport } from './ZoomableMapViewport'

interface ComplexJourneyRemedyMapProps {
  mapData: NetworkMapData
  boundingBox?: NetworkMapMeta['bounding_box']
  proposals: ComplexJourneyLineProposal[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function ComplexJourneyRemedyMap({
  mapData,
  boundingBox,
  proposals,
  selectedId,
  onSelect,
}: ComplexJourneyRemedyMapProps) {
  const selected =
    proposals.find((p) => p.id === selectedId) ?? proposals[0] ?? null

  const focusStations = useMemo(() => {
    if (!selected) return mapData.stations
    const idSet = new Set(selected.highlightStationIds)
    return mapData.stations.filter((s) => idSet.has(s.id))
  }, [mapData.stations, selected])

  const layout = useMemo(
    () =>
      buildGeographicLayout(focusStations.length > 0 ? focusStations : mapData.stations, {
        boundingBox,
        fitToPoints: focusStations.length > 0,
        preserveAspectRatio: true,
      }),
    [focusStations, mapData.stations, boundingBox],
  )

  const posById = useMemo(
    () => new Map(layout.stations.map((s) => [s.id, { x: s.x, y: s.y }])),
    [layout.stations],
  )

  const routePolyline = useMemo(() => {
    if (!selected) return ''
    return selected.stationIds
      .map((id) => posById.get(id))
      .filter(Boolean)
      .map((p) => `${p!.x},${p!.y}`)
      .join(' ')
  }, [selected, posById])

  const highlightSet = useMemo(
    () => new Set(selected?.highlightStationIds ?? []),
    [selected],
  )

  return (
    <div className="complex-remedy-map netmap netmap--geo">
      <ZoomableMapViewport
        contentWidth={layout.width}
        contentHeight={layout.height}
        viewBox={layout.viewBox}
      >
        <defs>
          <pattern id="remedyGrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          </pattern>
          <marker id="remedyArrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#34d399" />
          </marker>
        </defs>
        <rect width={layout.width} height={layout.height} fill="url(#remedyGrid)" />

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
              className="complex-remedy-map__edge"
              stroke={edge.lineColor}
            />
          )
        })}

        {selected && routePolyline && (
          <polyline points={routePolyline} className="complex-remedy-map__route" fill="none" />
        )}

        {selected?.segments.map((seg) => {
          const p1 = posById.get(seg.fromId)
          const p2 = posById.get(seg.toId)
          if (!p1 || !p2) return null
          const isProposal = seg.status === 'missing' || seg.transferAfter
          const isSelected = selected.id === selectedId || !selectedId

          return (
            <g key={`${seg.fromId}-${seg.toId}`}>
              {isProposal && (
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  className="complex-remedy-map__proposal-hit"
                  onClick={() => onSelect(selected.id)}
                />
              )}
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                className={`complex-remedy-map__segment ${isProposal ? 'is-missing' : 'is-existing'} ${isSelected ? 'is-active' : ''}`}
                markerEnd={isProposal && isSelected ? 'url(#remedyArrow)' : undefined}
              />
            </g>
          )
        })}

        {layout.stations.map((station) => (
          <RemedyStationDot
            key={station.id}
            station={station}
            highlighted={highlightSet.has(station.id)}
            isTerminal={
              selected != null &&
              (station.id === selected.fromId || station.id === selected.toId)
            }
          />
        ))}

        <CompassRose x={layout.width - 56} y={56} size={48} />
      </ZoomableMapViewport>

      <div className="complex-remedy-map__legend">
        <span className="complex-remedy-map__legend-item">
          <i className="complex-remedy-map__swatch complex-remedy-map__swatch--route" />
          Schnellste Route (Ist)
        </span>
        <span className="complex-remedy-map__legend-item">
          <i className="complex-remedy-map__swatch complex-remedy-map__swatch--existing" />
          Bestehende Teilstrecke
        </span>
        <span className="complex-remedy-map__legend-item">
          <i className="complex-remedy-map__swatch complex-remedy-map__swatch--proposal" />
          Fehlende Teilstrecke (Neubau)
        </span>
      </div>
    </div>
  )
}

function RemedyStationDot({
  station,
  highlighted,
  isTerminal,
}: {
  station: LayoutStation
  highlighted: boolean
  isTerminal: boolean
}) {
  const r = isTerminal ? 9 : highlighted ? 7 : station.interchange ? 6 : 4

  return (
    <g className="complex-remedy-map__station">
      {isTerminal && (
        <circle cx={station.x} cy={station.y} r={r + 5} className="complex-remedy-map__endpoint-ring" />
      )}
      {highlighted && !isTerminal && (
        <circle cx={station.x} cy={station.y} r={r + 3} className="complex-remedy-map__station-ring" />
      )}
      <circle
        cx={station.x}
        cy={station.y}
        r={r}
        className={`complex-remedy-map__station-dot ${isTerminal ? 'is-endpoint' : ''}`}
      />
      {(isTerminal || highlighted) && (
        <text x={station.x} y={station.y - r - 7} className="complex-remedy-map__station-label">
          {station.name}
        </text>
      )}
    </g>
  )
}

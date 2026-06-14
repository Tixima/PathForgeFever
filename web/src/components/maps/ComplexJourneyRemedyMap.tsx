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

  const layout = useMemo(
    () =>
      buildGeographicLayout(mapData.stations, {
        boundingBox,
        fitToPoints: false,
        preserveAspectRatio: true,
      }),
    [mapData.stations, boundingBox],
  )

  const posById = useMemo(
    () => new Map(layout.stations.map((s) => [s.id, { x: s.x, y: s.y }])),
    [layout.stations],
  )

  const routePolyline = useMemo(() => {
    if (!selected) return ''
    return selected.referenceStationIds
      .map((id) => posById.get(id))
      .filter(Boolean)
      .map((p) => `${p!.x},${p!.y}`)
      .join(' ')
  }, [selected, posById])

  const proposalPolyline = useMemo(() => {
    if (!selected) return ''
    return selected.stationIds
      .map((id) => posById.get(id))
      .filter(Boolean)
      .map((p) => `${p!.x},${p!.y}`)
      .join(' ')
  }, [selected, posById])

  const highlightSet = useMemo(() => {
    const ids = new Set(selected?.highlightStationIds ?? [])
    for (const id of selected?.referenceStationIds ?? []) ids.add(id)
    return ids
  }, [selected])

  const transferSet = useMemo(
    () => new Set(selected?.referenceTransferStationIds ?? []),
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
            />
          )
        })}

        {selected && routePolyline && (
          <polyline points={routePolyline} className="complex-remedy-map__route" fill="none" />
        )}

        {selected && proposalPolyline && (
          <polyline points={proposalPolyline} className="complex-remedy-map__proposal-line" fill="none" />
        )}

        {selected?.segments.map((seg) => {
          const p1 = posById.get(seg.fromId)
          const p2 = posById.get(seg.toId)
          if (!p1 || !p2) return null
          const isSelected = selected.id === selectedId || !selectedId

          return (
            <g key={`${seg.fromId}-${seg.toId}`}>
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                className="complex-remedy-map__proposal-hit"
                onClick={() => onSelect(selected.id)}
              />
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                className={`complex-remedy-map__segment is-missing ${isSelected ? 'is-active' : ''}`}
                markerEnd={isSelected ? 'url(#remedyArrow)' : undefined}
              />
            </g>
          )
        })}

        {layout.stations.map((station) => {
          const highlighted = highlightSet.has(station.id)
          const isTransfer = transferSet.has(station.id)
          const isTerminal =
            selected != null &&
            (station.id === selected.fromId || station.id === selected.toId)

          if (!highlighted && !isTerminal) {
            return (
              <circle
                key={station.id}
                cx={station.x}
                cy={station.y}
                r={station.interchange ? 2.5 : 2}
                className="complex-remedy-map__station-dot complex-remedy-map__station-dot--bg"
              />
            )
          }

          return (
            <RemedyStationDot
              key={station.id}
              station={station}
              highlighted={highlighted}
              isTerminal={isTerminal}
              isTransfer={isTransfer}
            />
          )
        })}

        <CompassRose x={layout.width - 56} y={56} size={48} />
      </ZoomableMapViewport>

      <div className="complex-remedy-map__legend">
        <span className="complex-remedy-map__legend-item">
          <i className="complex-remedy-map__swatch complex-remedy-map__swatch--network" />
          Bestehendes Netz
        </span>
        <span className="complex-remedy-map__legend-item">
          <i className="complex-remedy-map__swatch complex-remedy-map__swatch--route" />
          Ist-Route (Umsteiger)
        </span>
        <span className="complex-remedy-map__legend-item">
          <i className="complex-remedy-map__swatch complex-remedy-map__swatch--transfer" />
          Umstieg
        </span>
        <span className="complex-remedy-map__legend-item">
          <i className="complex-remedy-map__swatch complex-remedy-map__swatch--proposal" />
          Neue Linie (Neubau)
        </span>
      </div>
    </div>
  )
}

function RemedyStationDot({
  station,
  highlighted,
  isTerminal,
  isTransfer,
}: {
  station: LayoutStation
  highlighted: boolean
  isTerminal: boolean
  isTransfer?: boolean
}) {
  const r = isTerminal ? 9 : isTransfer ? 8 : highlighted ? 7 : station.interchange ? 6 : 4

  return (
    <g className="complex-remedy-map__station">
      {isTerminal && (
        <circle cx={station.x} cy={station.y} r={r + 5} className="complex-remedy-map__endpoint-ring" />
      )}
      {isTransfer && !isTerminal && (
        <circle cx={station.x} cy={station.y} r={r + 4} className="complex-remedy-map__transfer-ring" />
      )}
      {highlighted && !isTerminal && !isTransfer && (
        <circle cx={station.x} cy={station.y} r={r + 3} className="complex-remedy-map__station-ring" />
      )}
      <circle
        cx={station.x}
        cy={station.y}
        r={r}
        className={`complex-remedy-map__station-dot ${isTerminal ? 'is-endpoint' : ''} ${isTransfer ? 'is-transfer' : ''}`}
      />
      {(isTerminal || isTransfer || highlighted) && (
        <text x={station.x} y={station.y - r - 7} className="complex-remedy-map__station-label">
          {station.name}
        </text>
      )}
      {isTransfer && (
        <text x={station.x} y={station.y + r + 14} className="complex-remedy-map__transfer-label">
          Umstieg
        </text>
      )}
    </g>
  )
}

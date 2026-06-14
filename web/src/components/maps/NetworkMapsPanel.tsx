import { useMemo, useState } from 'react'
import { Flame, GitBranch, Globe, Map as MapIcon, Network } from 'lucide-react'
import { PassengerHeatmapMap } from './PassengerHeatmapMap'
import type { NetworkExport } from '../../types/network'
import type { RouteResult } from '../../lib/routing/types'
import { buildNetworkMapData } from '../../lib/maps/buildNetworkMapData'
import { SchematicNetworkMap } from './SchematicNetworkMap'
import { TopologyGraphMap } from './TopologyGraphMap'
import { GeographicNetworkMap } from './GeographicNetworkMap'
import type { LayoutStation } from '../../lib/maps/types'
import { CollapsibleSection } from '../CollapsibleSection'

type MapMode = 'schematic' | 'topology' | 'geo' | 'heatmap'

interface NetworkMapsPanelProps {
  network: NetworkExport
  selectedRoute?: RouteResult | null
  onStationPick?: (station: LayoutStation) => void
  /** Volle Tab-Ansicht statt eingeklappter Sektion im Routenplaner */
  variant?: 'tab' | 'embedded'
}

function NetworkMapsContent({
  network,
  selectedRoute,
  onStationPick,
  mode,
  setMode,
  mapData,
  highlightStationIds,
  highlightLineIds,
  passengerByLineId,
}: {
  network: NetworkExport
  selectedRoute: RouteResult | null | undefined
  onStationPick?: (station: LayoutStation) => void
  mode: MapMode
  setMode: (mode: MapMode) => void
  mapData: ReturnType<typeof buildNetworkMapData>
  highlightStationIds: number[]
  highlightLineIds: number[]
  passengerByLineId: Map<number, number>
}) {
  const boundingBox = network.network_map?.bounding_box

  return (
    <>
      <div className="netmaps-panel__tabs">
        <button
          type="button"
          className={`netmaps-panel__tab ${mode === 'schematic' ? 'is-active' : ''}`}
          onClick={() => setMode('schematic')}
        >
          <MapIcon size={16} />
          Liniennetzplan
        </button>
        <button
          type="button"
          className={`netmaps-panel__tab ${mode === 'topology' ? 'is-active' : ''}`}
          onClick={() => setMode('topology')}
        >
          <GitBranch size={16} />
          Netzgraph
        </button>
        <button
          type="button"
          className={`netmaps-panel__tab ${mode === 'geo' ? 'is-active' : ''}`}
          onClick={() => setMode('geo')}
        >
          <Globe size={16} />
          Spielkarte
        </button>
        <button
          type="button"
          className={`netmaps-panel__tab ${mode === 'heatmap' ? 'is-active' : ''}`}
          onClick={() => setMode('heatmap')}
        >
          <Flame size={16} />
          Verkehr
        </button>
      </div>

      <div className="netmaps-panel__legend">
        {mapData.lines.map((line) => (
          <span key={line.id} className="netmaps-panel__legend-item">
            <span className="line-dot line-dot--lg" style={{ backgroundColor: line.color }} />
            {line.name}
            <span className="netmaps-panel__legend-count">
              {line.layoutStationIds.length} Stationen
            </span>
          </span>
        ))}
      </div>

      {selectedRoute && (
        <p className="netmaps-panel__route-hint">
          Aktive Route hervorgehoben — {highlightStationIds.length} Stationen, {highlightLineIds.length} Linien
        </p>
      )}

      <p className="netmaps-panel__hint">
        {mode === 'schematic' &&
          'Schematischer Liniennetzplan: horizontale Linien, gemeinsame Spalten an Umsteigern — zoombar.'}
        {mode === 'topology' &&
          'Netzgraph auf TF2-Koordinaten — echte Proportionen, Norden oben, Hub-Knoten hervorgehoben.'}
        {mode === 'geo' && 'Spielkarte: TF2-Koordinaten (X/Y), Norden oben, proportionale Darstellung.'}
        {mode === 'heatmap' && 'Passagier-Heatmap: Linienbreite nach Passagieraufkommen aus dem Export.'}
        {' '}Scrollen zum Zoomen, Ziehen zum Verschieben. Hover für Details.
      </p>

      {mode === 'schematic' && (
        <SchematicNetworkMap
          mapData={mapData}
          highlightStationIds={highlightStationIds}
          highlightLineIds={highlightLineIds}
          onStationClick={onStationPick}
        />
      )}
      {mode === 'topology' && (
        <TopologyGraphMap
          mapData={mapData}
          boundingBox={boundingBox}
          highlightStationIds={highlightStationIds}
          highlightLineIds={highlightLineIds}
          onStationClick={onStationPick}
        />
      )}
      {mode === 'geo' && (
        <GeographicNetworkMap
          mapData={mapData}
          boundingBox={boundingBox}
          highlightStationIds={highlightStationIds}
          highlightLineIds={highlightLineIds}
          onStationClick={onStationPick}
        />
      )}
      {mode === 'heatmap' && (
        <PassengerHeatmapMap
          mapData={mapData}
          passengerByLineId={passengerByLineId}
          onStationClick={onStationPick}
        />
      )}
    </>
  )
}

export function NetworkMapsPanel({
  network,
  selectedRoute = null,
  onStationPick,
  variant = 'tab',
}: NetworkMapsPanelProps) {
  const [mode, setMode] = useState<MapMode>('geo')

  const mapData = useMemo(() => buildNetworkMapData(network), [network])

  const passengerByLineId = useMemo(() => {
    const map = new Map<number, number>()
    for (const line of network.lines) {
      const raw = line as typeof line & { items_transported?: { PASSENGERS?: number; _sum?: number } }
      const pax = raw.items_transported?.PASSENGERS ?? raw.items_transported?._sum ?? 0
      map.set(line.id, typeof pax === 'number' ? pax : 0)
    }
    return map
  }, [network.lines])

  const highlightStationIds = selectedRoute?.stationIds ?? []
  const highlightLineIds = selectedRoute?.legs.map((l) => l.lineId) ?? []

  if (variant === 'embedded') {
    return (
      <CollapsibleSection
        className="netmaps-panel"
        title="Interaktive Netzpläne"
        subtitle="Schematisch, topologisch oder Spielkarte"
        icon={<Network size={20} />}
        badge={`${mapData.lines.length} Linien`}
        defaultOpen={false}
      >
        <NetworkMapsContent
          network={network}
          selectedRoute={selectedRoute}
          onStationPick={onStationPick}
          mode={mode}
          setMode={setMode}
          mapData={mapData}
          highlightStationIds={highlightStationIds}
          highlightLineIds={highlightLineIds}
          passengerByLineId={passengerByLineId}
        />
      </CollapsibleSection>
    )
  }

  return (
    <section className="netmaps-panel netmaps-panel--tab">
      <header className="netmaps-panel__header">
        <div className="netmaps-panel__header-icon">
          <Network size={22} />
        </div>
        <div>
          <h2>Interaktive Netzpläne</h2>
          <p>Schematisch, Netzgraph, Spielkarte & Verkehrs-Heatmap</p>
        </div>
        <span className="netmaps-panel__header-badge">{mapData.lines.length} Linien</span>
      </header>

      <NetworkMapsContent
        network={network}
        selectedRoute={selectedRoute}
        onStationPick={onStationPick}
        mode={mode}
        setMode={setMode}
        mapData={mapData}
        highlightStationIds={highlightStationIds}
        highlightLineIds={highlightLineIds}
        passengerByLineId={passengerByLineId}
      />
    </section>
  )
}

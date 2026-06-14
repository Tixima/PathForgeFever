import type { GeneralMapLayerVisibility } from '../../lib/maps/generalMapOverlay'

interface MapLayerPanelProps {
  layers: GeneralMapLayerVisibility
  onChange: (layers: GeneralMapLayerVisibility) => void
  hasTerrain: boolean
  hasTracks: boolean
  hasLinePaths: boolean
}

export function MapLayerPanel({
  layers,
  onChange,
  hasTerrain,
  hasTracks,
  hasLinePaths,
}: MapLayerPanelProps) {
  const toggle = (key: keyof GeneralMapLayerVisibility) => {
    onChange({ ...layers, [key]: !layers[key] })
  }

  return (
    <div className="map-layer-panel" role="group" aria-label="Karten-Layer">
      <span className="map-layer-panel__title">Layer</span>
      <label className="map-layer-panel__item">
        <input
          type="checkbox"
          checked={layers.terrain}
          disabled={!hasTerrain}
          onChange={() => toggle('terrain')}
        />
        Gelände / Höhen
      </label>
      <label className="map-layer-panel__item">
        <input type="checkbox" checked={layers.grid} onChange={() => toggle('grid')} />
        Raster
      </label>
      <label className="map-layer-panel__item">
        <input
          type="checkbox"
          checked={layers.tracks}
          disabled={!hasTracks}
          onChange={() => toggle('tracks')}
        />
        Gleise
      </label>
      <label className="map-layer-panel__item">
        <input type="checkbox" checked={layers.stations} onChange={() => toggle('stations')} />
        Bahnhöfe
      </label>
      <label className="map-layer-panel__item">
        <input
          type="checkbox"
          checked={layers.lines}
          disabled={!hasLinePaths}
          onChange={() => toggle('lines')}
        />
        Linien (Schienenverlauf)
      </label>
    </div>
  )
}

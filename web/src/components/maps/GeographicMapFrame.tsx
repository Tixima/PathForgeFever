import { useState, type ReactNode } from 'react'
import { Box, Map } from 'lucide-react'
import type { TerrainExport } from '../../types/terrain'
import type { Map3DOverlay } from '../../lib/maps/map3dOverlay'
import type { GeoBounds } from '../../lib/maps/geoProjection'
import { hasTerrainData, terrainStatusLabel } from '../../lib/terrain/terrainAvailability'
import { TerrainMap3D } from './TerrainMap3D'

export type GeoViewMode = '2d' | '3d'

interface GeographicMapFrameProps {
  terrain?: TerrainExport | null
  overlay?: Map3DOverlay
  stationBounds?: GeoBounds
  children: ReactNode
  className?: string
}

export function GeographicMapFrame({
  terrain,
  overlay,
  stationBounds,
  children,
  className = '',
}: GeographicMapFrameProps) {
  const [viewMode, setViewMode] = useState<GeoViewMode>('2d')
  const terrainReady = hasTerrainData(terrain)
  const terrainHint = terrainStatusLabel(terrain)

  return (
    <div className={`geo-map-frame ${className}`}>
      <div className="geo-map-frame__toolbar">
        <div className="geo-map-frame__mode-toggle" role="group" aria-label="Kartenansicht">
          <button
            type="button"
            className={`geo-map-frame__mode-btn ${viewMode === '2d' ? 'is-active' : ''}`}
            onClick={() => setViewMode('2d')}
            title="2D-Satellitenkarte"
          >
            <Map size={15} />
            2D
          </button>
          <button
            type="button"
            className={`geo-map-frame__mode-btn ${viewMode === '3d' ? 'is-active' : ''} ${!terrainReady ? 'is-disabled' : ''}`}
            onClick={() => terrainReady && setViewMode('3d')}
            disabled={!terrainReady}
            title={terrainReady ? '3D-Gelände mit Höhen' : terrainHint ?? 'Kein Gelände im Export'}
          >
            <Box size={15} />
            3D
          </button>
        </div>
        {!terrainReady && terrainHint && (
          <span className="geo-map-frame__terrain-hint">{terrainHint}</span>
        )}
      </div>

      {viewMode === '3d' && terrainReady && terrain ? (
        <TerrainMap3D terrain={terrain} overlay={overlay} stationBounds={stationBounds} />
      ) : viewMode === '3d' ? (
        <div className="geo-map-frame__no-terrain">
          <p>{terrainHint ?? '3D-Ansicht benötigt Gelände-Daten aus Export 1.3+.'}</p>
          <button type="button" className="geo-map-frame__mode-btn is-active" onClick={() => setViewMode('2d')}>
            Zurück zur 2D-Karte
          </button>
        </div>
      ) : (
        children
      )}
    </div>
  )
}

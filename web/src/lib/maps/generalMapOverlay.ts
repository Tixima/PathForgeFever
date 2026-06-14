import type { TerrainExport } from '../../types/terrain'
import type { GeneralMapPolyline } from './buildGeneralMapData'
import type { MapStation } from './types'
import type { GeoBounds } from './geoProjection'
import { terrainCropFromStationBounds } from '../terrain/terrainCrop'
import {
  overlayExtentFromBounds,
  resolveOverlayHeight,
} from '../terrain/buildTerrainScene3d'
import { resolveTerrainVerticalContext } from '../terrain/terrainVertical'
import { resolveStationHeightFor3dMesh } from '../terrain/terrainMeshSampling'
import type { Map3DOverlay, Map3DPolyline, Map3DNode } from './map3dOverlay'

export interface GeneralMapLayerVisibility {
  terrain: boolean
  grid: boolean
  tracks: boolean
  stations: boolean
  lines: boolean
}

export const DEFAULT_GENERAL_MAP_LAYERS: GeneralMapLayerVisibility = {
  terrain: true,
  grid: true,
  tracks: true,
  stations: true,
  lines: true,
}

function resolveVertical(
  terrain: TerrainExport | null | undefined,
  stationBounds?: { minX: number; maxX: number; minY: number; maxY: number },
) {
  if (!terrain) return { exaggeration: 1, baseline: 0, crop: undefined as GeoBounds | undefined }
  const crop =
    stationBounds != null
      ? terrainCropFromStationBounds(stationBounds, terrain.bounds.world)
      : {
          minX: terrain.bounds.world.min_x,
          maxX: terrain.bounds.world.max_x,
          minY: terrain.bounds.world.min_y,
          maxY: terrain.bounds.world.max_y,
        }
  const ctx = resolveTerrainVerticalContext(terrain, crop)
  return { exaggeration: ctx.exaggeration, baseline: ctx.baseline, crop }
}

function heightAt(
  terrain: TerrainExport | null | undefined,
  geoX: number,
  geoY: number,
  z?: number,
  exaggeration = 1,
  extent = 10_000,
  baseline = 0,
  crop?: GeoBounds,
): number {
  const h = resolveStationHeightFor3dMesh(terrain, geoX, geoY, crop, z)
  return resolveOverlayHeight(h, exaggeration, extent, baseline)
}

function polylinesTo3D(
  polylines: GeneralMapPolyline[],
  terrain: TerrainExport | null | undefined,
  exaggeration: number,
  extent: number,
  baseline: number,
  crop?: GeoBounds,
): Map3DPolyline[] {
  return polylines.map((poly) => ({
    points: poly.geoPoints.map((p) => ({
      gameX: p.geoX,
      gameY: p.geoY,
      height: heightAt(terrain, p.geoX, p.geoY, p.z, exaggeration, extent, baseline, crop),
    })),
    color: poly.color,
    opacity: poly.opacity,
    width: poly.width,
    dashed: poly.dashed,
  }))
}

export function buildGeneralMapOverlay(
  stations: MapStation[],
  trackPolylines: GeneralMapPolyline[],
  linePolylines: GeneralMapPolyline[],
  terrain?: TerrainExport | null,
  layers: GeneralMapLayerVisibility = DEFAULT_GENERAL_MAP_LAYERS,
  options?: {
    highlightStationIds?: number[]
    highlightLineIds?: number[]
    stationBounds?: { minX: number; maxX: number; minY: number; maxY: number }
  },
): Map3DOverlay {
  const { exaggeration, baseline, crop } = resolveVertical(terrain, options?.stationBounds)
  const extent = overlayExtentFromBounds(options?.stationBounds)
  const highlightStations = new Set(options?.highlightStationIds ?? [])
  const highlightLines = new Set(options?.highlightLineIds ?? [])

  const polylines: Map3DPolyline[] = []
  if (layers.tracks && trackPolylines.length > 0) {
    polylines.push(...polylinesTo3D(trackPolylines, terrain, exaggeration, extent, baseline, crop))
  }
  if (layers.lines && linePolylines.length > 0) {
    const filtered = linePolylines.map((p) => {
      const active = p.lineId != null && highlightLines.has(p.lineId)
      return {
        ...p,
        opacity: highlightLines.size > 0 && !active ? p.opacity * 0.35 : p.opacity,
        width: active ? p.width + 1 : p.width,
      }
    })
    polylines.push(...polylinesTo3D(filtered, terrain, exaggeration, extent, baseline, crop))
  }

  const nodes: Map3DNode[] = layers.stations
    ? stations.map((s) => {
        const highlighted = highlightStations.has(s.id)
        const isHub = s.interchange || s.lineIds.length > 1
        return {
          gameX: s.geoX,
          gameY: s.geoY,
          height: heightAt(terrain, s.geoX, s.geoY, undefined, exaggeration, extent, baseline, crop),
          color: highlighted ? '#ffffff' : isHub ? '#fbbf24' : '#f1f5f9',
          radius: highlighted ? 18 : isHub ? 14 : 8,
          label: highlighted ? s.name : undefined,
          ring: highlighted || isHub,
          kind: isHub ? 'hub' : 'stop',
        }
      })
    : []

  return { polylines, nodes }
}

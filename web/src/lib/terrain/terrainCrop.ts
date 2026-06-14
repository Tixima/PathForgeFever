import type { GeoBounds } from '../maps/geoProjection'

const DEFAULT_MARGIN_RATIO = 0.06

export function expandGeoBounds(bounds: GeoBounds, marginRatio = DEFAULT_MARGIN_RATIO): GeoBounds {
  const w = bounds.maxX - bounds.minX || 1
  const h = bounds.maxY - bounds.minY || 1
  const mx = w * marginRatio
  const my = h * marginRatio
  return {
    minX: bounds.minX - mx,
    maxX: bounds.maxX + mx,
    minY: bounds.minY - my,
    maxY: bounds.maxY + my,
  }
}

export function clampGeoBoundsToTerrain(
  bounds: GeoBounds,
  terrainWorld: { min_x: number; max_x: number; min_y: number; max_y: number },
): GeoBounds {
  return {
    minX: Math.max(bounds.minX, terrainWorld.min_x),
    maxX: Math.min(bounds.maxX, terrainWorld.max_x),
    minY: Math.max(bounds.minY, terrainWorld.min_y),
    maxY: Math.min(bounds.maxY, terrainWorld.max_y),
  }
}

/** Bahnhof-Koordinaten als Referenz — Terrain wird auf diesen Ausschnitt zugeschnitten. */
export function terrainCropFromStationBounds(
  stationBounds: GeoBounds,
  terrainWorld: { min_x: number; max_x: number; min_y: number; max_y: number },
  marginRatio = DEFAULT_MARGIN_RATIO,
): GeoBounds {
  return clampGeoBoundsToTerrain(expandGeoBounds(stationBounds, marginRatio), terrainWorld)
}

export function geoBoundsFromPoints(
  points: Array<{ geoX: number; geoY: number }>,
  fallback?: GeoBounds,
): GeoBounds {
  if (points.length === 0 && fallback) return fallback
  if (points.length === 0) {
    return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  }
  const xs = points.map((p) => p.geoX)
  const ys = points.map((p) => p.geoY)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

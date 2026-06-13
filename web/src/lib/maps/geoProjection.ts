import type { NetworkMapMeta } from '../../types/network'

/** TF2-Spielebene: X = Ost/West, Y = Nord/Süd (Export bounding_box min_y/max_y) */
export type GamePosition = [number, number, number]

export const GEO_VIEW_W = 920
export const GEO_VIEW_H = 520
export const GEO_PAD = 48
export const GEO_MAX_CANVAS_H = 1400

export interface GeoBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface GeoProjectionOptions {
  width?: number
  height?: number
  maxHeight?: number
  padding?: number
  boundingBox?: NetworkMapMeta['bounding_box']
  /** Route-/Auswahl-Zoom statt globaler Netzwerk-Box */
  fitToPoints?: boolean
  /** Gleiche Skalierung auf X und Y — echte Proportionen (Standard) */
  preserveAspectRatio?: boolean
  /** Höheres Spiel-Y = Norden = Kartenoben (Standard) */
  northUp?: boolean
}

export function gameX(pos: GamePosition): number {
  return pos[0]
}

export function gameY(pos: GamePosition): number {
  return pos[1]
}

export function boundsFromBoundingBox(
  bb: NetworkMapMeta['bounding_box'],
): GeoBounds | null {
  if (!bb) return null
  return {
    minX: bb.min_x,
    maxX: bb.max_x,
    minY: bb.min_y,
    maxY: bb.max_y,
  }
}

export function boundsFromPoints(
  points: Array<{ geoX: number; geoY: number }>,
): GeoBounds {
  const xs = points.map((p) => p.geoX)
  const ys = points.map((p) => p.geoY)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

export function expandBounds(bounds: GeoBounds, marginRatio = 0.06): GeoBounds {
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

export function resolveGeoBounds(
  points: Array<{ geoX: number; geoY: number }>,
  options: GeoProjectionOptions = {},
): GeoBounds {
  if (options.fitToPoints && points.length > 0) {
    return expandBounds(boundsFromPoints(points))
  }

  const global = boundsFromBoundingBox(options.boundingBox)
  if (global) return global
  if (points.length === 0) {
    return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  }
  return expandBounds(boundsFromPoints(points))
}

/** Canvas-Größe passend zur Bounds — vermeidet vertikale Kompression bei festem 920×520. */
export function computeGeoCanvasSize(
  bounds: GeoBounds,
  options: { maxWidth?: number; maxHeight?: number; padding?: number } = {},
): { width: number; height: number } {
  const padding = options.padding ?? GEO_PAD
  const maxWidth = options.maxWidth ?? GEO_VIEW_W
  const maxHeight = options.maxHeight ?? GEO_MAX_CANVAS_H
  const w = bounds.maxX - bounds.minX || 1
  const h = bounds.maxY - bounds.minY || 1
  const aspect = h / w

  let innerW = maxWidth - padding * 2
  let innerH = innerW * aspect

  if (innerH + padding * 2 > maxHeight) {
    innerH = maxHeight - padding * 2
    innerW = innerH / aspect
  }

  return {
    width: Math.round(innerW + padding * 2),
    height: Math.round(innerH + padding * 2),
  }
}

export function projectGeoPoint(
  geoX: number,
  geoY: number,
  bounds: GeoBounds,
  options: GeoProjectionOptions = {},
): { x: number; y: number } {
  const width = options.width ?? GEO_VIEW_W
  const height = options.height ?? GEO_VIEW_H
  const padding = options.padding ?? GEO_PAD
  const northUp = options.northUp !== false
  const preserveAspectRatio = options.preserveAspectRatio !== false

  const w = bounds.maxX - bounds.minX || 1
  const h = bounds.maxY - bounds.minY || 1
  const innerW = width - padding * 2
  const innerH = height - padding * 2

  if (preserveAspectRatio) {
    const scale = Math.min(innerW / w, innerH / h)
    const drawnW = w * scale
    const drawnH = h * scale
    const offsetX = padding + (innerW - drawnW) / 2
    const offsetY = padding + (innerH - drawnH) / 2
    const yGame = northUp ? bounds.maxY - geoY : geoY - bounds.minY

    return {
      x: offsetX + (geoX - bounds.minX) * scale,
      y: offsetY + yGame * scale,
    }
  }

  const x = padding + ((geoX - bounds.minX) / w) * innerW
  const t = northUp ? (bounds.maxY - geoY) / h : (geoY - bounds.minY) / h
  const y = padding + t * innerH

  return { x, y }
}

export function buildGeoViewBox(
  width = GEO_VIEW_W,
  height = GEO_VIEW_H,
): string {
  return `0 0 ${width} ${height}`
}

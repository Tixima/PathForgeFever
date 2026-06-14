import type { TerrainExport } from '../../types/terrain'
import type { GeoBounds } from '../maps/geoProjection'
import { resolveTerrainCropContext } from './buildTerrainRaster'

export interface TerrainVerticalContext {
  exaggeration: number
  baseline: number
  heightSpan: number
}

/** Min/Max-Höhe im Karten-Ausschnitt (dekümiert wie Raster). */
export function sampleCropHeightRange(
  terrain: TerrainExport,
  cropBounds?: GeoBounds,
): { min: number; max: number; span: number } {
  const ctx = resolveTerrainCropContext(terrain, cropBounds)
  let min = Infinity
  let max = -Infinity

  for (let row = ctx.startRow; row <= ctx.endRow; row += ctx.rowStep) {
    for (let col = ctx.startCol; col <= ctx.endCol; col += ctx.colStep) {
      const h = terrain.height_rows[row]?.[col]
      if (h !== false && h != null) {
        min = Math.min(min, h)
        max = Math.max(max, h)
      }
    }
  }

  if (min === Infinity) {
    const stats = terrain.statistics
    min = stats?.min_height ?? 0
    max = stats?.max_height ?? min + 200
  }

  return { min, max, span: Math.max(max - min, 1) }
}

/**
 * 3D-Überhöhung: sichtbares Relief (~7–9 % der Kartenbreite),
 * deutlich plastisch aber ohne Nadelform (Cap verhindert Extreme).
 */
export function computeVerticalExaggeration3D(
  terrain: TerrainExport,
  cropBounds?: GeoBounds,
): number {
  const ctx = resolveTerrainCropContext(terrain, cropBounds)
  const horizontalSpan = Math.max(
    ctx.crop.maxX - ctx.crop.minX,
    ctx.crop.maxY - ctx.crop.minY,
    1000,
  )
  const { span: heightSpan } = sampleCropHeightRange(terrain, cropBounds)
  const targetReliefRatio = 0.078
  const targetRelief = horizontalSpan * targetReliefRatio
  return Math.min(5.0, Math.max(1.2, targetRelief / Math.max(heightSpan, 25)))
}

export function resolveTerrainVerticalContext(
  terrain: TerrainExport,
  cropBounds?: GeoBounds,
): TerrainVerticalContext {
  const { min, span } = sampleCropHeightRange(terrain, cropBounds)
  return {
    baseline: min,
    heightSpan: span,
    exaggeration: computeVerticalExaggeration3D(terrain, cropBounds),
  }
}

export function terrainHeightToSceneElevation(
  rawHeight: number,
  baseline: number,
  exaggeration: number,
): number {
  return (rawHeight - baseline) * exaggeration
}

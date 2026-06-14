import type { TerrainExport } from '../../types/terrain'
import type { GeoBounds } from '../maps/geoProjection'
import { resolveTerrainCropContext } from './buildTerrainRaster'
import { gridCellFromMeshPxPy } from './terrainSceneCoords'
import { sampleTerrainHeight } from './terrainSampling'

/** Höhe wie auf dem 3D-Mesh (180°-gedrehte Höhen-Maske). */
export function resolveMeshTerrainHeight(
  terrain: TerrainExport,
  gameX: number,
  gameY: number,
  crop: GeoBounds,
): number | null {
  const ctx = resolveTerrainCropContext(terrain, crop)
  const cropW = ctx.crop.maxX - ctx.crop.minX
  const cropH = ctx.crop.maxY - ctx.crop.minY
  if (cropW <= 0 || cropH <= 0) return null

  const relX = (gameX - ctx.crop.minX) / cropW
  const relY = (ctx.crop.maxY - gameY) / cropH
  const px = Math.min(
    ctx.pixelWidth - 1,
    Math.max(0, Math.round(relX * (ctx.pixelWidth - 1))),
  )
  const py = Math.min(
    ctx.pixelHeight - 1,
    Math.max(0, Math.round(relY * (ctx.pixelHeight - 1))),
  )

  const { srcRow, srcCol } = gridCellFromMeshPxPy(
    px,
    py,
    ctx.pixelWidth,
    ctx.pixelHeight,
    ctx.rowStep,
    ctx.colStep,
    ctx.startRow,
    ctx.endRow,
    ctx.startCol,
    ctx.endCol,
  )
  const h = terrain.height_rows[srcRow]?.[srcCol]
  return h === false || h == null ? null : h
}

export function resolveStationHeightFor3dMesh(
  terrain: TerrainExport | null | undefined,
  gameX: number,
  gameY: number,
  crop?: GeoBounds,
  positionZ?: number,
): number {
  if (positionZ != null && Number.isFinite(positionZ)) return positionZ
  if (terrain && crop) {
    const meshH = resolveMeshTerrainHeight(terrain, gameX, gameY, crop)
    if (meshH != null) return meshH
  }
  if (terrain) {
    const sampled = sampleTerrainHeight(terrain, gameX, gameY)
    if (sampled != null) return sampled
  }
  return 0
}

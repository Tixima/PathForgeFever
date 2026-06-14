import type { GeoBounds } from '../maps/geoProjection'

/** WebGL-Textur: horizontale Spiegelung für Übereinstimmung mit 2D-Raster. */
export const TERRAIN_TEXTURE_UV_FLIP_U = true

/**
 * Höhen-Maske 180° gegen Textur/Overlay — TF2-Export vs. Mesh-Raster.
 * Position + UV bleiben geografisch korrekt; nur die Höhenwerte werden gedreht.
 */
export function heightSampleGridPxPy(
  px: number,
  py: number,
  gridCols: number,
  gridRows: number,
): { px: number; py: number } {
  return {
    px: gridCols - 1 - px,
    py: gridRows - 1 - py,
  }
}

export function gridCellFromMeshPxPy(
  px: number,
  py: number,
  gridCols: number,
  gridRows: number,
  rowStep: number,
  colStep: number,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
): { srcRow: number; srcCol: number } {
  const { px: sPx, py: sPy } = heightSampleGridPxPy(px, py, gridCols, gridRows)
  const rowOffset = (gridRows - 1 - sPy) * rowStep
  const srcRow = Math.min(startRow + rowOffset, endRow)
  const srcCol = Math.min(startCol + sPx * colStep, endCol)
  return { srcRow, srcCol }
}

/**
 * 3D-Layout wie 2D projectGeoPoint (northUp):
 * X = Ost (0 am westlichen Crop-Rand), Z = Süden (0 am nördlichen Crop-Rand), Y = Höhe.
 */
export function gameToTerrainScene(
  gameX: number,
  gameY: number,
  height: number,
  crop: GeoBounds,
): [number, number, number] {
  return [gameX - crop.minX, height, crop.maxY - gameY]
}

/** UVs für Three.js-Textur aus Canvas-Raster (py=0 Nord). */
export function terrainRasterUv(
  px: number,
  py: number,
  gridCols: number,
  gridRows: number,
): [number, number] {
  let u = gridCols > 1 ? px / (gridCols - 1) : 0
  const v = gridRows > 1 ? py / (gridRows - 1) : 0
  if (TERRAIN_TEXTURE_UV_FLIP_U) u = 1 - u
  return [u, v]
}

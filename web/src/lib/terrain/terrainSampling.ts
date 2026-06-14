import type { TerrainExport, TerrainSlopeCode, TerrainSurfaceCode } from '../../types/terrain'

export function terrainCellAt(
  terrain: TerrainExport,
  row: number,
  col: number,
): {
  height: number | false
  surface: TerrainSurfaceCode
  slope: TerrainSlopeCode
} {
  const height = terrain.height_rows[row]?.[col] ?? false
  const surface = (terrain.surface_rows[row]?.[col] ?? 'N') as TerrainSurfaceCode
  const slope = (terrain.slope_class_rows?.[row]?.[col] ?? 'N') as TerrainSlopeCode
  return { height, surface, slope }
}

export function gameToTerrainIndex(
  terrain: TerrainExport,
  gameX: number,
  gameY: number,
): { row: number; col: number } | null {
  const { min_x, min_y } = terrain.bounds.world
  const res = terrain.resolution_m
  const col = Math.floor((gameX - min_x) / res)
  const row = Math.floor((gameY - min_y) / res)
  if (row < 0 || col < 0 || row >= terrain.rows || col >= terrain.columns) return null
  return { row, col }
}

export function sampleTerrainHeight(terrain: TerrainExport, gameX: number, gameY: number): number | null {
  const idx = gameToTerrainIndex(terrain, gameX, gameY)
  if (!idx) return null
  const h = terrain.height_rows[idx.row]?.[idx.col]
  return h === false ? null : h
}

export function resolveStationHeight(
  terrain: TerrainExport | null | undefined,
  gameX: number,
  gameY: number,
  positionZ?: number,
): number {
  if (positionZ != null && Number.isFinite(positionZ)) return positionZ
  if (terrain) {
    const sampled = sampleTerrainHeight(terrain, gameX, gameY)
    if (sampled != null) return sampled
  }
  return 0
}

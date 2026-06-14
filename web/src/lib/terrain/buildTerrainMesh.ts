import type { TerrainExport } from '../../types/terrain'
import type { GeoBounds } from '../maps/geoProjection'
import { terrainCellColor } from './terrainPalette'
import { computeHillshadeFromHeights } from './terrainPalette'
import { terrainCellAt } from './terrainSampling'
import { gameToScene3d } from './gameCoordinates3d'
import { terrainCropFromStationBounds } from './terrainCrop'

const MAX_GRID_SEGMENTS = 360

export interface TerrainMeshData {
  positions: Float32Array
  colors: Float32Array
  indices: Uint32Array
  center: [number, number, number]
  extent: number
  verticalExaggeration: number
  decimationStep: number
}

function resolveHeight(
  terrain: TerrainExport,
  row: number,
  col: number,
  cache: Map<string, number | null>,
): number | null {
  const key = `${row},${col}`
  if (cache.has(key)) return cache.get(key)!

  const raw = terrain.height_rows[row]?.[col]
  if (raw !== false && raw != null) {
    cache.set(key, raw)
    return raw
  }

  let sum = 0
  let count = 0
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      const r = row + dr
      const c = col + dc
      if (r < 0 || c < 0 || r >= terrain.rows || c >= terrain.columns) continue
      const h = terrain.height_rows[r]?.[c]
      if (h !== false && h != null) {
        sum += h
        count++
      }
    }
  }

  const value = count > 0 ? sum / count : null
  cache.set(key, value)
  return value
}

export function computeVerticalExaggeration(
  terrain: TerrainExport,
  cropBounds?: GeoBounds,
): number {
  const stats = terrain.statistics
  let spanX = terrain.bounds.world.max_x - terrain.bounds.world.min_x
  let spanY = terrain.bounds.world.max_y - terrain.bounds.world.min_y
  if (cropBounds) {
    spanX = cropBounds.maxX - cropBounds.minX
    spanY = cropBounds.maxY - cropBounds.minY
  }
  const horizontalSpan = Math.max(spanX, spanY)
  const heightSpan =
    stats?.max_height != null && stats?.min_height != null
      ? stats.max_height - stats.min_height
      : 200
  const ratio = horizontalSpan / Math.max(heightSpan, 1)
  return Math.min(2.8, Math.max(1.0, ratio / 280))
}

export function buildTerrainMeshData(
  terrain: TerrainExport,
  stationBounds?: GeoBounds,
): TerrainMeshData {
  const crop =
    stationBounds != null
      ? terrainCropFromStationBounds(stationBounds, terrain.bounds.world, 0.08)
      : {
          minX: terrain.bounds.world.min_x,
          maxX: terrain.bounds.world.max_x,
          minY: terrain.bounds.world.min_y,
          maxY: terrain.bounds.world.max_y,
        }

  const world = terrain.bounds.world
  const { min_x, min_y } = world
  const res = terrain.resolution_m

  const startCol = Math.max(0, Math.floor((crop.minX - min_x) / res))
  const endCol = Math.min(terrain.columns - 1, Math.ceil((crop.maxX - min_x) / res))
  const startRow = Math.max(0, Math.floor((crop.minY - min_y) / res))
  const endRow = Math.min(terrain.rows - 1, Math.ceil((crop.maxY - min_y) / res))

  const sourceCols = endCol - startCol + 1
  const sourceRows = endRow - startRow + 1
  const rowStep = Math.max(1, Math.ceil(sourceRows / MAX_GRID_SEGMENTS))
  const colStep = Math.max(1, Math.ceil(sourceCols / MAX_GRID_SEGMENTS))

  const gridRows = Math.floor((sourceRows - 1) / rowStep) + 1
  const gridCols = Math.floor((sourceCols - 1) / colStep) + 1
  const vertCount = gridRows * gridCols

  const positions = new Float32Array(vertCount * 3)
  const colors = new Float32Array(vertCount * 3)
  const validMask = new Uint8Array(vertCount)
  const heightCache = new Map<string, number | null>()

  const exaggeration = computeVerticalExaggeration(terrain, crop)
  let minSceneX = Infinity
  let maxSceneX = -Infinity
  let minSceneY = Infinity
  let maxSceneY = -Infinity
  let minSceneZ = Infinity
  let maxSceneZ = -Infinity

  const sampleHeight = (row: number, col: number): number | false => {
    const h = resolveHeight(terrain, row, col, heightCache)
    return h == null ? false : h
  }

  for (let gr = 0; gr < gridRows; gr++) {
    const srcRow = Math.min(startRow + gr * rowStep, endRow)
    const gameY = min_y + srcRow * res
    for (let gc = 0; gc < gridCols; gc++) {
      const srcCol = Math.min(startCol + gc * colStep, endCol)
      const gameX = min_x + srcCol * res
      const cell = terrainCellAt(terrain, srcRow, srcCol)
      const resolved = resolveHeight(terrain, srcRow, srcCol, heightCache)
      const vi = gr * gridCols + gc

      if (resolved == null) {
        positions[vi * 3] = 0
        positions[vi * 3 + 1] = 0
        positions[vi * 3 + 2] = 0
        colors[vi * 3] = 0.2
        colors[vi * 3 + 1] = 0.35
        colors[vi * 3 + 2] = 0.22
        validMask[vi] = 0
        continue
      }

      const sceneHeight = resolved * exaggeration
      const [sx, sy, sz] = gameToScene3d(gameX, gameY, sceneHeight)
      positions[vi * 3] = sx
      positions[vi * 3 + 1] = sy
      positions[vi * 3 + 2] = sz
      validMask[vi] = 1

      const hillshade = computeHillshadeFromHeights(
        sampleHeight(srcRow, srcCol - colStep),
        sampleHeight(srcRow, srcCol + colStep),
        sampleHeight(srcRow - rowStep, srcCol),
        sampleHeight(srcRow + rowStep, srcCol),
      )
      const [r, g, b] = terrainCellColor(cell.surface, cell.slope, hillshade, resolved)
      colors[vi * 3] = r
      colors[vi * 3 + 1] = g
      colors[vi * 3 + 2] = b

      minSceneX = Math.min(minSceneX, sx)
      maxSceneX = Math.max(maxSceneX, sx)
      minSceneY = Math.min(minSceneY, sy)
      maxSceneY = Math.max(maxSceneY, sy)
      minSceneZ = Math.min(minSceneZ, sz)
      maxSceneZ = Math.max(maxSceneZ, sz)
    }
  }

  const indexList: number[] = []
  for (let gr = 0; gr < gridRows - 1; gr++) {
    for (let gc = 0; gc < gridCols - 1; gc++) {
      const a = gr * gridCols + gc
      const b = a + 1
      const c = a + gridCols
      const d = c + 1
      if (validMask[a] && validMask[b] && validMask[c]) {
        indexList.push(a, c, b)
      }
      if (validMask[b] && validMask[c] && validMask[d]) {
        indexList.push(b, c, d)
      }
    }
  }

  const indices = new Uint32Array(indexList)

  const centerX = (minSceneX + maxSceneX) / 2
  const centerY = (minSceneY + maxSceneY) / 2
  const centerZ = (minSceneZ + maxSceneZ) / 2
  const extent = Math.max(maxSceneX - minSceneX, maxSceneZ - minSceneZ, maxSceneY - minSceneY, 1)

  return {
    positions,
    colors,
    indices,
    center: [centerX, centerY, centerZ],
    extent,
    verticalExaggeration: exaggeration,
    decimationStep: Math.max(rowStep, colStep),
  }
}

export function exaggerateHeight(terrain: TerrainExport, rawHeight: number): number {
  return rawHeight * computeVerticalExaggeration(terrain)
}

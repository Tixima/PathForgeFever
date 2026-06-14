import type { TerrainExport } from '../../types/terrain'
import type { GeoBounds } from '../maps/geoProjection'
import {
  gameToTerrainScene,
  gridCellFromMeshPxPy,
  terrainRasterUv,
} from './terrainSceneCoords'
import {
  buildTerrainRasterImage,
  resolveTerrainCropContext,
  terrainCropForStations,
} from './buildTerrainRaster'
import {
  resolveTerrainVerticalContext,
  terrainHeightToSceneElevation,
} from './terrainVertical'

export { computeVerticalExaggeration3D } from './terrainVertical'

export interface TerrainScene3DData {
  positions: Float32Array
  uvs: Float32Array
  indices: Uint32Array
  textureUrl: string
  center: [number, number, number]
  extent: number
  horizontalExtent: number
  verticalExaggeration: number
  crop: GeoBounds
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

function smoothHeightGrid(
  heights: Float32Array,
  valid: Uint8Array,
  cols: number,
  rows: number,
  passes = 2,
): void {
  const temp = new Float32Array(heights.length)
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x
        if (!valid[i]) continue
        let sum = 0
        let count = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
            const ni = ny * cols + nx
            if (!valid[ni]) continue
            sum += heights[ni]
            count++
          }
        }
        temp[i] = count > 0 ? sum / count : heights[i]
      }
    }
    for (let i = 0; i < heights.length; i++) {
      if (valid[i]) heights[i] = temp[i]
    }
  }
}

/** Gleiche Satelliten-Farben wie 2D (Texture) + echte Höhen für 3D. */
export function buildTerrainScene3DData(
  terrain: TerrainExport,
  stationBounds?: GeoBounds,
): TerrainScene3DData {
  const cropBounds = terrainCropForStations(terrain, stationBounds)
  const raster = buildTerrainRasterImage(terrain, cropBounds)
  const ctx = resolveTerrainCropContext(terrain, cropBounds)
  const vertical = resolveTerrainVerticalContext(terrain, ctx.crop)
  const { exaggeration, baseline } = vertical

  const gridCols = ctx.pixelWidth
  const gridRows = ctx.pixelHeight
  const vertCount = gridCols * gridRows
  const positions = new Float32Array(vertCount * 3)
  const uvs = new Float32Array(vertCount * 2)
  const validMask = new Uint8Array(vertCount)
  const heightGrid = new Float32Array(vertCount)
  const heightCache = new Map<string, number | null>()

  const { min_x, min_y } = terrain.bounds.world
  const res = terrain.resolution_m

  let minSceneX = Infinity
  let maxSceneX = -Infinity
  let minSceneY = Infinity
  let maxSceneY = -Infinity
  let minSceneZ = Infinity
  let maxSceneZ = -Infinity

  // Höhen 180° gedreht; Position/UV bleiben geografisch (wie 2D + Overlay).
  for (let py = 0; py < gridRows; py++) {
    for (let px = 0; px < gridCols; px++) {
      const vi = py * gridCols + px
      const { srcRow, srcCol } = gridCellFromMeshPxPy(
        px,
        py,
        gridCols,
        gridRows,
        ctx.rowStep,
        ctx.colStep,
        ctx.startRow,
        ctx.endRow,
        ctx.startCol,
        ctx.endCol,
      )
      const resolved = resolveHeight(terrain, srcRow, srcCol, heightCache)
      if (resolved == null) {
        validMask[vi] = 0
      } else {
        heightGrid[vi] = resolved
        validMask[vi] = 1
      }
    }
  }

  smoothHeightGrid(heightGrid, validMask, gridCols, gridRows)

  for (let py = 0; py < gridRows; py++) {
    const rowOffset = (gridRows - 1 - py) * ctx.rowStep
    const srcRow = Math.min(ctx.startRow + rowOffset, ctx.endRow)
    const gameY = min_y + srcRow * res

    for (let px = 0; px < gridCols; px++) {
      const srcCol = Math.min(ctx.startCol + px * ctx.colStep, ctx.endCol)
      const gameX = min_x + srcCol * res
      const vi = py * gridCols + px

      if (!validMask[vi]) {
        positions[vi * 3] = 0
        positions[vi * 3 + 1] = 0
        positions[vi * 3 + 2] = 0
      } else {
        const sceneHeight = terrainHeightToSceneElevation(heightGrid[vi], baseline, exaggeration)
        const [sx, sy, sz] = gameToTerrainScene(gameX, gameY, sceneHeight, ctx.crop)
        positions[vi * 3] = sx
        positions[vi * 3 + 1] = sy
        positions[vi * 3 + 2] = sz

        minSceneX = Math.min(minSceneX, sx)
        maxSceneX = Math.max(maxSceneX, sx)
        minSceneY = Math.min(minSceneY, sy)
        maxSceneY = Math.max(maxSceneY, sy)
        minSceneZ = Math.min(minSceneZ, sz)
        maxSceneZ = Math.max(maxSceneZ, sz)
      }

      const [u, v] = terrainRasterUv(px, py, gridCols, gridRows)
      uvs[vi * 2] = u
      uvs[vi * 2 + 1] = v
    }
  }

  const indexList: number[] = []
  for (let py = 0; py < gridRows - 1; py++) {
    for (let px = 0; px < gridCols - 1; px++) {
      const a = py * gridCols + px
      const b = a + 1
      const c = a + gridCols
      const d = c + 1
      if (validMask[a] && validMask[b] && validMask[c]) indexList.push(a, c, b)
      if (validMask[b] && validMask[c] && validMask[d]) indexList.push(b, c, d)
    }
  }

  const centerX = (minSceneX + maxSceneX) / 2
  const centerY = (minSceneY + maxSceneY) / 2
  const centerZ = (minSceneZ + maxSceneZ) / 2
  const horizontalExtent = Math.max(maxSceneX - minSceneX, maxSceneZ - minSceneZ, 1)
  const extent = Math.max(horizontalExtent, maxSceneY - minSceneY, 1)

  return {
    positions,
    uvs,
    indices: new Uint32Array(indexList),
    textureUrl: raster.dataUrl,
    center: [centerX, centerY, centerZ],
    extent,
    horizontalExtent,
    verticalExaggeration: exaggeration,
    crop: ctx.crop,
  }
}

export function overlayExtentFromBounds(bounds?: GeoBounds): number {
  if (!bounds) return 10_000
  return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1000)
}

export function heightLiftForOverlay(extent: number): number {
  return extent * 0.008
}

export function resolveOverlayHeight(
  rawHeight: number,
  exaggeration: number,
  extent: number,
  baseline = 0,
): number {
  return terrainHeightToSceneElevation(rawHeight, baseline, exaggeration) + heightLiftForOverlay(extent)
}

export function overlayNodeRadius(extent: number, kind?: string): number {
  if (kind === 'start' || kind === 'end') return extent * 0.014
  if (kind === 'transfer') return extent * 0.012
  if (kind === 'hub') return extent * 0.011
  if (kind === 'via') return extent * 0.01
  return extent * 0.008
}

export function overlayLineRadius(extent: number, widthScale = 1): number {
  return extent * 0.0035 * widthScale
}

import type { TerrainExport } from '../../types/terrain'
import type { GeoBounds } from '../maps/geoProjection'
import { terrainCellColorBytes, computeHillshadeFromHeights } from './terrainPalette'
import { terrainCellAt } from './terrainSampling'
import { terrainCropFromStationBounds } from './terrainCrop'

const MAX_RASTER_DIM = 720

export interface TerrainRasterImage {
  dataUrl: string
  pixelWidth: number
  pixelHeight: number
  worldMinX: number
  worldMinY: number
  worldMaxX: number
  worldMaxY: number
  startCol: number
  endCol: number
  startRow: number
  endRow: number
  colStep: number
  rowStep: number
}

export interface TerrainCropContext {
  crop: GeoBounds
  startCol: number
  endCol: number
  startRow: number
  endRow: number
  colStep: number
  rowStep: number
  pixelWidth: number
  pixelHeight: number
}

export function resolveTerrainCropContext(
  terrain: TerrainExport,
  cropBounds?: GeoBounds,
): TerrainCropContext {
  const world = terrain.bounds.world
  const cropMinX = cropBounds ? Math.max(world.min_x, cropBounds.minX) : world.min_x
  const cropMaxX = cropBounds ? Math.min(world.max_x, cropBounds.maxX) : world.max_x
  const cropMinY = cropBounds ? Math.max(world.min_y, cropBounds.minY) : world.min_y
  const cropMaxY = cropBounds ? Math.min(world.max_y, cropBounds.maxY) : world.max_y

  const res = terrain.resolution_m
  const startCol = Math.max(0, Math.floor((cropMinX - world.min_x) / res))
  const endCol = Math.min(terrain.columns - 1, Math.ceil((cropMaxX - world.min_x) / res))
  const startRow = Math.max(0, Math.floor((cropMinY - world.min_y) / res))
  const endRow = Math.min(terrain.rows - 1, Math.ceil((cropMaxY - world.min_y) / res))

  const sourceCols = endCol - startCol + 1
  const sourceRows = endRow - startRow + 1
  const colStep = Math.max(1, Math.ceil(sourceCols / MAX_RASTER_DIM))
  const rowStep = Math.max(1, Math.ceil(sourceRows / MAX_RASTER_DIM))

  const pixelWidth = Math.floor((sourceCols - 1) / colStep) + 1
  const pixelHeight = Math.floor((sourceRows - 1) / rowStep) + 1

  return {
    crop: { minX: cropMinX, maxX: cropMaxX, minY: cropMinY, maxY: cropMaxY },
    startCol,
    endCol,
    startRow,
    endRow,
    colStep,
    rowStep,
    pixelWidth,
    pixelHeight,
  }
}

function sampleHeightAt(
  terrain: TerrainExport,
  row: number,
  col: number,
): number | false {
  const r = Math.min(Math.max(row, 0), terrain.rows - 1)
  const c = Math.min(Math.max(col, 0), terrain.columns - 1)
  const h = terrain.height_rows[r]?.[c]
  return h === false ? false : h
}

export function buildTerrainRasterImage(
  terrain: TerrainExport,
  cropBounds?: GeoBounds,
): TerrainRasterImage {
  const ctx = resolveTerrainCropContext(terrain, cropBounds)
  const world = terrain.bounds.world

  const canvas = document.createElement('canvas')
  canvas.width = ctx.pixelWidth
  canvas.height = ctx.pixelHeight
  const canvasCtx = canvas.getContext('2d')
  if (!canvasCtx) {
    return {
      dataUrl: '',
      pixelWidth: ctx.pixelWidth,
      pixelHeight: ctx.pixelHeight,
      worldMinX: ctx.crop.minX,
      worldMinY: ctx.crop.minY,
      worldMaxX: ctx.crop.maxX,
      worldMaxY: ctx.crop.maxY,
      startCol: ctx.startCol,
      endCol: ctx.endCol,
      startRow: ctx.startRow,
      endRow: ctx.endRow,
      colStep: ctx.colStep,
      rowStep: ctx.rowStep,
    }
  }

  const imageData = canvasCtx.createImageData(ctx.pixelWidth, ctx.pixelHeight)
  const data = imageData.data

  for (let py = 0; py < ctx.pixelHeight; py++) {
    const rowOffset = (ctx.pixelHeight - 1 - py) * ctx.rowStep
    const srcRow = Math.min(ctx.startRow + rowOffset, ctx.endRow)
    for (let px = 0; px < ctx.pixelWidth; px++) {
      const srcCol = Math.min(ctx.startCol + px * ctx.colStep, ctx.endCol)
      const cell = terrainCellAt(terrain, srcRow, srcCol)
      const height = cell.height === false ? undefined : cell.height
      const hillshade = computeHillshadeFromHeights(
        sampleHeightAt(terrain, srcRow, srcCol - ctx.colStep),
        sampleHeightAt(terrain, srcRow, srcCol + ctx.colStep),
        sampleHeightAt(terrain, srcRow - ctx.rowStep, srcCol),
        sampleHeightAt(terrain, srcRow + ctx.rowStep, srcCol),
      )
      const [r, g, b] = terrainCellColorBytes(cell.surface, cell.slope, hillshade, height)
      const i = (py * ctx.pixelWidth + px) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }

  canvasCtx.putImageData(imageData, 0, 0)

  return {
    dataUrl: canvas.toDataURL('image/png'),
    pixelWidth: ctx.pixelWidth,
    pixelHeight: ctx.pixelHeight,
    worldMinX: world.min_x + ctx.startCol * terrain.resolution_m,
    worldMinY: world.min_y + ctx.startRow * terrain.resolution_m,
    worldMaxX: world.min_x + ctx.endCol * terrain.resolution_m,
    worldMaxY: world.min_y + ctx.endRow * terrain.resolution_m,
    startCol: ctx.startCol,
    endCol: ctx.endCol,
    startRow: ctx.startRow,
    endRow: ctx.endRow,
    colStep: ctx.colStep,
    rowStep: ctx.rowStep,
  }
}

export function terrainCropForStations(
  terrain: TerrainExport,
  stationBounds?: GeoBounds,
): GeoBounds | undefined {
  if (!stationBounds) return undefined
  return terrainCropFromStationBounds(stationBounds, terrain.bounds.world)
}

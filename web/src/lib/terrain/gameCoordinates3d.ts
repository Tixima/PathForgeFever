import type { GamePosition } from '../maps/geoProjection'
import type { GeoBounds } from '../maps/geoProjection'
import { gameToTerrainScene } from './terrainSceneCoords'

/** Legacy-Fallback ohne Crop — bevorzugt gameToTerrainScene mit Crop-Bounds. */
export function gameToScene3d(gameX: number, gameY: number, height = 0): [number, number, number] {
  return [gameX, height, -gameY]
}

export function scenePointFromGame(
  gameX: number,
  gameY: number,
  height: number,
  crop?: GeoBounds,
): [number, number, number] {
  if (crop) return gameToTerrainScene(gameX, gameY, height, crop)
  return gameToScene3d(gameX, gameY, height)
}

export function gamePositionToScene3d(
  pos: GamePosition,
  heightOverride?: number,
  crop?: GeoBounds,
): [number, number, number] {
  const h = heightOverride ?? pos[2] ?? 0
  return scenePointFromGame(pos[0], pos[1], h, crop)
}

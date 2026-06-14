import type { GeoBounds } from '../maps/geoProjection'
import { projectGeoPoint } from '../maps/geoProjection'
import type { TerrainRasterImage } from './buildTerrainRaster'

export interface TerrainImagePlacement {
  x: number
  y: number
  width: number
  height: number
}

export function projectTerrainRasterToLayout(
  raster: TerrainRasterImage,
  bounds: GeoBounds,
  options: {
    width: number
    height: number
    padding?: number
    northUp?: boolean
    preserveAspectRatio?: boolean
  },
): TerrainImagePlacement {
  const padding = options.padding ?? 48
  const projection = {
    width: options.width,
    height: options.height,
    padding,
    northUp: options.northUp !== false,
    preserveAspectRatio: options.preserveAspectRatio !== false,
  }

  const nw = projectGeoPoint(raster.worldMinX, raster.worldMaxY, bounds, projection)
  const se = projectGeoPoint(raster.worldMaxX, raster.worldMinY, bounds, projection)
  const ne = projectGeoPoint(raster.worldMaxX, raster.worldMaxY, bounds, projection)
  const sw = projectGeoPoint(raster.worldMinX, raster.worldMinY, bounds, projection)

  const xs = [nw.x, se.x, ne.x, sw.x]
  const ys = [nw.y, se.y, ne.y, sw.y]

  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const width = Math.max(...xs) - x
  const height = Math.max(...ys) - y

  return { x, y, width, height }
}

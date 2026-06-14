import { useMemo } from 'react'
import type { TerrainExport } from '../../types/terrain'
import type { GeoBounds } from '../../lib/maps/geoProjection'
import { buildTerrainRasterImage } from '../../lib/terrain/buildTerrainRaster'
import { projectTerrainRasterToLayout } from '../../lib/terrain/terrainLayout'
import { terrainCropFromStationBounds } from '../../lib/terrain/terrainCrop'
import { hasTerrainData } from '../../lib/terrain/terrainAvailability'

interface TerrainMapBackgroundProps {
  terrain?: TerrainExport | null
  bounds: GeoBounds
  width: number
  height: number
  padding?: number
  northUp?: boolean
  preserveAspectRatio?: boolean
}

export function TerrainMapBackground({
  terrain,
  bounds,
  width,
  height,
  padding = 48,
  northUp = true,
  preserveAspectRatio = true,
}: TerrainMapBackgroundProps) {
  const background = useMemo(() => {
    if (!hasTerrainData(terrain) || !terrain) return null

    try {
      const cropBounds = terrainCropFromStationBounds(bounds, terrain.bounds.world)
      const raster = buildTerrainRasterImage(terrain, cropBounds)
      if (!raster.dataUrl) return null

      const placement = projectTerrainRasterToLayout(raster, bounds, {
        width,
        height,
        padding,
        northUp,
        preserveAspectRatio,
      })
      return { raster, placement }
    } catch {
      return null
    }
  }, [terrain, bounds, width, height, padding, northUp, preserveAspectRatio])

  if (!background) return null

  const { raster, placement } = background
  return (
    <image
      href={raster.dataUrl}
      x={placement.x}
      y={placement.y}
      width={placement.width}
      height={placement.height}
      preserveAspectRatio="none"
      opacity={1}
      aria-hidden
    />
  )
}

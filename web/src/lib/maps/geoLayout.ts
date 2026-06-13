import type { LayoutResult, MapStation } from './types'
import type { NetworkMapMeta } from '../../types/network'
import {
  buildGeoViewBox,
  computeGeoCanvasSize,
  GEO_PAD,
  GEO_VIEW_W,
  projectGeoPoint,
  resolveGeoBounds,
  type GeoProjectionOptions,
} from './geoProjection'

export interface GeoLayoutOptions extends GeoProjectionOptions {
  boundingBox?: NetworkMapMeta['bounding_box']
}

export function buildGeographicLayout(
  stations: MapStation[],
  options: GeoLayoutOptions = {},
): LayoutResult {
  const padding = options.padding ?? GEO_PAD

  if (stations.length === 0) {
    const width = options.width ?? GEO_VIEW_W
    const height = options.height ?? width
    return {
      stations: [],
      viewBox: buildGeoViewBox(width, height),
      width,
      height,
    }
  }

  const bounds = resolveGeoBounds(stations, options)
  const hasFixedSize = options.width != null && options.height != null
  const size = hasFixedSize
    ? { width: options.width!, height: options.height! }
    : computeGeoCanvasSize(bounds, {
        maxWidth: options.width ?? GEO_VIEW_W,
        maxHeight: options.maxHeight,
        padding,
      })

  const projectionOpts: GeoLayoutOptions = {
    ...options,
    width: size.width,
    height: size.height,
    padding,
    preserveAspectRatio: options.preserveAspectRatio !== false,
    northUp: options.northUp !== false,
  }

  const layoutStations = stations.map((s) => ({
    ...s,
    ...projectGeoPoint(s.geoX, s.geoY, bounds, projectionOpts),
  }))

  return {
    stations: layoutStations,
    viewBox: buildGeoViewBox(size.width, size.height),
    width: size.width,
    height: size.height,
  }
}

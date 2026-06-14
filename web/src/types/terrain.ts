export type TerrainSurfaceCode = 'W' | 'L' | 'H' | 'M' | 'C' | 'N'
export type TerrainSlopeCode = 'F' | 'G' | 'S' | 'X' | 'N'

export interface TerrainSurfaceLegendEntry {
  label: string
  de: string
  meaning?: string
  source?: string
}

export interface TerrainBounds {
  world: {
    min_x: number
    max_x: number
    min_y: number
    max_y: number
  }
  width_m_experimental?: number
  height_m_experimental?: number
}

export interface TerrainExport {
  enabled: boolean
  schema?: string
  schema_version?: number
  status?: string
  resolution_m: number
  raster_resolution_m?: number
  cell_size_m?: number
  columns: number
  rows: number
  water_level?: number
  bounds: TerrainBounds
  height_rows: Array<Array<number | false>>
  surface_rows: string[]
  slope_class_rows?: string[]
  surface_code_legend?: Record<TerrainSurfaceCode, TerrainSurfaceLegendEntry>
  slope_code_legend?: Record<TerrainSlopeCode, TerrainSurfaceLegendEntry>
  statistics?: {
    min_height?: number
    max_height?: number
    water_samples?: number
    land_samples?: number
  }
}

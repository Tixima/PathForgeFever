export type TrackEdgeClassification = 'normal' | 'bridge' | 'tunnel' | 'elevated' | 'unknown'

export interface TrackWorldPoint {
  x: number
  y: number
  z: number
}

export interface TrackSvgPoint {
  x: number
  y: number
}

export interface TrackNetworkEdge {
  edge_entity: number
  transport_network_entity: number
  edge_index?: number
  type: 'rail'
  from_node?: string
  to_node?: string
  points: TrackWorldPoint[]
  svg_1000?: TrackSvgPoint[]
  length_game_units?: number
  sample_spacing_m?: number
  classification?: TrackEdgeClassification
}

export type LineTrackPathSource = 'pathfinding' | 'station_positions_fallback' | 'unknown'

export interface LineTrackPath {
  line_id: number
  sequence_index: number
  line_name?: string
  line_color_hex?: string
  from_station_group_id: number
  to_station_group_id: number
  points: TrackWorldPoint[]
  svg_1000?: TrackSvgPoint[]
  source?: LineTrackPathSource
}

export interface TrackNetworkExport {
  schema?: string
  schema_version?: number
  status?: string
  sample_spacing_m?: number
  sample_spacing_min_m?: number
  sample_spacing_max_m?: number
  edge_count?: number
  line_path_count?: number
  transport_network_jobs?: number
  edges?: TrackNetworkEdge[]
  line_paths?: LineTrackPath[]
}

export function hasTrackNetworkData(trackNetwork?: TrackNetworkExport | null): boolean {
  return (trackNetwork?.edges?.length ?? 0) > 0 || (trackNetwork?.line_paths?.length ?? 0) > 0
}

export interface NetworkMapMeta {
  node_count?: number
  edge_count?: number
  interchange_count?: number
  bounding_box?: { min_x: number; max_x: number; min_y: number; max_y: number }
  center?: { x: number; y: number }
  experimental?: boolean
  renderer_hint?: {
    geographic_mvp?: string
    schematic_later?: string
    web_recommended?: string
  }
}

export interface NetworkExport {
  generated_by: string
  generated_at_unix: number
  schema_version: string
  station_groups: StationGroup[]
  stations: Station[]
  lines: Line[]
  segments: Segment[]
  routing_nodes: RoutingNode[]
  routing_edges: RoutingEdge[]
  transfers: Transfer[]
  line_summaries: LineSummary[]
  station_line_index: StationLineIndex[]
  counts: Record<string, number>
  scale: ScaleInfo
  quality_report: QualityReportEntry[]
  network_map?: NetworkMapMeta
  experimental?: { enabled?: boolean; warning?: string }
  diagnostics?: Array<{ level: string; message: string }>
}

export interface StationGroup {
  id: number
  name: string
  station_ids: number[]
  position: [number, number, number]
  type: string
}

export interface Station {
  id: number
  name: string
  station_group_id: number
}

export interface Line {
  id: number
  name: string
  stops: LineStop[]
  display_color?: DisplayColor
  effective_transport_mode_profile?: string
  stop_names_preview?: string[]
}

export interface LineStop {
  station_group_id: number
  index: number
  station_group_name?: string
  station_name?: string
  track?: number
  platform?: number
  terminal?: number
  track_number?: number
  platform_number?: number
  terminal_number?: number
  track_display?: string
  platform_display?: string
  track_resolution_status?: string
  platform_resolution_status?: string
  towards_station_group_id?: number
  towards_station_group_name?: string
  station_group_position?: [number, number, number]
}

export interface Segment {
  line_id: number
  line_name: string
  sequence_index: number
  from_station_group_id: number
  to_station_group_id: number
  from_station_group_name: string
  to_station_group_name: string
  travel_time_seconds: number
  distance_km_experimental?: number
  estimated_route_distance_km_experimental?: number
  from_platform_display?: string
  to_platform_display?: string
  from_track?: number
  to_track?: number
  from_platform?: number
  to_platform?: number
  from_terminal?: number
  to_terminal?: number
  from_position?: [number, number, number]
  to_position?: [number, number, number]
}

export interface RoutingNode {
  id: number
  name: string
  position: [number, number, number]
  served_by_lines: number[]
  served_by_line_names: string[]
  interchange: boolean
  degree: number
}

export interface RoutingEdge {
  id: string
  from: number
  to: number
  from_name: string
  to_name: string
  line_id: number
  line_name: string
  sequence_index: number
  cost_seconds: number
  cost_distance: number
  distance_km: number
}

export interface Transfer {
  station_group_id: number
  station_group_name: string
  transfer_time_seconds_experimental: number
  served_by_lines: number[]
  served_by_line_names: string[]
}

export interface LineSummary {
  line_id: number
  line_name: string
  stop_count: number
  display_color?: DisplayColor
}

export interface StationLineIndex {
  station_group_id: number
  station_group_name: string
  lines: StationLineEntry[]
}

export interface StationLineEntry {
  line_id: number
  line_name: string
  display_color?: DisplayColor
  stop_indices?: number[]
}

export interface DisplayColor {
  hex: string
  r: number
  g: number
  b: number
}

export interface ScaleInfo {
  meters_per_game_unit?: number
  note?: string
}

export interface QualityReportEntry {
  code: string
  level: string
  message: string
}

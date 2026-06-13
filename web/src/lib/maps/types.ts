export type LineShape = 'linear' | 'pingpong' | 'ring' | 'partial_return'

export interface MapStation {
  id: number
  name: string
  geoX: number
  /** Spiel-Y (Nord/Süd) — nicht Höhe (Z)! */
  geoY: number
  interchange: boolean
  degree: number
  lineIds: number[]
  lineNames: string[]
  lineColors: string[]
}

export interface LineSegment {
  stationIds: number[]
  direction: 'outbound' | 'inbound' | 'loop' | 'return'
}

export interface MapLine {
  id: number
  name: string
  color: string
  shape: LineShape
  /** Vollständige Haltesequence inkl. Wiederholungen */
  fullStationIds: number[]
  /** Stations für Layout (Hinfahrt bzw. einmaliger Rundverlauf) */
  layoutStationIds: number[]
  /** Segmente zum Zeichnen */
  segments: LineSegment[]
  stopCount: number
  turnaroundStationId?: number
  startStationId: number
  endStationId: number
}

export interface MapEdge {
  id: string
  lineId: number
  lineName: string
  lineColor: string
  fromId: number
  toId: number
  fromName: string
  toName: string
}

export interface LayoutStation extends MapStation {
  x: number
  y: number
}

export interface NetworkMapData {
  stations: MapStation[]
  lines: MapLine[]
  edges: MapEdge[]
  stationById: Map<number, MapStation>
}

export interface LayoutResult {
  stations: LayoutStation[]
  viewBox: string
  width: number
  height: number
}

export type MapHoverStation = {
  type: 'station'
  station: LayoutStation
}

export type MapHoverLine = {
  type: 'line'
  line: MapLine
  edge?: MapEdge
}

export type MapHover = MapHoverStation | MapHoverLine

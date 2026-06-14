import type { NetworkExport } from '../../types/network'
import type { LineTrackPath, TrackNetworkEdge, TrackNetworkExport } from '../../types/trackNetwork'
import { hasTrackNetworkData } from '../../types/trackNetwork'

export interface GeneralMapPolyline {
  id: string
  kind: 'track' | 'line'
  geoPoints: Array<{ geoX: number; geoY: number; z?: number }>
  color: string
  width: number
  opacity: number
  dashed?: boolean
  lineId?: number
  classification?: string
  source?: string
}

export interface GeneralMapLayersData {
  tracks: GeneralMapPolyline[]
  lines: GeneralMapPolyline[]
  hasTracks: boolean
  hasLinePaths: boolean
}

const TRACK_COLORS: Record<string, string> = {
  normal: '#94a3b8',
  bridge: '#cbd5e1',
  tunnel: '#64748b',
  elevated: '#a8b4c4',
  unknown: '#94a3b8',
}

const FALLBACK_LINE_COLOR = '#3B82F6'

function trackColor(edge: TrackNetworkEdge): string {
  return TRACK_COLORS[edge.classification ?? 'normal'] ?? TRACK_COLORS.normal
}

function polylineFromPoints(
  id: string,
  kind: 'track' | 'line',
  points: Array<{ x: number; y: number; z?: number }>,
  color: string,
  options?: {
    width?: number
    opacity?: number
    dashed?: boolean
    lineId?: number
    classification?: string
    source?: string
  },
): GeneralMapPolyline | null {
  if (points.length < 2) return null
  return {
    id,
    kind,
    geoPoints: points.map((p) => ({ geoX: p.x, geoY: p.y, z: p.z })),
    color,
    width: options?.width ?? (kind === 'track' ? 2 : 4),
    opacity: options?.opacity ?? (kind === 'track' ? 0.55 : 0.9),
    dashed: options?.dashed,
    lineId: options?.lineId,
    classification: options?.classification,
    source: options?.source,
  }
}

export function buildGeneralMapLayersData(
  network: NetworkExport,
  lineColorById?: Map<number, string>,
): GeneralMapLayersData {
  const trackNetwork: TrackNetworkExport | undefined = network.track_network
  const tracks: GeneralMapPolyline[] = []
  const lines: GeneralMapPolyline[] = []

  if (trackNetwork?.edges) {
    for (let i = 0; i < trackNetwork.edges.length; i++) {
      const edge = trackNetwork.edges[i]
      const poly = polylineFromPoints(
        `track:${edge.transport_network_entity}:${edge.edge_index ?? i}`,
        'track',
        edge.points,
        trackColor(edge),
        {
          width: 2,
          opacity: edge.classification === 'tunnel' ? 0.35 : 0.5,
          classification: edge.classification,
        },
      )
      if (poly) tracks.push(poly)
    }
  }

  if (trackNetwork?.line_paths) {
    for (const path of trackNetwork.line_paths) {
      const color =
        path.line_color_hex ??
        lineColorById?.get(path.line_id) ??
        FALLBACK_LINE_COLOR
      const isFallback = path.source === 'station_positions_fallback'
      const poly = polylineFromPoints(
        `line-path:${path.line_id}:${path.sequence_index}`,
        'line',
        path.points,
        color,
        {
          width: isFallback ? 3 : 5,
          opacity: isFallback ? 0.35 : 0.92,
          dashed: isFallback,
          lineId: path.line_id,
          source: path.source,
        },
      )
      if (poly) lines.push(poly)
    }
  }

  return {
    tracks,
    lines,
    hasTracks: tracks.length > 0,
    hasLinePaths: lines.length > 0,
  }
}

export function generalMapLayersAvailable(network: NetworkExport): boolean {
  return hasTrackNetworkData(network.track_network)
}

export function pathfindingLinePathsOnly(paths: LineTrackPath[]): LineTrackPath[] {
  return paths.filter((p) => p.source === 'pathfinding')
}

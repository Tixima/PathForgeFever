import type { RouteResult } from '../routing/types'
import type { StationOption } from '../routing/types'
import type { TerrainExport } from '../../types/terrain'
import type { MapEdge, MapStation } from './types'
import { gameX, gameY } from './geoProjection'
import type { GeoBounds } from '../maps/geoProjection'
import { terrainCropFromStationBounds } from '../terrain/terrainCrop'
import {
  overlayExtentFromBounds,
  resolveOverlayHeight,
} from '../terrain/buildTerrainScene3d'
import { resolveTerrainVerticalContext } from '../terrain/terrainVertical'
import { resolveStationHeightFor3dMesh } from '../terrain/terrainMeshSampling'

export type Map3DNodeKind = 'start' | 'end' | 'via' | 'transfer' | 'hub' | 'stop'

export interface Map3DNode {
  gameX: number
  gameY: number
  height: number
  color: string
  radius: number
  label?: string
  ring?: boolean
  kind?: Map3DNodeKind
}

export interface Map3DEdge {
  fromGameX: number
  fromGameY: number
  fromHeight: number
  toGameX: number
  toGameY: number
  toHeight: number
  color: string
  opacity?: number
  width?: number
}

export interface Map3DPolyline {
  points: Array<{ gameX: number; gameY: number; height: number }>
  color: string
  opacity?: number
  width?: number
  dashed?: boolean
}

export interface Map3DOverlay {
  edges?: Map3DEdge[]
  nodes?: Map3DNode[]
  polylines?: Map3DPolyline[]
}

function stationHeight(
  terrain: TerrainExport | null | undefined,
  station: MapStation,
  exaggeration: number,
  extent: number,
  baseline = 0,
  crop?: GeoBounds,
): number {
  const h = resolveStationHeightFor3dMesh(terrain, station.geoX, station.geoY, crop)
  return resolveOverlayHeight(h, exaggeration, extent, baseline)
}

function stationHeightFromGame(
  terrain: TerrainExport | null | undefined,
  gameXVal: number,
  gameYVal: number,
  positionZ?: number,
  exaggeration = 1,
  extent = 10_000,
  baseline = 0,
  crop?: GeoBounds,
): number {
  const h = resolveStationHeightFor3dMesh(terrain, gameXVal, gameYVal, crop, positionZ)
  return resolveOverlayHeight(h, exaggeration, extent, baseline)
}

function resolveVerticalContext(
  terrain: TerrainExport | null | undefined,
  stationBounds?: { minX: number; maxX: number; minY: number; maxY: number },
): { exaggeration: number; baseline: number; crop?: GeoBounds } {
  if (!terrain) return { exaggeration: 1, baseline: 0 }
  const crop =
    stationBounds != null
      ? terrainCropFromStationBounds(stationBounds, terrain.bounds.world)
      : {
          minX: terrain.bounds.world.min_x,
          maxX: terrain.bounds.world.max_x,
          minY: terrain.bounds.world.min_y,
          maxY: terrain.bounds.world.max_y,
        }
  const ctx = resolveTerrainVerticalContext(terrain, crop)
  return { exaggeration: ctx.exaggeration, baseline: ctx.baseline, crop }
}

export function buildNetworkMapOverlay(
  stations: MapStation[],
  edges: MapEdge[],
  terrain?: TerrainExport | null,
  options?: {
    highlightStationIds?: number[]
    highlightLineIds?: number[]
    dimUnhighlighted?: boolean
    stationBounds?: { minX: number; maxX: number; minY: number; maxY: number }
  },
): Map3DOverlay {
  const { exaggeration, baseline, crop } = resolveVerticalContext(terrain, options?.stationBounds)
  const extent = overlayExtentFromBounds(options?.stationBounds)
  const stationById = new Map(stations.map((s) => [s.id, s]))
  const highlightStations = new Set(options?.highlightStationIds ?? [])
  const highlightLines = new Set(options?.highlightLineIds ?? [])
  const dim = options?.dimUnhighlighted ?? false

  const overlayEdges: Map3DEdge[] = edges
    .map((edge) => {
      const from = stationById.get(edge.fromId)
      const to = stationById.get(edge.toId)
      if (!from || !to) return null
      const active = highlightLines.has(edge.lineId)
      return {
        fromGameX: from.geoX,
        fromGameY: from.geoY,
        fromHeight: stationHeight(terrain, from, exaggeration, extent, baseline, crop),
        toGameX: to.geoX,
        toGameY: to.geoY,
        toHeight: stationHeight(terrain, to, exaggeration, extent, baseline, crop),
        color: edge.lineColor,
        opacity: dim && !active ? 0.35 : active ? 1 : 0.8,
        width: active ? 5 : 3,
      }
    })
    .filter(Boolean) as Map3DEdge[]

  const overlayNodes: Map3DNode[] = stations.map((s) => {
    const highlighted = highlightStations.has(s.id)
    const isHub = s.interchange || s.lineIds.length > 1
    return {
      gameX: s.geoX,
      gameY: s.geoY,
      height: stationHeight(terrain, s, exaggeration, extent, baseline, crop),
      color: highlighted ? '#ffffff' : isHub ? '#fbbf24' : '#f1f5f9',
      radius: highlighted ? 18 : isHub ? 14 : 8,
      label: highlighted ? s.name : undefined,
      ring: highlighted || isHub,
      kind: isHub ? 'hub' : 'stop',
    }
  })

  return { edges: overlayEdges, nodes: overlayNodes }
}

export function buildRouteMapOverlay(
  route: RouteResult,
  stations: StationOption[],
  terrain?: TerrainExport | null,
  stationBounds?: { minX: number; maxX: number; minY: number; maxY: number },
): Map3DOverlay {
  const { exaggeration, baseline, crop } = resolveVerticalContext(terrain, stationBounds)
  const extent = overlayExtentFromBounds(stationBounds)
  const stationById = new Map(stations.map((s) => [s.id, s]))
  const viaSet = new Set(route.viaStationIds ?? [])

  const transferIds = new Set<number>()
  for (let i = 0; i < route.legs.length - 1; i++) {
    transferIds.add(route.legs[i].toStationId)
  }

  const nodeHeight = (id: number): number => {
    const s = stationById.get(id)
    if (!s?.position) return resolveOverlayHeight(0, exaggeration, extent, baseline)
    return stationHeightFromGame(
      terrain,
      gameX(s.position),
      gameY(s.position),
      s.position[2],
      exaggeration,
      extent,
      baseline,
      crop,
    )
  }

  const overlayNodes: Map3DNode[] = route.stationIds
    .map((id, index) => {
      const s = stationById.get(id)
      if (!s?.position) return null
      const gx = gameX(s.position)
      const gy = gameY(s.position)
      const isStart = index === 0
      const isEnd = index === route.stationIds.length - 1
      const isVia = viaSet.has(id)
      const isTransfer = transferIds.has(id) && !isStart && !isEnd
      const isHub = s.interchange

      let kind: Map3DNodeKind = 'stop'
      if (isStart) kind = 'start'
      else if (isEnd) kind = 'end'
      else if (isVia) kind = 'via'
      else if (isTransfer) kind = 'transfer'
      else if (isHub) kind = 'hub'

      let color = '#f8fafc'
      if (isStart || isEnd) color = '#22d3ee'
      else if (isTransfer) color = '#fb923c'
      else if (isVia) color = '#a78bfa'
      else if (isHub) color = '#fbbf24'

      const radius = isStart || isEnd ? 20 : isTransfer ? 16 : isVia ? 14 : isHub ? 13 : 10

      return {
        gameX: gx,
        gameY: gy,
        height: nodeHeight(id),
        color,
        radius,
        label:
          isStart || isEnd || isTransfer || isVia ? s.name : undefined,
        ring: isStart || isEnd || isTransfer || isVia,
        kind,
      }
    })
    .filter(Boolean) as Map3DNode[]

  const overlayEdges: Map3DEdge[] = []
  for (const leg of route.legs) {
    const legStationIds = [leg.fromStationId]
    for (const stop of leg.stops.slice(1)) {
      const match = stations.find((st) => st.name === stop)
      if (match) legStationIds.push(match.id)
    }
    for (let i = 0; i < legStationIds.length - 1; i++) {
      const from = stationById.get(legStationIds[i])
      const to = stationById.get(legStationIds[i + 1])
      if (!from?.position || !to?.position) continue
      overlayEdges.push({
        fromGameX: gameX(from.position),
        fromGameY: gameY(from.position),
        fromHeight: nodeHeight(legStationIds[i]),
        toGameX: gameX(to.position),
        toGameY: gameY(to.position),
        toHeight: nodeHeight(legStationIds[i + 1]),
        color: leg.lineColor,
        opacity: 1,
        width: 6,
      })
    }
  }

  return { edges: overlayEdges, nodes: overlayNodes }
}

export function buildIsochroneOverlay(
  stations: MapStation[],
  terrain?: TerrainExport | null,
  options?: {
    originId?: number
    colorByStationId?: Map<number, string>
    reachableIds?: Set<number>
    stationBounds?: { minX: number; maxX: number; minY: number; maxY: number }
  },
): Map3DOverlay {
  const { exaggeration, baseline, crop } = resolveVerticalContext(terrain, options?.stationBounds)
  const extent = overlayExtentFromBounds(options?.stationBounds)
  const overlayNodes: Map3DNode[] = stations.map((s) => {
    const isOrigin = s.id === options?.originId
    const reachable = options?.reachableIds?.has(s.id) ?? false
    const isHub = s.interchange || s.lineIds.length > 1
    const color = options?.colorByStationId?.get(s.id) ?? 'rgba(255,255,255,0.45)'
    return {
      gameX: s.geoX,
      gameY: s.geoY,
      height: stationHeight(terrain, s, exaggeration, extent, baseline, crop),
      color: isOrigin ? '#ffffff' : isHub ? '#fbbf24' : color,
      radius: isOrigin ? 18 : isHub ? 14 : reachable ? 10 : 6,
      label: isOrigin ? s.name : undefined,
      ring: isOrigin || isHub,
      kind: isOrigin ? 'start' : isHub ? 'hub' : 'stop',
    }
  })
  return { nodes: overlayNodes }
}

export function buildComplexRemedyOverlay(
  stations: MapStation[],
  terrain?: TerrainExport | null,
  options?: {
    referenceStationIds?: number[]
    proposalStationIds?: number[]
    fromId?: number
    toId?: number
    transferIds?: number[]
    highlightIds?: number[]
    stationBounds?: { minX: number; maxX: number; minY: number; maxY: number }
  },
): Map3DOverlay {
  const { exaggeration, baseline, crop } = resolveVerticalContext(terrain, options?.stationBounds)
  const extent = overlayExtentFromBounds(options?.stationBounds)
  const refSet = new Set(options?.referenceStationIds ?? [])
  const proposalSet = new Set(options?.proposalStationIds ?? [])
  const transferSet = new Set(options?.transferIds ?? [])
  const highlightSet = new Set(options?.highlightIds ?? [])

  const overlayNodes: Map3DNode[] = stations
    .filter(
      (s) =>
        refSet.has(s.id) ||
        proposalSet.has(s.id) ||
        transferSet.has(s.id) ||
        highlightSet.has(s.id),
    )
    .map((s) => {
      const isTerminal = s.id === options?.fromId || s.id === options?.toId
      const isTransfer = transferSet.has(s.id)
      const highlighted = highlightSet.has(s.id) || refSet.has(s.id)
      return {
        gameX: s.geoX,
        gameY: s.geoY,
        height: stationHeight(terrain, s, exaggeration, extent, baseline, crop),
        color: isTerminal ? '#22d3ee' : isTransfer ? '#fb923c' : highlighted ? '#34d399' : '#e2e8f0',
        radius: isTerminal ? 18 : isTransfer ? 16 : highlighted ? 14 : 10,
        label: isTerminal || isTransfer ? s.name : undefined,
        ring: isTerminal || isTransfer,
        kind: isTerminal ? 'end' : isTransfer ? 'transfer' : highlighted ? 'stop' : 'stop',
      }
    })

  const overlayPolylines: Map3DPolyline[] = []
  if (options?.referenceStationIds?.length) {
    overlayPolylines.push({
      points: options.referenceStationIds
        .map((id) => stations.find((s) => s.id === id))
        .filter(Boolean)
        .map((s) => ({
          gameX: s!.geoX,
          gameY: s!.geoY,
          height: stationHeight(terrain, s!, exaggeration, extent, baseline, crop),
        })),
      color: '#cbd5e1',
      opacity: 0.9,
      width: 4,
    })
  }
  if (options?.proposalStationIds?.length) {
    overlayPolylines.push({
      points: options.proposalStationIds
        .map((id) => stations.find((s) => s.id === id))
        .filter(Boolean)
        .map((s) => ({
          gameX: s!.geoX,
          gameY: s!.geoY,
          height: stationHeight(terrain, s!, exaggeration, extent, baseline, crop) + extent * 0.002,
        })),
      color: '#34d399',
      opacity: 1,
      width: 5,
    })
  }

  return { nodes: overlayNodes, polylines: overlayPolylines }
}

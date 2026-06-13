import type { NetworkExport } from '../../types/network'
import { findAllRoutesFromStation } from '../routing/pathfinder'
import type { RouteCriterion } from '../routing/types'

export interface WhatIfConnection {
  fromId: number
  toId: number
  fromName: string
  toName: string
  distanceGame: number
  estimatedKm: number
  estimatedSeconds: number
}

export interface WhatIfImpact {
  connection: WhatIfConnection
  beforeReachable: number
  afterReachable: number
  newDestinations: string[]
  improvedRoutes: Array<{ dest: string; beforeMin: number; afterMin: number; savedMin: number }>
  hubScoreDelta: number
}

type NodePos = { id: number; name: string; x: number; y: number }

function gameDistance(a: NodePos, b: NodePos): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function estimateTravel(secondsPerKm: number, km: number): number {
  return Math.max(60, Math.round(km * secondsPerKm))
}

export function augmentNetworkWithConnection(
  network: NetworkExport,
  connection: WhatIfConnection,
): NetworkExport {
  return {
    ...network,
    routing_edges: [
      ...network.routing_edges,
      {
        id: `whatif-${connection.fromId}-${connection.toId}`,
        from: connection.fromId,
        to: connection.toId,
        from_name: connection.fromName,
        to_name: connection.toName,
        line_id: -1,
        line_name: 'Vorschlag',
        sequence_index: 0,
        cost_seconds: connection.estimatedSeconds,
        cost_distance: connection.estimatedKm * 1000,
        distance_km: connection.estimatedKm,
      },
      {
        id: `whatif-${connection.toId}-${connection.fromId}`,
        from: connection.toId,
        to: connection.fromId,
        from_name: connection.toName,
        to_name: connection.fromName,
        line_id: -1,
        line_name: 'Vorschlag',
        sequence_index: 0,
        cost_seconds: connection.estimatedSeconds,
        cost_distance: connection.estimatedKm * 1000,
        distance_km: connection.estimatedKm,
      },
    ],
  }
}

export function buildWhatIfConnection(
  network: NetworkExport,
  fromId: number,
  toId: number,
): WhatIfConnection | null {
  const from = network.routing_nodes.find((n) => n.id === fromId)
  const to = network.routing_nodes.find((n) => n.id === toId)
  if (!from || !to) return null

  const dx = from.position[0] - to.position[0]
  const dy = from.position[1] - to.position[1]
  const dist = Math.sqrt(dx * dx + dy * dy)
  const metersPerUnit = network.scale?.meters_per_game_unit ?? 1
  const km = (dist * metersPerUnit) / 1000 * 1.35
  const secondsPerKm = 3600 / 80

  return {
    fromId,
    toId,
    fromName: from.name,
    toName: to.name,
    distanceGame: dist,
    estimatedKm: km,
    estimatedSeconds: estimateTravel(secondsPerKm, km),
  }
}

export function findWhatIfCandidates(
  network: NetworkExport,
  maxCandidates = 12,
): WhatIfConnection[] {
  const nodes: NodePos[] = network.routing_nodes.map((n) => ({
    id: n.id,
    name: n.name,
    x: n.position[0],
    y: n.position[1],
  }))

  const edgeSet = new Set<string>()
  for (const e of network.routing_edges) {
    edgeSet.add(`${e.from}-${e.to}`)
    edgeSet.add(`${e.to}-${e.from}`)
  }

  const metersPerUnit = network.scale?.meters_per_game_unit ?? 1
  const avgSpeedKmh = 80
  const secondsPerKm = 3600 / avgSpeedKmh

  const candidates: WhatIfConnection[] = []

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      const key = `${a.id}-${b.id}`
      if (edgeSet.has(key)) continue

      const dist = gameDistance(a, b)
      const km = (dist * metersPerUnit) / 1000 * 1.35
      if (km > 25) continue

      candidates.push({
        fromId: a.id,
        toId: b.id,
        fromName: a.name,
        toName: b.name,
        distanceGame: dist,
        estimatedKm: km,
        estimatedSeconds: estimateTravel(secondsPerKm, km),
      })
    }
  }

  return candidates.sort((a, b) => a.estimatedKm - b.estimatedKm).slice(0, maxCandidates)
}

export function simulateWhatIfConnection(
  network: NetworkExport,
  connection: WhatIfConnection,
  originId: number,
  criterion: RouteCriterion = 'fastest',
): WhatIfImpact {
  const beforeRoutes = findAllRoutesFromStation(network, originId, criterion)
  const beforeByDest = new Map(
    beforeRoutes.map((r) => [
      r.stationIds[r.stationIds.length - 1],
      r.totalDurationSeconds / 60,
    ]),
  )

  const augmented: NetworkExport = {
    ...network,
    routing_edges: [
      ...network.routing_edges,
      {
        id: `whatif-${connection.fromId}-${connection.toId}`,
        from: connection.fromId,
        to: connection.toId,
        from_name: connection.fromName,
        to_name: connection.toName,
        line_id: -1,
        line_name: 'Was-wäre-wenn',
        sequence_index: 0,
        cost_seconds: connection.estimatedSeconds,
        cost_distance: connection.estimatedKm * 1000,
        distance_km: connection.estimatedKm,
      },
      {
        id: `whatif-${connection.toId}-${connection.fromId}`,
        from: connection.toId,
        to: connection.fromId,
        from_name: connection.toName,
        to_name: connection.fromName,
        line_id: -1,
        line_name: 'Was-wäre-wenn',
        sequence_index: 0,
        cost_seconds: connection.estimatedSeconds,
        cost_distance: connection.estimatedKm * 1000,
        distance_km: connection.estimatedKm,
      },
    ],
  }

  const afterRoutes = findAllRoutesFromStation(augmented, originId, criterion)
  const newDestinations: string[] = []
  const improvedRoutes: WhatIfImpact['improvedRoutes'] = []

  for (const route of afterRoutes) {
    const destId = route.stationIds[route.stationIds.length - 1]
    const dest = route.stationNames[route.stationNames.length - 1]
    const afterMin = route.totalDurationSeconds / 60
    const beforeMin = beforeByDest.get(destId)

    if (beforeMin === undefined) {
      newDestinations.push(dest)
    } else if (afterMin < beforeMin - 0.5) {
      improvedRoutes.push({
        dest,
        beforeMin,
        afterMin,
        savedMin: beforeMin - afterMin,
      })
    }
  }

  improvedRoutes.sort((a, b) => b.savedMin - a.savedMin)

  return {
    connection,
    beforeReachable: beforeRoutes.length,
    afterReachable: afterRoutes.length,
    newDestinations,
    improvedRoutes: improvedRoutes.slice(0, 8),
    hubScoreDelta: newDestinations.length + improvedRoutes.length * 0.5,
  }
}

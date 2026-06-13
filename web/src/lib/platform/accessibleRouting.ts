import type { NetworkExport } from '../../types/network'
import type { RouteLeg, RouteResult } from '../routing/types'
import { routeUsesStaySeatedTransfer } from '../routing/staySeatedStops'
import { getTransferTracks } from './platformIntel'
import {
  buildRoutingPlatformIndex,
  getAlightingTrack,
  getBoardingTrack,
  type RoutingPlatformIndex,
} from './routingPlatforms'

export interface TransferAccessibilityDetail {
  stationId: number
  stationName: string
  arrivalLineName: string
  departureLineName: string
  arrivalTrack: string | null
  departureTrack: string | null
  samePlatform: boolean
  unavoidable: boolean
  reason: string
}

export interface RouteAccessibilityReport {
  requested: boolean
  fullySamePlatform: boolean
  zeroChangeRouteExists: boolean
  zeroChangeWithoutStaySeated: boolean
  usesStaySeated: boolean
  platformChangeCount: number
  summary: string
  transfers: TransferAccessibilityDetail[]
}

function trackFromIndex(track: number | null | undefined): string | null {
  return track != null ? `Gleis ${track + 1}` : null
}

type ExportSegment = NetworkExport['segments'][number] & {
  from_platform_display?: string
  to_platform_display?: string
  from_track?: number
  to_track?: number
}

export function listBoardingPlatformsForHop(
  index: RoutingPlatformIndex,
  network: NetworkExport,
  lineId: number,
  fromId: number,
  toId: number,
): string[] {
  const track = getBoardingTrack(index, lineId, fromId, toId)
  if (track) return [track]

  const platforms = new Set<string>()
  for (const segment of network.segments as ExportSegment[]) {
    if (segment.line_id !== lineId) continue
    if (segment.from_station_group_id === fromId && segment.to_station_group_id === toId) {
      const platform =
        segment.from_platform_display ?? trackFromIndex(segment.from_track)
      if (platform) platforms.add(platform)
    }
    if (segment.from_station_group_id === toId && segment.to_station_group_id === fromId) {
      const platform = segment.to_platform_display ?? trackFromIndex(segment.to_track)
      if (platform) platforms.add(platform)
    }
  }
  return [...platforms]
}

export function listAlightingPlatformsForHop(
  index: RoutingPlatformIndex,
  network: NetworkExport,
  lineId: number,
  fromId: number,
  toId: number,
): string[] {
  const track = getAlightingTrack(index, lineId, fromId, toId)
  if (track) return [track]

  const platforms = new Set<string>()
  for (const segment of network.segments as ExportSegment[]) {
    if (segment.line_id !== lineId) continue
    if (segment.from_station_group_id === fromId && segment.to_station_group_id === toId) {
      const platform = segment.to_platform_display ?? trackFromIndex(segment.to_track)
      if (platform) platforms.add(platform)
    }
    if (segment.from_station_group_id === toId && segment.to_station_group_id === fromId) {
      const platform =
        segment.from_platform_display ?? trackFromIndex(segment.from_track)
      if (platform) platforms.add(platform)
    }
  }
  return [...platforms]
}

export function canTransferWithoutPlatformChange(
  index: RoutingPlatformIndex,
  network: NetworkExport,
  arrivalLineId: number,
  arrivalFromId: number,
  stationId: number,
  departureLineId: number,
  departureToId: number,
): boolean {
  const alight = getAlightingTrack(index, arrivalLineId, arrivalFromId, stationId)
  const board = getBoardingTrack(index, departureLineId, stationId, departureToId)
  if (alight && board) return alight === board

  const possibleAlight = listAlightingPlatformsForHop(
    index,
    network,
    arrivalLineId,
    arrivalFromId,
    stationId,
  )
  const possibleBoard = listBoardingPlatformsForHop(
    index,
    network,
    departureLineId,
    stationId,
    departureToId,
  )

  if (possibleAlight.length === 0 || possibleBoard.length === 0) {
    return false
  }

  return possibleAlight.some((platform) => possibleBoard.includes(platform))
}

function explainTransfer(
  index: RoutingPlatformIndex,
  network: NetworkExport,
  arrivalLeg: RouteLeg,
  departureLeg: RouteLeg,
  arrivalTrack: string | null,
  departureTrack: string | null,
): Pick<TransferAccessibilityDetail, 'unavoidable' | 'reason' | 'samePlatform'> {
  const samePlatform = Boolean(
    arrivalTrack && departureTrack && arrivalTrack === departureTrack,
  )
  if (samePlatform) {
    return {
      samePlatform: true,
      unavoidable: false,
      reason: 'Ankunft und Abfahrt auf demselben Gleis — kein Gleiswechsel nötig.',
    }
  }

  const arrivalFromId = resolveHopFromId(network, arrivalLeg)
  const departureToId = resolveHopToId(network, departureLeg)
  const possibleAlight = listAlightingPlatformsForHop(
    index,
    network,
    arrivalLeg.lineId,
    arrivalFromId,
    arrivalLeg.toStationId,
  )
  const possibleBoard = listBoardingPlatformsForHop(
    index,
    network,
    departureLeg.lineId,
    departureLeg.fromStationId,
    departureToId,
  )
  const shared = possibleAlight.filter((platform) => possibleBoard.includes(platform))
  const unavoidable = shared.length === 0

  if (unavoidable) {
    const alightLabel = possibleAlight.length > 0 ? possibleAlight.join(', ') : 'unbekannt'
    const boardLabel = possibleBoard.length > 0 ? possibleBoard.join(', ') : 'unbekannt'
    return {
      samePlatform: false,
      unavoidable: true,
      reason: `Kein gemeinsames Gleis: ${arrivalLeg.lineName.replace(/^Linie\s*/i, 'Linie ')} endet hier auf ${alightLabel}, ${departureLeg.lineName.replace(/^Linie\s*/i, 'Linie ')} fährt ab ${boardLabel} ab.`,
    }
  }

  const sharedLabel = shared.join(', ')
  const used =
    arrivalTrack && departureTrack
      ? `${arrivalTrack} → ${departureTrack}`
      : 'unterschiedliche Gleise'
  return {
    samePlatform: false,
    unavoidable: false,
    reason: `Gleiswechsel (${used}) wäre vermeidbar — gemeinsames Gleis ${sharedLabel} ist für beide Linien möglich.`,
  }
}

function resolveHopFromId(network: NetworkExport, leg: RouteLeg): number {
  const lastEdgeId = leg.edgeIds[leg.edgeIds.length - 1]
  if (lastEdgeId) {
    const parsed = parseEdgeEndpoints(lastEdgeId)
    if (parsed) return parsed.fromId
  }
  if (leg.stops.length >= 2) {
    const name = leg.stops[leg.stops.length - 2]
    return network.routing_nodes.find((node) => node.name === name)?.id ?? leg.fromStationId
  }
  return leg.fromStationId
}

function resolveHopToId(network: NetworkExport, leg: RouteLeg): number {
  const firstEdgeId = leg.edgeIds[0]
  if (firstEdgeId) {
    const parsed = parseEdgeEndpoints(firstEdgeId)
    if (parsed) return parsed.toId
  }
  if (leg.stops.length >= 2) {
    const name = leg.stops[1]
    return network.routing_nodes.find((node) => node.name === name)?.id ?? leg.toStationId
  }
  return leg.toStationId
}

function parseEdgeEndpoints(edgeId: string): { fromId: number; toId: number } | null {
  const isReverse = edgeId.endsWith('|rev')
  const base = isReverse ? edgeId.slice(0, -4) : edgeId
  const match = base.match(/:(\d+)>(\d+)$/)
  if (!match) return null
  const exportedFrom = Number(match[1])
  const exportedTo = Number(match[2])
  return isReverse
    ? { fromId: exportedTo, toId: exportedFrom }
    : { fromId: exportedFrom, toId: exportedTo }
}

export function analyzeRouteAccessibility(
  network: NetworkExport,
  route: RouteResult,
  options: {
    requested: boolean
    zeroChangeRouteExists: boolean
    zeroChangeWithoutStaySeated?: boolean
  },
): RouteAccessibilityReport {
  const index = buildRoutingPlatformIndex(network)
  const transfers: TransferAccessibilityDetail[] = []

  for (let i = 0; i < route.legs.length - 1; i++) {
    const arrivalLeg = route.legs[i]!
    const departureLeg = route.legs[i + 1]!
    const tracks = getTransferTracks(network, arrivalLeg, departureLeg)
    const explanation = explainTransfer(
      index,
      network,
      arrivalLeg,
      departureLeg,
      tracks.arrivalTrack,
      tracks.departureTrack,
    )

    transfers.push({
      stationId: arrivalLeg.toStationId,
      stationName: arrivalLeg.toStationName,
      arrivalLineName: arrivalLeg.lineName,
      departureLineName: departureLeg.lineName,
      arrivalTrack: tracks.arrivalTrack,
      departureTrack: tracks.departureTrack,
      ...explanation,
    })
  }

  const platformChangeCount = transfers.filter((transfer) => !transfer.samePlatform).length
  const fullySamePlatform = platformChangeCount === 0
  const usesStaySeated = routeUsesStaySeatedTransfer(route)
  const zeroChangeWithoutStaySeated = options.zeroChangeWithoutStaySeated ?? false

  let summary: string
  if (!options.requested) {
    summary = ''
  } else if (fullySamePlatform && usesStaySeated) {
    summary =
      'Ohne Gleiswechsel — dafür auf der Linie durch den Umstiegsbahnhof fahren und dort sitzenbleiben, bis die Rückfahrt am selben Gleis ankommt.'
  } else if (fullySamePlatform) {
    summary = 'Durchgehend ohne Gleiswechsel — alle Umstiege nutzen dasselbe Gleis.'
  } else if (!options.zeroChangeRouteExists) {
    summary = `Keine komplett gleiswechselfreie Verbindung gefunden. Mindestens ${platformChangeCount} Gleiswechsel ${platformChangeCount === 1 ? 'ist' : 'sind'} nötig.`
  } else if (zeroChangeWithoutStaySeated) {
    summary = `${platformChangeCount} Gleiswechsel auf dieser Route — unter „Alternative Verbindungen“ gibt es eine gleiswechselfreie Variante über andere Linien.`
  } else {
    summary = `${platformChangeCount} Gleiswechsel auf dieser Route — gleiswechselfrei nur mit Sitzenbleiben (siehe Alternative).`
  }

  return {
    requested: options.requested,
    fullySamePlatform,
    zeroChangeRouteExists: options.zeroChangeRouteExists,
    zeroChangeWithoutStaySeated,
    usesStaySeated,
    platformChangeCount,
    summary,
    transfers,
  }
}

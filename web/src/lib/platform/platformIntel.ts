import type { LineStop, NetworkExport, Segment } from '../../types/network'
import { resolveHopPlatforms } from './routingPlatforms'

export interface StopPlatformInfo {
  trackDisplay: string | null
  platformDisplay: string | null
  trackNumber: number | null
  platformNumber: number | null
  terminalNumber: number | null
  towardsName: string | null
  isNative: boolean
}

export interface DepartureTrackInfo {
  trackDisplay: string
  platformDisplay: string | null
  towardsName: string | null
}

type ExportStop = LineStop & {
  track_display?: string
  platform_display?: string
  track_number?: number
  platform_number?: number
  terminal_number?: number
  towards_station_group_name?: string
  track_resolution_status?: string
  platform_resolution_status?: string
}

type ExportSegment = Segment & {
  from_platform_display?: string
  to_platform_display?: string
  from_track?: number
  to_track?: number
  from_terminal?: number
  to_terminal?: number
}

function readStopPlatform(stop: ExportStop): StopPlatformInfo {
  const native =
    stop.track_resolution_status === 'native_track' ||
    stop.platform_resolution_status === 'native_platform'

  return {
    trackDisplay: stop.track_display ?? stop.platform_display ?? null,
    platformDisplay: stop.platform_display ?? null,
    trackNumber: stop.track_number ?? stop.track ?? null,
    platformNumber: stop.platform_number ?? stop.platform ?? null,
    terminalNumber: stop.terminal_number ?? stop.terminal ?? null,
    towardsName: stop.towards_station_group_name ?? null,
    isNative: native,
  }
}

export function buildStopPlatformIndex(
  network: NetworkExport,
): Map<string, StopPlatformInfo> {
  const index = new Map<string, StopPlatformInfo>()

  for (const line of network.lines) {
    for (const raw of line.stops ?? []) {
      const stop = raw as ExportStop
      index.set(`${line.id}:${stop.station_group_id}:${stop.index}`, readStopPlatform(stop))
      index.set(`${line.id}:${stop.station_group_id}`, readStopPlatform(stop))
    }
  }

  return index
}

export function buildDepartureTrackIndex(
  network: NetworkExport,
): Map<string, DepartureTrackInfo> {
  const index = new Map<string, DepartureTrackInfo>()
  const stopIndex = buildStopPlatformIndex(network)

  for (const seg of network.segments as ExportSegment[]) {
    const key = `${seg.line_id}:${seg.from_station_group_id}:${seg.to_station_group_id}`
    const fromDisplay =
      seg.from_platform_display ??
      (seg.from_track != null ? `Gleis ${seg.from_track + 1}` : null)

    if (!fromDisplay) continue

    index.set(key, {
      trackDisplay: fromDisplay,
      platformDisplay: seg.from_platform_display ?? null,
      towardsName: seg.to_station_group_name,
    })
  }

  for (const edge of network.routing_edges) {
    const key = `${edge.line_id}:${edge.from}:${edge.to}`
    if (index.has(key)) continue

    const stopInfo = stopIndex.get(`${edge.line_id}:${edge.from}`)
    if (stopInfo?.trackDisplay) {
      index.set(key, {
        trackDisplay: stopInfo.trackDisplay,
        platformDisplay: stopInfo.platformDisplay,
        towardsName: edge.to_name,
      })
    }
  }

  return index
}

export function getTransferTracks(
  network: NetworkExport,
  arrivalLeg: {
    lineId: number
    stops: string[]
    fromStationId: number
    toStationId: number
    edgeIds?: string[]
  },
  departureLeg: {
    lineId: number
    stops: string[]
    fromStationId: number
    toStationId: number
    edgeIds?: string[]
  },
): {
  arrivalTrack: string | null
  departureTrack: string | null
  arrivalFrom: string | null
  departureTo: string | null
} {
  const depIndex = buildDepartureTrackIndex(network)
  const stopIndex = buildStopPlatformIndex(network)

  const arrivalHop = resolveLegHop(
    network,
    arrivalLeg,
    arrivalLeg.edgeIds?.[arrivalLeg.edgeIds.length - 1],
    'last',
  )
  const departureHop = resolveLegHop(network, departureLeg, departureLeg.edgeIds?.[0], 'first')

  const arrivalSeg = findLineSegment(
    network,
    arrivalLeg.lineId,
    arrivalHop.fromId,
    arrivalHop.toId,
  )
  const departSeg = findLineSegment(
    network,
    departureLeg.lineId,
    departureHop.fromId,
    departureHop.toId,
  )

  const arrivalPlatforms = resolveHopPlatforms(
    network,
    arrivalLeg.lineId,
    arrivalHop.fromId,
    arrivalHop.toId,
  )
  const departPlatforms = resolveHopPlatforms(
    network,
    departureLeg.lineId,
    departureHop.fromId,
    departureHop.toId,
  )

  return {
    arrivalTrack:
      arrivalPlatforms.alighting ??
      resolveTrackAtStation(
        arrivalSeg,
        arrivalHop.toId,
        depIndex,
        stopIndex,
        arrivalLeg.lineId,
        arrivalHop.fromId,
        arrivalHop.toId,
      ),
    departureTrack:
      departPlatforms.boarding ??
      resolveTrackAtStation(
        departSeg,
        departureHop.fromId,
        depIndex,
        stopIndex,
        departureLeg.lineId,
        departureHop.fromId,
        departureHop.toId,
      ),
    arrivalFrom: arrivalHop.fromName ?? arrivalLeg.stops[arrivalLeg.stops.length - 2] ?? null,
    departureTo: departureHop.toName ?? departureLeg.stops[1] ?? null,
  }
}

function resolveLegHop(
  network: NetworkExport,
  leg: { stops: string[]; fromStationId: number; toStationId: number },
  edgeId: string | undefined,
  which: 'first' | 'last',
): { fromId: number; toId: number; fromName: string | null; toName: string | null } {
  const parsed = edgeId ? parseRoutingEdgeEndpoints(edgeId) : null
  if (parsed) {
    return {
      fromId: parsed.fromId,
      toId: parsed.toId,
      fromName: findStationNameById(network, parsed.fromId),
      toName: findStationNameById(network, parsed.toId),
    }
  }

  if (which === 'last') {
    const fromName = leg.stops.length >= 2 ? leg.stops[leg.stops.length - 2] : null
    return {
      fromId: fromName ? findStationIdByName(network, fromName) : leg.fromStationId,
      toId: leg.toStationId,
      fromName,
      toName: findStationNameById(network, leg.toStationId),
    }
  }

  const toName = leg.stops.length >= 2 ? leg.stops[1] : null
  return {
    fromId: leg.fromStationId,
    toId: toName ? findStationIdByName(network, toName) : leg.toStationId,
    fromName: findStationNameById(network, leg.fromStationId),
    toName,
  }
}

function parseRoutingEdgeEndpoints(edgeId: string): { fromId: number; toId: number } | null {
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

function findLineSegment(
  network: NetworkExport,
  lineId: number,
  fromId: number,
  toId: number,
): ExportSegment | undefined {
  const segments = network.segments as ExportSegment[]
  return (
    segments.find(
      (segment) =>
        segment.line_id === lineId &&
        segment.from_station_group_id === fromId &&
        segment.to_station_group_id === toId,
    ) ??
    segments.find(
      (segment) =>
        segment.line_id === lineId &&
        segment.from_station_group_id === toId &&
        segment.to_station_group_id === fromId,
    )
  )
}

function trackFromIndex(track: number | null | undefined): string | null {
  return track != null ? `Gleis ${track + 1}` : null
}

function trackOnSegmentAtStation(segment: ExportSegment, stationId: number): string | null {
  if (segment.from_station_group_id === stationId) {
    return segment.from_platform_display ?? trackFromIndex(segment.from_track)
  }
  if (segment.to_station_group_id === stationId) {
    return segment.to_platform_display ?? trackFromIndex(segment.to_track)
  }
  return null
}

function resolveTrackAtStation(
  segment: ExportSegment | undefined,
  stationId: number,
  depIndex: Map<string, DepartureTrackInfo>,
  stopIndex: Map<string, StopPlatformInfo>,
  lineId: number,
  hopFromId: number,
  hopToId: number,
): string | null {
  return (
    (segment ? trackOnSegmentAtStation(segment, stationId) : null) ??
    getDepartureTrack(depIndex, lineId, hopFromId, hopToId)?.trackDisplay ??
    getDepartureTrack(depIndex, lineId, hopToId, hopFromId)?.trackDisplay ??
    stopIndex.get(`${lineId}:${stationId}`)?.trackDisplay ??
    null
  )
}

function findStationIdByName(network: NetworkExport, name: string): number {
  const node = network.routing_nodes.find((n) => n.name === name)
  return node?.id ?? 0
}

function findStationNameById(network: NetworkExport, id: number): string | null {
  return network.routing_nodes.find((n) => n.id === id)?.name ?? null
}

export function getDepartureTrack(
  index: Map<string, DepartureTrackInfo>,
  lineId: number,
  fromId: number,
  toId: number,
): DepartureTrackInfo | null {
  return index.get(`${lineId}:${fromId}:${toId}`) ?? null
}

export function getStationPlatformBoard(
  network: NetworkExport,
  stationGroupId: number,
): Array<StopPlatformInfo & { lineName: string; lineColor: string; lineId: number }> {
  const rows: Array<
    StopPlatformInfo & { lineName: string; lineColor: string; lineId: number }
  > = []

  for (const line of network.lines) {
    const stops = (line.stops ?? []) as ExportStop[]
    const stop = stops.find((s) => s.station_group_id === stationGroupId)
    if (!stop) continue

    rows.push({
      ...readStopPlatform(stop),
      lineName: line.name,
      lineColor: line.display_color?.hex ?? '#3B82F6',
      lineId: line.id,
    })
  }

  return rows.sort((a, b) => a.lineName.localeCompare(b.lineName, 'de'))
}

export function countNativePlatforms(network: NetworkExport): {
  total: number
  native: number
} {
  let total = 0
  let native = 0

  for (const line of network.lines) {
    for (const raw of line.stops ?? []) {
      total++
      const stop = raw as ExportStop
      if (
        stop.track_resolution_status === 'native_track' ||
        stop.platform_resolution_status === 'native_platform'
      ) {
        native++
      }
    }
  }

  return { total, native }
}

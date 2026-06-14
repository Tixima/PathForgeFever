import type { NetworkExport, Segment } from '../../types/network'
import {
  buildDepartureTrackIndex,
  buildStopPlatformIndex,
  type StopPlatformInfo,
} from '../platform/platformIntel'
import { buildLineTerminusMap } from '../network/lineTerminus'
import { buildStationLineDirectionsIndex } from './stationLineDirections'

export interface TrackDeparture {
  lineId: number
  lineName: string
  lineShort: string
  lineColor: string
  nextStop: string
  nextStopId: number
  prevStop: string | null
  terminusFrom: string
  terminusTo: string
  towardsLabel: string
  isNative: boolean
}

export interface StationTrackLane {
  id: string
  /** 1-basiert wie im TF2-Terminal-Tab */
  terminalNumber: number | null
  trackLabel: string
  platformLabel: string | null
  isNative: boolean
  departures: TrackDeparture[]
}

export interface StationTrackViewData {
  stationName: string
  lanes: StationTrackLane[]
  unassigned: TrackDeparture[]
  maxTerminalNumber: number | null
}

function lineShort(name: string): string {
  return name.replace(/^Linie\s*/i, '').trim() || name
}

function trackLabelFromIndex(trackIndex0: number | null | undefined): string | null {
  if (trackIndex0 == null || Number.isNaN(trackIndex0)) return null
  return `Gleis ${trackIndex0 + 1}`
}

function terminalDisplayFromSegment(segment: Segment | undefined): number | null {
  if (!segment || segment.from_terminal == null) return null
  return segment.from_terminal + 1
}

function findDepartSegment(
  network: NetworkExport,
  lineId: number,
  fromId: number,
  toId: number,
): Segment | undefined {
  return network.segments.find(
    (segment) =>
      segment.line_id === lineId &&
      segment.from_station_group_id === fromId &&
      segment.to_station_group_id === toId,
  )
}

function findStopForDeparture(
  network: NetworkExport,
  lineId: number,
  stationId: number,
  nextStopId: number,
) {
  const line = network.lines.find((l) => l.id === lineId)
  const stops = line?.stops ?? []
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]
    if (stop.station_group_id !== stationId) continue
    const next = stops[i + 1]
    if (next?.station_group_id === nextStopId) return stop
  }
  return stops.find((stop) => stop.station_group_id === stationId)
}

function resolveLaneMeta(
  segment: Segment | undefined,
  stopInfo: StopPlatformInfo | undefined,
  trackFallback: { trackDisplay: string; platformDisplay: string | null } | null,
): {
  terminalNumber: number | null
  trackLabel: string
  platformLabel: string | null
  laneKey: string
  sortTerminal: number
  sortTrack: number
} {
  const terminalFromSegment = terminalDisplayFromSegment(segment)
  const terminalFromStop =
    stopInfo?.terminalNumber != null ? stopInfo.terminalNumber : null
  const terminalNumber = terminalFromSegment ?? terminalFromStop

  const trackFromSegment =
    segment?.from_platform_display ??
    trackLabelFromIndex(segment?.from_track) ??
    null
  const trackLabel =
    trackFromSegment ??
    trackFallback?.trackDisplay ??
    stopInfo?.trackDisplay ??
    (stopInfo?.trackNumber != null ? trackLabelFromIndex(stopInfo.trackNumber) : null) ??
    '—'

  const platformLabel =
    segment?.from_platform_display ??
    trackFallback?.platformDisplay ??
    stopInfo?.platformDisplay ??
    null

  const sortTerminal = terminalNumber ?? 9999
  const trackMatch = trackLabel.match(/(\d+)/)
  const sortTrack = trackMatch ? Number(trackMatch[1]) : 9999
  const laneKey =
    terminalNumber != null
      ? `terminal:${terminalNumber}`
      : trackLabel !== '—'
        ? `track:${trackLabel}`
        : 'unknown'

  return {
    terminalNumber,
    trackLabel,
    platformLabel,
    laneKey,
    sortTerminal,
    sortTrack,
  }
}

export function buildStationTrackView(
  network: NetworkExport,
  stationGroupId: number,
): StationTrackViewData {
  const station = network.routing_nodes.find((n) => n.id === stationGroupId)
  const trackIndex = buildDepartureTrackIndex(network)
  const stopIndex = buildStopPlatformIndex(network)
  const directions = buildStationLineDirectionsIndex(network).get(stationGroupId) ?? []
  const termini = buildLineTerminusMap(network)

  const departures: Array<TrackDeparture & { laneKey: string; sortTerminal: number; sortTrack: number; trackLabel: string; platformLabel: string | null; terminalNumber: number | null }> = []
  const seen = new Set<string>()

  for (const edge of network.routing_edges) {
    if (edge.from !== stationGroupId) continue
    const dedupeKey = `${edge.line_id}:${edge.to}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    const line = network.lines.find((l) => l.id === edge.line_id)
    const color = line?.display_color?.hex ?? '#3B82F6'
    const term = termini.get(edge.line_id)
    const segment = findDepartSegment(network, edge.line_id, edge.from, edge.to)
    const track = trackIndex.get(`${edge.line_id}:${edge.from}:${edge.to}`)
    const stop = findStopForDeparture(network, edge.line_id, stationGroupId, edge.to)
    const stopKey = stop ? `${edge.line_id}:${stationGroupId}:${stop.index}` : `${edge.line_id}:${stationGroupId}`
    const stopInfo = stopIndex.get(stopKey) ?? stopIndex.get(`${edge.line_id}:${stationGroupId}`)

    const dirEntry =
      directions.find((d) => d.lineId === edge.line_id && d.nextStop === edge.to_name) ??
      directions.find((d) => d.lineId === edge.line_id)

    const laneMeta = resolveLaneMeta(
      segment,
      stopInfo,
      track
        ? { trackDisplay: track.trackDisplay, platformDisplay: track.platformDisplay }
        : null,
    )

    departures.push({
      lineId: edge.line_id,
      lineName: edge.line_name,
      lineShort: lineShort(edge.line_name),
      lineColor: color,
      nextStop: edge.to_name,
      nextStopId: edge.to,
      prevStop: dirEntry?.prevStop ?? null,
      terminusFrom: term?.terminusFrom ?? '?',
      terminusTo: term?.terminusTo ?? '?',
      towardsLabel: track?.towardsName ?? edge.to_name,
      isNative: stopInfo?.isNative ?? Boolean(segment?.from_platform_display),
      laneKey: laneMeta.laneKey,
      sortTerminal: laneMeta.sortTerminal,
      sortTrack: laneMeta.sortTrack,
      trackLabel: laneMeta.trackLabel,
      platformLabel: laneMeta.platformLabel,
      terminalNumber: laneMeta.terminalNumber,
    })
  }

  const laneMap = new Map<string, StationTrackLane>()
  const unassigned: TrackDeparture[] = []

  for (const dep of departures) {
    const { laneKey, sortTerminal, sortTrack, trackLabel, platformLabel, terminalNumber, ...service } = dep

    if (laneKey === 'unknown' || trackLabel === '—') {
      unassigned.push(service)
      continue
    }

    let lane = laneMap.get(laneKey)
    if (!lane) {
      lane = {
        id: laneKey,
        terminalNumber,
        trackLabel,
        platformLabel,
        isNative: service.isNative,
        departures: [],
      }
      laneMap.set(laneKey, lane)
    }

    lane.departures.push(service)
    if (service.isNative) lane.isNative = true
    if (!lane.platformLabel && platformLabel) lane.platformLabel = platformLabel
    if (lane.terminalNumber == null && terminalNumber != null) lane.terminalNumber = terminalNumber

    laneMap.set(laneKey, lane)
  }

  for (const lane of laneMap.values()) {
    lane.departures.sort((a, b) => a.lineName.localeCompare(b.lineName, 'de'))
  }

  const lanes = [...laneMap.values()].sort((a, b) => {
    const ta = a.terminalNumber ?? 9999
    const tb = b.terminalNumber ?? 9999
    if (ta !== tb) return ta - tb
    const ma = a.trackLabel.match(/(\d+)/)
    const mb = b.trackLabel.match(/(\d+)/)
    return (ma ? Number(ma[1]) : 9999) - (mb ? Number(mb[1]) : 9999)
  })

  const maxTerminalNumber = lanes.reduce<number | null>((max, lane) => {
    if (lane.terminalNumber == null) return max
    return max == null ? lane.terminalNumber : Math.max(max, lane.terminalNumber)
  }, null)

  return {
    stationName: station?.name ?? '',
    lanes,
    unassigned,
    maxTerminalNumber,
  }
}

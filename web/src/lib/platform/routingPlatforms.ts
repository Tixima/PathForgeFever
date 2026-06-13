import type { NetworkExport } from '../../types/network'

export interface RoutingPlatformIndex {
  boarding: Map<string, string>
  alighting: Map<string, string>
}

function hopKey(lineId: number, fromId: number, toId: number): string {
  return `${lineId}:${fromId}:${toId}`
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

export function buildRoutingPlatformIndex(network: NetworkExport): RoutingPlatformIndex {
  const boarding = new Map<string, string>()
  const alighting = new Map<string, string>()

  for (const segment of network.segments as ExportSegment[]) {
    const forwardKey = hopKey(segment.line_id, segment.from_station_group_id, segment.to_station_group_id)
    const boardForward =
      segment.from_platform_display ?? trackFromIndex(segment.from_track)
    const alightForward =
      segment.to_platform_display ?? trackFromIndex(segment.to_track)

    if (boardForward) boarding.set(forwardKey, boardForward)
    if (alightForward) alighting.set(forwardKey, alightForward)

    const reverseKey = hopKey(segment.line_id, segment.to_station_group_id, segment.from_station_group_id)
    if (alightForward) boarding.set(reverseKey, alightForward)
    if (boardForward) alighting.set(reverseKey, boardForward)
  }

  return { boarding, alighting }
}

export function getBoardingTrack(
  index: RoutingPlatformIndex,
  lineId: number,
  fromId: number,
  toId: number,
): string | null {
  return index.boarding.get(hopKey(lineId, fromId, toId)) ?? null
}

export function getAlightingTrack(
  index: RoutingPlatformIndex,
  lineId: number,
  fromId: number,
  toId: number,
): string | null {
  return index.alighting.get(hopKey(lineId, fromId, toId)) ?? null
}

export function resolveHopPlatforms(
  network: NetworkExport,
  lineId: number,
  fromId: number,
  toId: number,
): { boarding: string | null; alighting: string | null } {
  const segments = network.segments as ExportSegment[]
  const forward = segments.find(
    (segment) =>
      segment.line_id === lineId &&
      segment.from_station_group_id === fromId &&
      segment.to_station_group_id === toId,
  )
  if (forward) {
    return {
      boarding:
        forward.from_platform_display ?? trackFromIndex(forward.from_track),
      alighting: forward.to_platform_display ?? trackFromIndex(forward.to_track),
    }
  }

  const reverse = segments.find(
    (segment) =>
      segment.line_id === lineId &&
      segment.from_station_group_id === toId &&
      segment.to_station_group_id === fromId,
  )
  if (reverse) {
    return {
      boarding: reverse.to_platform_display ?? trackFromIndex(reverse.to_track),
      alighting:
        reverse.from_platform_display ?? trackFromIndex(reverse.from_track),
    }
  }

  return { boarding: null, alighting: null }
}

export function platformChangePenalty(alight: string | null, board: string | null): number {
  if (alight && board) {
    return alight === board ? 0 : PLATFORM_CHANGE_PENALTY
  }
  return UNKNOWN_PLATFORM_PENALTY
}

/** Strafe pro Gleiswechsel beim Umstieg — höher als Umwege in Minuten. */
export const PLATFORM_CHANGE_PENALTY = 2_000_000

/** Unbekanntes Gleis — vorsichtig bestrafen, aber weniger als sicherer Wechsel. */
export const UNKNOWN_PLATFORM_PENALTY = 750_000

import type { RouteCriterion, RouteLeg, RouteResult } from './types'

function mergeLegsAtJunction(prevLeg: RouteLeg, nextLeg: RouteLeg): RouteLeg | null {
  if (prevLeg.lineId !== nextLeg.lineId) return null
  if (prevLeg.toStationId !== nextLeg.fromStationId) return null

  return {
    ...prevLeg,
    toStationId: nextLeg.toStationId,
    toStationName: nextLeg.toStationName,
    stops: [...prevLeg.stops, ...nextLeg.stops.slice(1)],
    edgeIds: [...prevLeg.edgeIds, ...nextLeg.edgeIds],
    durationSeconds: prevLeg.durationSeconds + nextLeg.durationSeconds,
    distanceMeters: prevLeg.distanceMeters + nextLeg.distanceMeters,
    edgeCount: prevLeg.edgeCount + nextLeg.edgeCount,
  }
}

export function mergeRouteResults(
  segments: RouteResult[],
  criterion: RouteCriterion,
  transferTimes: Map<number, number>,
  extraTags: string[] = [],
  viaStationIds: number[] = [],
): RouteResult {
  if (segments.length === 1) {
    return {
      ...segments[0],
      tags: [...segments[0].tags, ...extraTags],
      viaStationIds,
    }
  }

  const legs: RouteLeg[] = []
  let junctionTransferSeconds = 0
  let junctionTransfers = 0

  for (let s = 0; s < segments.length; s++) {
    const segment = segments[s]
    let segLegs = [...segment.legs]

    if (s > 0 && legs.length > 0 && segLegs.length > 0) {
      const merged = mergeLegsAtJunction(legs[legs.length - 1], segLegs[0])
      if (merged) {
        legs[legs.length - 1] = merged
        segLegs = segLegs.slice(1)
      } else {
        const viaStationId = segLegs[0].fromStationId
        const transferSeconds = transferTimes.get(viaStationId) ?? 240
        junctionTransfers += 1
        junctionTransferSeconds += transferSeconds
        legs[legs.length - 1].durationSeconds += transferSeconds
      }
    }

    legs.push(...segLegs)
  }

  const stationNames: string[] = [segments[0].stationNames[0]]
  const stationIds: number[] = [segments[0].stationIds[0]]

  for (const segment of segments) {
    for (let i = 1; i < segment.stationNames.length; i++) {
      if (stationNames[stationNames.length - 1] !== segment.stationNames[i]) {
        stationNames.push(segment.stationNames[i])
        stationIds.push(segment.stationIds[i])
      }
    }
  }

  const edgeIds = segments.flatMap((s) => s.edgeIds)
  const totalDurationSeconds =
    segments.reduce((sum, s) => sum + s.totalDurationSeconds, 0) + junctionTransferSeconds
  const totalDistanceMeters = segments.reduce((sum, s) => sum + s.totalDistanceMeters, 0)
  const transferCount =
    segments.reduce((sum, s) => sum + s.transferCount, 0) + junctionTransfers

  const label =
    viaStationIds.length > 0
      ? `Über ${viaStationIds.length} Zwischenhalt${viaStationIds.length > 1 ? 'e' : ''}`
      : segments[0].label

  return {
    id: stationNames.join('>'),
    criterion,
    label,
    tags: [...new Set(segments.flatMap((s) => s.tags)), ...extraTags, ...(viaStationIds.length ? ['via'] : [])],
    legs,
    edgeIds,
    stationIds,
    totalDurationSeconds,
    totalDistanceMeters,
    transferCount,
    stopCount: stationNames.length - 1,
    stationNames,
    viaStationIds,
    isDirect: transferCount === 0 && legs.length === 1,
    isExperimental: true,
  }
}

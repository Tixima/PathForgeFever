import type { NetworkExport } from '../../types/network'
import type { RouteCriterion } from '../routing/types'
import { findAllRoutesFromStation } from '../routing/pathfinder'
import type { ScaleSettings } from '../scale'
import { getScaledRouteValues } from '../scale'
import { formatDuration } from '../format'

const BUCKET_BASE_MINUTES = [5, 15, 30, 60] as const
const BUCKET_COLORS = ['#22C55E', '#84CC16', '#EAB308', '#F97316', '#EF4444'] as const

/** Realzeit-Isochronen: Schwellen ×10 (50 Min … 10 Std statt 5 … 60 Min). */
const REALTIME_BUCKET_FACTOR = 10

export interface IsochroneBucket {
  maxSeconds: number
  label: string
  color: string
}

export function getIsochroneBuckets(scale: ScaleSettings): IsochroneBucket[] {
  const factor = scale.showGameValues ? 1 : REALTIME_BUCKET_FACTOR
  const thresholds = BUCKET_BASE_MINUTES.map((minutes) => minutes * factor * 60)

  const buckets: IsochroneBucket[] = thresholds.map((maxSeconds, index) => ({
    maxSeconds,
    label: `≤ ${formatDuration(maxSeconds)}`,
    color: BUCKET_COLORS[index],
  }))

  const lastThreshold = thresholds[thresholds.length - 1]!
  buckets.push({
    maxSeconds: Infinity,
    label: `> ${formatDuration(lastThreshold)}`,
    color: BUCKET_COLORS[BUCKET_COLORS.length - 1],
  })

  return buckets
}

export interface StationIsochrone {
  stationId: number
  stationName: string
  durationSeconds: number
  bucketIndex: number
  bucket: IsochroneBucket
}

function findBucketIndex(durationSeconds: number, buckets: IsochroneBucket[]): number {
  const index = buckets.findIndex((bucket) => durationSeconds <= bucket.maxSeconds)
  return index >= 0 ? index : buckets.length - 1
}

export function buildIsochroneData(
  network: NetworkExport,
  originId: number,
  criterion: RouteCriterion,
  scale: ScaleSettings,
): StationIsochrone[] {
  const buckets = getIsochroneBuckets(scale)
  const routes = findAllRoutesFromStation(network, originId, criterion)
  const originName = network.routing_nodes.find((n) => n.id === originId)?.name ?? '?'

  const results: StationIsochrone[] = [
    {
      stationId: originId,
      stationName: originName,
      durationSeconds: 0,
      bucketIndex: 0,
      bucket: buckets[0]!,
    },
  ]

  for (const route of routes) {
    const destId = route.stationIds[route.stationIds.length - 1]!
    const destName = route.stationNames[route.stationNames.length - 1]!
    const scaled = getScaledRouteValues(route.totalDurationSeconds, route.totalDistanceMeters, scale)
    const bucketIndex = findBucketIndex(scaled.durationSeconds, buckets)

    results.push({
      stationId: destId,
      stationName: destName,
      durationSeconds: scaled.durationSeconds,
      bucketIndex,
      bucket: buckets[bucketIndex]!,
    })
  }

  return results
}

export function countByBucket(data: StationIsochrone[]): Record<number, number> {
  const counts: Record<number, number> = {}
  for (const item of data) {
    counts[item.bucketIndex] = (counts[item.bucketIndex] ?? 0) + 1
  }
  return counts
}

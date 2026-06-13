import type { ScaleSettings } from './scale'
import { getScaledRouteValues } from './scale'

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60

  if (hours > 0) {
    return `${hours} Std ${minutes} Min`
  }
  if (minutes > 0 && secs > 0) {
    return `${minutes} Min ${secs} Sek`
  }
  if (minutes > 0) {
    return `${minutes} Min`
  }
  return `${secs} Sek`
}

export function formatDurationCompact(seconds: number): string {
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.ceil((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes} Min`
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`
  }
  return `${Math.round(meters)} m`
}

export function formatDistanceKm(km: number): string {
  if (km >= 1) {
    return `${km.toFixed(1)} km`
  }
  return `${Math.round(km * 1000)} m`
}

export function formatTimestamp(unix: number): string {
  return new Date(unix * 1000).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatArrivalTime(durationSeconds: number): string {
  const arrival = new Date(Date.now() + durationSeconds * 1000)
  return arrival.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

export function formatDelta(seconds: number): string {
  if (seconds <= 0) return 'Schnellste'
  const minutes = Math.ceil(seconds / 60)
  return `+${minutes} Min`
}

export function formatRouteStats(
  durationSeconds: number,
  distanceMeters: number,
  scale: ScaleSettings,
): { duration: string; distance: string; label: string } {
  const scaled = getScaledRouteValues(durationSeconds, distanceMeters, scale)
  return {
    duration: formatDuration(scaled.durationSeconds),
    distance: formatDistance(scaled.distanceMeters),
    label: scaled.isScaled ? 'Realzeit' : 'Spielwerte',
  }
}

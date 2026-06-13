import type { RouteResult } from './types'

/** Strafe pro erneutem Halt auf derselben Linie (Ping-Pong) — höher als typische Umwege. */
export const STAY_SEATED_REVISIT_PENALTY = 4_000_000

/** Halte-Indizes, an denen der Zug den Umstiegsbahnhof nur durchfährt (Ping-Pong / Rücktour). */
export function getStaySeatedStopIndices(
  stops: string[],
  alightStationName: string,
): number[] {
  const matching: number[] = []
  for (let i = 0; i < stops.length; i++) {
    if (stops[i] === alightStationName) matching.push(i)
  }
  if (matching.length <= 1) return []
  return matching.slice(0, -1)
}

export function buildStaySeatedHint(stationName: string, priorPassCount: number): string | null {
  if (priorPassCount <= 0) return null
  if (priorPassCount === 1) {
    return `Die Linie durchfährt ${stationName} und fährt weiter — hier sitzenbleiben. Erst beim nächsten Halt in ${stationName} aussteigen und umsteigen.`
  }
  return `Die Linie hält ${priorPassCount + 1}× in ${stationName} — bis zum letzten Halt dort sitzenbleiben, dann umsteigen.`
}

export function routeUsesStaySeatedTransfer(route: RouteResult): boolean {
  for (let i = 0; i < route.legs.length - 1; i++) {
    const leg = route.legs[i]!
    if (getStaySeatedStopIndices(leg.stops, leg.toStationName).length > 0) return true
  }
  return false
}

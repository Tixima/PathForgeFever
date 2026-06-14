import type { LineDirectionAtStop } from './stationLineDirections'

export interface HubDirectionFilterOptions {
  /** Linie, auf der der Nutzer gerade fährt — gleiche Richtung wird ausgeblendet. */
  currentLineId?: number
  legStops?: string[]
  stopIndex?: number
  /** Zusätzlich ausblenden (z. B. Ankunfts- und Abfahrtslinie beim Umstieg). */
  excludeLineIds?: number[]
}

/**
 * Filtert Linien am Umsteigebahnhof: die eigene Linie in Fahrtrichtung ist redundant.
 * Alternative Richtungen derselben Linie (Ring, Wendepunkt) bleiben sichtbar.
 */
export function filterTransferLineDirections(
  directions: LineDirectionAtStop[],
  options: HubDirectionFilterOptions,
): LineDirectionAtStop[] {
  const { currentLineId, legStops, stopIndex, excludeLineIds = [] } = options
  const exclude = new Set(excludeLineIds)

  const nextOnLeg =
    legStops && stopIndex != null && stopIndex < legStops.length - 1
      ? legStops[stopIndex + 1]
      : null

  return directions.filter((d) => {
    if (exclude.has(d.lineId)) return false

    if (currentLineId == null || d.lineId !== currentLineId) return true

    if (nextOnLeg && d.nextStop === nextOnLeg) return false
    if (nextOnLeg && d.nextStop && d.nextStop !== nextOnLeg) return true

    return false
  })
}

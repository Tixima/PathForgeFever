import type { DisplayColor } from '../../types/network'
import type { LineDirectionAtStop } from '../station/stationLineDirections'

export type RouteCriterion =
  | 'fastest'
  | 'shortest'
  | 'fewest_transfers'
  | 'fewest_stops'

export interface RouteCriterionOption {
  id: RouteCriterion
  label: string
  description: string
  icon: string
}

export const ROUTE_CRITERIA: RouteCriterionOption[] = [
  {
    id: 'fastest',
    label: 'Kürzeste Zeit',
    description: 'Schnellste Ankunft inkl. Umstiegszeiten',
    icon: 'clock',
  },
  {
    id: 'shortest',
    label: 'Kürzeste Distanz',
    description: 'Geringste zurückgelegte Strecke',
    icon: 'route',
  },
  {
    id: 'fewest_transfers',
    label: 'Wenigste Umstiege',
    description: 'Möglichst wenig Linienwechsel',
    icon: 'shuffle',
  },
  {
    id: 'fewest_stops',
    label: 'Wenigste Halte',
    description: 'Minimale Anzahl Zwischenstationen',
    icon: 'map-pin',
  },
]

export const ALL_CRITERIA: RouteCriterion[] = [
  'fastest',
  'shortest',
  'fewest_transfers',
  'fewest_stops',
]

/** Intern für Komplexitäts-Suche — max. Umstiege/Halte bei gültigem Pfad */
export type ExtendedRouteCriterion = RouteCriterion | 'most_complex'

export interface RouteLeg {
  lineId: number
  lineName: string
  lineColor: string
  fromStationId: number
  fromStationName: string
  toStationId: number
  toStationName: string
  stops: string[]
  edgeIds: string[]
  durationSeconds: number
  distanceMeters: number
  edgeCount: number
}

export interface RouteResult {
  id: string
  criterion: RouteCriterion
  label: string
  tags: string[]
  legs: RouteLeg[]
  edgeIds: string[]
  stationIds: number[]
  viaStationIds?: number[]
  totalDurationSeconds: number
  totalDistanceMeters: number
  transferCount: number
  stopCount: number
  stationNames: string[]
  isDirect: boolean
  isExperimental: boolean
  deltaSeconds?: number
  accessibility?: import('../platform/accessibleRouting').RouteAccessibilityReport
}

export interface StationLineTerminus {
  lineId: number
  lineName: string
  lineColor: string
  terminusFrom: string
  terminusTo: string
}

export interface StationOption {
  id: number
  name: string
  interchange: boolean
  lineNames: string[]
  lineColors: string[]
  /** Linien mit Endhaltestellen — nur bei Umsteigebahnhöfen */
  hubLines?: StationLineTerminus[]
  /** Alle Linien an der Station mit Nachbar-Halten (beide Richtungen) */
  lineDirections?: LineDirectionAtStop[]
  position?: [number, number, number]
}

export interface LineColorLookup {
  [lineId: number]: DisplayColor | undefined
}

export interface RouteSearchResult {
  primary: RouteResult
  alternatives: RouteResult[]
  allRoutes: RouteResult[]
}

/** Zusatzoptionen zur Routensuche (unabhängig vom Kriterium). */
export interface RouteSearchOptions {
  /** Minimiert Gleiswechsel beim Umstieg — auch mit Umwegen. */
  accessible?: boolean
  /** Nur gleiswechselfreie Routen — kein Kompromiss mit Gleiswechsel. */
  accessibleStrict?: boolean
}

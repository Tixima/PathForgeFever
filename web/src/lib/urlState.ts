import type { AppView } from '../components/navigation/AppNav'
import type { RouteCriterion } from './routing/types'
import { decodeFrozenRoute, type FrozenRoutePayload } from './routing/routeShareLink'

export type ShareLinkMode = 'frozen' | 'dynamic'

export interface AppUrlState {
  view: AppView
  fromId: number | null
  toId: number | null
  criterion: RouteCriterion
  accessible: boolean
  accessibleStrict: boolean
  stationId: number | null
  shareMode?: ShareLinkMode
  routeToken?: string
  shareId?: string
  frozenRoute?: FrozenRoutePayload
  viaIds?: number[]
}

const VALID_VIEWS: AppView[] = ['planner', 'station', 'lines', 'maps', 'reach', 'insights', 'simulator', 'diagnostics']
const VALID_CRITERIA: RouteCriterion[] = [
  'fastest',
  'shortest',
  'fewest_transfers',
  'fewest_stops',
]

export function parseAppUrlState(search: string): Partial<AppUrlState> {
  const params = new URLSearchParams(search)
  const result: Partial<AppUrlState> = {}

  const view = params.get('view')
  if (view && VALID_VIEWS.includes(view as AppView)) {
    result.view = view as AppView
  }

  const from = params.get('from')
  if (from) {
    const id = Number(from)
    if (!Number.isNaN(id)) result.fromId = id
  }

  const to = params.get('to')
  if (to) {
    const id = Number(to)
    if (!Number.isNaN(id)) result.toId = id
  }

  const criterion = params.get('criterion')
  if (criterion && VALID_CRITERIA.includes(criterion as RouteCriterion)) {
    result.criterion = criterion as RouteCriterion
  }

  const station = params.get('station')
  if (station) {
    const id = Number(station)
    if (!Number.isNaN(id)) result.stationId = id
  }

  if (params.get('accessible') === '1') {
    result.accessible = true
  }

  if (params.get('accessibleStrict') === '1') {
    result.accessibleStrict = true
    result.accessible = true
  }

  const share = params.get('share')
  if (share === 'frozen' || share === 'dynamic') {
    result.shareMode = share
  }

  const routeParam = params.get('route')
  if (routeParam) {
    const frozenRoute = decodeFrozenRoute(routeParam)
    if (frozenRoute) {
      result.frozenRoute = frozenRoute
      result.shareMode = 'frozen'
      result.routeToken = params.get('rid') ?? frozenRoute.rid
      result.shareId = params.get('sid') ?? frozenRoute.sid
    }
  }

  const via = params.get('via')
  if (via) {
    result.viaIds = via
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((id) => !Number.isNaN(id))
  }

  return result
}

export function buildShareUrl(state: {
  fromId?: number
  toId?: number
  criterion?: RouteCriterion
  accessible?: boolean
  accessibleStrict?: boolean
  view?: AppView
  stationId?: number
}): string {
  const params = new URLSearchParams()
  params.set('share', 'dynamic')
  if (state.view && state.view !== 'planner') params.set('view', state.view)
  if (state.fromId) params.set('from', String(state.fromId))
  if (state.toId) params.set('to', String(state.toId))
  if (state.criterion && state.criterion !== 'fastest') params.set('criterion', state.criterion)
  if (state.accessible) params.set('accessible', '1')
  if (state.accessibleStrict) params.set('accessibleStrict', '1')
  if (state.stationId) params.set('station', String(state.stationId))

  const qs = params.toString()
  const base = window.location.origin + window.location.pathname
  return qs ? `${base}?${qs}` : base
}

export function syncUrlState(state: AppUrlState, replace = true): void {
  const params = new URLSearchParams()
  if (state.view !== 'planner') params.set('view', state.view)
  if (state.fromId) params.set('from', String(state.fromId))
  if (state.toId) params.set('to', String(state.toId))
  if (state.criterion !== 'fastest') params.set('criterion', state.criterion)
  if (state.accessible) params.set('accessible', '1')
  if (state.accessibleStrict) params.set('accessibleStrict', '1')
  if (state.stationId && state.view === 'station') params.set('station', String(state.stationId))

  const qs = params.toString()
  const url = qs ? `?${qs}` : window.location.pathname

  if (replace) {
    window.history.replaceState(null, '', url)
  } else {
    window.history.pushState(null, '', url)
  }
}

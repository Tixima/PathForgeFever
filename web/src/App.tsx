import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppNav, type AppView } from './components/navigation/AppNav'
import { InsideBahnhofPanel } from './components/station/InsideBahnhofPanel'
import { LineExplorerPanel } from './components/lines/LineExplorerPanel'
import { ReachabilityPanel } from './components/reach/ReachabilityPanel'
import { NetworkInsightsPanel } from './components/insights/NetworkInsightsPanel'
import { HeroSearch } from './components/HeroSearch'
import { LoadingScreen } from './components/LoadingScreen'
import { NetworkOverview } from './components/NetworkOverview'
import { RouteResults } from './components/RouteResults'
import { ScaleControls } from './components/ScaleControls'
import { NetworkMapsPanel } from './components/maps/NetworkMapsPanel'
import { NetworkBootstrapScreen } from './components/NetworkBootstrapScreen'
import { WhatIfPanel } from './components/simulator/WhatIfPanel'
import { DiagnosticsPanel } from './components/diagnostics/DiagnosticsPanel'
import { useNetwork } from './hooks/useNetwork'
import { useRecentSearches } from './hooks/useRecentSearches'
import { useScaleSettings } from './hooks/useScaleSettings'
import { useFavorites } from './hooks/useFavorites'
import { findRouteAlternatives } from './lib/routing/pathfinder'
import { buildRouteSearchError } from './lib/routing/routeErrors'
import { parseAppUrlState, syncUrlState } from './lib/urlState'
import { BRAND, brandFooter } from './lib/brand'
import {
  buildDynamicShareUrl,
  buildFrozenShareUrl,
  reconstructRouteFromShare,
} from './lib/routing/routeShareLink'
import type { RouteCriterion, RouteResult, StationOption } from './lib/routing/types'

export default function App() {
  const {
    network,
    graph,
    loading,
    reloading,
    importing,
    error: loadError,
    source: networkSource,
    uploadedFileName,
    reload,
    importFile,
    retryFetch,
  } = useNetwork()
  const { settings: scale, update: updateScale, reset: resetScale } = useScaleSettings()
  const { recent, addSearch } = useRecentSearches()
  const { toggleStation, toggleLine, isStationFavorite, isLineFavorite, favorites } = useFavorites()

  const [from, setFrom] = useState<StationOption | null>(null)
  const [to, setTo] = useState<StationOption | null>(null)
  const [vias, setVias] = useState<(StationOption | null)[]>([])
  const [criterion, setCriterion] = useState<RouteCriterion>('fastest')
  const [accessible, setAccessible] = useState(false)
  const [accessibleStrict, setAccessibleStrict] = useState(false)
  const [frozenRouteActive, setFrozenRouteActive] = useState(false)
  const [frozenRouteWarning, setFrozenRouteWarning] = useState<string | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<RouteResult | null>(null)
  const [alternatives, setAlternatives] = useState<RouteResult[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [appView, setAppView] = useState<AppView>('planner')
  const [focusStationId, setFocusStationId] = useState<number | null>(null)

  const stations = graph?.stations ?? []
  const pendingReloadRef = useRef(false)
  const urlAppliedRef = useRef(false)
  const [reloadSuccess, setReloadSuccess] = useState(false)

  const favoriteStations = useMemo(
    () =>
      favorites.stations
        .map((id) => graph?.stationById.get(id))
        .filter((s): s is StationOption => !!s),
    [favorites.stations, graph],
  )

  const shareContext = useMemo(() => {
    if (!from || !to) return null
    const viaIds = vias.filter((v): v is StationOption => v !== null).map((v) => v.id)
    return {
      fromId: from.id,
      toId: to.id,
      viaIds: viaIds.length ? viaIds : undefined,
      criterion,
      accessible,
      accessibleStrict,
    }
  }, [from, to, vias, criterion, accessible, accessibleStrict])

  const frozenShareUrl = useMemo(() => {
    if (!shareContext || !selectedRoute) return undefined
    return buildFrozenShareUrl(selectedRoute, shareContext)
  }, [shareContext, selectedRoute])

  const dynamicShareUrl = useMemo(() => {
    if (!shareContext) return undefined
    return buildDynamicShareUrl(shareContext)
  }, [shareContext])

  const resetSearchAfterNetworkChange = useCallback(() => {
    setSelectedRoute(null)
    setAlternatives([])
    setSearched(false)
    setSearchError(null)
    setSearching(false)
    setFrozenRouteActive(false)
    setFrozenRouteWarning(null)

    setFrom((prev) => {
      if (!prev || !graph?.stationById.has(prev.id)) return null
      return graph.stationById.get(prev.id) ?? null
    })
    setTo((prev) => {
      if (!prev || !graph?.stationById.has(prev.id)) return null
      return graph.stationById.get(prev.id) ?? null
    })
    setVias((prev) =>
      prev.map((via) => {
        if (!via || !graph?.stationById.has(via.id)) return null
        return graph.stationById.get(via.id) ?? null
      }),
    )
  }, [graph])

  useEffect(() => {
    if (reloading) {
      pendingReloadRef.current = true
      return
    }

    if (!network || !pendingReloadRef.current) return

    pendingReloadRef.current = false
    resetSearchAfterNetworkChange()
    setReloadSuccess(true)

    const timer = window.setTimeout(() => setReloadSuccess(false), 2800)
    return () => window.clearTimeout(timer)
  }, [reloading, network, resetSearchAfterNetworkChange])

  const runSearch = useCallback(
    (
      fromStation: StationOption,
      toStation: StationOption,
      viaStations: StationOption[],
      crit: RouteCriterion,
      routeAccessible: boolean,
      routeAccessibleStrict: boolean,
    ) => {
      if (!network) return

      setSearching(true)
      setSearched(true)

      requestAnimationFrame(() => {
        const viaIds = viaStations.map((v) => v.id)
        setFrozenRouteActive(false)
        setFrozenRouteWarning(null)
        const result = findRouteAlternatives(
          network,
          fromStation.id,
          toStation.id,
          crit,
          viaIds,
          {
            accessible: routeAccessible,
            accessibleStrict: routeAccessibleStrict,
          },
        )

        if (!result) {
          setSelectedRoute(null)
          setAlternatives([])
          setSearchError(
            buildRouteSearchError(
              network,
              fromStation.id,
              toStation.id,
              viaStations.map((v) => v.name),
              {
                accessible: routeAccessible,
                accessibleStrict: routeAccessibleStrict,
              },
            ),
          )
        } else {
          setSelectedRoute(result.primary)
          setAlternatives(result.alternatives)
          setSearchError(null)
          addSearch(fromStation.id, fromStation.name, toStation.id, toStation.name)
        }
        setSearching(false)
      })
    },
    [network, addSearch],
  )

  useEffect(() => {
    if (!graph || !network || urlAppliedRef.current) return
    urlAppliedRef.current = true

    const urlState = parseAppUrlState(window.location.search)
    if (urlState.view) setAppView(urlState.view)
    if (urlState.stationId) setFocusStationId(urlState.stationId)
    if (urlState.criterion) setCriterion(urlState.criterion)
    if (urlState.accessible) setAccessible(true)
    if (urlState.accessibleStrict) setAccessibleStrict(true)

    const fromStation = urlState.fromId ? graph.stationById.get(urlState.fromId) : null
    const toStation = urlState.toId ? graph.stationById.get(urlState.toId) : null

    if (fromStation) setFrom(fromStation)
    if (toStation) setTo(toStation)

    if (urlState.frozenRoute && fromStation && toStation) {
      const { route, missingEdgeIds } = reconstructRouteFromShare(network, urlState.frozenRoute)
      if (route) {
        setCriterion(urlState.frozenRoute.criterion)
        setAccessible(urlState.frozenRoute.accessible)
        setAccessibleStrict(urlState.frozenRoute.accessibleStrict)
        setSelectedRoute(route)
        setAlternatives([])
        setSearchError(null)
        setSearched(true)
        setFrozenRouteActive(true)
        setFrozenRouteWarning(
          missingEdgeIds.length > 0
            ? `${missingEdgeIds.length} Teilstrecke(n) fehlen im aktuellen Netz — Route teilweise rekonstruiert.`
            : null,
        )
        return
      }
      setSearchError(
        'Gespeicherte Route konnte nicht wiederhergestellt werden — Teilstrecken fehlen im aktuellen Netzwerk.',
      )
      setSearched(true)
      return
    }

    if (fromStation && toStation && fromStation.id !== toStation.id) {
      runSearch(
        fromStation,
        toStation,
        [],
        urlState.criterion ?? 'fastest',
        urlState.accessible ?? false,
        urlState.accessibleStrict ?? false,
      )
    }
  }, [graph, network, runSearch])

  useEffect(() => {
    if (!graph) return
    syncUrlState({
      view: appView,
      fromId: from?.id ?? null,
      toId: to?.id ?? null,
      criterion,
      accessible,
      accessibleStrict,
      stationId: focusStationId,
    })
  }, [graph, appView, from, to, criterion, accessible, accessibleStrict, focusStationId])

  const handleSwap = useCallback(() => {
    setFrom(to)
    setTo(from)
    setVias([...vias].reverse())
    setSelectedRoute(null)
    setAlternatives([])
    setSearched(false)
    setSearchError(null)
  }, [from, to, vias])

  const handleSearch = useCallback(() => {
    if (!from || !to) return
    if (from.id === to.id) {
      setSearchError('Start und Ziel müssen unterschiedlich sein.')
      setSearched(true)
      return
    }

    const unresolvedVia = vias.find((v) => v === null)
    if (unresolvedVia !== undefined) {
      setSearchError('Bitte alle Über-Bahnhöfe auswählen oder leere entfernen.')
      setSearched(true)
      return
    }

    const viaStations = vias.filter((v): v is StationOption => v !== null)
    const ids = [from.id, ...viaStations.map((v) => v.id), to.id]
    if (new Set(ids).size !== ids.length) {
      setSearchError('Start, Über-Bahnhöfe und Ziel müssen alle unterschiedlich sein.')
      setSearched(true)
      return
    }

    runSearch(from, to, viaStations, criterion, accessible, accessibleStrict)
  }, [from, to, vias, criterion, accessible, accessibleStrict, runSearch])

  const handleQuickPick = useCallback(
    (fromStation: StationOption, toStation: StationOption) => {
      setFrom(fromStation)
      setTo(toStation)
      setVias([])
      runSearch(fromStation, toStation, [], criterion, accessible, accessibleStrict)
    },
    [criterion, accessible, accessibleStrict, runSearch],
  )

  const openStation = useCallback((stationId: number) => {
    setFocusStationId(stationId)
    setAppView('station')
  }, [])

  const handlePlanFrom = useCallback((station: StationOption) => {
    setFrom(station)
    setAppView('planner')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const handlePlanTo = useCallback((station: StationOption) => {
    setTo(station)
    setAppView('planner')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const handlePlanTrip = useCallback(
    (fromStation: StationOption, toStation: StationOption) => {
      setFrom(fromStation)
      setTo(toStation)
      setVias([])
      setAppView('planner')
      runSearch(fromStation, toStation, [], criterion, accessible, accessibleStrict)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [criterion, accessible, accessibleStrict, runSearch],
  )

  const handleSelectRoute = useCallback((route: RouteResult) => {
    setSelectedRoute((current) => {
      if (current && current.id !== route.id) {
        setAlternatives((alts) => {
          const filtered = alts.filter((r) => r.id !== route.id)
          if (!filtered.some((r) => r.id === current.id)) {
            return [current, ...filtered]
          }
          return filtered
        })
      }
      return route
    })
  }, [])

  const loadErrorMessage = loadError

  if (loading) return <LoadingScreen />

  if (loadErrorMessage || !network || !graph) {
    return (
      <NetworkBootstrapScreen
        error={loadErrorMessage}
        importing={importing}
        reloading={reloading}
        onImportFile={importFile}
        onRetryFetch={retryFetch}
      />
    )
  }

  return (
    <div className="app">
      <div className="app__backdrop" aria-hidden />
      <main className="app__main">
        <AppNav view={appView} onChange={setAppView} />

        {appView === 'planner' && (
          <>
            <HeroSearch
              stations={stations}
              from={from}
              to={to}
              vias={vias}
              criterion={criterion}
              accessible={accessible}
              accessibleStrict={accessibleStrict}
              searching={searching}
              recent={recent}
              onFromChange={setFrom}
              onToChange={setTo}
              onViasChange={setVias}
              onCriterionChange={setCriterion}
              onAccessibleChange={setAccessible}
              onAccessibleStrictChange={setAccessibleStrict}
              onSwap={handleSwap}
              onSearch={handleSearch}
              onQuickPick={handleQuickPick}
            />

            <ScaleControls
              settings={scale}
              onChange={updateScale}
              onReset={resetScale}
            />

            <RouteResults
              selectedRoute={selectedRoute}
              alternatives={alternatives}
              fromName={from?.name ?? ''}
              toName={to?.name ?? ''}
              error={searchError}
              searched={searched}
              scale={scale}
              stations={stations}
              network={network}
              boundingBox={network.network_map?.bounding_box}
              onSelectRoute={handleSelectRoute}
              frozenShareUrl={frozenShareUrl}
              dynamicShareUrl={dynamicShareUrl}
              frozenRouteActive={frozenRouteActive}
              frozenRouteWarning={frozenRouteWarning}
            />

          </>
        )}

        {appView === 'maps' && (
          <NetworkMapsPanel
            network={network}
            selectedRoute={selectedRoute}
            onStationPick={(station) => openStation(station.id)}
            variant="tab"
          />
        )}

        {appView === 'station' && (
          <InsideBahnhofPanel
            network={network}
            stations={stations}
            scale={scale}
            focusStationId={focusStationId}
            onFocusStation={setFocusStationId}
            onPlanFrom={handlePlanFrom}
            onPlanTo={handlePlanTo}
            onPlanTrip={handlePlanTrip}
            isStationFavorite={isStationFavorite}
            onToggleStationFavorite={toggleStation}
            favoriteStations={favoriteStations}
          />
        )}

        {appView === 'lines' && (
          <LineExplorerPanel
            network={network}
            scale={scale}
            stations={stations}
            onOpenStation={openStation}
            onPlanFrom={handlePlanFrom}
            isLineFavorite={isLineFavorite}
            onToggleLineFavorite={toggleLine}
          />
        )}

        {appView === 'reach' && (
          <ReachabilityPanel
            network={network}
            stations={stations}
            scale={scale}
            focusStationId={focusStationId}
            onFocusStation={setFocusStationId}
            onPlanTrip={handlePlanTrip}
            onOpenStation={openStation}
          />
        )}

        {appView === 'simulator' && (
          <WhatIfPanel
            network={network}
            stations={stations}
            focusStationId={focusStationId}
            onFocusStation={setFocusStationId}
          />
        )}

        {appView === 'diagnostics' && (
          <DiagnosticsPanel network={network} />
        )}

        {appView === 'insights' && (
          <NetworkInsightsPanel
            network={network}
            scale={scale}
            stations={stations}
            onOpenStation={openStation}
            onPlanTrip={handlePlanTrip}
          />
        )}
      </main>

      <NetworkOverview
        network={network}
        scale={scale}
        onReload={reload}
        onImportFile={importFile}
        importing={importing}
        reloading={reloading}
        reloadSuccess={reloadSuccess}
        sourceLabel={
          networkSource === 'upload' && uploadedFileName
            ? uploadedFileName
            : 'Server-Datei'
        }
      />

      <footer className="app__footer">
        <strong>{BRAND.productName}</strong>
        <span>by {BRAND.publisher}</span>
        <span className="app__footer-copy">{brandFooter()}</span>
      </footer>
    </div>
  )
}

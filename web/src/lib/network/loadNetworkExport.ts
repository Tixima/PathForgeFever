import type { NetworkExport } from '../../types/network'

export type NetworkLoadErrorKind =
  | 'missing'
  | 'invalid_response'
  | 'invalid_json'
  | 'invalid_export'
  | 'fetch_failed'
  | 'file_read'

export interface NetworkLoadError {
  kind: NetworkLoadErrorKind
  title: string
  message: string
  detail?: string
}

export class NetworkLoadFailure extends Error {
  readonly loadError: NetworkLoadError

  constructor(loadError: NetworkLoadError) {
    super(loadError.message)
    this.name = 'NetworkLoadFailure'
    this.loadError = loadError
  }
}

function failure(
  kind: NetworkLoadErrorKind,
  title: string,
  message: string,
  detail?: string,
): NetworkLoadFailure {
  return new NetworkLoadFailure({ kind, title, message, detail })
}

export function validateNetworkExport(data: unknown): NetworkExport {
  if (!data || typeof data !== 'object') {
    throw failure(
      'invalid_export',
      'Kein gültiger Export',
      'Die Datei ist kein PathForgeFever-kompatibler Export.',
      'Erwartet wird eine JSON-Datei aus dem Tixima/TF2-Exporter mit routing_nodes und routing_edges.',
    )
  }

  const record = data as Partial<NetworkExport>

  if (!Array.isArray(record.routing_nodes) || record.routing_nodes.length === 0) {
    throw failure(
      'invalid_export',
      'Export unvollständig',
      'Es fehlen Routing-Knoten (routing_nodes).',
      'Exportiere das Netzwerk erneut aus Transport Fever 2.',
    )
  }

  if (!Array.isArray(record.routing_edges)) {
    throw failure(
      'invalid_export',
      'Export unvollständig',
      'Es fehlen Routing-Kanten (routing_edges).',
    )
  }

  if (!Array.isArray(record.lines)) {
    throw failure(
      'invalid_export',
      'Export unvollständig',
      'Es fehlen Linien-Daten (lines).',
    )
  }

  return record as NetworkExport
}

export function parseNetworkExportJson(text: string, sourceLabel = 'Datei'): NetworkExport {
  const trimmed = text.trim()

  if (!trimmed) {
    throw failure(
      'invalid_json',
      'Leere Datei',
      'Die gewählte Datei enthält keinen Inhalt.',
    )
  }

  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
    throw failure(
      'invalid_response',
      'Keine Netzwerk-Datei',
      'Statt JSON kam eine HTML-Seite — vermutlich fehlt die Export-Datei auf dem Server.',
      'Lade tpf2_network_export.json per Upload hoch oder lege sie unter public/data/ ab.',
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw failure(
      'invalid_json',
      'Ungültiges JSON',
      `${sourceLabel} ist keine gültige JSON-Datei.`,
      'Prüfe, ob du wirklich tpf2_network_export.json aus TF2 gewählt hast.',
    )
  }

  return validateNetworkExport(parsed)
}

export async function fetchNetworkExport(
  dataUrl: string,
  bustCache: boolean,
): Promise<NetworkExport> {
  const url = bustCache ? `${dataUrl}?v=${Date.now()}` : dataUrl

  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store' })
  } catch {
    throw failure(
      'fetch_failed',
      'Verbindung fehlgeschlagen',
      'Die Netzwerk-Datei konnte nicht geladen werden.',
      'Prüfe deine Internetverbindung oder lade den Export manuell hoch.',
    )
  }

  if (response.status === 404) {
    throw failure(
      'missing',
      'Noch kein Netzwerk',
      'Es liegt noch keine tpf2_network_export.json im Projekt.',
      'Exportiere dein Bahnnetz in TF2 und lade die JSON hier hoch — kein manuelles Kopieren nötig.',
    )
  }

  if (!response.ok) {
    throw failure(
      'fetch_failed',
      'Laden fehlgeschlagen',
      `Server antwortete mit Status ${response.status}.`,
      'Versuche erneut oder lade die Export-Datei direkt hoch.',
    )
  }

  const text = await response.text()
  return parseNetworkExportJson(text, 'Server-Antwort')
}

export async function readNetworkExportFile(file: File): Promise<NetworkExport> {
  if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
    throw failure(
      'file_read',
      'Falscher Dateityp',
      'Bitte wähle eine .json-Datei (tpf2_network_export.json).',
    )
  }

  let text: string
  try {
    text = await file.text()
  } catch {
    throw failure(
      'file_read',
      'Datei nicht lesbar',
      'Die Datei konnte nicht gelesen werden.',
    )
  }

  return parseNetworkExportJson(text, file.name)
}

export function toNetworkLoadError(err: unknown): NetworkLoadError {
  if (err instanceof NetworkLoadFailure) {
    return err.loadError
  }
  if (err instanceof Error) {
    return {
      kind: 'fetch_failed',
      title: 'Unerwarteter Fehler',
      message: err.message,
    }
  }
  return {
    kind: 'fetch_failed',
    title: 'Unerwarteter Fehler',
    message: 'Beim Laden ist etwas schiefgelaufen.',
  }
}

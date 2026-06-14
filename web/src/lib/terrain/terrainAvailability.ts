import type { TerrainExport } from '../../types/terrain'

/** Prüft ob Gelände-Daten im Export vorhanden sind (Export 1.3+). */
export function hasTerrainData(terrain?: TerrainExport | null): boolean {
  if (!terrain) return false
  if (terrain.enabled === false) return false
  if (!terrain.bounds?.world) return false
  if (!terrain.height_rows?.length || !terrain.surface_rows?.length) return false
  if (!terrain.columns || !terrain.rows) return false
  return true
}

/** @deprecated Alias — nutze hasTerrainData */
export function isTerrainAvailable(terrain?: TerrainExport | null): boolean {
  return hasTerrainData(terrain)
}

export function terrainStatusLabel(terrain?: TerrainExport | null): string | null {
  if (hasTerrainData(terrain)) return null
  if (!terrain) return 'Kein Gelände — bitte Export 1.3+ mit Terrain laden oder Server-Datei neu laden.'
  if (terrain.enabled === false) return 'Gelände im Export deaktiviert.'
  return 'Gelände-Daten unvollständig — Export erneut aus TF2 erstellen.'
}

# PathForgeFever Exporter v1.5.0

**Powered by Tixima Gaming**

TF2-Plugin für den vollständigen Netzwerk-Export nach JSON (Backend/Web: PathForgeFever / TF2Navigator).

## Was wird exportiert?

Immer **alles** – keine wählbaren Teil-Exporte:

- Linien, Stationen, Routing, Segmente
- Fahrzeuge
- Gleise / Terminals (Native Scan + Fallback)
- **Physisches Schienennetz** (`track_network`) mit abgetasteten Gleis-Polylines (4–16 m)
- **Linienpfade entlang der Schienen** (`track_network.line_paths`) via Pathfinding
- Vollständiges Terrain (Höhe, Basishöhe, Oberfläche, Steigung)

## Einstellungen

- **Terrain-Raster (m):** 8–64 m (Standard 16 m)
- **Gleis-Abtastung (m):** folgt dem Terrain-Raster-Default (8 m), intern 4–16 m

## Bedienung

1. Mod aktivieren, Spielstand laden
2. Unten **PathForgeFever** anklicken
3. Optional Rasterdichte anpassen
4. **Export starten** – Spiel bleibt bedienbar (non-blocking)
5. Ergebnis: `tpf2_network_export.json`

## Installation

```text
.../Transport Fever 2/mods/tixima_tf2_line_exporter_1/
```

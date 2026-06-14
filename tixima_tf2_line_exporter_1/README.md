# Tixima TF2 Line Exporter v1.3.1

Backend-/Frontend-ready One-Shot-Exporter für Transport Fever 2.

## Fokus v1.3.1

Diese Version stellt den Terrain-Export auf **16m Rasterauflösung** um und schreibt die Rasterauflösung sowie die Bedeutungen aller Terrain- und Steigungscodes direkt in die JSON-Datei.

## Terrain Export

Im JSON gibt es den Block:

```json
"terrain": {
  "resolution_m": 16,
  "raster_resolution_m": 16,
  "grid_resolution_m": 16,
  "cell_size_m": 16,
  "surface_code_legend": {},
  "slope_code_legend": {},
  "height_rows": [],
  "base_height_rows": [],
  "surface_rows": [],
  "slope_percent_rows": [],
  "slope_class_rows": []
}
```

### Raster

- `resolution_m`, `raster_resolution_m`, `grid_resolution_m` und `cell_size_m` meinen dasselbe: Abstand zwischen zwei Rasterpunkten in TF2-Weltmetern.
- Standard in v1.3.1: **16m**.
- Koordinate rekonstruieren:

```text
x = terrain.bounds.world.min_x + column_index0 * terrain.resolution_m
y = terrain.bounds.world.min_y + row_index0 * terrain.resolution_m
```

Alle `*_rows` sind `[row][column]`.

### Surface Codes

`surface_rows` enthält pro Zeile einen String. Jeder Buchstabe ist ein Rasterpunkt:

| Code | Bedeutung | Beschreibung |
|---|---|---|
| `W` | Water | Wasser oder Punkt unter/auf Wasserlinie |
| `C` | Coast | Küste / Übergangsbereich nahe Wasserlinie |
| `L` | Lowland | niedriges/flaches Land unter 50m |
| `H` | Hill | Hügel / höheres Gelände von 50m bis unter 150m |
| `M` | Mountain | Berg / sehr hohes Gelände ab 150m |
| `N` | Not available | ungültig oder nicht verfügbar |

Die gleiche Erklärung steht im Export unter `terrain.surface_code_legend`.

### Slope Codes

`slope_class_rows` enthält pro Zeile einen String. Jeder Buchstabe ist ein Rasterpunkt:

| Code | Bedeutung | Beschreibung |
|---|---|---|
| `F` | Flat | flach, unter 3% Steigung |
| `G` | Gentle | leicht geneigt, 3% bis unter 10% |
| `S` | Steep | steil, 10% bis unter 25% |
| `X` | Extreme | extrem steil, ab 25% |
| `N` | Not available | ungültig oder nicht berechenbar |

Die gleiche Erklärung steht im Export unter `terrain.slope_code_legend`.

## Hinweise

- 16m ist deutlich detaillierter als 32m und erzeugt große JSON-Dateien.
- Falls `resolution_auto_adjusted = true`, hat der Exporter das Raster automatisch vergröbert, um eine zu große Datei zu vermeiden. In v1.3.1 liegt das Soft-Limit höher, damit typische große Karten trotzdem bei 16m bleiben.
- `height_rows` sind echte TF2-Höhenwerte über `api.engine.terrain.getHeightAt`, soweit im Script-Kontext verfügbar.
- `base_height_rows` kommen über `getBaseHeightAt`, soweit verfügbar.
- Surface- und Slope-Klassen sind berechnet und entsprechend als computed markiert.

## Installation

Ordner nach:

```text
.../Transport Fever 2/mods/tixima_tf2_line_exporter_1/
```

Im Spielstand aktivieren und über **TIX Export** → **Export jetzt starten** ausführen.

# Tixima TF2 Line Exporter v1.1.1

Backend-ready One-Shot-Exporter für Transport Fever 2.

## v1.1.1 Fokus

v1.1.1 ist ein vorsichtiger Fix auf Basis der funktionierenden v1.1. Die Backend-Struktur bleibt erhalten, aber die bisherigen Warnungen werden besser behandelt:

- `transport_modes` wird jetzt zuverlässiger als **effective transport mode** befüllt, wenn TF2 keine nativen `vehicleInfo.transportModes` liefert; v1.1.1 nutzt dafür auch die Carrier der konkreten Stationen innerhalb einer Station Group.
- die originalen TF2-Werte bleiben zusätzlich als `native_transport_modes` erhalten.
- Stop-Einträge bekommen `boarding_station_id_best_effort`, wenn eine Station Group genau eine Station enthält.
- Segmente übernehmen diese Boarding-/Terminal-Hinweise.
- Vehicle-Export nutzt jetzt zuerst `TRANSPORT_VEHICLE`, fällt bei Bedarf aber auf `VEHICLE` zurück.
- `quality_report` unterscheidet nun zwischen **nativ nicht verfügbar** und **für Backend brauchbar per Fallback aufgelöst**.

## Wichtig

Diese Version kann nicht zaubern. Wenn TF2 im aktuellen One-Shot-API-Pfad keine nativen Gleis-/Terminaldaten, echten Fahrzeiten oder Fahrzeugdaten herausgibt, werden diese nicht erfunden.

Stattdessen markiert v1.1.1 sauber:

- `tf2_api`: direkt aus TF2 / `game.interface` / `api.engine`
- `tf2_api_best_effort`: defensiv aus TF2-Komponenten gelesen, abhängig vom Spielzustand
- `computed_experimental`: aus TF2-Daten berechnet
- `computed_experimental_assumption`: mit ausdrücklicher Annahme berechnet
- `not_available`: aktuell nicht aus TF2 verfügbar

## Für das Backend

Die wichtigsten Importfelder bleiben:

- `station_groups`
- `stations`
- `lines`
- `segments`
- `routing_nodes`
- `routing_edges`
- `transfers`
- `line_summaries`
- `station_line_index`
- `quality_report`
- `diagnostics`

## Realistische Distanzen und Zeiten

Die Zeiten und Kilometer bleiben experimentell geschätzt:

```text
Station-Group-Luftlinie × Maßstabsannahme × Umwegfaktor ÷ Speed-Profil
```

Aktuell gilt:

```text
1 Game-Unit ≈ 1 Meter
```

Das steht im Export unter `scale` und soll im Backend überschreibbar bleiben.

## Noch nicht nativ verfügbar

Diese Werte sind weiterhin nicht echte TF2-Timetable-/Live-Daten:

- native Segmentfahrzeiten
- echte Verspätungen
- Live-Fahrzeugpositionen
- echte Plattform-/Gleisdaten, wenn TF2 nur `game.interface.LINE.stops` statt `component.Line.stops` liefert

## Installation

Ordner nach:

```text
.../Transport Fever 2/mods/tixima_tf2_line_exporter_1/
```

Im Spielstand aktivieren und unten über **TIX Export** → **Export jetzt starten** ausführen.

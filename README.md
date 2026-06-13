# PathForgeFever

**by [TiximaGaming](https://github.com/Tixima)** — Routenplanung und Netzanalyse für **Transport Fever 2**.

PathForgeFever liest den JSON-Export aus dem **Tixima TF2 Line Exporter**, baut daraus ein Routing-Graph und bietet Routenplaner, Netzpläne, Erreichbarkeitskarten, Linien-Explorer, Netzdiagnose und mehr — alles im Browser, ohne Backend.

## Features

- **Routenplaner** — schnellste, wenigste Umstiege oder komplexeste Verbindung; Via-Halte; barrierefreie Optionen inkl. strikt gleiswechselfreier Modus
- **Inside Bahnhof** — Gleise, Linien und Umstiege pro Station
- **Linien** — Streckenvergleich und Haltestellenfolgen
- **Netzpläne** — geografisch und schematisch
- **Erreichbarkeit** — Isochronen und Reichweiten
- **Analyse** — komplexe Verbindungen, Netz-KPIs
- **Diagnose** — Export-Qualität und experimentelle Felder aus dem Exporter
- **Share-Links** — Route per URL teilen (eingefroren oder dynamisch neu berechnet)

## Voraussetzungen

- [Node.js](https://nodejs.org/) 18+
- Exportierte `tpf2_network_export.json` aus dem **Tixima TF2 Line Exporter** (Transport Fever 2)

## Schnellstart

```bash
cd web
npm install
npm run dev
```

Die App lädt standardmäßig `/data/tpf2_network_export.json`. Zwei Wege:

1. **Upload** — beim ersten Start die JSON per Drag & Drop hochladen (bleibt für die Browser-Session gespeichert).
2. **Statisch (Dev/Deploy)** — Datei nach `web/public/data/tpf2_network_export.json` legen.

Produktions-Build:

```bash
cd web
npm run build
npm run preview
```

## Projektstruktur

| Pfad | Inhalt |
|------|--------|
| `web/` | React + Vite Frontend |
| `web/src/lib/routing/` | Pathfinding (Dijkstra), Graph, Share-Links |
| `web/src/lib/network/` | Export laden und validieren |
| `web/public/data/` | Optional: Standard-Netzwerk-Export |

## Lizenz

[GNU AGPL-3.0](LICENSE) — Copyright (c) 2026 TiximaGaming.

Modifizierte Versionen, die über das Netz bereitgestellt werden, müssen unter derselben Lizenz offen gelegt werden. Exportierte Spieldaten und Netzwerk-JSON aus Transport Fever 2 gehören dem jeweiligen Spielstand und sind nicht Teil dieser Lizenz.

function data()
  return {
    info = {
      minorVersion = 31,
      severityAdd = "NONE",
      severityRemove = "NONE",
      name = _("Tixima TF2 Line Exporter"),
      description = _("Exports Transport Fever 2 lines, stations, canonical station coordinates, native api.engine stop terminal/platform data when available, virtual platform fallback assignments, stop sequences and backend-ready static routing/map data on demand via a small in-game UI. v1.3.1 keeps native terminal/platform probing and vehicle probing, and exports complete detected-map terrain at 16m raster resolution with explicit grid resolution metadata plus surface/slope code legends."),
      tags = { "Script Mod", "Tools", "Exporter" },
      authors = {
        {
          name = "Tixima / Niklas",
          role = "CREATOR",
        },
      },
    },
  }
end

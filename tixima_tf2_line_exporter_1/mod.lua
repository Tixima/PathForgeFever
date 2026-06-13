function data()
  return {
    info = {
      minorVersion = 13,
      severityAdd = "NONE",
      severityRemove = "NONE",
      name = _("Tixima TF2 Line Exporter"),
      description = _("Exports Transport Fever 2 lines, stations, stop sequences and backend-ready static routing/map data on demand via a small in-game UI. v1.1.1 fixes effective transport-mode inference from station carriers, keeps boarding-station fallback and safer vehicle scanning while preserving raw TF2 values."),
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

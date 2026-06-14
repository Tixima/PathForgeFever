-- PathForgeFever export job – Powered by Tixima Gaming

local M = {}

M.MOD_VERSION = "1.4.3"
M.SCHEMA_VERSION = 41

M.EXPORT_PHASE = {
  IDLE = "IDLE",
  QUEUED = "QUEUED",
  EXPORTING_TOPOLOGY = "EXPORTING_TOPOLOGY",
  EXPORTING_VEHICLES = "EXPORTING_VEHICLES",
  EXPORTING_TERMINALS = "EXPORTING_TERMINALS",
  EXPORTING_TERRAIN_BOUNDS = "EXPORTING_TERRAIN_BOUNDS",
  EXPORTING_TERRAIN_ROWS = "EXPORTING_TERRAIN_ROWS",
  WRITING_FINAL_JSON = "WRITING_FINAL_JSON",
  DONE = "DONE",
  ERROR = "ERROR",
  CANCELLED = "CANCELLED",
}

M.PHASE_ORDER = {
  "IDLE", "QUEUED", "EXPORTING_TOPOLOGY", "EXPORTING_VEHICLES", "EXPORTING_TERMINALS",
  "EXPORTING_TERRAIN_BOUNDS", "EXPORTING_TERRAIN_ROWS", "WRITING_FINAL_JSON",
  "DONE", "ERROR", "CANCELLED",
}

M.ROWS_PER_TICK = 8
M.STATUS_FILE = "tixima_export_status.json"

M.DEFAULT_OPTIONS = {
  terrain_resolution_m = 16,
}

function M.defaultOptions()
  local o = {}
  for k, v in pairs(M.DEFAULT_OPTIONS) do
    if type(v) == "table" then
      local t = {}
      for k2, v2 in pairs(v) do t[k2] = v2 end
      o[k] = t
    else
      o[k] = v
    end
  end
  return o
end

function M.copyOptions(source)
  local o = M.defaultOptions()
  if type(source) ~= "table" then return o end
  for k, v in pairs(source) do o[k] = v end
  return o
end

function M.formatNumber(n)
  n = tonumber(n) or 0
  local s = tostring(math.floor(n + 0.5))
  local out, count = {}, 0
  for i = #s, 1, -1 do
    count = count + 1
    out[#out + 1] = string.sub(s, i, i)
    if count % 3 == 0 and i > 1 then out[#out + 1] = "." end
  end
  local rev = {}
  for i = #out, 1, -1 do rev[#rev + 1] = out[i] end
  return table.concat(rev)
end

function M.formatDuration(seconds)
  seconds = math.max(0, math.floor(tonumber(seconds) or 0))
  local h = math.floor(seconds / 3600)
  local m = math.floor((seconds % 3600) / 60)
  local s = seconds % 60
  if h > 0 then
    return string.format("%02d:%02d:%02d", h, m, s)
  end
  return string.format("%02d:%02d", m, s)
end

function M.formatProgressBar(progress, width)
  width = width or 20
  progress = math.max(0, math.min(100, tonumber(progress) or 0))
  local filled = math.floor((progress / 100) * width + 0.5)
  if filled > width then filled = width end
  return "[" .. string.rep("#", filled) .. string.rep("-", width - filled) .. "] " .. string.format("%.0f", progress) .. " %"
end

function M.phaseLabel(phase, job)
  phase = phase or M.EXPORT_PHASE.IDLE
  if phase == M.EXPORT_PHASE.EXPORTING_TERRAIN_ROWS and job and job.terrain then
    local t = job.terrain
    local row = t.subPhase == "slope" and (t.slopeRow or 0) or (t.currentRow or 0)
    local total = t.rows or 0
    local sub = t.subPhase == "slope" and "Steigung" or "Terrain"
    return sub .. " " .. tostring(row) .. " / " .. tostring(total) .. " Zeilen"
  end
  local labels = {
    IDLE = "Bereit",
    QUEUED = "In Warteschlange",
    EXPORTING_TOPOLOGY = "Linien / Stationen / Routing",
    EXPORTING_VEHICLES = "Fahrzeuge",
    EXPORTING_TERMINALS = "Gleise / Terminals",
    EXPORTING_TERRAIN_BOUNDS = "Terrain-Grenzen",
    EXPORTING_TERRAIN_ROWS = "Terrain-Raster",
    WRITING_FINAL_JSON = "JSON schreiben",
    DONE = "Fertig",
    ERROR = "Fehler",
    CANCELLED = "Abgebrochen",
  }
  return labels[phase] or phase
end

function M.computeProgress(job)
  if job == nil then return 0 end
  local phase = job.phase or M.EXPORT_PHASE.IDLE
  if phase == M.EXPORT_PHASE.IDLE then return 0 end
  if phase == M.EXPORT_PHASE.DONE then return 100 end
  if phase == M.EXPORT_PHASE.ERROR or phase == M.EXPORT_PHASE.CANCELLED then return job.progress or 0 end

  local weights = {
    QUEUED = 0.01,
    EXPORTING_TOPOLOGY = 0.10,
    EXPORTING_TERMINALS = 0.06,
    EXPORTING_VEHICLES = 0.06,
    EXPORTING_TERRAIN_BOUNDS = 0.02,
    EXPORTING_TERRAIN_ROWS = 0.70,
    WRITING_FINAL_JSON = 0.05,
  }

  local base = 0
  local order = {
    M.EXPORT_PHASE.QUEUED,
    M.EXPORT_PHASE.EXPORTING_TOPOLOGY,
    M.EXPORT_PHASE.EXPORTING_TERMINALS,
    M.EXPORT_PHASE.EXPORTING_VEHICLES,
    M.EXPORT_PHASE.EXPORTING_TERRAIN_BOUNDS,
    M.EXPORT_PHASE.EXPORTING_TERRAIN_ROWS,
    M.EXPORT_PHASE.WRITING_FINAL_JSON,
  }

  for _, p in ipairs(order) do
    if p == phase then break end
    base = base + (weights[p] or 0)
  end

  local phaseWeight = weights[phase] or 0
  local intra = 0
  if phase == M.EXPORT_PHASE.EXPORTING_TERRAIN_ROWS and job.terrain then
    local t = job.terrain
    local rows = math.max(1, t.rows or 1)
    if t.subPhase == "slope" then
      intra = 0.5 + 0.5 * ((t.slopeRow or 0) / rows)
    else
      intra = 0.5 * ((t.currentRow or 0) / rows)
    end
  elseif phase == M.EXPORT_PHASE.WRITING_FINAL_JSON then
    intra = 0.5
  else
    intra = 0.5
  end

  return math.min(99.9, (base + phaseWeight * intra) * 100)
end

function M.buildPhaseList(currentPhase)
  local lines = {}
  for _, p in ipairs(M.PHASE_ORDER) do
    if p == "IDLE" or p == "ERROR" or p == "CANCELLED" or p == "DONE" then
      -- skip noise in list unless current
    else
      local marker = (p == currentPhase) and "> " or "  "
      lines[#lines + 1] = marker .. p
    end
  end
  return table.concat(lines, "\n")
end

function M.createJob()
  return {
    active = false,
    cancel_requested = false,
    phase = M.EXPORT_PHASE.IDLE,
    options = M.defaultOptions(),
    source = nil,
    started_at = nil,
    finished_at = nil,
    progress = 0,
    samples_done = 0,
    total_samples = 0,
    data = nil,
    terrain = nil,
    error = nil,
  }
end

function M.emptyRoutingPackage()
  return {
    routing_nodes = {},
    routing_edges = {},
    transfers = {},
    station_line_index = {},
    network_map = {},
  }
end

function M.emptyTerminalData()
  return { entries = {}, applied_to_stops = 0 }, {}, {}
end

function M.disabledTerrainStub(options, deps)
  return {
    schema = "tixima-terrain-grid",
    schema_version = 1,
    enabled = false,
    status = "disabled",
    note = "Terrain export disabled by UI option in v1.4.0",
    requested_resolution_m = options and options.terrain_resolution_m or 16,
  }
end

function M.initTerrainContext(stationGroups, options, deps)
  local terrain = deps.terrainApi()
  local resolutionM = tonumber(options and options.terrain_resolution_m) or deps.TERRAIN_EXPORT_CONFIG.requested_resolution_m or 16
  local ctx = {
    subPhase = "height",
    currentRow = 0,
    slopeRow = 0,
    options = { terrain_resolution_m = resolutionM },
  }
  if terrain == nil then
    ctx.skip = true
    ctx.unavailable = true
    return ctx
  end

  local seedBounds = deps.boundsFromStationGroups(stationGroups)
  local bounds = deps.expandTerrainBounds(seedBounds, deps.diagRef)
  local resolution = tonumber(options.terrain_resolution_m) or deps.TERRAIN_EXPORT_CONFIG.requested_resolution_m or 16

  local width = math.max(0, (bounds.max_x or 0) - (bounds.min_x or 0))
  local height = math.max(0, (bounds.max_y or 0) - (bounds.min_y or 0))
  local columns = math.max(1, math.floor(width / resolution) + 1)
  local rows = math.max(1, math.floor(height / resolution) + 1)
  local sampleCount = columns * rows
  local autoAdjusted = false
  local softLimit = deps.TERRAIN_EXPORT_CONFIG.max_samples_soft_limit or 5000000
  while sampleCount > softLimit and resolution < 512 do
    resolution = resolution * 2
    columns = math.max(1, math.floor(width / resolution) + 1)
    rows = math.max(1, math.floor(height / resolution) + 1)
    sampleCount = columns * rows
    autoAdjusted = true
  end

  local waterLevel, waterOrigin = deps.readTerrainWaterLevel(deps.diagRef)
  ctx.bounds = bounds
  ctx.resolution = resolution
  ctx.columns = columns
  ctx.rows = rows
  ctx.autoAdjusted = autoAdjusted
  ctx.waterLevel = waterLevel
  ctx.waterOrigin = waterOrigin
  ctx.heightRows = {}
  ctx.baseHeightRows = {}
  ctx.surfaceRows = {}
  ctx.slopeRows = {}
  ctx.slopeClassRows = {}
  ctx.heightOrigin = nil
  ctx.baseOrigin = nil
  ctx.minH, ctx.maxH, ctx.minBase, ctx.maxBase = nil, nil, nil, nil
  ctx.landCount, ctx.waterCount, ctx.coastCount, ctx.invalidCount = 0, 0, 0, 0
  ctx.total_samples = sampleCount
  ctx.samples_done = 0
  return ctx
end

function M.tickTerrainHeightRows(ctx, deps, rowsPerTick)
  if ctx.skip then return true end
  local resolution = ctx.resolution
  local columns = ctx.columns
  local rows = ctx.rows
  local bounds = ctx.bounds
  local waterLevel = ctx.waterLevel or 0
  local opts = ctx.options or {}
  local endRow = math.min(rows, ctx.currentRow + rowsPerTick)

  for row = ctx.currentRow + 1, endRow do
    local y = (bounds.min_y or 0) + (row - 1) * resolution
    local hRow, bRow, sCodes = {}, {}, {}
    for col = 1, columns do
      local x = (bounds.min_x or 0) + (col - 1) * resolution
      local isValid = deps.terrainIsValid(x, y)
      if not isValid then
        hRow[col] = false
        bRow[col] = false
        sCodes[col] = "N"
        ctx.invalidCount = ctx.invalidCount + 1
      else
        local h, hOrg = deps.terrainHeightAt(x, y)
        local b, bOrg = deps.terrainBaseHeightAt(x, y)
        ctx.heightOrigin = ctx.heightOrigin or hOrg
        ctx.baseOrigin = ctx.baseOrigin or bOrg
        h = h ~= nil and deps.roundedNumber(h, deps.TERRAIN_EXPORT_CONFIG.height_sample_decimals or 1) or false
        b = b ~= nil and deps.roundedNumber(b, deps.TERRAIN_EXPORT_CONFIG.height_sample_decimals or 1) or false
        hRow[col] = h
        bRow[col] = b
        local code = deps.classifyTerrainSample(h, waterLevel)
        sCodes[col] = code
        if type(h) == "number" then
          ctx.minH = ctx.minH == nil and h or math.min(ctx.minH, h)
          ctx.maxH = ctx.maxH == nil and h or math.max(ctx.maxH, h)
        end
        if type(b) == "number" then
          ctx.minBase = ctx.minBase == nil and b or math.min(ctx.minBase, b)
          ctx.maxBase = ctx.maxBase == nil and b or math.max(ctx.maxBase, b)
        end
        if code == "W" then ctx.waterCount = ctx.waterCount + 1
        elseif code == "C" then ctx.coastCount = ctx.coastCount + 1
        elseif code ~= "N" then ctx.landCount = ctx.landCount + 1 end
      end
    end
    ctx.heightRows[row] = hRow
    ctx.baseHeightRows[row] = bRow
    ctx.surfaceRows[row] = deps.compactRowString(sCodes)
    ctx.samples_done = row * columns
  end

  ctx.currentRow = endRow
  return endRow >= rows
end

function M.tickTerrainSlopeRows(ctx, deps, rowsPerTick)
  if ctx.skip then return true end

  local resolution = ctx.resolution
  local columns = ctx.columns
  local rows = ctx.rows
  local heightRows = ctx.heightRows
  local endRow = math.min(rows, ctx.slopeRow + rowsPerTick)

  for row = ctx.slopeRow + 1, endRow do
    local slopeRow, slopeCodes = {}, {}
    for col = 1, columns do
      local h = heightRows[row] and heightRows[row][col] or nil
      if type(h) ~= "number" then
        slopeRow[col] = false
        slopeCodes[col] = "N"
      else
        local left = heightRows[row] and heightRows[row][math.max(1, col - 1)] or h
        local right = heightRows[row] and heightRows[row][math.min(columns, col + 1)] or h
        local up = heightRows[math.max(1, row - 1)] and heightRows[math.max(1, row - 1)][col] or h
        local down = heightRows[math.min(rows, row + 1)] and heightRows[math.min(rows, row + 1)][col] or h
        left = type(left) == "number" and left or h
        right = type(right) == "number" and right or h
        up = type(up) == "number" and up or h
        down = type(down) == "number" and down or h
        local dzdx = (right - left) / math.max(1, (col == 1 or col == columns) and resolution or (2 * resolution))
        local dzdy = (down - up) / math.max(1, (row == 1 or row == rows) and resolution or (2 * resolution))
        local slopePercent = math.sqrt(dzdx * dzdx + dzdy * dzdy) * 100.0
        slopePercent = deps.roundedNumber(slopePercent, deps.TERRAIN_EXPORT_CONFIG.slope_sample_decimals or 1)
        slopeRow[col] = slopePercent
        slopeCodes[col] = deps.slopeClass(slopePercent)
      end
    end
    ctx.slopeRows[row] = slopeRow
    ctx.slopeClassRows[row] = deps.compactRowString(slopeCodes)
  end

  ctx.slopeRow = endRow
  return endRow >= rows
end

function M.finalizeTerrainExport(ctx, deps)
  if ctx.skip then
    if ctx.unavailable then
      return {
        schema = "tixima-terrain-grid",
        schema_version = 1,
        enabled = true,
        status = "unavailable",
        error = "api.engine.terrain not available in this script context",
      }
    end
    return M.disabledTerrainStub(ctx.options, deps)
  end

  local resolution = ctx.resolution
  local columns = ctx.columns
  local rows = ctx.rows
  local bounds = ctx.bounds
  local sampleCount = rows * columns
  local opts = ctx.options or {}

  local terrainExport = {
    schema = "tixima-terrain-grid",
    schema_version = 1,
    enabled = true,
    status = "ok",
    resolution_m = resolution,
    raster_resolution_m = resolution,
    grid_resolution_m = resolution,
    cell_size_m = resolution,
    requested_resolution_m = opts.terrain_resolution_m or resolution,
    configured_requested_resolution_m = opts.terrain_resolution_m or resolution,
    resolution_auto_adjusted = ctx.autoAdjusted,
    resolution_note = "PathForgeFever non-blocking export. Each raster cell represents one sample point every resolution_m meters.",
    columns = columns,
    rows = rows,
    sample_count = sampleCount,
    bounds = {
      world = {
        min_x = deps.roundedNumber(bounds.min_x, 3), max_x = deps.roundedNumber(bounds.max_x, 3),
        min_y = deps.roundedNumber(bounds.min_y, 3), max_y = deps.roundedNumber(bounds.max_y, 3),
        origin = bounds.origin,
        valid_coordinate_origin = bounds.valid_coordinate_origin,
      },
      width_m_experimental = deps.roundedNumber((bounds.max_x or 0) - (bounds.min_x or 0), 1),
      height_m_experimental = deps.roundedNumber((bounds.max_y or 0) - (bounds.min_y or 0), 1),
      seed_bounds = bounds.seed_bounds,
    },
    water_level = deps.roundedNumber(ctx.waterLevel or 0, 3),
    water_level_origin = ctx.waterOrigin,
    height_origin = ctx.heightOrigin or "unknown",
    base_height_origin = ctx.baseOrigin or "unknown",
    statistics = {
      min_height = ctx.minH,
      max_height = ctx.maxH,
      min_base_height = ctx.minBase,
      max_base_height = ctx.maxBase,
      land_samples = ctx.landCount,
      water_samples = ctx.waterCount,
      coast_samples = ctx.coastCount,
      invalid_samples = ctx.invalidCount,
    },
  }

  terrainExport.height_rows = ctx.heightRows
  terrainExport.base_height_rows = ctx.baseHeightRows
  terrainExport.surface_rows = ctx.surfaceRows
  terrainExport.slope_percent_rows = ctx.slopeRows
  terrainExport.slope_class_rows = ctx.slopeClassRows

  return terrainExport
end

function M.buildMirror(job, state)
  local progress = M.computeProgress(job)
  job.progress = progress
  local elapsed = 0
  local eta = nil
  if job.started_at and os and os.time then
    elapsed = math.max(0, os.time() - job.started_at)
    if progress > 1 and progress < 100 then
      eta = elapsed * (100 / progress - 1)
    end
  end

  return {
    mod_version = M.MOD_VERSION,
    phase = job.phase,
    phase_label = M.phaseLabel(job.phase, job),
    progress = progress,
    progress_bar = M.formatProgressBar(progress),
    samples_done = job.samples_done or 0,
    total_samples = job.total_samples or 0,
    elapsed_s = elapsed,
    elapsed = M.formatDuration(elapsed),
    eta_s = eta,
    eta = eta and M.formatDuration(eta) or "--:--",
    active = job.active == true,
    cancel_requested = job.cancel_requested == true,
    error = job.error,
    status = state and state.status or nil,
    status_text = state and state.status_text or nil,
    last_message = state and state.last_message or nil,
    last_output = state and state.last_output or nil,
    last_error = state and state.last_error or nil,
    counts = state and state.counts or nil,
    diagnostics_count = state and state.diagnostics_count or 0,
    phase_list = M.buildPhaseList(job.phase),
    options = job.options,
  }
end

return M

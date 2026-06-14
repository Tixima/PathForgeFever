-- Tixima TF2 Line Exporter - v1.3.1
-- Manual one-shot export with small in-game UI.
-- v1.3.1 keeps the native Gleis + vehicle probing from v1.2.x and adds a complete
-- terrain export grid: sampled height/base-height, land/water/coast/elevation classes,
-- slope classes and terrain metadata for backend/frontend map rendering.
-- Important: fields marked as computed_experimental are NOT direct TF2 API values.

local SCRIPT_FILE_NAME = "tixima_line_exporter.lua"
local EVENT_ID = "tixima_exporter"
local EVENT_EXPORT_REQUEST = "export.request"

local ticks = 0
local engineReady = false
-- v1.3.0: load() is called repeatedly in the UI state. If we reset runtime state
-- every time, the panel flashes the new export result for one frame and then
-- falls back to 0/0/0. Keep one runtime state per Lua state.
local runtimeInitialized = false

local state = {
  schema = "tixima-tf2-line-exporter-state",
  schema_version = 31,
  mod_version = "1.3.1",
  status = "loading",
  status_text = "Lade Spielstand...",
  last_message = "Noch kein Export ausgeführt.",
  last_error = nil,
  last_output = nil,
  last_export_unix = nil,
  export_count = 0,
  request_count = 0,
  counts = { lines = 0, stations = 0, station_groups = 0, segments = 0, vehicles = 0, routing_nodes = 0, routing_edges = 0, terrain_samples = 0 },
  diagnostics_count = 0,
}

local ui = {
  initialized = false,
  pending_export_requests = 0,
  window = nil,
  open_button = nil,
  status_text = nil,
  counts_text = nil,
  output_text = nil,
  error_text = nil,
  diag_text = nil,
  hint_text = nil,
}

-- Experimental conversion/routing assumptions ------------------------------
-- These values are NOT read from TF2 as native timetable data. They are kept
-- explicit in the export so the backend can override them later.
local EXPERIMENTAL_DISTANCE_SCALE = {
  meters_per_game_unit = 1.0,
  origin = "computed_experimental_assumption",
  confidence = "medium",
  note = "TF2 world coordinates are treated as meter-like game units for MVP routing. This exporter did not read a per-save map scale from TF2.",
  source_hint = "TF2 heightmap documentation defines each heightmap cell as 4x4 meters; exported world coordinates appear to be in meter-scale game units, but this assumption should remain overrideable."
}

local EXPERIMENTAL_SPEED_PROFILE = {
  default_kmh = 90.0,
  rail_kmh = 120.0,
  road_kmh = 50.0,
  tram_kmh = 35.0,
  ship_kmh = 35.0,
  aircraft_kmh = 300.0,
  dwell_seconds_per_intermediate_stop = 30.0,
  transfer_penalty_seconds = 240.0,
  interchange_transfer_penalty_seconds = 240.0,
  terminal_transfer_penalty_seconds = 90.0,
  origin = "computed_experimental_assumption",
  note = "Used only for estimated_travel_time_* fields. Replace with measured vehicle timings later."
}

local EXPERIMENTAL_DETOUR_FACTOR = {
  default = 1.20,
  rail = 1.18,
  road = 1.35,
  tram = 1.30,
  ship = 1.10,
  aircraft = 1.05,
  origin = "computed_experimental_assumption",
  note = "Multiplies straight-line station-group distance to produce a more realistic route-distance estimate for MVP backend routing."
}

-- v1.3.1 terrain export settings -----------------------------------------
-- Full native 4 m terrain over a large map can become extremely large and can
-- freeze the game when JSON encoded in one shot. Therefore v1.3.1 exports the
-- complete detected map rectangle as compact rows at a backend-friendly default
-- resolution and includes all metadata so the backend can resample/render it.
local TERRAIN_EXPORT_CONFIG = {
  enabled = true,
  requested_resolution_m = 16,
  min_resolution_m = 16,
  max_samples_soft_limit = 5000000,
  max_search_extent = 65536,
  bounds_probe_step = 1024,
  fallback_margin = 1024,
  water_tolerance_m = 0.35,
  coast_tolerance_m = 2.0,
  slope_sample_decimals = 1,
  height_sample_decimals = 1,
  note = "Complete detected map rectangle sampled as compact rows. v1.3.1 default is 16m raster. Raise/lower requested_resolution_m in the Lua config if you want smaller/larger files."
}

local DISPLAY_COLOR_PALETTE = {
  { r = 220, g = 38, b = 38, a = 255, hex = "#DC2626" },
  { r = 37, g = 99, b = 235, a = 255, hex = "#2563EB" },
  { r = 22, g = 163, b = 74, a = 255, hex = "#16A34A" },
  { r = 147, g = 51, b = 234, a = 255, hex = "#9333EA" },
  { r = 234, g = 88, b = 12, a = 255, hex = "#EA580C" },
  { r = 8, g = 145, b = 178, a = 255, hex = "#0891B2" },
  { r = 219, g = 39, b = 119, a = 255, hex = "#DB2777" },
  { r = 101, g = 163, b = 13, a = 255, hex = "#65A30D" },
  { r = 245, g = 158, b = 11, a = 255, hex = "#F59E0B" },
  { r = 75, g = 85, b = 99, a = 255, hex = "#4B5563" },
}

-- Basic helpers -------------------------------------------------------------

local function safeToString(value)
  if value == nil then return nil end
  local ok, result = pcall(function() return tostring(value) end)
  if ok then return result end
  return "<tostring failed>"
end

local function safeTonumber(value)
  local ok, result = pcall(function() return tonumber(value) end)
  if ok then return result end
  return nil
end

local function eid(entity)
  if entity == nil then return nil end
  local n = safeTonumber(entity)
  if n ~= nil then return n end
  return safeToString(entity)
end

local function safeField(obj, key)
  if obj == nil then return nil end
  local ok, result = pcall(function() return obj[key] end)
  if ok then return result end
  return nil
end

local function safeLen(obj)
  if obj == nil then return 0 end
  local ok, result = pcall(function() return #obj end)
  if ok and type(result) == "number" then return result end
  return 0
end

local function isArray(t)
  if type(t) ~= "table" then return false end
  local count = 0
  local maxIndex = 0
  for k, _ in pairs(t) do
    if type(k) ~= "number" or k < 1 or math.floor(k) ~= k then return false end
    count = count + 1
    if k > maxIndex then maxIndex = k end
  end
  return maxIndex == count
end

local function escapeJsonString(s)
  s = tostring(s or "")
  s = s:gsub('\\', '\\\\')
  s = s:gsub('"', '\\"')
  s = s:gsub('\b', '\\b')
  s = s:gsub('\f', '\\f')
  s = s:gsub('\n', '\\n')
  s = s:gsub('\r', '\\r')
  s = s:gsub('\t', '\\t')
  s = s:gsub('[%z\1-\31]', function(c)
    return string.format('\\u%04x', string.byte(c))
  end)
  return '"' .. s .. '"'
end

local function jsonEncode(value)
  local t = type(value)
  if value == nil then
    return "null"
  elseif t == "boolean" then
    return value and "true" or "false"
  elseif t == "number" then
    if value ~= value or value == math.huge or value == -math.huge then return "null" end
    return tostring(value)
  elseif t == "string" then
    return escapeJsonString(value)
  elseif t == "table" then
    if isArray(value) then
      local out = {}
      for i = 1, #value do out[#out + 1] = jsonEncode(value[i]) end
      return "[" .. table.concat(out, ",") .. "]"
    else
      local out = {}
      for k, v in pairs(value) do
        if type(k) == "string" and v ~= nil then
          out[#out + 1] = escapeJsonString(k) .. ":" .. jsonEncode(v)
        end
      end
      return "{" .. table.concat(out, ",") .. "}"
    end
  else
    return escapeJsonString(safeToString(value) or "")
  end
end

local function diagPush(diag, level, message)
  if type(diag) == "table" then
    diag[#diag + 1] = { level = level or "info", message = tostring(message or "") }
  end
  print("[Tixima TF2 Line Exporter] " .. tostring(level or "info") .. ": " .. tostring(message or ""))
end

local function componentType(name)
  local ok, result = pcall(function() return api.type.ComponentType[name] end)
  if ok then return result end
  return nil
end

local CT_NAME = componentType("NAME")
local CT_STATION = componentType("STATION")
local CT_STATION_GROUP = componentType("STATION_GROUP")
local CT_LINE = componentType("LINE")
local CT_COLOR = componentType("COLOR")
local CT_CONSTRUCTION = componentType("CONSTRUCTION")
local CT_TRANSPORT_VEHICLE = componentType("TRANSPORT_VEHICLE")
local CT_VEHICLE = componentType("VEHICLE")
local CT_BASE_EDGE = componentType("BASE_EDGE")
local CT_TRANSPORT_NETWORK = componentType("TRANSPORT_NETWORK")
local CT_TERRAIN = componentType("TERRAIN")
local CT_TERRAIN_TILE = componentType("TERRAIN_TILE")
local CT_TERRAIN_TILE_HEIGHTMAP = componentType("TERRAIN_TILE_HEIGHTMAP")
local CT_WATER_MESH = componentType("WATER_MESH")

local function getComponent(entity, componentTypeValue)
  if entity == nil or componentTypeValue == nil then return nil end
  local ok, result = pcall(function() return api.engine.getComponent(entity, componentTypeValue) end)
  if ok then return result end
  return nil
end

local function interfaceEntity(entity)
  if game == nil or game.interface == nil or game.interface.getEntity == nil then return nil end
  local idValue = safeTonumber(eid(entity)) or entity
  local ok, result = pcall(function() return game.interface.getEntity(idValue) end)
  if ok and type(result) == "table" then return result end
  return nil
end

local function interfaceEntities(circle, filter)
  if game == nil or game.interface == nil or game.interface.getEntities == nil then return nil end
  local ok, result = pcall(function() return game.interface.getEntities(circle, filter) end)
  if ok then return result end
  return nil
end

local function interfaceLines(filter)
  if game == nil or game.interface == nil or game.interface.getLines == nil then return nil end
  local ok, result = pcall(function() return game.interface.getLines(filter) end)
  if ok then return result end
  return nil
end

-- v1.2.2: native line detail probing. Some TF2 builds expose api.engine.getLine(lineId)
-- or api.engine.getLines()[lineId] with stop.station and stop.terminal. terminal is a
-- 0-based platform index, so terminal=0 means UI Gleis/Platform 1.
-- Important: depending on the game-script context, these objects may be Lua tables OR sol userdata.
-- Earlier versions rejected userdata and silently fell back to game.interface. v1.2.2 accepts any
-- returned object that exposes a readable .stops field and logs why every native probe failed.
local function describeLineDetailCandidate(candidate)
  if candidate == nil then return "nil" end
  local stops = safeField(candidate, "stops")
  return "type=" .. tostring(type(candidate)) .. ", stopsType=" .. tostring(type(stops)) .. ", stopsLen=" .. tostring(safeLen(stops))
end

local function hasReadableStopsCandidate(candidate)
  if candidate == nil or candidate == false then return false end
  local stops = safeField(candidate, "stops")
  if stops == nil then return false end
  if type(stops) == "table" then return true end
  if safeLen(stops) > 0 then return true end
  -- Some sol objects do not expose # but still allow indexed access; keep as candidate.
  return type(stops) == "userdata"
end

local function tryNativeLineDetail(label, fn, lineId, diag)
  local ok, result = pcall(fn)
  if ok and hasReadableStopsCandidate(result) then
    diagPush(diag, "info", "line " .. tostring(lineId) .. " native stop probe OK via " .. tostring(label) .. " (" .. describeLineDetailCandidate(result) .. ")")
    return result, label
  end
  local reason
  if ok then reason = describeLineDetailCandidate(result) else reason = "error=" .. tostring(result) end
  diagPush(diag, "info", "line " .. tostring(lineId) .. " native stop probe failed via " .. tostring(label) .. " (" .. tostring(reason) .. ")")
  return nil, nil
end

local function findLineInCollection(allLines, idValue, diag)
  if allLines == nil then return nil end

  local direct = safeField(allLines, idValue)
  if hasReadableStopsCandidate(direct) then return direct, "direct_numeric_key" end
  direct = safeField(allLines, tostring(idValue))
  if hasReadableStopsCandidate(direct) then return direct, "direct_string_key" end

  if type(allLines) == "table" then
    for k, v in pairs(allLines) do
      if tostring(k) == tostring(idValue) and hasReadableStopsCandidate(v) then return v, "pairs_key" end
      local vId = safeField(v, "id") or safeField(v, "entity") or safeField(v, "line")
      if tostring(vId) == tostring(idValue) and hasReadableStopsCandidate(v) then return v, "pairs_value_id" end
    end
  end

  -- Userdata collection fallback: try numeric positions. This may not find ID-keyed maps,
  -- but catches sol vectors of line detail objects.
  local len = safeLen(allLines)
  if len > 0 then
    for i = 1, len do
      local v = safeField(allLines, i)
      local vId = safeField(v, "id") or safeField(v, "entity") or safeField(v, "line")
      if tostring(vId) == tostring(idValue) and hasReadableStopsCandidate(v) then return v, "userdata_index_1_based" end
    end
    for i = 0, len - 1 do
      local v = safeField(allLines, i)
      local vId = safeField(v, "id") or safeField(v, "entity") or safeField(v, "line")
      if tostring(vId) == tostring(idValue) and hasReadableStopsCandidate(v) then return v, "userdata_index_0_based" end
    end
  end

  return nil
end

local function engineLineDetails(lineEntity, diag)
  if api == nil or api.engine == nil then return nil, "api.engine_not_available" end
  local idValue = safeTonumber(eid(lineEntity)) or lineEntity

  if api.engine.getLine ~= nil then
    local r, src = tryNativeLineDetail("api.engine.getLine(number)", function() return api.engine.getLine(idValue) end, idValue, diag)
    if r ~= nil then return r, src end
    local r2, src2 = tryNativeLineDetail("api.engine.getLine(entity)", function() return api.engine.getLine(lineEntity) end, idValue, diag)
    if r2 ~= nil then return r2, src2 end
  else
    diagPush(diag, "info", "line " .. tostring(idValue) .. " native stop probe unavailable: api.engine.getLine is nil in this game-script context")
  end

  if api.engine.getLines ~= nil then
    local ok, allLines = pcall(function() return api.engine.getLines() end)
    if ok then
      local found, mode = findLineInCollection(allLines, idValue, diag)
      if found ~= nil then
        diagPush(diag, "info", "line " .. tostring(idValue) .. " native stop probe OK via api.engine.getLines(" .. tostring(mode) .. ") (" .. describeLineDetailCandidate(found) .. ")")
        return found, "api.engine.getLines." .. tostring(mode)
      end
      diagPush(diag, "info", "line " .. tostring(idValue) .. " api.engine.getLines did not expose matching readable stops (collectionType=" .. tostring(type(allLines)) .. ", len=" .. tostring(safeLen(allLines)) .. ")")
    else
      diagPush(diag, "info", "line " .. tostring(idValue) .. " api.engine.getLines failed: " .. tostring(allLines))
    end
  else
    diagPush(diag, "info", "line " .. tostring(idValue) .. " native stop probe unavailable: api.engine.getLines is nil in this game-script context")
  end

  -- Some builds expose detail methods under lineSystem instead of api.engine directly.
  if api.engine.system ~= nil and api.engine.system.lineSystem ~= nil then
    local ls = api.engine.system.lineSystem
    if ls.getLine ~= nil then
      local r3, src3 = tryNativeLineDetail("api.engine.system.lineSystem.getLine(number)", function() return ls.getLine(idValue) end, idValue, diag)
      if r3 ~= nil then return r3, src3 end
    else
      diagPush(diag, "info", "line " .. tostring(idValue) .. " native stop probe unavailable: lineSystem.getLine is nil")
    end
    if ls.getLines ~= nil then
      local ok2, allLines2 = pcall(function() return ls.getLines() end)
      if ok2 then
        local found2, mode2 = findLineInCollection(allLines2, idValue, diag)
        if found2 ~= nil then
          diagPush(diag, "info", "line " .. tostring(idValue) .. " native stop probe OK via lineSystem.getLines(" .. tostring(mode2) .. ") (" .. describeLineDetailCandidate(found2) .. ")")
          return found2, "api.engine.system.lineSystem.getLines." .. tostring(mode2)
        end
        diagPush(diag, "info", "line " .. tostring(idValue) .. " lineSystem.getLines did not expose detail stops (collectionType=" .. tostring(type(allLines2)) .. ", len=" .. tostring(safeLen(allLines2)) .. ")")
      else
        diagPush(diag, "info", "line " .. tostring(idValue) .. " lineSystem.getLines detail probe failed: " .. tostring(allLines2))
      end
    end
  end

  return nil, "not_available"
end

local function interfaceStations(filter)
  if game == nil or game.interface == nil or game.interface.getStations == nil then return nil end
  local ok, result = pcall(function() return game.interface.getStations(filter) end)
  if ok then return result end
  return nil
end

local function interfaceName(entity)
  local info = interfaceEntity(entity)
  local name = safeField(info, "name")
  if name ~= nil and tostring(name) ~= "" then return tostring(name) end
  return nil
end

local function interfacePosition(entity)
  local info = interfaceEntity(entity)
  local pos = safeField(info, "position")
  if pos == nil then return nil end
  return { safeTonumber(pos[1]), safeTonumber(pos[2]), safeTonumber(pos[3]) }
end

local function tableKeys(t, limit)
  local out = {}
  if type(t) ~= "table" then return out end
  local n = 0
  for k, _ in pairs(t) do
    n = n + 1
    if limit == nil or n <= limit then out[#out + 1] = tostring(k) end
  end
  return out
end

local function rawIndex(value, key)
  if value == nil then return nil end
  local ok, result = pcall(function() return value[key] end)
  if ok then return result end
  return nil
end

local function vecToPlainTable(pos)
  if pos == nil then return nil end

  -- Normal Lua arrays from game.interface are 1-based: { x, y, z }.
  local x1 = safeTonumber(rawIndex(pos, 1))
  local y1 = safeTonumber(rawIndex(pos, 2))
  local z1 = safeTonumber(rawIndex(pos, 3))
  if x1 ~= nil and y1 ~= nil then return { x1, y1, z1 } end

  -- Some engine vec/userdata values may be named or zero-based.
  local x = safeTonumber(rawIndex(pos, "x")) or safeTonumber(rawIndex(pos, 0))
  local y = safeTonumber(rawIndex(pos, "y")) or safeTonumber(rawIndex(pos, 1))
  local z = safeTonumber(rawIndex(pos, "z")) or safeTonumber(rawIndex(pos, 2))
  if x == nil and y == nil and z == nil then return nil end
  return { x, y, z }
end

local function distance2d(a, b)
  a = vecToPlainTable(a)
  b = vecToPlainTable(b)
  if a == nil or b == nil or a[1] == nil or a[2] == nil or b[1] == nil or b[2] == nil then return nil end
  local dx = b[1] - a[1]
  local dy = b[2] - a[2]
  return math.sqrt(dx * dx + dy * dy)
end

local function distance3d(a, b)
  a = vecToPlainTable(a)
  b = vecToPlainTable(b)
  if a == nil or b == nil or a[1] == nil or a[2] == nil or b[1] == nil or b[2] == nil then return nil end
  local az = a[3] or 0
  local bz = b[3] or 0
  local dx = b[1] - a[1]
  local dy = b[2] - a[2]
  local dz = bz - az
  return math.sqrt(dx * dx + dy * dy + dz * dz)
end

local function roundedNumber(value, decimals)
  local n = safeTonumber(value)
  if n == nil then return nil end
  local factor = 1
  for _ = 1, decimals or 0 do factor = factor * 10 end
  return math.floor(n * factor + 0.5) / factor
end

local function clamp01(value)
  local n = safeTonumber(value)
  if n == nil then return nil end
  if n < 0 then return 0 end
  if n > 1 then return 1 end
  return n
end

local function roundCoord(value)
  return roundedNumber(value, 6)
end

local function sortedKeys(t)
  local keys = {}
  if type(t) ~= "table" then return keys end
  for k, _ in pairs(t) do keys[#keys + 1] = k end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  return keys
end

local function positiveNumber(value)
  local n = safeTonumber(value)
  if n ~= nil and n > 0 then return n end
  return nil
end

local function kmhToMetersPerSecond(kmh)
  local n = positiveNumber(kmh)
  if n == nil then return nil end
  return n / 3.6
end

local function estimateSecondsFromDistance(distanceGameUnits, speedKmh)
  local distanceUnits = positiveNumber(distanceGameUnits)
  local metersPerUnit = positiveNumber(EXPERIMENTAL_DISTANCE_SCALE.meters_per_game_unit) or 1.0
  local speedMps = kmhToMetersPerSecond(speedKmh or EXPERIMENTAL_SPEED_PROFILE.default_kmh)
  if distanceUnits == nil or speedMps == nil then return nil end
  return (distanceUnits * metersPerUnit) / speedMps
end

local function detourFactorForMode(mode)
  if mode ~= nil and EXPERIMENTAL_DETOUR_FACTOR[mode] ~= nil then return EXPERIMENTAL_DETOUR_FACTOR[mode] end
  return EXPERIMENTAL_DETOUR_FACTOR.default or 1.2
end

local function estimateSecondsFromMeters(distanceMeters, speedKmh)
  local meters = positiveNumber(distanceMeters)
  local speedMps = kmhToMetersPerSecond(speedKmh or EXPERIMENTAL_SPEED_PROFILE.default_kmh)
  if meters == nil or speedMps == nil then return nil end
  return meters / speedMps
end

local function secondsToIsoDuration(seconds)
  local s = safeTonumber(seconds)
  if s == nil then return nil end
  s = math.floor(s + 0.5)
  local h = math.floor(s / 3600)
  local m = math.floor((s - h * 3600) / 60)
  local r = s - h * 3600 - m * 60
  if h > 0 then return string.format("PT%dH%dM%dS", h, m, r) end
  if m > 0 then return string.format("PT%dM%dS", m, r) end
  return string.format("PT%dS", r)
end

local function containsNumber(values, target)
  if type(values) ~= "table" then return false end
  local wanted = safeTonumber(target)
  if wanted == nil then return false end
  for _, value in pairs(values) do
    local n = safeTonumber(value)
    if n == wanted then return true end
  end
  return false
end

local function inferModeForSpeed(line, fromStop, toStop)
  local modes = safeField(line, "transport_modes") or {}
  if containsNumber(modes, 9) or containsNumber(modes, 11) then return "aircraft", EXPERIMENTAL_SPEED_PROFILE.aircraft_kmh, "tf2_api_line_transport_modes" end
  if containsNumber(modes, 10) or containsNumber(modes, 12) then return "ship", EXPERIMENTAL_SPEED_PROFILE.ship_kmh, "tf2_api_line_transport_modes" end
  if containsNumber(modes, 5) or containsNumber(modes, 6) then return "tram", EXPERIMENTAL_SPEED_PROFILE.tram_kmh, "tf2_api_line_transport_modes" end
  if containsNumber(modes, 3) or containsNumber(modes, 4) then return "road", EXPERIMENTAL_SPEED_PROFILE.road_kmh, "tf2_api_line_transport_modes" end
  if containsNumber(modes, 7) or containsNumber(modes, 8) then return "rail", EXPERIMENTAL_SPEED_PROFILE.rail_kmh, "tf2_api_line_transport_modes" end

  -- Fallback for v0.6/v0.7 saves where line.transport_modes is empty:
  -- if the station/group carrier exposes RAIL at either end, use rail profile.
  local fromCarriers = safeField(fromStop, "carriers")
  local toCarriers = safeField(toStop, "carriers")
  if (type(fromCarriers) == "table" and fromCarriers.RAIL == true) or (type(toCarriers) == "table" and toCarriers.RAIL == true) then
    return "rail", EXPERIMENTAL_SPEED_PROFILE.rail_kmh, "computed_experimental_inferred_from_station_carriers"
  end

  return "default", EXPERIMENTAL_SPEED_PROFILE.default_kmh, "computed_experimental_default_profile"
end

local function getName(entity)
  local ifaceName = interfaceName(entity)
  if ifaceName ~= nil then return ifaceName end
  local comp = getComponent(entity, CT_NAME)
  local name = safeField(comp, "name")
  if name ~= nil then return tostring(name) end
  return "#" .. tostring(eid(entity) or "?")
end

local function arrayGet(source, index)
  if source == nil then return nil end
  local ok, result = pcall(function() return source[index] end)
  if ok then return result end
  return nil
end

local function arrayLen(source)
  if source == nil then return nil end
  local ok, result = pcall(function() return #source end)
  if ok and type(result) == "number" then return result end
  return nil
end

local function addConverted(result, seen, value, converter)
  if value == nil then return end
  local converted = converter and converter(value) or value
  if converted == nil then return end
  local key = tostring(converted)
  if seen[key] then return end
  seen[key] = true
  result[#result + 1] = converted
end

-- TF2 API docs describe many returns as {Entity,...}, but in practice some
-- builds expose them to Lua as sol userdata containers. These can often still
-- be read with #container and container[index]. This helper supports both.
local function copyArrayValues(source, converter)
  local result = {}
  local seen = {}
  if source == nil then return result end

  if type(source) == "table" then
    -- First preserve normal array order.
    local maxIndex = 0
    for k, _ in pairs(source) do
      if type(k) == "number" and k > maxIndex then maxIndex = k end
    end
    if maxIndex > 0 then
      for i = 1, maxIndex do addConverted(result, seen, source[i], converter) end
      -- Some TF2/sol arrays are effectively zero-based even if table-like.
      for i = 0, maxIndex - 1 do addConverted(result, seen, source[i], converter) end
    else
      for _, v in pairs(source) do addConverted(result, seen, v, converter) end
    end
    return result
  end

  local len = arrayLen(source)
  if len ~= nil and len > 0 then
    -- Try both Lua style 1..n and C++/sol style 0..n-1, with de-duplication.
    for i = 1, len do addConverted(result, seen, arrayGet(source, i), converter) end
    for i = 0, len - 1 do addConverted(result, seen, arrayGet(source, i), converter) end
  end
  return result
end

local function copyEntityArray(source)
  return copyArrayValues(source, eid)
end

local function copyArrayValuesOrdered(source, converter)
  local function convert(v)
    if v == nil then return nil end
    if converter then return converter(v) end
    return v
  end

  local result = {}
  if source == nil then return result end

  if type(source) == "table" then
    local maxIndex = 0
    for k, _ in pairs(source) do
      if type(k) == "number" and k > maxIndex then maxIndex = k end
    end
    if maxIndex > 0 then
      -- Normal Lua tables returned by game.interface are 1-based; preserve duplicates and order.
      for i = 1, maxIndex do
        local converted = convert(source[i])
        if converted ~= nil then result[#result + 1] = converted end
      end
      return result
    end
    for _, v in pairs(source) do
      local converted = convert(v)
      if converted ~= nil then result[#result + 1] = converted end
    end
    return result
  end

  local len = arrayLen(source)
  if len ~= nil and len > 0 then
    local oneBased = {}
    local zeroBased = {}
    for i = 1, len do
      local converted = convert(arrayGet(source, i))
      if converted ~= nil then oneBased[#oneBased + 1] = converted end
    end
    for i = 0, len - 1 do
      local converted = convert(arrayGet(source, i))
      if converted ~= nil then zeroBased[#zeroBased + 1] = converted end
    end
    if #oneBased >= #zeroBased then return oneBased end
    return zeroBased
  end

  return result
end

local function copyEntityArrayOrdered(source)
  return copyArrayValuesOrdered(source, eid)
end

local function copyNumberArray(source)
  return copyArrayValues(source, function(v)
    local n = safeTonumber(v)
    return n or safeToString(v)
  end)
end

local function vecValue(vec, key)
  if vec == nil then return nil end
  local ok, result = pcall(function() return vec[key] end)
  if ok and result ~= nil then return safeTonumber(result) end
  return nil
end

local function colorToTable(comp)
  if comp == nil then return nil end
  local c = safeField(comp, "color") or comp
  local r = vecValue(c, "x") or vecValue(c, 0) or vecValue(c, 1)
  local g = vecValue(c, "y") or vecValue(c, 1) or vecValue(c, 2)
  local b = vecValue(c, "z") or vecValue(c, 2) or vecValue(c, 3)
  local a = vecValue(c, "w") or vecValue(c, 3) or vecValue(c, 4)
  return { raw = safeToString(c), r = r, g = g, b = b, a = a }
end

local function colorHexFromRgb(r, g, b)
  local rr = math.floor((safeTonumber(r) or 0) + 0.5)
  local gg = math.floor((safeTonumber(g) or 0) + 0.5)
  local bb = math.floor((safeTonumber(b) or 0) + 0.5)
  if rr < 0 then rr = 0 elseif rr > 255 then rr = 255 end
  if gg < 0 then gg = 0 elseif gg > 255 then gg = 255 end
  if bb < 0 then bb = 0 elseif bb > 255 then bb = 255 end
  return string.format("#%02X%02X%02X", rr, gg, bb)
end

local function lineColorFallback(lineEntity)
  local idn = safeTonumber(eid(lineEntity)) or 1
  local idx = (math.floor(idn) % #DISPLAY_COLOR_PALETTE) + 1
  local c = DISPLAY_COLOR_PALETTE[idx]
  return { r = c.r, g = c.g, b = c.b, a = c.a, hex = c.hex, origin = "computed_experimental_palette_fallback" }
end

local function normalizeColorForDisplay(color, lineEntity)
  if type(color) == "table" then
    local r = safeTonumber(color.r)
    local g = safeTonumber(color.g)
    local b = safeTonumber(color.b)
    local a = safeTonumber(color.a)
    if r ~= nil and g ~= nil and b ~= nil then
      -- TF2 colors may be 0..1 floats or 0..255 values depending on source. Normalize for web output.
      if r <= 1.0 and g <= 1.0 and b <= 1.0 then
        r, g, b = r * 255.0, g * 255.0, b * 255.0
        if a ~= nil and a <= 1.0 then a = a * 255.0 end
      end
      return { r = roundedNumber(r, 0), g = roundedNumber(g, 0), b = roundedNumber(b, 0), a = roundedNumber(a or 255, 0), hex = colorHexFromRgb(r, g, b), origin = "tf2_api_color_component" }
    end
  end
  return lineColorFallback(lineEntity)
end

local function keyForPair(a, b)
  return tostring(a or "?") .. ">" .. tostring(b or "?")
end

local function tableCount(t)
  local n = 0
  if type(t) ~= "table" then return 0 end
  for _, _ in pairs(t) do n = n + 1 end
  return n
end

-- Export helpers ------------------------------------------------------------

local function getStationGroupStations(stationGroupEntity)
  -- Primary: game.interface gives stable STATION_GROUP data with a plain Lua stops/stations table.
  local groupInfo = interfaceEntity(stationGroupEntity)
  local ifaceStations = safeField(groupInfo, "stations")
  local ifaceResult = copyArrayValues(ifaceStations, function(v) return v end)
  if #ifaceResult > 0 then return ifaceResult, "game.interface" end

  -- Fallback: engine component, if exposed by the current game build.
  local groupComp = getComponent(stationGroupEntity, CT_STATION_GROUP)
  local stations = safeField(groupComp, "stations")
  return copyArrayValues(stations, function(v) return v end), "component"
end

local function getStationEntityFromStop(stop)
  if stop == nil then return nil end
  local stationGroupEntity = safeField(stop, "stationGroup")
  if stationGroupEntity == nil then return nil end
  local stationRaw = safeField(stop, "station")
  local stationIndex = safeTonumber(stationRaw)
  local stations = getStationGroupStations(stationGroupEntity)
  if stationIndex ~= nil then
    return stations[stationIndex + 1] or stations[stationIndex]
  end
  return nil
end

local function getStationIndexInGroup(stationGroupEntity, stationEntity)
  local target = eid(stationEntity)
  local stations = getStationGroupStations(stationGroupEntity)
  for idx, s in pairs(stations) do
    if eid(s) == target then
      local n = safeTonumber(idx)
      if n ~= nil then return n - 1, n end
      return nil, idx
    end
  end
  return nil, nil
end

local function mergeCarrierFlags(target, source)
  local any = false
  if type(source) ~= "table" then return target, any end
  for k, v in pairs(source) do
    if v == true then
      target[k] = true
      any = true
    end
  end
  return target, any
end

local function carriersForStationIds(stationIds)
  local result = {}
  local any = false
  for _, stationId in ipairs(stationIds or {}) do
    local stationInfo = interfaceEntity(stationId)
    local carriers = safeField(stationInfo, "carriers")
    local _, found = mergeCarrierFlags(result, carriers)
    if found then any = true end
  end
  if any then return result end
  return nil
end

local function carriersForStop(stationGroupEntity, stationEntity, stationIds)
  local groupInfo = interfaceEntity(stationGroupEntity)
  local groupCarriers = safeField(groupInfo, "carriers")
  if type(groupCarriers) == "table" then return groupCarriers end

  if stationEntity ~= nil then
    local stationCarriers = safeField(interfaceEntity(stationEntity), "carriers")
    if type(stationCarriers) == "table" then return stationCarriers end
  end

  local byIds = carriersForStationIds(stationIds)
  if byIds ~= nil then return byIds end
  return nil
end

local function exportOneStation(stationEntity, groupsById, diag)
  local stationComp = getComponent(stationEntity, CT_STATION)
  local stationGroupEntity = nil

  local okGroup, groupResult = pcall(function()
    return api.engine.system.stationGroupSystem.getStationGroup(stationEntity)
  end)
  if okGroup then stationGroupEntity = groupResult else diagPush(diag, "warn", "stationGroup lookup failed for station " .. tostring(eid(stationEntity)) .. ": " .. tostring(groupResult)) end

  local stationIndex0, luaIndex = getStationIndexInGroup(stationGroupEntity, stationEntity)
  local terminals = safeField(stationComp, "terminals")

  local stationInfo = interfaceEntity(stationEntity)
  local stationData = {
    _origin = { record = "tf2_api", note = "Station entity exported from TF2 via api.engine/game.interface." },
    id = eid(stationEntity),
    name = getName(stationEntity),
    type = safeField(stationInfo, "type") or "STATION",
    position = safeField(stationInfo, "position") or interfacePosition(stationEntity),
    carriers = safeField(stationInfo, "carriers"),
    town_id = safeField(stationInfo, "town"),
    station_group_id = eid(stationGroupEntity or safeField(stationInfo, "stationGroup")),
    station_group_name = (stationGroupEntity and getName(stationGroupEntity)) or getName(safeField(stationInfo, "stationGroup")),
    station_index0 = stationIndex0,
    station_lua_index = luaIndex,
    cargo = safeField(stationInfo, "cargo"),
    terminal_count = safeLen(terminals),
    tag = safeToString(safeField(stationComp, "tag")),
  }

  if stationGroupEntity ~= nil then
    local gid = tostring(eid(stationGroupEntity))
    if groupsById[gid] == nil then
      local groupInfo = interfaceEntity(stationGroupEntity)
      groupsById[gid] = {
        _origin = { record = "tf2_api", note = "Station group exported from TF2 via api.engine/game.interface." },
        id = eid(stationGroupEntity),
        name = getName(stationGroupEntity),
        type = safeField(groupInfo, "type") or "STATION_GROUP",
        position = safeField(groupInfo, "position") or interfacePosition(stationGroupEntity),
        station_ids = copyEntityArray(getStationGroupStations(stationGroupEntity)),
      }
    end
  end

  return stationData
end

local function exportStations(diag)
  local stations = {}
  local groupsById = {}

  if api.engine.system.stationSystem == nil or api.engine.system.stationSystem.forEach == nil then
    diagPush(diag, "error", "stationSystem.forEach not available")
    return stations, {}
  end

  local okForEach, errForEach = pcall(function()
    api.engine.system.stationSystem.forEach(function(stationEntity)
      local okStation, stationDataOrErr = pcall(function()
        return exportOneStation(stationEntity, groupsById, diag)
      end)
      if okStation and stationDataOrErr ~= nil then
        stations[#stations + 1] = stationDataOrErr
      else
        diagPush(diag, "warn", "station export skipped for entity " .. tostring(eid(stationEntity)) .. ": " .. tostring(stationDataOrErr))
      end
    end)
  end)

  if not okForEach then
    diagPush(diag, "error", "stationSystem.forEach failed: " .. tostring(errForEach))
  end

  local groups = {}
  for _, group in pairs(groupsById) do groups[#groups + 1] = group end
  return stations, groups
end

local function normalizeLineIds(raw, label, diag)
  local ids = copyEntityArray(raw)
  local len = arrayLen(raw)
  diagPush(diag, "info", label .. " returned type=" .. tostring(type(raw)) .. ", len=" .. tostring(len or "?") .. ", collected=" .. tostring(#ids))
  return ids
end

local function getLineIds(diag)
  local okPlayer, resultPlayer = pcall(function()
    return api.engine.system.lineSystem.getLinesForPlayer(api.engine.util.getPlayer())
  end)
  if okPlayer then
    local ids = normalizeLineIds(resultPlayer, "getLinesForPlayer", diag)
    if #ids > 0 then return ids, "getLinesForPlayer" end
  else
    diagPush(diag, "warn", "getLinesForPlayer failed, trying getLines: " .. tostring(resultPlayer))
  end

  local okAll, resultAll = pcall(function()
    return api.engine.system.lineSystem.getLines()
  end)
  if okAll then
    local ids = normalizeLineIds(resultAll, "getLines", diag)
    if #ids > 0 then return ids, "getLines" end
    diagPush(diag, "warn", "getLines returned no collectable line IDs. raw=" .. tostring(resultAll))
  else
    diagPush(diag, "error", "getLines failed: " .. tostring(resultAll))
  end

  -- Extra fallback: enumerate entities that carry the LINE component.
  -- Depending on game build/state, lineSystem.getLines* may expose an opaque userdata
  -- container that cannot be indexed from Lua. The component scan is slower but fine
  -- for one-shot export and gives us another way out.
  if api.engine.forEachEntityWithComponent ~= nil and CT_LINE ~= nil then
    local collected = {}
    local okEach, errEach = pcall(function()
      api.engine.forEachEntityWithComponent(function(entity)
        collected[#collected + 1] = eid(entity)
      end, CT_LINE)
    end)
    if (not okEach) or #collected == 0 then
      local okEach2, errEach2 = pcall(function()
        api.engine.forEachEntityWithComponent(CT_LINE, function(entity)
          collected[#collected + 1] = eid(entity)
        end)
      end)
      if not okEach2 then
        diagPush(diag, "warn", "forEachEntityWithComponent LINE fallback failed: " .. tostring(errEach or errEach2))
      end
    end
    if #collected > 0 then
      diagPush(diag, "info", "LINE component fallback collected=" .. tostring(#collected))
      return collected, "forEachEntityWithComponent.LINE"
    end
  else
    diagPush(diag, "info", "LINE component fallback not available")
  end

  local rawInterfaceLines = interfaceLines(nil)
  local interfaceIds = copyEntityArray(rawInterfaceLines)
  diagPush(diag, "info", "game.interface.getLines returned type=" .. tostring(type(rawInterfaceLines)) .. ", len=" .. tostring(arrayLen(rawInterfaceLines) or "?") .. ", collected=" .. tostring(#interfaceIds))
  if #interfaceIds > 0 then return interfaceIds, "game.interface.getLines" end

  return {}, "none"
end

local function exportLineStopFromEngineLineStop(stopIndex, stop, lineApiSource)
  local stationGroupRaw = safeField(stop, "stationGroup") or safeField(stop, "station")
  local stationGroupId = eid(stationGroupRaw)
  local stationGroupInfo = interfaceEntity(stationGroupId)
  local stationIds = copyEntityArray(safeField(stationGroupInfo, "stations"))
  local bestStationId = (#stationIds == 1) and stationIds[1] or nil
  local terminalIndex = safeTonumber(safeField(stop, "terminal"))
  local platformNumber = terminalIndex ~= nil and (terminalIndex + 1) or nil
  local platformDisplay = platformNumber ~= nil and ("Gleis " .. tostring(platformNumber)) or nil
  local alternativeTerminals = safeField(stop, "alternativeTerminals")
  local waypoints = safeField(stop, "waypoints")

  return {
    _origin = { record = "tf2_api", note = "Stop exported from native api.engine line data. stop.station is treated as station group id; stop.terminal is native 0-based platform index." },
    index = stopIndex,
    source = (lineApiSource or "api.engine.getLine") .. ".stops",
    station_group_id = stationGroupId,
    station_group_name = stationGroupId ~= nil and getName(stationGroupId) or nil,
    station_group_position = safeField(stationGroupInfo, "position") or interfacePosition(stationGroupId),
    station_ids = stationIds,
    carriers = carriersForStop(stationGroupId, nil, stationIds),
    carrier_origin = "tf2_api_best_effort_station_carriers_from_native_engine_stop_station",
    native_stop_station_id = stationGroupId,
    native_stop_station_id_kind = "station_group",
    station_index_raw = safeField(stop, "station"),
    station_entity_id = bestStationId,
    station_name = bestStationId ~= nil and getName(bestStationId) or nil,

    terminal = terminalIndex,
    terminal_index0 = terminalIndex,
    terminal_number = platformNumber,
    terminal_origin = terminalIndex ~= nil and "tf2_api.api.engine.getLine.stops[].terminal_zero_based" or "not_available_in_api_engine_line_stop",

    platform = terminalIndex,
    platform_index0 = terminalIndex,
    platform_number = platformNumber,
    platform_display = platformDisplay,
    platform_origin = terminalIndex ~= nil and "tf2_api.api.engine.getLine.stops[].terminal_zero_based" or "not_available_in_api_engine_line_stop",
    platform_display_origin = terminalIndex ~= nil and "computed_from_tf2_native_terminal_zero_based_plus_one" or "not_available_in_api_engine_line_stop",

    track = terminalIndex,
    track_index0 = terminalIndex,
    track_number = platformNumber,
    track_display = platformDisplay,
    track_origin = terminalIndex ~= nil and "tf2_api.api.engine.getLine.stops[].terminal_zero_based" or "not_available_in_api_engine_line_stop",

    boarding_station_id_best_effort = bestStationId,
    boarding_station_id_origin = bestStationId ~= nil and "computed_experimental.single_station_group_fallback_from_native_engine_stop_station_group" or "not_available_multiple_or_empty_station_group",
    terminal_resolution_status = terminalIndex ~= nil and "native_terminal_from_api_engine_getLine" or (bestStationId ~= nil and "native_station_without_terminal" or "unresolved"),
    alternative_terminals_count = safeLen(alternativeTerminals),
    min_waiting_time = safeField(stop, "minWaitingTime"),
    max_waiting_time = safeField(stop, "maxWaitingTime"),
    waypoint_ids = copyEntityArray(waypoints),
  }
end

local function exportLineStop(stopIndex, stop)
  local stationGroupEntity = safeField(stop, "stationGroup")
  local stationEntity = getStationEntityFromStop(stop)
  local alternativeTerminals = safeField(stop, "alternativeTerminals")
  local waypoints = safeField(stop, "waypoints")
  local terminal = safeField(stop, "terminal")
  local platform = safeField(stop, "platform") or safeField(stop, "platformIndex")
  local track = safeField(stop, "track") or safeField(stop, "trackIndex")
  local stationId = eid(stationEntity)

  return {
    _origin = { record = "tf2_api", note = "Stop exported from TF2 Line component; terminal/wait fields are native when present." },
    index = stopIndex,
    source = "component.Line.stops",
    station_group_id = eid(stationGroupEntity),
    station_group_name = stationGroupEntity and getName(stationGroupEntity) or nil,
    station_group_position = stationGroupEntity and interfacePosition(stationGroupEntity) or nil,
    carriers = carriersForStop(stationGroupEntity, stationEntity, stationId ~= nil and { stationId } or nil),
    carrier_origin = "tf2_api_best_effort_station_or_station_group_carriers",
    station_index_raw = safeField(stop, "station"),
    station_entity_id = stationId,
    station_name = stationEntity and getName(stationEntity) or nil,
    terminal = terminal,
    terminal_origin = terminal ~= nil and "tf2_api_component.Line.stop.terminal" or "not_available_in_component_stop",
    platform = platform,
    platform_origin = platform ~= nil and "tf2_api_component.Line.stop.platform" or "not_available_in_component_stop",
    track = track,
    track_origin = track ~= nil and "tf2_api_component.Line.stop.track" or "not_available_in_component_stop",
    boarding_station_id_best_effort = stationId,
    boarding_station_id_origin = stationId ~= nil and "tf2_api_component.Line.stop.station" or "not_available_in_current_stop_source",
    terminal_resolution_status = terminal ~= nil and "native_terminal" or (stationId ~= nil and "native_station_without_terminal" or "unresolved"),
    alternative_terminals_count = safeLen(alternativeTerminals),
    min_waiting_time = safeField(stop, "minWaitingTime"),
    max_waiting_time = safeField(stop, "maxWaitingTime"),
    waypoint_ids = copyEntityArray(waypoints),
  }
end

local function exportLineStopFromStationGroup(stopIndex, stationGroupEntity)
  local groupInfo = interfaceEntity(stationGroupEntity)
  local stationIds = copyEntityArray(safeField(groupInfo, "stations"))
  local bestStationId = (#stationIds == 1) and stationIds[1] or nil
  return {
    _origin = { record = "tf2_api_best_effort", note = "Stop exported from game.interface LINE.stops. Native terminal/platform fields are not exposed in this source; v1.2 adds a single-station-group boarding fallback when possible." },
    index = stopIndex,
    source = "game.interface.LINE.stops",
    station_group_id = eid(stationGroupEntity),
    station_group_name = getName(stationGroupEntity),
    station_group_position = safeField(groupInfo, "position") or interfacePosition(stationGroupEntity),
    station_ids = stationIds,
    carriers = carriersForStop(stationGroupEntity, nil, stationIds),
    carrier_origin = "tf2_api_best_effort_station_carriers_from_station_group",
    terminal = nil,
    terminal_origin = "not_available_in_game.interface.LINE.stops",
    platform = nil,
    platform_origin = "not_available_in_game.interface.LINE.stops",
    track = nil,
    track_origin = "not_available_in_game.interface.LINE.stops",
    boarding_station_id_best_effort = bestStationId,
    boarding_station_id_origin = bestStationId ~= nil and "computed_experimental.single_station_group_fallback" or "not_available_multiple_or_empty_station_group",
    terminal_resolution_status = bestStationId ~= nil and "single_station_group_boarding_station_fallback" or "unresolved_no_native_terminal",
    station_index_raw = nil,
    station_entity_id = bestStationId,
    station_name = bestStationId ~= nil and getName(bestStationId) or nil,
  }
end

local function inferLineModeFromStops(line)
  local modes = safeField(line, "transport_modes") or {}
  if containsNumber(modes, 9) or containsNumber(modes, 11) then return "aircraft", "tf2_api_line_transport_modes" end
  if containsNumber(modes, 10) or containsNumber(modes, 12) then return "ship", "tf2_api_line_transport_modes" end
  if containsNumber(modes, 5) or containsNumber(modes, 6) then return "tram", "tf2_api_line_transport_modes" end
  if containsNumber(modes, 3) or containsNumber(modes, 4) then return "road", "tf2_api_line_transport_modes" end
  if containsNumber(modes, 7) or containsNumber(modes, 8) then return "rail", "tf2_api_line_transport_modes" end

  local rail, road, tram, water, air = 0, 0, 0, 0, 0
  for _, stop in ipairs(safeField(line, "stops") or {}) do
    local carriers = safeField(stop, "carriers")
    if type(carriers) == "table" then
      if carriers.RAIL == true then rail = rail + 1 end
      if carriers.ROAD == true then road = road + 1 end
      if carriers.TRAM == true then tram = tram + 1 end
      if carriers.WATER == true then water = water + 1 end
      if carriers.AIR == true then air = air + 1 end
    end
  end

  local bestMode, bestScore = "default", 0
  local scores = { rail = rail, road = road, tram = tram, ship = water, aircraft = air }
  for mode, score in pairs(scores) do
    if score > bestScore then bestMode, bestScore = mode, score end
  end
  if bestScore > 0 then return bestMode, "computed_experimental_inferred_from_station_carriers" end
  return "default", "computed_experimental_default_profile"
end

local function transportModeNumbersForProfile(profile)
  -- TF2 transport_mode_reference in this exporter:
  -- BUS=3, TRAM=5, TRAIN=7, ELECTRIC_TRAIN=8, AIRCRAFT=9, SHIP=10.
  -- These are best-effort fallbacks and are intentionally marked as computed_experimental.
  if profile == "rail" then return { 7 } end
  if profile == "road" then return { 3 } end
  if profile == "tram" then return { 5 } end
  if profile == "ship" then return { 10 } end
  if profile == "aircraft" then return { 9 } end
  return {}
end

local function firstArrayValue(values)
  if type(values) ~= "table" then return nil end
  for i = 1, #values do
    if values[i] ~= nil then return values[i] end
  end
  return nil
end

-- Forward declarations: these helpers are used by line export and later graph builders.
-- In Lua, local functions declared later are not visible to functions defined earlier,
-- so assigning them below avoids accidental global lookup failures.
local stopGroupId
local stopGroupName
local stopGroupPosition

local function summarizeStopNames(stops, limit)
  local names = {}
  local max = limit or 999999
  for i, stop in ipairs(stops or {}) do
    if i <= max then names[#names + 1] = stopGroupName(stop) or tostring(stopGroupId(stop) or "?") end
  end
  return names
end

local function exportOneLine(lineEntity, diag)
  local lineComp = getComponent(lineEntity, CT_LINE)
  local colorComp = getComponent(lineEntity, CT_COLOR)
  local lineInterface = interfaceEntity(lineEntity)

  local line = {
    _origin = { record = "tf2_api", note = "Line exported from TF2 via lineSystem plus game.interface fallback." },
    id = eid(lineEntity),
    name = safeField(lineInterface, "name") or getName(lineEntity),
    type = safeField(lineInterface, "type") or "LINE",
    color = colorToTable(colorComp),
    display_color = normalizeColorForDisplay(colorToTable(colorComp), lineEntity),
    transport_modes = {},
    default_price = nil,
    rate = safeField(lineInterface, "rate"),
    frequency = safeField(lineInterface, "frequency"),
    items_transported = safeField(lineInterface, "itemsTransported"),
    interface_keys = tableKeys(lineInterface, 30),
    stop_source = nil,
    stops = {},
  }

  local vehicleInfo = safeField(lineComp, "vehicleInfo")
  if vehicleInfo ~= nil then
    line.transport_modes = copyNumberArray(safeField(vehicleInfo, "transportModes"))
    line.default_price = safeField(vehicleInfo, "defaultPrice")
  end

  -- v1.2.2 highest-priority detail level: api.engine.getLine/getLines may expose
  -- native line stops with stop.station + stop.terminal. terminal is a 0-based platform index.
  local engineLine, engineLineSource = engineLineDetails(lineEntity, diag)
  local engineStopsRaw = safeField(engineLine, "stops")
  local engineStops = copyArrayValuesOrdered(engineStopsRaw, function(v) return v end)
  if #engineStops > 0 then
    line.stop_source = (engineLineSource or "api.engine.getLine") .. ".stops"
    line.native_stop_source_available = true
    line.native_stop_source_origin = "tf2_api." .. tostring(line.stop_source)
    for stopIndex, stop in ipairs(engineStops) do
      local okStop, stopDataOrErr = pcall(function() return exportLineStopFromEngineLineStop(stopIndex, stop, engineLineSource) end)
      if okStop and stopDataOrErr ~= nil then
        line.stops[#line.stops + 1] = stopDataOrErr
      else
        diagPush(diag, "warn", "native api.engine stop export skipped for line " .. tostring(eid(lineEntity)) .. " stop " .. tostring(stopIndex) .. ": " .. tostring(stopDataOrErr))
      end
    end
    diagPush(diag, "info", "line " .. tostring(eid(lineEntity)) .. " stops read via " .. tostring(line.stop_source) .. ": " .. tostring(#engineStops))
  else
    -- Second detail level: engine component gives full Stop objects when exposed by this build/context.
    local stopsRaw = safeField(lineComp, "stops")
    local stops = copyArrayValuesOrdered(stopsRaw, function(v) return v end)
    if #stops > 0 then
      line.stop_source = "component.Line.stops"
      for stopIndex, stop in ipairs(stops) do
        local okStop, stopDataOrErr = pcall(function() return exportLineStop(stopIndex, stop) end)
        if okStop and stopDataOrErr ~= nil then
          line.stops[#line.stops + 1] = stopDataOrErr
        else
          diagPush(diag, "warn", "stop export skipped for line " .. tostring(eid(lineEntity)) .. " stop " .. tostring(stopIndex) .. ": " .. tostring(stopDataOrErr))
        end
      end
    else
      -- Robust fallback: game.interface.LINE.stops is a sequence of STATION_GROUP ids.
      local ifaceStopsRaw = safeField(lineInterface, "stops")
      local ifaceStops = copyEntityArrayOrdered(ifaceStopsRaw)
      if #ifaceStops > 0 then
        line.stop_source = "game.interface.LINE.stops"
        for stopIndex, stationGroupId in ipairs(ifaceStops) do
          line.stops[#line.stops + 1] = exportLineStopFromStationGroup(stopIndex, stationGroupId)
        end
        diagPush(diag, "info", "line " .. tostring(eid(lineEntity)) .. " stops read via game.interface: " .. tostring(#ifaceStops))
      else
        line.stop_source = "none"
        diagPush(diag, "warn", "line " .. tostring(eid(lineEntity)) .. " has no readable stops. api.engine source=" .. tostring(engineLineSource) .. ", apiEngineLen=" .. tostring(arrayLen(engineStopsRaw) or "?") .. ", componentRawType=" .. tostring(type(stopsRaw)) .. ", componentLen=" .. tostring(arrayLen(stopsRaw) or "?") .. ", interfaceRawType=" .. tostring(type(ifaceStopsRaw)) .. ", interfaceLen=" .. tostring(arrayLen(ifaceStopsRaw) or "?"))
      end
    end
  end

  local nativeTransportModes = copyNumberArray(line.transport_modes)
  line.native_transport_modes = nativeTransportModes
  line.native_transport_modes_origin = (#nativeTransportModes > 0) and "tf2_api_line_vehicleInfo.transportModes" or "not_available_in_current_line_source"

  local inferredMode, inferredModeOrigin = inferLineModeFromStops(line)
  line.inferred_transport_mode_profile = inferredMode
  line.inferred_transport_mode_origin = inferredModeOrigin
  line.effective_transport_mode_profile = inferredMode
  line.effective_transport_mode_origin = inferredModeOrigin

  if #nativeTransportModes == 0 then
    line.transport_modes = transportModeNumbersForProfile(inferredMode)
    line.transport_modes_origin = (#line.transport_modes > 0) and "computed_experimental_inferred_from_stop_carriers" or "computed_experimental_default_profile"
  else
    line.transport_modes = nativeTransportModes
    line.transport_modes_origin = "tf2_api_line_vehicleInfo.transportModes"
  end

  line.stop_count = #(line.stops or {})
  line.unique_station_group_count = 0
  local uniqueGroups = {}
  for _, stop in ipairs(line.stops or {}) do
    local gid = stopGroupId(stop)
    if gid ~= nil then uniqueGroups[tostring(gid)] = true end
  end
  line.unique_station_group_count = tableCount(uniqueGroups)
  line.stop_names_preview = summarizeStopNames(line.stops, 12)
  line.backend_usage_note = "Use lines[].stops for preserved stop sequence; use segments/routing_edges for graph routing. Fields marked computed_experimental are backend-start estimates, not native timetable data."

  return line
end

local function exportLines(diag)
  local lines = {}

  if api.engine.system.lineSystem == nil then
    diagPush(diag, "error", "lineSystem not available")
    return lines, "none"
  end

  local lineIds, source = getLineIds(diag)
  for _, lineEntity in pairs(lineIds) do
    local okLine, lineDataOrErr = pcall(function()
      return exportOneLine(lineEntity, diag)
    end)
    if okLine and lineDataOrErr ~= nil then
      lines[#lines + 1] = lineDataOrErr
    else
      diagPush(diag, "warn", "line export skipped for entity " .. tostring(eid(lineEntity)) .. ": " .. tostring(lineDataOrErr))
    end
  end

  return lines, source
end

stopGroupId = function(stop)
  return safeField(stop, "station_group_id")
end

stopGroupName = function(stop)
  return safeField(stop, "station_group_name") or safeField(stop, "station_name")
end

stopGroupPosition = function(stop)
  return safeField(stop, "station_group_position")
end

local function buildCoordinateSystem(stationGroups)
  local minX, minY, maxX, maxY = nil, nil, nil, nil
  for _, group in ipairs(stationGroups or {}) do
    local pos = vecToPlainTable(safeField(group, "position"))
    if pos ~= nil and pos[1] ~= nil and pos[2] ~= nil then
      local x, y = pos[1], pos[2]
      if minX == nil or x < minX then minX = x end
      if maxX == nil or x > maxX then maxX = x end
      if minY == nil or y < minY then minY = y end
      if maxY == nil or y > maxY then maxY = y end
    end
  end
  local width = (minX ~= nil and maxX ~= nil) and (maxX - minX) or nil
  local height = (minY ~= nil and maxY ~= nil) and (maxY - minY) or nil
  return {
    _origin = { record = "computed_experimental", note = "Coordinate metadata calculated from TF2 station-group world positions. Raw coordinates are TF2 world coordinates; web coordinates are normalized and Y-inverted for SVG/Canvas." },
    raw_coordinate_system = "tf2_world_xy_z",
    raw_axis_note = "TF2 world coordinates can be negative and are not screen coordinates. Do not plot raw x/y directly without normalization and Y-axis handling.",
    recommended_for_web = "Use coordinates.web.x_0_1 and coordinates.web.y_0_1, or coordinates.svg_1000.x/y. Raw TF2 Y is converted to web Y by y_web = 1 - y_normalized.",
    bounding_box = { min_x = minX, min_y = minY, max_x = maxX, max_y = maxY, width = width, height = height },
    center = (minX ~= nil and maxX ~= nil and minY ~= nil and maxY ~= nil) and { x = (minX + maxX) / 2.0, y = (minY + maxY) / 2.0 } or nil,
    normalization = {
      x_0_1 = "(x - min_x) / width",
      y_0_1 = "(y - min_y) / height",
      y_web_0_1 = "1 - y_0_1",
      svg_1000 = "x = x_0_1 * 1000; y = y_web_0_1 * 1000"
    },
    experimental = true,
  }
end

local function buildCoordinatePackage(pos, coordinateSystem)
  local p = vecToPlainTable(pos)
  if p == nil or p[1] == nil or p[2] == nil then return nil end
  local bbox = safeField(coordinateSystem, "bounding_box") or {}
  local minX = safeTonumber(safeField(bbox, "min_x"))
  local minY = safeTonumber(safeField(bbox, "min_y"))
  local width = safeTonumber(safeField(bbox, "width"))
  local height = safeTonumber(safeField(bbox, "height"))
  local xn, yn = nil, nil
  if minX ~= nil and width ~= nil and width ~= 0 then xn = (p[1] - minX) / width end
  if minY ~= nil and height ~= nil and height ~= 0 then yn = (p[2] - minY) / height end
  xn = clamp01(xn)
  yn = clamp01(yn)
  local yw = yn ~= nil and (1.0 - yn) or nil
  return {
    _origin = { record = "tf2_api_plus_computed_projection", note = "world/raw values come from TF2; normalized/web/svg values are computed for reliable frontend plotting." },
    world = { x = roundCoord(p[1]), y = roundCoord(p[2]), z = roundCoord(p[3] or 0), array = { p[1], p[2], p[3] } },
    normalized = { x_0_1 = roundCoord(xn), y_0_1 = roundCoord(yn), x_percent = xn ~= nil and roundedNumber(xn * 100.0, 3) or nil, y_percent = yn ~= nil and roundedNumber(yn * 100.0, 3) or nil },
    web = { x_0_1 = roundCoord(xn), y_0_1 = roundCoord(yw), x_percent = xn ~= nil and roundedNumber(xn * 100.0, 3) or nil, y_percent = yw ~= nil and roundedNumber(yw * 100.0, 3) or nil, y_axis = "down", note = "Use this for browser/SVG/Canvas plotting." },
    svg_1000 = { x = xn ~= nil and roundedNumber(xn * 1000.0, 2) or nil, y = yw ~= nil and roundedNumber(yw * 1000.0, 2) or nil, view_box = "0 0 1000 1000" },
  }
end

local function collectStationIdsForGroup(group, stations)
  local ids = copyEntityArray(safeField(group, "station_ids"))
  if #ids > 0 then return ids end
  local gid = tostring(safeField(group, "id") or "")
  for _, station in ipairs(stations or {}) do
    if tostring(safeField(station, "station_group_id") or "") == gid then
      ids[#ids + 1] = safeField(station, "id")
    end
  end
  return ids
end

local function buildStationCanonical(stationGroups, stations, lines, routingPackage, coordinateSystem)
  local stationsByGroup = {}
  for _, station in ipairs(stations or {}) do
    local gid = safeField(station, "station_group_id")
    if gid ~= nil then
      local key = tostring(gid)
      if stationsByGroup[key] == nil then stationsByGroup[key] = {} end
      stationsByGroup[key][#stationsByGroup[key] + 1] = station
    end
  end

  local nodeByGroup = {}
  for _, node in ipairs(safeField(routingPackage, "routing_nodes") or {}) do
    nodeByGroup[tostring(safeField(node, "id") or "")] = node
  end

  local lineIndexByGroup = {}
  for _, entry in ipairs(safeField(routingPackage, "station_line_index") or {}) do
    lineIndexByGroup[tostring(safeField(entry, "station_group_id") or "")] = entry
  end

  local result = {}
  for _, group in ipairs(stationGroups or {}) do
    local gid = safeField(group, "id")
    local key = tostring(gid or "")
    local stationList = stationsByGroup[key] or {}
    local stationIds = collectStationIdsForGroup(group, stationList)
    local primaryStation = stationList[1]
    local primaryStationId = safeField(primaryStation, "id") or stationIds[1]
    local pos = safeField(group, "position")
    local coords = buildCoordinatePackage(pos, coordinateSystem)
    local node = nodeByGroup[key] or {}
    local lineIndex = lineIndexByGroup[key] or { lines = {} }
    local stationEntries = {}
    for _, station in ipairs(stationList) do
      stationEntries[#stationEntries + 1] = {
        station_id = safeField(station, "id"),
        name = safeField(station, "name"),
        carriers = safeField(station, "carriers"),
        position = vecToPlainTable(safeField(station, "position")),
        coordinates = buildCoordinatePackage(safeField(station, "position"), coordinateSystem),
        terminal_count = safeField(station, "terminal_count"),
        station_index0 = safeField(station, "station_index0"),
      }
    end

    result[#result + 1] = {
      _origin = { record = "tf2_api_plus_computed_projection", note = "Canonical Bahnhof record for backend/frontend. Station group and raw position are TF2 data; normalized/web coordinates are computed." },
      type = "BAHNHOF",
      id = gid,
      station_group_id = gid,
      name = safeField(group, "name"),
      display_name = safeField(group, "name"),
      primary_station_id = primaryStationId,
      primary_station_name = primaryStationId ~= nil and getName(primaryStationId) or nil,
      station_ids = stationIds,
      stations = stationEntries,
      carriers = (#stationEntries > 0 and safeField(stationEntries[1], "carriers")) or nil,
      position = vecToPlainTable(pos),
      coordinates = coords,
      served_by_lines = safeField(node, "served_by_lines") or {},
      served_by_line_names = safeField(node, "served_by_line_names") or {},
      line_index = safeField(lineIndex, "lines") or {},
      interchange = safeField(node, "interchange") or false,
      degree = safeField(node, "degree") or 0,
      frontend_plot_hint = "Use coordinates.web or coordinates.svg_1000, not raw position, for direct browser plotting.",
    }
  end
  return result
end


-- v1.3.0: Native terminal scan after the normal line export.
-- The official lineSystem exposes terminal-centric lookup helpers such as
-- getLineStopsForTerminal(stationEntity, terminal) and getLineStopsForStation(stationEntity).
-- This is exactly the missing bridge when game.interface.LINE.stops only gives station groups:
-- we keep the stable stop sequence, then enrich matching line+stop records with terminal/platform data.
local function lineStopPairLineId(pair)
  if pair == nil then return nil end
  -- TF2 docs describe lineSystem terminal results as {{Entity,int},...}.
  -- Depending on the Lua/sol binding this may arrive as:
  --   * pair[1], pair[2]
  --   * pair[0], pair[1]
  --   * pair.first, pair.second
  --   * a map entry normalized by collectLineStopPairs(): { line = key, stop = value }
  return eid(
    safeField(pair, "line") or
    safeField(pair, "lineEntity") or
    safeField(pair, "entity") or
    safeField(pair, "first") or
    safeField(pair, "_1") or
    safeField(pair, 1) or
    safeField(pair, 0)
  )
end

local function lineStopPairStopIndexRaw(pair)
  if pair == nil then return nil end
  return safeTonumber(
    safeField(pair, "stop") or
    safeField(pair, "stopIndex") or
    safeField(pair, "index") or
    safeField(pair, "second") or
    safeField(pair, "_2") or
    safeField(pair, 2) or
    safeField(pair, 1)
  )
end

local function collectLineStopPairs(raw)
  local result = {}
  if raw == nil then return result end

  local function appendPair(k, v, shapeHint)
    if v == nil then return end
    -- TF2/sol may expose terminal hits in several shapes:
    --   [lineEntity] = stopIndex
    --   [lineEntity] = true
    --   { lineEntity, stopIndex }
    --   userdata with __pairs
    -- The previous parser lost the key when v was boolean/userdata, producing hits
    -- without line_id. v1.3.0 preserves the key aggressively.
    if type(v) == "number" or safeTonumber(v) ~= nil then
      result[#result + 1] = { line = k, stop = v, _shape = shapeHint or "map_line_to_stop" }
    elseif type(v) == "boolean" then
      result[#result + 1] = { line = k, stop = nil, _shape = shapeHint or "map_line_to_bool_presence" }
    else
      result[#result + 1] = v
    end
  end

  local iterated = false
  local okPairs = pcall(function()
    for k, v in pairs(raw) do
      iterated = true
      appendPair(k, v, "pairs_key_value")
    end
  end)
  if okPairs and iterated and #result > 0 then return result end

  local len = safeLen(raw)
  if len > 0 then
    for i = 1, len do
      local pair = safeField(raw, i)
      if pair ~= nil then appendPair(i, pair, "array_1_based") end
    end
    -- Some sol vectors are 0-based. Avoid duplicates by only adding non-nil items
    -- whose tostring is not already seen.
    local seen = {}
    for _, pair in ipairs(result) do seen[tostring(pair)] = true end
    for i = 0, len - 1 do
      local pair = safeField(raw, i)
      if pair ~= nil and not seen[tostring(pair)] then appendPair(i, pair, "array_0_based") end
    end
  end
  return result
end

local function buildLineStopLookup(lines)
  local lookup = {}
  for _, line in ipairs(lines or {}) do
    local lid = safeField(line, "id")
    for _, stop in ipairs(safeField(line, "stops") or {}) do
      local idx = safeTonumber(safeField(stop, "index"))
      if lid ~= nil and idx ~= nil then
        lookup[tostring(lid) .. ":" .. tostring(idx)] = stop
        lookup[tostring(lid) .. ":" .. tostring(idx - 1)] = stop -- lineSystem may return 0-based stop indices
      end
    end
  end
  return lookup
end

local function buildLineStationStopLookup(lines)
  local lookup = {}
  for _, line in ipairs(lines or {}) do
    local lid = safeField(line, "id")
    for _, stop in ipairs(safeField(line, "stops") or {}) do
      local gid = safeField(stop, "station_group_id")
      if lid ~= nil and gid ~= nil then
        local key = tostring(lid) .. ":" .. tostring(gid)
        if lookup[key] == nil then lookup[key] = {} end
        lookup[key][#lookup[key] + 1] = stop
      end
    end
  end
  for _, stops in pairs(lookup) do
    table.sort(stops, function(a, b)
      return (safeTonumber(safeField(a, "index")) or 0) < (safeTonumber(safeField(b, "index")) or 0)
    end)
  end
  return lookup
end

local function applyTerminalToStop(stop, stationId, terminalIndex, origin, rawStopIndex)
  if stop == nil or terminalIndex == nil then return false end
  local platformNumber = terminalIndex + 1

  stop.terminal = terminalIndex
  stop.terminal_index0 = terminalIndex
  stop.terminal_number = platformNumber
  stop.terminal_origin = origin

  stop.platform = terminalIndex
  stop.platform_index0 = terminalIndex
  stop.platform_number = platformNumber
  stop.platform_display = "Gleis " .. tostring(platformNumber)
  stop.platform_origin = origin
  stop.platform_display_origin = "computed_from_tf2_lineSystem_terminal_zero_based_plus_one"

  stop.track = terminalIndex
  stop.track_index0 = terminalIndex
  stop.track_number = platformNumber
  stop.track_display = "Gleis " .. tostring(platformNumber)
  stop.track_origin = origin

  stop.native_terminal_scan_station_id = eid(stationId)
  stop.native_terminal_scan_stop_index_raw = rawStopIndex
  stop.station_entity_id = eid(stationId) or safeField(stop, "station_entity_id")
  stop.boarding_station_id_best_effort = eid(stationId) or safeField(stop, "boarding_station_id_best_effort")
  stop.boarding_station_id_origin = origin
  stop.terminal_resolution_status = "native_terminal_from_lineSystem_terminal_scan"
  return true
end

local function scanNativeTerminalLineStops(lines, stationGroups, stations, diag)
  local result = {
    _origin = { record = "tf2_api_best_effort", note = "Native terminal/platform scan using api.engine.system.lineSystem terminal lookup helpers after normal line export." },
    enabled = false,
    origin = "tf2_api_best_effort.lineSystem.getLineStopsForTerminal",
    terminal_probe_max_index0 = 31,
    station_count_scanned = 0,
    terminals_with_hits = 0,
    line_stop_hits = 0,
    applied_to_stops = 0,
    ambiguous_or_unmatched_hits = 0,
    entries = {},
  }

  if api == nil or api.engine == nil or api.engine.system == nil or api.engine.system.lineSystem == nil then
    diagPush(diag, "info", "v1.3.0 terminal scan skipped: api.engine.system.lineSystem not available")
    result.reason = "lineSystem_not_available"
    return result
  end

  local ls = api.engine.system.lineSystem
  if ls.getLineStopsForTerminal == nil then
    diagPush(diag, "info", "v1.3.0 terminal scan skipped: lineSystem.getLineStopsForTerminal not available")
    result.reason = "getLineStopsForTerminal_not_available"
    return result
  end

  result.enabled = true
  local stopLookup = buildLineStopLookup(lines)
  local stationLineStopLookup = buildLineStationStopLookup(lines)
  local stationLineCursor = {}
  local knownLineIds = {}
  for _, line in ipairs(lines or {}) do
    local knownLid = safeField(line, "id")
    if knownLid ~= nil then knownLineIds[tostring(knownLid)] = true end
  end
  local stationIdsSeen = {}

  for _, station in ipairs(stations or {}) do
    local stationId = safeField(station, "id")
    if stationId ~= nil and not stationIdsSeen[tostring(stationId)] then
      stationIdsSeen[tostring(stationId)] = true
      result.station_count_scanned = result.station_count_scanned + 1
      for terminalIndex = 0, result.terminal_probe_max_index0 do
        local ok, raw = pcall(function() return ls.getLineStopsForTerminal(stationId, terminalIndex) end)
        if ok and raw ~= nil then
          local pairsList = collectLineStopPairs(raw)
          if #pairsList > 0 then
            result.terminals_with_hits = result.terminals_with_hits + 1
            local entry = {
              station_id = eid(stationId),
              station_name = safeField(station, "name") or getName(stationId),
              station_group_id = safeField(station, "station_group_id"),
              station_group_name = safeField(station, "station_group_name"),
              terminal_index0 = terminalIndex,
              terminal_number = terminalIndex + 1,
              platform_display = "Gleis " .. tostring(terminalIndex + 1),
              line_stops = {},
            }
            for _, pair in ipairs(pairsList) do
              local lid = lineStopPairLineId(pair)
              local rawIdx = lineStopPairStopIndexRaw(pair)
              local originalLid = lid
              local originalRawIdx = rawIdx
              -- v1.3.0: In your real export, getLineStopsForTerminal() arrived as
              -- pairs_key_value with key=1/2/... and value=<lineEntity>. The previous
              -- parser interpreted key as line_id and value as stop_index, so every
              -- hit was unmatched. If the parsed lid is not one of our exported lines
              -- but rawIdx is, swap it into line presence mode.
              if lid ~= nil and rawIdx ~= nil and knownLineIds[tostring(lid)] == nil and knownLineIds[tostring(rawIdx)] ~= nil then
                lid = eid(rawIdx)
                rawIdx = nil
              end
              result.line_stop_hits = result.line_stop_hits + 1
              local key1 = tostring(lid) .. ":" .. tostring(rawIdx)
              local key2 = tostring(lid) .. ":" .. tostring((rawIdx or -999999) + 1)
              local stop = (rawIdx ~= nil) and (stopLookup[key1] or stopLookup[key2]) or nil
              local mappingMode = stop ~= nil and "native_line_stop_index" or nil
              local candidateCount = 0
              local candidateStopIndices = {}

              -- If lineSystem only returns line presence for station+terminal, still use it:
              -- map station+line terminal hits onto exported stop occurrences at that station.
              -- This is not as strong as a native stop index, but it is better than virtual-only
              -- and remains clearly marked via terminal_origin/mappingMode.
              if stop == nil and lid ~= nil then
                local stationGroupId = safeField(station, "station_group_id")
                local candidates = stationLineStopLookup[tostring(lid) .. ":" .. tostring(stationGroupId)]
                if candidates ~= nil and #candidates > 0 then
                  candidateCount = #candidates
                  for _, c in ipairs(candidates) do candidateStopIndices[#candidateStopIndices + 1] = safeField(c, "index") end
                  if #candidates == 1 then
                    stop = candidates[1]
                    mappingMode = "native_terminal_line_presence_single_stop_at_station"
                  else
                    local cursorKey = tostring(lid) .. ":" .. tostring(stationGroupId)
                    local nextIdx = (stationLineCursor[cursorKey] or 0) + 1
                    if nextIdx > #candidates then nextIdx = #candidates end
                    stationLineCursor[cursorKey] = nextIdx
                    stop = candidates[nextIdx]
                    mappingMode = "native_terminal_line_presence_assigned_by_stop_order"
                  end
                end
              end

              local applied = false
              if stop ~= nil then
                applied = applyTerminalToStop(stop, stationId, terminalIndex, "tf2_api.lineSystem.getLineStopsForTerminal." .. tostring(mappingMode or "unknown_mapping"), rawIdx)
                if applied then
                  stop.native_terminal_mapping_mode = mappingMode
                  stop.native_terminal_candidate_count = candidateCount
                  stop.native_terminal_candidate_stop_indices = candidateStopIndices
                end
              end
              if applied then result.applied_to_stops = result.applied_to_stops + 1 else result.ambiguous_or_unmatched_hits = result.ambiguous_or_unmatched_hits + 1 end
              entry.line_stops[#entry.line_stops + 1] = {
                line_id = lid,
                line_name = lid ~= nil and getName(lid) or nil,
                stop_index_raw = rawIdx,
                original_line_id_before_normalization = originalLid,
                original_stop_index_before_normalization = originalRawIdx,
                raw_shape = type(pair) == "table" and safeField(pair, "_shape") or type(pair),
                mapping_mode = mappingMode,
                candidate_count = candidateCount,
                candidate_stop_indices = candidateStopIndices,
                matched_export_stop = applied,
              }
            end
            result.entries[#result.entries + 1] = entry
          end
        elseif not ok then
          diagPush(diag, "info", "v1.3.0 terminal scan failed for station " .. tostring(stationId) .. " terminal " .. tostring(terminalIndex) .. ": " .. tostring(raw))
        end
      end
    end
  end

  diagPush(diag, "info", "v1.3.0 native terminal scan: stations=" .. tostring(result.station_count_scanned) .. ", terminalsWithHits=" .. tostring(result.terminals_with_hits) .. ", lineStopHits=" .. tostring(result.line_stop_hits) .. ", applied=" .. tostring(result.applied_to_stops) .. ", unmatched=" .. tostring(result.ambiguous_or_unmatched_hits))
  return result
end

local function buildVirtualPlatformAssignments(lines, stationGroups, stations, diag)
  local assignmentsByGroup = {}
  local assignmentList = {}
  local boardingPoints = {}

  local function ensureGroup(gid, gname)
    local key = tostring(gid or "?")
    if assignmentsByGroup[key] == nil then
      assignmentsByGroup[key] = { station_group_id = gid, station_group_name = gname, next_platform = 0, by_key = {}, platforms = {} }
    end
    return assignmentsByGroup[key]
  end

  for _, line in ipairs(lines or {}) do
    local stops = safeField(line, "stops") or {}
    for i, stop in ipairs(stops) do
      local gid = stopGroupId(stop)
      if gid ~= nil then
        local prevStop = stops[i - 1]
        local nextStop = stops[i + 1]
        local nextGid = nextStop ~= nil and stopGroupId(nextStop) or nil
        local prevGid = prevStop ~= nil and stopGroupId(prevStop) or nil
        local towardsName = (nextStop ~= nil and stopGroupName(nextStop)) or (prevStop ~= nil and stopGroupName(prevStop)) or "Ende"
        local directionKey = tostring(safeField(line, "id") or "?") .. ":" .. tostring(nextGid or ("from_" .. tostring(prevGid or "terminal")))
        local group = ensureGroup(gid, stopGroupName(stop))
        if group.by_key[directionKey] == nil then
          group.next_platform = group.next_platform + 1
          local platformNumber = group.next_platform
          group.by_key[directionKey] = {
            station_group_id = gid,
            station_group_name = stopGroupName(stop),
            platform_number = platformNumber,
            track_number = platformNumber,
            display = "Gleis " .. tostring(platformNumber) .. "*",
            origin = "computed_experimental_virtual_platform_per_station_line_direction",
            note = "Virtual/backend platform assignment. Native TF2 platform/terminal was not exposed through game.interface.LINE.stops.",
            line_id = safeField(line, "id"),
            line_name = safeField(line, "name"),
            towards_station_group_id = nextGid,
            towards_station_group_name = towardsName,
          }
          group.platforms[#group.platforms + 1] = group.by_key[directionKey]
        end
        local a = group.by_key[directionKey]
        stop.platform_best_effort = a.platform_number
        stop.track_best_effort = a.track_number
        if safeField(stop, "platform_display") == nil then
          stop.platform_display = a.display
          stop.platform_display_origin = a.origin
        end
        stop.platform_best_effort_origin = a.origin
        stop.track_best_effort_origin = a.origin
        stop.platform_resolution_status = safeField(stop, "platform") ~= nil and "native_platform" or "virtual_platform_assignment"
        stop.track_resolution_status = safeField(stop, "track") ~= nil and "native_track" or "virtual_track_assignment"
        stop.towards_station_group_id = nextGid
        stop.towards_station_group_name = towardsName

        boardingPoints[#boardingPoints + 1] = {
          _origin = { record = "computed_experimental", note = "Backend boarding point. Native terminal/platform used when available; otherwise virtual platform assignment is provided." },
          station_group_id = gid,
          station_group_name = stopGroupName(stop),
          station_id = safeField(stop, "station_entity_id") or safeField(stop, "boarding_station_id_best_effort"),
          line_id = safeField(line, "id"),
          line_name = safeField(line, "name"),
          stop_index = safeField(stop, "index"),
          towards_station_group_id = nextGid,
          towards_station_group_name = towardsName,
          native_terminal = safeField(stop, "terminal"),
          native_platform = safeField(stop, "platform"),
          native_track = safeField(stop, "track"),
          platform_best_effort = safeField(stop, "platform_best_effort"),
          track_best_effort = safeField(stop, "track_best_effort"),
          platform_display = safeField(stop, "platform_display"),
          resolution_status = safeField(stop, "platform_resolution_status"),
        }
      end
    end
  end

  for _, group in pairs(assignmentsByGroup) do
    assignmentList[#assignmentList + 1] = {
      _origin = { record = "computed_experimental", note = "Virtual platform/track assignments generated per station group, line and direction for backend/frontend display." },
      experimental = true,
      station_group_id = group.station_group_id,
      station_group_name = group.station_group_name,
      platform_count = group.next_platform,
      platforms = group.platforms,
    }
  end
  diagPush(diag, "info", "virtual platform assignments built for " .. tostring(#assignmentList) .. " station groups and " .. tostring(#boardingPoints) .. " boarding points")
  return assignmentList, boardingPoints
end

local function buildSegments(lines, diag)
  local segments = {}

  for _, line in ipairs(lines or {}) do
    local stops = safeField(line, "stops") or {}
    if type(stops) == "table" and #stops >= 2 then
      for i = 1, #stops - 1 do
        local fromStop = stops[i]
        local toStop = stops[i + 1]
        local fromGroupId = stopGroupId(fromStop)
        local toGroupId = stopGroupId(toStop)
        local fromPos = stopGroupPosition(fromStop)
        local toPos = stopGroupPosition(toStop)
        local dist2 = distance2d(fromPos, toPos)
        local dist3 = distance3d(fromPos, toPos)

        local modeGuess, speedKmh, speedOrigin = inferModeForSpeed(line, fromStop, toStop)
        local metersPerUnit = positiveNumber(EXPERIMENTAL_DISTANCE_SCALE.meters_per_game_unit) or 1.0
        local distanceMeters = dist2 ~= nil and (dist2 * metersPerUnit) or nil
        local detourFactor = detourFactorForMode(modeGuess)
        local estimatedRouteDistanceMeters = distanceMeters ~= nil and (distanceMeters * detourFactor) or nil
        local estimatedSeconds = estimateSecondsFromMeters(estimatedRouteDistanceMeters, speedKmh)

        local segment = {
          _origin = {
            record = "computed_experimental",
            note = "Derived by Tixima exporter v1.3.0 from TF2 API stop order and station-group positions. Not a native TF2 segment object.",
            input_fields = {
              "lines[].stops[].station_group_id",
              "lines[].stops[].station_group_position",
              "lines[].stops[].index",
              "lines[].transport_modes when available",
              "stations/station_groups carrier data when available"
            }
          },
          experimental = true,
          experimental_feature = "computed_segments_v3_backend_ready_distance_and_time",
          line_id = safeField(line, "id"),
          line_name = safeField(line, "name"),
          line_stop_source = safeField(line, "stop_source"),
          sequence_index = i,
          from_stop_index = safeField(fromStop, "index"),
          to_stop_index = safeField(toStop, "index"),
          from_station_group_id = fromGroupId,
          from_station_group_name = stopGroupName(fromStop),
          from_position = vecToPlainTable(fromPos),
          from_terminal = safeField(fromStop, "terminal"),
          from_terminal_origin = safeField(fromStop, "terminal") ~= nil and "tf2_api_component.Line.stops" or safeField(fromStop, "terminal_origin"),
          from_platform = safeField(fromStop, "platform"),
          from_platform_origin = safeField(fromStop, "platform_origin"),
          from_platform_best_effort = safeField(fromStop, "platform_best_effort"),
          from_platform_display = safeField(fromStop, "platform_display"),
          from_platform_best_effort_origin = safeField(fromStop, "platform_best_effort_origin"),
          from_track = safeField(fromStop, "track"),
          from_track_origin = safeField(fromStop, "track_origin"),
          from_track_best_effort = safeField(fromStop, "track_best_effort"),
          from_track_best_effort_origin = safeField(fromStop, "track_best_effort_origin"),
          from_boarding_station_id_best_effort = safeField(fromStop, "boarding_station_id_best_effort"),
          from_boarding_station_id_origin = safeField(fromStop, "boarding_station_id_origin"),
          from_terminal_resolution_status = safeField(fromStop, "terminal_resolution_status"),
          to_station_group_id = toGroupId,
          to_station_group_name = stopGroupName(toStop),
          to_position = vecToPlainTable(toPos),
          to_terminal = safeField(toStop, "terminal"),
          to_terminal_origin = safeField(toStop, "terminal") ~= nil and "tf2_api_component.Line.stops" or safeField(toStop, "terminal_origin"),
          to_platform = safeField(toStop, "platform"),
          to_platform_origin = safeField(toStop, "platform_origin"),
          to_platform_best_effort = safeField(toStop, "platform_best_effort"),
          to_platform_display = safeField(toStop, "platform_display"),
          to_platform_best_effort_origin = safeField(toStop, "platform_best_effort_origin"),
          to_track = safeField(toStop, "track"),
          to_track_origin = safeField(toStop, "track_origin"),
          to_track_best_effort = safeField(toStop, "track_best_effort"),
          to_track_best_effort_origin = safeField(toStop, "track_best_effort_origin"),
          to_boarding_station_id_best_effort = safeField(toStop, "boarding_station_id_best_effort"),
          to_boarding_station_id_origin = safeField(toStop, "boarding_station_id_origin"),
          to_terminal_resolution_status = safeField(toStop, "terminal_resolution_status"),
          distance_game_units_2d = roundedNumber(dist2, 3),
          distance_game_units_3d = roundedNumber(dist3, 3),
          distance_meters_experimental = roundedNumber(distanceMeters, 1),
          distance_km_experimental = distanceMeters ~= nil and roundedNumber(distanceMeters / 1000.0, 3) or nil,
          estimated_route_distance_meters_experimental = roundedNumber(estimatedRouteDistanceMeters, 1),
          estimated_route_distance_km_experimental = estimatedRouteDistanceMeters ~= nil and roundedNumber(estimatedRouteDistanceMeters / 1000.0, 3) or nil,
          distance_detour_factor_experimental = detourFactor,
          distance_scale_meters_per_game_unit = metersPerUnit,
          distance_scale_origin = EXPERIMENTAL_DISTANCE_SCALE.origin,
          distance_origin = "computed_experimental.euclidean_from_station_group_position",
          estimated_route_distance_origin = "computed_experimental.straight_line_distance_x_detour_factor",
          inferred_speed_profile = modeGuess,
          inferred_speed_kmh_experimental = speedKmh,
          inferred_speed_origin = speedOrigin,
          routing_cost_distance_only_experimental = roundedNumber(dist2, 3),
          routing_cost_time_seconds_experimental = roundedNumber(estimatedSeconds, 1),
          estimated_travel_time_seconds_experimental = roundedNumber(estimatedSeconds, 1),
          estimated_travel_time_minutes_experimental = estimatedSeconds ~= nil and roundedNumber(estimatedSeconds / 60.0, 2) or nil,
          estimated_travel_time_iso8601_experimental = secondsToIsoDuration(estimatedSeconds),
          travel_time_seconds = roundedNumber(estimatedSeconds, 1),
          travel_time_origin = "computed_experimental.distance_based_estimate_v1",
          travel_time_native_tf2_available = false,
          travel_time_note = "Estimated from experimental straight-line station-group distance, detour factor and assumed speed profile. This is NOT native TF2 timetable/runtime travel time.",
        }

        if fromGroupId ~= nil and toGroupId ~= nil then
          segments[#segments + 1] = segment
        else
          diagPush(diag, "warn", "computed segment skipped for line " .. tostring(safeField(line, "id")) .. " at stop " .. tostring(i) .. ": missing station group id")
        end
      end
    else
      diagPush(diag, "info", "computed segments skipped for line " .. tostring(safeField(line, "id")) .. ": fewer than 2 stops")
    end
  end

  diagPush(diag, "info", "computed experimental segments built: " .. tostring(#segments))
  return segments
end


local function exportVehicles(diag, lines)
  local vehicles = {}
  local seenVehicles = {}
  local debug = {
    _origin = { record = "tf2_api_best_effort", note = "Vehicle export probe summary. Used to understand TF2 return shapes without dumping huge userdata objects." },
    methods_tried = {},
    raw_samples = {},
    line_vehicle_counts = {},
  }

  local function addMethod(name, status, message)
    debug.methods_tried[#debug.methods_tried + 1] = { method = tostring(name), status = tostring(status), message = tostring(message or "") }
  end

  local function addRawSample(source, lineId, raw)
    if #debug.raw_samples >= 30 then return end
    debug.raw_samples[#debug.raw_samples + 1] = {
      source = tostring(source or ""),
      line_id = lineId,
      raw_type = tostring(type(raw)),
      raw_len = safeLen(raw),
      raw_keys = tableKeys(raw, 20),
      raw_tostring = safeToString(raw),
    }
  end

  local function tryTransportVehicleInfo(vehicleEntity)
    local tvsInfo = nil
    if api ~= nil and api.engine ~= nil and api.engine.system ~= nil then
      tvsInfo = safeField(api.engine.system, "transportVehicleSystem")
    end
    if tvsInfo ~= nil and safeField(tvsInfo, "getInfo") ~= nil then
      local ok, result = pcall(function() return tvsInfo.getInfo(vehicleEntity) end)
      if ok then return result end
    end
    return nil
  end

  local function vehicleLineIdFromFields(vehicleComp, info, fallbackLineId)
    local candidates = {
      fallbackLineId,
      safeField(info, "line"), safeField(info, "lineEntity"), safeField(info, "lineId"), safeField(info, "lineIdStr"),
      safeField(vehicleComp, "line"), safeField(vehicleComp, "lineEntity"), safeField(vehicleComp, "lineId"), safeField(vehicleComp, "lineIdStr")
    }
    for _, value in ipairs(candidates) do
      local idValue = eid(value)
      if idValue ~= nil then return idValue end
    end
    return nil
  end

  local function addVehicle(vehicleEntity, fallbackLineId, sourceName)
    local idValue = eid(vehicleEntity)
    if idValue == nil then return false end
    local dedupeKey = tostring(idValue) .. ":" .. tostring(fallbackLineId or "")
    if seenVehicles[dedupeKey] then return false end
    seenVehicles[dedupeKey] = true

    local info = tryTransportVehicleInfo(vehicleEntity) or interfaceEntity(vehicleEntity)
    local compTv = getComponent(vehicleEntity, CT_TRANSPORT_VEHICLE)
    local compVeh = getComponent(vehicleEntity, CT_VEHICLE)
    local lineId = vehicleLineIdFromFields(compTv or compVeh, info, fallbackLineId)

    local data = {
      _origin = { record = "tf2_api_best_effort", note = "Vehicle exported via " .. tostring(sourceName or "unknown") .. ". Exact field availability depends on TF2 build/state." },
      experimental = false,
      id = idValue,
      name = getName(vehicleEntity),
      type = safeField(info, "type") or safeField(info, "carrier") or "vehicle",
      position = safeField(info, "position") or interfacePosition(vehicleEntity),
      line_id = lineId,
      line_id_origin = lineId ~= nil and "tf2_api_best_effort_transportVehicleSystem_or_field" or "not_available_in_current_vehicle_source",
      model_id = safeField(compTv, "fileName") or safeField(compTv, "modelId") or safeField(compTv, "model") or safeField(compVeh, "fileName") or safeField(compVeh, "modelId") or safeField(info, "fileName") or safeField(info, "modelId"),
      speed = safeField(info, "speed") or safeField(compTv, "speed") or safeField(compVeh, "speed"),
      state = safeField(info, "state") or safeField(compTv, "state") or safeField(compVeh, "state"),
      maintenance_state = safeField(info, "maintenanceState") or safeField(compTv, "maintenanceState") or safeField(compVeh, "maintenanceState"),
      target_maintenance_state = safeField(info, "targetMaintenanceState") or safeField(compTv, "targetMaintenanceState") or safeField(compVeh, "targetMaintenanceState"),
      info_keys = tableKeys(info, 40),
      transport_vehicle_component_keys = tableKeys(compTv, 40),
      vehicle_component_keys = tableKeys(compVeh, 40),
      vehicle_source = sourceName,
    }
    vehicles[#vehicles + 1] = data
    if lineId ~= nil then
      local key = tostring(lineId)
      debug.line_vehicle_counts[key] = (debug.line_vehicle_counts[key] or 0) + 1
    end
    return true
  end

  local tvs = nil
  if api ~= nil and api.engine ~= nil and api.engine.system ~= nil then
    tvs = safeField(api.engine.system, "transportVehicleSystem")
  end

  if tvs ~= nil then
    -- Best official path for line-bound vehicles.
    if safeField(tvs, "getLineVehicles") ~= nil then
      local before = #vehicles
      for _, line in ipairs(lines or {}) do
        local lineId = safeField(line, "id")
        local ok, raw = pcall(function() return tvs.getLineVehicles(lineId) end)
        if ok then
          addRawSample("transportVehicleSystem.getLineVehicles", lineId, raw)
          local ids = copyEntityArray(raw)
          for _, vehId in ipairs(ids) do addVehicle(vehId, lineId, "transportVehicleSystem.getLineVehicles") end
        else
          diagPush(diag, "info", "vehicle getLineVehicles failed for line " .. tostring(lineId) .. ": " .. tostring(raw))
        end
      end
      addMethod("transportVehicleSystem.getLineVehicles(line)", (#vehicles > before and "ok" or "empty"), "vehicles=" .. tostring(#vehicles - before))
    else
      addMethod("transportVehicleSystem.getLineVehicles(line)", "unavailable", "method nil")
    end

    if #vehicles == 0 and safeField(tvs, "getLine2VehicleMap") ~= nil then
      local before = #vehicles
      local ok, rawMap = pcall(function() return tvs.getLine2VehicleMap() end)
      if ok then
        addRawSample("transportVehicleSystem.getLine2VehicleMap", nil, rawMap)
        local okPairs = pcall(function()
          for lineEntity, vehList in pairs(rawMap) do
            local lineId = eid(lineEntity)
            local ids = copyEntityArray(vehList)
            for _, vehId in ipairs(ids) do addVehicle(vehId, lineId, "transportVehicleSystem.getLine2VehicleMap") end
          end
        end)
        if not okPairs then
          diagPush(diag, "info", "vehicle getLine2VehicleMap returned non-iterable map")
        end
      else
        diagPush(diag, "info", "vehicle getLine2VehicleMap failed: " .. tostring(rawMap))
      end
      addMethod("transportVehicleSystem.getLine2VehicleMap()", (#vehicles > before and "ok" or "empty"), "vehicles=" .. tostring(#vehicles - before))
    else
      if safeField(tvs, "getLine2VehicleMap") == nil then addMethod("transportVehicleSystem.getLine2VehicleMap()", "unavailable", "method nil") end
    end
  else
    addMethod("transportVehicleSystem", "unavailable", "api.engine.system.transportVehicleSystem nil")
  end

  -- Last fallback: component scan. This worked poorly in earlier versions because component
  -- names may not be exposed in the game-script context, but keep it as a diagnostic fallback.
  if #vehicles == 0 and api.engine.forEachEntityWithComponent ~= nil then
    local componentToUse = CT_TRANSPORT_VEHICLE
    local sourceName = "TRANSPORT_VEHICLE"
    if componentToUse == nil and CT_VEHICLE ~= nil then
      componentToUse = CT_VEHICLE
      sourceName = "VEHICLE"
      diagPush(diag, "info", "TRANSPORT_VEHICLE component not available; falling back to VEHICLE component scan")
    end

    if componentToUse ~= nil then
      local before = #vehicles
      local okEach, errEach = pcall(function()
        api.engine.forEachEntityWithComponent(function(entity)
          local okVehicle, errVehicle = pcall(function() addVehicle(entity, nil, sourceName .. "_component_scan") end)
          if not okVehicle then diagPush(diag, "warn", "vehicle export skipped for entity " .. tostring(eid(entity)) .. ": " .. tostring(errVehicle)) end
        end, componentToUse)
      end)

      if not okEach then
        local okEach2, errEach2 = pcall(function()
          api.engine.forEachEntityWithComponent(componentToUse, function(entity)
            local okVehicle, errVehicle = pcall(function() addVehicle(entity, nil, sourceName .. "_component_scan") end)
            if not okVehicle then diagPush(diag, "warn", "vehicle export skipped for entity " .. tostring(eid(entity)) .. ": " .. tostring(errVehicle)) end
          end)
        end)
        if not okEach2 then
          diagPush(diag, "warn", sourceName .. " component vehicle scan failed: " .. tostring(errEach or errEach2))
        end
      end
      addMethod("forEachEntityWithComponent." .. sourceName, (#vehicles > before and "ok" or "empty"), "vehicles=" .. tostring(#vehicles - before))
    else
      addMethod("forEachEntityWithComponent.TRANSPORT_VEHICLE/VEHICLE", "unavailable", "component type nil")
    end
  end

  if #vehicles == 0 then
    diagPush(diag, "info", "vehicles export produced 0 vehicles; see vehicle_probe for method details")
    return vehicles, "vehicle_export_empty_after_transportVehicleSystem_and_component_scan", debug
  end

  diagPush(diag, "info", "best-effort vehicles exported: " .. tostring(#vehicles))
  return vehicles, "transportVehicleSystem_best_effort", debug
end

local function buildLineSummaries(lines, segments, vehicles)
  local summaries = {}
  local byLine = {}
  local vehicleCounts = {}

  for _, vehicle in ipairs(vehicles or {}) do
    local lid = safeField(vehicle, "line_id")
    if lid ~= nil then
      local key = tostring(lid)
      vehicleCounts[key] = (vehicleCounts[key] or 0) + 1
    end
  end

  for _, line in ipairs(lines or {}) do
    local key = tostring(safeField(line, "id") or "?")
    byLine[key] = {
      _origin = { record = "computed_experimental", note = "Line summary calculated from exported line stops and computed segments for backend convenience." },
      experimental = true,
      line_id = safeField(line, "id"),
      line_name = safeField(line, "name"),
      display_color = safeField(line, "display_color"),
      inferred_transport_mode_profile = safeField(line, "inferred_transport_mode_profile"),
      inferred_transport_mode_origin = safeField(line, "inferred_transport_mode_origin"),
      stop_count = safeField(line, "stop_count") or #(safeField(line, "stops") or {}),
      unique_station_group_count = safeField(line, "unique_station_group_count"),
      vehicle_count_best_effort = vehicleCounts[key] or 0,
      vehicle_count_origin = (vehicleCounts[key] ~= nil and vehicleCounts[key] > 0) and "tf2_api_best_effort_vehicle_scan" or "not_available_or_zero_in_current_vehicle_source",
      segment_count = 0,
      full_sequence_distance_km_experimental = 0,
      full_sequence_travel_time_seconds_experimental = 0,
      full_sequence_travel_time_minutes_experimental = 0,
      full_sequence_travel_time_iso8601_experimental = nil,
      route_distance_origin = "computed_experimental.sum_of_segments_estimated_route_distance",
      travel_time_origin = "computed_experimental.sum_of_segment_estimates",
      stop_names_preview = safeField(line, "stop_names_preview"),
    }
  end

  for _, segment in ipairs(segments or {}) do
    local key = tostring(safeField(segment, "line_id") or "?")
    local summary = byLine[key]
    if summary ~= nil then
      summary.segment_count = summary.segment_count + 1
      summary.full_sequence_distance_km_experimental = summary.full_sequence_distance_km_experimental + (safeTonumber(safeField(segment, "estimated_route_distance_km_experimental")) or 0)
      summary.full_sequence_travel_time_seconds_experimental = summary.full_sequence_travel_time_seconds_experimental + (safeTonumber(safeField(segment, "estimated_travel_time_seconds_experimental")) or 0)
    end
  end

  for _, summary in pairs(byLine) do
    summary.full_sequence_distance_km_experimental = roundedNumber(summary.full_sequence_distance_km_experimental, 3)
    summary.full_sequence_travel_time_seconds_experimental = roundedNumber(summary.full_sequence_travel_time_seconds_experimental, 1)
    summary.full_sequence_travel_time_minutes_experimental = roundedNumber((summary.full_sequence_travel_time_seconds_experimental or 0) / 60.0, 2)
    summary.full_sequence_travel_time_iso8601_experimental = secondsToIsoDuration(summary.full_sequence_travel_time_seconds_experimental)
    summaries[#summaries + 1] = summary
  end

  return summaries
end

local function buildRoutingAndMapPackage(stationGroups, lines, segments)
  local nodeById = {}
  local nodes = {}
  local edges = {}
  local transfers = {}
  local stationLineIndex = {}
  local minX, minY, maxX, maxY = nil, nil, nil, nil
  local degree = {}

  local function updateBounds(pos)
    pos = vecToPlainTable(pos)
    if pos == nil or pos[1] == nil or pos[2] == nil then return end
    local x, y = pos[1], pos[2]
    if minX == nil or x < minX then minX = x end
    if maxX == nil or x > maxX then maxX = x end
    if minY == nil or y < minY then minY = y end
    if maxY == nil or y > maxY then maxY = y end
  end

  for _, group in ipairs(stationGroups or {}) do
    local idValue = safeField(group, "id")
    if idValue ~= nil then
      local key = tostring(idValue)
      local pos = safeField(group, "position")
      local node = {
        _origin = { record = "tf2_api", note = "Routing node generated from TF2 station group." },
        id = idValue,
        name = safeField(group, "name"),
        position = vecToPlainTable(pos),
        station_ids = safeField(group, "station_ids"),
        served_by_lines = {},
        served_by_line_names = {},
        interchange = false,
        degree = 0,
      }
      nodeById[key] = node
      nodes[#nodes + 1] = node
      updateBounds(pos)
    end
  end

  local function addLineToNode(groupId, lineId, lineName)
    if groupId == nil or lineId == nil then return end
    local node = nodeById[tostring(groupId)]
    if node == nil then return end
    local lid = tostring(lineId)
    local exists = false
    for _, existing in ipairs(node.served_by_lines) do if tostring(existing) == lid then exists = true end end
    if not exists then
      node.served_by_lines[#node.served_by_lines + 1] = lineId
      node.served_by_line_names[#node.served_by_line_names + 1] = lineName
    end
  end

  for _, line in ipairs(lines or {}) do
    for _, stop in ipairs(safeField(line, "stops") or {}) do
      local gid = stopGroupId(stop)
      addLineToNode(gid, safeField(line, "id"), safeField(line, "name"))
      if gid ~= nil then
        local skey = tostring(gid)
        if stationLineIndex[skey] == nil then stationLineIndex[skey] = { station_group_id = gid, station_group_name = stopGroupName(stop), lines = {} } end
        local lid = tostring(safeField(line, "id") or "?")
        if stationLineIndex[skey].lines[lid] == nil then
          stationLineIndex[skey].lines[lid] = { line_id = safeField(line, "id"), line_name = safeField(line, "name"), display_color = safeField(line, "display_color"), stop_indices = {} }
        end
        stationLineIndex[skey].lines[lid].stop_indices[#stationLineIndex[skey].lines[lid].stop_indices + 1] = safeField(stop, "index")
      end
    end
  end

  for _, segment in ipairs(segments or {}) do
    local fromId = safeField(segment, "from_station_group_id")
    local toId = safeField(segment, "to_station_group_id")
    local lineId = safeField(segment, "line_id")
    local edgeId = tostring(lineId or "?") .. ":" .. tostring(safeField(segment, "sequence_index") or "?") .. ":" .. keyForPair(fromId, toId)
    degree[tostring(fromId)] = (degree[tostring(fromId)] or 0) + 1
    degree[tostring(toId)] = (degree[tostring(toId)] or 0) + 1
    edges[#edges + 1] = {
      _origin = { record = "computed_experimental", note = "Routing edge generated from computed segment." },
      experimental = true,
      id = edgeId,
      from = fromId,
      to = toId,
      from_name = safeField(segment, "from_station_group_name"),
      to_name = safeField(segment, "to_station_group_name"),
      line_id = lineId,
      line_name = safeField(segment, "line_name"),
      sequence_index = safeField(segment, "sequence_index"),
      cost_seconds = safeField(segment, "routing_cost_time_seconds_experimental"),
      cost_distance = safeField(segment, "routing_cost_distance_only_experimental"),
      distance_km = safeField(segment, "estimated_route_distance_km_experimental") or safeField(segment, "distance_km_experimental"),
      travel_time_origin = safeField(segment, "travel_time_origin"),
      distance_origin = safeField(segment, "estimated_route_distance_origin") or safeField(segment, "distance_origin"),
    }
  end

  local stationLineIndexArray = {}
  for skey, entry in pairs(stationLineIndex) do
    local linesArray = {}
    for _, lineEntry in pairs(entry.lines) do linesArray[#linesArray + 1] = lineEntry end
    entry.lines = linesArray
    stationLineIndexArray[#stationLineIndexArray + 1] = entry
  end

  for _, node in ipairs(nodes) do
    node.degree = degree[tostring(safeField(node, "id"))] or 0
    node.interchange = #(node.served_by_lines or {}) >= 2
    if node.interchange then
      transfers[#transfers + 1] = {
        _origin = { record = "computed_experimental_assumption", note = "Transfer possibility inferred because multiple lines serve the same TF2 station group." },
        experimental = true,
        station_group_id = safeField(node, "id"),
        station_group_name = safeField(node, "name"),
        served_by_lines = safeField(node, "served_by_lines"),
        served_by_line_names = safeField(node, "served_by_line_names"),
        transfer_time_seconds_experimental = EXPERIMENTAL_SPEED_PROFILE.interchange_transfer_penalty_seconds or EXPERIMENTAL_SPEED_PROFILE.transfer_penalty_seconds,
        transfer_time_origin = "computed_experimental_assumption.same_station_group_default_transfer_penalty",
      }
    end
  end

  local mapPackage = {
    _origin = { record = "computed_experimental", note = "Map metadata calculated from exported station-group positions and line topology." },
    experimental = true,
    bounding_box = { min_x = minX, min_y = minY, max_x = maxX, max_y = maxY },
    center = (minX ~= nil and maxX ~= nil and minY ~= nil and maxY ~= nil) and { x = (minX + maxX) / 2.0, y = (minY + maxY) / 2.0 } or nil,
    node_count = #nodes,
    edge_count = #edges,
    interchange_count = #transfers,
    renderer_hint = {
      geographic_mvp = "Use station_group.position as x/y coordinates for first map.",
      schematic_later = "Use routing_nodes/routing_edges as graph input for a schematic/octolinear layout engine. Keep manual position overrides in backend, not in TF2 export.",
      web_recommended = "SVG or Canvas/D3 with line bundling by shared segments."
    }
  }

  return {
    routing_nodes = nodes,
    routing_edges = edges,
    transfers = transfers,
    station_line_index = stationLineIndexArray,
    network_map = mapPackage,
  }
end

local function buildRenderPackage(lines, stationCanonical, segments, coordinateSystem)
  local stationById = {}
  for _, station in ipairs(stationCanonical or {}) do
    stationById[tostring(safeField(station, "station_group_id") or "")] = station
  end

  local linesRender = {}
  for _, line in ipairs(lines or {}) do
    local points = {}
    for _, stop in ipairs(safeField(line, "stops") or {}) do
      local gid = stopGroupId(stop)
      local station = stationById[tostring(gid or "")]
      local coords = station ~= nil and safeField(station, "coordinates") or buildCoordinatePackage(stopGroupPosition(stop), coordinateSystem)
      points[#points + 1] = {
        station_group_id = gid,
        station_group_name = stopGroupName(stop),
        stop_index = safeField(stop, "index"),
        world = coords ~= nil and safeField(coords, "world") or nil,
        web = coords ~= nil and safeField(coords, "web") or nil,
        svg_1000 = coords ~= nil and safeField(coords, "svg_1000") or nil,
        platform_display = safeField(stop, "platform_display"),
      }
    end
    linesRender[#linesRender + 1] = {
      _origin = { record = "computed_experimental", note = "Polyline generated from stop order and canonical station web coordinates for frontend rendering." },
      line_id = safeField(line, "id"),
      line_name = safeField(line, "name"),
      display_color = safeField(line, "display_color"),
      point_count = #points,
      points = points,
    }
  end

  return {
    _origin = { record = "computed_experimental", note = "Frontend-friendly rendering package. Use this when raw TF2 coordinates look scrambled in charts." },
    coordinate_system = coordinateSystem,
    lines = linesRender,
    hint = "For SVG use point.svg_1000.x/y with viewBox 0 0 1000 1000. This avoids raw negative TF2 coordinates and Y-axis inversion problems.",
  }
end

local function buildGeoJsonPackage(stationCanonical, segments)
  local features = {}
  for _, station in ipairs(stationCanonical or {}) do
    local coords = safeField(station, "coordinates")
    local world = coords ~= nil and safeField(coords, "world") or nil
    if world ~= nil and safeField(world, "x") ~= nil and safeField(world, "y") ~= nil then
      features[#features + 1] = {
        type = "Feature",
        geometry = { type = "Point", coordinates = { safeField(world, "x"), safeField(world, "y") } },
        properties = {
          kind = "station_group",
          station_group_id = safeField(station, "station_group_id"),
          name = safeField(station, "name"),
          interchange = safeField(station, "interchange"),
          degree = safeField(station, "degree"),
        }
      }
    end
  end
  for _, segment in ipairs(segments or {}) do
    local a = vecToPlainTable(safeField(segment, "from_position"))
    local b = vecToPlainTable(safeField(segment, "to_position"))
    if a ~= nil and b ~= nil and a[1] ~= nil and a[2] ~= nil and b[1] ~= nil and b[2] ~= nil then
      features[#features + 1] = {
        type = "Feature",
        geometry = { type = "LineString", coordinates = { { a[1], a[2] }, { b[1], b[2] } } },
        properties = {
          kind = "segment",
          line_id = safeField(segment, "line_id"),
          line_name = safeField(segment, "line_name"),
          sequence_index = safeField(segment, "sequence_index"),
          from_name = safeField(segment, "from_station_group_name"),
          to_name = safeField(segment, "to_station_group_name"),
          distance_km = safeField(segment, "estimated_route_distance_km_experimental"),
          travel_time_seconds = safeField(segment, "estimated_travel_time_seconds_experimental"),
        }
      }
    end
  end
  return {
    type = "FeatureCollection",
    _origin = { record = "computed_experimental", note = "GeoJSON-like package in TF2 world coordinates. For direct web plotting prefer render_package normalized coordinates." },
    features = features,
  }
end

local function buildNetworkStats(lines, stationCanonical, segments, transfers)
  local hubs = {}
  local endpoints = {}
  for _, station in ipairs(stationCanonical or {}) do
    local lineCount = #(safeField(station, "served_by_lines") or {})
    if lineCount >= 2 then
      hubs[#hubs + 1] = { station_group_id = safeField(station, "station_group_id"), name = safeField(station, "name"), served_by_line_count = lineCount, degree = safeField(station, "degree") }
    end
    if (safeTonumber(safeField(station, "degree")) or 0) <= 1 then
      endpoints[#endpoints + 1] = { station_group_id = safeField(station, "station_group_id"), name = safeField(station, "name"), degree = safeField(station, "degree") }
    end
  end
  table.sort(hubs, function(a, b) return (safeTonumber(safeField(a, "served_by_line_count")) or 0) > (safeTonumber(safeField(b, "served_by_line_count")) or 0) end)
  return {
    _origin = { record = "computed_experimental", note = "Network statistics calculated from exported static topology." },
    line_count = #(lines or {}),
    station_count = #(stationCanonical or {}),
    segment_count = #(segments or {}),
    transfer_count = #(transfers or {}),
    hub_count = #hubs,
    endpoint_count = #endpoints,
    top_hubs = hubs,
    endpoints = endpoints,
  }
end


-- v1.3.0: Terrain export ---------------------------------------------------

local function terrainApi()
  if api == nil or api.engine == nil then return nil end
  return safeField(api.engine, "terrain")
end

local function newVec2f(x, y)
  if api ~= nil and api.type ~= nil and api.type.Vec2f ~= nil then
    local ctor = safeField(api.type.Vec2f, "new")
    if ctor ~= nil then
      local ok, result = pcall(function() return api.type.Vec2f.new(x, y) end)
      if ok and result ~= nil then return result end
    end
  end
  return { x, y }
end

local function terrainIsValid(x, y)
  local terrain = terrainApi()
  if terrain == nil then return true, "terrain_api_missing_assumed_valid" end
  local fn = safeField(terrain, "isValidCoordinate")
  if fn == nil then return true, "isValidCoordinate_missing_assumed_valid" end
  local v = newVec2f(x, y)
  local ok, result = pcall(function() return terrain.isValidCoordinate(v) end)
  if ok then return result == true, "tf2_api.terrain.isValidCoordinate" end
  -- Some TF2 builds/mod contexts accept x/y directly.
  local ok2, result2 = pcall(function() return terrain.isValidCoordinate(x, y) end)
  if ok2 then return result2 == true, "tf2_api.terrain.isValidCoordinate_xy" end
  return true, "isValidCoordinate_failed_assumed_valid"
end

local function terrainHeightAt(x, y)
  local terrain = terrainApi()
  if terrain == nil then return nil, "terrain_api_missing" end
  local fn = safeField(terrain, "getHeightAt")
  if fn == nil then return nil, "getHeightAt_missing" end
  local v = newVec2f(x, y)
  local ok, result = pcall(function() return terrain.getHeightAt(v) end)
  if ok then return safeTonumber(result), "tf2_api.terrain.getHeightAt" end
  local ok2, result2 = pcall(function() return terrain.getHeightAt(x, y) end)
  if ok2 then return safeTonumber(result2), "tf2_api.terrain.getHeightAt_xy" end
  return nil, "getHeightAt_failed"
end

local function terrainBaseHeightAt(x, y)
  local terrain = terrainApi()
  if terrain == nil then return nil, "terrain_api_missing" end
  local fn = safeField(terrain, "getBaseHeightAt")
  if fn == nil then return nil, "getBaseHeightAt_missing" end
  local v = newVec2f(x, y)
  local ok, result = pcall(function() return terrain.getBaseHeightAt(v) end)
  if ok then return safeTonumber(result), "tf2_api.terrain.getBaseHeightAt" end
  local ok2, result2 = pcall(function() return terrain.getBaseHeightAt(x, y) end)
  if ok2 then return safeTonumber(result2), "tf2_api.terrain.getBaseHeightAt_xy" end
  return nil, "getBaseHeightAt_failed"
end

local function readTerrainWaterLevel(diag)
  local terrain = terrainApi()
  if terrain ~= nil then
    local fn = safeField(terrain, "getWaterLevel")
    if fn ~= nil then
      local ok, result = pcall(function() return terrain.getWaterLevel() end)
      if ok and safeTonumber(result) ~= nil then
        return safeTonumber(result), "tf2_api.terrain.getWaterLevel"
      end
    end
    local wl = safeField(terrain, "waterLevel") or safeField(terrain, "water_level")
    if safeTonumber(wl) ~= nil then return safeTonumber(wl), "tf2_api.terrain.waterLevel_field" end
  end

  -- Fallback: scan TERRAIN components for a waterLevel-like field.
  local candidates = {}
  local function addCandidate(value, origin)
    local n = safeTonumber(value)
    if n ~= nil then candidates[#candidates + 1] = { value = n, origin = origin } end
  end
  local terrainTypes = { CT_TERRAIN, CT_TERRAIN_TILE }
  for _, ct in ipairs(terrainTypes) do
    if ct ~= nil and api ~= nil and api.engine ~= nil and api.engine.forEachEntityWithComponent ~= nil then
      pcall(function()
        api.engine.forEachEntityWithComponent(function(entity)
          local comp = getComponent(entity, ct)
          if comp ~= nil then
            addCandidate(safeField(comp, "waterLevel"), "tf2_api.component.waterLevel")
            addCandidate(safeField(comp, "water_level"), "tf2_api.component.water_level")
          end
        end, ct)
      end)
      pcall(function()
        api.engine.forEachEntityWithComponent(ct, function(entity)
          local comp = getComponent(entity, ct)
          if comp ~= nil then
            addCandidate(safeField(comp, "waterLevel"), "tf2_api.component.waterLevel")
            addCandidate(safeField(comp, "water_level"), "tf2_api.component.water_level")
          end
        end)
      end)
    end
  end
  if #candidates > 0 then return candidates[1].value, candidates[1].origin end
  diagPush(diag, "warn", "Terrain water level not exposed; using fallback water_level=0")
  return 0, "computed_experimental_fallback_zero"
end

local function boundsFromStationGroups(stationGroups)
  local minX, maxX, minY, maxY = nil, nil, nil, nil
  for _, group in ipairs(stationGroups or {}) do
    local p = safeField(group, "position")
    if type(p) == "table" and p[1] ~= nil and p[2] ~= nil then
      local x, y = safeTonumber(p[1]), safeTonumber(p[2])
      if x ~= nil and y ~= nil then
        minX = minX == nil and x or math.min(minX, x)
        maxX = maxX == nil and x or math.max(maxX, x)
        minY = minY == nil and y or math.min(minY, y)
        maxY = maxY == nil and y or math.max(maxY, y)
      end
    end
  end
  if minX == nil then return { min_x = -4096, max_x = 4096, min_y = -4096, max_y = 4096, origin = "computed_experimental_default_bounds" } end
  local margin = TERRAIN_EXPORT_CONFIG.fallback_margin or 1024
  return { min_x = minX - margin, max_x = maxX + margin, min_y = minY - margin, max_y = maxY + margin, origin = "computed_from_station_group_bounds_plus_margin" }
end

local function expandTerrainBounds(seedBounds, diag)
  local step = TERRAIN_EXPORT_CONFIG.bounds_probe_step or 1024
  local limit = TERRAIN_EXPORT_CONFIG.max_search_extent or 65536
  local cx = ((seedBounds.min_x or 0) + (seedBounds.max_x or 0)) / 2.0
  local cy = ((seedBounds.min_y or 0) + (seedBounds.max_y or 0)) / 2.0
  local origin = seedBounds.origin or "computed_from_seed_bounds"
  local validOrigin = "unknown"

  local function expandDir(start, delta, fixed, axis)
    local value = start
    local nextValue = value + delta
    local loops = 0
    while math.abs(nextValue) <= limit and loops < 256 do
      local okValid, src
      if axis == "x" then okValid, src = terrainIsValid(nextValue, fixed) else okValid, src = terrainIsValid(fixed, nextValue) end
      validOrigin = src or validOrigin
      if not okValid then break end
      value = nextValue
      nextValue = value + delta
      loops = loops + 1
    end
    return value
  end

  local minX = expandDir(seedBounds.min_x or -4096, -step, cy, "x")
  local maxX = expandDir(seedBounds.max_x or 4096, step, cy, "x")
  local minY = expandDir(seedBounds.min_y or -4096, -step, cx, "y")
  local maxY = expandDir(seedBounds.max_y or 4096, step, cx, "y")

  -- If isValidCoordinate is not available, do not expand to the safety limit. Keep station-based bounds.
  if validOrigin == "isValidCoordinate_missing_assumed_valid" or validOrigin == "terrain_api_missing_assumed_valid" or validOrigin == "isValidCoordinate_failed_assumed_valid" then
    diagPush(diag, "warn", "Terrain valid-coordinate API unavailable; using station-bounds + margin instead of full map expansion")
    return seedBounds
  end

  return { min_x = minX, max_x = maxX, min_y = minY, max_y = maxY, origin = "tf2_api.terrain.isValidCoordinate_expanded_from_station_bounds", valid_coordinate_origin = validOrigin, seed_bounds = seedBounds }
end

local function adjustTerrainResolution(bounds)
  local requested = TERRAIN_EXPORT_CONFIG.requested_resolution_m or 32
  local res = requested
  local width = math.max(0, (bounds.max_x or 0) - (bounds.min_x or 0))
  local height = math.max(0, (bounds.max_y or 0) - (bounds.min_y or 0))
  local softLimit = TERRAIN_EXPORT_CONFIG.max_samples_soft_limit or 1800000
  local columns = math.floor(width / res) + 1
  local rows = math.floor(height / res) + 1
  while (columns * rows) > softLimit and res < 512 do
    res = res * 2
    columns = math.floor(width / res) + 1
    rows = math.floor(height / res) + 1
  end
  return res, columns, rows, (res ~= requested)
end

local function classifyTerrainSample(height, waterLevel)
  if height == nil then return "N" end
  local waterTol = TERRAIN_EXPORT_CONFIG.water_tolerance_m or 0.35
  local coastTol = TERRAIN_EXPORT_CONFIG.coast_tolerance_m or 2.0
  if height <= waterLevel + waterTol then return "W" end
  if height <= waterLevel + coastTol then return "C" end
  if height < 50 then return "L" end
  if height < 150 then return "H" end
  return "M"
end

local function slopeClass(slopePercent)
  if slopePercent == nil then return "N" end
  if slopePercent < 3 then return "F" end
  if slopePercent < 10 then return "G" end
  if slopePercent < 25 then return "S" end
  return "X"
end

local function compactRowString(codes)
  local out = {}
  for i = 1, #codes do out[#out + 1] = codes[i] or "N" end
  return table.concat(out, "")
end

local function exportTerrainData(stationGroups, diag)
  local terrain = terrainApi()
  local terrainExport = {
    schema = "tixima-terrain-grid",
    schema_version = 1,
    enabled = TERRAIN_EXPORT_CONFIG.enabled == true,
    _origin = { record = "tf2_api_best_effort_plus_computed_classification", note = "Height/base-height are sampled through TF2 terrain API where available. Surface/elevation/slope classes are computed for backend/frontend map rendering." },
    config = TERRAIN_EXPORT_CONFIG,
  }
  if TERRAIN_EXPORT_CONFIG.enabled ~= true then
    terrainExport.status = "disabled"
    return terrainExport
  end
  if terrain == nil then
    terrainExport.status = "unavailable"
    terrainExport.error = "api.engine.terrain not available in this script context"
    diagPush(diag, "warn", "Terrain export unavailable: api.engine.terrain not available")
    return terrainExport
  end

  local seedBounds = boundsFromStationGroups(stationGroups)
  local bounds = expandTerrainBounds(seedBounds, diag)
  local resolution, columns, rows, autoAdjusted = adjustTerrainResolution(bounds)
  local waterLevel, waterOrigin = readTerrainWaterLevel(diag)

  local heightRows, baseHeightRows, surfaceRows, slopeRows, slopeClassRows = {}, {}, {}, {}, {}
  local minH, maxH, minBase, maxBase = nil, nil, nil, nil
  local landCount, waterCount, coastCount, invalidCount = 0, 0, 0, 0
  local heightOrigin, baseOrigin = nil, nil

  for row = 1, rows do
    local y = (bounds.min_y or 0) + (row - 1) * resolution
    local hRow, bRow, sCodes = {}, {}, {}
    for col = 1, columns do
      local x = (bounds.min_x or 0) + (col - 1) * resolution
      local isValid = terrainIsValid(x, y)
      if not isValid then
        hRow[col] = false
        bRow[col] = false
        sCodes[col] = "N"
        invalidCount = invalidCount + 1
      else
        local h, hOrg = terrainHeightAt(x, y)
        local b, bOrg = terrainBaseHeightAt(x, y)
        heightOrigin = heightOrigin or hOrg
        baseOrigin = baseOrigin or bOrg
        h = h ~= nil and roundedNumber(h, TERRAIN_EXPORT_CONFIG.height_sample_decimals or 1) or false
        b = b ~= nil and roundedNumber(b, TERRAIN_EXPORT_CONFIG.height_sample_decimals or 1) or false
        hRow[col] = h
        bRow[col] = b
        local code = classifyTerrainSample(h, waterLevel or 0)
        sCodes[col] = code
        if type(h) == "number" then
          minH = minH == nil and h or math.min(minH, h)
          maxH = maxH == nil and h or math.max(maxH, h)
        end
        if type(b) == "number" then
          minBase = minBase == nil and b or math.min(minBase, b)
          maxBase = maxBase == nil and b or math.max(maxBase, b)
        end
        if code == "W" then waterCount = waterCount + 1 elseif code == "C" then coastCount = coastCount + 1 elseif code ~= "N" then landCount = landCount + 1 end
      end
    end
    heightRows[row] = hRow
    baseHeightRows[row] = bRow
    surfaceRows[row] = compactRowString(sCodes)
  end

  for row = 1, rows do
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
        left = type(left) == "number" and left or h; right = type(right) == "number" and right or h; up = type(up) == "number" and up or h; down = type(down) == "number" and down or h
        local dzdx = (right - left) / math.max(1, (col == 1 or col == columns) and resolution or (2 * resolution))
        local dzdy = (down - up) / math.max(1, (row == 1 or row == rows) and resolution or (2 * resolution))
        local slopePercent = math.sqrt(dzdx * dzdx + dzdy * dzdy) * 100.0
        slopePercent = roundedNumber(slopePercent, TERRAIN_EXPORT_CONFIG.slope_sample_decimals or 1)
        slopeRow[col] = slopePercent
        slopeCodes[col] = slopeClass(slopePercent)
      end
    end
    slopeRows[row] = slopeRow
    slopeClassRows[row] = compactRowString(slopeCodes)
  end

  local sampleCount = rows * columns
  terrainExport.status = "ok"
  terrainExport.resolution_m = resolution
  terrainExport.raster_resolution_m = resolution
  terrainExport.grid_resolution_m = resolution
  terrainExport.cell_size_m = resolution
  terrainExport.requested_resolution_m = TERRAIN_EXPORT_CONFIG.requested_resolution_m
  terrainExport.configured_requested_resolution_m = TERRAIN_EXPORT_CONFIG.requested_resolution_m
  terrainExport.resolution_auto_adjusted = autoAdjusted
  terrainExport.resolution_note = "Each raster cell represents one sample point every resolution_m meters in TF2 world coordinates. v1.3.1 default target is 16m. If resolution_auto_adjusted is true, the exporter increased the raster size to avoid an excessively large JSON."
  terrainExport.columns = columns
  terrainExport.rows = rows
  terrainExport.sample_count = sampleCount
  terrainExport.bounds = {
    world = {
      min_x = roundedNumber(bounds.min_x, 3), max_x = roundedNumber(bounds.max_x, 3),
      min_y = roundedNumber(bounds.min_y, 3), max_y = roundedNumber(bounds.max_y, 3),
      origin = bounds.origin,
      valid_coordinate_origin = bounds.valid_coordinate_origin,
    },
    width_m_experimental = roundedNumber((bounds.max_x or 0) - (bounds.min_x or 0), 1),
    height_m_experimental = roundedNumber((bounds.max_y or 0) - (bounds.min_y or 0), 1),
    seed_bounds = bounds.seed_bounds,
  }
  terrainExport.water_level = roundedNumber(waterLevel or 0, 3)
  terrainExport.water_level_origin = waterOrigin
  terrainExport.height_origin = heightOrigin or "unknown"
  terrainExport.base_height_origin = baseOrigin or "unknown"
  terrainExport.grid_encoding = {
    raster_resolution_m = "Same as terrain.resolution_m / terrain.raster_resolution_m. Distance in TF2 world meters between two neighboring sample points.",
    x_at_column = "x = bounds.world.min_x + (column_index0 * resolution_m)",
    y_at_row = "y = bounds.world.min_y + (row_index0 * resolution_m)",
    row_column_order = "All *_rows fields are [row][column]. row_index0 starts at 0 at bounds.world.min_y; column_index0 starts at 0 at bounds.world.min_x.",
    height_rows = "2D array [row][column] of sampled terrain height in meters/game units, rounded compactly. false means invalid/unavailable.",
    base_height_rows = "2D array [row][column] from getBaseHeightAt if available; false means invalid/unavailable.",
    surface_rows = "String per row. One character per column. See surface_legend / surface_code_legend.",
    slope_percent_rows = "2D array [row][column] computed from neighboring height samples. false means invalid/unavailable.",
    slope_class_rows = "String per row. One character per column. See slope_legend / slope_code_legend."
  }
  terrainExport.surface_legend = {
    W = "water_or_below_water_level_estimate",
    C = "coast_or_near_water_level_estimate",
    L = "land_lowland_below_50m",
    H = "hill_50m_to_150m",
    M = "mountain_above_150m",
    N = "not_valid_or_not_available"
  }
  terrainExport.surface_code_legend = {
    W = { label = "Water", de = "Wasser oder Punkt unter/auf Wasserlinie", meaning = "height <= water_level + water_tolerance_m", source = "computed_from_height_and_water_level" },
    C = { label = "Coast", de = "Küste / Übergangsbereich nahe Wasserlinie", meaning = "height is within coast_tolerance_m above water level", source = "computed_from_height_and_water_level" },
    L = { label = "Lowland", de = "Flaches/niedriges Land", meaning = "land below 50m over the chosen height datum", source = "computed_from_height" },
    H = { label = "Hill", de = "Hügel / höheres Gelände", meaning = "land from 50m to below 150m", source = "computed_from_height" },
    M = { label = "Mountain", de = "Berg / sehr hohes Gelände", meaning = "land at or above 150m", source = "computed_from_height" },
    N = { label = "Not available", de = "Ungültig oder nicht verfügbar", meaning = "TF2 said coordinate invalid or height could not be sampled", source = "tf2_api_validity_or_missing_height" }
  }
  terrainExport.slope_legend = {
    F = "flat_less_than_3_percent",
    G = "gentle_3_to_10_percent",
    S = "steep_10_to_25_percent",
    X = "extreme_above_25_percent",
    N = "not_valid_or_not_available"
  }
  terrainExport.slope_code_legend = {
    F = { label = "Flat", de = "Flach", meaning = "slope < 3%", source = "computed_from_neighboring_height_samples" },
    G = { label = "Gentle", de = "Leicht geneigt", meaning = "3% <= slope < 10%", source = "computed_from_neighboring_height_samples" },
    S = { label = "Steep", de = "Steil", meaning = "10% <= slope < 25%", source = "computed_from_neighboring_height_samples" },
    X = { label = "Extreme", de = "Extrem steil", meaning = "slope >= 25%", source = "computed_from_neighboring_height_samples" },
    N = { label = "Not available", de = "Ungültig oder nicht verfügbar", meaning = "not enough valid neighboring height samples", source = "computed_from_neighboring_height_samples" }
  }
  terrainExport.statistics = {
    min_height = minH,
    max_height = maxH,
    min_base_height = minBase,
    max_base_height = maxBase,
    land_samples = landCount,
    water_samples = waterCount,
    coast_samples = coastCount,
    invalid_samples = invalidCount,
  }
  terrainExport.height_rows = heightRows
  terrainExport.base_height_rows = baseHeightRows
  terrainExport.surface_rows = surfaceRows
  terrainExport.slope_percent_rows = slopeRows
  terrainExport.slope_class_rows = slopeClassRows

  diagPush(diag, "info", "terrain export built: " .. tostring(columns) .. "x" .. tostring(rows) .. " samples=" .. tostring(sampleCount) .. " resolution=" .. tostring(resolution) .. "m")
  return terrainExport
end

local function buildQualityReport(lines, stations, stationGroups, segments, vehicles, terrainData)
  local report = {}
  local missingStops = 0
  local unresolvedBoardingStops = 0
  local missingNativeTerminalStops = 0
  local emptyEffectiveTransportModes = 0
  local emptyNativeTransportModes = 0
  local linesWithInterfaceStopFallback = 0
  local linesWithNativeApiEngineStops = 0

  for _, line in ipairs(lines or {}) do
    if #(safeField(line, "stops") or {}) == 0 then missingStops = missingStops + 1 end
    if #(safeField(line, "transport_modes") or {}) == 0 then emptyEffectiveTransportModes = emptyEffectiveTransportModes + 1 end
    if #(safeField(line, "native_transport_modes") or {}) == 0 then emptyNativeTransportModes = emptyNativeTransportModes + 1 end
    if safeField(line, "stop_source") == "game.interface.LINE.stops" then linesWithInterfaceStopFallback = linesWithInterfaceStopFallback + 1 end
    if tostring(safeField(line, "stop_source") or ""):find("api.engine", 1, true) ~= nil then linesWithNativeApiEngineStops = linesWithNativeApiEngineStops + 1 end
    for _, stop in ipairs(safeField(line, "stops") or {}) do
      if safeField(stop, "terminal") == nil then missingNativeTerminalStops = missingNativeTerminalStops + 1 end
      if safeField(stop, "terminal") == nil and safeField(stop, "boarding_station_id_best_effort") == nil then unresolvedBoardingStops = unresolvedBoardingStops + 1 end
    end
  end

  report[#report + 1] = { level = (#lines > 0 and "ok" or "error"), code = "lines_found", message = tostring(#lines) .. " lines exported." }
  report[#report + 1] = { level = (#stations > 0 and "ok" or "warn"), code = "stations_found", message = tostring(#stations) .. " stations exported." }
  report[#report + 1] = { level = (#stationGroups > 0 and "ok" or "warn"), code = "station_groups_found", message = tostring(#stationGroups) .. " station groups exported." }
  report[#report + 1] = { level = (#segments > 0 and "ok" or "warn"), code = "segments_built", message = tostring(#segments) .. " backend routing segments built." }
  report[#report + 1] = { level = "info", code = "native_segment_times", message = "Native TF2 segment travel times were not available in this one-shot export; v1.3.1 provides computed_experimental estimates." }
  report[#report + 1] = { level = (unresolvedBoardingStops == 0 and "ok" or "warn"), code = "boarding_terminal_resolution", message = tostring(unresolvedBoardingStops) .. " stop entries have neither native terminal nor best-effort boarding station. Native terminal missing on " .. tostring(missingNativeTerminalStops) .. " stop entries." }
  report[#report + 1] = { level = (emptyEffectiveTransportModes == 0 and "ok" or "warn"), code = "transport_modes_effective", message = tostring(emptyEffectiveTransportModes) .. " lines have empty effective transport_modes. Native transport_modes missing on " .. tostring(emptyNativeTransportModes) .. " lines; v1.3.1 infers effective modes from stop/station carriers when available." }
  report[#report + 1] = { level = "info", code = "stop_source", message = tostring(linesWithNativeApiEngineStops) .. " lines use native api.engine stop data; " .. tostring(linesWithInterfaceStopFallback) .. " lines use game.interface stop fallback. v1.3.1 prefers api.engine/lineSystem terminal data for real Gleis/Platform indices." }
  report[#report + 1] = { level = "info", code = "vehicles_best_effort", message = tostring(#(vehicles or {})) .. " vehicles exported via best-effort vehicle component scan." }
  local terrainStatus = safeField(terrainData or {}, "status") or "not_requested"
  local terrainSamples = safeField(terrainData or {}, "sample_count") or 0
  report[#report + 1] = { level = (terrainStatus == "ok" and "ok" or "warn"), code = "terrain_export", message = "Terrain export status: " .. tostring(terrainStatus) .. ", samples: " .. tostring(terrainSamples) .. ", resolution_m: " .. tostring(safeField(terrainData or {}, "resolution_m") or "-") .. "." }

  return report
end

local function buildExportPayload()
  local diag = {}
  diagPush(diag, "info", "Export started")

  local stations, stationGroups = exportStations(diag)
  local lines, lineSource = exportLines(diag)
  local nativeTerminalScan = scanNativeTerminalLineStops(lines, stationGroups, stations, diag)
  local platformAssignments, boardingPoints = buildVirtualPlatformAssignments(lines, stationGroups, stations, diag)
  local segments = buildSegments(lines, diag)
  local vehicles, vehicleSource, vehicleProbe = exportVehicles(diag, lines)
  local lineSummaries = buildLineSummaries(lines, segments, vehicles)
  local routingPackage = buildRoutingAndMapPackage(stationGroups, lines, segments)
  local coordinateSystem = buildCoordinateSystem(stationGroups)
  local stationsCanonical = buildStationCanonical(stationGroups, stations, lines, routingPackage, coordinateSystem)
  local renderPackage = buildRenderPackage(lines, stationsCanonical, segments, coordinateSystem)
  local geojsonPackage = buildGeoJsonPackage(stationsCanonical, segments)
  local networkStats = buildNetworkStats(lines, stationsCanonical, segments, routingPackage.transfers)
  local terrainData = exportTerrainData(stationGroups, diag)
  local qualityReport = buildQualityReport(lines, stations, stationGroups, segments, vehicles, terrainData)

  local backendReady = (#lines > 0 and #stationGroups > 0 and #segments > 0)

  local payload = {
    schema = "tpf2-network-export",
    schema_version = 31,
    generated_by = "Tixima TF2 Line Exporter v1.3.1",
    generated_at_unix = os and os.time and os.time() or nil,
    line_source = lineSource,
    vehicle_source = vehicleSource,
    vehicle_probe = vehicleProbe,
    counts = {
      lines = #lines,
      stations = #stations,
      station_groups = #stationGroups,
      canonical_stations = #stationsCanonical,
      platform_assignment_groups = #platformAssignments,
      boarding_points = #boardingPoints,
      native_terminal_scan_entries = #(safeField(nativeTerminalScan, "entries") or {}),
      native_terminal_scan_applied = safeField(nativeTerminalScan, "applied_to_stops") or 0,
      segments = #segments,
      vehicles = #vehicles,
      line_summaries = #lineSummaries,
      routing_nodes = #(routingPackage.routing_nodes or {}),
      routing_edges = #(routingPackage.routing_edges or {}),
      transfers = #(routingPackage.transfers or {}),
      diagnostics = #diag,
      quality_report = #qualityReport,
      terrain_samples = safeField(terrainData, "sample_count") or 0,
      terrain_rows = safeField(terrainData, "rows") or 0,
      terrain_columns = safeField(terrainData, "columns") or 0,
      terrain_resolution_m = safeField(terrainData, "resolution_m") or nil,
    },
    transport_mode_reference = {
      PERSON = 0, CARGO = 1, CAR = 2, BUS = 3, TRUCK = 4, TRAM = 5,
      ELECTRIC_TRAM = 6, TRAIN = 7, ELECTRIC_TRAIN = 8, AIRCRAFT = 9,
      SHIP = 10, SMALL_AIRCRAFT = 11, SMALL_SHIP = 12,
    },
    export_capabilities = {
      backend_ready = backendReady,
      topology = true,
      station_positions = true,
      line_stop_sequences = true,
      computed_segments = true,
      computed_routing_graph = true,
      computed_network_map_metadata = true,
      best_effort_vehicle_scan = true,
      best_effort_boarding_station_resolution = true,
      virtual_platform_assignments = true,
      native_terminal_scan = true,
      canonical_station_coordinates = true,
      normalized_web_coordinates = true,
      geojson_export = true,
      render_package = true,
      terrain_export = true,
      terrain_height_grid = true,
      terrain_surface_classification = true,
      terrain_slope_grid = true,
      inferred_transport_modes = true,
      native_terminal_track_data = "preferred_from_api.engine.getLine.stops[].terminal_or_component.Line.stops; otherwise v1.3.0 exports boarding_station_id_best_effort and virtual platform display",
      native_segment_travel_times = false,
      live_vehicle_positions = false,
      live_delays = false,
      recommended_backend_entrypoints = {
        import_raw = "Use station_groups, stations, lines and segments for canonical storage.",
        routing = "Use routing_nodes, routing_edges and transfers for first backend graph.",
        map = "Use stations_canonical + render_package for frontend plotting. Use network_map, routing_nodes, routing_edges and line_summaries for graph/map logic.",
        diagnostics = "Display quality_report and diagnostics in admin import UI."
      }
    },
    data_origin_legend = {
      tf2_api = "Directly exported from Transport Fever 2 API / game.interface / api.engine where available.",
      tf2_api_best_effort = "Exported through a defensive best-effort TF2 component/interface scan; exact fields may depend on TF2 build/state.",
      computed_experimental = "Calculated by this exporter from TF2 API fields. These values are experimental and may be inaccurate.",
      computed_experimental_assumption = "Calculated by this exporter using an explicit assumption, not confirmed by the current TF2 API export source.",
      not_available = "The exporter did not receive this information from the current TF2 API source.",
      tf2_api_plus_computed_projection = "Direct TF2 position/height data plus computed projection/classification values for frontend/backend rendering."
    },
    scale = {
      _origin = { record = "computed_experimental_assumption", note = "This exporter did not read a native per-map scale object from TF2. It exports the configured conversion assumption so downstream tools can override it." },
      distance_game_units_description = "Euclidean distance between TF2 station-group world positions.",
      assumed_meters_per_game_unit = EXPERIMENTAL_DISTANCE_SCALE.meters_per_game_unit,
      assumed_meters_per_game_unit_origin = EXPERIMENTAL_DISTANCE_SCALE.origin,
      assumption_confidence = EXPERIMENTAL_DISTANCE_SCALE.confidence,
      note = EXPERIMENTAL_DISTANCE_SCALE.note,
      source_hint = EXPERIMENTAL_DISTANCE_SCALE.source_hint,
      backend_should_allow_override = true
    },
    time_estimation = {
      _origin = { record = "computed_experimental_assumption", note = "No native segment travel time was available in this export. Times are estimated from distance, detour factor and assumed speed profile." },
      speed_profile = EXPERIMENTAL_SPEED_PROFILE,
      detour_factor = EXPERIMENTAL_DETOUR_FACTOR,
      formula = "estimated_seconds = distance_game_units_2d * assumed_meters_per_game_unit * detour_factor / (inferred_speed_kmh / 3.6)",
      native_tf2_segment_times_available = false,
      backend_should_replace_with_measured_vehicle_times = true
    },
    backend_contract = {
      version = "1.2.5",
      stable_primary_keys = {
        station_group = "station_groups[].id / routing_nodes[].id",
        station = "stations[].id",
        line = "lines[].id / line_summaries[].line_id",
        segment = "segments[].line_id + segments[].sequence_index",
        routing_edge = "routing_edges[].id"
      },
      import_order = { "terrain", "station_groups", "stations", "stations_canonical", "platform_assignments", "boarding_points", "lines", "segments", "routing_nodes", "routing_edges", "transfers", "line_summaries", "vehicles" },
      minimal_backend_tables = { "terrain_imports", "terrain_height_cells", "station_groups", "stations", "stations_canonical", "platform_assignments", "boarding_points", "lines", "line_stops", "segments", "routing_edges", "transfers", "import_diagnostics" },
      routing_notes = {
        "Use routing_edges.cost_seconds for first Dijkstra/A* MVP.",
        "Add transfers.transfer_time_seconds_experimental when switching line at the same station_group.",
        "Keep all *_origin fields so UI can show whether a value is TF2-native or estimated.",
        "Later live bridge should overwrite segment travel times with measured vehicle runtimes.",
        "v1.3.1 transport_modes can be inferred; native_transport_modes keeps the original TF2 field for transparency.",
        "Use boarding_station_id_best_effort for backend UX when terminal/platform is not natively available.",
        "Use stations_canonical[].coordinates.web or render_package.lines[].points[].svg_1000 for sensible frontend plotting; raw TF2 coordinates can be negative and are not screen coordinates.",
        "Use native stops[].terminal/platform_display when stop_source is api.engine/component or when native_terminal_scan.applied_to_stops > 0; otherwise use platform_assignments and boarding_points for virtual Gleis/Platform display.",
        "Use terrain.height_rows/surface_rows/slope_class_rows for terrain rendering. x/y are reconstructed from terrain.bounds.world.min_x/min_y and terrain.resolution_m."
      }
    },
    experimental = {
      enabled = true,
      warning = "v1.3.1 is backend-ready for static import. It fixes effective transport-mode inference from station carriers and keeps best-effort boarding-station fallback data. Computed distances, times, transfers and map metadata remain experimental estimates, not native TF2 timetable/runtime values.",
      features = {
        computed_segments_v3_backend_ready_distance_and_time = {
          enabled = true,
          origin = "computed_experimental",
          based_on = { "line stop order", "station-group positions", "scale assumption", "detour factor assumption", "speed profile assumption" },
          provides = { "segments", "routing_edges", "distance_game_units_2d", "distance_meters_experimental", "estimated_route_distance_km_experimental", "estimated_travel_time_seconds_experimental", "routing_cost_time_seconds_experimental" },
          does_not_provide = { "native track/platform data unless exposed by api.engine.getLine or component.Line.stops", "native TF2 segment travel time", "live delay data" }
        },
        network_plan_mvp = {
          enabled = true,
          origin = "computed_experimental",
          based_on = { "station_group positions", "line stop order", "computed routing edges" },
          provides = { "network_map", "station_line_index", "routing_nodes", "routing_edges", "line_summaries" }
        },
        canonical_station_coordinates = {
          enabled = true,
          origin = "tf2_api_plus_computed_projection",
          provides = { "stations_canonical", "coordinate_system", "coordinates.web", "coordinates.svg_1000" },
          note = "Fixes frontend plotting by exporting Bahnhof-centered canonical coordinate records and normalized Y-inverted web coordinates."
        },
        native_terminal_scan = {
          enabled = true,
          origin = "tf2_api_best_effort",
          provides = { "native_terminal_scan", "stops[].terminal", "stops[].platform_display when matched" },
          note = "Scans stations/terminals via lineSystem.getLineStopsForTerminal after normal line export. This may recover real Gleis indices even when line stop sequences come from game.interface."
        },
        virtual_platform_assignments = {
          enabled = true,
          origin = "computed_experimental",
          provides = { "platform_assignments", "boarding_points", "stops[].platform_display", "stops[].track_best_effort" },
          note = "Provides Gleis-like display values when TF2 does not expose native platform/terminal fields."
        },
        terrain_export_grid = {
          enabled = true,
          origin = "tf2_api_best_effort_plus_computed_classification",
          provides = { "terrain", "terrain.height_rows", "terrain.base_height_rows", "terrain.surface_rows", "terrain.slope_percent_rows", "terrain.slope_class_rows" },
          note = "Exports the complete detected terrain rectangle as compact rows at configurable resolution. Surface/slope classes are computed from TF2 height data."
        },
        geojson_and_render_package = {
          enabled = true,
          origin = "computed_experimental",
          provides = { "geojson", "render_package", "network_statistics" }
        },
        vehicle_scan_best_effort = {
          enabled = true,
          origin = "tf2_api_best_effort",
          provides = { "vehicles[] when TRANSPORT_VEHICLE or VEHICLE component is available" }
        },
        best_effort_warning_reduction = {
          enabled = true,
          origin = "computed_experimental",
          provides = { "transport_modes inferred from stop carriers", "boarding_station_id_best_effort for single-station station-groups", "quality_report split between native-missing and backend-usable" },
          does_not_provide = { "native platform/track when TF2 does not expose terminal data through api.engine/component", "native runtime/fahrplan travel times" }
        }
      }
    },
    terrain = terrainData,
    quality_report = qualityReport,
    diagnostics = diag,
    coordinate_system = coordinateSystem,
    stations_canonical = stationsCanonical,
    bahnhoefe = stationsCanonical,
    platform_assignments = platformAssignments,
    boarding_points = boardingPoints,
    native_terminal_scan = nativeTerminalScan,
    render_package = renderPackage,
    geojson = geojsonPackage,
    network_statistics = networkStats,
    station_groups = stationGroups,
    stations = stations,
    lines = lines,
    line_summaries = lineSummaries,
    segments = segments,
    routing_nodes = routingPackage.routing_nodes,
    routing_edges = routingPackage.routing_edges,
    transfers = routingPackage.transfers,
    station_line_index = routingPackage.station_line_index,
    network_map = routingPackage.network_map,
    vehicles = vehicles,
  }

  diagPush(diag, "info", "Export payload built: " .. tostring(#lines) .. " lines, " .. tostring(#stations) .. " stations, " .. tostring(#segments) .. " computed experimental segments, " .. tostring(#(routingPackage.routing_edges or {})) .. " routing edges")
  return payload
end

local function printJsonFallback(json)
  print("TIXIMA_TF2_EXPORT_BEGIN")
  local chunkSize = 8000
  for i = 1, #json, chunkSize do print(string.sub(json, i, i + chunkSize - 1)) end
  print("TIXIMA_TF2_EXPORT_END")
end

local function tryWriteFile(json)
  if io == nil or io.open == nil then return false, "io.open not available" end
  local paths = { "tpf2_network_export.json", "./tpf2_network_export.json" }
  local lastErr = nil
  for _, path in ipairs(paths) do
    local ok, result, value = pcall(function()
      local file, err = io.open(path, "w")
      if not file then return false, err end
      file:write(json)
      file:close()
      return true, path
    end)
    if ok and result == true then return true, value end
    if ok and result == false then lastErr = value end
    if not ok then lastErr = result end
  end
  return false, lastErr or "could not write to default paths"
end

local function setReadyIfNeeded()
  if state.status == "loading" then
    state.status = "ready"
    state.status_text = "Bereit. Export kann manuell gestartet werden."
    state.last_message = "Klicke im TIX Export-Fenster auf 'Export jetzt starten'."
  end
end

local function doExport(requestInfo)
  state.status = "exporting"
  state.status_text = "Export läuft..."
  state.last_error = nil
  state.request_count = (state.request_count or 0) + 1

  local payload = buildExportPayload()
  local json = jsonEncode(payload)
  local wrote, targetOrErr = tryWriteFile(json)

  state.counts = {
    lines = payload.counts.lines,
    stations = payload.counts.stations,
    station_groups = payload.counts.station_groups,
    segments = payload.counts.segments,
    vehicles = payload.counts.vehicles,
    routing_nodes = payload.counts.routing_nodes,
    routing_edges = payload.counts.routing_edges,
    transfers = payload.counts.transfers,
    terrain_samples = payload.counts.terrain_samples,
  }
  state.diagnostics_count = payload.counts.diagnostics or 0
  state.last_export_unix = payload.generated_at_unix
  state.export_count = (state.export_count or 0) + 1

  print("[Tixima TF2 Line Exporter] Export generated. Lines: " .. tostring(payload.counts.lines) .. ", Stations: " .. tostring(payload.counts.stations) .. ", Station groups: " .. tostring(payload.counts.station_groups) .. ", Segments: " .. tostring(payload.counts.segments) .. ", Routing edges: " .. tostring(payload.counts.routing_edges) .. ", Vehicles*: " .. tostring(payload.counts.vehicles) .. ", Terrain samples: " .. tostring(payload.counts.terrain_samples))

  if wrote then
    state.status = "ok"
    state.status_text = "Export fertig."
    state.last_output = tostring(targetOrErr)
    state.last_message = "JSON geschrieben nach: " .. tostring(targetOrErr) .. " | Segmente*: " .. tostring(payload.counts.segments) .. " | Routing*: " .. tostring(payload.counts.routing_edges) .. " | Vehicles*: " .. tostring(payload.counts.vehicles) .. " | Terrain: " .. tostring(payload.counts.terrain_samples) .. " samples @" .. tostring(payload.counts.terrain_resolution_m or "?") .. "m | Diagnostics: " .. tostring(state.diagnostics_count)
    print("[Tixima TF2 Line Exporter] Export written to: " .. tostring(targetOrErr))
  else
    state.status = "fallback_stdout"
    state.status_text = "Export fertig, aber Datei konnte nicht geschrieben werden."
    state.last_output = "stdout.txt markers"
    state.last_message = "Datei schreiben fehlgeschlagen: " .. tostring(targetOrErr) .. ". JSON steht in stdout.txt zwischen TIXIMA_TF2_EXPORT_BEGIN/END."
    print("[Tixima TF2 Line Exporter] File write failed: " .. tostring(targetOrErr) .. ". Writing JSON to stdout markers instead.")
    printJsonFallback(json)
  end
end

-- Engine callbacks ----------------------------------------------------------

local function update()
  ticks = ticks + 1
  if ticks >= 10 and not engineReady then
    engineReady = true
    setReadyIfNeeded()
  end
end

local function handleEvent(src, id, name, param)
  if id ~= EVENT_ID or name ~= EVENT_EXPORT_REQUEST then return end

  local ok, err = pcall(function() doExport(param) end)
  if not ok then
    state.status = "error"
    state.status_text = "Export fehlgeschlagen."
    state.last_error = tostring(err)
    state.last_message = "Fehler beim Export: " .. tostring(err) .. " | Schau bitte zusätzlich in stdout.txt nach der vollständigen Zeile."
    print("[Tixima TF2 Line Exporter] ERROR while exporting: " .. tostring(err))
  end
end

local function save()
  -- v1.3.0: Do NOT persist volatile UI/export status.
  -- TF2 creates/checks multiple simulation states during load; saving changing runtime
  -- status here can trigger ScriptSave mismatch assertions. The exporter is a manual
  -- tool, so only a tiny deterministic marker is saved.
  return {
    schema = "tixima-tf2-line-exporter-state",
    schema_version = 31,
    mod_version = "1.3.1",
  }
end

local function load(loadedState)
  -- v1.3.0: load() is called once in the engine state, but repeatedly in the UI
  -- state to fetch shared data. Reinitializing here every time is exactly why the
  -- panel jumped to the export result for a split second and then reset to
  -- "Warte auf Engine" with 0/0/0. Therefore initialize once per Lua state and
  -- ignore later load calls. save() remains deterministic/minimal to avoid the
  -- StartGameSim ScriptSave assertion.
  if runtimeInitialized then return end
  runtimeInitialized = true
  state = {
    schema = "tixima-tf2-line-exporter-state",
    schema_version = 31,
    mod_version = "1.3.1",
    status = "loading",
    status_text = "v1.3.1 geladen. Bereit.",
    last_message = "v1.3.1: UI-Load-Reset gefixt. Export direkt im UI starten; JSON bleibt Quelle der Wahrheit.",
    last_error = nil,
    last_output = nil,
    last_export_unix = nil,
    export_count = 0,
    request_count = 0,
    counts = { lines = 0, stations = 0, station_groups = 0, segments = 0, vehicles = 0, routing_nodes = 0, routing_edges = 0, transfers = 0 },
    diagnostics_count = 0,
  }
end

-- GUI helpers ---------------------------------------------------------------

local function guiText(text)
  return api.gui.comp.TextView.new(text or "")
end

local function guiButton(label, onClick)
  local button = api.gui.comp.Button.new(guiText(label), false)
  button:onClick(onClick)
  return button
end

local function guiAddText(layout, label)
  local tv = guiText(label)
  layout:addItem(tv)
  return tv
end

local function guiContainer(name, id)
  local c = api.gui.comp.Component.new(name or "")
  if id ~= nil then pcall(function() c:setId(id) end) end
  return c
end

local function makePanelContent()
  local content = guiContainer("TiximaExporterPanel", "tixima_exporter_panel")
  local layout = api.gui.layout.BoxLayout.new("VERTICAL")
  content:setLayout(layout)

  ui.status_text = guiAddText(layout, "Status: v1.3.1 geladen. Exportdatei ist Quelle der Wahrheit.")
  ui.counts_text = guiAddText(layout, "UI-Counts können in TF2 getrenntem GUI/Engine-State statisch bleiben; JSON enthält echte Counts.")
  ui.output_text = guiAddText(layout, "Output: -")
  ui.error_text = guiAddText(layout, "Fehler: -")
  ui.diag_text = guiAddText(layout, "Diagnostics: -")
  ui.hint_text = guiAddText(layout, "Hinweis: Export wird manuell ausgelöst und überschreibt tpf2_network_export.json.")

  local buttons = guiContainer("TiximaExporterButtons", "tixima_exporter_buttons")
  local buttonLayout = api.gui.layout.BoxLayout.new("HORIZONTAL")
  buttons:setLayout(buttonLayout)

  local exportButton = guiButton("Export jetzt starten", function()
    -- v1.3.0: Do not wait for guiUpdate scheduling. Execute directly from the click
    -- handler so the visible window can be updated immediately. If direct export is
    -- not allowed in the current TF2 context, fall back to an engine ScriptEvent and
    -- still show a visible status instead of silently staying at 0/0/0.
    state.status = "exporting"
    state.status_text = "Export läuft..."
    state.last_error = nil
    state.last_message = "Export per Button gestartet."
    if ui.status_text then pcall(function() ui.status_text:setText("Status: Export läuft...") end) end
    if ui.error_text then pcall(function() ui.error_text:setText("Fehler: -") end) end

    local ok, err = pcall(function()
      doExport({ source = "tixima_ui_click_direct" })
    end)

    if not ok then
      local sent = pcall(function()
        api.cmd.sendCommand(api.cmd.make.sendScriptEvent(
          SCRIPT_FILE_NAME,
          EVENT_ID,
          EVENT_EXPORT_REQUEST,
          { source = "tixima_ui_engine_fallback", reason = tostring(err) }
        ))
      end)
      state.status = "engine_requested"
      state.status_text = "Engine-Export angefordert."
      state.last_error = tostring(err)
      state.last_message = sent and "Direkter UI-Export fehlgeschlagen; Engine-Fallback wurde gesendet. Exportdatei prüfen." or "Direkter UI-Export fehlgeschlagen; Engine-Fallback konnte nicht gesendet werden."
    else
      state.last_message = (state.last_message or "Export fertig.") .. " | v1.3.1 UI nach Button-Klick direkt aktualisiert."
    end

    local counts = state.counts or {}
    if ui.status_text then pcall(function() ui.status_text:setText("Status: " .. tostring(state.status_text or "-")) end) end
    if ui.counts_text then pcall(function() ui.counts_text:setText("Linien: " .. tostring(counts.lines or 0) .. " | Stationen: " .. tostring(counts.stations or 0) .. " | Gruppen: " .. tostring(counts.station_groups or 0) .. " | Segmente*: " .. tostring(counts.segments or 0) .. " | Routing*: " .. tostring(counts.routing_edges or 0) .. " | Vehicles*: " .. tostring(counts.vehicles or 0) .. " | Exporte: " .. tostring(state.export_count or 0)) end) end
    if ui.output_text then pcall(function() ui.output_text:setText("Output: " .. tostring(state.last_output or "-")) end) end
    if ui.diag_text then pcall(function() ui.diag_text:setText("Diagnostics: " .. tostring(state.diagnostics_count or 0) .. " Einträge") end) end
    if ui.error_text then pcall(function() ui.error_text:setText(state.last_error and ("Fehler: " .. tostring(state.last_error)) or "Fehler: -") end) end
    if ui.hint_text then pcall(function() ui.hint_text:setText(tostring(state.last_message or "")) end) end
  end)
  exportButton:setTooltip("Erstellt/überschreibt tpf2_network_export.json oder schreibt als Fallback in stdout.txt.")
  buttonLayout:addItem(exportButton)

  local closeButton = guiButton("Schließen", function()
    if ui.window then ui.window:close() end
  end)
  buttonLayout:addItem(closeButton)

  layout:addItem(buttons)
  return content
end

local function ensureWindow()
  if ui.window ~= nil then return ui.window end
  local content = makePanelContent()
  local win = api.gui.comp.Window.new("Tixima TF2 Line Exporter", content)
  ui.window = win
  pcall(function() win:setSize(api.gui.util.Size.new(640, 250)) end)
  pcall(function() win:setPosition(260, 160) end)
  pcall(function() win:setResizable(false) end)
  pcall(function() win:setMovable(true) end)
  pcall(function() win:addHideOnCloseHandler() end)
  pcall(function() win:setVisible(false, false) end)
  return win
end

local function showWindow()
  local win = ensureWindow()
  pcall(function() win:setVisible(true, true) end)
end

local function guiInit()
  if ui.initialized then return end
  ui.initialized = true

  local ok, err = pcall(function()
    local line = api.gui.comp.Component.new("VerticalLine")
    local button = guiButton("TIX Export", function() showWindow() end)
    button:setTooltip("Tixima TF2 Line Exporter öffnen")
    ui.open_button = button

    local gameInfo = api.gui.util.getById("gameInfo")
    if gameInfo and gameInfo.getLayout then
      local gameInfoLayout = gameInfo:getLayout()
      gameInfoLayout:addItem(line)
      gameInfoLayout:addItem(button)
    end
  end)

  if not ok then print("[Tixima TF2 Line Exporter] GUI init failed: " .. tostring(err)) end
end

local function updateTextView(tv, value)
  if tv ~= nil then pcall(function() tv:setText(value or "") end) end
end

local function formatStatus(s)
  local status = s.status or "unknown"
  local text = s.status_text or "-"
  if status == "ok" then return "Status: OK - " .. text end
  if status == "fallback_stdout" then return "Status: WARNUNG - " .. text end
  if status == "error" then return "Status: FEHLER - " .. text end
  if status == "exporting" then return "Status: Export läuft - " .. text end
  if status == "ready" then return "Status: Bereit" end
  return "Status: " .. text
end

local function shorten(text, maxLen)
  text = tostring(text or "")
  if #text <= maxLen then return text end
  return string.sub(text, 1, maxLen - 3) .. "..."
end

local function guiUpdateLabels()
  if ui.window == nil then return end
  local counts = state.counts or {}
  updateTextView(ui.status_text, formatStatus(state))
  updateTextView(ui.counts_text, "Linien: " .. tostring(counts.lines or 0) .. " | Stationen: " .. tostring(counts.stations or 0) .. " | Gruppen: " .. tostring(counts.station_groups or 0) .. " | Segmente*: " .. tostring(counts.segments or 0) .. " | Routing*: " .. tostring(counts.routing_edges or 0) .. " | Vehicles*: " .. tostring(counts.vehicles or 0) .. " | Exporte: " .. tostring(state.export_count or 0))
  updateTextView(ui.output_text, "Output: " .. tostring(state.last_output or "-"))
  updateTextView(ui.diag_text, "Diagnostics: " .. tostring(state.diagnostics_count or 0) .. " Einträge")

  if state.last_error ~= nil then
    updateTextView(ui.error_text, "Fehler: " .. shorten(state.last_error, 130))
  else
    updateTextView(ui.error_text, "Fehler: -")
  end
  updateTextView(ui.hint_text, shorten((state.last_message or "") .. "  * = experimentell/best-effort; echte TF2-Topologie bleibt erhalten.", 220))
end

local function requestEngineExportFallback(reason)
  local ok, err = pcall(function()
    api.cmd.sendCommand(api.cmd.make.sendScriptEvent(
      SCRIPT_FILE_NAME,
      EVENT_ID,
      EVENT_EXPORT_REQUEST,
      { source = "tixima_ui_engine_fallback", reason = tostring(reason or "direct_ui_export_failed") }
    ))
  end)

  if ok then
    state.status = "engine_requested"
    state.status_text = "Engine-Export angefordert."
    state.last_error = nil
    state.last_message = "Direkter UI-Export war nicht möglich, Engine-Fallback wurde gesendet. Datei tpf2_network_export.json prüfen. Grund: " .. shorten(reason, 120)
    print("[Tixima TF2 Line Exporter] Direct UI export failed, engine fallback sent. Reason: " .. tostring(reason))
  else
    state.status = "error"
    state.status_text = "Export-Anforderung fehlgeschlagen."
    state.last_error = tostring(err)
    state.last_message = "Direkter UI-Export fehlgeschlagen und Engine-Fallback konnte nicht gesendet werden."
    print("[Tixima TF2 Line Exporter] Could not send export request: " .. tostring(err))
  end
end

local function runDirectUiExport()
  state.status = "exporting"
  state.status_text = "Export läuft direkt im UI-Kontext..."
  state.last_error = nil
  state.last_message = "Export gestartet. UI wird nach Abschluss direkt mit Counts und Output aktualisiert."
  guiUpdateLabels()

  local ok, err = pcall(function()
    doExport({ source = "tixima_ui_direct" })
  end)

  if not ok then
    requestEngineExportFallback(err)
  else
    state.last_message = (state.last_message or "Export fertig.") .. " | v1.3.1 UI direkt aktualisiert."
    guiUpdateLabels()
  end
end

local function flushGuiExportRequests()
  if ui.pending_export_requests <= 0 then return end
  local count = ui.pending_export_requests
  ui.pending_export_requests = 0

  for _ = 1, count do
    runDirectUiExport()
  end
end

local function guiUpdate()
  flushGuiExportRequests()
  guiUpdateLabels()
end

function data()
  return {
    load = load,
    save = save,
    update = update,
    handleEvent = handleEvent,
    guiInit = guiInit,
    guiUpdate = guiUpdate,
  }
end

-- Tixima TF2 Line Exporter - v1.1
-- Manual one-shot export with small in-game UI.
-- v1.1 keeps the v1.0.1 backend-ready export stable and adds best-effort mode, boarding/terminal and vehicle fallbacks.
-- Important: fields marked as computed_experimental are NOT direct TF2 API values.

local SCRIPT_FILE_NAME = "tixima_line_exporter.lua"
local EVENT_ID = "tixima_exporter"
local EVENT_EXPORT_REQUEST = "export.request"

local ticks = 0
local engineReady = false

local state = {
  schema = "tixima-tf2-line-exporter-state",
  schema_version = 13,
  mod_version = "1.1",
  status = "loading",
  status_text = "Lade Spielstand...",
  last_message = "Noch kein Export ausgeführt.",
  last_error = nil,
  last_output = nil,
  last_export_unix = nil,
  export_count = 0,
  request_count = 0,
  counts = { lines = 0, stations = 0, station_groups = 0, segments = 0, vehicles = 0, routing_nodes = 0, routing_edges = 0 },
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
    _origin = { record = "tf2_api_best_effort", note = "Stop exported from game.interface LINE.stops. Native terminal/platform fields are not exposed in this source; v1.1.1 adds a single-station-group boarding fallback when possible." },
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

  -- Best detail level: engine component gives full Stop objects with terminal, wait config and waypoints.
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
      diagPush(diag, "warn", "line " .. tostring(eid(lineEntity)) .. " has no readable stops. componentRawType=" .. tostring(type(stopsRaw)) .. ", componentLen=" .. tostring(arrayLen(stopsRaw) or "?") .. ", interfaceRawType=" .. tostring(type(ifaceStopsRaw)) .. ", interfaceLen=" .. tostring(arrayLen(ifaceStopsRaw) or "?"))
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
            note = "Derived by Tixima exporter v1.1.1 from TF2 API stop order and station-group positions. Not a native TF2 segment object.",
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
          from_track = safeField(fromStop, "track"),
          from_track_origin = safeField(fromStop, "track_origin"),
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
          to_track = safeField(toStop, "track"),
          to_track_origin = safeField(toStop, "track_origin"),
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


local function exportVehicles(diag)
  local vehicles = {}
  if api.engine.forEachEntityWithComponent == nil then
    diagPush(diag, "info", "forEachEntityWithComponent not available; vehicles export skipped")
    return vehicles, "forEachEntityWithComponent_not_available"
  end

  local componentToUse = CT_TRANSPORT_VEHICLE
  local sourceName = "TRANSPORT_VEHICLE"
  if componentToUse == nil and CT_VEHICLE ~= nil then
    componentToUse = CT_VEHICLE
    sourceName = "VEHICLE"
    diagPush(diag, "info", "TRANSPORT_VEHICLE component not available; falling back to VEHICLE component scan")
  end
  if componentToUse == nil then
    diagPush(diag, "info", "Neither TRANSPORT_VEHICLE nor VEHICLE component is available; vehicles export skipped")
    return vehicles, "vehicle_component_type_not_available"
  end

  local function getVehicleLineId(vehicleComp, info)
    local candidates = {
      safeField(info, "line"), safeField(info, "lineEntity"), safeField(info, "lineId"), safeField(info, "lineIdStr"),
      safeField(vehicleComp, "line"), safeField(vehicleComp, "lineEntity"), safeField(vehicleComp, "lineId"), safeField(vehicleComp, "lineIdStr")
    }
    for _, value in ipairs(candidates) do
      local idValue = eid(value)
      if idValue ~= nil then return idValue end
    end
    return nil
  end

  local function addVehicle(entity)
    local vehicleComp = getComponent(entity, componentToUse)
    local info = interfaceEntity(entity)
    local lineId = getVehicleLineId(vehicleComp, info)
    local data = {
      _origin = { record = "tf2_api_best_effort", note = "Best-effort vehicle export via " .. sourceName .. " component/game.interface. Exact field availability depends on TF2 build and entity state." },
      experimental = false,
      id = eid(entity),
      name = getName(entity),
      type = safeField(info, "type") or sourceName,
      position = safeField(info, "position") or interfacePosition(entity),
      line_id = lineId,
      line_id_origin = lineId ~= nil and "tf2_api_best_effort_vehicle_field" or "not_available_in_current_vehicle_source",
      model_id = safeField(vehicleComp, "fileName") or safeField(vehicleComp, "modelId") or safeField(vehicleComp, "model") or safeField(info, "fileName") or safeField(info, "modelId"),
      speed = safeField(vehicleComp, "speed") or safeField(info, "speed"),
      state = safeField(vehicleComp, "state") or safeField(info, "state"),
      maintenance_state = safeField(vehicleComp, "maintenanceState") or safeField(info, "maintenanceState"),
      target_maintenance_state = safeField(vehicleComp, "targetMaintenanceState") or safeField(info, "targetMaintenanceState"),
      interface_keys = tableKeys(info, 40),
      component_keys = tableKeys(vehicleComp, 40),
      vehicle_component_source = sourceName,
    }
    vehicles[#vehicles + 1] = data
  end

  local okEach, errEach = pcall(function()
    api.engine.forEachEntityWithComponent(function(entity)
      local okVehicle, errVehicle = pcall(function() addVehicle(entity) end)
      if not okVehicle then diagPush(diag, "warn", "vehicle export skipped for entity " .. tostring(eid(entity)) .. ": " .. tostring(errVehicle)) end
    end, componentToUse)
  end)

  if not okEach then
    vehicles = {}
    local okEach2, errEach2 = pcall(function()
      api.engine.forEachEntityWithComponent(componentToUse, function(entity)
        local okVehicle, errVehicle = pcall(function() addVehicle(entity) end)
        if not okVehicle then diagPush(diag, "warn", "vehicle export skipped for entity " .. tostring(eid(entity)) .. ": " .. tostring(errVehicle)) end
      end)
    end)
    if not okEach2 then
      diagPush(diag, "warn", sourceName .. " export failed: " .. tostring(errEach or errEach2))
      return {}, "failed_" .. sourceName
    end
  end

  diagPush(diag, "info", "best-effort vehicles exported via " .. sourceName .. ": " .. tostring(#vehicles))
  return vehicles, sourceName .. "_component_best_effort"
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

local function buildQualityReport(lines, stations, stationGroups, segments, vehicles)
  local report = {}
  local missingStops = 0
  local unresolvedBoardingStops = 0
  local missingNativeTerminalStops = 0
  local emptyEffectiveTransportModes = 0
  local emptyNativeTransportModes = 0
  local linesWithInterfaceStopFallback = 0

  for _, line in ipairs(lines or {}) do
    if #(safeField(line, "stops") or {}) == 0 then missingStops = missingStops + 1 end
    if #(safeField(line, "transport_modes") or {}) == 0 then emptyEffectiveTransportModes = emptyEffectiveTransportModes + 1 end
    if #(safeField(line, "native_transport_modes") or {}) == 0 then emptyNativeTransportModes = emptyNativeTransportModes + 1 end
    if safeField(line, "stop_source") == "game.interface.LINE.stops" then linesWithInterfaceStopFallback = linesWithInterfaceStopFallback + 1 end
    for _, stop in ipairs(safeField(line, "stops") or {}) do
      if safeField(stop, "terminal") == nil then missingNativeTerminalStops = missingNativeTerminalStops + 1 end
      if safeField(stop, "terminal") == nil and safeField(stop, "boarding_station_id_best_effort") == nil then unresolvedBoardingStops = unresolvedBoardingStops + 1 end
    end
  end

  report[#report + 1] = { level = (#lines > 0 and "ok" or "error"), code = "lines_found", message = tostring(#lines) .. " lines exported." }
  report[#report + 1] = { level = (#stations > 0 and "ok" or "warn"), code = "stations_found", message = tostring(#stations) .. " stations exported." }
  report[#report + 1] = { level = (#stationGroups > 0 and "ok" or "warn"), code = "station_groups_found", message = tostring(#stationGroups) .. " station groups exported." }
  report[#report + 1] = { level = (#segments > 0 and "ok" or "warn"), code = "segments_built", message = tostring(#segments) .. " backend routing segments built." }
  report[#report + 1] = { level = "info", code = "native_segment_times", message = "Native TF2 segment travel times were not available in this one-shot export; v1.1.1 provides computed_experimental estimates." }
  report[#report + 1] = { level = (unresolvedBoardingStops == 0 and "ok" or "warn"), code = "boarding_terminal_resolution", message = tostring(unresolvedBoardingStops) .. " stop entries have neither native terminal nor best-effort boarding station. Native terminal missing on " .. tostring(missingNativeTerminalStops) .. " stop entries." }
  report[#report + 1] = { level = (emptyEffectiveTransportModes == 0 and "ok" or "warn"), code = "transport_modes_effective", message = tostring(emptyEffectiveTransportModes) .. " lines have empty effective transport_modes. Native transport_modes missing on " .. tostring(emptyNativeTransportModes) .. " lines; v1.1.1 infers effective modes from stop/station carriers when available." }
  report[#report + 1] = { level = "info", code = "stop_source", message = tostring(linesWithInterfaceStopFallback) .. " lines use game.interface stop fallback. v1.1.1 adds single-station-group boarding fallback, but native platform/track still depends on TF2 exposing component.Line.stops." }
  report[#report + 1] = { level = "info", code = "vehicles_best_effort", message = tostring(#(vehicles or {})) .. " vehicles exported via best-effort vehicle component scan." }

  return report
end

local function buildExportPayload()
  local diag = {}
  diagPush(diag, "info", "Export started")

  local stations, stationGroups = exportStations(diag)
  local lines, lineSource = exportLines(diag)
  local segments = buildSegments(lines, diag)
  local vehicles, vehicleSource = exportVehicles(diag)
  local lineSummaries = buildLineSummaries(lines, segments, vehicles)
  local routingPackage = buildRoutingAndMapPackage(stationGroups, lines, segments)
  local qualityReport = buildQualityReport(lines, stations, stationGroups, segments, vehicles)

  local backendReady = (#lines > 0 and #stationGroups > 0 and #segments > 0)

  local payload = {
    schema = "tpf2-network-export",
    schema_version = 13,
    generated_by = "Tixima TF2 Line Exporter v1.1.1",
    generated_at_unix = os and os.time and os.time() or nil,
    line_source = lineSource,
    vehicle_source = vehicleSource,
    counts = {
      lines = #lines,
      stations = #stations,
      station_groups = #stationGroups,
      segments = #segments,
      vehicles = #vehicles,
      line_summaries = #lineSummaries,
      routing_nodes = #(routingPackage.routing_nodes or {}),
      routing_edges = #(routingPackage.routing_edges or {}),
      transfers = #(routingPackage.transfers or {}),
      diagnostics = #diag,
      quality_report = #qualityReport,
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
      inferred_transport_modes = true,
      native_terminal_track_data = "only_when_component.Line.stops_is_available; otherwise v1.1.1 exports boarding_station_id_best_effort when station-group contains exactly one station",
      native_segment_travel_times = false,
      live_vehicle_positions = false,
      live_delays = false,
      recommended_backend_entrypoints = {
        import_raw = "Use station_groups, stations, lines and segments for canonical storage.",
        routing = "Use routing_nodes, routing_edges and transfers for first backend graph.",
        map = "Use network_map, routing_nodes, routing_edges and line_summaries for first geographic network plan.",
        diagnostics = "Display quality_report and diagnostics in admin import UI."
      }
    },
    data_origin_legend = {
      tf2_api = "Directly exported from Transport Fever 2 API / game.interface / api.engine where available.",
      tf2_api_best_effort = "Exported through a defensive best-effort TF2 component/interface scan; exact fields may depend on TF2 build/state.",
      computed_experimental = "Calculated by this exporter from TF2 API fields. These values are experimental and may be inaccurate.",
      computed_experimental_assumption = "Calculated by this exporter using an explicit assumption, not confirmed by the current TF2 API export source.",
      not_available = "The exporter did not receive this information from the current TF2 API source."
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
      version = "1.1",
      stable_primary_keys = {
        station_group = "station_groups[].id / routing_nodes[].id",
        station = "stations[].id",
        line = "lines[].id / line_summaries[].line_id",
        segment = "segments[].line_id + segments[].sequence_index",
        routing_edge = "routing_edges[].id"
      },
      import_order = { "station_groups", "stations", "lines", "segments", "routing_nodes", "routing_edges", "transfers", "line_summaries", "vehicles" },
      minimal_backend_tables = { "station_groups", "stations", "lines", "line_stops", "segments", "routing_edges", "transfers", "import_diagnostics" },
      routing_notes = {
        "Use routing_edges.cost_seconds for first Dijkstra/A* MVP.",
        "Add transfers.transfer_time_seconds_experimental when switching line at the same station_group.",
        "Keep all *_origin fields so UI can show whether a value is TF2-native or estimated.",
        "Later live bridge should overwrite segment travel times with measured vehicle runtimes.",
        "v1.1.1 transport_modes can be inferred; native_transport_modes keeps the original TF2 field for transparency.",
        "Use boarding_station_id_best_effort for backend UX when terminal/platform is not natively available."
      }
    },
    experimental = {
      enabled = true,
      warning = "v1.1.1 is backend-ready for static import. It fixes effective transport-mode inference from station carriers and keeps best-effort boarding-station fallback data. Computed distances, times, transfers and map metadata remain experimental estimates, not native TF2 timetable/runtime values.",
      features = {
        computed_segments_v3_backend_ready_distance_and_time = {
          enabled = true,
          origin = "computed_experimental",
          based_on = { "line stop order", "station-group positions", "scale assumption", "detour factor assumption", "speed profile assumption" },
          provides = { "segments", "routing_edges", "distance_game_units_2d", "distance_meters_experimental", "estimated_route_distance_km_experimental", "estimated_travel_time_seconds_experimental", "routing_cost_time_seconds_experimental" },
          does_not_provide = { "native track/platform data unless exposed by component.Line.stops", "native TF2 segment travel time", "live delay data" }
        },
        network_plan_mvp = {
          enabled = true,
          origin = "computed_experimental",
          based_on = { "station_group positions", "line stop order", "computed routing edges" },
          provides = { "network_map", "station_line_index", "routing_nodes", "routing_edges", "line_summaries" }
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
          does_not_provide = { "native platform/track when TF2 does not expose it", "native runtime/fahrplan travel times" }
        }
      }
    },
    quality_report = qualityReport,
    diagnostics = diag,
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
  }
  state.diagnostics_count = payload.counts.diagnostics or 0
  state.last_export_unix = payload.generated_at_unix
  state.export_count = (state.export_count or 0) + 1

  print("[Tixima TF2 Line Exporter] Export generated. Lines: " .. tostring(payload.counts.lines) .. ", Stations: " .. tostring(payload.counts.stations) .. ", Station groups: " .. tostring(payload.counts.station_groups) .. ", Segments: " .. tostring(payload.counts.segments) .. ", Routing edges: " .. tostring(payload.counts.routing_edges) .. ", Vehicles*: " .. tostring(payload.counts.vehicles))

  if wrote then
    state.status = "ok"
    state.status_text = "Export fertig."
    state.last_output = tostring(targetOrErr)
    state.last_message = "JSON geschrieben nach: " .. tostring(targetOrErr) .. " | Segmente*: " .. tostring(payload.counts.segments) .. " | Routing*: " .. tostring(payload.counts.routing_edges) .. " | Vehicles*: " .. tostring(payload.counts.vehicles) .. " | Diagnostics: " .. tostring(state.diagnostics_count)
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
  return state
end

local function load(loadedState)
  if type(loadedState) == "table" then
    state = loadedState
  end

  local previousVersion = state.mod_version
  state.schema_version = 13
  state.mod_version = "1.0"
  if state.counts == nil then state.counts = { lines = 0, stations = 0, station_groups = 0 } end
  if state.export_count == nil then state.export_count = 0 end
  if state.request_count == nil then state.request_count = 0 end
  if state.diagnostics_count == nil then state.diagnostics_count = 0 end
  if state.counts.segments == nil then state.counts.segments = 0 end
  if state.counts.vehicles == nil then state.counts.vehicles = 0 end
  if state.counts.routing_nodes == nil then state.counts.routing_nodes = 0 end
  if state.counts.routing_edges == nil then state.counts.routing_edges = 0 end
  if state.counts.transfers == nil then state.counts.transfers = 0 end

  if previousVersion ~= "1.0" then
    state.status = "loading"
    state.status_text = "v1.0.1 geladen. Warte auf Engine..."
    state.last_error = nil
    state.last_message = "v1.0.1 ist backend-ready: Topologie, Segmente, Routing-Graph, Netzplan-Metadaten, Line-Summaries und optionaler Vehicle-Scan. Bitte Export erneut starten."
  elseif state.status == nil then
    state.status = "loading"
    state.status_text = "Lade Spielstand..."
  end
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

  ui.status_text = guiAddText(layout, "Status: wird geladen...")
  ui.counts_text = guiAddText(layout, "Linien: - | Stationen: - | Gruppen: - | Segmente*: -")
  ui.output_text = guiAddText(layout, "Output: -")
  ui.error_text = guiAddText(layout, "Fehler: -")
  ui.diag_text = guiAddText(layout, "Diagnostics: -")
  ui.hint_text = guiAddText(layout, "Hinweis: Export wird manuell ausgelöst und überschreibt tpf2_network_export.json.")

  local buttons = guiContainer("TiximaExporterButtons", "tixima_exporter_buttons")
  local buttonLayout = api.gui.layout.BoxLayout.new("HORIZONTAL")
  buttons:setLayout(buttonLayout)

  local exportButton = guiButton("Export jetzt starten", function()
    ui.pending_export_requests = ui.pending_export_requests + 1
    if ui.status_text then ui.status_text:setText("Status: Export angefordert...") end
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

local function flushGuiExportRequests()
  if ui.pending_export_requests <= 0 then return end
  local count = ui.pending_export_requests
  ui.pending_export_requests = 0

  for _ = 1, count do
    local ok, err = pcall(function()
      api.cmd.sendCommand(api.cmd.make.sendScriptEvent(
        SCRIPT_FILE_NAME,
        EVENT_ID,
        EVENT_EXPORT_REQUEST,
        { requested_at_unix = os and os.time and os.time() or nil, source = "tixima_ui" }
      ))
    end)
    if not ok then
      print("[Tixima TF2 Line Exporter] Could not send export request: " .. tostring(err))
      updateTextView(ui.status_text, "Status: Export-Anforderung konnte nicht gesendet werden: " .. tostring(err))
    end
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

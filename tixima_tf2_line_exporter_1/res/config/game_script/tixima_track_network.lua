-- PathForgeFever track network export – physical rail geometry + line paths along tracks
-- Powered by Tixima Gaming

local M = {}

M.SCHEMA = "tixima-track-network"
M.SCHEMA_VERSION = 1
M.EDGES_PER_TICK = 6

function M.defaultConfig()
  return {
    sample_spacing_m = 8,
    min_spacing_m = 4,
    max_spacing_m = 16,
    max_points_per_edge = 512,
    length_probe_samples = 24,
  }
end

local function mergeConfig(options)
  local cfg = M.defaultConfig()
  if type(options) ~= "table" then return cfg end
  for k, v in pairs(options) do
    if cfg[k] ~= nil and v ~= nil then cfg[k] = v end
  end
  local spacing = tonumber(cfg.sample_spacing_m) or 8
  spacing = math.max(cfg.min_spacing_m, math.min(cfg.max_spacing_m, spacing))
  cfg.sample_spacing_m = spacing
  return cfg
end

local function readPathPosition(deps, edgeId, t)
  if api == nil or api.engine == nil or api.engine.getPos01 == nil then return nil end
  local ok, result = pcall(function() return api.engine.getPos01(edgeId, t) end)
  if not ok or result == nil then return nil end
  local pos = deps.safeField(result, "position")
  if pos ~= nil then return deps.vecToPlainTable(pos) end
  return deps.vecToPlainTable(result)
end

local function makeEdgeId(deps, tnEntity, edgeIndex)
  if api == nil or api.type == nil or api.type.EdgeId == nil or api.type.EdgeId.new == nil then return nil end
  local ok, edgeId = pcall(function() return api.type.EdgeId.new(tnEntity, edgeIndex) end)
  if ok then return edgeId end
  return nil
end

local function makeNodeId(deps, tnEntity, nodeIndex)
  if api == nil or api.type == nil or api.type.NodeId == nil or api.type.NodeId.new == nil then return nil end
  local ok, nodeId = pcall(function() return api.type.NodeId.new(tnEntity, nodeIndex) end)
  if ok then return nodeId end
  return nil
end

local function readNodeIndex(deps, nodeRef)
  if nodeRef == nil then return nil end
  local idx = deps.safeTonumber(deps.safeField(nodeRef, "index"))
  if idx ~= nil then return idx end
  return deps.safeTonumber(nodeRef)
end

local function nodeLabel(tnEntityId, nodeIndex)
  if tnEntityId == nil or nodeIndex == nil then return nil end
  return "node:" .. tostring(tnEntityId) .. ":" .. tostring(nodeIndex)
end

local function estimateEdgeLength(deps, edgeId, probeSamples)
  local samples = math.max(4, tonumber(probeSamples) or 24)
  local total = 0.0
  local prev = nil
  for i = 0, samples do
    local t = i / samples
    local p = readPathPosition(deps, edgeId, t)
    if p ~= nil and prev ~= nil then
      total = total + (deps.distance3d(prev, p) or 0)
    end
    prev = p
  end
  return total
end

local function buildSvgPoint(deps, point, coordinateSystem)
  local coords = deps.buildCoordinatePackage({ point[1], point[2], point[3] or 0 }, coordinateSystem)
  local svg = coords ~= nil and deps.safeField(coords, "svg_1000") or nil
  if svg == nil then return nil end
  local x = deps.safeTonumber(deps.safeField(svg, "x"))
  local y = deps.safeTonumber(deps.safeField(svg, "y"))
  if x == nil or y == nil then return nil end
  return { x = x, y = y }
end

local function sampleEdgePolyline(deps, edgeId, coordinateSystem, cfg)
  local lengthGu = estimateEdgeLength(deps, edgeId, cfg.length_probe_samples)
  if lengthGu == nil or lengthGu <= 0 then lengthGu = 1 end
  local spacing = tonumber(cfg.sample_spacing_m) or 8
  local count = math.max(2, math.ceil(lengthGu / spacing) + 1)
  if count > cfg.max_points_per_edge then count = cfg.max_points_per_edge end

  local worldPoints = {}
  local svgPoints = {}
  for i = 0, count - 1 do
    local t = (count <= 1) and 0 or (i / (count - 1))
    local p = readPathPosition(deps, edgeId, t)
    if p ~= nil then
      worldPoints[#worldPoints + 1] = {
        x = deps.roundCoord(p[1]),
        y = deps.roundCoord(p[2]),
        z = deps.roundCoord(p[3] or 0),
      }
      local svg = buildSvgPoint(deps, p, coordinateSystem)
      if svg ~= nil then svgPoints[#svgPoints + 1] = svg end
    end
  end
  return worldPoints, svgPoints, lengthGu
end

local function classifyBaseEdge(deps, entity)
  local CT_BRIDGE = deps.componentType("BRIDGE")
  if CT_BRIDGE ~= nil and deps.getComponent(entity, CT_BRIDGE) ~= nil then return "bridge" end

  local CT_BASE_EDGE_TRACK = deps.componentType("BASE_EDGE_TRACK")
  if CT_BASE_EDGE_TRACK ~= nil then
    local track = deps.getComponent(entity, CT_BASE_EDGE_TRACK)
    if track ~= nil then
      local tunnel = deps.safeField(track, "tunnel") or deps.safeField(track, "isTunnel")
      if tunnel == true or tunnel == 1 then return "tunnel" end
      local elevated = deps.safeField(track, "elevated") or deps.safeField(track, "isElevated")
      if elevated == true or elevated == 1 then return "elevated" end
    end
  end
  return "normal"
end

local function isTrackBaseEdge(deps, entity)
  local CT_BASE_EDGE_TRACK = deps.componentType("BASE_EDGE_TRACK")
  if CT_BASE_EDGE_TRACK ~= nil and deps.getComponent(entity, CT_BASE_EDGE_TRACK) ~= nil then return true end
  return false
end

local function readEdgeNodeIndices(deps, tnComponent, edgeIndex)
  local edges = deps.safeField(tnComponent, "edges")
  if edges == nil then return nil, nil end
  local edge = deps.rawIndex(edges, edgeIndex + 1) or deps.rawIndex(edges, edgeIndex)
  if edge == nil then return nil, nil end
  local n0 = deps.safeField(edge, "node0") or deps.safeField(edge, "nodeA") or deps.safeField(edge, "fromNode")
  local n1 = deps.safeField(edge, "node1") or deps.safeField(edge, "nodeB") or deps.safeField(edge, "toNode")
  return readNodeIndex(deps, n0), readNodeIndex(deps, n1)
end

function M.collectTrackJobs(deps, diag)
  local jobs = {}
  if api == nil or api.engine == nil or api.engine.forEachEntityWithComponent == nil then
    deps.diagPush(diag, "warn", "track network scan skipped: api.engine.forEachEntityWithComponent unavailable")
    return jobs
  end
  local CT_BASE_EDGE = deps.componentType("BASE_EDGE")
  local CT_TRANSPORT_NETWORK = deps.componentType("TRANSPORT_NETWORK")
  if CT_BASE_EDGE == nil or CT_TRANSPORT_NETWORK == nil then
    deps.diagPush(diag, "warn", "track network scan skipped: BASE_EDGE or TRANSPORT_NETWORK component type unavailable")
    return jobs
  end

  local ok, err = pcall(function()
    api.engine.forEachEntityWithComponent(CT_BASE_EDGE, function(entity)
      if not isTrackBaseEdge(deps, entity) then return end
      local tn = deps.getComponent(entity, CT_TRANSPORT_NETWORK)
      if tn == nil then return end
      local edgeCount = deps.safeLen(deps.safeField(tn, "edges"))
      if edgeCount <= 0 then return end
      jobs[#jobs + 1] = {
        base_edge_entity = deps.eid(entity),
        transport_network_entity = deps.eid(entity),
        edge_count = edgeCount,
        classification = classifyBaseEdge(deps, entity),
      }
    end)
  end)

  if not ok then
    deps.diagPush(diag, "warn", "track network scan failed: " .. tostring(err))
    return jobs
  end

  deps.diagPush(diag, "info", "track network scan found " .. tostring(#jobs) .. " rail base-edge transport networks")
  return jobs
end

function M.exportTrackEdge(deps, job, edgeIndex, coordinateSystem, cfg, diag)
  local tnEntity = job.transport_network_entity
  if tnEntity == nil then return nil end
  local edgeId = makeEdgeId(deps, tnEntity, edgeIndex)
  if edgeId == nil then return nil end

  local tn = deps.getComponent(tnEntity, deps.componentType("TRANSPORT_NETWORK"))
  local fromNodeIdx, toNodeIdx = readEdgeNodeIndices(deps, tn, edgeIndex)
  local worldPoints, svgPoints, lengthGu = sampleEdgePolyline(deps, edgeId, coordinateSystem, cfg)
  if #worldPoints < 2 then return nil end

  return {
    edge_entity = job.base_edge_entity,
    transport_network_entity = job.transport_network_entity,
    edge_index = edgeIndex,
    type = "rail",
    from_node = nodeLabel(job.transport_network_entity, fromNodeIdx),
    to_node = nodeLabel(job.transport_network_entity, toNodeIdx),
    points = worldPoints,
    svg_1000 = svgPoints,
    length_game_units = deps.roundCoord(lengthGu),
    sample_spacing_m = cfg.sample_spacing_m,
    classification = job.classification or "normal",
  }
end

function M.createContext(trackJobs, options)
  return {
    jobs = trackJobs or {},
    jobIndex = 1,
    edgeIndex = 0,
    edges = {},
    line_paths = {},
    options = mergeConfig(options),
    status = "pending",
    total_jobs = #(trackJobs or {}),
    jobs_done = 0,
  }
end

function M.tickExport(ctx, deps, coordinateSystem, diag, batchJobs)
  if ctx == nil then return true end
  batchJobs = tonumber(batchJobs) or M.EDGES_PER_TICK
  if ctx.status == "done" then return true end

  if ctx.status == "pending" then
    ctx.status = "edges"
  end

  if ctx.status == "edges" then
    local processed = 0
    while processed < batchJobs do
      if ctx.jobIndex > #ctx.jobs then
        ctx.status = "line_paths"
        break
      end
      local job = ctx.jobs[ctx.jobIndex]
      if ctx.edgeIndex >= (job.edge_count or 0) then
        ctx.jobIndex = ctx.jobIndex + 1
        ctx.edgeIndex = 0
        ctx.jobs_done = ctx.jobs_done + 1
      else
        local edge = M.exportTrackEdge(deps, job, ctx.edgeIndex, coordinateSystem, ctx.options, diag)
        if edge ~= nil then ctx.edges[#ctx.edges + 1] = edge end
        ctx.edgeIndex = ctx.edgeIndex + 1
        processed = processed + 1
      end
    end
    if ctx.jobIndex > #ctx.jobs then ctx.status = "line_paths" end
    return ctx.status ~= "line_paths"
  end

  if ctx.status == "line_paths" then
    ctx.line_paths = M.buildLineTrackPaths(deps, ctx.line_input, coordinateSystem, ctx.options, diag)
    ctx.status = "done"
    return true
  end

  return true
end

local function stationEntityForGroup(deps, stationGroups, stations, groupId)
  local gid = tostring(groupId or "")
  for _, station in ipairs(stations or {}) do
    if tostring(deps.safeField(station, "station_group_id") or "") == gid then
      return deps.safeField(station, "id")
    end
  end
  for _, group in ipairs(stationGroups or {}) do
    if tostring(deps.safeField(group, "id") or "") == gid then
      local ids = deps.safeField(group, "station_ids")
      if type(ids) == "table" and #ids > 0 then return ids[1] end
      local first = deps.rawIndex(ids, 1)
      if first ~= nil then return first end
    end
  end
  return nil
end

local function vehicleNodeIdsForStop(deps, stop, stationEntity, vehicleNodeMap)
  if vehicleNodeMap == nil or stationEntity == nil then return nil end
  local terminal = deps.safeTonumber(deps.safeField(stop, "terminal"))
    or deps.safeTonumber(deps.safeField(stop, "track"))
    or deps.safeTonumber(deps.safeField(stop, "track_index0"))
  if terminal == nil then terminal = 0 end

  local matches = {}
  for nodeId, terminalInfo in pairs(vehicleNodeMap) do
    local st = deps.safeField(terminalInfo, "station")
    local term = deps.safeTonumber(deps.safeField(terminalInfo, "terminal"))
    local stationMatch = tostring(deps.eid(st)) == tostring(deps.eid(stationEntity))
      or tostring(st) == tostring(stationEntity)
    if stationMatch and (term == nil or term == terminal) then
      matches[#matches + 1] = nodeId
    end
  end
  if #matches == 0 then
    for nodeId, terminalInfo in pairs(vehicleNodeMap) do
      local st = deps.safeField(terminalInfo, "station")
      if tostring(deps.eid(st)) == tostring(deps.eid(stationEntity)) or tostring(st) == tostring(stationEntity) then
        matches[#matches + 1] = nodeId
      end
    end
  end
  return matches
end

local function nodeIdListToArray(deps, nodeIds)
  local out = {}
  for _, nodeId in ipairs(nodeIds or {}) do
    if nodeId ~= nil then out[#out + 1] = nodeId end
  end
  return out
end

local function samplePathPolyline(deps, path, coordinateSystem, cfg)
  if path == nil then return nil, nil, "missing_path" end
  local edges = deps.safeField(path, "edges")
  if edges == nil then return nil, nil, "missing_path_edges" end
  local edgeCount = deps.safeLen(edges)
  if edgeCount == 0 then return nil, nil, "empty_path_edges" end

  local worldPoints = {}
  local svgPoints = {}
  local spacing = tonumber(cfg.sample_spacing_m) or 8

  local function appendPoint(p)
    if p == nil then return end
    local plain = { p[1], p[2], p[3] or 0 }
    local last = worldPoints[#worldPoints]
    if last ~= nil and last.x == deps.roundCoord(plain[1]) and last.y == deps.roundCoord(plain[2]) then return end
    worldPoints[#worldPoints + 1] = {
      x = deps.roundCoord(plain[1]),
      y = deps.roundCoord(plain[2]),
      z = deps.roundCoord(plain[3] or 0),
    }
    local svg = buildSvgPoint(deps, plain, coordinateSystem)
    if svg ~= nil then svgPoints[#svgPoints + 1] = svg end
  end

  for i = 1, edgeCount do
    local edgeEntry = deps.rawIndex(edges, i)
    if edgeEntry == nil then edgeEntry = deps.rawIndex(edges, i - 1) end
    if edgeEntry == nil then goto continue_edge end

    local edgeId = deps.safeField(edgeEntry, "edgeId") or deps.safeField(edgeEntry, "edge")
    local direction = deps.safeField(edgeEntry, "direction")
    if direction == nil then direction = deps.safeField(edgeEntry, "dir") end
    if edgeId == nil then goto continue_edge end

    local lengthGu = estimateEdgeLength(deps, edgeId, cfg.length_probe_samples)
    if lengthGu == nil or lengthGu <= 0 then lengthGu = 1 end
    local count = math.max(2, math.ceil(lengthGu / spacing) + 1)
    if count > cfg.max_points_per_edge then count = cfg.max_points_per_edge end

    for j = 0, count - 1 do
      local t = (count <= 1) and 0 or (j / (count - 1))
      if direction == false then t = 1 - t end
      appendPoint(readPathPosition(deps, edgeId, t))
    end
    ::continue_edge::
  end

  if #worldPoints < 2 then return nil, nil, "insufficient_points" end
  return worldPoints, svgPoints, "pathfinding"
end

local function edgesFromVehicleNode(deps, nodeId)
  local starters = {}
  if nodeId == nil or api == nil or api.type == nil then return starters end

  local tnEntity = deps.safeField(nodeId, "edgeId") or deps.safeField(nodeId, "entity")
  local nodeIndex = readNodeIndex(deps, nodeId)
  if tnEntity == nil or nodeIndex == nil then return starters end

  local tn = deps.getComponent(tnEntity, deps.componentType("TRANSPORT_NETWORK"))
  if tn == nil then return starters end
  local nodes = deps.safeField(tn, "nodes")
  local node = deps.rawIndex(nodes, nodeIndex + 1) or deps.rawIndex(nodes, nodeIndex)
  if node == nil then return starters end

  local ports = deps.safeField(node, "ports") or deps.safeField(node, "port")
  if ports == nil then return starters end
  local portCount = deps.safeLen(ports)
  for i = 1, portCount do
    local port = deps.rawIndex(ports, i) or deps.rawIndex(ports, i - 1)
    if port == nil then goto continue_port end
    local edgeIdx = readNodeIndex(deps, deps.safeField(port, "edge"))
      or deps.safeTonumber(deps.safeField(port, "edgeIndex"))
      or deps.safeTonumber(deps.safeField(port, "edge_index"))
    if edgeIdx == nil then goto continue_port end
    local edgeId = makeEdgeId(deps, tnEntity, edgeIdx)
    if edgeId ~= nil and api.type.EdgeIdDirAndLength ~= nil and api.type.EdgeIdDirAndLength.new ~= nil then
      local ok, starter = pcall(function() return api.type.EdgeIdDirAndLength.new(edgeId, true, 0.0) end)
      if ok and starter ~= nil then starters[#starters + 1] = starter end
    end
    ::continue_port::
  end
  return starters
end

local function tryFindPath(deps, fromStop, toStop, stationGroups, stations, vehicleNodeMap, coordinateSystem, cfg, diag)
  if api == nil or api.engine == nil or api.engine.util == nil or api.engine.util.pathfinding == nil then
    return nil, nil, "pathfinding_unavailable"
  end
  local findPath = api.engine.util.pathfinding.findPath
  if findPath == nil then return nil, nil, "pathfinding_unavailable" end

  local fromGroupId = deps.safeField(fromStop, "station_group_id")
  local toGroupId = deps.safeField(toStop, "station_group_id")
  local fromStationEntity = stationEntityForGroup(deps, stationGroups, stations, fromGroupId)
  local toStationEntity = stationEntityForGroup(deps, stationGroups, stations, toGroupId)
  if fromStationEntity == nil or toStationEntity == nil then
    return nil, nil, "station_entity_missing"
  end

  local fromNodeIds = vehicleNodeIdsForStop(deps, fromStop, fromStationEntity, vehicleNodeMap)
  local toNodeIds = vehicleNodeIdsForStop(deps, toStop, toStationEntity, vehicleNodeMap)
  if fromNodeIds == nil or #fromNodeIds == 0 or toNodeIds == nil or #toNodeIds == 0 then
    return nil, nil, "vehicle_nodes_missing"
  end

  local starting = {}
  for _, nodeId in ipairs(fromNodeIds) do
    local starters = edgesFromVehicleNode(deps, nodeId)
    for _, starter in ipairs(starters) do starting[#starting + 1] = starter end
  end

  local destinations = nodeIdListToArray(deps, toNodeIds)
  if #starting == 0 or #destinations == 0 then return nil, nil, "path_endpoints_missing" end

  local ok, path = pcall(function()
    return findPath(starting, destinations, {}, 100000.0)
  end)
  if not ok or path == nil then return nil, nil, "pathfinding_failed" end
  return samplePathPolyline(deps, path, coordinateSystem, cfg)
end

local function fallbackSegmentLine(deps, fromStop, toStop, coordinateSystem)
  local a = deps.vecToPlainTable(deps.safeField(fromStop, "station_group_position"))
  local b = deps.vecToPlainTable(deps.safeField(toStop, "station_group_position"))
  if a == nil or b == nil then return nil, nil end
  local worldPoints = {
    { x = deps.roundCoord(a[1]), y = deps.roundCoord(a[2]), z = deps.roundCoord(a[3] or 0) },
    { x = deps.roundCoord(b[1]), y = deps.roundCoord(b[2]), z = deps.roundCoord(b[3] or 0) },
  }
  local svgPoints = {}
  for _, p in ipairs(worldPoints) do
    local svg = buildSvgPoint(deps, { p.x, p.y, p.z }, coordinateSystem)
    if svg ~= nil then svgPoints[#svgPoints + 1] = svg end
  end
  return worldPoints, svgPoints
end

function M.buildLineTrackPaths(deps, input, coordinateSystem, cfg, diag)
  input = input or {}
  local lines = input.lines or {}
  local stationGroups = input.stationGroups or {}
  local stations = input.stations or {}
  local lineColors = input.lineColors or {}

  local vehicleNodeMap = nil
  if api ~= nil and api.engine ~= nil and api.engine.system ~= nil and api.engine.system.stationSystem ~= nil then
    local getter = deps.safeField(api.engine.system.stationSystem, "getVehicleNodeId2StationTerminalsMap")
    if getter ~= nil then
      local ok, map = pcall(function() return getter() end)
      if ok and type(map) == "table" then vehicleNodeMap = map end
    end
  end

  local paths = {}
  local pathfindingOk = 0
  local fallbackCount = 0

  for _, line in ipairs(lines) do
    local stops = deps.safeField(line, "stops") or {}
    local lineId = deps.safeField(line, "id")
    local lineName = deps.safeField(line, "name")
  local colorHex = lineColors[tostring(lineId or "")] or lineColors[lineId]
    if colorHex == nil then
      local dc = deps.safeField(line, "display_color")
      colorHex = deps.safeField(dc, "hex")
    end

    for i = 1, #stops - 1 do
      local fromStop = deps.rawIndex(stops, i)
      local toStop = deps.rawIndex(stops, i + 1)
      if fromStop == nil or toStop == nil then goto continue_segment end

      local worldPoints, svgPoints, source = tryFindPath(
        deps, fromStop, toStop, stationGroups, stations, vehicleNodeMap, coordinateSystem, cfg, diag
      )
      if worldPoints == nil then
        worldPoints, svgPoints = fallbackSegmentLine(deps, fromStop, toStop, coordinateSystem)
        source = "station_positions_fallback"
        fallbackCount = fallbackCount + 1
      else
        pathfindingOk = pathfindingOk + 1
      end
      if worldPoints == nil or #worldPoints < 2 then goto continue_segment end

      paths[#paths + 1] = {
        line_id = lineId,
        sequence_index = i - 1,
        line_name = lineName,
        line_color_hex = colorHex,
        from_station_group_id = deps.safeField(fromStop, "station_group_id"),
        to_station_group_id = deps.safeField(toStop, "station_group_id"),
        points = worldPoints,
        svg_1000 = svgPoints,
        source = source or "unknown",
      }
      ::continue_segment::
    end
  end

  deps.diagPush(
    diag,
    "info",
    "line track paths built: " .. tostring(#paths) .. " segments (" .. tostring(pathfindingOk) .. " via pathfinding, " .. tostring(fallbackCount) .. " fallback)"
  )
  return paths
end

function M.setLineInput(ctx, input)
  if ctx ~= nil then ctx.line_input = input end
end

function M.finalize(ctx, diag)
  if ctx == nil then
    return {
      schema = M.SCHEMA,
      schema_version = M.SCHEMA_VERSION,
      status = "skipped",
      edges = {},
      line_paths = {},
      edge_count = 0,
      line_path_count = 0,
    }
  end

  local edges = ctx.edges or {}
  local linePaths = ctx.line_paths or {}
  local status = (#edges > 0 and "ok") or "empty"

  if type(diag) == "table" then
    diag[#diag + 1] = {
      level = (#edges > 0 and "ok" or "warn"),
      message = "track_network export: " .. tostring(#edges) .. " rail edges, " .. tostring(#linePaths) .. " line paths",
    }
  end

  return {
    schema = M.SCHEMA,
    schema_version = M.SCHEMA_VERSION,
    status = status,
    sample_spacing_m = ctx.options and ctx.options.sample_spacing_m,
    sample_spacing_min_m = ctx.options and ctx.options.min_spacing_m,
    sample_spacing_max_m = ctx.options and ctx.options.max_spacing_m,
    edge_count = #edges,
    line_path_count = #linePaths,
    transport_network_jobs = ctx.total_jobs or 0,
    edges = edges,
    line_paths = linePaths,
    _origin = {
      record = "tf2_api_plus_computed_sampling",
      note = "Physical rail edges sampled via api.engine.getPos01 along transport-network splines. Line paths prefer api.engine.util.pathfinding between station vehicle nodes.",
    },
  }
end

return M

// ============================================================================
// Volt Defense — Enemies Module
// Enemy spawning, movement, AI, and wave management.
// ============================================================================

var Enemies = (function () {
    var _enemies = [];
    var _nextId = 1;

    // ---- Spatial Grid (performance optimisation) ---------------------------
    var _spatialGrid = {};
    var _spatialCellSize = 200;

    // ---- A* Node Pool (performance optimisation) ---------------------------
    var _nodePool = [];
    var _nodePoolIdx = 0;

    function _getNode() {
        if (_nodePoolIdx < _nodePool.length) {
            var node = _nodePool[_nodePoolIdx++];
            node.g = 0; node.h = 0; node.f = 0;
            node.parent = null; node.key = '';
            node.x = 0; node.y = 0;
            return node;
        }
        var newNode = { x: 0, y: 0, g: 0, h: 0, f: 0, parent: null, key: '' };
        _nodePool.push(newNode);
        _nodePoolIdx++;
        return newNode;
    }

    function _resetNodePool() {
        _nodePoolIdx = 0;
    }
    var _currentWave = 0;
    var _spawnQueue = [];
    var _spawnTimer = 0;
    var _totalKills = 0;
    var _totalScore = 0;
    var _totalEscaped = 0;
    var _rangedEffects = []; // visual effects for ranged attacks {type, fromX, fromY, toX, toY, timer, maxTimer, ...}
    var _spawnPoints = [];
    var _reachableSpawnsCache = null;  // cached list of spawn points that can reach core
    var _buildingCountAtCache = -1;    // building count when cache was computed

    // ---- Path Cache --------------------------------------------------------
    // Caches A* results by grid cell so nearby spawns reuse previous paths.
    // Invalidated when buildings are placed/removed (walkability changes).
    var _pathCache = {};               // key: 'gx,gy,targetKey' -> { path: [...] | null }
    var _pathCacheRadius = 3;          // grid-cell search radius for cache hits
    var _deferredPathQueue = [];       // enemies needing real A* (have direct path for now)
    var _maxPathfindsPerTick = 1;      // limit expensive A* calls per game tick
    var _pathBudgetThisTick = 0;       // tracks A* calls this tick across all sources

    // ---- Helpers -----------------------------------------------------------

    /**
     * Get the seeded RNG if available, otherwise return null (use Math.random).
     */
    function _getRng() {
        return (typeof Engine !== 'undefined' && Engine.getRng) ? Engine.getRng() : null;
    }

    function _getSpatialKey(worldX, worldY) {
        var cx = Math.floor(worldX / _spatialCellSize);
        var cy = Math.floor(worldY / _spatialCellSize);
        return cx + ',' + cy;
    }

    function _rebuildSpatialGrid() {
        _spatialGrid = {};
        for (var i = 0; i < _enemies.length; i++) {
            var e = _enemies[i];
            var key = _getSpatialKey(e.x, e.y);
            if (!_spatialGrid[key]) _spatialGrid[key] = [];
            _spatialGrid[key].push(e);
        }
    }

    function _getNearbyEnemies(worldX, worldY, range) {
        var results = [];
        var minCx = Math.floor((worldX - range) / _spatialCellSize);
        var maxCx = Math.floor((worldX + range) / _spatialCellSize);
        var minCy = Math.floor((worldY - range) / _spatialCellSize);
        var maxCy = Math.floor((worldY + range) / _spatialCellSize);
        for (var cx = minCx; cx <= maxCx; cx++) {
            for (var cy = minCy; cy <= maxCy; cy++) {
                var cell = _spatialGrid[cx + ',' + cy];
                if (cell) {
                    for (var i = 0; i < cell.length; i++) {
                        results.push(cell[i]);
                    }
                }
            }
        }
        return results;
    }

    /**
     * Get the core building's world-center position.
     * Falls back to map centre if Buildings module isn't loaded yet.
     */
    function _getCorePosition() {
        if (typeof Buildings !== 'undefined' && Buildings.getCore) {
            var core = Buildings.getCore();
            if (core) {
                var def = Config.BUILDINGS.core;
                var halfW = (def.size[0] * Config.GRID_CELL_SIZE) / 2;
                var halfH = (def.size[1] * Config.GRID_CELL_SIZE) / 2;
                return { x: core.worldX + halfW, y: core.worldY + halfH };
            }
        }
        return { x: Config.MAP_WIDTH / 2, y: Config.MAP_HEIGHT / 2 };
    }

    /**
     * Get the current difficulty settings. Returns a safe default object
     * if Engine isn't available.
     */
    function _getDifficulty() {
        if (typeof Engine !== 'undefined' && Engine.getDifficulty) {
            return Engine.getDifficulty();
        }
        return Config.DIFFICULTY.volt;
    }

    // ---- A* Pathfinding ----------------------------------------------------

    /**
     * Convert world coordinates to grid coordinates.
     */
    function _worldToGrid(wx, wy) {
        return {
            gx: Math.floor(wx / Config.GRID_CELL_SIZE),
            gy: Math.floor(wy / Config.GRID_CELL_SIZE)
        };
    }

    /**
     * Convert grid coordinates to world-centre coordinates.
     */
    function _gridToWorld(gx, gy) {
        return {
            x: gx * Config.GRID_CELL_SIZE + Config.GRID_CELL_SIZE / 2,
            y: gy * Config.GRID_CELL_SIZE + Config.GRID_CELL_SIZE / 2
        };
    }

    // Temporary blocked cells for placement validation (set by Buildings module)
    var _tempBlockedCells = {};

    /**
     * Check whether a grid cell is walkable (not water, not deep_water).
     * If targetBuildingId is provided, buildings occupying the cell are
     * treated as unwalkable UNLESS they are the target building.
     */
    function _isWalkable(gx, gy, targetBuildingId, endGx, endGy) {
        // Always allow the goal cell
        if (gx === endGx && gy === endGy) return true;

        var gridCols = Math.floor(Config.MAP_WIDTH / Config.GRID_CELL_SIZE);
        var gridRows = Math.floor(Config.MAP_HEIGHT / Config.GRID_CELL_SIZE);
        if (gx < 0 || gy < 0 || gx >= gridCols || gy >= gridRows) {
            return false;
        }

        if (typeof Map !== 'undefined' && Map.getTerrain) {
            var terrain = Map.getTerrain(gx, gy);
            if (terrain === Config.TERRAIN_TYPES.water ||
                terrain === Config.TERRAIN_TYPES.deep_water) {
                return false;
            }
        }

        // Check temporary blocked cells (for placement validation)
        var bk = gx + ',' + gy;
        if (_tempBlockedCells[bk]) return false;

        // Block cells occupied by non-target buildings
        if (typeof Buildings !== 'undefined' && Buildings.getAt) {
            var bld = Buildings.getAt(gx, gy);
            if (bld && bld.hp > 0) {
                // Allow walking to the core
                if (bld.type === 'core') return true;
                if (!targetBuildingId || bld.id !== targetBuildingId) {
                    return false;
                }
            }
        }

        return true;
    }

    // ---- Binary Min-Heap for A* priority queue ----

    function _BinaryHeap() {
        this._data = [];
        this._positions = {}; // key -> index in _data
    }

    _BinaryHeap.prototype.size = function() {
        return this._data.length;
    };

    _BinaryHeap.prototype.push = function(node) {
        var idx = this._data.length;
        this._data.push(node);
        this._positions[node.key] = idx;
        this._bubbleUp(idx);
    };

    _BinaryHeap.prototype.pop = function() {
        var data = this._data;
        if (data.length === 0) return null;
        var top = data[0];
        var last = data.pop();
        delete this._positions[top.key];
        if (data.length > 0) {
            data[0] = last;
            this._positions[last.key] = 0;
            this._sinkDown(0);
        }
        return top;
    };

    _BinaryHeap.prototype.updateNode = function(node) {
        var idx = this._positions[node.key];
        if (idx === undefined) {
            this.push(node);
            return;
        }
        this._data[idx] = node;
        this._bubbleUp(idx);
        this._sinkDown(this._positions[node.key]);
    };

    _BinaryHeap.prototype.contains = function(key) {
        return this._positions[key] !== undefined;
    };

    _BinaryHeap.prototype.get = function(key) {
        var idx = this._positions[key];
        return idx !== undefined ? this._data[idx] : null;
    };

    _BinaryHeap.prototype._bubbleUp = function(idx) {
        var data = this._data;
        var pos = this._positions;
        while (idx > 0) {
            var parent = (idx - 1) >> 1;
            if (data[idx].f < data[parent].f) {
                var tmp = data[parent];
                data[parent] = data[idx];
                data[idx] = tmp;
                pos[data[parent].key] = parent;
                pos[data[idx].key] = idx;
                idx = parent;
            } else {
                break;
            }
        }
    };

    _BinaryHeap.prototype._sinkDown = function(idx) {
        var data = this._data;
        var pos = this._positions;
        var len = data.length;
        while (true) {
            var left = 2 * idx + 1;
            var right = 2 * idx + 2;
            var smallest = idx;
            if (left < len && data[left].f < data[smallest].f) smallest = left;
            if (right < len && data[right].f < data[smallest].f) smallest = right;
            if (smallest !== idx) {
                var tmp = data[idx];
                data[idx] = data[smallest];
                data[smallest] = tmp;
                pos[data[idx].key] = idx;
                pos[data[smallest].key] = smallest;
                idx = smallest;
            } else {
                break;
            }
        }
    };

    /**
     * A* pathfinding from (startX, startY) world coords to the core.
     * Returns an array of {x, y} world-coordinate waypoints, or null if
     * no valid path is found.
     * targetBuildingId is optional — buildings on the path are blocked
     * unless they match this id.
     */
    /**
     * A* pathfinding from (startX, startY) world coords to the core (raw, no cache).
     */
    function _findPathRaw(startX, startY, targetBuildingId) {
        var corePos = _getCorePosition();
        var startGrid = _worldToGrid(startX, startY);
        var endGrid   = _worldToGrid(corePos.x, corePos.y);

        // If Map module isn't available, fall back to direct line
        if (typeof Map === 'undefined' || !Map.getTerrain) {
            return _directPath(startX, startY, corePos.x, corePos.y);
        }

        var gridCols = Math.floor(Config.MAP_WIDTH / Config.GRID_CELL_SIZE);

        // Node key helper
        function key(gx, gy) { return gx + gy * gridCols; }

        var openHeap = new _BinaryHeap();
        var closedSet = {};
        var startKey = key(startGrid.gx, startGrid.gy);

        _resetNodePool();
        var startNode = _getNode();
        startNode.gx = startGrid.gx; startNode.gy = startGrid.gy;
        startNode.g = 0;
        startNode.f = _manhattan(startGrid.gx, startGrid.gy, endGrid.gx, endGrid.gy);
        startNode.parent = null;
        startNode.key = startKey;
        openHeap.push(startNode);

        var maxIterations = 50000;
        var iterations = 0;

        // Directions: 4-directional movement
        var dirs = [
            { dx:  1, dy:  0 },
            { dx: -1, dy:  0 },
            { dx:  0, dy:  1 },
            { dx:  0, dy: -1 }
        ];

        while (openHeap.size() > 0) {
            iterations++;
            if (iterations > maxIterations) { break; }

            var current = openHeap.pop();
            closedSet[current.key] = true;

            // Reached the goal?
            if (current.gx === endGrid.gx && current.gy === endGrid.gy) {
                return _reconstructPath(current);
            }

            for (var d = 0; d < dirs.length; d++) {
                var nx = current.gx + dirs[d].dx;
                var ny = current.gy + dirs[d].dy;
                var nk = key(nx, ny);

                if (closedSet[nk]) { continue; }
                if (!_isWalkable(nx, ny, targetBuildingId, endGrid.gx, endGrid.gy)) { continue; }

                var tentativeG = current.g + 1;
                var existing = openHeap.get(nk);

                if (!existing) {
                    var newNode = _getNode();
                    newNode.gx = nx; newNode.gy = ny;
                    newNode.g = tentativeG;
                    newNode.f = tentativeG + _manhattan(nx, ny, endGrid.gx, endGrid.gy);
                    newNode.parent = current;
                    newNode.key = nk;
                    openHeap.push(newNode);
                } else if (tentativeG < existing.g) {
                    existing.g = tentativeG;
                    existing.f = tentativeG + _manhattan(nx, ny, endGrid.gx, endGrid.gy);
                    existing.parent = current;
                    openHeap.updateNode(existing);
                }
            }
        }

        // No valid path found — return null
        return null;
    }

    /**
     * Cache-aware wrapper around _findPathRaw.
     * Checks cache first; on miss, runs A* and stores result.
     */
    function _findPath(startX, startY, targetBuildingId) {
        // Skip cache when temp blocked cells are active (placement validation)
        var hasTempBlocks = false;
        for (var k in _tempBlockedCells) { hasTempBlocks = true; break; }
        if (hasTempBlocks) {
            return _findPathRaw(startX, startY, targetBuildingId);
        }
        var grid = _worldToGrid(startX, startY);
        var targetKey = targetBuildingId || 'core';
        var cached = _getCachedPath(grid.gx, grid.gy, targetKey);
        if (cached !== undefined) {
            return cached;
        }
        var result = _findPathRaw(startX, startY, targetBuildingId);
        _setCachedPath(grid.gx, grid.gy, targetKey, result);
        return result;
    }

    /**
     * A* pathfinding to an arbitrary world coordinate.
     * If canSwim is true, water tiles are walkable (but not deep_water).
     * If waterOnly is true, ONLY water tiles are walkable (for river serpents).
     * targetBuildingId is optional — buildings are blocked unless they match.
     */
    function _findPathTo(startX, startY, endX, endY, canSwim, waterOnly, targetBuildingId, ignoreWalls) {
        var startGrid = _worldToGrid(startX, startY);
        var endGrid   = _worldToGrid(endX, endY);

        if (typeof Map === 'undefined' || !Map.getTerrain) {
            return _directPath(startX, startY, endX, endY);
        }

        var gridCols = Math.floor(Config.MAP_WIDTH / Config.GRID_CELL_SIZE);
        function key(gx, gy) { return gx + gy * gridCols; }

        function isValid(gx, gy) {
            // Always allow the goal cell
            if (gx === endGrid.gx && gy === endGrid.gy) return true;
            var gridRows = Math.floor(Config.MAP_HEIGHT / Config.GRID_CELL_SIZE);
            if (gx < 0 || gy < 0 || gx >= gridCols || gy >= gridRows) return false;
            var terrain = Map.getTerrain(gx, gy);
            if (waterOnly) {
                if (terrain !== Config.TERRAIN_TYPES.water) return false;
            } else if (canSwim) {
                if (terrain === Config.TERRAIN_TYPES.deep_water) return false;
            } else {
                if (terrain === Config.TERRAIN_TYPES.water || terrain === Config.TERRAIN_TYPES.deep_water) return false;
            }
            // Block cells occupied by non-target buildings
            if (typeof Buildings !== 'undefined' && Buildings.getAt) {
                var bld = Buildings.getAt(gx, gy);
                if (bld && bld.hp > 0) {
                    if (bld.type === 'core') return true;
                    // Burrowers ignore walls
                    if (ignoreWalls && (bld.type === 'wall' || bld.type === 'electric_wall' || bld.type === 'steel_wall')) return true;
                    if (!targetBuildingId || bld.id !== targetBuildingId) {
                        return false;
                    }
                }
            }
            return true;
        }

        var openHeap = new _BinaryHeap();
        var closedSet = {};
        var startKey = key(startGrid.gx, startGrid.gy);

        _resetNodePool();
        var startNode = _getNode();
        startNode.gx = startGrid.gx; startNode.gy = startGrid.gy;
        startNode.g = 0;
        startNode.f = _manhattan(startGrid.gx, startGrid.gy, endGrid.gx, endGrid.gy);
        startNode.parent = null;
        startNode.key = startKey;
        openHeap.push(startNode);

        var maxIterations = 50000;
        var iterations = 0;
        var dirs = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];

        while (openHeap.size() > 0) {
            iterations++;
            if (iterations > maxIterations) break;

            var current = openHeap.pop();
            closedSet[current.key] = true;

            if (current.gx === endGrid.gx && current.gy === endGrid.gy) {
                return _reconstructPath(current);
            }
            for (var d = 0; d < dirs.length; d++) {
                var nx = current.gx + dirs[d].dx;
                var ny = current.gy + dirs[d].dy;
                var nk = key(nx, ny);
                if (closedSet[nk]) continue;
                if (!isValid(nx, ny)) continue;
                var tentativeG = current.g + 1;
                var existing = openHeap.get(nk);
                if (!existing) {
                    var newNode = _getNode();
                    newNode.gx = nx; newNode.gy = ny;
                    newNode.g = tentativeG;
                    newNode.f = tentativeG + _manhattan(nx, ny, endGrid.gx, endGrid.gy);
                    newNode.parent = current;
                    newNode.key = nk;
                    openHeap.push(newNode);
                } else if (tentativeG < existing.g) {
                    existing.g = tentativeG;
                    existing.f = tentativeG + _manhattan(nx, ny, endGrid.gx, endGrid.gy);
                    existing.parent = current;
                    openHeap.updateNode(existing);
                }
            }
        }
        // No valid path found — return null
        return null;
    }

    /**
     * Manhattan distance heuristic.
     */
    function _manhattan(ax, ay, bx, by) {
        return Math.abs(ax - bx) + Math.abs(ay - by);
    }

    /**
     * Reconstruct the grid path into world-coordinate waypoints.
     */
    function _reconstructPath(endNode) {
        var cells = [];
        var node = endNode;
        while (node) {
            cells.push(node);
            node = node.parent;
        }
        cells.reverse();

        var waypoints = [];
        for (var i = 0; i < cells.length; i++) {
            var wp = _gridToWorld(cells[i].gx, cells[i].gy);
            waypoints.push(wp);
        }
        return waypoints;
    }

    /**
     * Fallback: a straight-line path broken into intermediate waypoints.
     */
    function _directPath(sx, sy, ex, ey) {
        var steps = 10;
        var dx = (ex - sx) / steps;
        var dy = (ey - sy) / steps;
        var waypoints = [];
        for (var i = 1; i <= steps; i++) {
            waypoints.push({ x: sx + dx * i, y: sy + dy * i });
        }
        return waypoints;
    }

    // ---- Path Cache helpers ------------------------------------------------

    function _pathCacheKey(gx, gy, targetKey) {
        return gx + ',' + gy + ',' + (targetKey || 'core');
    }

    /**
     * Look up a cached path from grid cell (gx,gy) or nearby cells within
     * _pathCacheRadius. Returns the cached path array (cloned) or undefined.
     */
    function _getCachedPath(gx, gy, targetKey) {
        // Exact match first
        var exact = _pathCache[_pathCacheKey(gx, gy, targetKey)];
        if (exact !== undefined) {
            return exact ? exact.slice() : null;
        }
        // Search nearby cells
        for (var dx = -_pathCacheRadius; dx <= _pathCacheRadius; dx++) {
            for (var dy = -_pathCacheRadius; dy <= _pathCacheRadius; dy++) {
                if (dx === 0 && dy === 0) continue;
                var entry = _pathCache[_pathCacheKey(gx + dx, gy + dy, targetKey)];
                if (entry !== undefined) {
                    if (!entry) return null; // nearby cell had no valid path
                    // Prepend waypoints from our cell to the cached path's start
                    var myWorld = _gridToWorld(gx, gy);
                    var cloned = entry.slice();
                    cloned.unshift(myWorld);
                    return cloned;
                }
            }
        }
        return undefined; // cache miss
    }

    function _setCachedPath(gx, gy, targetKey, path) {
        _pathCache[_pathCacheKey(gx, gy, targetKey)] = path;
    }

    function _clearPathCache() {
        _pathCache = {};
    }

    /**
     * Process deferred pathfinding queue — runs via setTimeout to avoid
     * blocking the game tick. Processes one path at a time.
     */
    var _deferredProcessing = false;
    function _processDeferredPaths() {
        if (_deferredProcessing || _deferredPathQueue.length === 0) return;
        _deferredProcessing = true;
        setTimeout(function () {
            var maxPerBatch = 1;
            var processed = 0;
            while (_deferredPathQueue.length > 0 && processed < maxPerBatch) {
                var enemy = _deferredPathQueue.shift();
                if (enemy.hp <= 0) continue;
                // Flying enemies never need A*
                if (enemy.special === 'flying') continue;
                var targetKey = enemy.targetBuildingId || 'core';
                var burrows = enemy.special === 'burrows';
                var path;
                if (burrows) {
                    var corePos = _getCorePosition();
                    path = _findPathTo(enemy.x, enemy.y, corePos.x, corePos.y, false, false, enemy.targetBuildingId, true);
                } else {
                    path = _findPathRaw(enemy.x, enemy.y, enemy.targetBuildingId);
                }
                var grid = _worldToGrid(enemy.x, enemy.y);
                _setCachedPath(grid.gx, grid.gy, targetKey, path);
                if (path) {
                    enemy.path = path;
                    enemy.pathIndex = path.length > 1 ? 1 : 0;
                }
                processed++;
            }
            _deferredProcessing = false;
            // Schedule next batch if more remain
            if (_deferredPathQueue.length > 0) {
                _processDeferredPaths();
            }
        }, 0);
    }

    /**
     * Euclidean distance squared (avoids sqrt where possible).
     */
    function _distSq(x1, y1, x2, y2) {
        var dx = x2 - x1;
        var dy = y2 - y1;
        return dx * dx + dy * dy;
    }

    /**
     * Euclidean distance.
     */
    function _dist(x1, y1, x2, y2) {
        return Math.sqrt(_distSq(x1, y1, x2, y2));
    }

    /**
     * Find the nearest building of a given category for targeted enemies.
     */
    function _findTargetBuilding(enemy) {
        if (typeof Buildings === 'undefined' || !Buildings.getAll) return null;
        var buildings = Buildings.getAll();
        var cellSz = Config.GRID_CELL_SIZE;

        // Wall breakers: find walls that, if destroyed, would shorten path to core
        if (enemy.special === 'targets_walls') {
            return _findStrategicWall(enemy, buildings, cellSz);
        }

        // Nullifiers: break through 1-2 walls first, then target shield generators only
        if (enemy.special === 'targets_shields') {
            // Phase 1: still have walls to break — find a strategic wall
            if (enemy.wallsDestroyed < enemy.wallsToDestroyMax) {
                var wall = _findStrategicWall(enemy, buildings, cellSz);
                if (wall) return wall;
            }
            // Phase 2: target shield generators only
            var nearestShield = null;
            var nearestShieldDist = Infinity;
            for (var si = 0; si < buildings.length; si++) {
                var sb = buildings[si];
                if (sb.hp <= 0) continue;
                if (sb.type !== 'shield_generator') continue;
                var sbx = sb.worldX || (sb.gridX * cellSz + cellSz / 2);
                var sby = sb.worldY || (sb.gridY * cellSz + cellSz / 2);
                var sdx = sbx - enemy.x;
                var sdy = sby - enemy.y;
                var sdist = sdx * sdx + sdy * sdy;
                if (sdist < nearestShieldDist) {
                    nearestShieldDist = sdist;
                    nearestShield = { x: sbx, y: sby, buildingId: sb.id };
                }
            }
            return nearestShield;
        }

        var nearest = null;
        var nearestDist = Infinity;

        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            if (b.hp <= 0) continue;
            var def = Config.BUILDINGS[b.type];
            if (!def) continue;

            var matches = false;
            if (enemy.targetCategory === 'water_buildings') {
                // River serpents target buildings on water tiles (e.g. hydro plants)
                if (def.requiresTerrain === 'water') {
                    matches = true;
                }
            } else if (enemy.targetCategory === 'grid') {
                // Saboteurs target grid AND storage buildings
                if (def.category === 'grid' || def.category === 'storage') {
                    matches = true;
                }
            } else if (enemy.targetCategory && def.category === enemy.targetCategory) {
                matches = true;
            }

            if (!matches) continue;

            var bx = b.worldX || (b.gridX * cellSz + cellSz / 2);
            var by = b.worldY || (b.gridY * cellSz + cellSz / 2);
            var dx = bx - enemy.x;
            var dy = by - enemy.y;
            var dist = dx * dx + dy * dy;
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = { x: bx, y: by, buildingId: b.id };
            }
        }
        return nearest;
    }

    /**
     * Find strategic wall to target — prioritize walls that block shorter paths to core.
     * Scores walls by: distance to enemy's path to core, proximity to core.
     */
    function _findStrategicWall(enemy, buildings, cellSz) {
        var walls = [];
        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            if (b.hp <= 0) continue;
            if (b.type !== 'wall' && b.type !== 'electric_wall') continue;
            walls.push(b);
        }
        if (walls.length === 0) return null;

        var corePos = _getCorePosition();
        var best = null;
        var bestScore = Infinity;

        for (var i = 0; i < walls.length; i++) {
            var w = walls[i];
            var wx = w.worldX + cellSz / 2;
            var wy = w.worldY + cellSz / 2;

            // Score: distance from wall to line between enemy and core
            // Walls closer to the enemy-core axis and closer to core are better targets
            var dToEnemy = Math.sqrt((wx - enemy.x) * (wx - enemy.x) + (wy - enemy.y) * (wy - enemy.y));
            var dToCore = Math.sqrt((wx - corePos.x) * (wx - corePos.x) + (wy - corePos.y) * (wy - corePos.y));

            // Prefer walls closer to the core (removing them opens paths near core)
            // Also prefer walls not too far from the enemy
            var score = dToCore * 2 + dToEnemy;

            if (score < bestScore) {
                bestScore = score;
                best = { x: wx, y: wy, buildingId: w.id };
            }
        }
        return best;
    }

    /**
     * Enemy attacks a targeted building, then clears target to repath.
     * Non-boss, non-ranged enemies die after attacking (except vs walls).
     */
    function _enemyAttackBuilding(enemy) {
        if (typeof Buildings === 'undefined' || !Buildings.getAll) return;
        var buildings = Buildings.getAll();
        var attackedBuilding = null;
        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            if (b.id === enemy.targetBuildingId && b.hp > 0) {
                b.hp -= enemy.damage;
                if (b.hp <= 0) {
                    b.hp = 0;
                }
                attackedBuilding = b;
                break;
            }
        }
        enemy.targetBuildingId = null;
        enemy.repathTimer = 0;

        // Self-damage: non-boss, non-ranged, non-bombing enemies die after attacking
        // Exception: walls don't kill the attacker
        if (attackedBuilding && !enemy.isBoss && enemy.mechanic !== 'ranged_attack' && enemy.mechanic !== 'bombing') {
            var isWall = (attackedBuilding.type === 'wall' || attackedBuilding.type === 'electric_wall');
            if (!isWall) {
                // Kill enemy and give reward
                var def = Config.ENEMIES[enemy.type];
                if (def) {
                    var killReward = def.killReward || 0;
                    var difficulty = _getDifficulty();
                    killReward = Math.round(killReward * (difficulty.killRewardMult || 1));
                    if (typeof Economy !== 'undefined' && Economy.addMoney) {
                        Economy.addMoney(killReward, 'kill');
                    }
                }
                _totalKills++;
                _totalScore += (def && def.scoreValue) ? def.scoreValue : 1;
                for (var j = _enemies.length - 1; j >= 0; j--) {
                    if (_enemies[j].id === enemy.id) {
                        _enemies.splice(j, 1);
                        break;
                    }
                }
                return;
            }
            // For walls: enemy keeps attacking (re-target the wall)
            if (attackedBuilding.hp > 0) {
                enemy.targetBuildingId = attackedBuilding.id;
            } else {
                // Wall destroyed — track for nullifiers
                if (enemy.wallsToDestroyMax > 0 && enemy.wallsToDestroyMax !== Infinity) {
                    enemy.wallsDestroyed = (enemy.wallsDestroyed || 0) + 1;
                }
            }
        }
    }

    /**
     * Get spawn points from river tiles at map edges.
     */
    function _getRiverSpawnPoints() {
        if (typeof Map === 'undefined' || !Map.getRivers) return [];
        var rivers = Map.getRivers();
        if (!rivers || rivers.length === 0) return [];
        var cellSz = Config.GRID_CELL_SIZE;
        var gridW = Math.floor(Config.MAP_WIDTH / cellSz);
        var gridH = Math.floor(Config.MAP_HEIGHT / cellSz);
        var edgePoints = [];
        for (var i = 0; i < rivers.length; i++) {
            var r = rivers[i];
            if (r.gridX <= 1 || r.gridX >= gridW - 2 || r.gridY <= 1 || r.gridY >= gridH - 2) {
                edgePoints.push({ x: r.gridX * cellSz + cellSz / 2, y: r.gridY * cellSz + cellSz / 2 });
            }
        }
        return edgePoints;
    }

    // ---- Spawning ----------------------------------------------------------

    /**
     * Build the spawn queue for a wave and select spawn points.
     */
    function _buildSpawnQueue(waveDef, waveNumber) {
        var difficulty = _getDifficulty();
        var queue = [];

        var enemyGroups = waveDef.enemies;
        for (var g = 0; g < enemyGroups.length; g++) {
            var group = enemyGroups[g];
            var count = group.count;

            // For procedural waves (51+), scale counts
            if (waveNumber > 50) {
                var scaling = difficulty.scalingPerWave || 0.08;
                count = Math.ceil(count * (1 + (waveNumber - 50) * scaling));
            }

            // Decide formation for this group
            var formation = group.formation || null;
            if (!formation) {
                if (count <= 2) {
                    formation = 'line';
                } else {
                    // 40% line, 15% cluster, 15% v_shape, 15% wave_front, 15% surround
                    var rng = _getRng();
                    var roll = rng ? rng.random() : Math.random();
                    if (roll < 0.4) formation = 'line';
                    else if (roll < 0.55) formation = 'cluster';
                    else if (roll < 0.70) formation = 'v_shape';
                    else if (roll < 0.85) formation = 'wave_front';
                    else formation = 'surround';
                }
            }

            if (formation === 'line') {
                // Original behavior — one at a time
                for (var c = 0; c < count; c++) {
                    queue.push({
                        typeKey: group.type,
                        delay: waveDef.spawnDelay,
                        formation: 'line',
                        formationGroup: null
                    });
                }
            } else {
                // Group formation — spawn all at once
                var formationGroup = [];
                for (var c = 0; c < count; c++) {
                    formationGroup.push(group.type);
                }
                queue.push({
                    typeKey: group.type,
                    delay: waveDef.spawnDelay,
                    formation: formation,
                    formationGroup: formationGroup
                });
            }
        }

        return queue;
    }

    /**
     * Create an enemy instance from a typeKey, applying difficulty and wave scaling.
     */
    function _createEnemy(typeKey, spawnX, spawnY, waveNumber) {
        var def = Config.ENEMIES[typeKey];
        if (!def) { return null; }

        var difficulty = _getDifficulty();

        var baseHP    = def.hp    * (difficulty.enemyHPMult    || 1);
        var baseDmg   = def.damage * (difficulty.enemyDamageMult || 1);
        var baseSpd   = def.speed  * (difficulty.enemySpeedMult  || 1) * 0.85;
        var baseArmor = def.armor;

        // Extra scaling for waves 51+
        if (waveNumber > 50) {
            var scaling = difficulty.scalingPerWave || 0.08;
            var hpMult = 1 + (waveNumber - 50) * scaling;
            baseHP *= hpMult;
        }

        baseHP  = Math.round(baseHP);
        baseDmg = Math.round(baseDmg);

        var specialToCategory = {
            'targets_power': 'power',
            'targets_housing': 'housing',
            'targets_mining': 'mining',
            'targets_weapons': 'weapons',
            'targets_storage': 'storage',
            'targets_shields': 'defense',
            'targets_grid': 'grid',
            'targets_walls': 'walls'
        };

        var enemy = {
            id: _nextId++,
            type: typeKey,
            x: spawnX,
            y: spawnY,
            hp: baseHP,
            maxHp: baseHP,
            speed: baseSpd,
            damage: baseDmg,
            armor: baseArmor,
            path: null,
            pathIndex: 0,
            special: def.special || null,
            stunTimer: 0,
            slowFactor: 1.0,
            distanceTraveled: 0,
            canSwim: false,
            targetCategory: null,
            targetBuildingId: null,
            repathTimer: _nextId % 20,
            isBoss: false,
            mechanic: def.mechanic || null,
            wallsDestroyed: 0,
            wallsToDestroyMax: 0,
            jitterX: (Math.random() - 0.5) * 12,
            jitterY: (Math.random() - 0.5) * 12
        };

        if (def.special && specialToCategory[def.special]) {
            enemy.targetCategory = specialToCategory[def.special];
        }
        // Wall breakers destroy walls until none remain, then head to core
        if (def.special === 'targets_walls') {
            enemy.wallsToDestroyMax = Infinity;
        }
        // Nullifiers break through 1-2 walls on the way to shields
        if (def.special === 'targets_shields') {
            enemy.wallsToDestroyMax = 1 + Math.floor(Math.random() * 2); // 1-2
        }
        if (def.special === 'river_spawn') {
            enemy.canSwim = true;
            enemy.targetCategory = 'water_buildings'; // targets buildings on water tiles
        }
        if (def.isBoss) {
            enemy.isBoss = true;
        }

        // Ranged attack enemies
        if (def.mechanic === 'ranged_attack') {
            enemy.attackRange = def.attackRange || 300;
            enemy.attackCooldown = (def.attackCooldown || 4) * Config.TICKS_PER_SECOND;
            enemy.attackTimer = 0;
            enemy.rangedType = def.rangedType || 'zapper';
            enemy.rangedTargetId = null;
            enemy.isAttacking = false;
            enemy.energyAbsorbed = 0;
            enemy.charged = false;
            if (def.energyDrain) enemy.energyDrain = def.energyDrain;
            if (def.energyThreshold) enemy.energyThreshold = def.energyThreshold;
            if (def.chargedSpeed) enemy.chargedSpeed = def.chargedSpeed * (difficulty.enemySpeedMult || 1) * 0.85;
            if (def.chargedDamage) enemy.chargedDamage = Math.round(def.chargedDamage * (difficulty.enemyDamageMult || 1));
            if (def.empDuration) enemy.empDuration = def.empDuration;
        }

        // Bombing mechanic (flying bomber)
        if (def.mechanic === 'bombing') {
            enemy.bombDamage = Math.round((def.bombDamage || 20) * (difficulty.enemyDamageMult || 1));
            enemy.bombCoreDamage = Math.round((def.bombCoreDamage || 5) * (difficulty.enemyDamageMult || 1));
            enemy.bombCooldown = (def.attackCooldown || 10) * Config.TICKS_PER_SECOND;
            enemy.bombTimer = 0;
            enemy.bombingTargetId = null;
            enemy.isBombing = false;
            enemy.hoveringCore = false;
        }

        // Reflector mechanic (mirror sentinel)
        if (def.mechanic === 'reflects') {
            enemy.reflectDPS = def.reflectDPS || 1;
            enemy.isReflecting = false;
        }

        // Spawner mechanic (swarm mother)
        if (def.mechanic === 'spawner') {
            enemy.spawnType = def.spawnType || 'swarm';
            enemy.spawnCount = def.spawnCount || 3;
            enemy.spawnCooldown = (def.spawnCooldown || 5) * Config.TICKS_PER_SECOND;
            enemy.spawnTimer = enemy.spawnCooldown;
            enemy.spawnDoubleThreshold = def.spawnDoubleThreshold || 0.5;
            enemy.spawnedIds = [];
        }

        // Jumper mechanic (quake titan)
        if (def.mechanic === 'jumper') {
            enemy.jumpDistance = def.jumpDistance || 50;
            enemy.jumpCooldown = (def.jumpCooldown || 3) * Config.TICKS_PER_SECOND;
            enemy.jumpTimer = enemy.jumpCooldown;
            enemy.jumpAOERadius = def.jumpAOERadius || 300;
            enemy.jumpAOEDamage = Math.round((def.jumpAOEDamage || 10) * (difficulty.enemyDamageMult || 1));
            enemy.jumpCoreDamage = Math.round((def.jumpCoreDamage || 5) * (difficulty.enemyDamageMult || 1));
            enemy.isJumping = false;
            enemy.jumpAnimTimer = 0;
        }

        // Nexus mechanic (final boss)
        if (def.mechanic === 'nexus') {
            enemy.spawnCooldown = (def.spawnCooldown || 5) * Config.TICKS_PER_SECOND;
            enemy.spawnTimer = enemy.spawnCooldown;
            enemy.spawnCount = def.spawnCount || 5;
            enemy.nexusLaserRange = def.nexusLaserRange || 500;
            enemy.nexusLaserDPS = def.nexusLaserDPS || 2;
            enemy.nexusShieldDPS = def.nexusShieldDPS || 20;
            enemy.nexusDamagePerSpawnKill = def.nexusDamagePerSpawnKill || 10;
            enemy.spawnedIds = [];
            enemy.nexusLaserTargets = [];
        }

        // Energy drain mechanic (overload boss)
        if (def.mechanic === 'energy_drain') {
            enemy.drainRange = def.drainRange || 300;
            enemy.drainRate = def.drainRate || 10;
            enemy.drainThreshold = def.drainThreshold || 500;
            enemy.drainZapDuration = (def.drainZapDuration || 2) * Config.TICKS_PER_SECOND;
            enemy.drainZapDPS = Math.round((def.drainZapDPS || 25) * (difficulty.enemyDamageMult || 1));
            enemy.drainCooldown = (def.drainCooldown || 15) * Config.TICKS_PER_SECOND;
            enemy.drainAbsorbed = 0;
            enemy.drainState = 'idle'; // idle | draining | zapping | cooldown
            enemy.drainTimer = 0;
            enemy.drainTargets = [];
            enemy.drainZapTarget = null;
        }

        // Flying enemies always use direct path (straight line to core)
        if (def.special === 'flying') {
            enemy.path = _directPath(spawnX, spawnY, _getCorePosition().x, _getCorePosition().y);
            return enemy;
        }

        // Compute initial path — use cache, defer A* on miss
        // Burrowers skip cache since their paths differ (ignore walls)
        var grid = _worldToGrid(spawnX, spawnY);
        var targetKey = enemy.targetBuildingId || 'core';
        var cached = (def.special !== 'burrows') ? _getCachedPath(grid.gx, grid.gy, targetKey) : undefined;
        if (cached !== undefined) {
            enemy.path = cached || _directPath(spawnX, spawnY, _getCorePosition().x, _getCorePosition().y);
        } else {
            // Use direct path immediately, queue real A* for next tick
            enemy.path = _directPath(spawnX, spawnY, _getCorePosition().x, _getCorePosition().y);
            _deferredPathQueue.push(enemy);
        }

        return enemy;
    }

    /**
     * Generate a procedural wave definition for wave numbers > 50.
     */
    function _generateProceduralWave(waveNumber) {
        var difficulty = _getDifficulty();
        var allTypes = Object.keys(Config.ENEMIES);
        var available = [];

        for (var i = 0; i < allTypes.length; i++) {
            var eDef = Config.ENEMIES[allTypes[i]];
            if (eDef.firstWave <= waveNumber && !eDef.isBoss) {
                available.push(allTypes[i]);
            }
        }

        var enemies = [];
        var wavePower = 100 + (waveNumber - 20) * 25;

        // Seed a simple RNG from wave number for deterministic but varied composition
        var seed = waveNumber * 7919 + 1301;
        function simpleRng() {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return (seed >> 16) / 32768.0;
        }

        // Pick 3-6 random enemy types from available pool
        var typeCount = Math.min(available.length, 3 + Math.floor(simpleRng() * 4));
        var selectedTypes = [];
        var pool = available.slice();
        for (var t = 0; t < typeCount && pool.length > 0; t++) {
            var idx = Math.floor(simpleRng() * pool.length);
            selectedTypes.push(pool[idx]);
            pool.splice(idx, 1);
        }

        // Distribute power budget across selected types
        for (var j = 0; j < selectedTypes.length; j++) {
            var eDef2 = Config.ENEMIES[selectedTypes[j]];
            var enemyPower = eDef2.hp + eDef2.damage * 5 + eDef2.armor * 10;
            if (enemyPower < 1) enemyPower = 1;
            var share = wavePower / selectedTypes.length;
            var count = Math.max(1, Math.round(share / enemyPower));
            if (eDef2.hp <= 20) count = Math.min(count, 40 + waveNumber);
            enemies.push({ type: selectedTypes[j], count: count });
        }

        // Boss waves at 40, 60, 80, 100, ...
        if (waveNumber >= 40 && waveNumber % 20 === 0) {
            var bossHP = 3000 + (waveNumber - 20) * 200;
            var bossDmg = 80 + Math.floor(waveNumber * 1.5);
            var bossArmor = 15 + Math.floor(waveNumber * 0.3);
            var bossSpeed = Math.max(10, 25 - Math.floor(waveNumber * 0.05));
            var bossReward = 1000 + waveNumber * 50;

            var bossSpecials = ['targets_power', 'targets_housing', 'targets_weapons', 'targets_shields', null];
            var bossSpecial = bossSpecials[Math.floor(simpleRng() * bossSpecials.length)];

            var mechanics = ['ranged_attack', 'teleport', 'laser_resist', 'missile_resist', null];
            var mechanic = mechanics[Math.floor(simpleRng() * mechanics.length)];

            var bossKey = 'proc_boss_w' + waveNumber;
            Config.ENEMIES[bossKey] = {
                name: 'Titan Mk.' + Math.floor(waveNumber / 20),
                hp: bossHP,
                speed: bossSpeed,
                damage: bossDmg,
                armor: bossArmor,
                killReward: bossReward,
                icon: '👑',
                special: bossSpecial,
                firstWave: waveNumber,
                isBoss: true,
                mechanic: mechanic
            };
            enemies.push({ type: bossKey, count: 1 });
        }

        // Every 2 waves past 20, generate a new procedural enemy variant
        if (waveNumber > 20 && waveNumber % 2 === 0) {
            var procKey = 'proc_v' + waveNumber;
            if (!Config.ENEMIES[procKey]) {
                var procHP = 50 + waveNumber * 8 + Math.floor(simpleRng() * waveNumber * 5);
                var procSpeed = 30 + Math.floor(simpleRng() * 100);
                var procDmg = 5 + Math.floor(waveNumber * 0.8 + simpleRng() * 15);
                var procArmor = Math.floor(simpleRng() * (waveNumber * 0.3));
                var procReward = Math.floor(procHP * 0.3 + procDmg * 2);

                var procSpecials = [null, 'targets_power', 'targets_housing', 'targets_mining',
                                   'targets_weapons', 'targets_storage', 'targets_shields',
                                   'emp_disable', 'ignores_shields', 'river_spawn',
                                   'flying', 'burrows'];
                var procSpecial = procSpecials[Math.floor(simpleRng() * procSpecials.length)];

                var procMechanics = [null, null, null, 'ranged_attack', 'teleport', 'laser_resist', 'missile_resist'];
                var procMechanic = procMechanics[Math.floor(simpleRng() * procMechanics.length)];

                var procIcons = ['🔥', '❄️', '⚡', '🌀', '💀', '🦾', '🎯', '🌊', '🕸️', '🧬'];
                var procIcon = procIcons[Math.floor(simpleRng() * procIcons.length)];

                var nameAdj = ['Swift', 'Heavy', 'Toxic', 'Shadow', 'Plasma', 'Volt', 'Iron', 'Chaos', 'Stealth', 'Mega'];
                var nameNoun = ['Drone', 'Crawler', 'Striker', 'Golem', 'Phantom', 'Sentinel', 'Ravager', 'Stalker', 'Breaker', 'Charger'];
                var procName = nameAdj[Math.floor(simpleRng() * nameAdj.length)] + ' ' + nameNoun[Math.floor(simpleRng() * nameNoun.length)];

                Config.ENEMIES[procKey] = {
                    name: procName,
                    hp: procHP,
                    speed: procSpeed,
                    damage: procDmg,
                    armor: procArmor,
                    killReward: procReward,
                    icon: procIcon,
                    special: procSpecial,
                    firstWave: waveNumber,
                    isBoss: false,
                    mechanic: procMechanic
                };
            }
            enemies.push({ type: procKey, count: Math.max(2, Math.floor(simpleRng() * 6)) });
        }

        var spawnDelay = Math.max(30, 300 - waveNumber * 4);
        var spawnPointCount = Math.min(4, 1 + Math.floor(waveNumber / 10));

        return {
            number: waveNumber,
            enemies: enemies,
            spawnDelay: spawnDelay,
            spawnPoints: spawnPointCount
        };
    }

    // ---- Ranged Attack -------------------------------------------------------

    /**
     * Find the nearest building in range for a ranged enemy.
     * Zapper: any building. Plasma Parasite: storage/weapons. EMP Sniper: storage/defense/power.
     */
    function _findRangedTarget(enemy) {
        if (typeof Buildings === 'undefined' || !Buildings.getAll) return null;
        var buildings = Buildings.getAll();
        var cellSz = Config.GRID_CELL_SIZE;
        var rangeSq = enemy.attackRange * enemy.attackRange;
        var best = null;
        var bestDist = Infinity;

        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            if (b.hp <= 0) continue;
            var def = Config.BUILDINGS[b.type];
            if (!def) continue;

            // Filter by ranged type
            if (enemy.rangedType === 'plasma_parasite') {
                if (def.category !== 'storage' && def.category !== 'weapons') continue;
            } else if (enemy.rangedType === 'emp_sniper') {
                if (def.category !== 'storage' && def.category !== 'defense' && def.category !== 'power') continue;
            }
            // Zapper: any building

            var bx = b.worldX || (b.gridX * cellSz + cellSz / 2);
            var by = b.worldY || (b.gridY * cellSz + cellSz / 2);
            var dx = bx - enemy.x;
            var dy = by - enemy.y;
            var distSq = dx * dx + dy * dy;

            if (distSq <= rangeSq && distSq < bestDist) {
                bestDist = distSq;
                best = b;
            }
        }
        return best;
    }

    /**
     * Handle ranged attack for one tick. Returns true if enemy is attacking (should not move).
     */
    function _handleRangedAttack(enemy) {
        // Tick down cooldown
        if (enemy.attackTimer > 0) {
            enemy.attackTimer--;
        }

        // Find target in range
        var target = null;
        if (enemy.rangedTargetId) {
            // Check if current target still valid
            var buildings = (typeof Buildings !== 'undefined' && Buildings.getAll) ? Buildings.getAll() : [];
            for (var i = 0; i < buildings.length; i++) {
                if (buildings[i].id === enemy.rangedTargetId && buildings[i].hp > 0) {
                    var cellSz = Config.GRID_CELL_SIZE;
                    var bx = buildings[i].worldX || (buildings[i].gridX * cellSz + cellSz / 2);
                    var by = buildings[i].worldY || (buildings[i].gridY * cellSz + cellSz / 2);
                    var dx = bx - enemy.x;
                    var dy = by - enemy.y;
                    if (dx * dx + dy * dy <= enemy.attackRange * enemy.attackRange) {
                        target = buildings[i];
                    }
                    break;
                }
            }
        }
        if (!target) {
            target = _findRangedTarget(enemy);
            enemy.rangedTargetId = target ? target.id : null;
        }

        if (!target) {
            enemy.isAttacking = false;
            return false; // no target in range, keep moving
        }

        enemy.isAttacking = true;
        var cellSz2 = Config.GRID_CELL_SIZE;
        var tx = target.worldX || (target.gridX * cellSz2 + cellSz2 / 2);
        var ty = target.worldY || (target.gridY * cellSz2 + cellSz2 / 2);

        // Attack if cooldown ready
        if (enemy.attackTimer <= 0) {
            enemy.attackTimer = enemy.attackCooldown;

            if (enemy.rangedType === 'zapper') {
                // Direct damage
                target.hp -= enemy.damage;
                if (target.hp < 0) target.hp = 0;
                // Visual: laser beam
                _rangedEffects.push({
                    type: 'zapper_beam',
                    fromX: enemy.x, fromY: enemy.y,
                    toX: tx, toY: ty,
                    timer: 8, maxTimer: 8
                });
            } else if (enemy.rangedType === 'plasma_parasite') {
                // Drain energy
                var drain = enemy.energyDrain || 10;
                var available = target.energy || 0;
                var drained = Math.min(drain, available);
                target.energy -= drained;
                enemy.energyAbsorbed = (enemy.energyAbsorbed || 0) + drained;
                // Visual: energy absorption
                _rangedEffects.push({
                    type: 'plasma_drain',
                    fromX: tx, fromY: ty,
                    toX: enemy.x, toY: enemy.y,
                    timer: 8, maxTimer: 8,
                    amount: drained
                });
                // Check if charged
                if (enemy.energyAbsorbed >= (enemy.energyThreshold || 1000)) {
                    enemy.charged = true;
                    enemy.speed = enemy.chargedSpeed || 280;
                    enemy.damage = enemy.chargedDamage || 10;
                    enemy.isAttacking = false;
                    enemy.rangedTargetId = null;
                    // Path to core
                    enemy.targetBuildingId = null;
                    enemy.targetCategory = null;
                    enemy.repathTimer = 0;
                    _rangedEffects.push({
                        type: 'plasma_charge',
                        fromX: enemy.x, fromY: enemy.y,
                        toX: enemy.x, toY: enemy.y,
                        timer: 20, maxTimer: 20
                    });
                    return false; // start moving to core
                }
            } else if (enemy.rangedType === 'emp_sniper') {
                // Damage + EMP disable
                target.hp -= enemy.damage;
                if (target.hp < 0) target.hp = 0;
                target.active = false;
                target.empDisabled = true;
                target.empTimer = enemy.empDuration || 50;
                // Visual: EMP missile
                _rangedEffects.push({
                    type: 'emp_missile',
                    fromX: enemy.x, fromY: enemy.y,
                    toX: tx, toY: ty,
                    timer: 15, maxTimer: 15
                });
            }
        } else {
            // Plasma parasites show continuous drain visual while in range
            if (enemy.rangedType === 'plasma_parasite' && enemy.attackTimer < enemy.attackCooldown - 2) {
                // Show faint drain beam while waiting
                _rangedEffects.push({
                    type: 'plasma_drain_idle',
                    fromX: tx, fromY: ty,
                    toX: enemy.x, toY: enemy.y,
                    timer: 1, maxTimer: 1
                });
            }
        }

        return true; // attacking, don't move
    }

    /**
     * Handle flying bomber bombing for one tick.
     * Returns true if the bomber is hovering (should not move).
     */
    function _handleBombing(enemy) {
        if (enemy.bombTimer > 0) {
            enemy.bombTimer--;
        }

        // If hovering over core
        if (enemy.hoveringCore) {
            if (enemy.bombTimer <= 0) {
                enemy.bombTimer = enemy.bombCooldown;
                if (typeof Engine !== 'undefined' && Engine.damageCoreHP) {
                    Engine.damageCoreHP(enemy.bombCoreDamage);
                }
                _rangedEffects.push({
                    type: 'bomb_drop',
                    fromX: enemy.x, fromY: enemy.y,
                    toX: enemy.x, toY: enemy.y + 20,
                    timer: 15, maxTimer: 15,
                    isCore: true
                });
            }
            return true;
        }

        // Check if over a building
        if (typeof Buildings === 'undefined' || !Buildings.getAll) return false;
        var buildings = Buildings.getAll();
        var cellSz = Config.GRID_CELL_SIZE;
        var overlapDist = cellSz * 0.8;
        var bestBuilding = null;
        var bestDistSq = overlapDist * overlapDist;

        // If we have a current bombing target, check if it's still alive
        if (enemy.bombingTargetId) {
            for (var i = 0; i < buildings.length; i++) {
                if (buildings[i].id === enemy.bombingTargetId && buildings[i].hp > 0) {
                    bestBuilding = buildings[i];
                    break;
                }
            }
            if (!bestBuilding) {
                // Target destroyed, resume movement
                enemy.bombingTargetId = null;
                enemy.isBombing = false;
                enemy.bombTimer = 0;
                return false;
            }
        } else {
            // Look for a building we're currently over
            for (var j = 0; j < buildings.length; j++) {
                var b = buildings[j];
                if (b.hp <= 0) continue;
                var bx = b.worldX || (b.gridX * cellSz + cellSz / 2);
                var by = b.worldY || (b.gridY * cellSz + cellSz / 2);
                var ddx = bx - enemy.x;
                var ddy = by - enemy.y;
                var dsq = ddx * ddx + ddy * ddy;
                if (dsq < bestDistSq) {
                    bestDistSq = dsq;
                    bestBuilding = b;
                }
            }
        }

        if (!bestBuilding) {
            enemy.isBombing = false;
            enemy.bombingTargetId = null;
            return false;
        }

        // We're over a building — stop and bomb it
        enemy.isBombing = true;
        enemy.bombingTargetId = bestBuilding.id;

        if (enemy.bombTimer <= 0) {
            enemy.bombTimer = enemy.bombCooldown;
            bestBuilding.hp -= enemy.bombDamage;
            if (bestBuilding.hp <= 0) {
                bestBuilding.hp = 0;
                enemy.bombingTargetId = null;
                enemy.isBombing = false;
            }
            var btx = bestBuilding.worldX || (bestBuilding.gridX * cellSz + cellSz / 2);
            var bty = bestBuilding.worldY || (bestBuilding.gridY * cellSz + cellSz / 2);
            _rangedEffects.push({
                type: 'bomb_drop',
                fromX: enemy.x, fromY: enemy.y,
                toX: btx, toY: bty,
                timer: 15, maxTimer: 15,
                isCore: false
            });
        }

        return true; // hovering, don't move
    }

    // ---- Movement ----------------------------------------------------------

    /**
     * Move a single enemy along its path for one tick.
     */
    function _moveEnemy(enemy) {
        if (enemy.stunTimer > 0) {
            enemy.stunTimer--;
            return;
        }

        // Blocked by shield this tick — reset flag and skip movement
        if (enemy.blocked) {
            enemy.blocked = false;
            return;
        }

        // Ranged attack behavior: stop and attack from distance
        if (enemy.mechanic === 'ranged_attack' && !enemy.charged) {
            if (_handleRangedAttack(enemy)) {
                return; // enemy is attacking from range, don't move
            }
        }

        // Overload boss: stop while draining or zapping
        if (enemy.mechanic === 'energy_drain' && (enemy.drainState === 'draining' || enemy.drainState === 'zapping')) {
            return;
        }

        // Flying bomber: check for buildings below and bomb them
        if (enemy.mechanic === 'bombing') {
            if (_handleBombing(enemy)) {
                return; // hovering and bombing, don't move
            }
        }

        // Jumper mechanic: don't use normal movement, handled in _handleJumperMechanics
        if (enemy.mechanic === 'jumper') {
            return;
        }

        // Periodic repath for ALL enemies
        if (enemy.repathTimer == null) enemy.repathTimer = 0;
        enemy.repathTimer--;

        if (enemy.repathTimer <= 0) {
            enemy.repathTimer = 20; // repath every 2 seconds

            // Flying enemies always use direct path — no A* needed
            if (enemy.special === 'flying') {
                var flyCore = _getCorePosition();
                enemy.path = _directPath(enemy.x, enemy.y, flyCore.x, flyCore.y);
                enemy.pathIndex = 0;
            } else if (_pathBudgetThisTick >= _maxPathfindsPerTick) {
                enemy.repathTimer = 1; // retry next tick
            } else {
                _pathBudgetThisTick++;

                // Targeted pathing: try to find specific target building
                if (enemy.targetCategory || enemy.targetBuildingId) {
                    // Stick with current target if it's still alive
                    var currentTarget = null;
                    if (enemy.targetBuildingId && typeof Buildings !== 'undefined' && Buildings.getAll) {
                        var allBlds = Buildings.getAll();
                        for (var bi = 0; bi < allBlds.length; bi++) {
                            if (allBlds[bi].id === enemy.targetBuildingId && allBlds[bi].hp > 0) {
                                var cellSzT = Config.GRID_CELL_SIZE;
                                currentTarget = {
                                    x: allBlds[bi].worldX || (allBlds[bi].gridX * cellSzT + cellSzT / 2),
                                    y: allBlds[bi].worldY || (allBlds[bi].gridY * cellSzT + cellSzT / 2),
                                    buildingId: allBlds[bi].id
                                };
                                break;
                            }
                        }
                    }
                    var targetPos = currentTarget || _findTargetBuilding(enemy);
                    if (targetPos) {
                        var useWaterOnly = false;
                        if (enemy.special === 'river_spawn' && enemy.targetCategory === 'water_buildings') {
                            useWaterOnly = true;
                        }
                        var burrows = enemy.special === 'burrows';
                        var newPath = _findPathTo(enemy.x, enemy.y, targetPos.x, targetPos.y, enemy.canSwim || false, useWaterOnly, targetPos.buildingId, burrows);
                        if (newPath) {
                            enemy.path = newPath;
                            enemy.pathIndex = newPath.length > 1 ? 1 : 0;
                            enemy.targetBuildingId = targetPos.buildingId;
                        } else {
                            enemy.targetBuildingId = null;
                        }
                    } else {
                        enemy.targetBuildingId = null;
                        if (enemy.special === 'river_spawn') {
                            enemy.canSwim = true;
                        }
                    }
                }

                // Core pathing: if no target or target unreachable, path to core
                if (!enemy.targetBuildingId) {
                    var corePos = _getCorePosition();
                    var coreBurrows = enemy.special === 'burrows';
                    var corePath = _findPathTo(enemy.x, enemy.y, corePos.x, corePos.y, enemy.canSwim || false, false, null, coreBurrows);
                    if (corePath) {
                        enemy.path = corePath;
                        enemy.pathIndex = corePath.length > 1 ? 1 : 0;
                    } else {
                        enemy.path = _directPath(enemy.x, enemy.y, corePos.x, corePos.y);
                        enemy.pathIndex = 0;
                    }
                }
            }
        }

        if (!enemy.path || enemy.pathIndex >= enemy.path.length) {
            if (enemy.targetBuildingId) {
                _enemyAttackBuilding(enemy);
                return;
            }
            // Only count as reaching core if actually near it (within 2 grid cells)
            var coreCheck = _getCorePosition();
            var cdx = enemy.x - coreCheck.x;
            var cdy = enemy.y - coreCheck.y;
            var coreDist = cdx * cdx + cdy * cdy;
            var threshold = Config.GRID_CELL_SIZE * 2;
            if (coreDist <= threshold * threshold) {
                _enemyReachedCore(enemy);
                return;
            }
            // Not near core — force re-path next tick
            enemy.repathTimer = 0;
            return;
        }

        var speedMult = 1;
        if (typeof Engine !== 'undefined' && Engine.getEnemySpeedMultiplier) {
            speedMult = Engine.getEnemySpeedMultiplier();
        }

        var effectiveSpeed = enemy.speed * enemy.slowFactor * speedMult;

        // Speed matching: faster enemies slow down to match nearby slower enemies,
        // unless within 1000px of a player building (then full speed)
        if (!enemy.isBoss) {
            var nearBuilding = false;
            if (typeof Buildings !== 'undefined' && Buildings.getAll) {
                var allBlds = Buildings.getAll();
                for (var nb = 0; nb < allBlds.length; nb++) {
                    var bdx = allBlds[nb].worldX - enemy.x;
                    var bdy = allBlds[nb].worldY - enemy.y;
                    if (bdx * bdx + bdy * bdy <= 1000000) { // 1000^2
                        nearBuilding = true;
                        break;
                    }
                }
            }
            if (!nearBuilding) {
                var nearby = _getNearbyEnemies(enemy.x, enemy.y, 500);
                var slowest = effectiveSpeed;
                for (var sn = 0; sn < nearby.length; sn++) {
                    var ne = nearby[sn];
                    if (ne.id === enemy.id || ne.hp <= 0) continue;
                    var neSpeed = ne.speed * (ne.slowFactor || 1) * speedMult;
                    if (neSpeed < slowest) slowest = neSpeed;
                }
                if (slowest < effectiveSpeed) effectiveSpeed = slowest;
            }
        }

        var movePerTick = effectiveSpeed / Config.TICKS_PER_SECOND;

        var target = enemy.path[enemy.pathIndex];
        var dx = target.x - enemy.x;
        var dy = target.y - enemy.y;
        var distSqToWaypoint = dx * dx + dy * dy;
        var distToWaypoint = Math.sqrt(distSqToWaypoint);

        if (distToWaypoint <= 5) {
            enemy.pathIndex++;
            if (enemy.pathIndex >= enemy.path.length) {
                if (enemy.targetBuildingId) {
                    _enemyAttackBuilding(enemy);
                    return;
                }
                _enemyReachedCore(enemy);
                return;
            }
            target = enemy.path[enemy.pathIndex];
            dx = target.x - enemy.x;
            dy = target.y - enemy.y;
            distSqToWaypoint = dx * dx + dy * dy;
            distToWaypoint = Math.sqrt(distSqToWaypoint);
        }

        if (distToWaypoint > 0) {
            var moveAmount = Math.min(movePerTick, distToWaypoint);
            var nx = dx / distToWaypoint;
            var ny = dy / distToWaypoint;
            enemy.x += nx * moveAmount;
            enemy.y += ny * moveAmount;
            enemy.distanceTraveled += moveAmount;
        }
    }

    /**
     * Handle an enemy reaching the core.
     */
    function _enemyReachedCore(enemy) {
        // Flying bombers hover over the core and bomb it repeatedly
        if (enemy.mechanic === 'bombing') {
            enemy.hoveringCore = true;
            enemy.isBombing = true;
            enemy.bombTimer = 0; // bomb immediately on arrival
            return;
        }

        if (typeof Engine !== 'undefined' && Engine.damageCoreHP) {
            Engine.damageCoreHP(enemy.damage * 0.75);
        }
        _totalEscaped++;

        // Remove from active list
        for (var i = _enemies.length - 1; i >= 0; i--) {
            if (_enemies[i].id === enemy.id) {
                _enemies.splice(i, 1);
                break;
            }
        }
    }

    // ---- Formation Spawning ------------------------------------------------

    /**
     * Calculate position offsets for a formation type.
     */
    function _getFormationOffsets(formation, count) {
        var offsets = [];
        var rng = _getRng();

        switch (formation) {
            case 'cluster':
                for (var i = 0; i < count; i++) {
                    var angle = (rng ? rng.random() : Math.random()) * Math.PI * 2;
                    var dist = (rng ? rng.random() : Math.random()) * 60;
                    offsets.push({ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist });
                }
                break;

            case 'v_shape':
                for (var i = 0; i < count; i++) {
                    var side = (i % 2 === 0) ? 1 : -1;
                    var row = Math.ceil(i / 2);
                    offsets.push({ x: -row * 40, y: side * row * 30 });
                }
                offsets[0] = { x: 0, y: 0 };
                break;

            case 'wave_front':
                var spacing = 40;
                var startY = -((count - 1) * spacing) / 2;
                for (var i = 0; i < count; i++) {
                    offsets.push({ x: 0, y: startY + i * spacing });
                }
                break;

            default:
                for (var i = 0; i < count; i++) {
                    offsets.push({ x: 0, y: 0 });
                }
        }

        return offsets;
    }

    /**
     * Spawn all enemies in a formation group at calculated offsets.
     */
    function _spawnFormationGroup(entry) {
        var formation = entry.formation;
        var types = entry.formationGroup;
        var count = types.length;

        var spawnPts = _spawnPoints.length > 0
            ? _spawnPoints
            : [{ x: 0, y: Config.MAP_HEIGHT / 2 }];

        var rng = _getRng();

        if (formation === 'surround') {
            // Spawn at different spawn points
            for (var i = 0; i < count; i++) {
                var ptIdx = i % spawnPts.length;
                var sp = spawnPts[ptIdx];
                var enemy = _createEnemy(types[i], sp.x, sp.y, _currentWave);
                if (enemy) {
                    var path = _findPath(sp.x, sp.y, enemy.targetBuildingId);
                    if (path) {
                        enemy.path = path;
                        enemy.pathIndex = 0;
                    }
                    _enemies.push(enemy);
                }
            }
            return;
        }

        // For other formations, pick one spawn point
        var ptIndex = rng && typeof rng.randomInt === 'function'
            ? rng.randomInt(0, spawnPts.length - 1)
            : Math.floor(Math.random() * spawnPts.length);
        var baseSP = spawnPts[ptIndex];

        var offsets = _getFormationOffsets(formation, count);

        for (var i = 0; i < count; i++) {
            var ox = offsets[i].x;
            var oy = offsets[i].y;
            var sx = baseSP.x + ox;
            var sy = baseSP.y + oy;

            // Clamp to map bounds
            sx = Math.max(0, Math.min(Config.MAP_WIDTH, sx));
            sy = Math.max(0, Math.min(Config.MAP_HEIGHT, sy));

            var enemy = _createEnemy(types[i], sx, sy, _currentWave);
            if (enemy) {
                var path = _findPath(sx, sy, enemy.targetBuildingId);
                if (path) {
                    enemy.path = path;
                    enemy.pathIndex = 0;
                }
                _enemies.push(enemy);
            }
        }
    }

    // ---- Boss Spawn Mechanics (Swarm Mother, Nexus) -----------------------

    function _handleBossSpawnMechanics() {
        for (var i = 0; i < _enemies.length; i++) {
            var enemy = _enemies[i];
            if (enemy.mechanic !== 'spawner' && enemy.mechanic !== 'nexus') continue;
            if (enemy.hp <= 0) continue;

            enemy.spawnTimer--;
            if (enemy.spawnTimer > 0) continue;

            // Determine cooldown (swarm mother doubles below threshold)
            var cooldown = enemy.spawnCooldown;
            if (enemy.mechanic === 'spawner' && enemy.hp < enemy.maxHp * enemy.spawnDoubleThreshold) {
                cooldown = Math.max(1, Math.floor(cooldown / 2));
            }
            enemy.spawnTimer = cooldown;

            // Determine what to spawn
            var spawnType;
            var count = enemy.spawnCount;

            if (enemy.mechanic === 'spawner') {
                spawnType = enemy.spawnType;
            } else {
                // Nexus: spawn random non-boss enemies
                spawnType = null;
            }

            for (var s = 0; s < count; s++) {
                var typeKey;
                if (spawnType) {
                    typeKey = spawnType;
                } else {
                    // Pick random non-boss enemy type
                    var nonBossTypes = [];
                    var keys = Object.keys(Config.ENEMIES);
                    for (var k = 0; k < keys.length; k++) {
                        if (!Config.ENEMIES[keys[k]].isBoss && keys[k] !== 'the_nexus' && keys[k] !== 'swarm_mother' && keys[k] !== 'quake_titan') {
                            nonBossTypes.push(keys[k]);
                        }
                    }
                    var rng = _getRng();
                    var ri = rng && typeof rng.randomInt === 'function'
                        ? rng.randomInt(0, nonBossTypes.length - 1)
                        : Math.floor(Math.random() * nonBossTypes.length);
                    typeKey = nonBossTypes[ri];
                }

                // Spawn near the boss
                var angle = Math.random() * Math.PI * 2;
                var dist = 30 + Math.random() * 40;
                var sx = enemy.x + Math.cos(angle) * dist;
                var sy = enemy.y + Math.sin(angle) * dist;
                sx = Math.max(0, Math.min(Config.MAP_WIDTH, sx));
                sy = Math.max(0, Math.min(Config.MAP_HEIGHT, sy));

                var spawned = _createEnemy(typeKey, sx, sy, _currentWave);
                if (spawned) {
                    spawned.parentBossId = enemy.id;
                    // Give spawned enemy a path
                    if (spawned.special === 'flying') {
                        // already has direct path from _createEnemy
                    } else {
                        var path = _findPath(sx, sy, spawned.targetBuildingId);
                        if (path) {
                            spawned.path = path;
                            spawned.pathIndex = 0;
                        } else {
                            var coreP = _getCorePosition();
                            spawned.path = _directPath(sx, sy, coreP.x, coreP.y);
                            spawned.pathIndex = 0;
                        }
                    }
                    _enemies.push(spawned);
                    enemy.spawnedIds.push(spawned.id);
                }
            }
        }
    }

    // ---- Jumper Mechanics (Quake Titan) ------------------------------------

    function _handleJumperMechanics() {
        for (var i = 0; i < _enemies.length; i++) {
            var enemy = _enemies[i];
            if (enemy.mechanic !== 'jumper') continue;
            if (enemy.hp <= 0) continue;
            if (enemy.stunTimer > 0) { enemy.stunTimer--; continue; }
            if (enemy.blocked) { enemy.blocked = false; continue; }

            // Ensure path exists
            if (!enemy.path || enemy.path.length === 0) {
                var corePos = _getCorePosition();
                var corePath = _findPath(enemy.x, enemy.y, null);
                if (corePath) {
                    enemy.path = corePath;
                    enemy.pathIndex = 0;
                } else {
                    enemy.path = _directPath(enemy.x, enemy.y, corePos.x, corePos.y);
                    enemy.pathIndex = 0;
                }
            }

            // Repath periodically
            if (enemy.repathTimer == null) enemy.repathTimer = 0;
            enemy.repathTimer--;
            if (enemy.repathTimer <= 0) {
                enemy.repathTimer = 30;
                var newJPath = _findPath(enemy.x, enemy.y, null);
                if (newJPath && newJPath.length > 1) {
                    enemy.path = newJPath;
                    // Find the furthest waypoint within reach to avoid backtracking
                    var bestIdx = 1;
                    for (var pi = 1; pi < newJPath.length; pi++) {
                        var pdx = newJPath[pi].x - enemy.x;
                        var pdy = newJPath[pi].y - enemy.y;
                        if (pdx * pdx + pdy * pdy < 900) {
                            bestIdx = pi + 1;
                        }
                    }
                    if (bestIdx >= newJPath.length) bestIdx = newJPath.length - 1;
                    enemy.pathIndex = bestIdx;
                } else if (newJPath) {
                    enemy.path = newJPath;
                    enemy.pathIndex = 0;
                }
            }

            enemy.jumpTimer--;
            if (enemy.jumpTimer <= 0) {
                enemy.jumpTimer = enemy.jumpCooldown;
                enemy.isJumping = true;
                enemy.jumpAnimTimer = 6; // 6 ticks animation

                // Calculate jump direction along path
                var jTarget = null;
                if (enemy.path && enemy.pathIndex < enemy.path.length) {
                    jTarget = enemy.path[enemy.pathIndex];
                }
                if (!jTarget) {
                    var jCore = _getCorePosition();
                    jTarget = { x: jCore.x, y: jCore.y };
                }

                var jdx = jTarget.x - enemy.x;
                var jdy = jTarget.y - enemy.y;
                var jdist = Math.sqrt(jdx * jdx + jdy * jdy);
                if (jdist > 0) {
                    var jumpDist = Math.min(enemy.jumpDistance, jdist);
                    enemy.x += (jdx / jdist) * jumpDist;
                    enemy.y += (jdy / jdist) * jumpDist;
                    enemy.distanceTraveled += jumpDist;
                }

                // Advance path index past any waypoints we jumped over
                if (enemy.path && enemy.pathIndex < enemy.path.length) {
                    var advanced = true;
                    while (advanced && enemy.pathIndex < enemy.path.length) {
                        var wpDx = enemy.path[enemy.pathIndex].x - enemy.x;
                        var wpDy = enemy.path[enemy.pathIndex].y - enemy.y;
                        if (wpDx * wpDx + wpDy * wpDy < 900) {
                            enemy.pathIndex++;
                        } else {
                            advanced = false;
                        }
                    }
                }

                // AoE damage on landing
                _jumpAOEDamage(enemy);

                // Check if reached core
                var coreDist = _getCorePosition();
                var cdx = coreDist.x - enemy.x;
                var cdy = coreDist.y - enemy.y;
                if (cdx * cdx + cdy * cdy < 2500) { // within 50px
                    _enemyReachedCore(enemy);
                }
            } else {
                if (enemy.jumpAnimTimer > 0) enemy.jumpAnimTimer--;
                if (enemy.jumpAnimTimer <= 0) enemy.isJumping = false;
            }
        }
    }

    function _jumpAOEDamage(enemy) {
        var radius = enemy.jumpAOERadius;
        var radiusSq = radius * radius;

        // Damage buildings
        if (typeof Buildings !== 'undefined' && Buildings.getAll) {
            var buildings = Buildings.getAll();
            for (var b = 0; b < buildings.length; b++) {
                var bld = buildings[b];
                if (bld.hp <= 0) continue;
                var def = Config.BUILDINGS[bld.type];
                if (!def) continue;
                var bCenterX = bld.worldX + (def.size[0] * Config.GRID_CELL_SIZE) / 2;
                var bCenterY = bld.worldY + (def.size[1] * Config.GRID_CELL_SIZE) / 2;
                var dx = bCenterX - enemy.x;
                var dy = bCenterY - enemy.y;
                if (dx * dx + dy * dy <= radiusSq) {
                    if (bld.type === 'core') {
                        if (typeof Engine !== 'undefined' && Engine.damageCoreHP) {
                            Engine.damageCoreHP(enemy.jumpCoreDamage);
                        }
                    } else {
                        bld.hp -= enemy.jumpAOEDamage;
                        if (bld.hp < 0) bld.hp = 0;
                    }
                }
            }
        }

        // Add shockwave visual effect
        _rangedEffects.push({
            type: 'quake_shockwave',
            x: enemy.x,
            y: enemy.y,
            radius: radius,
            timer: 15,
            maxTimer: 15
        });
    }

    // ---- Nexus Laser Mechanics ---------------------------------------------

    function _handleNexusLaserMechanics() {
        for (var i = 0; i < _enemies.length; i++) {
            var enemy = _enemies[i];
            if (enemy.mechanic !== 'nexus') continue;
            if (enemy.hp <= 0) continue;

            enemy.nexusLaserTargets = [];

            if (typeof Buildings === 'undefined' || !Buildings.getAll) continue;
            var buildings = Buildings.getAll();
            var rangeSq = enemy.nexusLaserRange * enemy.nexusLaserRange;

            for (var b = 0; b < buildings.length; b++) {
                var bld = buildings[b];
                if (bld.hp <= 0) continue;
                var def = Config.BUILDINGS[bld.type];
                if (!def) continue;
                var bCenterX = bld.worldX + (def.size[0] * Config.GRID_CELL_SIZE) / 2;
                var bCenterY = bld.worldY + (def.size[1] * Config.GRID_CELL_SIZE) / 2;
                var dx = bCenterX - enemy.x;
                var dy = bCenterY - enemy.y;
                if (dx * dx + dy * dy > rangeSq) continue;

                // Determine damage per tick
                var dps;
                var isShield = (bld.type === 'shield_generator' && bld.shieldActive);
                if (isShield) {
                    dps = enemy.nexusShieldDPS;
                } else {
                    dps = enemy.nexusLaserDPS;
                }
                var dmgPerTick = dps / Config.TICKS_PER_SECOND;

                if (isShield && bld.shieldHP > 0) {
                    bld.shieldHP -= dmgPerTick;
                    if (bld.shieldHP <= 0) {
                        bld.shieldHP = 0;
                        bld.shieldActive = false;
                    }
                } else {
                    if (bld.type === 'core') {
                        if (typeof Engine !== 'undefined' && Engine.damageCoreHP) {
                            Engine.damageCoreHP(dmgPerTick);
                        }
                    } else {
                        bld.hp -= dmgPerTick;
                        if (bld.hp < 0) bld.hp = 0;
                    }
                }

                enemy.nexusLaserTargets.push({
                    x: bCenterX,
                    y: bCenterY,
                    isShield: isShield
                });
            }
        }
    }

    // ---- Energy Drain Mechanics (Overload Boss) ----------------------------

    function _handleOverloadDrainMechanics() {
        for (var i = 0; i < _enemies.length; i++) {
            var enemy = _enemies[i];
            if (enemy.mechanic !== 'energy_drain') continue;
            if (enemy.hp <= 0) continue;
            if (enemy.stunTimer > 0) continue;

            enemy.drainTargets = [];
            enemy.drainZapTarget = null;

            if (enemy.drainState === 'cooldown') {
                enemy.drainTimer--;
                if (enemy.drainTimer <= 0) {
                    enemy.drainState = 'idle';
                }
                continue;
            }

            // Charged state: keeps moving, looking for a weapon within 500px
            if (enemy.drainState === 'charged') {
                if (typeof Buildings !== 'undefined' && Buildings.getAll) {
                    var chargeSearchRange = 500;
                    var chargeRangeSq = chargeSearchRange * chargeSearchRange;
                    var chClosest = null;
                    var chClosestDist = Infinity;
                    var chBlds = Buildings.getAll();
                    for (var ch = 0; ch < chBlds.length; ch++) {
                        var chb = chBlds[ch];
                        if (chb.hp <= 0) continue;
                        var chDef = Config.BUILDINGS[chb.type];
                        if (!chDef || chDef.category !== 'weapons') continue;
                        var chCX = chb.worldX + (chDef.size[0] * Config.GRID_CELL_SIZE) / 2;
                        var chCY = chb.worldY + (chDef.size[1] * Config.GRID_CELL_SIZE) / 2;
                        var chdx = chCX - enemy.x;
                        var chdy = chCY - enemy.y;
                        var chDistSq = chdx * chdx + chdy * chdy;
                        if (chDistSq > chargeRangeSq) continue;
                        if (chDistSq < chClosestDist) {
                            chClosestDist = chDistSq;
                            chClosest = chb;
                        }
                    }
                    if (chClosest) {
                        enemy.drainState = 'zapping';
                        enemy.drainTimer = enemy.drainZapDuration;
                        enemy._zapTargetId = chClosest.id;
                    }
                }
                continue;
            }

            if (enemy.drainState === 'zapping') {
                enemy.drainTimer--;
                // Find the weapon target and damage it
                var zapFound = false;
                if (enemy._zapTargetId && typeof Buildings !== 'undefined' && Buildings.getAll) {
                    var allB = Buildings.getAll();
                    for (var zi = 0; zi < allB.length; zi++) {
                        if (allB[zi].id === enemy._zapTargetId && allB[zi].hp > 0) {
                            var zapDef = Config.BUILDINGS[allB[zi].type];
                            var bCX = allB[zi].worldX + (zapDef ? (zapDef.size[0] * Config.GRID_CELL_SIZE) / 2 : 0);
                            var bCY = allB[zi].worldY + (zapDef ? (zapDef.size[1] * Config.GRID_CELL_SIZE) / 2 : 0);
                            var dmgPerTick = enemy.drainZapDPS / Config.TICKS_PER_SECOND;
                            allB[zi].hp -= dmgPerTick;
                            if (allB[zi].hp < 0) allB[zi].hp = 0;
                            enemy.drainZapTarget = { x: bCX, y: bCY };
                            zapFound = true;
                            // If target destroyed, find another weapon in range
                            if (allB[zi].hp <= 0) {
                                enemy._zapTargetId = null;
                                var zRangeSq = enemy.drainRange * enemy.drainRange;
                                var zClosest = null;
                                var zClosestDist = Infinity;
                                for (var zw = 0; zw < allB.length; zw++) {
                                    if (allB[zw].hp <= 0) continue;
                                    var zwDef = Config.BUILDINGS[allB[zw].type];
                                    if (!zwDef || zwDef.category !== 'weapons') continue;
                                    var zwCX = allB[zw].worldX + (zwDef.size[0] * Config.GRID_CELL_SIZE) / 2;
                                    var zwCY = allB[zw].worldY + (zwDef.size[1] * Config.GRID_CELL_SIZE) / 2;
                                    var zwdx = zwCX - enemy.x;
                                    var zwdy = zwCY - enemy.y;
                                    var zwDistSq = zwdx * zwdx + zwdy * zwdy;
                                    if (zwDistSq > zRangeSq) continue;
                                    if (zwDistSq < zClosestDist) {
                                        zClosestDist = zwDistSq;
                                        zClosest = allB[zw];
                                    }
                                }
                                if (zClosest) {
                                    enemy._zapTargetId = zClosest.id;
                                }
                            }
                            break;
                        }
                    }
                }
                // If no target found (destroyed and no replacement), end zap early
                if (!zapFound && !enemy._zapTargetId) {
                    enemy.drainAbsorbed = 0;
                    enemy.drainState = 'cooldown';
                    enemy.drainTimer = enemy.drainCooldown;
                }
                if (enemy.drainTimer <= 0) {
                    enemy.drainAbsorbed = 0;
                    enemy.drainState = 'cooldown';
                    enemy.drainTimer = enemy.drainCooldown;
                    enemy._zapTargetId = null;
                }
                continue;
            }

            // idle or draining state: skip draining if within 100px of core
            var corePos = _getCorePosition();
            var coreDx = enemy.x - corePos.x;
            var coreDy = enemy.y - corePos.y;
            if (coreDx * coreDx + coreDy * coreDy < 10000) {
                if (enemy.drainState === 'draining') enemy.drainState = 'idle';
                continue;
            }

            // look for batteries/capacitors to drain
            if (typeof Buildings === 'undefined' || !Buildings.getAll) continue;
            var buildings = Buildings.getAll();
            var rangeSq = enemy.drainRange * enemy.drainRange;
            var drainPerTick = enemy.drainRate / Config.TICKS_PER_SECOND;
            var foundTarget = false;

            for (var b = 0; b < buildings.length; b++) {
                var bld = buildings[b];
                if (bld.hp <= 0) continue;
                var bDef = Config.BUILDINGS[bld.type];
                if (!bDef) continue;
                // Only target batteries and capacitors (storage category)
                if (bDef.category !== 'storage') continue;
                // Skip consumer batteries
                if (bld.type === 'consumer_battery') continue;

                var bldCX = bld.worldX + (bDef.size[0] * Config.GRID_CELL_SIZE) / 2;
                var bldCY = bld.worldY + (bDef.size[1] * Config.GRID_CELL_SIZE) / 2;
                var dx = bldCX - enemy.x;
                var dy = bldCY - enemy.y;
                if (dx * dx + dy * dy > rangeSq) continue;

                // Must be at least half full
                var capacity = bDef.energyStorageCapacity || 0;
                if (bld.scaledStorageCapacity) capacity = bld.scaledStorageCapacity;
                if (capacity <= 0) continue;
                if ((bld.energy || 0) < capacity * 0.5) continue;

                // Drain energy
                var available = bld.energy || 0;
                var drained = Math.min(drainPerTick, available);
                bld.energy = available - drained;
                enemy.drainAbsorbed += drained;
                foundTarget = true;

                enemy.drainTargets.push({ x: bldCX, y: bldCY });
            }

            if (foundTarget) {
                enemy.drainState = 'draining';
            } else if (enemy.drainState === 'draining') {
                // No targets in range anymore, resume moving
                enemy.drainState = 'idle';
            }

            // Check if threshold reached — find closest weapon and zap it
            if (enemy.drainAbsorbed >= enemy.drainThreshold) {
                var zapSearchRange = 500;
                var zapSearchRangeSq = zapSearchRange * zapSearchRange;
                var closestWeapon = null;
                var closestDist = Infinity;
                var allBlds = Buildings.getAll();
                for (var w = 0; w < allBlds.length; w++) {
                    var wb = allBlds[w];
                    if (wb.hp <= 0) continue;
                    var wDef = Config.BUILDINGS[wb.type];
                    if (!wDef || wDef.category !== 'weapons') continue;
                    var wCX = wb.worldX + (wDef.size[0] * Config.GRID_CELL_SIZE) / 2;
                    var wCY = wb.worldY + (wDef.size[1] * Config.GRID_CELL_SIZE) / 2;
                    var wdx = wCX - enemy.x;
                    var wdy = wCY - enemy.y;
                    var wDistSq = wdx * wdx + wdy * wdy;
                    if (wDistSq > zapSearchRangeSq) continue;
                    if (wDistSq < closestDist) {
                        closestDist = wDistSq;
                        closestWeapon = wb;
                    }
                }
                if (closestWeapon) {
                    enemy.drainState = 'zapping';
                    enemy.drainTimer = enemy.drainZapDuration;
                    enemy._zapTargetId = closestWeapon.id;
                } else {
                    // No weapon in range yet — enter charged state, keep moving
                    enemy.drainState = 'charged';
                }
            }
        }
    }

    // ---- Public API --------------------------------------------------------

    return {
        tick: function () {
            _rebuildSpatialGrid();
            _pathBudgetThisTick = 0;

            // 0. Process deferred pathfinding queue (via setTimeout, non-blocking)
            _processDeferredPaths();

            // 1. Process spawn queue
            if (_spawnTimer > 0) {
                _spawnTimer--;
            }

            if (_spawnTimer <= 0 && _spawnQueue.length > 0) {
                var next = _spawnQueue.shift();

                if (next.formationGroup && next.formationGroup.length > 0) {
                    // Formation spawn — spawn all at once
                    _spawnFormationGroup(next);
                } else {
                    // Original single-spawn logic
                    var eDef = Config.ENEMIES[next.typeKey];
                    var spawnPts;
                    if (eDef && eDef.special === 'river_spawn') {
                        spawnPts = _getRiverSpawnPoints();
                        if (spawnPts.length === 0) spawnPts = _spawnPoints;
                    } else {
                        spawnPts = _spawnPoints;
                    }
                    if (spawnPts.length === 0) {
                        spawnPts = [{ x: 0, y: Config.MAP_HEIGHT / 2 }];
                    }

                    // Pick random spawn point, validate path exists
                    var rngObj = _getRng();
                    var ptIndex = rngObj && typeof rngObj.randomInt === 'function'
                        ? rngObj.randomInt(0, spawnPts.length - 1)
                        : Math.floor(Math.random() * spawnPts.length);

                    var sp = null;
                    var enemy = null;
                    // Try each spawn point to find one with a valid path
                    for (var si = 0; si < spawnPts.length; si++) {
                        var tryIdx = (ptIndex + si) % spawnPts.length;
                        var tryEnemy = _createEnemy(next.typeKey, spawnPts[tryIdx].x, spawnPts[tryIdx].y, _currentWave);
                        if (tryEnemy) {
                            var testPath = _findPath(spawnPts[tryIdx].x, spawnPts[tryIdx].y, tryEnemy.targetBuildingId);
                            if (testPath) {
                                sp = spawnPts[tryIdx];
                                tryEnemy.path = testPath;
                                tryEnemy.pathIndex = 0;
                                enemy = tryEnemy;
                                break;
                            }
                        }
                    }

                    // If no spawn point had a valid path, use the first one with fallback
                    if (!enemy) {
                        sp = spawnPts[ptIndex];
                        enemy = _createEnemy(next.typeKey, sp.x, sp.y, _currentWave);
                    }

                    if (enemy) {
                        _enemies.push(enemy);
                    }
                }

                // Convert spawnDelay from ms to ticks
                _spawnTimer = Math.max(1, Math.round(
                    (next.delay / 1000) * Config.TICKS_PER_SECOND
                ));
            }

            // 2. Move each enemy
            for (var i = _enemies.length - 1; i >= 0; i--) {
                _moveEnemy(_enemies[i]);
            }

            // 2b. Handle boss spawn mechanics (swarm mother, nexus)
            _handleBossSpawnMechanics();

            // 2c. Handle jumper mechanics (quake titan)
            _handleJumperMechanics();

            // 2d. Handle nexus laser mechanics
            _handleNexusLaserMechanics();

            // 2e. Handle overload boss energy drain mechanics
            _handleOverloadDrainMechanics();

            // 3. Tick ranged effects (decay timers)
            for (var ri = _rangedEffects.length - 1; ri >= 0; ri--) {
                _rangedEffects[ri].timer--;
                if (_rangedEffects[ri].timer <= 0) {
                    _rangedEffects.splice(ri, 1);
                }
            }
        },

        spawnWave: function (waveNumber) {
            _currentWave = waveNumber;

            // Resolve wave definition
            var waveDef;
            if (waveNumber <= 50 && Config.WAVES[waveNumber - 1]) {
                waveDef = Config.WAVES[waveNumber - 1];
            } else {
                waveDef = _generateProceduralWave(waveNumber);
            }

            // Build spawn queue
            _spawnQueue = _buildSpawnQueue(waveDef, waveNumber);
            _spawnTimer = 0;

            // Select spawn points
            var numSpawnPts = waveDef.spawnPoints || 1;
            _spawnPoints = [];

            if (typeof Map !== 'undefined' && Map.getSpawnPoints) {
                var available = Map.getSpawnPoints();
                if (available && available.length > 0) {
                    // Pick up to numSpawnPts
                    var used = {};
                    for (var s = 0; s < numSpawnPts && s < available.length; s++) {
                        var rngObj2 = (typeof Engine !== 'undefined' && Engine.getRng)
                            ? Engine.getRng()
                            : null;
                        var idx = rngObj2 && typeof rngObj2.randomInt === 'function'
                            ? rngObj2.randomInt(0, available.length - 1)
                            : Math.floor(Math.random() * available.length);
                        var attempts = 0;
                        while (used[idx] && attempts < available.length) {
                            idx = (idx + 1) % available.length;
                            attempts++;
                        }
                        used[idx] = true;
                        _spawnPoints.push(available[idx]);
                    }
                }
            }

            // Fallback spawn points at map edges
            if (_spawnPoints.length === 0) {
                var hw = Config.MAP_WIDTH / 2;
                var hh = Config.MAP_HEIGHT / 2;
                var edgePoints = [
                    { x: 0,                y: hh },
                    { x: Config.MAP_WIDTH, y: hh },
                    { x: hw,               y: 0 },
                    { x: hw,               y: Config.MAP_HEIGHT }
                ];
                for (var e = 0; e < numSpawnPts && e < edgePoints.length; e++) {
                    _spawnPoints.push(edgePoints[e]);
                }
            }
        },

        // ---- Queries ----------------------------------------------------------

        getAll: function () {
            return _enemies;
        },

        isSpawning: function () {
            return _spawnQueue.length > 0;
        },

        getRangedEffects: function () {
            return _rangedEffects;
        },

        getById: function (id) {
            for (var i = 0; i < _enemies.length; i++) {
                if (_enemies[i].id === id) return _enemies[i];
            }
            return null;
        },

        getInRange: function (worldX, worldY, range) {
            var rangeSq = range * range;
            var candidates = _getNearbyEnemies(worldX, worldY, range);
            var results = [];
            for (var i = 0; i < candidates.length; i++) {
                if (_distSq(worldX, worldY, candidates[i].x, candidates[i].y) <= rangeSq) {
                    results.push(candidates[i]);
                }
            }
            return results;
        },

        getClosest: function (worldX, worldY, range) {
            var rangeSq = range * range;
            var candidates = _getNearbyEnemies(worldX, worldY, range);
            var closest = null;
            var closestDist = Infinity;
            for (var i = 0; i < candidates.length; i++) {
                var d = _distSq(worldX, worldY, candidates[i].x, candidates[i].y);
                if (d <= rangeSq && d < closestDist) {
                    closestDist = d;
                    closest = candidates[i];
                }
            }
            return closest;
        },

        getFurthest: function (worldX, worldY, range) {
            var rangeSq = range * range;
            var candidates = _getNearbyEnemies(worldX, worldY, range);
            var furthest = null;
            var furthestDist = -1;
            for (var i = 0; i < candidates.length; i++) {
                var d = _distSq(worldX, worldY, candidates[i].x, candidates[i].y);
                if (d <= rangeSq && candidates[i].distanceTraveled > furthestDist) {
                    furthestDist = candidates[i].distanceTraveled;
                    furthest = candidates[i];
                }
            }
            return furthest;
        },

        /**
         * Get an enemy in range by targeting priority.
         * priority: 'closest_core' | 'closest_weapon' | 'lowest_hp' |
         *           'highest_hp' | 'highest_maxhp' | 'fastest' | 'slowest'
         * corePos: {x,y} — needed for closest_core
         */
        getByPriority: function (worldX, worldY, range, priority, corePos) {
            var rangeSq = range * range;
            var candidates = _getNearbyEnemies(worldX, worldY, range);
            var best = null;
            var bestVal = null;

            for (var i = 0; i < candidates.length; i++) {
                var c = candidates[i];
                var d = _distSq(worldX, worldY, c.x, c.y);
                if (d > rangeSq) continue;

                var val;
                switch (priority) {
                    case 'closest_core':
                        // Closest to core = most distance traveled
                        val = c.distanceTraveled;
                        if (best === null || val > bestVal) { best = c; bestVal = val; }
                        break;
                    case 'closest_weapon':
                        val = d;
                        if (best === null || val < bestVal) { best = c; bestVal = val; }
                        break;
                    case 'lowest_hp':
                        val = c.hp;
                        if (best === null || val < bestVal) { best = c; bestVal = val; }
                        break;
                    case 'highest_hp':
                        val = c.hp;
                        if (best === null || val > bestVal) { best = c; bestVal = val; }
                        break;
                    case 'highest_maxhp':
                        val = c.maxHp;
                        if (best === null || val > bestVal) { best = c; bestVal = val; }
                        break;
                    case 'fastest':
                        val = c.speed;
                        if (best === null || val > bestVal) { best = c; bestVal = val; }
                        break;
                    case 'slowest':
                        val = c.speed;
                        if (best === null || val < bestVal) { best = c; bestVal = val; }
                        break;
                    default:
                        // fallback: closest to weapon
                        val = d;
                        if (best === null || val < bestVal) { best = c; bestVal = val; }
                        break;
                }
            }
            return best;
        },

        getCount: function () {
            return _enemies.length;
        },

        getCurrentWave: function () {
            return _currentWave;
        },

        getTotalKills: function () {
            return _totalKills;
        },

        getTotalScore: function () {
            return _totalScore;
        },

        // ---- Enemy manipulation -----------------------------------------------

        damageEnemy: function (enemyId, damage, armorBypass, weaponType) {
            for (var i = 0; i < _enemies.length; i++) {
                var enemy = _enemies[i];
                if (enemy.id !== enemyId) { continue; }

                // Nexus: invincible except uranium weapons (10% damage)
                // Allow debug kills (extremely high damage)
                if (enemy.mechanic === 'nexus' && damage < enemy.maxHp * 10) {
                    if (weaponType === 'plasma_cannon' || weaponType === 'fusion_beam') {
                        damage = damage * 0.1;
                    } else {
                        return false; // no damage from non-uranium
                    }
                }

                // Nexus shield aura: enemies within 300px of a nexus take 75% less damage
                if (enemy.mechanic !== 'nexus') {
                    for (var ni = 0; ni < _enemies.length; ni++) {
                        var nexus = _enemies[ni];
                        if (nexus.mechanic !== 'nexus' || nexus.hp <= 0) continue;
                        var ndx = enemy.x - nexus.x;
                        var ndy = enemy.y - nexus.y;
                        if (ndx * ndx + ndy * ndy <= 90000) { // 300*300
                            damage *= 0.25;
                            break;
                        }
                    }
                }

                // Calculate effective armor
                var effectiveArmor = enemy.armor;
                if (armorBypass && armorBypass > 0) {
                    effectiveArmor = Math.max(0, effectiveArmor * (1 - armorBypass));
                }

                var effectiveDmg = Math.max(1, damage - effectiveArmor);
                enemy.hp -= effectiveDmg;

                if (enemy.hp <= 0) {
                    // Enemy killed
                    var def = Config.ENEMIES[enemy.type];
                    if (def) {
                        var killReward = def.killReward || 0;
                        var difficulty = _getDifficulty();
                        killReward = Math.round(killReward * (difficulty.killRewardMult || 1));

                        if (typeof Economy !== 'undefined' && Economy.addMoney) {
                            Economy.addMoney(killReward, 'kill');
                        }
                    }

                    _totalKills++;
                    _totalScore += (def && def.scoreValue) ? def.scoreValue : 1;

                    // Swarm mother / nexus: kill all spawned enemies on boss death
                    if (enemy.spawnedIds && enemy.spawnedIds.length > 0) {
                        for (var si = _enemies.length - 1; si >= 0; si--) {
                            if (_enemies[si].parentBossId === enemy.id) {
                                _enemies.splice(si, 1);
                                // Adjust i if needed
                                if (si < i) i--;
                            }
                        }
                    }

                    _enemies.splice(i, 1);

                    // If this was a spawn of a nexus/swarm mother, damage the parent
                    if (enemy.parentBossId) {
                        for (var pi = 0; pi < _enemies.length; pi++) {
                            if (_enemies[pi].id === enemy.parentBossId && _enemies[pi].nexusDamagePerSpawnKill) {
                                _enemies[pi].hp -= _enemies[pi].nexusDamagePerSpawnKill;
                                if (_enemies[pi].hp <= 0) {
                                    var pDef = Config.ENEMIES[_enemies[pi].type];
                                    if (pDef) {
                                        var pReward = pDef.killReward || 0;
                                        var pDiff = _getDifficulty();
                                        pReward = Math.round(pReward * (pDiff.killRewardMult || 1));
                                        if (typeof Economy !== 'undefined' && Economy.addMoney) {
                                            Economy.addMoney(pReward, 'kill');
                                        }
                                    }
                                    _totalKills++;
                                    _totalScore += (pDef && pDef.scoreValue) ? pDef.scoreValue : 1;
                                    // Kill nexus spawns too
                                    var nexusId = _enemies[pi].id;
                                    _enemies.splice(pi, 1);
                                    for (var ns = _enemies.length - 1; ns >= 0; ns--) {
                                        if (_enemies[ns].parentBossId === nexusId) {
                                            _enemies.splice(ns, 1);
                                        }
                                    }
                                }
                                break;
                            }
                        }
                    }

                    return true;
                }
                return false;
            }
            return false;
        },

        removeEnemy: function (enemyId) {
            for (var i = _enemies.length - 1; i >= 0; i--) {
                if (_enemies[i].id === enemyId) {
                    _enemies.splice(i, 1);
                    return true;
                }
            }
            return false;
        },

        // ---- Pathfinding (public) ---------------------------------------------

        findPath: function (startX, startY, targetBuildingId) {
            return _findPath(startX, startY, targetBuildingId);
        },

        /**
         * Check if all spawn points can still reach the core with given cells blocked.
         * blockedCells is an array of {x, y} grid coords.
         * Returns true if all spawn points can reach the core.
         */
        canReachCoreWith: function (blockedCells) {
            var spawnPts = (typeof Map !== 'undefined' && Map.getSpawnPoints)
                ? Map.getSpawnPoints() : [];

            // Fallback edge points if no spawn points generated
            if (spawnPts.length === 0) {
                var hw = Config.MAP_WIDTH / 2;
                var hh = Config.MAP_HEIGHT / 2;
                spawnPts = [
                    { x: 0, y: hh },
                    { x: Config.MAP_WIDTH, y: hh },
                    { x: hw, y: 0 },
                    { x: hw, y: Config.MAP_HEIGHT }
                ];
            }

            // Use cached reachable spawns if building count hasn't changed
            var currentBuildingCount = (typeof Buildings !== 'undefined' && Buildings.getAll)
                ? Buildings.getAll().length : 0;

            if (_reachableSpawnsCache === null || _buildingCountAtCache !== currentBuildingCount) {
                _tempBlockedCells = {};
                _reachableSpawnsCache = [];
                for (var s = 0; s < spawnPts.length; s++) {
                    var path = _findPath(spawnPts[s].x, spawnPts[s].y);
                    if (path) {
                        _reachableSpawnsCache.push(spawnPts[s]);
                    }
                }
                _buildingCountAtCache = currentBuildingCount;
            }

            // If no spawn points can currently reach, allow placement
            if (_reachableSpawnsCache.length === 0) {
                _tempBlockedCells = {};
                return true;
            }

            // Check that ALL cached reachable spawn points can still reach with new building
            _tempBlockedCells = {};
            for (var i = 0; i < blockedCells.length; i++) {
                _tempBlockedCells[blockedCells[i].x + ',' + blockedCells[i].y] = true;
            }

            var allStillReachable = true;
            for (var r = 0; r < _reachableSpawnsCache.length; r++) {
                var testPath = _findPath(_reachableSpawnsCache[r].x, _reachableSpawnsCache[r].y);
                if (!testPath) {
                    allStillReachable = false;
                    break;
                }
            }

            _tempBlockedCells = {};
            return allStillReachable;
        },

        // ---- Save / Load ------------------------------------------------------

        getSerializableState: function () {
            var serializedEnemies = [];
            for (var i = 0; i < _enemies.length; i++) {
                var e = _enemies[i];
                serializedEnemies.push({
                    id: e.id,
                    type: e.type,
                    x: e.x,
                    y: e.y,
                    hp: e.hp,
                    maxHp: e.maxHp,
                    speed: e.speed,
                    damage: e.damage,
                    armor: e.armor,
                    path: e.path,
                    pathIndex: e.pathIndex,
                    special: e.special,
                    stunTimer: e.stunTimer,
                    slowFactor: e.slowFactor,
                    distanceTraveled: e.distanceTraveled,
                    canSwim: e.canSwim || false,
                    targetCategory: e.targetCategory || null,
                    targetBuildingId: e.targetBuildingId || null,
                    repathTimer: e.repathTimer || 0,
                    isBoss: e.isBoss || false,
                    mechanic: e.mechanic || null,
                    wallsDestroyed: e.wallsDestroyed || 0,
                    wallsToDestroyMax: e.wallsToDestroyMax || 0
                });
            }

            return {
                enemies: serializedEnemies,
                nextId: _nextId,
                currentWave: _currentWave,
                spawnQueue: _spawnQueue,
                spawnTimer: _spawnTimer,
                totalKills: _totalKills,
                totalScore: _totalScore,
                totalEscaped: _totalEscaped,
                spawnPoints: _spawnPoints
            };
        },

        loadState: function (data) {
            if (!data) { return; }

            _enemies      = data.enemies      || [];
            _nextId        = data.nextId        || 1;
            _currentWave   = data.currentWave   || 0;
            _spawnQueue    = data.spawnQueue    || [];
            _spawnTimer    = data.spawnTimer    || 0;
            _totalKills    = data.totalKills    || 0;
            _totalScore    = data.totalScore    || 0;
            _totalEscaped  = data.totalEscaped  || 0;
            _rangedEffects = [];
            _spawnPoints   = data.spawnPoints   || [];
        },

        debugSpawn: function (typeKey, worldX, worldY) {
            var wave = _currentWave || 1;
            var enemy = _createEnemy(typeKey, worldX, worldY, wave);
            if (enemy) {
                _enemies.push(enemy);
            }
            return enemy;
        },

        invalidatePathCache: function () {
            _clearPathCache();
        }
    };
})();

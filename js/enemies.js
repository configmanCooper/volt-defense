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
    var _totalEscaped = 0;
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
    function _findPathTo(startX, startY, endX, endY, canSwim, waterOnly, targetBuildingId) {
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
                var targetKey = enemy.targetBuildingId || 'core';
                var path = _findPathRaw(enemy.x, enemy.y, enemy.targetBuildingId);
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

        // Self-damage: non-boss, non-ranged enemies die after attacking
        // Exception: walls don't kill the attacker
        if (attackedBuilding && !enemy.isBoss && enemy.mechanic !== 'ranged_attack') {
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
                // Wall destroyed — track for wall_breakers
                if (enemy.special === 'targets_walls' && enemy.wallsToDestroyMax > 0) {
                    enemy.wallsDestroyed = (enemy.wallsDestroyed || 0) + 1;
                    if (enemy.wallsDestroyed >= enemy.wallsToDestroyMax) {
                        // Done breaking walls — head to core
                        enemy.targetCategory = null;
                        enemy.special = null;
                    }
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
            wallsToDestroyMax: 0
        };

        if (def.special && specialToCategory[def.special]) {
            enemy.targetCategory = specialToCategory[def.special];
        }
        // Wall breakers destroy 2-4 walls then head to core
        if (def.special === 'targets_walls') {
            var baseWalls = def.wallsToDestroy || 3;
            enemy.wallsToDestroyMax = baseWalls + Math.floor(Math.random() * 3) - 1; // 2-4
            if (enemy.wallsToDestroyMax < 2) enemy.wallsToDestroyMax = 2;
            if (enemy.wallsToDestroyMax > 4) enemy.wallsToDestroyMax = 4;
        }
        if (def.special === 'river_spawn') {
            enemy.canSwim = true;
            enemy.targetCategory = 'water_buildings'; // targets buildings on water tiles
        }
        if (def.isBoss) {
            enemy.isBoss = true;
        }

        // Compute initial path — use cache, defer A* on miss
        var grid = _worldToGrid(spawnX, spawnY);
        var targetKey = enemy.targetBuildingId || 'core';
        var cached = _getCachedPath(grid.gx, grid.gy, targetKey);
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
                                   'emp_disable', 'ignores_shields', 'river_spawn'];
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

        // Periodic repath for ALL enemies
        if (enemy.repathTimer == null) enemy.repathTimer = 0;
        enemy.repathTimer--;

        if (enemy.repathTimer <= 0) {
            enemy.repathTimer = 20; // repath every 2 seconds

            // Skip if pathfinding budget exhausted this tick
            if (_pathBudgetThisTick >= _maxPathfindsPerTick) {
                enemy.repathTimer = 1; // retry next tick
            } else {
                _pathBudgetThisTick++;

                // Targeted pathing: try to find specific target building
                if (enemy.targetCategory || enemy.targetBuildingId) {
                    var targetPos = _findTargetBuilding(enemy);
                    if (targetPos) {
                        var useWaterOnly = false;
                        if (enemy.special === 'river_spawn' && enemy.targetCategory === 'water_buildings') {
                            useWaterOnly = true;
                        }
                        var newPath = _findPathTo(enemy.x, enemy.y, targetPos.x, targetPos.y, enemy.canSwim || false, useWaterOnly, targetPos.buildingId);
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
                    var corePath = _findPathTo(enemy.x, enemy.y, corePos.x, corePos.y, enemy.canSwim || false, false, null);
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
            _enemyReachedCore(enemy);
            return;
        }

        var speedMult = 1;
        if (typeof Engine !== 'undefined' && Engine.getEnemySpeedMultiplier) {
            speedMult = Engine.getEnemySpeedMultiplier();
        }

        var effectiveSpeed = enemy.speed * enemy.slowFactor * speedMult;
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
        if (typeof Engine !== 'undefined' && Engine.damageCoreHP) {
            Engine.damageCoreHP(enemy.damage);
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

        getCount: function () {
            return _enemies.length;
        },

        getCurrentWave: function () {
            return _currentWave;
        },

        getTotalKills: function () {
            return _totalKills;
        },

        // ---- Enemy manipulation -----------------------------------------------

        damageEnemy: function (enemyId, damage, armorBypass) {
            for (var i = 0; i < _enemies.length; i++) {
                var enemy = _enemies[i];
                if (enemy.id !== enemyId) { continue; }

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
                    _enemies.splice(i, 1);
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
            _totalEscaped  = data.totalEscaped  || 0;
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

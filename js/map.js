/* =========================================================================
 *  map.js — Map generation and terrain management for Volt Defense
 *  Generates terrain, rivers, resource deposits, and spawn points.
 *  Uses the IIFE module pattern. All constants come from Config.
 * ========================================================================= */

var Map = (function() {
    // ---- terrain type constants ----
    var TERRAIN_GRASS = 0;
    var TERRAIN_ROCK = 1;
    var TERRAIN_WATER = 2;
    var TERRAIN_DEEP_WATER = 3;
    var TERRAIN_BRIDGE = 4;
    // Deposit overlay types
    var TERRAIN_IRON_DEPOSIT = 10;
    var TERRAIN_COAL_DEPOSIT = 11;
    var TERRAIN_URANIUM_DEPOSIT = 12;
    var TERRAIN_OIL_DEPOSIT = 13;

    // ---- private state ----
    var _grid = null;
    var _rivers = [];
    var _bridges = [];
    var _riverLookup = {};  // 'gx,gy' -> river tile index for O(1) lookup
    var _depositLookup = {};  // 'gx,gy' -> deposit index for O(1) lookup
    var _deposits = [];
    var _spawnPoints = [];
    var _hydroSpeedCache = {};
    var _hydroCacheDirty = true;
    var _gridWidth = 0;
    var _gridHeight = 0;

    // ---- helpers ----

    function _cellSize() {
        return (typeof Config !== 'undefined' && Config.GRID_CELL_SIZE) ? Config.GRID_CELL_SIZE : 40;
    }

    function _mapWidth() {
        return (typeof Config !== 'undefined' && Config.MAP_WIDTH) ? Config.MAP_WIDTH : 10000;
    }

    function _mapHeight() {
        return (typeof Config !== 'undefined' && Config.MAP_HEIGHT) ? Config.MAP_HEIGHT : 10000;
    }

    function _distance(x1, y1, x2, y2) {
        var dx = x1 - x2;
        var dy = y1 - y2;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function _buildRiverLookup() {
        _riverLookup = {};
        for (var i = 0; i < _rivers.length; i++) {
            var key = _rivers[i].gridX + ',' + _rivers[i].gridY;
            _riverLookup[key] = i;
        }
    }

    function _buildDepositLookup() {
        _depositLookup = {};
        for (var i = 0; i < _deposits.length; i++) {
            var key = _deposits[i].gridX + ',' + _deposits[i].gridY;
            _depositLookup[key] = i;
        }
    }

    function _rebuildHydroCache() {
        _hydroSpeedCache = {};
        if (typeof Buildings === 'undefined' || !Buildings.getAll) {
            _hydroCacheDirty = false;
            return;
        }
        var allBuildings = Buildings.getAll();
        for (var b = 0; b < allBuildings.length; b++) {
            var bld = allBuildings[b];
            if (bld.type !== 'hydro_plant' || bld.hp <= 0 || !bld.active) continue;
            var bFlow = Map.getFlowDirection(bld.gridX, bld.gridY);
            if (bFlow.dx === 0 && bFlow.dy === 0) continue;

            for (var dist = 1; dist <= 12; dist++) {
                var reduction = 0;
                if (dist <= 4) reduction = 0.50;
                else if (dist <= 8) reduction = 0.25;
                else reduction = 0.10;

                for (var lat = -2; lat <= 2; lat++) {
                    var tx, ty;
                    if (bFlow.dx !== 0) {
                        tx = bld.gridX + dist * bFlow.dx;
                        ty = bld.gridY + lat;
                    } else {
                        tx = bld.gridX + lat;
                        ty = bld.gridY + dist * bFlow.dy;
                    }
                    var tKey = tx + ',' + ty;
                    if (!_hydroSpeedCache[tKey]) _hydroSpeedCache[tKey] = 0;
                    _hydroSpeedCache[tKey] += reduction;
                }
            }
        }
        _hydroCacheDirty = false;
    }

    // ---- river generation ----

    function _generateRivers(rng, grid) {
        var riverCount = rng.randomInt(2, 4);
        var rivers = [];
        var riverId = 0;

        for (var r = 0; r < riverCount; r++) {
            riverId++;
            var side = rng.randomInt(0, 3); // 0=north, 1=south, 2=west, 3=east
            var riverWidth = rng.randomInt(3, 5);
            var baseSpeedMph = rng.randomInt(5, 20); // 5-20 mph base water speed
            var riverCells = [];
            var x, y, dx, dy, steps;

            if (side === 0) {
                x = rng.randomInt(20, _gridWidth - 20);
                y = 0;
                dx = 0; dy = 1;
            } else if (side === 1) {
                x = rng.randomInt(20, _gridWidth - 20);
                y = _gridHeight - 1;
                dx = 0; dy = -1;
            } else if (side === 2) {
                x = 0;
                y = rng.randomInt(20, _gridHeight - 20);
                dx = 1; dy = 0;
            } else {
                x = _gridWidth - 1;
                y = rng.randomInt(20, _gridHeight - 20);
                dx = -1; dy = 0;
            }

            steps = (dx !== 0) ? _gridWidth : _gridHeight;
            var distFromSource = 0;

            for (var s = 0; s < steps; s++) {
                if (s > 0 && s % 5 === 0) {
                    if (dx !== 0) {
                        y += rng.randomInt(-2, 2);
                        y = Math.max(1, Math.min(_gridHeight - 2, y));
                    } else {
                        x += rng.randomInt(-2, 2);
                        x = Math.max(1, Math.min(_gridWidth - 2, x));
                    }
                }

                var halfW = Math.floor(riverWidth / 2);
                for (var w = -halfW; w <= halfW; w++) {
                    var cx, cy;
                    if (dx !== 0) {
                        cx = x; cy = y + w;
                    } else {
                        cx = x + w; cy = y;
                    }
                    if (cx >= 0 && cx < _gridWidth && cy >= 0 && cy < _gridHeight) {
                        grid[cx][cy] = TERRAIN_WATER;

                        var speedVariation = baseSpeedMph + (rng.random() - 0.5) * 2;
                        speedVariation = Math.max(3, Math.min(22, speedVariation));

                        var cell = {
                            gridX: cx,
                            gridY: cy,
                            currentSpeed: speedVariation,
                            flowDirX: dx,
                            flowDirY: dy,
                            riverId: riverId,
                            distanceFromSource: distFromSource
                        };
                        riverCells.push(cell);
                    }
                }

                x += dx;
                y += dy;
                distFromSource++;

                if (x < 0 || x >= _gridWidth || y < 0 || y >= _gridHeight) { break; }
            }

            rivers = rivers.concat(riverCells);
        }

        return rivers;
    }

    // ---- bridge generation ----

    function _generateBridges(rng, grid, rivers) {
        var bridges = [];
        // Group river tiles by riverId
        var riverGroups = {};
        for (var i = 0; i < rivers.length; i++) {
            var rid = rivers[i].riverId;
            if (!riverGroups[rid]) { riverGroups[rid] = []; }
            riverGroups[rid].push(rivers[i]);
        }

        var rids = Object.keys(riverGroups);
        for (var ri = 0; ri < rids.length; ri++) {
            var tiles = riverGroups[rids[ri]];
            var riverId = parseInt(rids[ri], 10);
            if (tiles.length === 0) continue;

            // Determine flow direction from first tile
            var flowDx = tiles[0].flowDirX || 0;
            var flowDy = tiles[0].flowDirY || 0;

            // Sort tiles along the flow axis
            if (Math.abs(flowDx) > 0) {
                // River flows horizontally — sort by x
                tiles.sort(function(a, b) { return a.gridX - b.gridX; });
            } else {
                // River flows vertically — sort by y
                tiles.sort(function(a, b) { return a.gridY - b.gridY; });
            }

            // Determine number of bridges (2-4, more for longer rivers)
            var riverLength = tiles.length > 0 ? tiles[tiles.length - 1].distanceFromSource - tiles[0].distanceFromSource + 1 : 0;
            var numBridges = riverLength > 150 ? 4 : (riverLength > 80 ? 3 : 2);

            // Pick bridge positions along the river, spaced at least 30 tiles apart
            var lastBridgeDist = -999;
            var bridgeCount = 0;
            // Collect unique flow-axis positions
            var crossSections = {};
            for (var ti = 0; ti < tiles.length; ti++) {
                var posKey = Math.abs(flowDx) > 0 ? tiles[ti].gridX : tiles[ti].gridY;
                if (!crossSections[posKey]) { crossSections[posKey] = []; }
                crossSections[posKey].push(tiles[ti]);
            }
            var csKeys = Object.keys(crossSections);
            // Shuffle candidate positions
            for (var si = csKeys.length - 1; si > 0; si--) {
                var sj = rng.randomInt(0, si);
                var tmp = csKeys[si];
                csKeys[si] = csKeys[sj];
                csKeys[sj] = tmp;
            }
            // Sort back by position to maintain spacing logic
            csKeys.sort(function(a, b) { return parseInt(a, 10) - parseInt(b, 10); });

            // Select evenly-spaced candidates
            var spacing = Math.max(30, Math.floor(csKeys.length / (numBridges + 1)));
            for (var ci = spacing; ci < csKeys.length && bridgeCount < numBridges; ci += spacing) {
                var crossTiles = crossSections[csKeys[ci]];
                var pos = parseInt(csKeys[ci], 10);
                if (pos - lastBridgeDist < 30) continue;
                lastBridgeDist = pos;
                bridgeCount++;

                // Set all tiles in this cross-section to bridge
                for (var bt = 0; bt < crossTiles.length; bt++) {
                    var bx = crossTiles[bt].gridX;
                    var by = crossTiles[bt].gridY;
                    if (bx >= 0 && bx < _gridWidth && by >= 0 && by < _gridHeight) {
                        grid[bx][by] = TERRAIN_BRIDGE;
                        bridges.push({ gridX: bx, gridY: by, riverId: riverId });
                    }
                }
            }
        }
        return bridges;
    }

    // ---- deposit generation ----

    function _tooClose(gx, gy, existing, minDist, cellSz) {
        var wx = gx * cellSz + cellSz / 2;
        var wy = gy * cellSz + cellSz / 2;
        for (var i = 0; i < existing.length; i++) {
            var ex = existing[i].gridX * cellSz + cellSz / 2;
            var ey = existing[i].gridY * cellSz + cellSz / 2;
            if (_distance(wx, wy, ex, ey) < minDist) { return true; }
        }
        return false;
    }

    function _generateDeposits(rng, grid) {
        var deposits = [];
        var cellSz = _cellSize();
        var centerWX = _mapWidth() / 2;
        var centerWY = _mapHeight() / 2;
        var minDistFromCenter = 800; // 20 tiles * 40px

        // Helper: find a valid non-water cell away from center and other deposits
        function findSpot(minDistBetween, minDistCenter, maxAttempts) {
            for (var a = 0; a < (maxAttempts || 200); a++) {
                var gx = rng.randomInt(5, _gridWidth - 6);
                var gy = rng.randomInt(5, _gridHeight - 6);
                var wx = gx * cellSz + cellSz / 2;
                var wy = gy * cellSz + cellSz / 2;
                if (_distance(wx, wy, centerWX, centerWY) < minDistCenter) { continue; }
                if (grid[gx][gy] === TERRAIN_WATER || grid[gx][gy] === TERRAIN_DEEP_WATER) { continue; }
                if (_tooClose(gx, gy, deposits, minDistBetween, cellSz)) { continue; }
                return { gx: gx, gy: gy };
            }
            return null;
        }

        // Iron: 12-18 clusters, each 3-6 cells, 500-1500 units/cell
        var ironClusters = rng.randomInt(12, 18);
        for (var i = 0; i < ironClusters; i++) {
            var spot = findSpot(800, minDistFromCenter);
            if (!spot) { continue; }
            var clusterSize = rng.randomInt(3, 6);
            for (var c = 0; c < clusterSize; c++) {
                var ox = (c === 0) ? 0 : rng.randomInt(-1, 1);
                var oy = (c === 0) ? 0 : rng.randomInt(-1, 1);
                var dx = spot.gx + ox;
                var dy = spot.gy + oy;
                if (dx < 0 || dx >= _gridWidth || dy < 0 || dy >= _gridHeight) { continue; }
                if (grid[dx][dy] === TERRAIN_WATER || grid[dx][dy] === TERRAIN_DEEP_WATER) { continue; }
                var amount = rng.randomInt(500, 1500);
                grid[dx][dy] = TERRAIN_IRON_DEPOSIT;
                deposits.push({ gridX: dx, gridY: dy, type: 'iron', remaining: amount, maxAmount: amount });
            }
        }

        // Coal: 8-13 clusters, each 2-5 cells, 400-1200 units/cell
        var coalClusters = rng.randomInt(8, 13);
        for (var i = 0; i < coalClusters; i++) {
            var spot = findSpot(800, minDistFromCenter);
            if (!spot) { continue; }
            var clusterSize = rng.randomInt(2, 5);
            for (var c = 0; c < clusterSize; c++) {
                var ox = (c === 0) ? 0 : rng.randomInt(-1, 1);
                var oy = (c === 0) ? 0 : rng.randomInt(-1, 1);
                var dx = spot.gx + ox;
                var dy = spot.gy + oy;
                if (dx < 0 || dx >= _gridWidth || dy < 0 || dy >= _gridHeight) { continue; }
                if (grid[dx][dy] === TERRAIN_WATER || grid[dx][dy] === TERRAIN_DEEP_WATER) { continue; }
                // Skip cells already claimed by another deposit type
                if (grid[dx][dy] >= 10) { continue; }
                var amount = rng.randomInt(400, 1200);
                grid[dx][dy] = TERRAIN_COAL_DEPOSIT;
                deposits.push({ gridX: dx, gridY: dy, type: 'coal', remaining: amount, maxAmount: amount });
            }
        }

        // Uranium: 2-4 single or double cells, 100-300 units/cell, min 2000px apart, never within 50 tiles of center
        var uraniumClusters = rng.randomInt(2, 4);
        for (var i = 0; i < uraniumClusters; i++) {
            var spot = findSpot(2000, 2000);
            if (!spot) { continue; }
            var clusterSize = rng.randomInt(1, 2);
            for (var c = 0; c < clusterSize; c++) {
                var ox = (c === 0) ? 0 : rng.randomInt(-1, 1);
                var oy = (c === 0) ? 0 : rng.randomInt(-1, 1);
                var dx = spot.gx + ox;
                var dy = spot.gy + oy;
                if (dx < 0 || dx >= _gridWidth || dy < 0 || dy >= _gridHeight) { continue; }
                if (grid[dx][dy] === TERRAIN_WATER || grid[dx][dy] === TERRAIN_DEEP_WATER) { continue; }
                if (grid[dx][dy] >= 10) { continue; }
                var amount = rng.randomInt(100, 300);
                grid[dx][dy] = TERRAIN_URANIUM_DEPOSIT;
                deposits.push({ gridX: dx, gridY: dy, type: 'uranium', remaining: amount, maxAmount: amount });
            }
        }

        // Oil: 12-18 clusters, each 3-6 cells, 400-1000 units/cell (same frequency as iron)
        var oilClusters = rng.randomInt(12, 18);
        for (var i = 0; i < oilClusters; i++) {
            var spot = findSpot(800, minDistFromCenter);
            if (!spot) { continue; }
            var clusterSize = rng.randomInt(3, 6);
            for (var c = 0; c < clusterSize; c++) {
                var ox = (c === 0) ? 0 : rng.randomInt(-1, 1);
                var oy = (c === 0) ? 0 : rng.randomInt(-1, 1);
                var dx = spot.gx + ox;
                var dy = spot.gy + oy;
                if (dx < 0 || dx >= _gridWidth || dy < 0 || dy >= _gridHeight) { continue; }
                if (grid[dx][dy] === TERRAIN_WATER || grid[dx][dy] === TERRAIN_DEEP_WATER) { continue; }
                if (grid[dx][dy] >= 10) { continue; }
                var amount = rng.randomInt(400, 1000);
                grid[dx][dy] = TERRAIN_OIL_DEPOSIT;
                deposits.push({ gridX: dx, gridY: dy, type: 'oil', remaining: amount, maxAmount: amount });
            }
        }

        return deposits;
    }

    // ---- spawn point generation ----

    function _generateSpawnPoints(rng) {
        var count = rng.randomInt(4, 8);
        var points = [];
        var cellSz = _cellSize();
        var mapW = _mapWidth();
        var mapH = _mapHeight();
        var sides = ['north', 'south', 'east', 'west'];

        // Distribute evenly around perimeter
        for (var i = 0; i < count; i++) {
            var side = sides[i % 4];
            var offset = rng.randomInt(40, 80); // px from edge
            var x, y;

            if (side === 'north') {
                x = rng.randomInt(mapW * 0.1, mapW * 0.9);
                y = offset;
            } else if (side === 'south') {
                x = rng.randomInt(mapW * 0.1, mapW * 0.9);
                y = mapH - offset;
            } else if (side === 'east') {
                x = mapW - offset;
                y = rng.randomInt(mapH * 0.1, mapH * 0.9);
            } else {
                x = offset;
                y = rng.randomInt(mapH * 0.1, mapH * 0.9);
            }

            points.push({ x: x, y: y, side: side });
        }

        return points;
    }

    // ---- scattered rock ----

    function _scatterRocks(rng, grid) {
        var targetPercent = 0.05 + rng.random() * 0.05; // 5–10%
        var total = _gridWidth * _gridHeight;
        var rockCount = Math.floor(total * targetPercent);

        for (var r = 0; r < rockCount; r++) {
            var gx = rng.randomInt(0, _gridWidth - 1);
            var gy = rng.randomInt(0, _gridHeight - 1);
            // Only place on grass
            if (grid[gx][gy] === TERRAIN_GRASS) {
                grid[gx][gy] = TERRAIN_ROCK;
            }
        }
    }

    // ---- public API ----

    return {
        /**
         * Generate the full map: terrain, rivers, deposits, spawn points.
         * @param {SeededRNG} rng
         */
        generate: function(rng) {
            var cellSz = _cellSize();
            _gridWidth = Math.floor(_mapWidth() / cellSz);
            _gridHeight = Math.floor(_mapHeight() / cellSz);

            // 1. Initialize grid to all grass
            _grid = new Array(_gridWidth);
            for (var x = 0; x < _gridWidth; x++) {
                _grid[x] = new Array(_gridHeight);
                for (var y = 0; y < _gridHeight; y++) {
                    _grid[x][y] = TERRAIN_GRASS;
                }
            }

            // 2. Rivers
            _rivers = _generateRivers(rng, _grid);
            _bridges = _generateBridges(rng, _grid, _rivers);
            _buildRiverLookup();

            // 3. Scattered rocks (before deposits so deposits overwrite rocks)
            _scatterRocks(rng, _grid);

            // 4. Resource deposits
            _deposits = _generateDeposits(rng, _grid);
            _buildDepositLookup();

            // 5. Spawn points
            _spawnPoints = _generateSpawnPoints(rng);
        },

        getGrid: function() { return _grid; },

        getTerrain: function(gridX, gridY) {
            if (!_grid || gridX < 0 || gridX >= _gridWidth || gridY < 0 || gridY >= _gridHeight) {
                return -1;
            }
            return _grid[gridX][gridY];
        },

        setTerrain: function(gridX, gridY, type) {
            if (!_grid || gridX < 0 || gridX >= _gridWidth || gridY < 0 || gridY >= _gridHeight) {
                return;
            }
            _grid[gridX][gridY] = type;
        },

        getRivers: function() { return _rivers; },
        getBridges: function() { return _bridges; },
        getDeposits: function() { return _deposits; },
        getSpawnPoints: function() { return _spawnPoints; },
        getGridWidth: function() { return _gridWidth; },
        getGridHeight: function() { return _gridHeight; },

        getTerrainAt: function(gx, gy) {
            if (!_grid || gx < 0 || gx >= _gridWidth || gy < 0 || gy >= _gridHeight) return -1;
            return _grid[gx][gy];
        },

        worldToGrid: function(wx, wy) {
            var cellSz = _cellSize();
            return { x: Math.floor(wx / cellSz), y: Math.floor(wy / cellSz) };
        },

        gridToWorld: function(gx, gy) {
            var cellSz = _cellSize();
            return { x: gx * cellSz + cellSz / 2, y: gy * cellSz + cellSz / 2 };
        },

        isInBounds: function(gx, gy) {
            return gx >= 0 && gx < _gridWidth && gy >= 0 && gy < _gridHeight;
        },

        /**
         * Check if a building can be placed at (gx, gy).
         * @param {number} gx
         * @param {number} gy
         * @param {string} buildingType - Config key e.g. 'iron_miner', 'hydro_plant'
         * @returns {boolean}
         */
        isBuildable: function(gx, gy, buildingType) {
            if (!_grid || gx < 0 || gx >= _gridWidth || gy < 0 || gy >= _gridHeight) {
                return false;
            }
            var terrain = _grid[gx][gy];

            // Bridges are not buildable
            if (terrain === TERRAIN_BRIDGE) { return false; }

            // Deep water is never buildable
            if (terrain === TERRAIN_DEEP_WATER) { return false; }

            // Terrain-specific buildings
            if (buildingType === 'hydro_plant') {
                return terrain === TERRAIN_WATER;
            }
            if (buildingType === 'iron_miner' || buildingType === 'iron_miner_t2') {
                if (terrain !== TERRAIN_IRON_DEPOSIT) { return false; }
                var dep = this.getDepositAt(gx, gy);
                return dep && dep.remaining > 0;
            }
            if (buildingType === 'coal_miner' || buildingType === 'coal_miner_t2') {
                if (terrain !== TERRAIN_COAL_DEPOSIT) { return false; }
                var dep = this.getDepositAt(gx, gy);
                return dep && dep.remaining > 0;
            }
            if (buildingType === 'uranium_miner') {
                if (terrain !== TERRAIN_URANIUM_DEPOSIT) { return false; }
                var dep = this.getDepositAt(gx, gy);
                return dep && dep.remaining > 0;
            }
            if (buildingType === 'oil_drill' || buildingType === 'oil_drill_t2') {
                if (terrain !== TERRAIN_OIL_DEPOSIT) { return false; }
                var dep = this.getDepositAt(gx, gy);
                return dep && dep.remaining > 0;
            }

            // Water pylon can be built on water
            if (buildingType === 'water_pylon') {
                return terrain === TERRAIN_WATER;
            }

            // All other buildings: grass or rock only
            return terrain === TERRAIN_GRASS || terrain === TERRAIN_ROCK;
        },

        getRiverCurrentSpeed: function(gx, gy) {
            var key = gx + ',' + gy;
            var idx = _riverLookup[key];
            if (idx !== undefined && _rivers[idx]) {
                return _rivers[idx].currentSpeed;
            }
            return 0;
        },

        getFlowDirection: function(gx, gy) {
            var key = gx + ',' + gy;
            var idx = _riverLookup[key];
            if (idx !== undefined && _rivers[idx]) {
                return { dx: _rivers[idx].flowDirX || 0, dy: _rivers[idx].flowDirY || 0 };
            }
            return { dx: 0, dy: 0 };
        },

        /**
         * Get effective water speed at a tile, factoring in upstream hydro plant slowdown.
         * Hydro plants reduce speed downstream:
         *   tiles 1-4: 50% reduction
         *   tiles 5-8: 25% reduction
         *   tiles 9-12: 10% reduction
         */
        getEffectiveWaterSpeed: function(gx, gy) {
            var baseSpeed = 0;
            var key = gx + ',' + gy;
            var idx = _riverLookup[key];
            if (idx !== undefined && _rivers[idx]) {
                baseSpeed = _rivers[idx].currentSpeed;
            } else {
                return 0;
            }

            if (_hydroCacheDirty) _rebuildHydroCache();
            var totalReduction = _hydroSpeedCache[key] || 0;
            if (totalReduction > 0.90) totalReduction = 0.90;
            return baseSpeed * (1 - totalReduction);
        },

        invalidateHydroCache: function() {
            _hydroCacheDirty = true;
        },

        reduceCurrentSpeed: function(gx, gy, amount) {
            var minSpeed = (typeof Config !== 'undefined' && Config.MIN_CURRENT_SPEED != null)
                ? Config.MIN_CURRENT_SPEED : 0.05;
            var key = gx + ',' + gy;
            var idx = _riverLookup[key];
            if (idx !== undefined && _rivers[idx]) {
                _rivers[idx].currentSpeed = Math.max(minSpeed, _rivers[idx].currentSpeed - amount);
            }
        },

        getDepositAt: function(gx, gy) {
            var key = gx + ',' + gy;
            var idx = _depositLookup[key];
            if (idx !== undefined && _deposits[idx]) return _deposits[idx];
            return null;
        },

        depleteDeposit: function(gx, gy, amount) {
            var key = gx + ',' + gy;
            var idx = _depositLookup[key];
            if (idx !== undefined && _deposits[idx]) {
                _deposits[idx].remaining = Math.max(0, _deposits[idx].remaining - amount);
            }
        },

        // ---- save / load ----

        getSerializableState: function() {
            // Serialize deposits, river current speeds, and rock positions
            var depositData = [];
            for (var i = 0; i < _deposits.length; i++) {
                var d = _deposits[i];
                depositData.push({
                    gridX: d.gridX, gridY: d.gridY,
                    type: d.type, remaining: d.remaining, maxAmount: d.maxAmount
                });
            }
            var riverData = [];
            for (var i = 0; i < _rivers.length; i++) {
                var r = _rivers[i];
                riverData.push({
                    gridX: r.gridX, gridY: r.gridY,
                    currentSpeed: r.currentSpeed, riverId: r.riverId,
                    flowDirX: r.flowDirX || 0, flowDirY: r.flowDirY || 0,
                    distanceFromSource: r.distanceFromSource
                });
            }
            // Save rock cell positions
            var rocks = [];
            if (_grid) {
                for (var x = 0; x < _gridWidth; x++) {
                    for (var y = 0; y < _gridHeight; y++) {
                        if (_grid[x][y] === TERRAIN_ROCK) {
                            rocks.push({ x: x, y: y });
                        }
                    }
                }
            }
            return {
                gridWidth: _gridWidth,
                gridHeight: _gridHeight,
                deposits: depositData,
                rivers: riverData,
                rocks: rocks,
                bridges: _bridges.slice(),
                spawnPoints: _spawnPoints.slice()
            };
        },

        loadState: function(data) {
            if (!data) { return; }
            _gridWidth = data.gridWidth || 0;
            _gridHeight = data.gridHeight || 0;
            _spawnPoints = data.spawnPoints || [];

            // Rebuild grid from rivers + deposits
            _grid = new Array(_gridWidth);
            for (var x = 0; x < _gridWidth; x++) {
                _grid[x] = new Array(_gridHeight);
                for (var y = 0; y < _gridHeight; y++) {
                    _grid[x][y] = TERRAIN_GRASS;
                }
            }

            // Restore rocks
            if (data.rocks) {
                for (var ri = 0; ri < data.rocks.length; ri++) {
                    var rk = data.rocks[ri];
                    if (rk.x >= 0 && rk.x < _gridWidth && rk.y >= 0 && rk.y < _gridHeight) {
                        _grid[rk.x][rk.y] = TERRAIN_ROCK;
                    }
                }
            }

            // Restore rivers
            _rivers = data.rivers || [];
            _buildRiverLookup();
            for (var i = 0; i < _rivers.length; i++) {
                var r = _rivers[i];
                if (r.gridX >= 0 && r.gridX < _gridWidth && r.gridY >= 0 && r.gridY < _gridHeight) {
                    _grid[r.gridX][r.gridY] = TERRAIN_WATER;
                }
            }

            // Restore bridges
            _bridges = data.bridges || [];
            for (var i = 0; i < _bridges.length; i++) {
                var b = _bridges[i];
                if (b.gridX >= 0 && b.gridX < _gridWidth && b.gridY >= 0 && b.gridY < _gridHeight) {
                    _grid[b.gridX][b.gridY] = TERRAIN_BRIDGE;
                }
            }

            // Restore deposits
            _deposits = data.deposits || [];
            for (var i = 0; i < _deposits.length; i++) {
                var d = _deposits[i];
                if (d.gridX >= 0 && d.gridX < _gridWidth && d.gridY >= 0 && d.gridY < _gridHeight) {
                    if (d.type === 'iron') { _grid[d.gridX][d.gridY] = TERRAIN_IRON_DEPOSIT; }
                    else if (d.type === 'coal') { _grid[d.gridX][d.gridY] = TERRAIN_COAL_DEPOSIT; }
                    else if (d.type === 'uranium') { _grid[d.gridX][d.gridY] = TERRAIN_URANIUM_DEPOSIT; }
                    else if (d.type === 'oil') { _grid[d.gridX][d.gridY] = TERRAIN_OIL_DEPOSIT; }
                }
            }
            _buildDepositLookup();
        }
    };
})();

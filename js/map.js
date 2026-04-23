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
    // Deposit overlay types
    var TERRAIN_IRON_DEPOSIT = 10;
    var TERRAIN_COAL_DEPOSIT = 11;
    var TERRAIN_URANIUM_DEPOSIT = 12;

    // ---- private state ----
    var _grid = null;
    var _rivers = [];
    var _deposits = [];
    var _spawnPoints = [];
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

            // 3. Scattered rocks (before deposits so deposits overwrite rocks)
            _scatterRocks(rng, _grid);

            // 4. Resource deposits
            _deposits = _generateDeposits(rng, _grid);

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

            // All other buildings: grass or rock only
            return terrain === TERRAIN_GRASS || terrain === TERRAIN_ROCK;
        },

        getRiverCurrentSpeed: function(gx, gy) {
            for (var i = 0; i < _rivers.length; i++) {
                if (_rivers[i].gridX === gx && _rivers[i].gridY === gy) {
                    return _rivers[i].currentSpeed;
                }
            }
            return 0;
        },

        getFlowDirection: function(gx, gy) {
            for (var i = 0; i < _rivers.length; i++) {
                if (_rivers[i].gridX === gx && _rivers[i].gridY === gy) {
                    return { dx: _rivers[i].flowDirX || 0, dy: _rivers[i].flowDirY || 0 };
                }
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
            var riverId = -1;
            var flowDx = 0, flowDy = 0;
            for (var i = 0; i < _rivers.length; i++) {
                if (_rivers[i].gridX === gx && _rivers[i].gridY === gy) {
                    baseSpeed = _rivers[i].currentSpeed;
                    riverId = _rivers[i].riverId;
                    flowDx = _rivers[i].flowDirX || 0;
                    flowDy = _rivers[i].flowDirY || 0;
                    break;
                }
            }
            if (riverId < 0) return 0;

            // Check for upstream hydro plants that slow this tile
            if (typeof Buildings === 'undefined' || !Buildings.getAll) return baseSpeed;
            var allBuildings = Buildings.getAll();
            var totalReduction = 0;

            for (var b = 0; b < allBuildings.length; b++) {
                var bld = allBuildings[b];
                if (bld.type !== 'hydro_plant' || bld.hp <= 0) continue;
                if (!bld.active) continue;

                // Check if this hydro plant is upstream of (gx, gy) on the same river
                var bFlow = Map.getFlowDirection(bld.gridX, bld.gridY);
                if (bFlow.dx === 0 && bFlow.dy === 0) continue;

                // The hydro plant is upstream if (gx,gy) is in the flow direction from it
                var ddx = gx - bld.gridX;
                var ddy = gy - bld.gridY;

                // Must be in the flow direction
                var distInFlow = 0;
                if (bFlow.dx !== 0) {
                    if (bFlow.dx > 0 && ddx > 0 && ddx <= 12) {
                        // Check lateral offset is within river width
                        if (Math.abs(ddy) <= 2) distInFlow = ddx;
                    } else if (bFlow.dx < 0 && ddx < 0 && ddx >= -12) {
                        if (Math.abs(ddy) <= 2) distInFlow = -ddx;
                    }
                }
                if (bFlow.dy !== 0) {
                    if (bFlow.dy > 0 && ddy > 0 && ddy <= 12) {
                        if (Math.abs(ddx) <= 2) distInFlow = ddy;
                    } else if (bFlow.dy < 0 && ddy < 0 && ddy >= -12) {
                        if (Math.abs(ddx) <= 2) distInFlow = -ddy;
                    }
                }

                if (distInFlow >= 1 && distInFlow <= 4) {
                    totalReduction += 0.50;
                } else if (distInFlow >= 5 && distInFlow <= 8) {
                    totalReduction += 0.25;
                } else if (distInFlow >= 9 && distInFlow <= 12) {
                    totalReduction += 0.10;
                }
            }

            // Cap total reduction at 90%
            if (totalReduction > 0.90) totalReduction = 0.90;
            return baseSpeed * (1 - totalReduction);
        },

        reduceCurrentSpeed: function(gx, gy, amount) {
            var minSpeed = (typeof Config !== 'undefined' && Config.MIN_CURRENT_SPEED != null)
                ? Config.MIN_CURRENT_SPEED : 0.05;
            for (var i = 0; i < _rivers.length; i++) {
                if (_rivers[i].gridX === gx && _rivers[i].gridY === gy) {
                    _rivers[i].currentSpeed = Math.max(minSpeed, _rivers[i].currentSpeed - amount);
                    return;
                }
            }
        },

        getDepositAt: function(gx, gy) {
            for (var i = 0; i < _deposits.length; i++) {
                if (_deposits[i].gridX === gx && _deposits[i].gridY === gy) {
                    return _deposits[i];
                }
            }
            return null;
        },

        depleteDeposit: function(gx, gy, amount) {
            for (var i = 0; i < _deposits.length; i++) {
                if (_deposits[i].gridX === gx && _deposits[i].gridY === gy) {
                    _deposits[i].remaining = Math.max(0, _deposits[i].remaining - amount);
                    return;
                }
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
            for (var i = 0; i < _rivers.length; i++) {
                var r = _rivers[i];
                if (r.gridX >= 0 && r.gridX < _gridWidth && r.gridY >= 0 && r.gridY < _gridHeight) {
                    _grid[r.gridX][r.gridY] = TERRAIN_WATER;
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
                }
            }
        }
    };
})();

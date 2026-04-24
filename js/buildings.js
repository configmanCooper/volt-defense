// ============================================================================
// buildings.js — Building placement, cable management, upgrades, and removal
// ============================================================================
var Buildings = (function() {
    var _buildings = [];
    var _cables = [];
    var _nextId = 1;
    var _adjacencyDirty = true;
    var _adjacencyMap = {}; // buildingId -> [connectedBuildingIds]

    // Rebuild cable adjacency lookup
    function _rebuildAdjacency() {
        _adjacencyMap = {};
        var i, cable;
        for (i = 0; i < _cables.length; i++) {
            cable = _cables[i];
            if (!_adjacencyMap[cable.from]) _adjacencyMap[cable.from] = [];
            if (!_adjacencyMap[cable.to]) _adjacencyMap[cable.to] = [];
            _adjacencyMap[cable.from].push(cable.to);
            _adjacencyMap[cable.to].push(cable.from);
        }
        _adjacencyDirty = false;
    }

    function _getAdjacency() {
        if (_adjacencyDirty) _rebuildAdjacency();
        return _adjacencyMap;
    }

    function _getById(id) {
        for (var i = 0; i < _buildings.length; i++) {
            if (_buildings[i].id === id) return _buildings[i];
        }
        return null;
    }

    function _getDef(typeKey) {
        if (typeof Config !== 'undefined' && Config.BUILDINGS && Config.BUILDINGS[typeKey]) {
            return Config.BUILDINGS[typeKey];
        }
        return null;
    }

    function _getCellSize() {
        return (typeof Config !== 'undefined' && Config.GRID_CELL_SIZE) ? Config.GRID_CELL_SIZE : 40;
    }

    function _getBuildingCenter(building) {
        var def = _getDef(building.type);
        var cellSize = _getCellSize();
        var sizeX = (def && def.size) ? def.size[0] : 1;
        var sizeY = (def && def.size) ? def.size[1] : 1;
        return {
            x: building.worldX + (sizeX * cellSize) / 2,
            y: building.worldY + (sizeY * cellSize) / 2
        };
    }

    function _worldDistance(x1, y1, x2, y2) {
        var dx = x1 - x2;
        var dy = y1 - y2;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function _getDistance(b1, b2) {
        var c1 = _getBuildingCenter(b1);
        var c2 = _getBuildingCenter(b2);
        return _worldDistance(c1.x, c1.y, c2.x, c2.y);
    }

    // Get all cells a building occupies
    function _getOccupiedCells(gridX, gridY, typeKey) {
        var def = _getDef(typeKey);
        var sizeX = (def && def.size) ? def.size[0] : 1;
        var sizeY = (def && def.size) ? def.size[1] : 1;
        var cells = [];
        for (var dx = 0; dx < sizeX; dx++) {
            for (var dy = 0; dy < sizeY; dy++) {
                cells.push({ x: gridX + dx, y: gridY + dy });
            }
        }
        return cells;
    }

    function _cableCountForBuilding(buildingId) {
        var count = 0;
        for (var i = 0; i < _cables.length; i++) {
            if (_cables[i].from === buildingId || _cables[i].to === buildingId) {
                count++;
            }
        }
        return count;
    }

    function _canAfford(cost) {
        if (typeof Economy === 'undefined') return true;
        if (!cost) return true;
        for (var resource in cost) {
            if (cost.hasOwnProperty(resource)) {
                if (resource === 'money') {
                    if (typeof Economy.getMoney === 'function') {
                        if (Economy.getMoney() < cost[resource]) return false;
                    }
                } else if (typeof Economy.getResource === 'function') {
                    if (Economy.getResource(resource) < cost[resource]) return false;
                }
            }
        }
        return true;
    }

    function _deductCost(cost) {
        if (typeof Economy === 'undefined' || !cost) return;
        for (var resource in cost) {
            if (cost.hasOwnProperty(resource)) {
                if (resource === 'money' && typeof Economy.spendMoney === 'function') {
                    Economy.spendMoney(cost[resource]);
                } else if (typeof Economy.spendResource === 'function') {
                    Economy.spendResource(resource, cost[resource]);
                }
            }
        }
    }

    function _addRefund(cost, ratio) {
        if (typeof Economy === 'undefined' || !cost) return;
        for (var resource in cost) {
            if (cost.hasOwnProperty(resource)) {
                var amount = Math.floor(cost[resource] * ratio);
                if (typeof Economy.addResource === 'function') {
                    Economy.addResource(resource, amount);
                } else if (resource === 'money' && typeof Economy.addMoney === 'function') {
                    Economy.addMoney(amount);
                }
            }
        }
    }

    function _getRefundRatio() {
        if (typeof Config !== 'undefined' && Config.SELL_REFUND_RATIO !== undefined) {
            return Config.SELL_REFUND_RATIO;
        }
        return 0.5;
    }

    function _applyDifficultyToCost(cost) {
        if (typeof Engine !== 'undefined' && typeof Engine.applyDifficultyToCost === 'function') {
            return Engine.applyDifficultyToCost(cost);
        }
        return cost;
    }

    function _getAvailableWorkers() {
        if (typeof Workers !== 'undefined' && typeof Workers.getAvailableWorkers === 'function') {
            return Workers.getAvailableWorkers();
        }
        return Infinity;
    }

    return {
        // ================================================================
        // Placement
        // ================================================================
        canPlace: function(typeKey, gridX, gridY, skipPathCheck) {
            var def = _getDef(typeKey);
            if (!def) return { allowed: false, reason: 'Unknown building type.' };

            var cells = _getOccupiedCells(gridX, gridY, typeKey);
            var i, j;

            // Check terrain buildability for all occupied cells
            if (typeof Map !== 'undefined' && typeof Map.isBuildable === 'function') {
                for (i = 0; i < cells.length; i++) {
                    if (!Map.isBuildable(cells[i].x, cells[i].y, typeKey)) {
                        return { allowed: false, reason: 'Terrain is not buildable at (' + cells[i].x + ', ' + cells[i].y + ').' };
                    }
                }
            }

            // Check no overlap with existing buildings
            for (i = 0; i < _buildings.length; i++) {
                var existing = _buildings[i];
                var existingCells = _getOccupiedCells(existing.gridX, existing.gridY, existing.type);
                for (j = 0; j < existingCells.length; j++) {
                    for (var k = 0; k < cells.length; k++) {
                        if (existingCells[j].x === cells[k].x && existingCells[j].y === cells[k].y) {
                            return { allowed: false, reason: 'Overlaps with existing building.' };
                        }
                    }
                }
            }

            // Proximity check — at least one existing building within MAX_PLACEMENT_DISTANCE
            var maxDist = (typeof Config !== 'undefined' && Config.MAX_PLACEMENT_DISTANCE) ? Config.MAX_PLACEMENT_DISTANCE : 200;
            if (_buildings.length > 0) {
                var cellSize = _getCellSize();
                var sizeX = def.size ? def.size[0] : 1;
                var sizeY = def.size ? def.size[1] : 1;
                var newCenterX = gridX * cellSize + (sizeX * cellSize) / 2;
                var newCenterY = gridY * cellSize + (sizeY * cellSize) / 2;
                var inRange = false;
                for (i = 0; i < _buildings.length; i++) {
                    var bc = _getBuildingCenter(_buildings[i]);
                    if (_worldDistance(newCenterX, newCenterY, bc.x, bc.y) <= maxDist) {
                        inRange = true;
                        break;
                    }
                }
                if (!inRange) {
                    return { allowed: false, reason: 'Too far from existing buildings (max ' + maxDist + 'px).' };
                }
            }

            // Check cost
            var cost = _applyDifficultyToCost(def.cost);
            if (!_canAfford(cost)) {
                return { allowed: false, reason: 'Cannot afford this building.' };
            }

            // Check workers
            var workersNeeded = def.workersRequired || 0;
            if (workersNeeded > 0 && _getAvailableWorkers() < workersNeeded) {
                return { allowed: false, reason: 'Not enough available workers (need ' + workersNeeded + ').' };
            }

            // Check that placing this building doesn't block all enemy paths to core
            // Skip for core itself — destination IS the core
            // Skip when called for preview (skipPathCheck) to avoid lag
            if (!skipPathCheck && typeKey !== 'core' && typeof Enemies !== 'undefined' && Enemies.canReachCoreWith) {
                if (!Enemies.canReachCoreWith(cells)) {
                    return { allowed: false, reason: 'Would block all enemy paths to the core.' };
                }
            }

            return { allowed: true };
        },

        place: function(typeKey, gridX, gridY, forcePlace) {
            if (!forcePlace) {
                var check = this.canPlace(typeKey, gridX, gridY);
                if (!check.allowed) return null;
            }

            var def = _getDef(typeKey);
            if (!def) return null;

            var cost = _applyDifficultyToCost(def.cost);
            _deductCost(cost);

            var cellSize = _getCellSize();
            var building = {
                id: _nextId++,
                type: typeKey,
                gridX: gridX,
                gridY: gridY,
                worldX: gridX * cellSize,
                worldY: gridY * cellSize,
                hp: def.hp || 100,
                maxHp: def.hp || 100,
                energy: 0,
                active: false,
                // Weapon-specific
                target: null,
                laserRampTime: 0,
                reloadTimer: 0,
                // Shield-specific
                shieldHP: 0,
                shieldMaxHP: def.shieldHP || 0,
                shieldActive: false,
                // Mining-specific
                depositRef: null,
                // Consumer battery
                sellReady: false
            };

            // Link miner to deposit
            if (def.category === 'mining' || def.requiresTerrain) {
                if (typeof Map !== 'undefined' && typeof Map.getDepositAt === 'function') {
                    building.depositRef = Map.getDepositAt(gridX, gridY);
                }
            }

            // Hydro plant reduces river current
            if (typeKey === 'hydro_plant') {
                if (typeof Map !== 'undefined' && typeof Map.reduceCurrentSpeed === 'function') {
                    var hydroReduction = (typeof Config !== 'undefined' && Config.HYDRO_CURRENT_REDUCTION != null) ? Config.HYDRO_CURRENT_REDUCTION : 0.15;
                    Map.reduceCurrentSpeed(gridX, gridY, hydroReduction);
                }
            }

            _buildings.push(building);

            // Allocate workers
            var workersNeeded = def.workersRequired || 0;
            if (workersNeeded > 0 && typeof Workers !== 'undefined' && typeof Workers.allocateWorkers === 'function') {
                Workers.allocateWorkers(workersNeeded);
            }

            // Activate the building now that it is staffed
            building.active = true;

            return building;
        },

        remove: function(buildingId) {
            var building = _getById(buildingId);
            if (!building) return false;

            // Remove all cables connected to this building
            var i = _cables.length;
            while (i--) {
                if (_cables[i].from === buildingId || _cables[i].to === buildingId) {
                    _cables.splice(i, 1);
                }
            }
            _adjacencyDirty = true;

            // Free workers
            var def = _getDef(building.type);
            var workersToFree = (def && def.workersRequired) ? def.workersRequired : 0;
            if (workersToFree > 0 && typeof Workers !== 'undefined' && typeof Workers.freeWorkers === 'function') {
                Workers.freeWorkers(workersToFree);
            }

            // Refund
            if (def && def.cost) {
                _addRefund(def.cost, _getRefundRatio());
            }

            // Remove from array
            for (i = 0; i < _buildings.length; i++) {
                if (_buildings[i].id === buildingId) {
                    _buildings.splice(i, 1);
                    break;
                }
            }

            return true;
        },

        upgrade: function(buildingId) {
            var building = _getById(buildingId);
            if (!building) return false;

            var currentDef = _getDef(building.type);
            if (!currentDef || !currentDef.upgradeTo) return false;

            var nextType = currentDef.upgradeTo;
            var nextDef = _getDef(nextType);
            if (!nextDef) return false;

            // Calculate upgrade cost: nextDef.cost - currentDef.cost * SELL_REFUND_RATIO
            var refundRatio = _getRefundRatio();
            var upgradeCost = {};
            var nextCost = _applyDifficultyToCost(nextDef.cost) || {};
            var currentCost = _applyDifficultyToCost(currentDef.cost) || {};
            for (var resource in nextCost) {
                if (nextCost.hasOwnProperty(resource)) {
                    var credit = currentCost[resource] ? Math.floor(currentCost[resource] * refundRatio) : 0;
                    var net = nextCost[resource] - credit;
                    if (net > 0) upgradeCost[resource] = net;
                }
            }

            // Check player can afford upgrade
            if (!_canAfford(upgradeCost)) return false;

            // Check additional workers
            var extraWorkers = (nextDef.workersRequired || 0) - (currentDef.workersRequired || 0);
            if (extraWorkers > 0 && _getAvailableWorkers() < extraWorkers) return false;

            // Deduct upgrade cost
            _deductCost(upgradeCost);

            // Allocate additional workers
            if (extraWorkers > 0 && typeof Workers !== 'undefined' && typeof Workers.allocateWorkers === 'function') {
                Workers.allocateWorkers(extraWorkers);
            }

            // Update building — preserve id, position, cables
            building.type = nextType;
            building.hp = nextDef.hp || building.hp;
            building.maxHp = nextDef.hp || building.maxHp;
            building.shieldMaxHP = nextDef.shieldHP || 0;
            if (building.shieldHP > building.shieldMaxHP) {
                building.shieldHP = building.shieldMaxHP;
            }

            // Cap energy to new storage capacity
            var newCapacity = nextDef.energyStorageCapacity || 0;
            if (building.energy > newCapacity) {
                building.energy = newCapacity;
            }

            return true;
        },

        // ================================================================
        // Cable Management
        // ================================================================
        canAddCable: function(fromId, toId, cableType) {
            if (fromId === toId) return { success: false, reason: 'Cannot cable a building to itself.' };
            if (!cableType) cableType = 'standard';

            var fromBuilding = _getById(fromId);
            var toBuilding = _getById(toId);
            if (!fromBuilding) return { success: false, reason: 'Source building not found.' };
            if (!toBuilding) return { success: false, reason: 'Target building not found.' };

            // Check distance
            var maxLength = (typeof Config !== 'undefined' && Config.CABLE_MAX_LENGTH) ? Config.CABLE_MAX_LENGTH : 200;
            var dist = _getDistance(fromBuilding, toBuilding);
            if (dist > maxLength) {
                return { success: false, reason: 'Buildings too far apart (max ' + maxLength + 'px).' };
            }

            // Check cable limits
            var maxPerBuilding = (typeof Config !== 'undefined' && Config.CABLE_MAX_PER_BUILDING) ? Config.CABLE_MAX_PER_BUILDING : 4;
            if (_cableCountForBuilding(fromId) >= maxPerBuilding) {
                return { success: false, reason: 'Source building has maximum cables (' + maxPerBuilding + ').' };
            }
            if (_cableCountForBuilding(toId) >= maxPerBuilding) {
                return { success: false, reason: 'Target building has maximum cables (' + maxPerBuilding + ').' };
            }

            // Check for duplicate
            for (var i = 0; i < _cables.length; i++) {
                var c = _cables[i];
                if ((c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)) {
                    return { success: false, reason: 'Cable already exists between these buildings.' };
                }
            }

            // Check cost
            var cableCost;
            if (cableType === 'high_capacity') {
                var costPerTile = (typeof Config !== 'undefined' && Config.HC_CABLE_COST_PER_TILE) ? Config.HC_CABLE_COST_PER_TILE : 50;
                var cellSize = _getCellSize();
                var tiles = Math.max(1, Math.round(dist / cellSize));
                cableCost = costPerTile * tiles;
            } else {
                cableCost = (typeof Config !== 'undefined' && Config.CABLE_COST) ? Config.CABLE_COST : 25;
            }
            if (!_canAfford({ money: cableCost })) {
                return { success: false, reason: 'Cannot afford cable ($' + cableCost + ').' };
            }

            return { success: true, cost: cableCost };
        },

        addCable: function(fromId, toId, cableType) {
            if (!cableType) cableType = 'standard';
            var check = this.canAddCable(fromId, toId, cableType);
            if (!check.success) return check;

            _deductCost({ money: check.cost || 0 });

            _cables.push({ from: fromId, to: toId, type: cableType });
            _adjacencyDirty = true;

            return { success: true };
        },

        removeCable: function(fromId, toId) {
            for (var i = 0; i < _cables.length; i++) {
                var c = _cables[i];
                if ((c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)) {
                    _cables.splice(i, 1);
                    _adjacencyDirty = true;
                    return true;
                }
            }
            return false;
        },

        getCablesForBuilding: function(buildingId) {
            var result = [];
            for (var i = 0; i < _cables.length; i++) {
                if (_cables[i].from === buildingId || _cables[i].to === buildingId) {
                    result.push(_cables[i]);
                }
            }
            return result;
        },

        getCableBetween: function(fromId, toId) {
            for (var i = 0; i < _cables.length; i++) {
                var c = _cables[i];
                if ((c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)) {
                    return c;
                }
            }
            return null;
        },

        getConnectedBuildings: function(buildingId) {
            var adj = _getAdjacency();
            var ids = adj[buildingId] || [];
            var result = [];
            for (var i = 0; i < ids.length; i++) {
                var b = _getById(ids[i]);
                if (b) result.push(b);
            }
            return result;
        },

        // ================================================================
        // Queries
        // ================================================================
        getAll: function() {
            return _buildings;
        },

        getById: function(id) {
            return _getById(id);
        },

        getAt: function(gridX, gridY) {
            for (var i = 0; i < _buildings.length; i++) {
                var b = _buildings[i];
                var def = _getDef(b.type);
                var sizeX = (def && def.size) ? def.size[0] : 1;
                var sizeY = (def && def.size) ? def.size[1] : 1;
                if (gridX >= b.gridX && gridX < b.gridX + sizeX &&
                    gridY >= b.gridY && gridY < b.gridY + sizeY) {
                    return b;
                }
            }
            return null;
        },

        getInRange: function(worldX, worldY, range) {
            var result = [];
            for (var i = 0; i < _buildings.length; i++) {
                var center = _getBuildingCenter(_buildings[i]);
                if (_worldDistance(worldX, worldY, center.x, center.y) <= range) {
                    result.push(_buildings[i]);
                }
            }
            return result;
        },

        getByType: function(typeKey) {
            var result = [];
            for (var i = 0; i < _buildings.length; i++) {
                if (_buildings[i].type === typeKey) result.push(_buildings[i]);
            }
            return result;
        },

        getByCategory: function(category) {
            var result = [];
            for (var i = 0; i < _buildings.length; i++) {
                var def = _getDef(_buildings[i].type);
                if (def && def.category === category) result.push(_buildings[i]);
            }
            return result;
        },

        getCore: function() {
            for (var i = 0; i < _buildings.length; i++) {
                if (_buildings[i].type === 'core') return _buildings[i];
            }
            return null;
        },

        getCables: function() {
            return _cables;
        },

        getCount: function() {
            return _buildings.length;
        },

        // ================================================================
        // Utility
        // ================================================================
        getBuildingCenter: function(building) {
            return _getBuildingCenter(building);
        },

        getDistance: function(b1, b2) {
            return _getDistance(b1, b2);
        },

        worldDistance: function(x1, y1, x2, y2) {
            return _worldDistance(x1, y1, x2, y2);
        },

        isConnectedToGrid: function(buildingId) {
            var core = this.getCore();
            if (!core) return false;
            if (buildingId === core.id) return true;

            var adj = _getAdjacency();
            var visited = {};
            var queue = [buildingId];
            visited[buildingId] = true;

            while (queue.length > 0) {
                var currentId = queue.shift();
                var neighbors = adj[currentId] || [];
                for (var i = 0; i < neighbors.length; i++) {
                    var nId = neighbors[i];
                    if (nId === core.id) return true;
                    if (!visited[nId]) {
                        visited[nId] = true;
                        queue.push(nId);
                    }
                }
            }
            return false;
        },

        // Expose adjacency map for Energy module efficiency
        getAdjacencyMap: function() {
            return _getAdjacency();
        },

        // ================================================================
        // Save/Load
        // ================================================================
        getSerializableState: function() {
            var buildingData = [];
            for (var i = 0; i < _buildings.length; i++) {
                var b = _buildings[i];
                buildingData.push({
                    id: b.id,
                    type: b.type,
                    gridX: b.gridX,
                    gridY: b.gridY,
                    hp: b.hp,
                    maxHp: b.maxHp,
                    energy: b.energy,
                    active: b.active,
                    target: null,
                    laserRampTime: b.laserRampTime,
                    reloadTimer: b.reloadTimer,
                    shieldHP: b.shieldHP,
                    shieldMaxHP: b.shieldMaxHP,
                    shieldActive: b.shieldActive,
                    sellReady: b.sellReady
                });
            }
            var cableData = [];
            for (var j = 0; j < _cables.length; j++) {
                cableData.push({ from: _cables[j].from, to: _cables[j].to, type: _cables[j].type || 'standard' });
            }
            return {
                buildings: buildingData,
                cables: cableData,
                nextId: _nextId
            };
        },

        loadState: function(data) {
            if (!data) return;

            _buildings = [];
            _cables = [];
            _adjacencyDirty = true;

            if (data.nextId) _nextId = data.nextId;

            var cellSize = _getCellSize();
            var i;

            if (data.buildings && data.buildings.length) {
                for (i = 0; i < data.buildings.length; i++) {
                    var saved = data.buildings[i];
                    var def = _getDef(saved.type);
                    var building = {
                        id: saved.id,
                        type: saved.type,
                        gridX: saved.gridX,
                        gridY: saved.gridY,
                        worldX: saved.gridX * cellSize,
                        worldY: saved.gridY * cellSize,
                        hp: saved.hp,
                        maxHp: saved.maxHp,
                        energy: saved.energy || 0,
                        active: saved.active || false,
                        target: null,
                        laserRampTime: saved.laserRampTime || 0,
                        reloadTimer: saved.reloadTimer || 0,
                        shieldHP: saved.shieldHP || 0,
                        shieldMaxHP: saved.shieldMaxHP || (def && def.shieldHP ? def.shieldHP : 0),
                        shieldActive: saved.shieldActive || false,
                        depositRef: null,
                        sellReady: saved.sellReady || false
                    };

                    // Re-link miner deposits
                    if (def && (def.category === 'mining' || def.requiresTerrain)) {
                        if (typeof Map !== 'undefined' && typeof Map.getDepositAt === 'function') {
                            building.depositRef = Map.getDepositAt(saved.gridX, saved.gridY);
                        }
                    }

                    _buildings.push(building);
                }
            }

            if (data.cables && data.cables.length) {
                for (i = 0; i < data.cables.length; i++) {
                    _cables.push({ from: data.cables[i].from, to: data.cables[i].to, type: data.cables[i].type || 'standard' });
                }
            }
        }
    };
})();

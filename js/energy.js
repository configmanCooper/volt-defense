// ============================================================================
// energy.js — Energy grid simulation: generation, distribution, consumption
// ============================================================================
var Energy = (function() {
    var _stats = {
        totalGeneration: 0,
        totalConsumption: 0,
        totalStored: 0,
        totalCapacity: 0
    };

    // Energy priority order — lower number = higher priority
    var PRIORITY_SHIELDS_ACTIVE = 1;
    var PRIORITY_WEAPONS = 2;
    var PRIORITY_MINERS = 3;
    var PRIORITY_HOUSING = 4;
    var PRIORITY_CARBON = 5;
    var PRIORITY_BATTERIES = 6;
    var PRIORITY_CONSUMER = 7;

    var _tickCounter = 0;

    // Day/Night cycle state
    var _isDay = true;
    var _dayNightTimer = 0;   // seconds into current phase (day or night)

    // Wind speed state
    var _windSpeed = 15;       // current wind speed in mph
    var _windTimer = 0;        // seconds until next wind change

    // Set of building IDs that transferred energy this tick (for cable glow)
    var _activeFlowNodes = {};

    // Actual energy flow per cable per second (accumulated over ticks, reset each second)
    var _cableFlowThisTick = {};   // "fromId-toId" -> amount this tick
    var _cableFlowDisplay = {};    // "fromId-toId" -> { amount, direction } shown to render
    var _flowAccumulator = {};     // accumulates over tps ticks
    var _flowTickCount = 0;

    function _getTicksPerSecond() {
        return (typeof Config !== 'undefined' && Config.TICKS_PER_SECOND) ? Config.TICKS_PER_SECOND : 10;
    }

    function _getDef(typeKey) {
        if (typeof Config !== 'undefined' && Config.BUILDINGS && Config.BUILDINGS[typeKey]) {
            return Config.BUILDINGS[typeKey];
        }
        return null;
    }

    function _getCableMaxThroughput() {
        return (typeof Config !== 'undefined' && Config.CABLE_MAX_THROUGHPUT) ? Config.CABLE_MAX_THROUGHPUT : 50;
    }

    function _getHCCableMaxThroughput() {
        return (typeof Config !== 'undefined' && Config.HC_CABLE_MAX_THROUGHPUT) ? Config.HC_CABLE_MAX_THROUGHPUT : 500;
    }

    function _getCableThroughput(fromId, toId) {
        if (typeof Buildings !== 'undefined' && Buildings.getCableBetween) {
            var cable = Buildings.getCableBetween(fromId, toId);
            if (cable && cable.type === 'high_capacity') {
                return _getHCCableMaxThroughput();
            }
        }
        return _getCableMaxThroughput();
    }

    function _getEnergyPriority(building) {
        var def = _getDef(building.type);
        if (!def) return PRIORITY_BATTERIES;
        var cat = def.category;

        // Active shields get top priority
        if (cat === 'defense' && building.shieldActive) return PRIORITY_SHIELDS_ACTIVE;
        if (cat === 'defense') return PRIORITY_SHIELDS_ACTIVE;
        if (cat === 'weapons') return PRIORITY_WEAPONS;
        if (cat === 'mining') return PRIORITY_MINERS;
        if (cat === 'housing') return PRIORITY_HOUSING;
        if (cat === 'environment') return PRIORITY_CARBON;
        if (cat === 'storage') {
            // Consumer batteries get lowest priority
            if (def.maxDischargeRate === 0 && def.sellPrice) return PRIORITY_CONSUMER;
            return PRIORITY_BATTERIES;
        }
        return PRIORITY_BATTERIES;
    }

    function _applyDifficultyToEnergy(consumption) {
        if (typeof Engine !== 'undefined' && typeof Engine.applyDifficultyToEnergy === 'function') {
            return Engine.applyDifficultyToEnergy(consumption);
        }
        return consumption;
    }

    function _getEnergyPenalty() {
        if (typeof Engine !== 'undefined' && typeof Engine.getEnergyPenalty === 'function') {
            return Engine.getEnergyPenalty();
        }
        return 0;
    }

    // Simple seeded-compatible random using Math.random as fallback
    function _rngRandom() {
        if (typeof Engine !== 'undefined' && typeof Engine.getRng === 'function') {
            var rng = Engine.getRng();
            if (rng && typeof rng.random === 'function') return rng.random();
        }
        return Math.random();
    }

    function _addPollution(amount) {
        if (typeof Engine !== 'undefined' && typeof Engine.addPollution === 'function') {
            Engine.addPollution(amount);
        }
    }

    function _hasFuel(fuelCost) {
        if (typeof Economy === 'undefined') return true;
        if (!fuelCost) return true;
        for (var resource in fuelCost) {
            if (fuelCost.hasOwnProperty(resource)) {
                if (typeof Economy.getResource === 'function') {
                    if (Economy.getResource(resource) < fuelCost[resource]) return false;
                }
            }
        }
        return true;
    }

    function _deductFuel(fuelCost) {
        if (typeof Economy === 'undefined' || !fuelCost) return;
        for (var resource in fuelCost) {
            if (fuelCost.hasOwnProperty(resource)) {
                if (typeof Economy.spendResource === 'function') {
                    Economy.spendResource(resource, fuelCost[resource]);
                }
            }
        }
    }

    function _getRiverCurrentSpeed(gridX, gridY) {
        if (typeof Map !== 'undefined' && typeof Map.getRiverCurrentSpeed === 'function') {
            return Map.getRiverCurrentSpeed(gridX, gridY);
        }
        return 1.0;
    }

    function _sellConsumerBattery(building) {
        var def = _getDef(building.type);
        if (!def || !def.sellPrice) return;
        var sellPrice = def.sellPrice;
        if (typeof Config !== 'undefined' && Config.CONSUMER_BATTERY_SELL_PRICE) {
            sellPrice = Config.CONSUMER_BATTERY_SELL_PRICE;
        }
        if (typeof Economy !== 'undefined' && typeof Economy.addMoney === 'function') {
            Economy.addMoney(sellPrice);
        }
        building.energy = 0;
        building.sellReady = false;
    }

    // Determine fuel cost interval from building definition
    function _getFuelCostInterval(def) {
        if (def.fuelCostInterval) return def.fuelCostInterval;
        if (def.fuelInterval) return def.fuelInterval;
        return 10; // default: every 1 second (10 ticks)
    }

    return {
        // ================================================================
        // Main Simulation Tick
        // ================================================================
        tick: function() {
            if (typeof Buildings === 'undefined') return;

            var allBuildings = Buildings.getAll();
            if (!allBuildings || allBuildings.length === 0) return;

            var tps = _getTicksPerSecond();
            var cableMaxThroughput = _getCableMaxThroughput();
            var i, building, def;

            _tickCounter++;

            // ============================================================
            // Day/Night cycle update
            // ============================================================
            var halfCycle = (typeof Config !== 'undefined' && Config.DAY_NIGHT_CYCLE)
                ? Config.DAY_NIGHT_CYCLE / 2 : 12;
            _dayNightTimer += 1 / tps;
            if (_dayNightTimer >= halfCycle) {
                _dayNightTimer -= halfCycle;
                _isDay = !_isDay;
            }

            // ============================================================
            // Wind speed update
            // ============================================================
            var windInterval = (typeof Config !== 'undefined' && Config.WIND_CHANGE_INTERVAL)
                ? Config.WIND_CHANGE_INTERVAL : 24;
            _windTimer += 1 / tps;
            if (_windTimer >= windInterval) {
                _windTimer -= windInterval;
                var maxWind = (typeof Config !== 'undefined' && Config.WIND_MAX_SPEED) ? Config.WIND_MAX_SPEED : 30;
                _windSpeed = Math.floor(_rngRandom() * (maxWind + 1));
            }

            // ============================================================
            // Step 1: Generation
            // ============================================================
            var generators = [];
            var totalGeneration = 0;

            for (i = 0; i < allBuildings.length; i++) {
                building = allBuildings[i];
                def = _getDef(building.type);
                if (!def || !def.energyGeneration || def.energyGeneration <= 0) continue;
                if (building.hp <= 0) continue;
                if (!building.active && building.type !== 'core') {
                    // Generators activate if they have workers (checked externally)
                    // Still allow generation if active flag not yet set but HP > 0
                    // Workers module sets active based on staffing; we respect it here
                    // For generators, active means staffed — skip if not active
                    continue;
                }

                var genPerTick = def.energyGeneration / tps;
                var actualGen = genPerTick;

                // Solar — only generates during daytime
                if (building.type === 'solar') {
                    if (!_isDay) {
                        continue; // no generation at night
                    }
                }

                // Wind — scale by current wind speed (0 at 0mph, 1x at 15mph, 2x at 30mph)
                if (building.type === 'wind') {
                    var baseline = (typeof Config !== 'undefined' && Config.WIND_BASELINE_SPEED)
                        ? Config.WIND_BASELINE_SPEED : 15;
                    var windMult = _windSpeed / baseline;
                    actualGen = genPerTick * windMult;
                }

                // Hydro — scale by effective water speed (15 mph = rated output)
                if (building.type === 'hydro_plant') {
                    var effectiveSpeed = 15;
                    if (typeof Map !== 'undefined' && typeof Map.getEffectiveWaterSpeed === 'function') {
                        effectiveSpeed = Map.getEffectiveWaterSpeed(building.gridX, building.gridY);
                    }
                    actualGen = genPerTick * (effectiveSpeed / 15);
                }

                // Fuel-burning plants: check and deduct fuel
                if (def.fuelCost) {
                    var interval = _getFuelCostInterval(def);
                    if (_tickCounter % interval === 0) {
                        if (!_hasFuel(def.fuelCost)) {
                            // No fuel — don't generate
                            continue;
                        }
                        _deductFuel(def.fuelCost);
                    } else {
                        // Between fuel intervals — check if we had fuel last check
                        if (!_hasFuel(def.fuelCost)) continue;
                    }
                }

                // Pollution from coal/gas plants
                if (def.pollution && def.pollution > 0) {
                    _addPollution(def.pollution);
                }

                // Add energy to building's buffer (generators get a small buffer for distribution)
                var capacity = def.energyStorageCapacity || actualGen * 2;
                building.energy = Math.min(building.energy + actualGen, capacity);
                totalGeneration += actualGen;

                if (building.energy > 0) {
                    generators.push(building);
                }
            }

            // Also include batteries/capacitors with stored energy as energy sources
            for (i = 0; i < allBuildings.length; i++) {
                building = allBuildings[i];
                def = _getDef(building.type);
                if (!def || !building.active || building.hp <= 0) continue;
                if (def.energyGeneration > 0) continue; // already in generators
                if (def.category !== 'storage') continue;
                if (def.maxDischargeRate === 0) continue; // consumer batteries can't discharge
                if (building.energy > 0) {
                    generators.push(building);
                }
            }

            // ============================================================
            // Step 2: Distribution via BFS from generators
            // ============================================================
            var adjacency = (typeof Buildings.getAdjacencyMap === 'function')
                ? Buildings.getAdjacencyMap() : {};

            // Cache cable throughputs for this tick
            var _cableThroughputCache = {};
            function _cachedCableThroughput(fromId, toId) {
                var key = fromId < toId ? fromId + '-' + toId : toId + '-' + fromId;
                if (_cableThroughputCache[key] !== undefined) return _cableThroughputCache[key];
                var tp = _getCableThroughput(fromId, toId);
                _cableThroughputCache[key] = tp;
                return tp;
            }

            // Collect all consumers sorted by priority
            var consumers = [];
            for (i = 0; i < allBuildings.length; i++) {
                building = allBuildings[i];
                def = _getDef(building.type);
                if (!def) continue;
                // Buildings that consume or store energy
                if ((def.energyConsumption && def.energyConsumption > 0) ||
                    (def.maxChargeRate && def.maxChargeRate > 0 && def.energyGeneration === 0)) {
                    consumers.push(building);
                }
            }

            // Pre-compute priorities for faster sorting
            var _priorityMap = {};
            for (i = 0; i < allBuildings.length; i++) {
                _priorityMap[allBuildings[i].id] = _getEnergyPriority(allBuildings[i]);
            }

            // Sort consumers by priority
            consumers.sort(function(a, b) {
                return _priorityMap[a.id] - _priorityMap[b.id];
            });

            // Track energy transferred through each cable this tick
            var cableFlow = {};
            _activeFlowNodes = {};
            _cableFlowThisTick = {};

            // Track total charge received per building this tick (across all generators)
            var _chargedThisTick = {};

            // For each generator, BFS to distribute energy
            for (var g = 0; g < generators.length; g++) {
                var gen = generators[g];
                if (gen.energy <= 0) continue;

                var genDef = _getDef(gen.type);
                // Generators have unlimited discharge; batteries use maxDischargeRate
                var maxDischarge = (genDef && genDef.energyGeneration > 0)
                    ? Infinity
                    : (genDef ? (genDef.maxDischargeRate || Infinity) / tps : Infinity);
                var totalDischarged = 0;

                // BFS to find reachable consumers ordered by priority
                var visited = {};
                var queue = [gen.id];
                visited[gen.id] = true;
                var reachable = [];
                var minThroughputMap = {}; // buildingId -> min cable throughput along path
                var pylonPriorityMap = {}; // buildingId -> max (worst) pylon cable priority along path
                var parentMap = {};        // buildingId -> parent buildingId for path reconstruction
                minThroughputMap[gen.id] = Infinity;
                pylonPriorityMap[gen.id] = 1;

                while (queue.length > 0) {
                    var currentId = queue.shift();
                    var currentMinTP = minThroughputMap[currentId] || Infinity;
                    var currentPylonPri = pylonPriorityMap[currentId] || 1;
                    var neighbors = adjacency[currentId] || [];

                    // Check if current node is a pylon with priorities
                    var currentBuilding = Buildings.getById(currentId);
                    var isPylon = (currentBuilding && (currentBuilding.type === 'pylon' || currentBuilding.type === 'hc_pylon'));

                    for (var n = 0; n < neighbors.length; n++) {
                        var nId = neighbors[n];
                        if (visited[nId]) continue;
                        visited[nId] = true;

                        var nBuilding = Buildings.getById(nId);
                        if (!nBuilding || nBuilding.hp <= 0) continue;

                        var nDef = _getDef(nBuilding.type);
                        if (!nDef) continue;

                        // Check cable flow rules
                        if (currentBuilding && currentBuilding.cableRules && currentBuilding.cableRules[nId] === 'charge') {
                            continue;
                        }
                        if (nBuilding.cableRules && nBuilding.cableRules[currentId] === 'discharge') {
                            continue;
                        }

                        // Track min throughput along path
                        var cableTP = _cachedCableThroughput(currentId, nId) / tps;
                        minThroughputMap[nId] = Math.min(currentMinTP, cableTP);
                        parentMap[nId] = currentId;

                        // Track worst pylon priority along path
                        var edgePri = currentPylonPri;
                        if (isPylon && currentBuilding.cablePriorities && currentBuilding.cablePriorities[nId]) {
                            edgePri = Math.max(edgePri, currentBuilding.cablePriorities[nId]);
                        }
                        pylonPriorityMap[nId] = edgePri;

                        // Check if this building needs/accepts energy
                        var nCapacity = nDef.energyStorageCapacity || 0;
                        var remaining = nCapacity - nBuilding.energy;
                        if (remaining > 0) {
                            reachable.push(nBuilding);
                        }

                        // Continue BFS through non-storage nodes that have energy.
                        // Storage buildings (batteries/capacitors) are endpoints only:
                        // they receive energy (charge) or send energy (discharge) but
                        // don't allow pass-through, acting as proper bottlenecks.
                        if (nDef.category !== 'storage') {
                            if (nBuilding.energy > 0 || nCapacity <= 0) {
                                queue.push(nId);
                            }
                        }
                    }
                }

                // Sort reachable by pylon priority first, then by type priority
                reachable.sort(function(a, b) {
                    var priA = pylonPriorityMap[a.id] || 1;
                    var priB = pylonPriorityMap[b.id] || 1;
                    if (priA !== priB) return priA - priB;
                    return _priorityMap[a.id] - _priorityMap[b.id];
                });

                // Distribute energy to reachable buildings, splitting equally among same-priority groups
                var r = 0;
                while (r < reachable.length) {
                    if (gen.energy <= 0 || totalDischarged >= maxDischarge) break;

                    // Find the group of consumers with the same priority
                    var groupPylonPri = pylonPriorityMap[reachable[r].id] || 1;
                    var groupTypePri = _priorityMap[reachable[r].id];
                    var groupStart = r;
                    while (r < reachable.length) {
                        var rPylonPri = pylonPriorityMap[reachable[r].id] || 1;
                        var rTypePri = _priorityMap[reachable[r].id];
                        if (rPylonPri !== groupPylonPri || rTypePri !== groupTypePri) break;
                        r++;
                    }
                    var groupEnd = r; // exclusive

                    // Collect group members that still need energy
                    var groupMembers = [];
                    for (var gi = groupStart; gi < groupEnd; gi++) {
                        var grp = reachable[gi];
                        var grpDef = _getDef(grp.type);
                        if (!grpDef) continue;
                        var grpCapacity = grpDef.energyStorageCapacity || 0;
                        var grpRemaining = grpCapacity - grp.energy;
                        if (grpRemaining <= 0) continue;
                        var grpChargeRate = (grpDef.maxChargeRate || 0) / tps;
                        var grpPathTP = minThroughputMap[grp.id] || (cableMaxThroughput / tps);
                        var grpMax = grpRemaining;
                        grpMax = Math.min(grpMax, grpPathTP);
                        if (grpChargeRate > 0) {
                            var alreadyCharged = _chargedThisTick[grp.id] || 0;
                            grpMax = Math.min(grpMax, grpChargeRate - alreadyCharged);
                        }
                        if (grpMax > 0) {
                            groupMembers.push({ building: grp, maxAccept: grpMax });
                        }
                    }

                    if (groupMembers.length === 0) continue;

                    // Distribute equally among group, respecting each member's max
                    var budgetLeft = Math.min(gen.energy, maxDischarge - totalDischarged);
                    var remaining = groupMembers.length;
                    // Multi-pass: if some members hit their cap, redistribute remainder
                    var allocated = [];
                    for (gi = 0; gi < groupMembers.length; gi++) allocated[gi] = 0;
                    while (budgetLeft > 0.0001 && remaining > 0) {
                        var share = budgetLeft / remaining;
                        var anyLimited = false;
                        remaining = 0;
                        for (gi = 0; gi < groupMembers.length; gi++) {
                            if (allocated[gi] < 0) continue; // already finalized
                            var canTake = groupMembers[gi].maxAccept - allocated[gi];
                            if (canTake <= 0) { allocated[gi] = -allocated[gi] || -0.0001; continue; }
                            if (share >= canTake) {
                                allocated[gi] += canTake;
                                budgetLeft -= canTake;
                                allocated[gi] = -allocated[gi]; // mark finalized (negative)
                                anyLimited = true;
                            } else {
                                allocated[gi] += share;
                                budgetLeft -= share;
                                remaining++;
                            }
                        }
                        if (!anyLimited) break;
                    }

                    // Apply transfers
                    for (gi = 0; gi < groupMembers.length; gi++) {
                        var transferable = Math.abs(allocated[gi]);
                        if (transferable <= 0.0001) continue;
                        var receiver = groupMembers[gi].building;

                        gen.energy -= transferable;
                        receiver.energy += transferable;
                        totalDischarged += transferable;
                        _chargedThisTick[receiver.id] = (_chargedThisTick[receiver.id] || 0) + transferable;
                        _activeFlowNodes[gen.id] = true;
                        _activeFlowNodes[receiver.id] = true;

                        // Record flow along the path for cable flow labels
                        var pathNode = receiver.id;
                        while (parentMap[pathNode] !== undefined) {
                            var parentNode = parentMap[pathNode];
                            var flowKey = parentNode < pathNode ? parentNode + '-' + pathNode : pathNode + '-' + parentNode;
                            var flowDir = parentNode < pathNode ? 1 : -1;
                            if (!_cableFlowThisTick[flowKey]) _cableFlowThisTick[flowKey] = 0;
                            _cableFlowThisTick[flowKey] += transferable * flowDir;
                            pathNode = parentNode;
                        }
                    }
                }
            }

            // Accumulate cable flow data and update display each second
            _flowTickCount++;
            var key;
            for (key in _cableFlowThisTick) {
                if (!_flowAccumulator[key]) _flowAccumulator[key] = 0;
                _flowAccumulator[key] += _cableFlowThisTick[key];
            }
            if (_flowTickCount >= tps) {
                _cableFlowDisplay = {};
                for (key in _flowAccumulator) {
                    var amt = _flowAccumulator[key];
                    if (Math.abs(amt) > 0.01) {
                        _cableFlowDisplay[key] = Math.round(amt);
                    }
                }
                _flowAccumulator = {};
                _flowTickCount = 0;
            }

            // ============================================================
            // (Rounding moved to after Step 3)

            // ============================================================
            // Step 3: Consumption + Carbon Collection + Stats (consolidated)
            // ============================================================
            var totalConsumption = 0;
            var totalStored = 0;
            var totalCapacity = 0;

            for (i = 0; i < allBuildings.length; i++) {
                building = allBuildings[i];
                def = _getDef(building.type);
                if (!def) continue;

                // Stats accumulation (was Step 4)
                totalStored += building.energy || 0;
                totalCapacity += def.energyStorageCapacity || 0;

                // Consumer battery sell check
                if (def.sellPrice && def.maxDischargeRate === 0) {
                    var consCapacity = def.energyStorageCapacity || 0;
                    if (building.energy >= consCapacity && consCapacity > 0) {
                        building.sellReady = true;
                        _sellConsumerBattery(building);
                    }
                    continue;
                }

                // Carbon collectors (was Step 3b)
                if (building.active && building.hp > 0 && def.pollutionReduction && def.pollutionReduction > 0) {
                    if (typeof Engine !== 'undefined' && typeof Engine.reducePollution === 'function') {
                        Engine.reducePollution(def.pollutionReduction / tps);
                    }
                }

                // Energy consumption
                if (!def.energyConsumption || def.energyConsumption <= 0) continue;

                var consumePerTick = def.energyConsumption / tps;
                consumePerTick = _applyDifficultyToEnergy(consumePerTick);
                var penalty = _getEnergyPenalty();
                if (penalty > 0) {
                    consumePerTick = consumePerTick * (1 + penalty);
                }

                if (building.energy >= consumePerTick) {
                    building.energy -= consumePerTick;
                    if (!building.active) {
                        // Reactivating — re-allocate workers
                        var wReq = def.workersRequired || 0;
                        if (wReq > 0 && typeof Workers !== 'undefined' && Workers.canAllocate && Workers.allocateWorkers) {
                            if (Workers.canAllocate(wReq)) {
                                Workers.allocateWorkers(wReq);
                                building.active = true;
                            }
                            // Not enough workers — stay inactive
                        } else {
                            building.active = true;
                        }
                    }
                    totalConsumption += consumePerTick;
                } else {
                    if (building.active) {
                        // Deactivating — free workers
                        var wFree = def.workersRequired || 0;
                        if (wFree > 0 && typeof Workers !== 'undefined' && Workers.freeWorkers) {
                            Workers.freeWorkers(wFree);
                        }
                    }
                    building.active = false;
                    if (def.category === 'weapons') {
                        building.laserRampTime = 0;
                    }
                }
            }

            _stats.totalGeneration = totalGeneration * tps;
            _stats.totalConsumption = totalConsumption * tps;
            _stats.totalStored = totalStored;
            _stats.totalCapacity = totalCapacity;

            // ============================================================
            // Final step: Round energy to prevent floating-point drift
            // ============================================================
            for (i = 0; i < allBuildings.length; i++) {
                building = allBuildings[i];
                def = _getDef(building.type);
                if (!def) continue;
                var cap = def.energyStorageCapacity || 0;
                building.energy = Math.round(building.energy * 10) / 10;
                if (cap > 0 && building.energy > cap) {
                    building.energy = cap;
                }
                if (building.energy < 0) {
                    building.energy = 0;
                }
            }
        },

        // ================================================================
        // Queries
        // ================================================================
        getStats: function() {
            return _stats;
        },

        getNetEnergy: function() {
            return _stats.totalGeneration - _stats.totalConsumption;
        },

        // Returns true if a building was part of an energy transfer this tick
        isNodeFlowing: function(buildingId) {
            return !!_activeFlowNodes[buildingId];
        },

        getCableFlowDisplay: function() {
            return _cableFlowDisplay;
        },

        // Day/Night and Wind queries
        isDay: function() { return _isDay; },
        getWindSpeed: function() { return _windSpeed; },
        getDayNightTimer: function() { return _dayNightTimer; },
        getDayNightHalfCycle: function() {
            return (typeof Config !== 'undefined' && Config.DAY_NIGHT_CYCLE)
                ? Config.DAY_NIGHT_CYCLE / 2 : 12;
        },

        // ================================================================
        // Save/Load
        // ================================================================
        getSerializableState: function() {
            return {
                stats: {
                    totalGeneration: _stats.totalGeneration,
                    totalConsumption: _stats.totalConsumption,
                    totalStored: _stats.totalStored,
                    totalCapacity: _stats.totalCapacity
                },
                tickCounter: _tickCounter,
                isDay: _isDay,
                dayNightTimer: _dayNightTimer,
                windSpeed: _windSpeed,
                windTimer: _windTimer
            };
        },

        loadState: function(data) {
            if (!data) return;
            if (data.stats) {
                _stats.totalGeneration = data.stats.totalGeneration || 0;
                _stats.totalConsumption = data.stats.totalConsumption || 0;
                _stats.totalStored = data.stats.totalStored || 0;
                _stats.totalCapacity = data.stats.totalCapacity || 0;
            }
            if (data.tickCounter !== undefined) {
                _tickCounter = data.tickCounter;
            }
            if (data.isDay !== undefined) _isDay = data.isDay;
            if (data.dayNightTimer !== undefined) _dayNightTimer = data.dayNightTimer;
            if (data.windSpeed !== undefined) _windSpeed = data.windSpeed;
            if (data.windTimer !== undefined) _windTimer = data.windTimer;
        }
    };
})();

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
        if (typeof Economy !== 'undefined' && typeof Economy.addResource === 'function') {
            Economy.addResource('money', sellPrice);
        } else if (typeof Economy !== 'undefined' && typeof Economy.addMoney === 'function') {
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

            // Sort consumers by priority
            consumers.sort(function(a, b) {
                return _getEnergyPriority(a) - _getEnergyPriority(b);
            });

            // Track energy transferred through each cable this tick
            var cableFlow = {};
            _activeFlowNodes = {};

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
                minThroughputMap[gen.id] = Infinity;

                while (queue.length > 0) {
                    var currentId = queue.shift();
                    var currentMinTP = minThroughputMap[currentId] || Infinity;
                    var neighbors = adjacency[currentId] || [];
                    for (var n = 0; n < neighbors.length; n++) {
                        var nId = neighbors[n];
                        if (visited[nId]) continue;
                        visited[nId] = true;

                        var nBuilding = Buildings.getById(nId);
                        if (!nBuilding || nBuilding.hp <= 0) continue;

                        var nDef = _getDef(nBuilding.type);
                        if (!nDef) continue;

                        // Track min throughput along path
                        var cableTP = _getCableThroughput(currentId, nId) / tps;
                        minThroughputMap[nId] = Math.min(currentMinTP, cableTP);

                        // Check if this building needs/accepts energy
                        var nCapacity = nDef.energyStorageCapacity || 0;
                        var remaining = nCapacity - nBuilding.energy;
                        if (remaining > 0) {
                            reachable.push(nBuilding);
                        }

                        // Continue BFS through relay nodes (pylons, batteries, etc.)
                        queue.push(nId);
                    }
                }

                // Sort reachable by priority
                reachable.sort(function(a, b) {
                    return _getEnergyPriority(a) - _getEnergyPriority(b);
                });

                // Distribute energy to reachable buildings
                for (var r = 0; r < reachable.length; r++) {
                    if (gen.energy <= 0 || totalDischarged >= maxDischarge) break;

                    var receiver = reachable[r];
                    var recDef = _getDef(receiver.type);
                    if (!recDef) continue;

                    var recCapacity = recDef.energyStorageCapacity || 0;
                    var recRemaining = recCapacity - receiver.energy;
                    if (recRemaining <= 0) continue;

                    var recChargeRate = (recDef.maxChargeRate || 0) / tps;

                    // Determine transfer amount
                    var transferable = gen.energy;
                    transferable = Math.min(transferable, maxDischarge - totalDischarged);
                    var pathThroughput = minThroughputMap[receiver.id] || (cableMaxThroughput / tps);
                    transferable = Math.min(transferable, pathThroughput);
                    if (recChargeRate > 0) {
                        transferable = Math.min(transferable, recChargeRate);
                    }
                    transferable = Math.min(transferable, recRemaining);

                    if (transferable <= 0) continue;

                    // Transfer
                    gen.energy -= transferable;
                    receiver.energy += transferable;
                    totalDischarged += transferable;
                    // Mark both nodes for cable glow
                    _activeFlowNodes[gen.id] = true;
                    _activeFlowNodes[receiver.id] = true;
                }
            }

            // ============================================================
            // Step 3: Consumption
            // ============================================================
            var totalConsumption = 0;

            for (i = 0; i < allBuildings.length; i++) {
                building = allBuildings[i];
                def = _getDef(building.type);
                if (!def) continue;

                // Handle consumer battery sell when full
                if (def.sellPrice && def.maxDischargeRate === 0) {
                    var consCapacity = def.energyStorageCapacity || 0;
                    if (building.energy >= consCapacity && consCapacity > 0) {
                        building.sellReady = true;
                        _sellConsumerBattery(building);
                    }
                    continue; // consumer batteries don't have energyConsumption
                }

                if (!def.energyConsumption || def.energyConsumption <= 0) continue;

                var consumePerTick = def.energyConsumption / tps;

                // Apply difficulty multiplier
                consumePerTick = _applyDifficultyToEnergy(consumePerTick);

                // Apply pollution penalty
                var penalty = _getEnergyPenalty();
                if (penalty > 0) {
                    consumePerTick = consumePerTick * (1 + penalty);
                }

                if (building.energy >= consumePerTick) {
                    building.energy -= consumePerTick;
                    building.active = true;
                    totalConsumption += consumePerTick;
                } else {
                    building.active = false;
                    // Lasers lose ramp when unpowered
                    if (def.category === 'weapons') {
                        building.laserRampTime = 0;
                    }
                }
            }

            // ============================================================
            // Step 3b: Carbon collectors reduce pollution
            // ============================================================
            for (i = 0; i < allBuildings.length; i++) {
                building = allBuildings[i];
                if (!building.active || building.hp <= 0) continue;
                def = _getDef(building.type);
                if (!def || !def.pollutionReduction || def.pollutionReduction <= 0) continue;
                if (typeof Engine !== 'undefined' && typeof Engine.reducePollution === 'function') {
                    Engine.reducePollution(def.pollutionReduction / tps);
                }
            }

            // ============================================================
            // Step 4: Update Stats
            // ============================================================
            var totalStored = 0;
            var totalCapacity = 0;

            for (i = 0; i < allBuildings.length; i++) {
                building = allBuildings[i];
                def = _getDef(building.type);
                if (!def) continue;
                totalStored += building.energy || 0;
                totalCapacity += def.energyStorageCapacity || 0;
            }

            _stats.totalGeneration = totalGeneration * tps; // normalize to per-second
            _stats.totalConsumption = totalConsumption * tps;
            _stats.totalStored = totalStored;
            _stats.totalCapacity = totalCapacity;
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

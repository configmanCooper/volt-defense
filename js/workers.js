// ============================================================================
// Volt Defense — Workers Module
// Manages the worker pool, recruitment, departure, and housing.
// ============================================================================

var Workers = (function () {
    var _totalWorkers = 0;
    var _allocatedWorkers = 0;
    var _maxCapacity = 0;
    var _recruitTimer = 0;
    var _departTimer = 0;
    var _homelessTimer = 0;
    var _homelessDepartTimer = 0;

    // Priority order for deactivating buildings when workers are lost
    // (lowest priority first — these get deactivated before higher-priority ones)
    var _deactivationOrder = [
        'consumer_battery', 'large_battery', 'small_battery', 'capacitor',
        'carbon_collector_t2', 'carbon_collector_t1',
        'coal_miner', 'coal_miner_t2', 'iron_miner', 'iron_miner_t2',
        'uranium_miner', 'uranium_miner_t2',
        'oil_drill', 'oil_drill_t2',
        'missile_t1', 'missile_t2', 'missile_t3',
        'laser_t1', 'laser_t2', 'laser_t3',
        'shield_t1', 'shield_t2',
        'solar', 'wind', 'coal_plant', 'gas_plant', 'nuclear_plant', 'hydro_plant'
    ];

    /**
     * When a worker is lost and allocated > total, deactivate the lowest-priority
     * building that still has workers assigned until balance is restored.
     */
    function _forceDeactivateBuildings() {
        if (typeof Buildings === 'undefined' || !Buildings.getAll) { return; }

        var allBuildings = Buildings.getAll();
        if (!allBuildings) { return; }

        while (_allocatedWorkers > _totalWorkers) {
            var deactivated = false;

            for (var p = 0; p < _deactivationOrder.length; p++) {
                var typeKey = _deactivationOrder[p];

                for (var i = 0; i < allBuildings.length; i++) {
                    var b = allBuildings[i];
                    if (b.type === typeKey && b.active && b.hp > 0) {
                        var def = Config.BUILDINGS[b.type];
                        if (def && def.workersRequired > 0) {
                            b.active = false;
                            _allocatedWorkers -= def.workersRequired;
                            if (_allocatedWorkers < 0) { _allocatedWorkers = 0; }
                            deactivated = true;
                            break;
                        }
                    }
                }

                if (deactivated) { break; }
            }

            // Safety valve — nothing left to deactivate
            if (!deactivated) {
                _allocatedWorkers = _totalWorkers;
                break;
            }
        }
    }

    /**
     * Recalculate housing capacity from all active housing buildings.
     */
    function _recalcCapacity() {
        _maxCapacity = 0;

        if (typeof Buildings === 'undefined' || !Buildings.getByCategory) { return; }

        var housingBuildings = Buildings.getByCategory('housing');
        if (!housingBuildings) { return; }

        for (var i = 0; i < housingBuildings.length; i++) {
            var b = housingBuildings[i];
            if (b.active && b.hp > 0) {
                var def = Config.BUILDINGS[b.type];
                if (def && def.workersHoused) {
                    _maxCapacity += def.workersHoused;
                }
            }
        }
    }

    /**
     * Try to recruit a worker based on pollution level and difficulty.
     */
    function _processRecruitment() {
        var pollutionLevel = 'clean';
        if (typeof Engine !== 'undefined' && Engine.getPollutionLevel) {
            pollutionLevel = Engine.getPollutionLevel();
        }

        var difficulty = null;
        if (typeof Engine !== 'undefined' && Engine.getDifficulty) {
            difficulty = Engine.getDifficulty();
        }

        var recruitMult = (difficulty && difficulty.workerRecruitMult)
            ? difficulty.workerRecruitMult
            : 1;
        var adjustedInterval = Math.round(
            Config.WORKER_RECRUIT_INTERVAL * (1 / recruitMult)
        );

        _recruitTimer++;
        if (_recruitTimer < adjustedInterval) { return; }
        _recruitTimer = 0;

        if (_totalWorkers >= _maxCapacity) { return; }

        var shouldRecruit = false;
        if (pollutionLevel === 'clean' || pollutionLevel === 'low') {
            shouldRecruit = true;
        } else if (pollutionLevel === 'moderate') {
            var rngObj = (typeof Engine !== 'undefined' && Engine.getRng)
                ? Engine.getRng()
                : null;
            shouldRecruit = rngObj && typeof rngObj.random === 'function'
                ? rngObj.random() < 0.5
                : Math.random() < 0.5;
        }
        // 'high' / 'critical' — no recruitment

        if (shouldRecruit) {
            _totalWorkers += Config.WORKER_RECRUIT_AMOUNT;
        }
    }

    /**
     * Lose workers due to high / critical pollution.
     */
    function _processDeparture() {
        var pollutionLevel = 'clean';
        if (typeof Engine !== 'undefined' && Engine.getPollutionLevel) {
            pollutionLevel = Engine.getPollutionLevel();
        }

        var interval = 0;
        if (pollutionLevel === 'high') {
            interval = Config.WORKER_DEPART_INTERVAL_HIGH;
        } else if (pollutionLevel === 'critical') {
            interval = Config.WORKER_DEPART_INTERVAL_CRITICAL;
        }

        if (interval <= 0) {
            _departTimer = 0;
            return;
        }

        _departTimer++;
        if (_departTimer < interval) { return; }
        _departTimer = 0;

        if (_totalWorkers > 0) {
            _totalWorkers--;
            if (_totalWorkers < _allocatedWorkers) {
                _forceDeactivateBuildings();
            }
        }
    }

    /**
     * Handle homeless workers when housing capacity drops below current total.
     */
    function _processHomeless() {
        if (_totalWorkers <= _maxCapacity) {
            _homelessTimer = 0;
            _homelessDepartTimer = 0;
            return;
        }

        _homelessTimer++;

        if (_homelessTimer < Config.WORKER_HOMELESS_GRACE) { return; }

        // Grace period expired — start losing workers
        _homelessDepartTimer++;
        if (_homelessDepartTimer >= 50) {
            _homelessDepartTimer = 0;
            _totalWorkers--;
            if (_totalWorkers < _allocatedWorkers) {
                _forceDeactivateBuildings();
            }
        }
    }

    return {
        init: function () {
            _totalWorkers = 0;
            _allocatedWorkers = 0;
            _maxCapacity = 0;
            _recruitTimer = 0;
            _departTimer = 0;
            _homelessTimer = 0;
            _homelessDepartTimer = 0;

            // Recalculate capacity from any pre-placed housing
            _recalcCapacity();

            // Start with workers for initial housing
            _totalWorkers = Math.min(_maxCapacity, 4);
        },

        tick: function () {
            _recalcCapacity();
            _processRecruitment();
            _processDeparture();
            _processHomeless();
        },

        // ---- Worker management ------------------------------------------------

        allocateWorkers: function (count) {
            if ((_totalWorkers - _allocatedWorkers) < count) { return false; }
            _allocatedWorkers += count;
            return true;
        },

        freeWorkers: function (count) {
            _allocatedWorkers -= count;
            if (_allocatedWorkers < 0) { _allocatedWorkers = 0; }
        },

        getAvailableWorkers: function () {
            return _totalWorkers - _allocatedWorkers;
        },

        getTotalWorkers: function () {
            return _totalWorkers;
        },

        getAllocatedWorkers: function () {
            return _allocatedWorkers;
        },

        getMaxCapacity: function () {
            return _maxCapacity;
        },

        canAllocate: function (count) {
            return (_totalWorkers - _allocatedWorkers) >= count;
        },

        // ---- Save / Load ------------------------------------------------------

        getSerializableState: function () {
            return {
                totalWorkers: _totalWorkers,
                allocatedWorkers: _allocatedWorkers,
                maxCapacity: _maxCapacity,
                recruitTimer: _recruitTimer,
                departTimer: _departTimer,
                homelessTimer: _homelessTimer,
                homelessDepartTimer: _homelessDepartTimer
            };
        },

        loadState: function (data) {
            if (!data) { return; }
            _totalWorkers = data.totalWorkers || 0;
            _allocatedWorkers = data.allocatedWorkers || 0;
            _maxCapacity = data.maxCapacity || 0;
            _recruitTimer = data.recruitTimer || 0;
            _departTimer = data.departTimer || 0;
            _homelessTimer = data.homelessTimer || 0;
            _homelessDepartTimer = data.homelessDepartTimer || 0;
        }
    };
})();

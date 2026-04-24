// ============================================================================
// Volt Defense — Economy Module
// Manages money, resources, and all financial transactions.
// ============================================================================

var Economy = (function () {
    var _money = 0;
    var _resources = { iron: 0, coal: 0, uranium: 0, oil: 0 };
    var _stats = {
        totalEarned: 0,
        totalSpent: 0,
        totalMined: { iron: 0, coal: 0, uranium: 0, oil: 0 }
    };

    /**
     * Process all active miners — extract from deposits and add to resources.
     */
    function _processMining() {
        if (typeof Buildings === 'undefined' || !Buildings.getByCategory) { return; }

        var miners = Buildings.getByCategory('mining');
        if (!miners) { return; }

        for (var i = 0; i < miners.length; i++) {
            var b = miners[i];
            if (!b.active || b.hp <= 0) { continue; }

            var def = Config.BUILDINGS[b.type];
            if (!def || !def.extractionRate) { continue; }

            // Resolve the deposit this miner sits on
            var deposit = b.depositRef;
            if (!deposit && typeof Map !== 'undefined' && Map.getDepositAt) {
                deposit = Map.getDepositAt(b.gridX, b.gridY);
            }
            if (!deposit || deposit.remaining <= 0) { continue; }

            var extractPerTick = def.extractionRate / Config.TICKS_PER_SECOND;
            var extracted = Math.min(extractPerTick, deposit.remaining);
            deposit.remaining -= extracted;

            // Determine resource type from the terrain / building type
            var resourceType = null;
            if (b.type.indexOf('iron') !== -1)    { resourceType = 'iron'; }
            else if (b.type.indexOf('coal') !== -1)   { resourceType = 'coal'; }
            else if (b.type.indexOf('uranium') !== -1) { resourceType = 'uranium'; }
            else if (b.type.indexOf('oil') !== -1) { resourceType = 'oil'; }

            if (resourceType) {
                _resources[resourceType] += extracted;
                _stats.totalMined[resourceType] += extracted;
            }
        }
    }

    /**
     * Process consumer batteries — sell energy when full.
     */
    function _processConsumerBatteries() {
        if (typeof Buildings === 'undefined' || !Buildings.getByCategory) { return; }

        var storageBldgs = Buildings.getByCategory('storage');
        if (!storageBldgs) { return; }

        for (var i = 0; i < storageBldgs.length; i++) {
            var b = storageBldgs[i];
            if (b.type !== 'consumer_battery') { continue; }
            if (!b.active || b.hp <= 0) { continue; }

            var cap = Config.BUILDINGS.consumer_battery.energyStorageCapacity;
            if (b.energy >= cap) {
                _money += Config.CONSUMER_BATTERY_SELL_PRICE;
                _stats.totalEarned += Config.CONSUMER_BATTERY_SELL_PRICE;
                b.energy = 0;
            }
        }
    }

    /**
     * Process consumer grid connects — earn money while powered.
     */
    function _processGridConnects() {
        if (typeof Buildings === 'undefined' || !Buildings.getByCategory) { return; }

        var gridBldgs = Buildings.getByCategory('grid');
        if (!gridBldgs) { return; }

        var tps = (typeof Config !== 'undefined' && Config.TICKS_PER_SECOND) ? Config.TICKS_PER_SECOND : 10;

        for (var i = 0; i < gridBldgs.length; i++) {
            var b = gridBldgs[i];
            if (b.type !== 'grid_connect') { continue; }
            if (!b.active || b.hp <= 0) { continue; }

            var def = Config.BUILDINGS.grid_connect;
            if (!def || !def.moneyPerSecond) { continue; }

            // Only earn money if building has enough energy
            var energyNeeded = (def.energyConsumption || 0) / tps;
            if (b.energy >= energyNeeded) {
                var income = def.moneyPerSecond / tps;
                _money += income;
                _stats.totalEarned += income;
            }
        }
    }

    return {
        init: function (startMoney, startResources) {
            _money = startMoney || Config.START_MONEY;
            _resources = { iron: 0, coal: 0, uranium: 0, oil: 0 };

            if (startResources) {
                if (startResources.iron)    { _resources.iron    = startResources.iron; }
                if (startResources.coal)    { _resources.coal    = startResources.coal; }
                if (startResources.uranium) { _resources.uranium = startResources.uranium; }
                if (startResources.oil)     { _resources.oil     = startResources.oil; }
            } else {
                _resources.coal = Config.START_COAL || 0;
            }

            _stats = {
                totalEarned: 0,
                totalSpent: 0,
                totalMined: { iron: 0, coal: 0, uranium: 0, oil: 0 }
            };
        },

        tick: function () {
            _processMining();
            _processConsumerBatteries();
            _processGridConnects();
        },

        // ---- Money ------------------------------------------------------------

        getMoney: function () {
            return _money;
        },

        addMoney: function (amount, source) {
            if (amount <= 0) { return; }
            _money += amount;
            _stats.totalEarned += amount;
        },

        spendMoney: function (amount) {
            if (_money < amount) { return false; }
            _money -= amount;
            _stats.totalSpent += amount;
            return true;
        },

        /**
         * Check if the player can afford a cost object:
         *   { money: N, iron?: N, coal?: N, uranium?: N }
         * Applies difficulty cost multiplier if Engine is available.
         */
        canAfford: function (cost) {
            if (!cost) { return true; }

            var adjusted = cost;
            if (typeof Engine !== 'undefined' && Engine.applyDifficultyToCost) {
                adjusted = Engine.applyDifficultyToCost(cost);
            }

            if (adjusted.money && _money < adjusted.money) { return false; }

            var resTypes = ['iron', 'coal', 'uranium', 'oil'];
            for (var i = 0; i < resTypes.length; i++) {
                var t = resTypes[i];
                if (adjusted[t] && (_resources[t] || 0) < adjusted[t]) {
                    return false;
                }
            }
            return true;
        },

        /**
         * Deduct a full cost object (money + resources).
         * Returns true if successful, false if insufficient funds.
         */
        deductCost: function (cost) {
            if (!cost) { return true; }

            var adjusted = cost;
            if (typeof Engine !== 'undefined' && Engine.applyDifficultyToCost) {
                adjusted = Engine.applyDifficultyToCost(cost);
            }

            // Pre-check
            if (adjusted.money && _money < adjusted.money) { return false; }
            var resTypes = ['iron', 'coal', 'uranium', 'oil'];
            for (var i = 0; i < resTypes.length; i++) {
                var t = resTypes[i];
                if (adjusted[t] && (_resources[t] || 0) < adjusted[t]) {
                    return false;
                }
            }

            // Deduct
            if (adjusted.money) {
                _money -= adjusted.money;
                _stats.totalSpent += adjusted.money;
            }
            for (var j = 0; j < resTypes.length; j++) {
                var rt = resTypes[j];
                if (adjusted[rt]) {
                    _resources[rt] -= adjusted[rt];
                }
            }
            return true;
        },

        // ---- Resources --------------------------------------------------------

        getResource: function (type) {
            return _resources[type] || 0;
        },

        getResources: function () {
            return {
                iron: _resources.iron,
                coal: _resources.coal,
                uranium: _resources.uranium,
                oil: _resources.oil
            };
        },

        addResource: function (type, amount) {
            if (!_resources.hasOwnProperty(type)) { return; }
            _resources[type] += amount;
        },

        spendResource: function (type, amount) {
            if (!_resources.hasOwnProperty(type)) { return false; }
            if (_resources[type] < amount) { return false; }
            _resources[type] -= amount;
            return true;
        },

        /**
         * Check whether the player has all resources specified in a cost object.
         */
        hasResources: function (cost) {
            if (!cost) { return true; }
            var resTypes = ['iron', 'coal', 'uranium', 'oil'];
            for (var i = 0; i < resTypes.length; i++) {
                var t = resTypes[i];
                if (cost[t] && (_resources[t] || 0) < cost[t]) {
                    return false;
                }
            }
            return true;
        },

        // ---- Stats ------------------------------------------------------------

        getStats: function () {
            return _stats;
        },

        // ---- Save / Load ------------------------------------------------------

        getSerializableState: function () {
            return {
                money: _money,
                resources: {
                    iron: _resources.iron,
                    coal: _resources.coal,
                    uranium: _resources.uranium,
                    oil: _resources.oil
                },
                stats: {
                    totalEarned: _stats.totalEarned,
                    totalSpent: _stats.totalSpent,
                    totalMined: {
                        iron: _stats.totalMined.iron,
                        coal: _stats.totalMined.coal,
                        uranium: _stats.totalMined.uranium,
                        oil: _stats.totalMined.oil
                    }
                }
            };
        },

        loadState: function (data) {
            if (!data) { return; }
            _money = data.money || 0;

            if (data.resources) {
                _resources.iron    = data.resources.iron    || 0;
                _resources.coal    = data.resources.coal    || 0;
                _resources.uranium = data.resources.uranium || 0;
                _resources.oil     = data.resources.oil     || 0;
            }

            if (data.stats) {
                _stats.totalEarned = data.stats.totalEarned || 0;
                _stats.totalSpent  = data.stats.totalSpent  || 0;
                if (data.stats.totalMined) {
                    _stats.totalMined.iron    = data.stats.totalMined.iron    || 0;
                    _stats.totalMined.coal    = data.stats.totalMined.coal    || 0;
                    _stats.totalMined.uranium = data.stats.totalMined.uranium || 0;
                    _stats.totalMined.oil     = data.stats.totalMined.oil     || 0;
                }
            }
        }
    };
})();

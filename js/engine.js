/* =========================================================================
 *  engine.js — Core game engine for Volt Defense
 *  Orchestrates the game loop, manages game state, and coordinates all systems.
 *  Uses the IIFE module pattern. All constants come from Config.
 * ========================================================================= */

function SeededRNG(seed) {
    this.seed = seed;
    this.random = function() {
        this.seed = (this.seed * 16807) % 2147483647;
        return (this.seed - 1) / 2147483646;
    };
    this.randomInt = function(min, max) {
        return Math.floor(this.random() * (max - min + 1)) + min;
    };
    this.pick = function(arr) {
        return arr[Math.floor(this.random() * arr.length)];
    };
    this.shuffle = function(arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(this.random() * (i + 1));
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    };
}

var Engine = (function() {
    // Private state
    var _state = null;
    var _tickCount = 0;

    // ---- helpers ----

    function _getDiff() {
        if (!_state || typeof Config === 'undefined') { return null; }
        return Config.DIFFICULTY[_state.difficulty] || null;
    }

    function _ticksPerSecond() {
        return (typeof Config !== 'undefined' && Config.TICKS_PER_SECOND) ? Config.TICKS_PER_SECOND : 10;
    }

    // ---- starting building placement ----

    function _placeStartingBuildings(rng) {
        if (typeof Buildings === 'undefined' || !Buildings.place) { return; }

        var cellSize = (typeof Config !== 'undefined' ? Config.GRID_CELL_SIZE : 40);
        var centerGX = Math.floor((typeof Config !== 'undefined' ? Config.MAP_WIDTH : 10000) / 2 / cellSize);
        var centerGY = Math.floor((typeof Config !== 'undefined' ? Config.MAP_HEIGHT : 10000) / 2 / cellSize);

        // Ensure core is at least 5 tiles from any water tile
        var coreGX = centerGX;
        var coreGY = centerGY;
        if (typeof Map !== 'undefined' && Map.getTerrain) {
            var minDist = 5;
            var found = false;
            // Spiral outward from center to find a valid spot
            for (var radius = 0; radius <= 50 && !found; radius++) {
                for (var dy = -radius; dy <= radius && !found; dy++) {
                    for (var dx = -radius; dx <= radius && !found; dx++) {
                        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius && radius > 0) continue;
                        var testX = centerGX + dx;
                        var testY = centerGY + dy;
                        var tooClose = false;
                        // Check all tiles within minDist (including core's 2x2 footprint)
                        for (var cy = -minDist; cy <= minDist + 1 && !tooClose; cy++) {
                            for (var cx = -minDist; cx <= minDist + 1 && !tooClose; cx++) {
                                var terrain = Map.getTerrain(testX + cx, testY + cy);
                                if (terrain === 2 || terrain === 3) {
                                    tooClose = true;
                                }
                            }
                        }
                        if (!tooClose) {
                            coreGX = testX;
                            coreGY = testY;
                            found = true;
                        }
                    }
                }
            }
        }

        // Core at chosen position
        Buildings.place('core', coreGX, coreGY, true);

        // Wind Turbine 2 cells to the right of core
        var windGX = coreGX + 2;
        var windGY = coreGY;
        Buildings.place('wind', windGX, windGY, true);

        // Small House 2 cells below core
        var houseGX = coreGX;
        var houseGY = coreGY + 2;
        Buildings.place('small_house', houseGX, houseGY, true);

        // Connect starting buildings with cables using building IDs
        var coreBuilding = Buildings.getAt ? Buildings.getAt(coreGX, coreGY) : null;
        var windBuilding = Buildings.getAt ? Buildings.getAt(windGX, windGY) : null;
        var houseBuilding = Buildings.getAt ? Buildings.getAt(houseGX, houseGY) : null;

        if (typeof Buildings.addCable === 'function') {
            if (coreBuilding && windBuilding) {
                Buildings.addCable(coreBuilding.id, windBuilding.id);
            }
            if (coreBuilding && houseBuilding) {
                Buildings.addCable(coreBuilding.id, houseBuilding.id);
            }
        }
    }

    // ---- public API ----

    return {
        /**
         * Initialize a new game.
         * @param {number} seed  - RNG seed
         * @param {string} difficulty - key into Config.DIFFICULTY (e.g. 'volt')
         */
        init: function(seed, difficulty) {
            var diff = (typeof Config !== 'undefined' && Config.DIFFICULTY) ? Config.DIFFICULTY[difficulty] : null;
            var tps = _ticksPerSecond();

            var rng = new SeededRNG(seed);

            _tickCount = 0;

            _state = {
                difficulty: difficulty,
                wave: 0,
                waveTimer: diff ? diff.firstWaveDelay : 120,
                pollution: 0,
                coreHP: (typeof Config !== 'undefined' && Config.CORE_HP) ? Config.CORE_HP : 100,
                gameTime: 0,
                paused: false,
                gameOver: false,
                rng: rng,
                seed: seed,
                wavesEnabled: true
            };

            // Generate map
            if (typeof Map !== 'undefined' && Map.generate) {
                Map.generate(rng);
            }

            // Place starting buildings
            _placeStartingBuildings(rng);
        },

        /**
         * Main simulation tick — called TICKS_PER_SECOND times per second.
         */
        tick: function() {
            if (!_state || _state.paused || _state.gameOver) { return; }

            var tps = _ticksPerSecond();

            // 1. Advance counters
            _tickCount++;
            _state.gameTime += 1 / tps;

            // 2. Energy generation & flow
            if (typeof Energy !== 'undefined' && Energy.tick) { Energy.tick(); }

            // 3. Workers recruitment / departure
            if (typeof Workers !== 'undefined' && Workers.tick) { Workers.tick(); }

            // 4. Economy — battery sales, mining
            if (typeof Economy !== 'undefined' && Economy.tick) { Economy.tick(); }

            // 5. Combat — weapons fire, damage
            if (typeof Combat !== 'undefined' && Combat.tick) { Combat.tick(); }

            // 6. Enemies — movement, attacks
            if (typeof Enemies !== 'undefined' && Enemies.tick) { Enemies.tick(); }

            // 6b. Destroy buildings at 0 HP
            if (typeof Buildings !== 'undefined' && Buildings.getAll && Buildings.remove) {
                var allB = Buildings.getAll();
                for (var bi = allB.length - 1; bi >= 0; bi--) {
                    var bld = allB[bi];
                    if (bld.hp <= 0 && bld.type !== 'core') {
                        Buildings.remove(bld.id, true);
                    }
                }
            }

            // 7. Wave timer
            if (_state.wavesEnabled && _state.waveTimer > 0) {
                _state.waveTimer -= 1 / tps;
                if (_state.waveTimer <= 0) {
                    _state.waveTimer = 0;
                    this.startNextWave();
                }
            }

            // 8. Pollution passive decay
            if (typeof Config !== 'undefined' && Config.POLLUTION_PASSIVE_DECAY != null) {
                var diff = _getDiff();
                var decayMult = (diff && diff.pollutionDecayMult) ? diff.pollutionDecayMult : 1;
                _state.pollution -= Config.POLLUTION_PASSIVE_DECAY * decayMult;
                if (_state.pollution < 0) { _state.pollution = 0; }
            }
        },

        // ---- state accessors ----

        getState: function() { return _state; },

        getDifficulty: function() { return _getDiff(); },

        getDifficultyKey: function() { return _state ? _state.difficulty : null; },

        getWave: function() { return _state ? _state.wave : 0; },

        getWaveTimer: function() { return _state ? _state.waveTimer : 0; },

        getPollution: function() { return _state ? _state.pollution : 0; },

        addPollution: function(amount) {
            if (_state) { _state.pollution += amount; }
        },

        reducePollution: function(amount) {
            if (_state) {
                _state.pollution -= amount;
                if (_state.pollution < 0) { _state.pollution = 0; }
            }
        },

        getCoreHP: function() { return _state ? _state.coreHP : 0; },

        damageCoreHP: function(amount) {
            if (!_state) { return; }
            if (_state.godMode) { return; }
            _state.coreHP -= amount;
            if (_state.coreHP <= 0) {
                _state.coreHP = 0;
                _state.gameOver = true;
            }
        },

        healCoreHP: function(amount) {
            if (!_state) { return; }
            var maxHP = (typeof Config !== 'undefined' && Config.CORE_HP) ? Config.CORE_HP : 100;
            _state.coreHP = Math.min(_state.coreHP + amount, maxHP);
        },

        getGameTime: function() { return _state ? _state.gameTime : 0; },

        isGameOver: function() { return _state ? _state.gameOver : false; },

        setGodMode: function(on) { if (_state) _state.godMode = !!on; },
        isGodMode: function() { return _state ? !!_state.godMode : false; },

        setWavesEnabled: function(on) { if (_state) _state.wavesEnabled = !!on; },
        isWavesEnabled: function() { return _state ? _state.wavesEnabled !== false : true; },

        isPaused: function() { return _state ? _state.paused : false; },

        setPaused: function(paused) {
            if (_state) { _state.paused = !!paused; }
        },

        getRng: function() { return _state ? _state.rng : null; },

        getTickCount: function() { return _tickCount; },

        // ---- wave management ----

        startNextWave: function() {
            if (!_state) { return; }

            _state.wave++;

            // Spawn enemies for this wave
            if (typeof Enemies !== 'undefined' && Enemies.spawnWave) {
                Enemies.spawnWave(_state.wave);
            }

            // Award wave completion bonus
            if (typeof Economy !== 'undefined' && Economy.addMoney) {
                var base = (typeof Config !== 'undefined' && Config.WAVE_COMPLETION_BASE) ? Config.WAVE_COMPLETION_BASE : 500;
                var scale = (typeof Config !== 'undefined' && Config.WAVE_COMPLETION_SCALE) ? Config.WAVE_COMPLETION_SCALE : 100;
                var bonus = base + (_state.wave - 1) * scale;
                var diff = _getDiff();
                if (diff && diff.waveBonusMult) bonus = Math.floor(bonus * diff.waveBonusMult);
                Economy.addMoney(bonus, 'wave_bonus');
                if (typeof UI !== 'undefined' && UI.showToast) {
                    UI.showToast('Wave ' + _state.wave + ' incoming! +$' + bonus + ' bonus', 'warning', 3000);
                }
            }

            // Reset timer for next wave
            var diff = _getDiff();
            _state.waveTimer = diff ? diff.waveInterval :
                ((typeof Config !== 'undefined' && Config.WAVE_INTERVAL) ? Config.WAVE_INTERVAL : 60);
        },

        // ---- difficulty-adjusted helpers ----

        applyDifficultyToCost: function(cost) {
            var diff = _getDiff();
            var mult = (diff && diff.buildingCostMult) ? diff.buildingCostMult : 1;
            var result = {};
            if (cost) {
                if (cost.money != null) { result.money = Math.round(cost.money * mult); }
                if (cost.iron != null) { result.iron = Math.round(cost.iron * mult); }
            }
            return result;
        },

        applyDifficultyToEnergy: function(base) {
            var diff = _getDiff();
            var mult = (diff && diff.buildingEnergyMult) ? diff.buildingEnergyMult : 1;
            return Math.round(base * mult);
        },

        applyDifficultyToEnemyHP: function(base) {
            var diff = _getDiff();
            var mult = (diff && diff.enemyHPMult) ? diff.enemyHPMult : 1;
            return Math.round(base * mult);
        },

        applyDifficultyToEnemyDamage: function(base) {
            var diff = _getDiff();
            var mult = (diff && diff.enemyDamageMult) ? diff.enemyDamageMult : 1;
            return Math.round(base * mult);
        },

        applyDifficultyToEnemySpeed: function(base) {
            var diff = _getDiff();
            var mult = (diff && diff.enemySpeedMult) ? diff.enemySpeedMult : 1;
            return base * mult;
        },

        // ---- pollution helpers ----

        getPollutionLevel: function() {
            if (!_state || typeof Config === 'undefined') { return 'clean'; }
            var p = _state.pollution;
            if (p >= (Config.POLLUTION_THRESHOLD_CRITICAL || 500)) { return 'critical'; }
            if (p >= (Config.POLLUTION_THRESHOLD_HIGH || 300)) { return 'high'; }
            if (p >= (Config.POLLUTION_THRESHOLD_MODERATE || 150)) { return 'moderate'; }
            if (p >= (Config.POLLUTION_THRESHOLD_LOW || 50)) { return 'low'; }
            return 'clean';
        },

        getEnemySpeedMultiplier: function() {
            if (typeof Config === 'undefined') { return 1; }
            var level = this.getPollutionLevel();
            if (level === 'critical' || level === 'high') {
                return 1 + (Config.POLLUTION_ENEMY_SPEED_BOOST_HIGH || 0.20);
            }
            if (level === 'moderate') {
                return 1 + (Config.POLLUTION_ENEMY_SPEED_BOOST_MOD || 0.10);
            }
            return 1;
        },

        getEnergyPenalty: function() {
            var level = this.getPollutionLevel();
            if (level === 'critical') {
                return (typeof Config !== 'undefined' && Config.POLLUTION_ENERGY_PENALTY_CRITICAL != null)
                    ? Config.POLLUTION_ENERGY_PENALTY_CRITICAL : 0.20;
            }
            return 0;
        },

        // ---- save / load ----

        loadState: function(state) {
            if (!state) { return; }
            _state = {
                difficulty: state.difficulty || 'volt',
                wave: state.wave || 0,
                waveTimer: state.waveTimer || 0,
                pollution: state.pollution || 0,
                coreHP: state.coreHP != null ? state.coreHP :
                    ((typeof Config !== 'undefined' && Config.CORE_HP) ? Config.CORE_HP : 100),
                gameTime: state.gameTime || 0,
                paused: false,
                gameOver: state.gameOver || false,
                rng: new SeededRNG(state.seed || 1),
                seed: state.seed || 1
            };
            // Fast-forward the RNG to the saved tick count if available
            if (state.tickCount) { _tickCount = state.tickCount; }
        },

        getSerializableState: function() {
            if (!_state) { return null; }
            return {
                difficulty: _state.difficulty,
                wave: _state.wave,
                waveTimer: _state.waveTimer,
                pollution: _state.pollution,
                coreHP: _state.coreHP,
                gameTime: _state.gameTime,
                gameOver: _state.gameOver,
                seed: _state.seed,
                tickCount: _tickCount
            };
        }
    };
})();

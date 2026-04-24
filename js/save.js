// ============================================================================
// Volt Defense — Save/Load Module
// Manages localStorage persistence with versioned format and auto-save.
// Supports 5 named save slots.
// ============================================================================

var Save = (function () {
    var SAVE_KEY_PREFIX = 'voltdefense_save_';
    var AUTOSAVE_KEY_PREFIX = 'voltdefense_autosave_';
    var OLD_SAVE_KEY = 'voltdefense_save';
    var SAVE_VERSION = 1;
    var _autoSaveInterval = null;
    var AUTO_SAVE_TICKS = 300; // Every 30 seconds (300 ticks at 10/sec)
    var AUTOSAVE_INTERVAL_TICKS = 3000; // Every 5 minutes (3000 ticks at 10/sec)
    var _ticksSinceAutoSave = 0;
    var _ticksSinceAutosaveSlot = 0;
    var _currentSlot = 1;

    // ---- Migration chain ----------------------------------------------------

    function _migrate(data) {
        return data;
    }

    // ---- Old save migration -------------------------------------------------

    function _migrateOldSave() {
        try {
            var old = localStorage.getItem(OLD_SAVE_KEY);
            if (old) {
                localStorage.setItem(SAVE_KEY_PREFIX + '1', old);
                localStorage.removeItem(OLD_SAVE_KEY);
            }
        } catch (e) {
            // silent
        }
    }

    // ---- Serialization helpers ----------------------------------------------

    function _getModuleState(moduleName, module) {
        if (typeof module !== 'undefined' && module &&
            typeof module.getSerializableState === 'function') {
            return module.getSerializableState();
        }
        return null;
    }

    function _loadModuleState(moduleName, module, data) {
        if (data && typeof module !== 'undefined' && module &&
            typeof module.loadState === 'function') {
            module.loadState(data);
        }
    }

    function _getSlotKey(n) {
        return SAVE_KEY_PREFIX + n;
    }

    function _getAutosaveKey(n) {
        return AUTOSAVE_KEY_PREFIX + n;
    }

    function _buildState() {
        var state = {
            version: SAVE_VERSION,
            timestamp: Date.now()
        };
        if (typeof Engine !== 'undefined')    state.engine    = _getModuleState('Engine', Engine);
        if (typeof Map !== 'undefined')       state.map       = _getModuleState('Map', Map);
        if (typeof Buildings !== 'undefined') state.buildings  = _getModuleState('Buildings', Buildings);
        if (typeof Energy !== 'undefined')    state.energy     = _getModuleState('Energy', Energy);
        if (typeof Workers !== 'undefined')   state.workers    = _getModuleState('Workers', Workers);
        if (typeof Economy !== 'undefined')   state.economy    = _getModuleState('Economy', Economy);
        if (typeof Enemies !== 'undefined')   state.enemies    = _getModuleState('Enemies', Enemies);
        if (typeof Combat !== 'undefined')    state.combat     = _getModuleState('Combat', Combat);
        return state;
    }

    function _doAutosaveRotation() {
        try {
            // Move autosave 1 -> autosave 2
            var slot1 = localStorage.getItem(_getAutosaveKey(1));
            if (slot1) {
                localStorage.setItem(_getAutosaveKey(2), slot1);
            }
            // Save current state to autosave 1
            var state = _buildState();
            localStorage.setItem(_getAutosaveKey(1), JSON.stringify(state));
        } catch (e) {
            console.error('Autosave failed:', e);
        }
    }

    // ---- Init migration on load ---------------------------------------------
    _migrateOldSave();

    // ---- Public API ---------------------------------------------------------

    return {
        init: function () {
            _ticksSinceAutoSave = 0;
            _ticksSinceAutosaveSlot = 0;
        },

        setSlot: function (n) {
            if (n >= 1 && n <= 5) {
                _currentSlot = n;
            }
        },

        getSlot: function () {
            return _currentSlot;
        },

        getSlotInfo: function (n) {
            try {
                var raw = localStorage.getItem(_getSlotKey(n));
                if (!raw) return null;
                var data = JSON.parse(raw);
                var info = {
                    timestamp: data.timestamp || 0,
                    wave: 0,
                    difficulty: 'unknown'
                };
                if (data.engine) {
                    if (typeof data.engine.wave === 'number') info.wave = data.engine.wave;
                    if (data.engine.difficultyKey) info.difficulty = data.engine.difficultyKey;
                }
                return info;
            } catch (e) {
                return null;
            }
        },

        hasSaveInSlot: function (n) {
            return localStorage.getItem(_getSlotKey(n)) !== null;
        },

        deleteSlot: function (n) {
            localStorage.removeItem(_getSlotKey(n));
        },

        getAutosaveInfo: function (n) {
            try {
                var raw = localStorage.getItem(_getAutosaveKey(n));
                if (!raw) return null;
                var data = JSON.parse(raw);
                var info = {
                    timestamp: data.timestamp || 0,
                    wave: 0,
                    difficulty: 'unknown'
                };
                if (data.engine) {
                    if (typeof data.engine.wave === 'number') info.wave = data.engine.wave;
                    if (data.engine.difficultyKey) info.difficulty = data.engine.difficultyKey;
                }
                return info;
            } catch (e) {
                return null;
            }
        },

        loadAutosave: function (n) {
            try {
                var raw = localStorage.getItem(_getAutosaveKey(n));
                if (!raw) return false;
                var data = JSON.parse(raw);
                if (!data.version) return false;
                if (data.version < SAVE_VERSION) {
                    data = _migrate(data);
                }
                _loadModuleState('Engine',    Engine,    data.engine);
                _loadModuleState('Map',       Map,       data.map);
                _loadModuleState('Buildings', Buildings, data.buildings);
                _loadModuleState('Energy',    Energy,    data.energy);
                _loadModuleState('Workers',   Workers,   data.workers);
                _loadModuleState('Economy',   Economy,   data.economy);
                _loadModuleState('Enemies',   Enemies,   data.enemies);
                _loadModuleState('Combat',    Combat,    data.combat);
                if (typeof UI !== 'undefined') {
                    if (typeof UI.showToast === 'function') {
                        UI.showToast('Autosave ' + n + ' loaded', 'success', 2000);
                    }
                    if (typeof UI.update === 'function') {
                        UI.update();
                    }
                }
                return true;
            } catch (e) {
                console.error('Autosave load failed:', e);
                return false;
            }
        },

        /**
         * Save current game state to localStorage.
         * @returns {boolean} true on success
         */
        save: function () {
            var state = _buildState();

            try {
                localStorage.setItem(_getSlotKey(_currentSlot), JSON.stringify(state));
                if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
                    UI.showToast('Game saved (Slot ' + _currentSlot + ')', 'success', 2000);
                }
                return true;
            } catch (e) {
                console.error('Save failed:', e);
                if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
                    UI.showToast('Save failed!', 'error');
                }
                return false;
            }
        },

        /**
         * Load and restore game state from localStorage.
         * @returns {boolean} true on success
         */
        load: function () {
            try {
                var raw = localStorage.getItem(_getSlotKey(_currentSlot));
                if (!raw) return false;

                var data = JSON.parse(raw);
                if (!data.version) return false;
                if (data.version < SAVE_VERSION) {
                    data = _migrate(data);
                }

                _loadModuleState('Engine',    Engine,    data.engine);
                _loadModuleState('Map',       Map,       data.map);
                _loadModuleState('Buildings', Buildings, data.buildings);
                _loadModuleState('Energy',    Energy,    data.energy);
                _loadModuleState('Workers',   Workers,   data.workers);
                _loadModuleState('Economy',   Economy,   data.economy);
                _loadModuleState('Enemies',   Enemies,   data.enemies);
                _loadModuleState('Combat',    Combat,    data.combat);

                if (typeof UI !== 'undefined') {
                    if (typeof UI.showToast === 'function') {
                        UI.showToast('Game loaded (Slot ' + _currentSlot + ')', 'success', 2000);
                    }
                    if (typeof UI.update === 'function') {
                        UI.update();
                    }
                }
                return true;
            } catch (e) {
                console.error('Load failed:', e);
                if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
                    UI.showToast('Load failed!', 'error');
                }
                return false;
            }
        },

        /**
         * Check if ANY slot has a save.
         * @returns {boolean}
         */
        hasSave: function () {
            var i;
            for (i = 1; i <= 5; i++) {
                if (localStorage.getItem(_getSlotKey(i)) !== null) return true;
            }
            for (i = 1; i <= 2; i++) {
                if (localStorage.getItem(_getAutosaveKey(i)) !== null) return true;
            }
            return false;
        },

        /**
         * Delete saved game from current slot.
         */
        deleteSave: function () {
            localStorage.removeItem(_getSlotKey(_currentSlot));
        },

        /**
         * Called every simulation tick to handle auto-save countdown.
         */
        tick: function () {
            _ticksSinceAutoSave++;
            if (_ticksSinceAutoSave >= AUTO_SAVE_TICKS) {
                _ticksSinceAutoSave = 0;
                Save.save();
            }
            _ticksSinceAutosaveSlot++;
            if (_ticksSinceAutosaveSlot >= AUTOSAVE_INTERVAL_TICKS) {
                _ticksSinceAutosaveSlot = 0;
                _doAutosaveRotation();
            }
        },

        getSerializableState: function () {
            return _buildState();
        },

        loadState: function (data) {
            if (!data) return;
            _loadModuleState('Engine',    Engine,    data.engine);
            _loadModuleState('Map',       Map,       data.map);
            _loadModuleState('Buildings', Buildings, data.buildings);
            _loadModuleState('Energy',    Energy,    data.energy);
            _loadModuleState('Workers',   Workers,   data.workers);
            _loadModuleState('Economy',   Economy,   data.economy);
            _loadModuleState('Enemies',   Enemies,   data.enemies);
            _loadModuleState('Combat',    Combat,    data.combat);
        }
    };
})();

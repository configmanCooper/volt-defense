// ============================================================================
// Volt Defense — Save/Load Module
// Manages localStorage persistence with versioned format and auto-save.
// ============================================================================

var Save = (function () {
    var SAVE_KEY = 'voltdefense_save';
    var SAVE_VERSION = 1;
    var _autoSaveInterval = null;
    var AUTO_SAVE_TICKS = 300; // Every 30 seconds (300 ticks at 10/sec)
    var _ticksSinceAutoSave = 0;

    // ---- Migration chain ----------------------------------------------------

    function _migrate(data) {
        // Future version upgrades go here as chained if-blocks:
        // if (data.version < 2) { data = _migrateV1toV2(data); }
        // if (data.version < 3) { data = _migrateV2toV3(data); }
        return data;
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

    // ---- Public API ---------------------------------------------------------

    return {
        init: function () {
            _ticksSinceAutoSave = 0;
        },

        /**
         * Save current game state to localStorage.
         * @returns {boolean} true on success
         */
        save: function () {
            var state = {
                version: SAVE_VERSION,
                timestamp: Date.now()
            };

            // Collect state from every module that supports serialization
            if (typeof Engine !== 'undefined')    state.engine    = _getModuleState('Engine', Engine);
            if (typeof Map !== 'undefined')       state.map       = _getModuleState('Map', Map);
            if (typeof Buildings !== 'undefined') state.buildings  = _getModuleState('Buildings', Buildings);
            if (typeof Energy !== 'undefined')    state.energy     = _getModuleState('Energy', Energy);
            if (typeof Workers !== 'undefined')   state.workers    = _getModuleState('Workers', Workers);
            if (typeof Economy !== 'undefined')   state.economy    = _getModuleState('Economy', Economy);
            if (typeof Enemies !== 'undefined')   state.enemies    = _getModuleState('Enemies', Enemies);
            if (typeof Combat !== 'undefined')    state.combat     = _getModuleState('Combat', Combat);

            try {
                localStorage.setItem(SAVE_KEY, JSON.stringify(state));
                if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
                    UI.showToast('Game saved', 'success', 2000);
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
         * Modules are restored in dependency order.
         * @returns {boolean} true on success
         */
        load: function () {
            try {
                var raw = localStorage.getItem(SAVE_KEY);
                if (!raw) return false;

                var data = JSON.parse(raw);

                // Version check
                if (!data.version) return false;
                if (data.version < SAVE_VERSION) {
                    data = _migrate(data);
                }

                // Restore state to all modules (order matters!)
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
                        UI.showToast('Game loaded', 'success', 2000);
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
         * Check if a saved game exists in localStorage.
         * @returns {boolean}
         */
        hasSave: function () {
            return localStorage.getItem(SAVE_KEY) !== null;
        },

        /**
         * Delete saved game from localStorage.
         */
        deleteSave: function () {
            localStorage.removeItem(SAVE_KEY);
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
        },

        /**
         * Collect serializable state from all modules.
         * @returns {object} combined state snapshot
         */
        getSerializableState: function () {
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
        },

        /**
         * Distribute a previously collected state snapshot to all modules.
         * @param {object} data - state object from getSerializableState
         */
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

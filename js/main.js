// ============================================================================
// Volt Defense — Main Entry Point
// Wires all modules together. Loaded LAST in script order.
// ============================================================================

var Main = (function () {
    var _tickInterval = null;
    var _renderLoop = null;
    var _initialized = false;
    var _selectedDifficulty = 'volt';
    var _lastFrameTime = 0;

    // ---- Internal helpers ---------------------------------------------------

    function _getTickRate() {
        return (typeof Config !== 'undefined' && Config.TICK_RATE) ? Config.TICK_RATE : 100;
    }

    /**
     * Start a new game with the chosen difficulty.
     */
    function _startGame(difficulty) {
        var seed = Date.now() % 2147483647;
        if (seed <= 0) seed = 1;

        var diff = (typeof Config !== 'undefined' && Config.DIFFICULTY)
            ? Config.DIFFICULTY[difficulty]
            : null;

        var startMoney = (diff && diff.startMoney !== undefined)
            ? diff.startMoney
            : ((typeof Config !== 'undefined' && Config.START_MONEY) ? Config.START_MONEY : 2000);
        var startCoal = (typeof Config !== 'undefined' && Config.START_COAL) ? Config.START_COAL : 50;

        if (typeof Economy !== 'undefined' && typeof Economy.init === 'function') {
            Economy.init(999999, { iron: 9999, coal: 9999, uranium: 9999 });
        }
        if (typeof Workers !== 'undefined' && typeof Workers.loadState === 'function') {
            Workers.loadState({ totalWorkers: 50, allocatedWorkers: 0, maxCapacity: 50 });
        }

        if (typeof Engine !== 'undefined' && typeof Engine.init === 'function') {
            Engine.init(seed, difficulty);
        }

        if (typeof Economy !== 'undefined' && typeof Economy.init === 'function') {
            Economy.init(startMoney, { iron: 0, coal: startCoal, uranium: 0 });
        }

        if (typeof Workers !== 'undefined' && typeof Workers.init === 'function') {
            Workers.init();
        }

        if (typeof Render !== 'undefined' && typeof Render.init === 'function') {
            Render.init();
        }
        if (typeof UI !== 'undefined' && typeof UI.init === 'function') {
            UI.init();
        }
        if (typeof Input !== 'undefined' && typeof Input.init === 'function') {
            Input.init();
        }

        if (typeof Save !== 'undefined' && typeof Save.init === 'function') {
            Save.init();
        }

        _showScreen('game');
        _updatePauseSlotIndicator();
        _startLoops();
        _initialized = true;

        if (typeof UI !== 'undefined' && typeof UI.showToast === 'function') {
            UI.showToast(
                'Welcome to Volt Defense! Build your power grid and defend against waves of enemies.',
                'info', 5000
            );
            var waveDelay = (typeof Engine !== 'undefined' && typeof Engine.getWaveTimer === 'function')
                ? Math.ceil(Engine.getWaveTimer())
                : '?';
            UI.showToast('First wave arrives in ' + waveDelay + ' seconds!', 'warning', 5000);
        }
    }

    /**
     * Load a previously saved game from a specific slot.
     */
    function _loadGame(slot) {
        if (typeof Save === 'undefined') return;
        if (typeof slot === 'number') Save.setSlot(slot);
        if (!Save.hasSaveInSlot(Save.getSlot())) return;

        if (Save.load()) {
            if (typeof Render !== 'undefined' && typeof Render.init === 'function') {
                Render.init();
            }
            if (typeof UI !== 'undefined' && typeof UI.init === 'function') {
                UI.init();
            }
            if (typeof Input !== 'undefined' && typeof Input.init === 'function') {
                Input.init();
            }

            _showScreen('game');
            _updatePauseSlotIndicator();
            _startLoops();
            _initialized = true;
        }
    }

    // ---- Game loops ---------------------------------------------------------

    function _startLoops() {
        if (_tickInterval) clearInterval(_tickInterval);
        _tickInterval = setInterval(function () {
            if (typeof Engine === 'undefined') return;
            if (typeof Engine.isPaused === 'function' && Engine.isPaused()) return;
            if (typeof Engine.isGameOver === 'function' && Engine.isGameOver()) return;

            if (typeof Engine.tick === 'function') {
                Engine.tick();
            }
            if (typeof Save !== 'undefined' && typeof Save.tick === 'function') {
                Save.tick();
            }

            var tickCount = (typeof Engine.getTickCount === 'function') ? Engine.getTickCount() : 0;
            if (tickCount % 5 === 0 && typeof UI !== 'undefined' && typeof UI.update === 'function') {
                UI.update();
            }

            if (typeof Engine.getCoreHP === 'function' && Engine.getCoreHP() <= 0) {
                _gameOver();
            }
        }, _getTickRate());

        _lastFrameTime = performance.now();

        function renderFrame(timestamp) {
            var dt = (timestamp - _lastFrameTime) / 1000;
            _lastFrameTime = timestamp;
            if (dt > 0.1) dt = 0.1;

            if (typeof Input !== 'undefined' && typeof Input.update === 'function') {
                Input.update(dt);
            }

            if (typeof Render !== 'undefined' && typeof Render.draw === 'function') {
                Render.draw(timestamp);
            }

            _renderLoop = requestAnimationFrame(renderFrame);
        }

        _renderLoop = requestAnimationFrame(renderFrame);
    }

    function _stopLoops() {
        if (_tickInterval) {
            clearInterval(_tickInterval);
            _tickInterval = null;
        }
        if (_renderLoop) {
            cancelAnimationFrame(_renderLoop);
            _renderLoop = null;
        }
    }

    // ---- Game over ----------------------------------------------------------

    function _gameOver() {
        _stopLoops();

        var stats = {
            wave: (typeof Engine !== 'undefined' && typeof Engine.getWave === 'function')
                ? Engine.getWave() : 0,
            kills: (typeof Enemies !== 'undefined' && typeof Enemies.getTotalKills === 'function')
                ? Enemies.getTotalKills() : 0,
            time: (typeof Engine !== 'undefined' && typeof Engine.getGameTime === 'function')
                ? Engine.getGameTime() : 0,
            money: (typeof Economy !== 'undefined' && typeof Economy.getStats === 'function')
                ? Economy.getStats().totalEarned : 0,
            difficulty: (typeof Engine !== 'undefined' && typeof Engine.getDifficultyKey === 'function')
                ? Engine.getDifficultyKey() : 'unknown'
        };

        if (typeof UI !== 'undefined' && typeof UI.showGameOver === 'function') {
            UI.showGameOver(stats);
        }
    }

    // ---- Screen helpers -----------------------------------------------------

    function _showScreen(screen) {
        var menuScreen = document.getElementById('menu-screen');
        var gameScreen = document.getElementById('game-screen');

        if (screen === 'game') {
            if (menuScreen) menuScreen.style.display = 'none';
            if (gameScreen) gameScreen.style.display = '';
        } else {
            if (menuScreen) menuScreen.style.display = 'flex';
            if (gameScreen) gameScreen.style.display = 'none';
        }
    }

    // ---- Save slot UI -------------------------------------------------------

    function _buildSlotListHTML(containerId, includeAutosaves) {
        var container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        var i, info, entry, label, actions, loadBtn, delBtn, d, dateStr, diffName;

        // Regular save slots
        for (i = 1; i <= 5; i++) {
            info = (typeof Save !== 'undefined' && Save.getSlotInfo) ? Save.getSlotInfo(i) : null;
            entry = document.createElement('div');
            entry.className = 'save-slot-entry';

            label = document.createElement('div');
            label.className = 'save-slot-label';

            if (info) {
                d = new Date(info.timestamp);
                dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
                diffName = info.difficulty.charAt(0).toUpperCase() + info.difficulty.slice(1);
                label.innerHTML = '<strong>Slot ' + i + '</strong> — Wave ' + info.wave +
                    ' · ' + diffName + '<br><span class="save-slot-date">' + dateStr + '</span>';
            } else {
                label.innerHTML = '<strong>Slot ' + i + '</strong> — <span class="save-slot-empty">Empty</span>';
            }

            actions = document.createElement('div');
            actions.className = 'save-slot-actions';

            loadBtn = document.createElement('button');
            loadBtn.className = 'menu-btn save-slot-btn';
            loadBtn.textContent = 'Load';
            loadBtn.setAttribute('data-action', 'load-slot');
            loadBtn.setAttribute('data-slot', i);
            if (!info) loadBtn.disabled = true;
            actions.appendChild(loadBtn);

            if (info) {
                delBtn = document.createElement('button');
                delBtn.className = 'menu-btn save-slot-btn save-slot-del';
                delBtn.textContent = '🗑';
                delBtn.setAttribute('data-action', 'delete-slot');
                delBtn.setAttribute('data-slot', i);
                actions.appendChild(delBtn);
            }

            entry.appendChild(label);
            entry.appendChild(actions);
            container.appendChild(entry);
        }

        // Autosave slots
        if (includeAutosaves) {
            for (i = 1; i <= 2; i++) {
                info = (typeof Save !== 'undefined' && Save.getAutosaveInfo) ? Save.getAutosaveInfo(i) : null;
                if (!info) continue;

                entry = document.createElement('div');
                entry.className = 'save-slot-entry save-slot-autosave';

                label = document.createElement('div');
                label.className = 'save-slot-label';

                d = new Date(info.timestamp);
                dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
                diffName = info.difficulty.charAt(0).toUpperCase() + info.difficulty.slice(1);
                var ageLabel = (i === 1) ? '~5 min ago' : '~10 min ago';
                label.innerHTML = '<strong>Autosave ' + i + '</strong> <span class="save-slot-date">(' + ageLabel + ')</span> — Wave ' + info.wave +
                    ' · ' + diffName + '<br><span class="save-slot-date">' + dateStr + '</span>';

                actions = document.createElement('div');
                actions.className = 'save-slot-actions';

                loadBtn = document.createElement('button');
                loadBtn.className = 'menu-btn save-slot-btn';
                loadBtn.textContent = 'Load';
                loadBtn.setAttribute('data-action', 'load-autosave');
                loadBtn.setAttribute('data-slot', i);
                actions.appendChild(loadBtn);

                entry.appendChild(label);
                entry.appendChild(actions);
                container.appendChild(entry);
            }
        }
    }

    function _refreshSlotList() {
        _buildSlotListHTML('save-slot-list', true);
    }

    function _refreshPauseSlotList() {
        _buildSlotListHTML('pause-slot-list', true);
    }

    function _showSlotPicker(callback) {
        var slot = prompt('Choose a save slot (1-5):', '1');
        if (slot === null) return;
        var n = parseInt(slot, 10);
        if (isNaN(n) || n < 1 || n > 5) {
            alert('Please enter a number between 1 and 5.');
            return;
        }
        callback(n);
    }

    function _updatePauseSlotIndicator() {
        var el = document.getElementById('pause-slot-num');
        if (el && typeof Save !== 'undefined' && Save.getSlot) {
            el.textContent = Save.getSlot();
        }
    }

    // ---- Music menu controls ------------------------------------------------

    function _initMenuMusic() {
        var toggleBtn = document.getElementById('menu-music-toggle');
        var volumeSlider = document.getElementById('menu-music-volume');

        if (typeof Music !== 'undefined') {
            // Sync UI with saved settings
            if (toggleBtn) {
                toggleBtn.textContent = Music.isEnabled() ? '🔊 Music On' : '🔇 Music Off';
            }
            if (volumeSlider) {
                volumeSlider.value = Math.round(Music.getVolume() * 100);
            }

            // Start playing
            Music.play();
        }

        if (toggleBtn) {
            toggleBtn.addEventListener('click', function () {
                if (typeof Music === 'undefined') return;
                var enabled = Music.toggle();
                toggleBtn.textContent = enabled ? '🔊 Music On' : '🔇 Music Off';
            });
        }

        if (volumeSlider) {
            volumeSlider.addEventListener('input', function () {
                if (typeof Music === 'undefined') return;
                Music.setVolume(parseInt(volumeSlider.value, 10) / 100);
            });
        }
    }

    // ---- Load game from autosave or slot (in-game) ----------------------------

    function _loadGameFromAutosave(n) {
        if (typeof Save === 'undefined' || !Save.loadAutosave) return;
        _stopLoops();
        if (Save.loadAutosave(n)) {
            if (typeof Render !== 'undefined' && typeof Render.init === 'function') Render.init();
            if (typeof UI !== 'undefined' && typeof UI.init === 'function') UI.init();
            if (typeof Input !== 'undefined' && typeof Input.init === 'function') Input.init();
            _hidePauseLoadPanel();
            var po = document.getElementById('pause-overlay');
            if (po) po.style.display = 'none';
            if (typeof Engine !== 'undefined' && Engine.setPaused) Engine.setPaused(false);
            _startLoops();
            _initialized = true;
        } else {
            _startLoops();
        }
    }

    function _showLoadPanel() {
        var panel = document.getElementById('load-game-panel');
        if (panel) {
            _refreshSlotList();
            panel.style.display = '';
        }
    }

    function _hideLoadPanel() {
        var panel = document.getElementById('load-game-panel');
        if (panel) panel.style.display = 'none';
    }

    function _showPauseLoadPanel() {
        var panel = document.getElementById('pause-load-panel');
        var content = document.querySelector('.pause-content');
        if (panel) {
            _refreshPauseSlotList();
            panel.style.display = '';
        }
        if (content) content.style.display = 'none';
    }

    function _hidePauseLoadPanel() {
        var panel = document.getElementById('pause-load-panel');
        var content = document.querySelector('.pause-content');
        if (panel) panel.style.display = 'none';
        if (content) content.style.display = '';
    }

    // ---- DOM Ready & delegation ---------------------------------------------

    document.addEventListener('DOMContentLoaded', function () {
        document.addEventListener('click', function (e) {
            var target = e.target.closest('[data-action]');
            if (!target) return;

            var action = target.getAttribute('data-action');

            if (action === 'select-difficulty') {
                var difficulty = target.getAttribute('data-difficulty');
                if (difficulty && typeof Config !== 'undefined' &&
                    Config.DIFFICULTY && Config.DIFFICULTY[difficulty]) {
                    var allBtns = document.querySelectorAll('.difficulty-btn');
                    for (var bi = 0; bi < allBtns.length; bi++) {
                        allBtns[bi].classList.remove('selected');
                    }
                    target.classList.add('selected');
                    _selectedDifficulty = difficulty;
                }
            } else if (action === 'newGame' || action === 'new-game') {
                if (_selectedDifficulty) {
                    _showSlotPicker(function (slot) {
                        if (typeof Save !== 'undefined') Save.setSlot(slot);
                        _hideLoadPanel();
                        _startGame(_selectedDifficulty);
                    });
                }
            } else if (action === 'show-load-menu') {
                _showLoadPanel();
            } else if (action === 'hide-load-menu') {
                _hideLoadPanel();
            } else if (action === 'show-load-ingame') {
                _showPauseLoadPanel();
            } else if (action === 'hide-load-ingame') {
                _hidePauseLoadPanel();
            } else if (action === 'load-slot') {
                var loadSlot = parseInt(target.getAttribute('data-slot'), 10);
                if (loadSlot >= 1 && loadSlot <= 5) {
                    _hideLoadPanel();
                    _hidePauseLoadPanel();
                    _loadGame(loadSlot);
                }
            } else if (action === 'load-autosave') {
                var autoSlot = parseInt(target.getAttribute('data-slot'), 10);
                if (autoSlot >= 1 && autoSlot <= 2) {
                    if (_initialized) {
                        _loadGameFromAutosave(autoSlot);
                    } else {
                        // From main menu
                        if (typeof Save !== 'undefined' && Save.loadAutosave && Save.loadAutosave(autoSlot)) {
                            _hideLoadPanel();
                            if (typeof Render !== 'undefined' && typeof Render.init === 'function') Render.init();
                            if (typeof UI !== 'undefined' && typeof UI.init === 'function') UI.init();
                            if (typeof Input !== 'undefined' && typeof Input.init === 'function') Input.init();
                            _showScreen('game');
                            _startLoops();
                            _initialized = true;
                        }
                    }
                }
            } else if (action === 'delete-slot') {
                var delSlot = parseInt(target.getAttribute('data-slot'), 10);
                if (delSlot >= 1 && delSlot <= 5) {
                    if (typeof Save !== 'undefined' && Save.deleteSlot) {
                        Save.deleteSlot(delSlot);
                        _refreshSlotList();
                        _refreshPauseSlotList();
                    }
                }
            } else if (action === 'saveGame' || action === 'save-game') {
                if (typeof Save !== 'undefined' && typeof Save.save === 'function') {
                    Save.save();
                }
            } else if (action === 'quitToMenu' || action === 'quit-to-menu' || action === 'return-menu') {
                _stopLoops();
                _initialized = false;
                _hidePauseLoadPanel();
                var po = document.getElementById('pause-overlay');
                if (po) po.style.display = 'none';
                _showScreen('menu');
            }
        });

        // Initial screen state
        _hideLoadPanel();
        _initMenuMusic();
        _showScreen('menu');
    });

    // ---- Public API ---------------------------------------------------------

    return {
        startGame: _startGame,
        loadGame: _loadGame,
        refreshSlotList: _refreshSlotList,
        isInitialized: function () { return _initialized; }
    };
})();

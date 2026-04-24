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

    function _refreshSlotList() {
        var container = document.getElementById('save-slot-list');
        if (!container) return;
        container.innerHTML = '';

        var i;
        for (i = 1; i <= 5; i++) {
            var info = (typeof Save !== 'undefined' && Save.getSlotInfo) ? Save.getSlotInfo(i) : null;
            var entry = document.createElement('div');
            entry.className = 'save-slot-entry';

            var label = document.createElement('div');
            label.className = 'save-slot-label';

            if (info) {
                var d = new Date(info.timestamp);
                var dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
                var diffName = info.difficulty.charAt(0).toUpperCase() + info.difficulty.slice(1);
                label.innerHTML = '<strong>Slot ' + i + '</strong> — Wave ' + info.wave +
                    ' · ' + diffName + '<br><span class="save-slot-date">' + dateStr + '</span>';
            } else {
                label.innerHTML = '<strong>Slot ' + i + '</strong> — <span class="save-slot-empty">Empty</span>';
            }

            var actions = document.createElement('div');
            actions.className = 'save-slot-actions';

            var loadBtn = document.createElement('button');
            loadBtn.className = 'menu-btn save-slot-btn';
            loadBtn.textContent = 'Load';
            loadBtn.setAttribute('data-action', 'load-slot');
            loadBtn.setAttribute('data-slot', i);
            if (!info) {
                loadBtn.disabled = true;
            }

            actions.appendChild(loadBtn);

            if (info) {
                var delBtn = document.createElement('button');
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
                        _startGame(_selectedDifficulty);
                    });
                }
            } else if (action === 'load-slot') {
                var loadSlot = parseInt(target.getAttribute('data-slot'), 10);
                if (loadSlot >= 1 && loadSlot <= 5) {
                    _loadGame(loadSlot);
                }
            } else if (action === 'delete-slot') {
                var delSlot = parseInt(target.getAttribute('data-slot'), 10);
                if (delSlot >= 1 && delSlot <= 5) {
                    if (typeof Save !== 'undefined' && Save.deleteSlot) {
                        Save.deleteSlot(delSlot);
                        _refreshSlotList();
                    }
                }
            } else if (action === 'saveGame' || action === 'save-game') {
                if (typeof Save !== 'undefined' && typeof Save.save === 'function') {
                    Save.save();
                }
            } else if (action === 'quitToMenu' || action === 'quit-to-menu' || action === 'return-menu') {
                _stopLoops();
                _initialized = false;
                _showScreen('menu');
                _refreshSlotList();
            }
        });

        // Initial screen state
        _refreshSlotList();
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

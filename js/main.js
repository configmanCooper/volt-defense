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
     * Engine.init handles map generation and starting building placement.
     */
    function _startGame(difficulty) {
        var seed = Date.now() % 2147483647;
        if (seed <= 0) seed = 1;

        var diff = (typeof Config !== 'undefined' && Config.DIFFICULTY)
            ? Config.DIFFICULTY[difficulty]
            : null;

        // Initialize Economy and Workers BEFORE Engine so starting buildings can be placed
        var startMoney = (diff && diff.startMoney !== undefined)
            ? diff.startMoney
            : ((typeof Config !== 'undefined' && Config.START_MONEY) ? Config.START_MONEY : 2000);
        var startCoal = (typeof Config !== 'undefined' && Config.START_COAL) ? Config.START_COAL : 50;

        // Temporarily give excess money/workers so starting buildings pass validation
        if (typeof Economy !== 'undefined' && typeof Economy.init === 'function') {
            Economy.init(999999, { iron: 9999, coal: 9999, uranium: 9999 });
        }
        if (typeof Workers !== 'undefined' && typeof Workers.loadState === 'function') {
            Workers.loadState({ totalWorkers: 50, allocatedWorkers: 0, maxCapacity: 50 });
        }

        // Engine.init generates map + places starting buildings (core, wind, house)
        if (typeof Engine !== 'undefined' && typeof Engine.init === 'function') {
            Engine.init(seed, difficulty);
        }

        // Now reset Economy to actual starting values
        if (typeof Economy !== 'undefined' && typeof Economy.init === 'function') {
            Economy.init(startMoney, { iron: 0, coal: startCoal, uranium: 0 });
        }

        // Workers — recalculates capacity from placed housing, starts with 4 workers
        if (typeof Workers !== 'undefined' && typeof Workers.init === 'function') {
            Workers.init();
        }

        // Render, UI, Input
        if (typeof Render !== 'undefined' && typeof Render.init === 'function') {
            Render.init();
        }
        if (typeof UI !== 'undefined' && typeof UI.init === 'function') {
            UI.init();
        }
        if (typeof Input !== 'undefined' && typeof Input.init === 'function') {
            Input.init();
        }

        // Save module
        if (typeof Save !== 'undefined' && typeof Save.init === 'function') {
            Save.init();
        }

        // Show game screen, hide menu
        _showScreen('game');

        // Start simulation & render loops
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
     * Load a previously saved game.
     */
    function _loadGame() {
        if (typeof Save === 'undefined' || !Save.hasSave()) return;

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
            _startLoops();
            _initialized = true;
        }
    }

    // ---- Game loops ---------------------------------------------------------

    function _startLoops() {
        // Simulation tick — fixed interval
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

            // Update UI twice per second (every 5 ticks at 10 tps)
            var tickCount = (typeof Engine.getTickCount === 'function') ? Engine.getTickCount() : 0;
            if (tickCount % 5 === 0 && typeof UI !== 'undefined' && typeof UI.update === 'function') {
                UI.update();
            }

            // Check game over
            if (typeof Engine.getCoreHP === 'function' && Engine.getCoreHP() <= 0) {
                _gameOver();
            }
        }, _getTickRate());

        // Render loop — requestAnimationFrame
        _lastFrameTime = performance.now();

        function renderFrame(timestamp) {
            var dt = (timestamp - _lastFrameTime) / 1000;
            _lastFrameTime = timestamp;
            if (dt > 0.1) dt = 0.1; // Cap delta time

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

    /**
     * If a save exists, insert a Continue button at the top of the difficulty grid.
     */
    function _showContinueButton() {
        if (typeof Save === 'undefined' || !Save.hasSave()) return;

        var grid = document.querySelector('#difficulty-select .difficulty-grid');
        if (!grid) return;

        // Don't add if already present
        if (document.getElementById('btn-continue-game')) return;

        var continueBtn = document.createElement('button');
        continueBtn.id = 'btn-continue-game';
        continueBtn.className = 'difficulty-btn';
        continueBtn.setAttribute('data-action', 'loadGame');
        continueBtn.innerHTML =
            '<span class="diff-icon">💾</span>' +
            '<span class="diff-name">Continue</span>' +
            '<span class="diff-desc">Load saved game</span>';
        grid.insertBefore(continueBtn, grid.firstChild);
    }

    // ---- DOM Ready & delegation ---------------------------------------------

    document.addEventListener('DOMContentLoaded', function () {
        // Click delegation for menu-level actions only.
        // In-game actions (build, pause, etc.) are handled by UI.init().
        document.addEventListener('click', function (e) {
            var target = e.target.closest('[data-action]');
            if (!target) return;

            var action = target.getAttribute('data-action');

            if (action === 'select-difficulty') {
                var difficulty = target.getAttribute('data-difficulty');
                if (difficulty && typeof Config !== 'undefined' &&
                    Config.DIFFICULTY && Config.DIFFICULTY[difficulty]) {
                    // Highlight selected button green
                    var allBtns = document.querySelectorAll('.difficulty-btn');
                    for (var bi = 0; bi < allBtns.length; bi++) {
                        allBtns[bi].classList.remove('selected');
                    }
                    target.classList.add('selected');
                    _selectedDifficulty = difficulty;
                }
            } else if (action === 'newGame' || action === 'new-game') {
                if (_selectedDifficulty) {
                    _startGame(_selectedDifficulty);
                }
            } else if (action === 'loadGame' || action === 'load-game') {
                _loadGame();
            } else if (action === 'saveGame' || action === 'save-game') {
                if (typeof Save !== 'undefined' && typeof Save.save === 'function') {
                    Save.save();
                }
            } else if (action === 'quitToMenu' || action === 'quit-to-menu' || action === 'return-menu') {
                _stopLoops();
                _initialized = false;
                _showScreen('menu');
                _showContinueButton();
            }
        });

        // Initial screen state
        _showContinueButton();
        _showScreen('menu');
    });

    // ---- Public API ---------------------------------------------------------

    return {
        startGame: _startGame,
        loadGame: _loadGame,
        isInitialized: function () { return _initialized; }
    };
})();

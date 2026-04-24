// ============================================================================
// Volt Defense — UI Module
// Manages all DOM-based UI: HUD updates, build menu, info panel, toasts, modals.
// ============================================================================

var UI = (function () {
    var _elements = {};
    var _selectedCategory = null;
    var _lastCategory = '';
    var _toastQueue = [];
    var _selectedBuildingId = null;
    var _selectedEnemyId = null;
    var _maxToasts = 5;

    // ---- private helpers ----

    function _showBuildInfoCard(typeKey) {
        var card = document.getElementById('build-info-card');
        if (!card || typeof Config === 'undefined' || !Config.BUILDINGS[typeKey]) return;
        var def = Config.BUILDINGS[typeKey];
        var cost = def.cost;
        if (typeof Engine !== 'undefined' && Engine.applyDifficultyToCost) {
            cost = Engine.applyDifficultyToCost(def.cost);
        }

        var h = '<div class="bic-header">';
        h += '<span class="bic-icon">' + (def.icon || '') + '</span>';
        h += '<div><div class="bic-title">' + def.name + '</div>';
        if (def.description) h += '<div class="bic-subtitle">' + def.description + '</div>';
        h += '</div></div>';

        h += '<div class="bic-stats">';

        // Cost section
        h += '<div class="bic-section">Cost</div>';
        h += _bicStat('Money', '$' + (cost.money || 0));
        if (cost.iron) h += _bicStat('Iron', cost.iron + ' ⛏️');
        if (cost.coal) h += _bicStat('Coal', cost.coal + ' 🪨');
        if (cost.uranium) h += _bicStat('Uranium', cost.uranium + ' ☢️');
        if (cost.oil) h += _bicStat('Oil', cost.oil + ' 🛢️');
        if (def.workersRequired > 0) h += _bicStat('Workers', '👷 ' + def.workersRequired);

        // Energy section
        if (def.energyGeneration > 0 || def.energyConsumption > 0 || def.energyStorageCapacity > 0) {
            h += '<div class="bic-section">Energy</div>';
            if (def.energyGeneration > 0) {
                var genText = '+' + def.energyGeneration + '/s';
                if (typeKey === 'wind') {
                    var ws = (typeof Energy !== 'undefined' && Energy.getWindSpeed) ? Energy.getWindSpeed() : 15;
                    var baseline = (typeof Config !== 'undefined' && Config.WIND_BASELINE_SPEED) ? Config.WIND_BASELINE_SPEED : 15;
                    var maxWind = (typeof Config !== 'undefined' && Config.WIND_MAX_SPEED) ? Config.WIND_MAX_SPEED : 30;
                    var actGen = Math.round(def.energyGeneration * (ws / baseline) * 10) / 10;
                    var maxGen = Math.round(def.energyGeneration * (maxWind / baseline) * 10) / 10;
                    genText = '0-' + maxGen + '/s <span style="color:#aaa">(now: +' + actGen + ' at ' + ws + ' mph)</span>';
                } else if (typeKey === 'hydro_plant') {
                    genText = '0-' + def.energyGeneration + '/s <span style="color:#aaa">(varies by water flow)</span>';
                }
                h += _bicStat('Generation', '<span style="color:#44cc44">' + genText + '</span>');
            }
            if (def.energyConsumption > 0) h += _bicStat('Consumption', '<span style="color:#cc4444">-' + def.energyConsumption + '/s</span>');
            if (def.energyStorageCapacity > 0) h += _bicStat('Storage', def.energyStorageCapacity);
            if (def.maxChargeRate > 0) h += _bicStat('Charge Rate', def.maxChargeRate + '/s');
            if (def.maxDischargeRate > 0) h += _bicStat('Discharge', def.maxDischargeRate + '/s');
        }

        // Category-specific
        if (def.category === 'power') {
            h += '<div class="bic-section">Power Plant</div>';
            if (def.pollution > 0) h += _bicStat('Pollution', '<span style="color:#ff9800">' + def.pollution + '/gen</span>');
            else h += _bicStat('Pollution', '<span style="color:#44cc44">None ✓</span>');
            if (def.fuelCost) {
                var fuelStr = '';
                for (var fk in def.fuelCost) { if (def.fuelCost.hasOwnProperty(fk)) fuelStr += def.fuelCost[fk] + ' ' + fk; }
                h += _bicStat('Fuel', fuelStr);
                if (def.fuelInterval) h += _bicStat('Fuel Interval', (def.fuelInterval / 10) + 's');
            }
            if (def.variability) h += _bicStat('Variability', '±' + Math.round(def.variability * 100) + '%');
            if (def.requiresTerrain) h += _bicStat('Requires', def.requiresTerrain);
        }
        if (def.category === 'housing') {
            h += '<div class="bic-section">Housing</div>';
            h += _bicStat('Capacity', '👷 ' + (def.workersHoused || 0) + ' workers');
            var eff = def.workersHoused ? (def.energyConsumption / def.workersHoused).toFixed(1) : '—';
            h += _bicStat('Energy/Worker', eff + '/s');
        }
        if (def.category === 'weapons') {
            h += '<div class="bic-section">Combat</div>';
            if (def.baseDPS) h += _bicStat('Base DPS', def.baseDPS);
            if (def.damage) h += _bicStat('Damage', def.damage);
            if (def.range) h += _bicStat('Range', def.range + 'px');
            if (def.maxRamp) h += _bicStat('Max Ramp', '×' + def.maxRamp);
            if (def.baseEnergyDraw) h += _bicStat('Energy Draw', def.baseEnergyDraw + '/s (base)');
            if (def.energyPerShot) h += _bicStat('Energy/Shot', def.energyPerShot);
            if (def.reloadTicks) h += _bicStat('Reload', (def.reloadTicks / 10).toFixed(1) + 's');
            if (def.ironPerShot) h += _bicStat('Iron/Shot', def.ironPerShot);
            if (def.missileSpeed) h += _bicStat('Missile Speed', def.missileSpeed + 'px/s');
        }
        if (def.category === 'defense') {
            h += '<div class="bic-section">Shield</div>';
            if (def.shieldHP) h += _bicStat('Shield HP', def.shieldHP);
            if (def.shieldDiameter) h += _bicStat('Diameter', def.shieldDiameter + 'px');
            if (def.shieldEnergyCostPerDamage) h += _bicStat('Energy/Damage', def.shieldEnergyCostPerDamage);
        }
        if (def.category === 'mining') {
            h += '<div class="bic-section">Mining</div>';
            if (def.extractionRate) h += _bicStat('Extraction', def.extractionRate + '/s');
            if (def.requiresTerrain) h += _bicStat('Requires', def.requiresTerrain.replace(/_/g, ' '));
        }
        if (def.category === 'environment') {
            h += '<div class="bic-section">Environment</div>';
            if (def.pollutionReduction) h += _bicStat('Pollution Reduction', '<span style="color:#44cc44">-' + def.pollutionReduction + '/s</span>');
        }
        if (def.category === 'storage') {
            if (def.sellPrice) {
                h += '<div class="bic-section">Consumer</div>';
                h += _bicStat('Sell When Full', '<span style="color:#44cc44">$' + def.sellPrice + '</span>');
                var fillTime = def.energyStorageCapacity && def.maxChargeRate ? (def.energyStorageCapacity / def.maxChargeRate).toFixed(0) : '?';
                h += _bicStat('Fill Time', '~' + fillTime + 's');
            }
        }

        // General
        h += '<div class="bic-section">General</div>';
        h += _bicStat('HP', def.hp);
        h += _bicStat('Size', def.size[0] + '×' + def.size[1]);

        if (def.upgradeTo && Config.BUILDINGS[def.upgradeTo]) {
            var upDef = Config.BUILDINGS[def.upgradeTo];
            h += '<div class="bic-upgrade">⬆️ Upgrades to: <strong>' + upDef.name + '</strong> ($' + (upDef.cost.money || 0) + ')</div>';
        }

        h += '</div>'; // close bic-stats
        card.innerHTML = h;
        card.classList.add('visible');
    }

    function _bicStat(label, value) {
        return '<div class="bic-stat"><span class="bic-label">' + label + '</span><span class="bic-val">' + value + '</span></div>';
    }

    function _hideBuildInfoCard() {
        var card = document.getElementById('build-info-card');
        if (card) card.classList.remove('visible');
    }

    function _handleAction(action, target, e) {
        switch (action) {
            case 'select-difficulty':
                // Handled by main.js — just highlight here as backup
                var difficulty = target.getAttribute('data-difficulty');
                if (!difficulty) return;
                var allBtns = document.querySelectorAll('.difficulty-btn');
                for (var i = 0; i < allBtns.length; i++) {
                    allBtns[i].classList.remove('selected');
                }
                target.classList.add('selected');
                break;

            case 'select-category':
                var category = target.getAttribute('data-category');
                if (category) {
                    UI.selectCategory(category);
                }
                break;

            case 'select-building':
                var typeKey = target.getAttribute('data-building-type');
                if (!typeKey) break;

                // Check if button is disabled — explain why
                if (target.classList.contains('disabled')) {
                    var bDef = (typeof Config !== 'undefined' && Config.BUILDINGS) ? Config.BUILDINGS[typeKey] : null;
                    if (bDef) {
                        var reasons = [];
                        var bCost = bDef.cost;
                        if (typeof Engine !== 'undefined' && Engine.applyDifficultyToCost) {
                            bCost = Engine.applyDifficultyToCost(bDef.cost);
                        }
                        // Check money
                        if (bCost.money && typeof Economy !== 'undefined' && Economy.getMoney) {
                            var currentMoney = Economy.getMoney();
                            if (currentMoney < bCost.money) {
                                reasons.push('Need $' + bCost.money + ' (have $' + Math.floor(currentMoney) + ')');
                            }
                        }
                        // Check resources
                        if (bCost.iron && typeof Economy !== 'undefined' && Economy.getResource) {
                            if (Economy.getResource('iron') < bCost.iron) {
                                reasons.push('Need ' + bCost.iron + ' iron (have ' + Math.floor(Economy.getResource('iron')) + ')');
                            }
                        }
                        if (bCost.coal && typeof Economy !== 'undefined' && Economy.getResource) {
                            if (Economy.getResource('coal') < bCost.coal) {
                                reasons.push('Need ' + bCost.coal + ' coal (have ' + Math.floor(Economy.getResource('coal')) + ')');
                            }
                        }
                        if (bCost.uranium && typeof Economy !== 'undefined' && Economy.getResource) {
                            if (Economy.getResource('uranium') < bCost.uranium) {
                                reasons.push('Need ' + bCost.uranium + ' uranium (have ' + Math.floor(Economy.getResource('uranium')) + ')');
                            }
                        }
                        if (bCost.oil && typeof Economy !== 'undefined' && Economy.getResource) {
                            if (Economy.getResource('oil') < bCost.oil) {
                                reasons.push('Need ' + bCost.oil + ' oil (have ' + Math.floor(Economy.getResource('oil')) + ')');
                            }
                        }
                        // Check workers
                        var bWorkersNeeded = bDef.workersRequired || 0;
                        if (bWorkersNeeded > 0 && typeof Workers !== 'undefined' && Workers.getAvailableWorkers) {
                            var avail = Workers.getAvailableWorkers();
                            if (avail < bWorkersNeeded) {
                                reasons.push('Need ' + bWorkersNeeded + ' workers (only ' + avail + ' idle)');
                            }
                        }
                        if (reasons.length > 0) {
                            UI.showToast('Cannot build ' + bDef.name + ': ' + reasons.join(', '), 'error', 3500);
                        } else {
                            UI.showToast('Cannot build ' + bDef.name + '.', 'error', 2000);
                        }
                    }
                    _showBuildInfoCard(typeKey);
                    break;
                }

                if (typeof Input !== 'undefined' && Input.setPlacingMode) {
                    Input.setPlacingMode(typeKey);
                }
                _showBuildInfoCard(typeKey);
                // Highlight selected build button
                var allBuildBtns = document.querySelectorAll('.build-btn');
                for (var bb = 0; bb < allBuildBtns.length; bb++) {
                    allBuildBtns[bb].classList.remove('selected');
                }
                target.classList.add('selected');
                break;

            case 'upgrade-building':
                if (_selectedBuildingId && typeof Buildings !== 'undefined' && Buildings.upgrade) {
                    var upgraded = Buildings.upgrade(_selectedBuildingId);
                    if (upgraded) {
                        UI.showToast('Building upgraded!', 'success');
                        UI.showBuildingInfo(_selectedBuildingId);
                    } else {
                        UI.showToast('Cannot upgrade — check cost or workers.', 'error');
                    }
                }
                break;

            case 'sell-building':
                if (_selectedBuildingId && typeof Buildings !== 'undefined' && Buildings.remove) {
                    Buildings.remove(_selectedBuildingId);
                    UI.showToast('Building sold.', 'info');
                    UI.clearInfoPanel();
                }
                break;

            case 'pause':
                if (typeof Engine !== 'undefined' && Engine.setPaused && Engine.isPaused) {
                    Engine.setPaused(!Engine.isPaused());
                    if (Engine.isPaused()) {
                        UI.showPause();
                    } else {
                        UI.hidePause();
                    }
                }
                break;

            case 'resume':
                if (typeof Engine !== 'undefined' && Engine.setPaused) {
                    Engine.setPaused(false);
                }
                UI.hidePause();
                break;

            case 'close-modal':
                UI.hideModal();
                break;

            case 'return-to-menu':
                UI.hideModal();
                UI.showMenu();
                break;

            case 'cable-from-building':
                if (_selectedBuildingId && typeof Input !== 'undefined' && Input.startCableMode) {
                    Input.startCableMode(_selectedBuildingId, 'standard');
                }
                break;

            case 'hc-cable-from-building':
                if (_selectedBuildingId && typeof Input !== 'undefined' && Input.startCableMode) {
                    Input.startCableMode(_selectedBuildingId, 'high_capacity');
                }
                break;

            case 'show-shortcuts':
                UI.showModal('⌨️ Keyboard Shortcuts',
                    '<div style="line-height:2; font-size:13px;">' +
                    '<b>Building</b><br>' +
                    '&nbsp; <kbd>1</kbd>–<kbd>8</kbd> &nbsp; Select category<br>' +
                    '&nbsp; <kbd>ESC</kbd> &nbsp; Cancel placement / deselect<br>' +
                    '<b>Selected Building</b><br>' +
                    '&nbsp; <kbd>C</kbd> &nbsp; Connect cable<br>' +
                    '&nbsp; <kbd>Shift+C</kbd> &nbsp; HC cable ($50/tile, 500 throughput)<br>' +
                    '&nbsp; <kbd>U</kbd> &nbsp; Upgrade<br>' +
                    '&nbsp; <kbd>Del</kbd> &nbsp; Sell / demolish<br>' +
                    '<b>Camera</b><br>' +
                    '&nbsp; <kbd>W A S D</kbd> / Arrows &nbsp; Pan<br>' +
                    '&nbsp; Right-click drag &nbsp; Pan<br>' +
                    '&nbsp; Scroll wheel &nbsp; Zoom<br>' +
                    '<b>Game</b><br>' +
                    '&nbsp; <kbd>P</kbd> &nbsp; Pause / Resume<br>' +
                    '</div>',
                    [{ label: 'Got it!', action: 'close-modal', className: 'menu-btn' }]
                );
                break;

            case 'show-glossary':
                UI.showGlossary();
                break;

            case 'save-game':
                if (typeof Save !== 'undefined' && Save.saveGame) {
                    Save.saveGame();
                    UI.showToast('Game saved!', 'success');
                }
                break;

            case 'quit-to-menu':
                if (typeof Engine !== 'undefined' && Engine.setPaused) {
                    Engine.setPaused(false);
                }
                UI.hidePause();
                UI.showMenu();
                break;
        }
    }

    function _getRefundAmount(building) {
        if (!building || typeof Config === 'undefined' || !Config.BUILDINGS) return 0;
        var def = Config.BUILDINGS[building.type];
        if (!def || !def.cost) return 0;
        var ratio = (typeof Buildings !== 'undefined' && Buildings.getRefundRatio)
            ? Buildings.getRefundRatio(building.id) : 0.5;
        var cost = def.cost;
        if (typeof Engine !== 'undefined' && Engine.applyDifficultyToCost) {
            cost = Engine.applyDifficultyToCost(def.cost);
        }
        return Math.floor((cost.money || 0) * ratio);
    }

    function _removeToast(toastEl) {
        if (!toastEl || !toastEl.parentNode) return;
        toastEl.classList.add('toast-exit');
        setTimeout(function () {
            if (toastEl.parentNode) {
                toastEl.parentNode.removeChild(toastEl);
            }
            var idx = _toastQueue.indexOf(toastEl);
            if (idx !== -1) _toastQueue.splice(idx, 1);
        }, 300);
    }

    function _updateInfoPanelLive() {
        // Live update for selected enemy
        if (_selectedEnemyId) {
            if (typeof Enemies === 'undefined' || !Enemies.getById) return;
            var enemy = Enemies.getById(_selectedEnemyId);
            if (!enemy || enemy.hp <= 0) {
                _selectedEnemyId = null;
                if (_elements.infoPanel) {
                    _elements.infoPanel.innerHTML = '';
                    _elements.infoPanel.style.display = 'none';
                }
                return;
            }
            var hpFill = document.getElementById('info-hp-fill');
            var hpText = document.getElementById('info-hp-text');
            if (hpFill && hpText) {
                var hpPct = enemy.maxHp > 0 ? Math.floor((enemy.hp / enemy.maxHp) * 100) : 0;
                hpFill.style.width = hpPct + '%';
                hpText.textContent = Math.floor(enemy.hp) + '/' + enemy.maxHp + ' HP';
            }
            return;
        }

        if (!_selectedBuildingId) return;
        if (typeof Buildings === 'undefined' || !Buildings.getById) return;
        var building = Buildings.getById(_selectedBuildingId);
        if (!building) return;

        // Update HP
        var hpFill = document.getElementById('info-hp-fill');
        var hpText = document.getElementById('info-hp-text');
        if (hpFill && hpText) {
            var hpPct = building.maxHp > 0 ? Math.floor((building.hp / building.maxHp) * 100) : 0;
            hpFill.style.width = hpPct + '%';
            hpText.textContent = Math.floor(building.hp) + '/' + building.maxHp + ' HP';
        }

        // Update stored energy
        var energyText = document.getElementById('info-energy-text');
        if (energyText) {
            energyText.textContent = Math.floor(building.energy);
        }

        // Update shield HP
        var shieldText = document.getElementById('info-shield-text');
        if (shieldText) {
            shieldText.textContent = Math.floor(building.shieldHP || 0);
        }

        // Update sell amount (time-based refund)
        var sellAmount = document.getElementById('info-sell-amount');
        var sellPct = document.getElementById('info-sell-pct');
        if (sellAmount) {
            sellAmount.textContent = _getRefundAmount(building);
        }
        if (sellPct && typeof Buildings !== 'undefined' && Buildings.getRefundRatio) {
            sellPct.textContent = Math.round(Buildings.getRefundRatio(building.id) * 100) + '%';
        }
    }

    // ---- public API ----

    return {
        init: function () {
            _elements = {
                menuScreen: document.getElementById('menu-screen'),
                gameScreen: document.getElementById('game-screen'),
                canvas: document.getElementById('game-canvas'),
                wave: document.getElementById('hud-wave'),
                waveTimer: document.getElementById('hud-wave-timer'),
                money: document.getElementById('hud-money'),
                iron: document.getElementById('hud-iron'),
                coal: document.getElementById('hud-coal'),
                uranium: document.getElementById('hud-uranium'),
                oil: document.getElementById('hud-oil'),
                workers: document.getElementById('hud-workers'),
                energy: document.getElementById('hud-energy'),
                pollution: document.getElementById('hud-pollution'),
                coreHp: document.getElementById('hud-core-hp'),
                buildCategories: document.getElementById('build-categories'),
                buildOptions: document.getElementById('build-submenu'),
                infoPanel: document.getElementById('info-panel'),
                toastContainer: document.getElementById('toast-container'),
                modalOverlay: document.getElementById('modal-overlay'),
                modalContent: document.getElementById('modal-body'),
                pauseOverlay: document.getElementById('pause-overlay'),
                modeIndicator: document.getElementById('mode-indicator'),
                daynight: document.getElementById('hud-daynight'),
                wind: document.getElementById('hud-wind')
            };

            document.addEventListener('click', function (e) {
                var target = e.target.closest('[data-action]');
                if (!target) return;
                var action = target.getAttribute('data-action');
                _handleAction(action, target, e);
            });
        },

        update: function () {
            if (typeof Engine === 'undefined' || !Engine.getState) return;
            var state = Engine.getState();
            if (!state) return;

            if (_elements.wave) {
                _elements.wave.textContent = state.wave;
            }
            if (_elements.waveTimer) {
                _elements.waveTimer.textContent = Math.ceil(Engine.getWaveTimer()) + 's';
            }
            if (_elements.money && typeof Economy !== 'undefined' && Economy.getMoney) {
                _elements.money.textContent = UI.formatNumber(Economy.getMoney());
            }
            if (_elements.iron && typeof Economy !== 'undefined' && Economy.getResource) {
                _elements.iron.textContent = Math.floor(Economy.getResource('iron'));
            }
            if (_elements.coal && typeof Economy !== 'undefined' && Economy.getResource) {
                _elements.coal.textContent = Math.floor(Economy.getResource('coal'));
            }
            if (_elements.uranium && typeof Economy !== 'undefined' && Economy.getResource) {
                _elements.uranium.textContent = Math.floor(Economy.getResource('uranium'));
            }
            if (_elements.oil && typeof Economy !== 'undefined' && Economy.getResource) {
                _elements.oil.textContent = Math.floor(Economy.getResource('oil'));
            }
            if (_elements.workers && typeof Workers !== 'undefined' && Workers.getTotalWorkers && Workers.getMaxCapacity) {
                var totalW = Workers.getTotalWorkers();
                var maxW = Workers.getMaxCapacity();
                var availW = (typeof Workers.getAvailableWorkers === 'function') ? Workers.getAvailableWorkers() : 0;
                _elements.workers.textContent = totalW + '/' + maxW + ' (' + availW + ' idle)';
            }
            if (_elements.energy && typeof Energy !== 'undefined' && Energy.getStats) {
                var eStats = Energy.getStats();
                _elements.energy.textContent = Math.floor(eStats.totalStored) + '/' +
                    eStats.totalCapacity + ' (+' + Math.floor(eStats.totalGeneration) + ')';
            }
            if (_elements.pollution && Engine.getPollution && Engine.getPollutionLevel) {
                var poll = Engine.getPollution();
                var pollLevel = Engine.getPollutionLevel();
                _elements.pollution.textContent = Math.floor(poll);
                _elements.pollution.className = 'hud-value pollution-' + pollLevel;
            }
            if (_elements.coreHp && Engine.getCoreHP) {
                var maxHP = (typeof Config !== 'undefined' && Config.CORE_HP) ? Config.CORE_HP : 100;
                _elements.coreHp.textContent = Engine.getCoreHP() + '/' + maxHP;
            }
            if (_elements.daynight && typeof Energy !== 'undefined' && Energy.isDay) {
                var isDay = Energy.isDay();
                _elements.daynight.textContent = isDay ? '☀️ Day' : '🌙 Night';
            }
            if (_elements.wind && typeof Energy !== 'undefined' && Energy.getWindSpeed) {
                _elements.wind.textContent = '🌬️ ' + Energy.getWindSpeed() + 'mph';
            }

            // Live-update info panel if a building is selected
            _updateInfoPanelLive();

            // Refresh build options affordability if category is open
            if (_selectedCategory && _elements.buildOptions) {
                UI._refreshBuildAffordability();
            }

            // Update mode indicator
            if (_elements.modeIndicator) {
                var inputState = (typeof Input !== 'undefined' && Input.getState) ? Input.getState() : 'idle';
                if (inputState === 'placing') {
                    var placingType = (typeof Input !== 'undefined' && Input.getPlacingType) ? Input.getPlacingType() : '';
                    var placingName = placingType;
                    if (typeof Config !== 'undefined' && Config.BUILDINGS && Config.BUILDINGS[placingType]) {
                        placingName = Config.BUILDINGS[placingType].name;
                    }
                    _elements.modeIndicator.textContent = '🔨 Placing: ' + placingName + '  [ESC to cancel]';
                    _elements.modeIndicator.className = 'mode-placing';
                    _elements.modeIndicator.style.display = 'block';
                } else if (inputState === 'cable') {
                    var ct = (typeof Input !== 'undefined' && Input.getCableType) ? Input.getCableType() : 'standard';
                    var cLabel = ct === 'high_capacity' ? 'HC Cable' : 'Cable';
                    _elements.modeIndicator.textContent = '🔌 ' + cLabel + ' Mode — Click a building to connect  [ESC to cancel]';
                    _elements.modeIndicator.className = 'mode-cable';
                    _elements.modeIndicator.style.display = 'block';
                } else {
                    _elements.modeIndicator.style.display = 'none';
                }
            }

            // Core HP danger flash
            if (_elements.coreHp && Engine.getCoreHP) {
                var maxHP2 = (typeof Config !== 'undefined' && Config.CORE_HP) ? Config.CORE_HP : 100;
                var hpPct2 = Engine.getCoreHP() / maxHP2;
                if (hpPct2 <= 0.25) {
                    _elements.coreHp.className = 'hud-value core-hp-critical';
                } else if (hpPct2 <= 0.5) {
                    _elements.coreHp.className = 'hud-value core-hp-warning';
                } else {
                    _elements.coreHp.className = 'hud-value';
                }
            }
        },

        // ---- Build menu ----

        _refreshBuildAffordability: function () {
            if (!_elements.buildOptions) return;
            var btns = _elements.buildOptions.querySelectorAll('.build-btn');
            for (var i = 0; i < btns.length; i++) {
                var key = btns[i].getAttribute('data-building-type');
                if (!key) continue;
                var def = (typeof Config !== 'undefined' && Config.BUILDINGS) ? Config.BUILDINGS[key] : null;
                if (!def) continue;
                var canAfford = (typeof Economy !== 'undefined' && Economy.canAfford)
                    ? Economy.canAfford(def.cost) : true;
                var hasWorkers = (typeof Workers !== 'undefined' && Workers.canAllocate)
                    ? Workers.canAllocate(def.workersRequired || 0) : true;
                if (!canAfford || !hasWorkers) {
                    btns[i].classList.add('disabled');
                } else {
                    btns[i].classList.remove('disabled');
                }
            }
        },

        selectCategory: function (category) {
            // Skip rebuild if same category
            if (category === _lastCategory) return;
            _lastCategory = category;
            _selectedCategory = category;

            // Highlight active category button
            if (_elements.buildCategories) {
                var catButtons = _elements.buildCategories.querySelectorAll('[data-action="select-category"]');
                for (var i = 0; i < catButtons.length; i++) {
                    if (catButtons[i].getAttribute('data-category') === category) {
                        catButtons[i].classList.add('active');
                    } else {
                        catButtons[i].classList.remove('active');
                    }
                }
            }

            if (!_elements.buildOptions) return;
            _elements.buildOptions.style.display = 'flex';
            if (typeof Config === 'undefined' || !Config.getBuildingsInCategory) {
                _elements.buildOptions.innerHTML = '';
                return;
            }

            var buildings = Config.getBuildingsInCategory(category);
            var html = '';
            for (var j = 0; j < buildings.length; j++) {
                var key = buildings[j][0];
                var def = buildings[j][1];
                if (key === 'core') continue;
                if (def.buildable === false) continue;

                var cost = def.cost;
                if (typeof Engine !== 'undefined' && Engine.applyDifficultyToCost) {
                    cost = Engine.applyDifficultyToCost(def.cost);
                }
                var canAfford = (typeof Economy !== 'undefined' && Economy.canAfford)
                    ? Economy.canAfford(def.cost) : true;
                var hasWorkers = (typeof Workers !== 'undefined' && Workers.canAllocate)
                    ? Workers.canAllocate(def.workersRequired || 0) : true;
                var disabled = (!canAfford || !hasWorkers) ? ' disabled' : '';

                html += '<button class="build-btn' + disabled + '" data-action="select-building" data-building-type="' + key + '">';
                html += '<span class="build-icon">' + (def.icon || '') + '</span>';
                html += '<span class="build-name">' + def.name + '</span>';
                html += '<span class="build-cost">$' + (cost.money || 0);
                if (cost.iron) html += ' +' + cost.iron + '⛏️';
                if (cost.coal) html += ' +' + cost.coal + '🪨';
                if (cost.uranium) html += ' +' + cost.uranium + '☢️';
                if (cost.oil) html += ' +' + cost.oil + '🛢️';
                html += '</span>';
                if (def.workersRequired > 0) {
                    html += '<span class="build-workers">👷' + def.workersRequired + '</span>';
                }
                // Tooltip with full stats
                html += '<div class="build-tooltip">';
                html += '<div class="tt-name">' + (def.icon || '') + ' ' + def.name + '</div>';
                if (def.description) {
                    html += '<div class="tt-desc">' + def.description + '</div>';
                }
                html += '<div class="tt-section">Cost</div>';
                html += '<div class="tt-row"><span class="tt-label">Money</span><span class="tt-value">$' + (cost.money || 0) + '</span></div>';
                if (cost.iron) html += '<div class="tt-row"><span class="tt-label">Iron</span><span class="tt-value">' + cost.iron + '</span></div>';
                if (cost.coal) html += '<div class="tt-row"><span class="tt-label">Coal</span><span class="tt-value">' + cost.coal + '</span></div>';
                if (cost.uranium) html += '<div class="tt-row"><span class="tt-label">Uranium</span><span class="tt-value">' + cost.uranium + '</span></div>';
                if (def.workersRequired > 0) {
                    html += '<div class="tt-row"><span class="tt-label">Workers</span><span class="tt-value">👷 ' + def.workersRequired + '</span></div>';
                }
                // Energy stats
                if (def.energyGeneration > 0 || def.energyConsumption > 0 || def.energyStorageCapacity > 0) {
                    html += '<div class="tt-section">Energy</div>';
                    if (def.energyGeneration > 0) {
                        var ttGenText = '+' + def.energyGeneration + '/s';
                        if (key === 'wind') {
                            var ttWs = (typeof Energy !== 'undefined' && Energy.getWindSpeed) ? Energy.getWindSpeed() : 15;
                            var ttBase = (typeof Config !== 'undefined' && Config.WIND_BASELINE_SPEED) ? Config.WIND_BASELINE_SPEED : 15;
                            var ttMaxWind = (typeof Config !== 'undefined' && Config.WIND_MAX_SPEED) ? Config.WIND_MAX_SPEED : 30;
                            var ttActGen = Math.round(def.energyGeneration * (ttWs / ttBase) * 10) / 10;
                            var ttMaxGen = Math.round(def.energyGeneration * (ttMaxWind / ttBase) * 10) / 10;
                            ttGenText = '0-' + ttMaxGen + '/s (now: +' + ttActGen + ' at ' + ttWs + ' mph)';
                        } else if (key === 'hydro_plant') {
                            ttGenText = '0-' + def.energyGeneration + '/s (varies by water flow)';
                        }
                        html += '<div class="tt-row"><span class="tt-label">Generation</span><span class="tt-value" style="color:#44cc44">' + ttGenText + '</span></div>';
                    }
                    if (def.energyConsumption > 0) html += '<div class="tt-row"><span class="tt-label">Consumption</span><span class="tt-value" style="color:#cc4444">-' + def.energyConsumption + '/s</span></div>';
                    if (def.energyStorageCapacity > 0) html += '<div class="tt-row"><span class="tt-label">Storage</span><span class="tt-value">' + def.energyStorageCapacity + '</span></div>';
                    if (def.maxChargeRate > 0) html += '<div class="tt-row"><span class="tt-label">Charge Rate</span><span class="tt-value">' + def.maxChargeRate + '/s</span></div>';
                }
                // Category-specific stats
                if (def.category === 'power') {
                    html += '<div class="tt-section">Power</div>';
                    if (def.pollution > 0) html += '<div class="tt-row"><span class="tt-label">Pollution</span><span class="tt-value" style="color:#ff9800">' + def.pollution + '/gen</span></div>';
                    if (def.fuelCost) {
                        var fuelStr = '';
                        for (var fk in def.fuelCost) { fuelStr += def.fuelCost[fk] + ' ' + fk; }
                        html += '<div class="tt-row"><span class="tt-label">Fuel</span><span class="tt-value">' + fuelStr + '</span></div>';
                    }
                    if (def.variability) html += '<div class="tt-row"><span class="tt-label">Variability</span><span class="tt-value">±' + Math.round(def.variability * 100) + '%</span></div>';
                    if (def.requiresTerrain) html += '<div class="tt-row"><span class="tt-label">Requires</span><span class="tt-value">' + def.requiresTerrain + '</span></div>';
                }
                if (def.category === 'housing') {
                    html += '<div class="tt-section">Housing</div>';
                    html += '<div class="tt-row"><span class="tt-label">Workers Housed</span><span class="tt-value">' + (def.workersHoused || 0) + '</span></div>';
                    var efficiency = def.workersHoused ? (def.energyConsumption / def.workersHoused).toFixed(1) : '—';
                    html += '<div class="tt-row"><span class="tt-label">Energy/Worker</span><span class="tt-value">' + efficiency + '</span></div>';
                }
                if (def.category === 'weapons') {
                    html += '<div class="tt-section">Combat</div>';
                    if (def.baseDPS) html += '<div class="tt-row"><span class="tt-label">Base DPS</span><span class="tt-value">' + def.baseDPS + '</span></div>';
                    if (def.damage) html += '<div class="tt-row"><span class="tt-label">Damage</span><span class="tt-value">' + def.damage + '</span></div>';
                    if (def.range) html += '<div class="tt-row"><span class="tt-label">Range</span><span class="tt-value">' + def.range + 'px</span></div>';
                    if (def.maxRamp) html += '<div class="tt-row"><span class="tt-label">Max Ramp</span><span class="tt-value">×' + def.maxRamp + '</span></div>';
                    if (def.reloadTicks) html += '<div class="tt-row"><span class="tt-label">Reload</span><span class="tt-value">' + (def.reloadTicks / 10).toFixed(1) + 's</span></div>';
                    if (def.ironPerShot) html += '<div class="tt-row"><span class="tt-label">Iron/Shot</span><span class="tt-value">' + def.ironPerShot + '</span></div>';
                }
                if (def.category === 'defense') {
                    html += '<div class="tt-section">Shield</div>';
                    if (def.shieldHP) html += '<div class="tt-row"><span class="tt-label">Shield HP</span><span class="tt-value">' + def.shieldHP + '</span></div>';
                    if (def.shieldDiameter) html += '<div class="tt-row"><span class="tt-label">Diameter</span><span class="tt-value">' + def.shieldDiameter + 'px</span></div>';
                }
                if (def.category === 'mining') {
                    html += '<div class="tt-section">Mining</div>';
                    if (def.extractionRate) html += '<div class="tt-row"><span class="tt-label">Extraction</span><span class="tt-value">' + def.extractionRate + '/s</span></div>';
                    if (def.requiresTerrain) html += '<div class="tt-row"><span class="tt-label">Requires</span><span class="tt-value">' + def.requiresTerrain.replace('_', ' ') + '</span></div>';
                }
                if (def.category === 'environment') {
                    html += '<div class="tt-section">Environment</div>';
                    if (def.pollutionReduction) html += '<div class="tt-row"><span class="tt-label">Pollution Reduction</span><span class="tt-value" style="color:#44cc44">-' + def.pollutionReduction + '/s</span></div>';
                }
                if (def.category === 'storage') {
                    html += '<div class="tt-section">Storage</div>';
                    if (def.maxDischargeRate > 0) html += '<div class="tt-row"><span class="tt-label">Discharge Rate</span><span class="tt-value">' + def.maxDischargeRate + '/s</span></div>';
                    if (def.sellPrice) html += '<div class="tt-row"><span class="tt-label">Sell When Full</span><span class="tt-value" style="color:#44cc44">$' + def.sellPrice + '</span></div>';
                }
                // HP and upgrade info
                html += '<div class="tt-section">General</div>';
                html += '<div class="tt-row"><span class="tt-label">HP</span><span class="tt-value">' + def.hp + '</span></div>';
                html += '<div class="tt-row"><span class="tt-label">Size</span><span class="tt-value">' + def.size[0] + '×' + def.size[1] + '</span></div>';
                if (def.upgradeTo) {
                    var upgName = (typeof Config !== 'undefined' && Config.BUILDINGS[def.upgradeTo]) ? Config.BUILDINGS[def.upgradeTo].name : def.upgradeTo;
                    html += '<div class="tt-row"><span class="tt-label">Upgrades to</span><span class="tt-value" style="color:#66aaff">' + upgName + '</span></div>';
                }
                html += '</div>'; // close tooltip
                html += '</button>';
            }
            _elements.buildOptions.innerHTML = html;
        },

        clearCategory: function () {
            _selectedCategory = null;
            _lastCategory = '';
            _hideBuildInfoCard();
            if (_elements.buildOptions) {
                _elements.buildOptions.innerHTML = '';
                _elements.buildOptions.style.display = 'none';
            }
            if (_elements.buildCategories) {
                var catButtons = _elements.buildCategories.querySelectorAll('[data-action="select-category"]');
                for (var i = 0; i < catButtons.length; i++) {
                    catButtons[i].classList.remove('active');
                }
            }
        },

        // ---- Info panel ----

        showBuildingInfo: function (buildingId) {
            if (typeof Buildings === 'undefined' || !Buildings.getById) return;
            var building = Buildings.getById(buildingId);
            if (!building) return;
            if (typeof Config === 'undefined' || !Config.BUILDINGS) return;
            var def = Config.BUILDINGS[building.type];
            if (!def) return;

            _selectedBuildingId = buildingId;
            _selectedEnemyId = null;

            var hpPct = building.maxHp > 0 ? Math.floor((building.hp / building.maxHp) * 100) : 0;
            var html = '';
            html += '<div class="info-header">';
            html += '<span class="info-icon">' + (def.icon || '') + '</span>';
            html += '<span class="info-name">' + def.name + '</span>';
            html += '</div>';

            // HP bar (live-updated)
            html += '<div class="info-hp">';
            html += '<div class="hp-bar"><div class="hp-fill" id="info-hp-fill" style="width:' + hpPct + '%"></div></div>';
            html += '<span id="info-hp-text">' + Math.floor(building.hp) + '/' + building.maxHp + ' HP</span>';
            html += '</div>';

            // Energy info
            if (def.energyGeneration > 0) {
                var actualGen = def.energyGeneration;
                var genLabel = '';
                if (building.type === 'wind') {
                    var ws = (typeof Energy !== 'undefined' && Energy.getWindSpeed) ? Energy.getWindSpeed() : 15;
                    var baseline = (typeof Config !== 'undefined' && Config.WIND_BASELINE_SPEED) ? Config.WIND_BASELINE_SPEED : 15;
                    actualGen = Math.round(def.energyGeneration * (ws / baseline) * 10) / 10;
                    genLabel = ' (wind: ' + ws + ' mph)';
                } else if (building.type === 'hydro_plant') {
                    var effSpeed = 15;
                    if (typeof Map !== 'undefined' && typeof Map.getEffectiveWaterSpeed === 'function') {
                        effSpeed = Map.getEffectiveWaterSpeed(building.gridX, building.gridY);
                    }
                    actualGen = Math.round(def.energyGeneration * (effSpeed / 15) * 10) / 10;
                    genLabel = ' (flow: ' + Math.round(effSpeed * 10) / 10 + ' mph)';
                } else if (building.type === 'solar') {
                    var isDay = (typeof Energy !== 'undefined' && Energy.isDay) ? Energy.isDay() : true;
                    if (!isDay) { actualGen = 0; genLabel = ' (night)'; }
                    else { genLabel = ' (day)'; }
                }
                html += '<div class="info-stat">⚡ Generation: ' + actualGen + '/s' + genLabel + '</div>';
            }
            if (def.energyConsumption > 0) {
                html += '<div class="info-stat">⚡ Consumption: ' + def.energyConsumption + '/s</div>';
            }
            if (def.energyStorageCapacity > 0) {
                html += '<div class="info-stat">🔋 Stored: <span id="info-energy-text">' + Math.floor(building.energy) + '</span>/' + def.energyStorageCapacity + '</div>';
            }

            // Workers
            if (def.workersRequired > 0) {
                html += '<div class="info-stat">👷 Workers: ' + def.workersRequired + '</div>';
            }
            if (def.workersHoused > 0) {
                html += '<div class="info-stat">🏠 Houses: ' + def.workersHoused + ' workers</div>';
            }

            // Weapon stats
            if (def.damage) {
                html += '<div class="info-stat">⚔️ Damage: ' + def.damage + '</div>';
            }
            if (def.fireRate) {
                html += '<div class="info-stat">🔥 Fire Rate: ' + def.fireRate + '/s</div>';
            }
            if (def.range) {
                html += '<div class="info-stat">🎯 Range: ' + def.range + 'px</div>';
            }

            // Shield stats (live-updated)
            if (def.shieldHP > 0) {
                html += '<div class="info-stat">🛡️ Shield: <span id="info-shield-text">' + Math.floor(building.shieldHP || 0) + '</span>/' + def.shieldHP + '</div>';
            }

            // Pollution
            if (def.pollution > 0) {
                html += '<div class="info-stat">🏭 Pollution: +' + def.pollution + '/tick</div>';
            }
            if (def.pollutionReduction > 0) {
                html += '<div class="info-stat">🌿 Cleans: -' + def.pollutionReduction + '/tick</div>';
            }

            // Mining
            if (def.extractionRate) {
                html += '<div class="info-stat">⛏️ Extraction: ' + def.extractionRate + '/s</div>';
            }

            // Description
            html += '<div class="info-desc">' + (def.description || '') + '</div>';

            // Connected cables section
            if (typeof Buildings !== 'undefined' && Buildings.getCablesForBuilding) {
                var cables = Buildings.getCablesForBuilding(buildingId);
                if (cables && cables.length > 0) {
                    var isStorage = (def.category === 'storage');
                    var isPylon = (building.type === 'pylon' || building.type === 'hc_pylon');
                    var sectionTitle = isStorage ? 'Cable Flow Rules' : (isPylon ? 'Cable Priorities' : 'Connected Cables');
                    html += '<div class="info-cable-rules">';
                    html += '<div class="info-stat" style="font-weight:bold;margin-bottom:4px;">' + sectionTitle + '</div>';
                    for (var ci = 0; ci < cables.length; ci++) {
                        var cable = cables[ci];
                        var neighborId = (cable.from === buildingId) ? cable.to : cable.from;
                        var neighbor = Buildings.getById(neighborId);
                        var neighborName = 'Building #' + neighborId;
                        var neighborIcon = '';
                        if (neighbor) {
                            var nDef = Config.BUILDINGS[neighbor.type];
                            neighborName = nDef ? nDef.name : neighbor.type;
                            neighborIcon = (nDef && nDef.icon) ? nDef.icon + ' ' : '';
                        }
                        var cableLabel = cable.type === 'high_capacity' ? '⚡' : '🔌';
                        html += '<div class="cable-rule-row" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;gap:4px;">';
                        html += '<span style="font-size:12px;flex:1;">' + cableLabel + ' → ' + neighborIcon + neighborName + '</span>';
                        // Flow rule dropdown for storage buildings
                        if (isStorage) {
                            var currentRule = Buildings.getCableRule(buildingId, neighborId);
                            html += '<select class="cable-rule-select" data-building-id="' + buildingId + '" data-neighbor-id="' + neighborId + '" style="font-size:11px;padding:2px 4px;background:#1a1a2e;color:#e0e0ff;border:1px solid #444;border-radius:3px;">';
                            html += '<option value="both"' + (currentRule === 'both' ? ' selected' : '') + '>Both</option>';
                            html += '<option value="charge"' + (currentRule === 'charge' ? ' selected' : '') + '>Charge Only</option>';
                            html += '<option value="discharge"' + (currentRule === 'discharge' ? ' selected' : '') + '>Discharge Only</option>';
                            html += '</select>';
                        }
                        // Priority dropdown for pylons
                        if (isPylon) {
                            var curPri = Buildings.getCablePriority(buildingId, neighborId);
                            html += '<select class="cable-priority-select" data-building-id="' + buildingId + '" data-neighbor-id="' + neighborId + '" style="font-size:11px;padding:2px 4px;background:#1a1a2e;color:#e0e0ff;border:1px solid #444;border-radius:3px;">';
                            for (var pi = 1; pi <= 5; pi++) {
                                html += '<option value="' + pi + '"' + (curPri === pi ? ' selected' : '') + '>P' + pi + '</option>';
                            }
                            html += '</select>';
                        }
                        // Upgrade button for standard cables
                        if (cable.type !== 'high_capacity') {
                            html += '<button class="cable-upgrade-btn" data-from-id="' + cable.from + '" data-to-id="' + cable.to + '" style="font-size:10px;padding:2px 6px;background:#2a2a4e;color:#ffcc00;border:1px solid #555;border-radius:3px;cursor:pointer;">⚡ Upgrade</button>';
                        }
                        // Disconnect button
                        html += '<button class="cable-disconnect-btn" data-from-id="' + cable.from + '" data-to-id="' + cable.to + '" style="font-size:10px;padding:2px 6px;background:#2a2a4e;color:#ff4444;border:1px solid #555;border-radius:3px;cursor:pointer;">✂️</button>';
                        html += '</div>';
                    }
                    html += '</div>';
                }
            }

            // Buttons
            html += '<div class="info-actions">';
            // Cable button
            html += '<button class="info-btn" data-action="cable-from-building">🔌 Cable [C]</button>';
            html += '<button class="info-btn" data-action="hc-cable-from-building">⚡ HC Cable ($50/tile)</button>';
            if (def.upgradeTo && Config.BUILDINGS[def.upgradeTo]) {
                var upgradeDef = Config.BUILDINGS[def.upgradeTo];
                var nextCost = upgradeDef.cost || {};
                var curCost = def.cost || {};
                var netMoney = Math.max(0, (nextCost.money || 0) - Math.floor((curCost.money || 0) * 0.5));
                var costParts = ['$' + netMoney];
                var netIron = Math.max(0, (nextCost.iron || 0) - Math.floor((curCost.iron || 0) * 0.5));
                if (netIron > 0) costParts.push(netIron + ' iron');
                var netCoal = Math.max(0, (nextCost.coal || 0) - Math.floor((curCost.coal || 0) * 0.5));
                if (netCoal > 0) costParts.push(netCoal + ' coal');
                var netUranium = Math.max(0, (nextCost.uranium || 0) - Math.floor((curCost.uranium || 0) * 0.5));
                if (netUranium > 0) costParts.push(netUranium + ' uranium');
                html += '<button class="info-btn upgrade" data-action="upgrade-building">⬆️ Upgrade to ' + upgradeDef.name + ' — ' + costParts.join(', ') + ' [U]</button>';
            }
            if (building.type !== 'core') {
                var refund = _getRefundAmount(building);
                var pct = (typeof Buildings !== 'undefined' && Buildings.getRefundRatio)
                    ? Math.round(Buildings.getRefundRatio(building.id) * 100) : 50;
                html += '<button class="info-btn sell" data-action="sell-building" id="info-sell-btn">💰 Sell ($<span id="info-sell-amount">' + refund + '</span>) <span id="info-sell-pct" style="font-size:10px;opacity:0.7;">' + pct + '%</span> [Del]</button>';
            }
            html += '</div>';

            if (_elements.infoPanel) {
                _elements.infoPanel.innerHTML = html;
                _elements.infoPanel.style.display = 'block';

                // Wire up cable rule dropdowns
                var ruleSelects = _elements.infoPanel.querySelectorAll('.cable-rule-select');
                for (var rs = 0; rs < ruleSelects.length; rs++) {
                    ruleSelects[rs].addEventListener('change', function () {
                        var bId = parseInt(this.getAttribute('data-building-id'));
                        var nId = parseInt(this.getAttribute('data-neighbor-id'));
                        var rule = this.value;
                        if (typeof Buildings !== 'undefined' && Buildings.setCableRule) {
                            Buildings.setCableRule(bId, nId, rule);
                        }
                    });
                }

                // Wire up cable upgrade buttons
                var upgBtns = _elements.infoPanel.querySelectorAll('.cable-upgrade-btn');
                for (var ub = 0; ub < upgBtns.length; ub++) {
                    upgBtns[ub].addEventListener('click', function () {
                        var fId = parseInt(this.getAttribute('data-from-id'));
                        var tId = parseInt(this.getAttribute('data-to-id'));
                        if (typeof Buildings !== 'undefined' && Buildings.upgradeCable) {
                            var res = Buildings.upgradeCable(fId, tId);
                            if (res.success) {
                                if (typeof UI !== 'undefined' && UI.showToast) {
                                    UI.showToast('Cable upgraded to HC! ($' + res.cost + ')', 'success', 2000);
                                }
                                // Refresh info panel
                                if (typeof UI !== 'undefined' && UI.showBuildingInfo) {
                                    UI.showBuildingInfo(_selectedBuildingId);
                                }
                            } else {
                                if (typeof UI !== 'undefined' && UI.showToast) {
                                    UI.showToast(res.reason || 'Cannot upgrade.', 'error', 2000);
                                }
                            }
                        }
                    });
                }
                // Wire up cable priority dropdowns
                var priSelects = _elements.infoPanel.querySelectorAll('.cable-priority-select');
                for (var ps = 0; ps < priSelects.length; ps++) {
                    priSelects[ps].addEventListener('change', function () {
                        var bId = parseInt(this.getAttribute('data-building-id'));
                        var nId = parseInt(this.getAttribute('data-neighbor-id'));
                        var pri = parseInt(this.value);
                        if (typeof Buildings !== 'undefined' && Buildings.setCablePriority) {
                            Buildings.setCablePriority(bId, nId, pri);
                        }
                    });
                }

                // Wire up cable disconnect buttons
                var discBtns = _elements.infoPanel.querySelectorAll('.cable-disconnect-btn');
                for (var db = 0; db < discBtns.length; db++) {
                    discBtns[db].addEventListener('click', function () {
                        var fId = parseInt(this.getAttribute('data-from-id'));
                        var tId = parseInt(this.getAttribute('data-to-id'));
                        if (typeof Buildings !== 'undefined' && Buildings.removeCable) {
                            Buildings.removeCable(fId, tId);
                            if (typeof UI !== 'undefined' && UI.showToast) {
                                UI.showToast('Cable disconnected.', 'info', 1500);
                            }
                            if (typeof UI !== 'undefined' && UI.showBuildingInfo) {
                                UI.showBuildingInfo(_selectedBuildingId);
                            }
                        }
                    });
                }
            }
        },

        showEnemyInfo: function (enemy) {
            if (!enemy) return;
            var def = (typeof Config !== 'undefined' && Config.ENEMIES) ? Config.ENEMIES[enemy.type] : null;
            if (!def) return;

            _selectedBuildingId = null;
            _selectedEnemyId = enemy.id;

            var hpPct = enemy.maxHp > 0 ? Math.floor((enemy.hp / enemy.maxHp) * 100) : 0;
            var html = '';
            html += '<div class="info-header">';
            html += '<span class="info-icon">' + (def.icon || '👾') + '</span>';
            html += '<span class="info-name">' + (def.name || enemy.type) + '</span>';
            if (enemy.isBoss) html += ' <span style="color:#ffd700;font-weight:bold;">[BOSS]</span>';
            html += '</div>';

            // HP bar
            html += '<div class="info-hp">';
            html += '<div class="hp-bar"><div class="hp-fill" id="info-hp-fill" style="width:' + hpPct + '%;background:#cc3333;"></div></div>';
            html += '<span id="info-hp-text">' + Math.floor(enemy.hp) + '/' + enemy.maxHp + ' HP</span>';
            html += '</div>';

            // Stats
            html += '<div class="info-stat">⚔️ Damage: ' + enemy.damage + '</div>';
            html += '<div class="info-stat">🛡️ Armor: ' + enemy.armor + '</div>';
            html += '<div class="info-stat">💨 Speed: ' + Math.round(enemy.speed) + '</div>';
            html += '<div class="info-stat">💰 Kill Reward: $' + (def.killReward || 0) + '</div>';

            // Special ability
            var specialNames = {
                'targets_power': '⚡ Targets power plants',
                'targets_housing': '🏠 Targets housing',
                'targets_mining': '⛏️ Targets mining',
                'targets_weapons': '⚔️ Targets weapons',
                'targets_storage': '🔋 Targets storage',
                'targets_shields': '🛡️ Targets shields',
                'targets_grid': '🔌 Targets grid (cables/pylons)',
                'targets_walls': '🧱 Targets walls',
                'emp_disable': '⚡ EMP — disables buildings',
                'ignores_shields': '👻 Phases through shields',
                'reduces_range': '📡 Reduces weapon range',
                'river_spawn': '🐍 Spawns in rivers'
            };
            if (enemy.special && specialNames[enemy.special]) {
                html += '<div class="info-stat" style="color:#ffaa00;">' + specialNames[enemy.special] + '</div>';
            }

            // Status effects
            if (enemy.stunTimer && enemy.stunTimer > 0) {
                html += '<div class="info-stat" style="color:#33ccff;">⚡ Stunned (' + Math.ceil(enemy.stunTimer / 10) + 's)</div>';
            }
            if (enemy.slowFactor < 1.0) {
                html += '<div class="info-stat" style="color:#66aaff;">❄️ Slowed (' + Math.round(enemy.slowFactor * 100) + '% speed)</div>';
            }

            if (_elements.infoPanel) {
                _elements.infoPanel.innerHTML = html;
                _elements.infoPanel.style.display = 'block';
            }
        },

        clearInfoPanel: function () {
            _selectedBuildingId = null;
            _selectedEnemyId = null;
            if (_elements.infoPanel) {
                _elements.infoPanel.innerHTML = '';
                _elements.infoPanel.style.display = 'none';
            }
        },

        getSelectedBuildingId: function () {
            return _selectedBuildingId;
        },

        // ---- Toasts ----

        showToast: function (message, type, duration) {
            if (!_elements.toastContainer) return;
            type = type || 'info';
            duration = duration || 3000;

            var toast = document.createElement('div');
            toast.className = 'toast toast-' + type;
            toast.textContent = message;
            _elements.toastContainer.appendChild(toast);
            _toastQueue.push(toast);

            // Trim excess toasts
            while (_toastQueue.length > _maxToasts) {
                _removeToast(_toastQueue[0]);
            }

            // Trigger entrance animation on next frame
            requestAnimationFrame(function () {
                toast.classList.add('toast-enter');
            });

            // Auto-remove
            setTimeout(function () {
                _removeToast(toast);
            }, duration);
        },

        // ---- Modal ----

        showModal: function (title, content, buttons) {
            if (!_elements.modalOverlay || !_elements.modalContent) return;
            var html = '';
            html += '<h2 class="modal-title">' + title + '</h2>';
            html += '<div class="modal-body">' + content + '</div>';
            if (buttons && buttons.length > 0) {
                html += '<div class="modal-buttons">';
                for (var i = 0; i < buttons.length; i++) {
                    var btn = buttons[i];
                    var action = btn.action || 'close-modal';
                    var cls = btn.className || 'modal-btn';
                    html += '<button class="' + cls + '" data-action="' + action + '">' + btn.label + '</button>';
                }
                html += '</div>';
            }
            _elements.modalContent.innerHTML = html;
            _elements.modalOverlay.style.display = 'flex';
        },

        hideModal: function () {
            if (_elements.modalOverlay) {
                _elements.modalOverlay.style.display = 'none';
            }
            if (_elements.modalContent) {
                _elements.modalContent.innerHTML = '';
            }
        },

        // ---- Game over ----

        showGameOver: function (stats) {
            var waveReached = (stats && stats.wave) ? stats.wave : 0;
            var enemiesKilled = (stats && stats.kills != null) ? stats.kills : ((stats && stats.enemiesKilled) ? stats.enemiesKilled : 0);
            var timePlayed = (stats && stats.time != null) ? stats.time : ((stats && stats.timePlayed) ? stats.timePlayed : 0);

            var minutes = Math.floor(timePlayed / 60);
            var seconds = Math.floor(timePlayed % 60);
            var timeStr = minutes + ':' + (seconds < 10 ? '0' : '') + seconds;

            var score = (waveReached * 1000) + (enemiesKilled * 10);

            var content = '';
            content += '<div class="gameover-stat">🌊 Waves Survived: <strong>' + waveReached + '</strong></div>';
            content += '<div class="gameover-stat">💀 Enemies Killed: <strong>' + UI.formatNumber(enemiesKilled) + '</strong></div>';
            content += '<div class="gameover-stat">⏱️ Time Played: <strong>' + timeStr + '</strong></div>';
            content += '<div class="gameover-stat">🏆 Score: <strong>' + UI.formatNumber(score) + '</strong></div>';

            UI.showModal('⚡ Game Over ⚡', content, [
                { label: '🏠 Return to Menu', action: 'return-to-menu', className: 'modal-btn modal-btn-primary' }
            ]);
        },

        // ---- Screens ----

        showMenu: function () {
            if (_elements.menuScreen) _elements.menuScreen.style.display = 'flex';
            if (_elements.gameScreen) _elements.gameScreen.style.display = 'none';
        },

        showGame: function () {
            if (_elements.menuScreen) _elements.menuScreen.style.display = 'none';
            if (_elements.gameScreen) _elements.gameScreen.style.display = 'block';
        },

        showPause: function () {
            if (_elements.pauseOverlay) _elements.pauseOverlay.style.display = 'flex';
        },

        hidePause: function () {
            if (_elements.pauseOverlay) _elements.pauseOverlay.style.display = 'none';
        },

        // ---- Utility ----

        formatNumber: function (n) {
            if (n == null) return '0';
            n = Math.floor(n);
            if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
            if (n >= 10000) return (n / 1000).toFixed(1) + 'K';
            var parts = [];
            var s = Math.abs(n).toString();
            for (var i = s.length - 1, count = 0; i >= 0; i--, count++) {
                if (count > 0 && count % 3 === 0) parts.unshift(',');
                parts.unshift(s[i]);
            }
            return (n < 0 ? '-' : '') + parts.join('');
        },

        formatEnergy: function (n) {
            return '⚡ ' + UI.formatNumber(n);
        },

        // ---- Enemy Glossary ----

        showGlossary: function () {
            if (typeof Config === 'undefined' || !Config.ENEMIES) return;

            var currentWave = 0;
            if (typeof Enemies !== 'undefined' && Enemies.getCurrentWave) {
                currentWave = Enemies.getCurrentWave();
            } else if (typeof Engine !== 'undefined' && Engine.getState) {
                var st = Engine.getState();
                if (st && st.wave) currentWave = st.wave;
            }

            // Collect non-procedural enemies, sorted by firstWave
            var entries = [];
            var keys = Object.keys(Config.ENEMIES);
            for (var i = 0; i < keys.length; i++) {
                // Skip procedural enemies
                if (keys[i].indexOf('proc_') === 0) continue;
                var eDef = Config.ENEMIES[keys[i]];
                entries.push({ key: keys[i], def: eDef });
            }
            entries.sort(function (a, b) {
                return (a.def.firstWave || 0) - (b.def.firstWave || 0);
            });

            var html = '<div style="max-height:60vh;overflow-y:auto;">';
            html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
            html += '<thead><tr style="border-bottom:2px solid #555;text-align:left;">';
            html += '<th style="padding:6px;">Icon</th>';
            html += '<th style="padding:6px;">Name</th>';
            html += '<th style="padding:6px;">HP</th>';
            html += '<th style="padding:6px;">Spd</th>';
            html += '<th style="padding:6px;">Dmg</th>';
            html += '<th style="padding:6px;">Armor</th>';
            html += '<th style="padding:6px;">Wave</th>';
            html += '<th style="padding:6px;">Special</th>';
            html += '</tr></thead><tbody>';

            for (var j = 0; j < entries.length; j++) {
                var e = entries[j];
                var seen = currentWave >= (e.def.firstWave || 1);
                html += '<tr style="border-bottom:1px solid #333;">';
                if (seen) {
                    html += '<td style="padding:6px;font-size:18px;">' + (e.def.icon || '') + '</td>';
                    html += '<td style="padding:6px;font-weight:bold;">' + (e.def.name || e.key) + '</td>';
                    html += '<td style="padding:6px;">' + (e.def.hp || 0) + '</td>';
                    html += '<td style="padding:6px;">' + (e.def.speed || 0) + '</td>';
                    html += '<td style="padding:6px;">' + (e.def.damage || 0) + '</td>';
                    html += '<td style="padding:6px;">' + (e.def.armor || 0) + '</td>';
                    html += '<td style="padding:6px;">' + (e.def.firstWave || '?') + '</td>';
                    html += '<td style="padding:6px;font-size:11px;">' + (e.def.special || '—') + '</td>';
                } else {
                    html += '<td style="padding:6px;font-size:18px;">❓</td>';
                    html += '<td style="padding:6px;font-style:italic;color:#888;">Unknown Enemy</td>';
                    html += '<td style="padding:6px;color:#555;">???</td>';
                    html += '<td style="padding:6px;color:#555;">???</td>';
                    html += '<td style="padding:6px;color:#555;">???</td>';
                    html += '<td style="padding:6px;color:#555;">???</td>';
                    html += '<td style="padding:6px;">' + (e.def.firstWave || '?') + '</td>';
                    html += '<td style="padding:6px;color:#555;">???</td>';
                }
                html += '</tr>';
            }

            html += '</tbody></table></div>';

            UI.showModal('📖 Enemy Glossary', html, [
                { label: 'Close', action: 'close-modal', className: 'menu-btn' }
            ]);
        },

        // ---- Debug Mode ----

        toggleDebugBar: function (show) {
            var bar = document.getElementById('debug-bar');
            if (!bar) return;
            bar.style.display = show ? 'block' : 'none';
            if (show) {
                UI._buildDebugBar();
            } else {
                // Clear debug spawn selection
                if (typeof Input !== 'undefined' && Input.setDebugSpawnType) {
                    Input.setDebugSpawnType(null);
                }
            }
        },

        _buildDebugBar: function () {
            var togglesEl = document.getElementById('debug-toggles');
            var resEl = document.getElementById('debug-resources');
            var catsEl = document.getElementById('debug-categories');
            var optsEl = document.getElementById('debug-options');
            if (!togglesEl || !catsEl || !optsEl) return;

            // God mode toggle
            var godActive = (typeof Engine !== 'undefined' && Engine.isGodMode) ? Engine.isGodMode() : false;
            var wavesOn = (typeof Engine !== 'undefined' && Engine.isWavesEnabled) ? Engine.isWavesEnabled() : true;
            togglesEl.innerHTML = '<button class="debug-toggle' + (godActive ? ' active' : '') + '" id="debug-god-toggle">🛡️ God Mode</button>' +
                '<button class="debug-toggle' + (!wavesOn ? ' active' : '') + '" id="debug-wave-toggle">🚫 Stop Waves</button>';
            document.getElementById('debug-god-toggle').addEventListener('click', function () {
                var isOn = (typeof Engine !== 'undefined' && Engine.isGodMode) ? Engine.isGodMode() : false;
                if (typeof Engine !== 'undefined' && Engine.setGodMode) {
                    Engine.setGodMode(!isOn);
                }
                this.classList.toggle('active');
                if (typeof UI !== 'undefined' && UI.showToast) {
                    UI.showToast(!isOn ? '🛡️ God Mode ON — Core is invincible' : 'God Mode OFF', 'info', 2000);
                }
            });

            document.getElementById('debug-wave-toggle').addEventListener('click', function () {
                var isOn = (typeof Engine !== 'undefined' && Engine.isWavesEnabled) ? Engine.isWavesEnabled() : true;
                if (typeof Engine !== 'undefined' && Engine.setWavesEnabled) {
                    Engine.setWavesEnabled(!isOn);
                }
                this.classList.toggle('active');
                if (typeof UI !== 'undefined' && UI.showToast) {
                    UI.showToast(!isOn ? 'Waves resumed' : '🚫 Waves stopped', 'info', 2000);
                }
            });

            // Resource cheat buttons
            if (resEl) {
                resEl.innerHTML = '<button class="debug-res-btn" data-res="money">+$5000</button>' +
                    '<button class="debug-res-btn" data-res="iron">+100 ⛏️</button>' +
                    '<button class="debug-res-btn" data-res="coal">+100 🪨</button>' +
                    '<button class="debug-res-btn" data-res="oil">+100 🛢️</button>' +
                    '<button class="debug-res-btn" data-res="uranium">+50 ☢️</button>';
                var resBtns = resEl.querySelectorAll('.debug-res-btn');
                for (var r = 0; r < resBtns.length; r++) {
                    resBtns[r].addEventListener('click', function () {
                        var res = this.getAttribute('data-res');
                        if (res === 'money') {
                            if (typeof Economy !== 'undefined' && Economy.addMoney) Economy.addMoney(5000, 'debug');
                            UI.showToast('+$5,000', 'success', 1000);
                        } else {
                            var amt = res === 'uranium' ? 50 : 100;
                            if (typeof Economy !== 'undefined' && Economy.addResource) Economy.addResource(res, amt);
                            UI.showToast('+' + amt + ' ' + res, 'success', 1000);
                        }
                    });
                }
            }

            // Debug categories
            catsEl.innerHTML = '<button class="debug-cat-btn" data-debug-cat="enemies">👾 Enemies</button>';
            var catBtns = catsEl.querySelectorAll('.debug-cat-btn');
            for (var i = 0; i < catBtns.length; i++) {
                catBtns[i].addEventListener('click', function () {
                    var wasActive = this.classList.contains('active');
                    var allCats = catsEl.querySelectorAll('.debug-cat-btn');
                    for (var j = 0; j < allCats.length; j++) allCats[j].classList.remove('active');
                    if (wasActive) {
                        // Toggle off — clear spawn selection and hide options
                        if (typeof Input !== 'undefined' && Input.setDebugSpawnType) Input.setDebugSpawnType(null);
                        optsEl.innerHTML = '';
                        return;
                    }
                    this.classList.add('active');
                    var cat = this.getAttribute('data-debug-cat');
                    UI._renderDebugCategory(cat);
                });
            }

            optsEl.innerHTML = '<span style="color:#666;">Select a category above</span>';
        },

        _renderDebugCategory: function (cat) {
            var optsEl = document.getElementById('debug-options');
            if (!optsEl) return;

            if (cat === 'enemies') {
                if (typeof Config === 'undefined' || !Config.ENEMIES) {
                    optsEl.innerHTML = '<span style="color:#666;">No enemy data</span>';
                    return;
                }
                var html = '';
                var keys = Object.keys(Config.ENEMIES);
                for (var i = 0; i < keys.length; i++) {
                    if (keys[i].indexOf('proc_') === 0) continue;
                    var eDef = Config.ENEMIES[keys[i]];
                    var selected = (typeof Input !== 'undefined' && Input.getDebugSpawnType && Input.getDebugSpawnType() === keys[i]);
                    html += '<button class="debug-enemy-btn' + (selected ? ' selected' : '') + '" data-enemy-type="' + keys[i] + '">';
                    html += (eDef.icon || '👾') + ' ' + (eDef.name || keys[i]);
                    html += '</button>';
                }
                optsEl.innerHTML = html;

                var btns = optsEl.querySelectorAll('.debug-enemy-btn');
                for (var j = 0; j < btns.length; j++) {
                    btns[j].addEventListener('click', function () {
                        var typeKey = this.getAttribute('data-enemy-type');
                        var currentType = (typeof Input !== 'undefined' && Input.getDebugSpawnType) ? Input.getDebugSpawnType() : null;
                        var allBtns = optsEl.querySelectorAll('.debug-enemy-btn');
                        for (var k = 0; k < allBtns.length; k++) allBtns[k].classList.remove('selected');

                        if (currentType === typeKey) {
                            // Deselect
                            if (typeof Input !== 'undefined' && Input.setDebugSpawnType) Input.setDebugSpawnType(null);
                            UI.showToast('Enemy spawning cancelled', 'info', 1000);
                        } else {
                            this.classList.add('selected');
                            if (typeof Input !== 'undefined' && Input.setDebugSpawnType) Input.setDebugSpawnType(typeKey);
                            UI.showToast('Click on map to spawn: ' + typeKey, 'info', 2000);
                        }
                    });
                }
            }
        }
    };
})();

// ============================================================================
// Volt Defense — Input Module
// Handles all mouse and keyboard input for the game canvas.
// ============================================================================

var Input = (function () {
    var _state = 'idle';         // 'idle', 'placing', 'selecting', 'dragging', 'cable'
    var _placingType = null;
    var _selectedBuildingId = null;
    var _cableFromId = null;
    var _mouseWorld = { x: 0, y: 0 };
    var _mouseScreen = { x: 0, y: 0 };
    var _mouseGrid = { x: 0, y: 0 };
    var _isDragging = false;
    var _dragStart = { x: 0, y: 0 };
    var _keysDown = {};
    var _cameraMoveSpeed = 400;
    var _initialized = false;

    // Deposit hover tooltip
    var _hoverGrid = { x: -1, y: -1 };
    var _hoverStartTime = 0;
    var _hoverDeposit = null; // currently hovered deposit (shown after 2s)

    // ---- private helpers ----

    function _getCellSize() {
        return (typeof Config !== 'undefined' && Config.GRID_CELL_SIZE) ? Config.GRID_CELL_SIZE : 40;
    }

    function _isPaused() {
        return (typeof Engine !== 'undefined' && Engine.isPaused) ? Engine.isPaused() : false;
    }

    function _attemptPlacement() {
        if (!_placingType) return;
        if (typeof Buildings === 'undefined' || !Buildings.canPlace || !Buildings.place) return;

        var check = Buildings.canPlace(_placingType, _mouseGrid.x, _mouseGrid.y);
        if (check.allowed) {
            var placed = Buildings.place(_placingType, _mouseGrid.x, _mouseGrid.y);
            if (placed) {
                // Auto-cable to nearest building within range
                _autoCable(placed);

                if (typeof UI !== 'undefined' && UI.showToast) {
                    UI.showToast('Building placed!', 'success', 1500);
                }
                // Refresh build menu affordability
                if (typeof UI !== 'undefined' && UI.selectCategory && UI.update) {
                    UI.update();
                }
            }
        } else {
            if (typeof UI !== 'undefined' && UI.showToast) {
                UI.showToast(check.reason || 'Cannot place here.', 'error', 2500);
            }
        }
    }

    function _autoCable(placedBuilding) {
        if (typeof Buildings === 'undefined' || !Buildings.getAll || !Buildings.addCable) return;

        var maxLen = (typeof Config !== 'undefined' && Config.CABLE_MAX_LENGTH) ? Config.CABLE_MAX_LENGTH : 200;
        var allBuildings = Buildings.getAll();
        var bestDist = Infinity;
        var bestId = null;

        for (var i = 0; i < allBuildings.length; i++) {
            var other = allBuildings[i];
            if (other.id === placedBuilding.id) continue;

            var dist = Infinity;
            if (typeof Buildings.getDistance === 'function') {
                dist = Buildings.getDistance(placedBuilding, other);
            } else {
                var cellSize = _getCellSize();
                var dx = placedBuilding.worldX - other.worldX;
                var dy = placedBuilding.worldY - other.worldY;
                dist = Math.sqrt(dx * dx + dy * dy);
            }

            if (dist <= maxLen && dist < bestDist) {
                bestDist = dist;
                bestId = other.id;
            }
        }

        if (bestId !== null) {
            Buildings.addCable(placedBuilding.id, bestId);
        }
    }

    function _getBuildingAtMouse() {
        if (typeof Buildings === 'undefined' || !Buildings.getAt) return null;
        return Buildings.getAt(_mouseGrid.x, _mouseGrid.y);
    }

    function _showDepositInfo(dep) {
        if (!dep || typeof UI === 'undefined' || !UI.showToast) return;
        var names = { iron: 'Iron Ore', coal: 'Coal', uranium: 'Uranium' };
        var icons = { iron: '⛏️', coal: '🪨', uranium: '☢️' };
        var name = names[dep.type] || dep.type;
        var icon = icons[dep.type] || '';
        var pct = dep.maxAmount > 0 ? Math.floor((dep.remaining / dep.maxAmount) * 100) : 0;
        UI.showToast(icon + ' ' + name + ' Deposit — ' + dep.remaining + '/' + dep.maxAmount + ' remaining (' + pct + '%)', 'info', 3000);
    }

    function _getDepositTooltip() {
        // Returns deposit/rock info if mouse hovered on one for 2+ seconds
        if (_isDragging || _state === 'placing' || _state === 'cable') return null;
        if (Date.now() - _hoverStartTime < 2000) return null;
        if (typeof Map === 'undefined') return null;

        // Check deposit first
        if (Map.getDepositAt) {
            var dep = Map.getDepositAt(_hoverGrid.x, _hoverGrid.y);
            if (dep && dep.remaining > 0) return dep;
        }

        // Check rock or water terrain
        if (Map.getTerrainAt) {
            var terrain = Map.getTerrainAt(_hoverGrid.x, _hoverGrid.y);
            if (terrain === 1) {
                return { type: 'rock', remaining: 0, maxAmount: 0, gridX: _hoverGrid.x, gridY: _hoverGrid.y };
            }
            // Water tile — show speed and direction
            if (terrain === 2 || terrain === 3) {
                var wSpeed = 0;
                var wDir = { dx: 0, dy: 0 };
                if (typeof Map.getEffectiveWaterSpeed === 'function') wSpeed = Map.getEffectiveWaterSpeed(_hoverGrid.x, _hoverGrid.y);
                if (typeof Map.getFlowDirection === 'function') wDir = Map.getFlowDirection(_hoverGrid.x, _hoverGrid.y);
                return { type: 'water', waterSpeed: wSpeed, flowDir: wDir, gridX: _hoverGrid.x, gridY: _hoverGrid.y };
            }
        }

        return null;
    }

    function _attemptSelection() {
        if (typeof Buildings === 'undefined' || !Buildings.getAt) return;

        var building = Buildings.getAt(_mouseGrid.x, _mouseGrid.y);
        if (building) {
            _selectedBuildingId = building.id;
            _state = 'idle';
            if (typeof UI !== 'undefined' && UI.showBuildingInfo) {
                UI.showBuildingInfo(building.id);
            }
        } else {
            _deselectBuilding();
        }
    }

    function _attemptCableConnection() {
        if (typeof Buildings === 'undefined' || !Buildings.getAt || !Buildings.addCable) return;

        var building = Buildings.getAt(_mouseGrid.x, _mouseGrid.y);
        if (!building) {
            if (typeof UI !== 'undefined' && UI.showToast) {
                UI.showToast('No building at this location.', 'error', 2000);
            }
            return;
        }
        if (building.id === _cableFromId) {
            if (typeof UI !== 'undefined' && UI.showToast) {
                UI.showToast('Cannot cable a building to itself.', 'error', 2000);
            }
            return;
        }

        var result = Buildings.addCable(_cableFromId, building.id);
        if (result && result.success) {
            if (typeof UI !== 'undefined' && UI.showToast) {
                UI.showToast('Cable connected!', 'success', 1500);
            }
            _cancelCable();
        } else {
            if (typeof UI !== 'undefined' && UI.showToast) {
                UI.showToast((result && result.reason) || 'Cannot connect cable.', 'error', 2500);
            }
        }
    }

    function _deselectBuilding() {
        _selectedBuildingId = null;
        if (typeof UI !== 'undefined' && UI.clearInfoPanel) {
            UI.clearInfoPanel();
        }
    }

    function _cancelCable() {
        _state = 'idle';
        _cableFromId = null;
        if (typeof Render !== 'undefined' && Render.setCablePreview) {
            Render.setCablePreview(null, null);
        }
    }

    // ---- public API ----

    return {
        init: function () {
            if (_initialized) return;
            _initialized = true;

            var canvas = document.getElementById('game-canvas');
            if (!canvas) return;

            // ---- Mouse move ----
            canvas.addEventListener('mousemove', function (e) {
                var rect = canvas.getBoundingClientRect();
                _mouseScreen.x = e.clientX - rect.left;
                _mouseScreen.y = e.clientY - rect.top;

                // Handle dragging (panning) on canvas directly
                if (_isDragging) {
                    var dx = e.clientX - _dragStart.x;
                    var dy = e.clientY - _dragStart.y;
                    if (dx !== 0 || dy !== 0) {
                        _dragStart.x = e.clientX;
                        _dragStart.y = e.clientY;
                        if (typeof Render !== 'undefined' && Render.moveCamera) {
                            Render.moveCamera(-dx, -dy);
                        }
                    }
                    return; // Don't process other mouse stuff while panning
                }

                // Convert to world coords
                if (typeof Render !== 'undefined' && Render.screenToWorld) {
                    var world = Render.screenToWorld(_mouseScreen.x, _mouseScreen.y);
                    _mouseWorld.x = world.x;
                    _mouseWorld.y = world.y;
                } else {
                    _mouseWorld.x = _mouseScreen.x;
                    _mouseWorld.y = _mouseScreen.y;
                }

                // Convert to grid
                var cellSize = _getCellSize();
                _mouseGrid.x = Math.floor(_mouseWorld.x / cellSize);
                _mouseGrid.y = Math.floor(_mouseWorld.y / cellSize);

                // Update placement preview
                if (_state === 'placing' && _placingType) {
                    if (typeof Buildings !== 'undefined' && Buildings.canPlace) {
                        var check = Buildings.canPlace(_placingType, _mouseGrid.x, _mouseGrid.y, true);
                        if (typeof Render !== 'undefined' && Render.setPlacementPreview) {
                            Render.setPlacementPreview(_placingType, _mouseGrid.x, _mouseGrid.y, check.allowed);
                        }
                    }
                }

                // Cable preview
                if (_state === 'cable' && _cableFromId) {
                    if (typeof Render !== 'undefined' && Render.setCablePreview) {
                        Render.setCablePreview(_cableFromId, _mouseWorld);
                    }
                }

                // Deposit hover tracking
                if (_mouseGrid.x !== _hoverGrid.x || _mouseGrid.y !== _hoverGrid.y) {
                    _hoverGrid.x = _mouseGrid.x;
                    _hoverGrid.y = _mouseGrid.y;
                    _hoverStartTime = Date.now();
                    _hoverDeposit = null;
                }
            });

            // ---- Mouse down ----
            canvas.addEventListener('mousedown', function (e) {
                if (e.button === 0) {
                    if (_isPaused()) return;
                    // Check minimap click first
                    if (typeof Render !== 'undefined' && Render.getMinimapBounds) {
                        var mmBounds = Render.getMinimapBounds();
                        if (_mouseScreen.x >= mmBounds.x && _mouseScreen.x <= mmBounds.x + mmBounds.width &&
                            _mouseScreen.y >= mmBounds.y && _mouseScreen.y <= mmBounds.y + mmBounds.height) {
                            var worldPos = Render.minimapToWorld(_mouseScreen.x, _mouseScreen.y);
                            Render.centerOn(worldPos.x, worldPos.y);
                            return;
                        }
                    }
                    if (_state === 'placing') {
                        _attemptPlacement();
                    } else if (_state === 'cable') {
                        _attemptCableConnection();
                    } else {
                        // Try selecting a building first; if nothing clicked, check deposit, then pan
                        var clickedBuilding = _getBuildingAtMouse();
                        if (clickedBuilding) {
                            _attemptSelection();
                        } else {
                            // Check for deposit or rock click
                            var dep = (typeof Map !== 'undefined' && Map.getDepositAt)
                                ? Map.getDepositAt(_mouseGrid.x, _mouseGrid.y) : null;
                            if (dep) {
                                _showDepositInfo(dep);
                            } else {
                                // Check for rock tile
                                var terrain = (typeof Map !== 'undefined' && Map.getTerrainAt)
                                    ? Map.getTerrainAt(_mouseGrid.x, _mouseGrid.y) : -1;
                                if (terrain === 1) {
                                    if (typeof UI !== 'undefined' && UI.showToast) {
                                        UI.showToast('🪨 Rock — Terrain only, no resources', 'info', 2000);
                                    }
                                } else if (terrain === 2 || terrain === 3) {
                                    // Water tile click — show flow info
                                    var wSpd = 0;
                                    var wFlowDir = { dx: 0, dy: 0 };
                                    if (typeof Map.getEffectiveWaterSpeed === 'function') wSpd = Map.getEffectiveWaterSpeed(_mouseGrid.x, _mouseGrid.y);
                                    if (typeof Map.getFlowDirection === 'function') wFlowDir = Map.getFlowDirection(_mouseGrid.x, _mouseGrid.y);
                                    var dirMap = { '0,1': '↓ South', '0,-1': '↑ North', '1,0': '→ East', '-1,0': '← West' };
                                    var dKey = wFlowDir.dx + ',' + wFlowDir.dy;
                                    var dName = dirMap[dKey] || '—';
                                    if (typeof UI !== 'undefined' && UI.showToast) {
                                        UI.showToast('🌊 River — Speed: ' + wSpd.toFixed(1) + ' mph, Flow: ' + dName, 'info', 3000);
                                    }
                                }
                            }
                            // Start left-click drag pan
                            _isDragging = true;
                            _dragStart.x = e.clientX;
                            _dragStart.y = e.clientY;
                        }
                    }
                } else if (e.button === 1 || e.button === 2) {
                    _isDragging = true;
                    _dragStart.x = e.clientX;
                    _dragStart.y = e.clientY;
                    e.preventDefault();
                }
            });

            // Also allow left-click drag for panning when holding middle mouse or right
            // And allow left-drag on empty space
            // Also handle drag on document level for smooth panning
            document.addEventListener('mousemove', function (e) {
                if (_isDragging) {
                    var dx = e.clientX - _dragStart.x;
                    var dy = e.clientY - _dragStart.y;
                    _dragStart.x = e.clientX;
                    _dragStart.y = e.clientY;
                    if (typeof Render !== 'undefined' && Render.moveCamera) {
                        Render.moveCamera(-dx, -dy);
                    }
                }
            });

            // ---- Mouse up (document-level so drag works even if mouse leaves canvas) ----
            document.addEventListener('mouseup', function (e) {
                _isDragging = false;
            });
            canvas.addEventListener('mouseup', function (e) {
                _isDragging = false;
            });

            // Prevent context menu on canvas
            canvas.addEventListener('contextmenu', function (e) {
                e.preventDefault();
            });

            // ---- Mouse wheel (zoom placeholder) ----
            canvas.addEventListener('wheel', function (e) {
                e.preventDefault();
                if (typeof Render !== 'undefined' && Render.zoom) {
                    var delta = e.deltaY > 0 ? -1 : 1;
                    Render.zoom(delta, _mouseScreen.x, _mouseScreen.y);
                }
            }, { passive: false });

            // ---- Keyboard down ----
            document.addEventListener('keydown', function (e) {
                _keysDown[e.key.toLowerCase()] = true;

                // Escape — cancel current action or toggle pause
                if (e.key === 'Escape') {
                    if (_state === 'placing') {
                        Input.cancelPlacement();
                    } else if (_state === 'cable') {
                        _cancelCable();
                    } else if (_selectedBuildingId) {
                        _deselectBuilding();
                    } else if (typeof Engine !== 'undefined' && Engine.setPaused && Engine.isPaused) {
                        var wasPaused = Engine.isPaused();
                        Engine.setPaused(!wasPaused);
                        if (typeof UI !== 'undefined') {
                            if (!wasPaused && UI.showPause) UI.showPause();
                            else if (wasPaused && UI.hidePause) UI.hidePause();
                        }
                    }
                    return;
                }

                // P — toggle pause
                if (e.key === 'p' || e.key === 'P') {
                    if (typeof Engine !== 'undefined' && Engine.setPaused && Engine.isPaused) {
                        var paused = Engine.isPaused();
                        Engine.setPaused(!paused);
                        if (typeof UI !== 'undefined') {
                            if (!paused && UI.showPause) UI.showPause();
                            else if (paused && UI.hidePause) UI.hidePause();
                        }
                    }
                    return;
                }

                // All remaining keys require game to be running
                if (_isPaused()) return;

                // Delete — sell selected building
                if (e.key === 'Delete' && _selectedBuildingId) {
                    if (typeof Buildings !== 'undefined' && Buildings.remove) {
                        Buildings.remove(_selectedBuildingId);
                        if (typeof UI !== 'undefined' && UI.showToast) {
                            UI.showToast('Building sold.', 'info');
                        }
                        _deselectBuilding();
                    }
                }

                // C — cable mode from selected building
                if ((e.key === 'c' || e.key === 'C') && _selectedBuildingId && _state === 'idle') {
                    Input.startCableMode(_selectedBuildingId);
                }

                // U — upgrade selected building
                if ((e.key === 'u' || e.key === 'U') && _selectedBuildingId) {
                    if (typeof Buildings !== 'undefined' && Buildings.upgrade) {
                        var upgraded = Buildings.upgrade(_selectedBuildingId);
                        if (upgraded) {
                            if (typeof UI !== 'undefined' && UI.showToast) {
                                UI.showToast('Building upgraded!', 'success');
                            }
                        } else {
                            if (typeof UI !== 'undefined' && UI.showToast) {
                                UI.showToast('Cannot upgrade.', 'error');
                            }
                        }
                        if (typeof UI !== 'undefined' && UI.showBuildingInfo) {
                            UI.showBuildingInfo(_selectedBuildingId);
                        }
                    }
                }

                // Number keys 1–8 for category selection
                if (e.key >= '1' && e.key <= '8') {
                    var catIndex = parseInt(e.key) - 1;
                    if (typeof Config !== 'undefined' && Config.CATEGORY_ORDER && Config.CATEGORY_ORDER[catIndex]) {
                        if (typeof UI !== 'undefined' && UI.selectCategory) {
                            UI.selectCategory(Config.CATEGORY_ORDER[catIndex]);
                        }
                    }
                }
            });

            // ---- Keyboard up ----
            document.addEventListener('keyup', function (e) {
                _keysDown[e.key.toLowerCase()] = false;
            });

            // Clear keys on window blur to avoid stuck keys
            window.addEventListener('blur', function () {
                _keysDown = {};
                _isDragging = false;
            });
        },

        update: function (dt) {
            if (!dt) return;
            if (_isPaused()) return;

            // WASD / arrow camera movement
            var speed = _cameraMoveSpeed * dt;
            if (typeof Render !== 'undefined' && Render.moveCamera) {
                if (_keysDown['w'] || _keysDown['arrowup']) Render.moveCamera(0, -speed);
                if (_keysDown['s'] || _keysDown['arrowdown']) Render.moveCamera(0, speed);
                if (_keysDown['a'] || _keysDown['arrowleft']) Render.moveCamera(-speed, 0);
                if (_keysDown['d'] || _keysDown['arrowright']) Render.moveCamera(speed, 0);
            }
        },

        // ---- accessors ----

        getState: function () { return _state; },
        getMouseWorld: function () { return _mouseWorld; },
        getMouseGrid: function () { return _mouseGrid; },
        getMouseScreen: function () { return _mouseScreen; },
        getPlacingType: function () { return _placingType; },
        getSelectedBuildingId: function () { return _selectedBuildingId; },
        getDepositTooltip: function () { return _getDepositTooltip(); },

        // ---- placement mode ----

        setPlacingMode: function (typeKey) {
            _state = 'placing';
            _placingType = typeKey;
            _deselectBuilding();

            if (typeof Render !== 'undefined' && Render.setPlacementPreview) {
                Render.setPlacementPreview(typeKey, _mouseGrid.x, _mouseGrid.y, false);
            }
            if (typeof UI !== 'undefined' && UI.showToast) {
                var name = typeKey;
                if (typeof Config !== 'undefined' && Config.BUILDINGS && Config.BUILDINGS[typeKey]) {
                    name = Config.BUILDINGS[typeKey].name;
                }
                UI.showToast('Placing: ' + name + ' (ESC to cancel)', 'info', 2000);
            }
        },

        cancelPlacement: function () {
            _state = 'idle';
            _placingType = null;
            if (typeof Render !== 'undefined' && Render.clearPlacementPreview) {
                Render.clearPlacementPreview();
            }
            // Hide build info card
            var card = document.getElementById('build-info-card');
            if (card) card.classList.remove('visible');
            // Deselect build buttons
            var btns = document.querySelectorAll('.build-btn');
            for (var i = 0; i < btns.length; i++) btns[i].classList.remove('selected');
        },

        // ---- cable mode ----

        startCableMode: function (fromBuildingId) {
            _state = 'cable';
            _cableFromId = fromBuildingId;
            if (typeof UI !== 'undefined' && UI.showToast) {
                UI.showToast('Click a building to connect cable (ESC to cancel)', 'info', 3000);
            }
        },

        cancelCable: function () {
            _cancelCable();
        }
    };
})();

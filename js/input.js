// ============================================================================
// Volt Defense — Input Module
// Handles all mouse and keyboard input for the game canvas.
// ============================================================================

var Input = (function () {
    var _state = 'idle';         // 'idle', 'placing', 'selecting', 'dragging', 'cable'
    var _placingType = null;
    var _selectedBuildingId = null;
    var _cableFromId = null;
    var _cableType = 'standard';  // 'standard' or 'high_capacity'
    var _lastWaterClickTime = 0;
    var _lastClickTime = 0;
    var _clickThrottleMs = 250; // minimum ms between processed clicks
    var _mouseWorld = { x: 0, y: 0 };
    var _mouseScreen = { x: 0, y: 0 };
    var _mouseGrid = { x: 0, y: 0 };
    var _isDragging = false;
    var _dragStart = { x: 0, y: 0 };
    var _keysDown = {};
    var _cameraMoveSpeed = 400;
    var _initialized = false;
    var _lastMouseGrid = { x: -1, y: -1 };

    // Debug mode
    var _debugMode = false;
    var _debugSpawnType = null;
    var _debugKeyBuffer = '';
    var _debugKeyTimer = null;

    // Cable target cycling (Alt key during placement)
    var _cableTargetIdx = -1; // -1 = auto (nearest), 0+ = index into eligible list

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

    // Returns sorted array of eligible cable target buildings for placement preview
    function _getEligibleCableTargets(cx, cy, typeKey) {
        if (typeof Buildings === 'undefined' || !Buildings.getAll) return [];
        if (typeof Config === 'undefined' || !Config.BUILDINGS) return [];
        var maxLen = Config.CABLE_MAX_LENGTH || 200;
        var def = Config.BUILDINGS[typeKey];
        if (!def) return [];
        var restrictedCats = { weapons: true, mining: true, defense: true };
        var allowedCats = { storage: true, grid: true };
        var placedCat = def.category || '';
        var isRestricted = !!restrictedCats[placedCat];
        var allBuildings = Buildings.getAll();
        var eligible = [];
        for (var i = 0; i < allBuildings.length; i++) {
            var other = allBuildings[i];
            if (isRestricted) {
                var otherDef = Config.BUILDINGS[other.type];
                var otherCat = otherDef ? otherDef.category : '';
                if (!allowedCats[otherCat] && other.type !== 'core') continue;
            }
            var bc = (typeof Buildings.getBuildingCenter === 'function') ? Buildings.getBuildingCenter(other) : { x: other.worldX, y: other.worldY };
            var dx = bc.x - cx;
            var dy = bc.y - cy;
            var d = Math.sqrt(dx * dx + dy * dy);
            if (d <= maxLen) {
                eligible.push({ building: other, center: bc, dist: d });
            }
        }
        eligible.sort(function (a, b) { return a.dist - b.dist; });
        return eligible;
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

        var placedDef = (typeof Config !== 'undefined' && Config.BUILDINGS) ? Config.BUILDINGS[placedBuilding.type] : null;
        var bc = (typeof Buildings.getBuildingCenter === 'function') ? Buildings.getBuildingCenter(placedBuilding) : { x: placedBuilding.worldX, y: placedBuilding.worldY };
        var eligible = _getEligibleCableTargets(bc.x, bc.y, placedBuilding.type);
        if (eligible.length === 0) return;

        // Use override index if valid, otherwise nearest (index 0)
        var idx = (_cableTargetIdx >= 0 && _cableTargetIdx < eligible.length) ? _cableTargetIdx : 0;
        var bestId = eligible[idx].building.id;

        // Capacitors auto-connect with HC cable
        var autoCableType = 'standard';
        if (placedDef && placedDef.maxChargeRate >= 100 && placedDef.maxDischargeRate >= 100) {
            autoCableType = 'high_capacity';
        }
        Buildings.addCable(placedBuilding.id, bestId, autoCableType);
    }

    function _getBuildingAtMouse() {
        if (typeof Buildings === 'undefined' || !Buildings.getAt) return null;
        return Buildings.getAt(_mouseGrid.x, _mouseGrid.y);
    }

    function _showDepositInfo(dep) {
        if (!dep || typeof UI === 'undefined' || !UI.showToast) return;
        var names = { iron: 'Iron Ore', coal: 'Coal', uranium: 'Uranium', oil: 'Oil' };
        var icons = { iron: '⛏️', coal: '🪨', uranium: '☢️', oil: '🛢️' };
        var name = names[dep.type] || dep.type;
        var icon = icons[dep.type] || '';
        var pct = dep.maxAmount > 0 ? Math.floor((dep.remaining / dep.maxAmount) * 100) : 0;
        UI.showToast(icon + ' ' + name + ' Deposit — ' + dep.remaining + '/' + dep.maxAmount + ' remaining (' + pct + '%)', 'info', 3000);
    }

    function _getEnemyAtWorld(wx, wy) {
        if (typeof Enemies === 'undefined' || !Enemies.getAll) return null;
        var all = Enemies.getAll();
        var bestDist = Infinity;
        var best = null;
        for (var i = 0; i < all.length; i++) {
            var e = all[i];
            if (e.hp <= 0) continue;
            var dx = e.x - wx;
            var dy = e.y - wy;
            var dist = dx * dx + dy * dy;
            var clickRadius = 20; // generous click area
            if (dist <= clickRadius * clickRadius && dist < bestDist) {
                bestDist = dist;
                best = e;
            }
        }
        return best;
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

        var result = Buildings.addCable(_cableFromId, building.id, _cableType);
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

            // Touch-to-mouse conflict guard (declared here for hoisting clarity)
            var _lastTouchEnd = 0;

            // ---- Mouse move ----
            canvas.addEventListener('mousemove', function (e) {
                // Skip synthetic mouse events from touch
                if (_lastTouchEnd && performance.now() - _lastTouchEnd < 500) return;
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
                var newGridX = Math.floor(_mouseWorld.x / cellSize);
                var newGridY = Math.floor(_mouseWorld.y / cellSize);

                // Skip expensive checks if grid cell hasn't changed
                if (newGridX === _lastMouseGrid.x && newGridY === _lastMouseGrid.y) {
                    return;
                }
                _lastMouseGrid.x = newGridX;
                _lastMouseGrid.y = newGridY;
                _mouseGrid.x = newGridX;
                _mouseGrid.y = newGridY;

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
                // Skip synthetic mouse events from touch
                if (_lastTouchEnd && performance.now() - _lastTouchEnd < 500) return;
                if (e.button === 0) {
                    if (_isPaused()) return;
                    // Throttle rapid clicks to prevent freezing
                    var clickNow = performance.now();
                    if (clickNow - _lastClickTime < _clickThrottleMs) return;
                    _lastClickTime = clickNow;
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
                    } else if (_debugMode && _debugSpawnType) {
                        // Debug: spawn enemy at click position
                        if (typeof Enemies !== 'undefined' && Enemies.debugSpawn) {
                            Enemies.debugSpawn(_debugSpawnType, _mouseWorld.x, _mouseWorld.y);
                            if (typeof UI !== 'undefined' && UI.showToast) {
                                UI.showToast('Spawned: ' + _debugSpawnType, 'info', 1000);
                            }
                        }
                    } else if (_state === 'cable') {
                        _attemptCableConnection();
                    } else {
                        // Try selecting a building first; if nothing clicked, check enemy, then deposit, then pan
                        var clickedBuilding = _getBuildingAtMouse();
                        if (clickedBuilding) {
                            _attemptSelection();
                        } else {
                            // Check for enemy click
                            var clickedEnemy = _getEnemyAtWorld(_mouseWorld.x, _mouseWorld.y);
                            if (clickedEnemy) {
                                if (typeof UI !== 'undefined' && UI.showEnemyInfo) {
                                    UI.showEnemyInfo(clickedEnemy);
                                }
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
                                    // Water tile click — show flow info (debounce 500ms)
                                    var now = Date.now();
                                    if (now - _lastWaterClickTime > 500) {
                                        _lastWaterClickTime = now;
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
                                } else if (terrain === 4) {
                                    if (typeof UI !== 'undefined' && UI.showToast) {
                                        UI.showToast('🌉 Bridge — Walkable river crossing', 'info', 2000);
                                    }
                                }
                            }
                            // Start left-click drag pan
                            _isDragging = true;
                            _dragStart.x = e.clientX;
                            _dragStart.y = e.clientY;
                            }
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
                if (!_debugMode) return;
                // Debug: right-click to kill enemy
                var rect = canvas.getBoundingClientRect();
                var sx = e.clientX - rect.left;
                var sy = e.clientY - rect.top;
                var wx = sx, wy = sy;
                if (typeof Render !== 'undefined' && Render.screenToWorld) {
                    var w = Render.screenToWorld(sx, sy);
                    wx = w.x;
                    wy = w.y;
                }
                var enemy = _getEnemyAtWorld(wx, wy);
                if (enemy && typeof Enemies !== 'undefined' && Enemies.damageEnemy) {
                    Enemies.damageEnemy(enemy.id, enemy.hp + 1000, 1.0);
                    if (typeof UI !== 'undefined' && UI.showToast) {
                        UI.showToast('💀 Killed ' + (enemy.type || 'enemy'), 'info', 1000);
                    }
                }
            });

            // ---- Touch events (mobile support) ----
            var _touchId = null;   // primary touch identifier
            var _touch2Id = null;  // second finger for pinch
            var _pinchStartDist = 0;
            var _pinchStartZoom = 1;
            var _touchMoved = false;

            canvas.addEventListener('touchstart', function (e) {
                e.preventDefault();
                var rect = canvas.getBoundingClientRect();
                if (e.touches.length === 1 && _touchId === null) {
                    var t = e.touches[0];
                    _touchId = t.identifier;
                    _touchMoved = false;
                    _mouseScreen.x = t.clientX - rect.left;
                    _mouseScreen.y = t.clientY - rect.top;
                    if (typeof Render !== 'undefined' && Render.screenToWorld) {
                        var world = Render.screenToWorld(_mouseScreen.x, _mouseScreen.y);
                        _mouseWorld.x = world.x;
                        _mouseWorld.y = world.y;
                    }
                    var cellSize = _getCellSize();
                    _mouseGrid.x = Math.floor(_mouseWorld.x / cellSize);
                    _mouseGrid.y = Math.floor(_mouseWorld.y / cellSize);

                    // Update placement preview immediately
                    if (_state === 'placing' && _placingType) {
                        if (typeof Buildings !== 'undefined' && Buildings.canPlace) {
                            var check = Buildings.canPlace(_placingType, _mouseGrid.x, _mouseGrid.y, true);
                            if (typeof Render !== 'undefined' && Render.setPlacementPreview) {
                                Render.setPlacementPreview(_placingType, _mouseGrid.x, _mouseGrid.y, check.allowed);
                            }
                        }
                    }

                    _dragStart.x = t.clientX;
                    _dragStart.y = t.clientY;
                }
                // Second finger — start pinch zoom
                if (e.touches.length === 2) {
                    _touch2Id = e.touches[1].identifier;
                    var dx = e.touches[0].clientX - e.touches[1].clientX;
                    var dy = e.touches[0].clientY - e.touches[1].clientY;
                    _pinchStartDist = Math.sqrt(dx * dx + dy * dy);
                    _pinchStartZoom = (typeof Render !== 'undefined' && Render.getZoom) ? Render.getZoom() : 1;
                    _isDragging = false;
                }
            }, { passive: false });

            canvas.addEventListener('touchmove', function (e) {
                e.preventDefault();
                var rect = canvas.getBoundingClientRect();

                // Pinch zoom with two fingers
                if (e.touches.length === 2 && _pinchStartDist > 0) {
                    var dx = e.touches[0].clientX - e.touches[1].clientX;
                    var dy = e.touches[0].clientY - e.touches[1].clientY;
                    var dist = Math.sqrt(dx * dx + dy * dy);
                    var scale = dist / _pinchStartDist;
                    if (typeof Render !== 'undefined' && Render.setZoom) {
                        Render.setZoom(_pinchStartZoom * scale);
                    }
                    _touchMoved = true;
                    return;
                }

                // Single finger — drag/pan or placement preview
                for (var ti = 0; ti < e.touches.length; ti++) {
                    if (e.touches[ti].identifier === _touchId) {
                        var t = e.touches[ti];
                        var tdx = t.clientX - _dragStart.x;
                        var tdy = t.clientY - _dragStart.y;

                        if (Math.abs(tdx) > 4 || Math.abs(tdy) > 4) {
                            _touchMoved = true;
                        }

                        // Update screen/world coords
                        _mouseScreen.x = t.clientX - rect.left;
                        _mouseScreen.y = t.clientY - rect.top;
                        if (typeof Render !== 'undefined' && Render.screenToWorld) {
                            var world = Render.screenToWorld(_mouseScreen.x, _mouseScreen.y);
                            _mouseWorld.x = world.x;
                            _mouseWorld.y = world.y;
                        }
                        var cellSize = _getCellSize();
                        _mouseGrid.x = Math.floor(_mouseWorld.x / cellSize);
                        _mouseGrid.y = Math.floor(_mouseWorld.y / cellSize);

                        if (_state === 'placing' && _placingType) {
                            // Update placement preview while dragging finger
                            if (typeof Buildings !== 'undefined' && Buildings.canPlace) {
                                var check = Buildings.canPlace(_placingType, _mouseGrid.x, _mouseGrid.y, true);
                                if (typeof Render !== 'undefined' && Render.setPlacementPreview) {
                                    Render.setPlacementPreview(_placingType, _mouseGrid.x, _mouseGrid.y, check.allowed);
                                }
                            }
                        } else if (_state !== 'cable') {
                            // Pan camera
                            if (_touchMoved) {
                                if (typeof Render !== 'undefined' && Render.moveCamera) {
                                    Render.moveCamera(-tdx, -tdy);
                                }
                                _dragStart.x = t.clientX;
                                _dragStart.y = t.clientY;
                            }
                        }

                        if (_state === 'cable' && _cableFromId) {
                            if (typeof Render !== 'undefined' && Render.setCablePreview) {
                                Render.setCablePreview(_cableFromId, _mouseWorld);
                            }
                        }
                        break;
                    }
                }
            }, { passive: false });

            canvas.addEventListener('touchend', function (e) {
                e.preventDefault();
                // Check if the lifted touch was our tracked finger
                var liftedPrimary = true;
                for (var ti = 0; ti < e.touches.length; ti++) {
                    if (e.touches[ti].identifier === _touchId) {
                        liftedPrimary = false;
                        break;
                    }
                }

                if (liftedPrimary && _touchId !== null) {
                    // If we didn't move much, treat as a tap (click)
                    if (!_touchMoved && !_isPaused()) {
                        var clickNow = performance.now();
                        if (clickNow - _lastClickTime >= _clickThrottleMs) {
                            _lastClickTime = clickNow;

                            // Check minimap tap
                            if (typeof Render !== 'undefined' && Render.getMinimapBounds) {
                                var mmBounds = Render.getMinimapBounds();
                                if (_mouseScreen.x >= mmBounds.x && _mouseScreen.x <= mmBounds.x + mmBounds.width &&
                                    _mouseScreen.y >= mmBounds.y && _mouseScreen.y <= mmBounds.y + mmBounds.height) {
                                    var worldPos = Render.minimapToWorld(_mouseScreen.x, _mouseScreen.y);
                                    Render.centerOn(worldPos.x, worldPos.y);
                                    _touchId = null;
                                    _touch2Id = null;
                                    return;
                                }
                            }

                            if (_state === 'placing') {
                                _attemptPlacement();
                            } else if (_state === 'cable') {
                                _attemptCableConnection();
                            } else {
                                var clickedBuilding = _getBuildingAtMouse();
                                if (clickedBuilding) {
                                    _attemptSelection();
                                } else {
                                    var clickedEnemy = _getEnemyAtWorld(_mouseWorld.x, _mouseWorld.y);
                                    if (clickedEnemy) {
                                        if (typeof UI !== 'undefined' && UI.showEnemyInfo) {
                                            UI.showEnemyInfo(clickedEnemy);
                                        }
                                    } else {
                                        var dep = (typeof Map !== 'undefined' && Map.getDepositAt)
                                            ? Map.getDepositAt(_mouseGrid.x, _mouseGrid.y) : null;
                                        if (dep) {
                                            _showDepositInfo(dep);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    _touchId = null;
                    _touchMoved = false;
                    _isDragging = false;
                    _lastTouchEnd = performance.now();
                }

                // Reset pinch if second finger lifted
                if (e.touches.length < 2) {
                    _touch2Id = null;
                    _pinchStartDist = 0;
                }
                // If all fingers lifted, reset
                if (e.touches.length === 0) {
                    _touchId = null;
                    _touch2Id = null;
                    _pinchStartDist = 0;
                    _isDragging = false;
                }
            }, { passive: false });

            canvas.addEventListener('touchcancel', function (e) {
                _touchId = null;
                _touch2Id = null;
                _pinchStartDist = 0;
                _isDragging = false;
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

                // Debug mode activation: type "volt"
                if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
                    _debugKeyBuffer += e.key.toLowerCase();
                    if (_debugKeyTimer) clearTimeout(_debugKeyTimer);
                    _debugKeyTimer = setTimeout(function() { _debugKeyBuffer = ''; }, 1500);
                    if (_debugKeyBuffer.indexOf('volt') !== -1) {
                        _debugKeyBuffer = '';
                        _debugMode = !_debugMode;
                        _debugSpawnType = null;
                        if (typeof UI !== 'undefined' && UI.toggleDebugBar) {
                            UI.toggleDebugBar(_debugMode);
                        }
                        if (typeof UI !== 'undefined' && UI.showToast) {
                            UI.showToast(_debugMode ? '⚡ Debug mode ON' : 'Debug mode OFF', 'info', 2000);
                        }
                        return;
                    }
                }

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

                // M — toggle music
                if (e.key === 'm' || e.key === 'M') {
                    if (typeof Music !== 'undefined' && Music.toggle) {
                        var musicOn = Music.toggle();
                        var musicBtn = document.getElementById('btn-music-toggle');
                        if (musicBtn) musicBtn.textContent = musicOn ? '🔊' : '🔇';
                        var menuMusicBtn = document.getElementById('menu-music-toggle');
                        if (menuMusicBtn) menuMusicBtn.textContent = musicOn ? '🔊 Music On' : '🔇 Music Off';
                    }
                    return;
                }

                // All remaining keys require game to be running
                if (_isPaused()) return;

                // Alt — cycle cable target during placement
                if (e.key === 'Alt' && _state === 'placing' && _placingType) {
                    e.preventDefault();
                    var cs = _getCellSize();
                    var def = (typeof Config !== 'undefined' && Config.BUILDINGS) ? Config.BUILDINGS[_placingType] : null;
                    var sizeW = (def && def.size) ? def.size[0] : 1;
                    var sizeH = (def && def.size) ? def.size[1] : 1;
                    var cx = _mouseGrid.x * cs + (sizeW * cs) / 2;
                    var cy = _mouseGrid.y * cs + (sizeH * cs) / 2;
                    var eligible = _getEligibleCableTargets(cx, cy, _placingType);
                    if (eligible.length > 1) {
                        _cableTargetIdx = (_cableTargetIdx + 1) % eligible.length;
                        if (typeof UI !== 'undefined' && UI.showToast) {
                            UI.showToast('Cable target: ' + (Config.BUILDINGS[eligible[_cableTargetIdx].building.type] || {}).name + ' (' + (_cableTargetIdx + 1) + '/' + eligible.length + ')', 'info', 1500);
                        }
                    }
                    return;
                }

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

                // C — cable mode, Shift+C — HC cable mode
                if ((e.key === 'c' || e.key === 'C') && _selectedBuildingId && _state === 'idle') {
                    var cType = e.shiftKey ? 'high_capacity' : 'standard';
                    Input.startCableMode(_selectedBuildingId, cType);
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
                if (e.key >= '1' && e.key <= '9') {
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
        getCableTargetIdx: function () { return _cableTargetIdx; },
        getEligibleCableTargets: function (cx, cy, typeKey) { return _getEligibleCableTargets(cx, cy, typeKey); },
        getSelectedBuildingId: function () { return _selectedBuildingId; },
        getDepositTooltip: function () { return _getDepositTooltip(); },

        // ---- debug mode ----
        isDebugMode: function () { return _debugMode; },
        setDebugSpawnType: function (typeKey) { _debugSpawnType = typeKey; },
        getDebugSpawnType: function () { return _debugSpawnType; },

        // ---- placement mode ----

        setPlacingMode: function (typeKey) {
            _state = 'placing';
            _placingType = typeKey;
            _cableTargetIdx = -1;
            _deselectBuilding();

            if (typeof Render !== 'undefined' && Render.setPlacementPreview) {
                Render.setPlacementPreview(typeKey, _mouseGrid.x, _mouseGrid.y, false);
            }
            if (typeof UI !== 'undefined' && UI.showToast) {
                var name = typeKey;
                if (typeof Config !== 'undefined' && Config.BUILDINGS && Config.BUILDINGS[typeKey]) {
                    name = Config.BUILDINGS[typeKey].name;
                }
                var cancelHint = ('ontouchstart' in window || navigator.maxTouchPoints > 0) ? '(tap ✕ to cancel)' : '(ESC to cancel)';
                UI.showToast('Placing: ' + name + ' ' + cancelHint, 'info', 2000);
            }
        },

        cancelPlacement: function () {
            _state = 'idle';
            _placingType = null;
            _cableTargetIdx = -1;
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

        startCableMode: function (fromBuildingId, cableTypeOverride) {
            _state = 'cable';
            _cableFromId = fromBuildingId;
            _cableType = cableTypeOverride || 'standard';
            var label = _cableType === 'high_capacity' ? 'HC cable' : 'cable';
            if (typeof UI !== 'undefined' && UI.showToast) {
                var cancelHint = ('ontouchstart' in window || navigator.maxTouchPoints > 0) ? '(tap ✕ to cancel)' : '(ESC to cancel)';
                UI.showToast('Click a building to connect ' + label + ' ' + cancelHint, 'info', 3000);
            }
        },

        getCableType: function() {
            return _cableType;
        },

        setCableType: function(t) {
            _cableType = t || 'standard';
        },

        cancelCable: function () {
            _cancelCable();
        },

        // Returns current input state ('idle', 'placing', 'cable', etc.)
        getState: function () {
            return _state;
        },

        // Returns currently selected building id or null
        getSelectedBuildingId: function () {
            return _selectedBuildingId;
        },

        // Replicates ESC key cascade for mobile cancel button
        handleEscape: function () {
            if (_state === 'placing') {
                Input.cancelPlacement();
            } else if (_state === 'cable') {
                _cancelCable();
            } else if (_selectedBuildingId) {
                _deselectBuilding();
            }
        }
    };
})();

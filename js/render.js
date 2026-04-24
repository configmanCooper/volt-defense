// ============================================================================
// Volt Defense — Rendering System
// Handles all canvas drawing: terrain, buildings, cables, enemies, projectiles,
// shields, UI overlays, and the minimap.
// ============================================================================

var Render = (function () {

    // ------------------------------------------------------------------------
    // Color palette
    // ------------------------------------------------------------------------
    var COLORS = {
        TERRAIN: {
            grass: '#4a9a38',
            rock: '#6a6560',
            water: '#1a4a8a',
            deep_water: '#0a2a5a'
        },
        DEPOSIT: {
            iron: '#6a5a4a',
            coal: '#3a3a3a',
            uranium: '#2a4a2a',
            oil: '#1a1208'
        },
        BUILDING: {
            power: '#f0c040',
            storage: '#40c0c0',
            mining: '#c08030',
            weapons: '#c04040',
            defense: '#4060c0',
            housing: '#40a040',
            environment: '#60c060',
            grid: '#808080'
        },
        FLOWER: ['rgba(220,200,60,0.7)', 'rgba(200,100,140,0.6)', 'rgba(180,180,220,0.6)'],
        CABLE: {
            normal: '#00aacc',
            active: '#00eeff',
            glow: '#00ccff'
        },
        ENEMY: {
            spark: '#ffee00',
            runner: '#ff8800',
            grunt: '#cc3333',
            shielded_grunt: '#6666cc',
            bomber: '#cc6600',
            tank: '#883333',
            emp_drone: '#33ccff',
            swarm: '#ffaa00',
            heavy_tank: '#661111',
            saboteur: '#996633',
            siege_engine: '#441111',
            phase_walker: '#aa44ff',
            jammer: '#669966'
        },
        SHIELD: {
            fill: 'rgba(100, 180, 255, 0.15)',
            border: '#66aaff',
            hit: 'rgba(255, 255, 255, 0.4)'
        },
        LASER: {
            low: '#ff4444',
            mid: '#ff8844',
            high: '#ffee88',
            glow: '#ffffff'
        },
        MISSILE: {
            body: '#ff6622',
            trail: '#ff4400'
        },
        TESLA: {
            chain: '#44aaff',
            glow: '#88ccff'
        },
        RAILGUN: {
            beam: '#aaeeff',
            glow: '#ffffff'
        },
        EMP: {
            ring: '#88ddff',
            fill: 'rgba(100, 200, 255, 0.1)'
        },
        FLAME: {
            glow: 'rgba(255, 140, 0, 0.25)',
            inner: 'rgba(255, 80, 0, 0.15)'
        },
        DRONE: {
            body: '#4488ff',
            dot: '#aaccff'
        },
        UI: {
            hpGreen: '#44cc44',
            hpRed: '#cc4444',
            selected: '#ffffff',
            invalid: 'rgba(255,0,0,0.3)',
            valid: 'rgba(0,255,0,0.3)'
        }
    };

    // Deposit icon labels
    var DEPOSIT_ICONS = { iron: 'Fe', coal: 'C', uranium: 'U', oil: 'Oil' };

    // Enemy size multipliers (base radius 8)
    var ENEMY_RADIUS = {
        tank: 12, heavy_tank: 14, siege_engine: 16,
        spark: 6, runner: 7, swarm: 5
    };
    var ENEMY_RADIUS_DEFAULT = 8;

    // Reusable coordinate objects to avoid allocations in draw loop
    var _tmpScreen = { x: 0, y: 0 };
    var _tmpWorld = { x: 0, y: 0 };

    // ------------------------------------------------------------------------
    // Private state
    // ------------------------------------------------------------------------
    var _canvas = null;
    var _ctx = null;
    var _camera = { x: 0, y: 0 };
    var _zoom = 1.0;
    var _animFrame = 0;
    var _lastTime = 0;
    var _placementPreview = null; // {typeKey, gridX, gridY, valid}

    // Terrain cache
    var _terrainDirty = true;
    var _terrainCanvas = null;
    var _terrainCtx = null;
    var _cachedCamX = -1;
    var _cachedCamY = -1;

    // Static terrain cache (offscreen canvas for non-animated tiles)
    var _staticTerrainCanvas = null;
    var _staticTerrainCtx = null;
    var _staticCacheStartCol = -1;
    var _staticCacheStartRow = -1;
    var _staticCacheEndCol = -1;
    var _staticCacheEndRow = -1;

    // Minimap
    var MINIMAP_SIZE = 200;
    var MINIMAP_PADDING = 10;
    var MINIMAP_BOTTOM_OFFSET = 150; // Above the build bar
    var _minimapFrameCounter = 0;
    var _minimapCanvas = null;
    var _minimapCtx = null;

    // Projectile trail history (id → array of {x,y})
    var _trails = {};
    var TRAIL_LENGTH = 6;

    // Damage numbers
    var _damageNumbers = [];
    var DAMAGE_NUMBER_DURATION = 60; // frames

    // Shield hit flash timers (buildingId → framesRemaining)
    var _shieldFlashes = {};

    // ------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------
    function _cellSize() {
        return Config.GRID_CELL_SIZE;
    }

    function _gridCols() {
        return Math.floor(Config.MAP_WIDTH / Config.GRID_CELL_SIZE);
    }

    function _gridRows() {
        return Math.floor(Config.MAP_HEIGHT / Config.GRID_CELL_SIZE);
    }

    function _clampCamera() {
        var maxX = Config.MAP_WIDTH - Config.VIEWPORT_WIDTH / _zoom;
        var maxY = Config.MAP_HEIGHT - Config.VIEWPORT_HEIGHT / _zoom;
        if (_camera.x < 0) _camera.x = 0;
        if (_camera.y < 0) _camera.y = 0;
        if (_camera.x > maxX) _camera.x = maxX;
        if (_camera.y > maxY) _camera.y = maxY;
    }

    // Visible grid range (inclusive)
    function _visibleRange() {
        var cs = _cellSize();
        var startCol = Math.floor(_camera.x / cs);
        var startRow = Math.floor(_camera.y / cs);
        var endCol = Math.floor((_camera.x + Config.VIEWPORT_WIDTH / _zoom) / cs);
        var endRow = Math.floor((_camera.y + Config.VIEWPORT_HEIGHT / _zoom) / cs);
        var cols = _gridCols();
        var rows = _gridRows();
        if (startCol < 0) startCol = 0;
        if (startRow < 0) startRow = 0;
        if (endCol >= cols) endCol = cols - 1;
        if (endRow >= rows) endRow = rows - 1;
        return { startCol: startCol, startRow: startRow, endCol: endCol, endRow: endRow };
    }

    function _isInViewport(wx, wy, margin) {
        margin = margin || 0;
        var vw = Config.VIEWPORT_WIDTH / _zoom;
        var vh = Config.VIEWPORT_HEIGHT / _zoom;
        return wx + margin >= _camera.x && wx - margin <= _camera.x + vw &&
               wy + margin >= _camera.y && wy - margin <= _camera.y + vh;
    }

    // Simple deterministic hash for terrain variation
    function _cellHash(col, row) {
        return ((col * 73856093) ^ (row * 19349663)) & 0x7fffffff;
    }

    // Smooth noise-like value from grid coords (0..1 range)
    function _smoothNoise(col, row, scale) {
        var x = col / scale;
        var y = row / scale;
        var ix = Math.floor(x);
        var iy = Math.floor(y);
        var fx = x - ix;
        var fy = y - iy;
        // Smoothstep
        fx = fx * fx * (3 - 2 * fx);
        fy = fy * fy * (3 - 2 * fy);
        var a = (_cellHash(ix, iy) % 1000) / 1000;
        var b = (_cellHash(ix + 1, iy) % 1000) / 1000;
        var c = (_cellHash(ix, iy + 1) % 1000) / 1000;
        var d = (_cellHash(ix + 1, iy + 1) % 1000) / 1000;
        var top = a + (b - a) * fx;
        var bot = c + (d - c) * fx;
        return top + (bot - top) * fy;
    }

    // Multi-octave noise for natural-looking terrain
    function _terrainNoise(col, row) {
        return _smoothNoise(col, row, 8) * 0.5 +
               _smoothNoise(col, row, 16) * 0.3 +
               _smoothNoise(col, row, 32) * 0.2;
    }

    // Noise caches for terrain rendering
    var _noiseCache = {};
    var _smoothNoiseCache = {};

    function _getSmoothNoise(col, row, scale) {
        var key = col + ',' + row + ',' + scale;
        if (_smoothNoiseCache[key] !== undefined) return _smoothNoiseCache[key];
        var val = _smoothNoise(col, row, scale);
        _smoothNoiseCache[key] = val;
        return val;
    }

    function _getTerrainNoise(col, row) {
        var key = col * 10000 + row;
        if (_noiseCache[key] !== undefined) return _noiseCache[key];
        var val = _terrainNoise(col, row);
        _noiseCache[key] = val;
        return val;
    }

    // ------------------------------------------------------------------------
    // Drawing helpers
    // ------------------------------------------------------------------------
    function _drawHPBar(ctx, sx, sy, w, ratio) {
        var barW = w;
        var barH = 4;
        var bx = Math.floor(sx - barW / 2);
        var by = Math.floor(sy - 6);
        ctx.fillStyle = COLORS.UI.hpRed;
        ctx.fillRect(bx, by, barW, barH);
        ctx.fillStyle = COLORS.UI.hpGreen;
        ctx.fillRect(bx, by, Math.floor(barW * ratio), barH);
    }

    // ------------------------------------------------------------------------
    // Layer: Terrain
    // ------------------------------------------------------------------------

    // Draws a single static terrain tile to the given context at (sx, sy)
    function _drawStaticTile(sctx, t, col, row, sx, sy, cs, hash) {
        var brightness, localHash, nv, patchNoise;
        if (t === 0) {
            // Natural grass with multi-octave noise for color variation
            nv = _getTerrainNoise(col, row);
            localHash = hash % 100;

            var baseR = 52 + Math.floor(nv * 30) + ((localHash % 12) - 6);
            var baseG = 115 + Math.floor(nv * 50) + ((localHash % 16) - 8);
            var baseB = 38 + Math.floor(nv * 15) + ((localHash % 8) - 4);

            sctx.fillStyle = 'rgb(' + baseR + ',' + baseG + ',' + baseB + ')';
            sctx.fillRect(sx, sy, cs, cs);

            patchNoise = _getSmoothNoise(col, row, 5);
            if (patchNoise > 0.6) {
                sctx.fillStyle = 'rgba(90,160,50,' + ((patchNoise - 0.6) * 0.4) + ')';
                sctx.fillRect(sx, sy, cs, cs);
            } else if (patchNoise < 0.3) {
                sctx.fillStyle = 'rgba(30,60,15,' + ((0.3 - patchNoise) * 0.35) + ')';
                sctx.fillRect(sx, sy, cs, cs);
            }

            if (localHash < 40) {
                var clumpX = sx + (hash % (cs - 8)) + 2;
                var clumpY = sy + ((hash * 3) % (cs - 8)) + 2;
                var clumpR = 3 + (hash % 4);
                sctx.fillStyle = localHash < 20
                    ? 'rgba(45,100,25,0.3)'
                    : 'rgba(85,155,55,0.25)';
                sctx.beginPath();
                sctx.arc(clumpX, clumpY, clumpR, 0, Math.PI * 2);
                sctx.fill();
            }

            var bladeCount = 3 + (hash % 4);
            for (var bl = 0; bl < bladeCount; bl++) {
                var seed = hash * (bl + 1);
                var bx = sx + 3 + ((seed * 7) % (cs - 6));
                var by = sy + cs - 1;
                var bh = 6 + ((seed * 3) % 14);
                var lean = ((seed * 13) % 9) - 4;
                var bladeAlpha = 0.2 + ((seed % 20) / 80);
                var bladeGreen = 120 + ((seed * 11) % 60);
                sctx.strokeStyle = 'rgba(50,' + bladeGreen + ',35,' + bladeAlpha + ')';
                sctx.lineWidth = 1;
                sctx.beginPath();
                sctx.moveTo(bx, by);
                sctx.quadraticCurveTo(bx + lean * 0.5, by - bh * 0.6, bx + lean, by - bh);
                sctx.stroke();
            }

            if (hash % 25 === 0) {
                var fx1 = sx + 6 + (hash % (cs - 12));
                var fy1 = sy + 6 + ((hash * 7) % (cs - 12));
                sctx.fillStyle = COLORS.FLOWER[hash % 3];
                sctx.beginPath();
                sctx.arc(fx1, fy1, 1.5, 0, Math.PI * 2);
                sctx.fill();
            }
        } else if (t === 1) {
            // Rocky terrain
            nv = _getTerrainNoise(col, row);
            brightness = (hash % 20) - 10;
            var rr = 85 + brightness + Math.floor(nv * 20);
            var rg = 80 + brightness + Math.floor(nv * 18);
            var rb = 75 + brightness + Math.floor(nv * 15);
            sctx.fillStyle = 'rgb(' + rr + ',' + rg + ',' + rb + ')';
            sctx.fillRect(sx, sy, cs, cs);
            if (hash % 3 === 0) {
                sctx.strokeStyle = 'rgba(50,45,40,0.3)';
                sctx.lineWidth = 1;
                sctx.beginPath();
                sctx.moveTo(sx + (hash % cs), sy);
                sctx.lineTo(sx + ((hash * 3) % cs), sy + cs);
                sctx.stroke();
            }
            if (hash % 5 === 0) {
                sctx.fillStyle = 'rgba(130,125,115,0.25)';
                sctx.beginPath();
                sctx.arc(sx + cs * 0.5 + (hash % 10) - 5, sy + cs * 0.5, 5 + hash % 4, 0, Math.PI * 2);
                sctx.fill();
            }
        } else if (t === 4) {
            // Bridge
            sctx.fillStyle = '#8B7355';
            sctx.fillRect(sx, sy, cs, cs);
            sctx.fillStyle = '#6B5535';
            var plankH = Math.floor(cs / 3);
            sctx.fillRect(sx, sy + plankH - 1, cs, 2);
            sctx.fillRect(sx, sy + plankH * 2 - 1, cs, 2);
            sctx.fillStyle = 'rgba(180,160,130,0.3)';
            sctx.fillRect(sx + 2, sy + 2, cs - 4, plankH - 4);
            sctx.fillRect(sx + 2, sy + plankH + 2, cs - 4, plankH - 4);
            sctx.fillStyle = '#5A4430';
            sctx.beginPath();
            sctx.arc(sx + 3, sy + 3, 2, 0, Math.PI * 2);
            sctx.fill();
            sctx.beginPath();
            sctx.arc(sx + cs - 3, sy + 3, 2, 0, Math.PI * 2);
            sctx.fill();
            sctx.beginPath();
            sctx.arc(sx + 3, sy + cs - 3, 2, 0, Math.PI * 2);
            sctx.fill();
            sctx.beginPath();
            sctx.arc(sx + cs - 3, sy + cs - 3, 2, 0, Math.PI * 2);
            sctx.fill();
        } else if (t === 10) {
            // Iron ore deposit
            nv = _getTerrainNoise(col, row);
            sctx.fillStyle = 'rgb(' + (50 + Math.floor(nv * 25)) + ',' + (115 + Math.floor(nv * 35)) + ',' + (38 + Math.floor(nv * 12)) + ')';
            sctx.fillRect(sx, sy, cs, cs);
            sctx.fillStyle = 'rgba(100,80,55,0.4)';
            sctx.beginPath();
            sctx.ellipse(sx + cs * 0.5, sy + cs * 0.5, cs * 0.4, cs * 0.35, 0, 0, Math.PI * 2);
            sctx.fill();
            sctx.fillStyle = '#7a6555';
            sctx.beginPath();
            sctx.arc(sx + cs * 0.35, sy + cs * 0.38, cs * 0.18, 0, Math.PI * 2);
            sctx.fill();
            sctx.fillStyle = '#8d7565';
            sctx.beginPath();
            sctx.arc(sx + cs * 0.6, sy + cs * 0.55, cs * 0.15, 0, Math.PI * 2);
            sctx.fill();
            sctx.fillStyle = '#6d5a48';
            sctx.beginPath();
            sctx.arc(sx + cs * 0.48, sy + cs * 0.65, cs * 0.12, 0, Math.PI * 2);
            sctx.fill();
            sctx.fillStyle = 'rgba(200,180,150,0.45)';
            sctx.beginPath();
            sctx.arc(sx + cs * 0.3, sy + cs * 0.33, cs * 0.06, 0, Math.PI * 2);
            sctx.fill();
        } else if (t === 11) {
            // Coal deposit
            nv = _getTerrainNoise(col, row);
            sctx.fillStyle = 'rgb(' + (48 + Math.floor(nv * 22)) + ',' + (108 + Math.floor(nv * 30)) + ',' + (36 + Math.floor(nv * 10)) + ')';
            sctx.fillRect(sx, sy, cs, cs);
            sctx.fillStyle = 'rgba(50,45,35,0.45)';
            sctx.beginPath();
            sctx.ellipse(sx + cs * 0.5, sy + cs * 0.5, cs * 0.38, cs * 0.32, 0, 0, Math.PI * 2);
            sctx.fill();
            sctx.fillStyle = '#2a2a2a';
            sctx.fillRect(sx + cs * 0.22, sy + cs * 0.28, cs * 0.28, cs * 0.22);
            sctx.fillStyle = '#1e1e1e';
            sctx.fillRect(sx + cs * 0.48, sy + cs * 0.42, cs * 0.22, cs * 0.2);
            sctx.fillStyle = '#333';
            sctx.fillRect(sx + cs * 0.3, sy + cs * 0.52, cs * 0.18, cs * 0.16);
            sctx.fillStyle = 'rgba(80,80,100,0.35)';
            sctx.fillRect(sx + cs * 0.24, sy + cs * 0.3, cs * 0.1, cs * 0.06);
        } else if (t === 2) {
            // Water placeholder — solid base color
            sctx.fillStyle = 'rgb(25,85,160)';
            sctx.fillRect(sx, sy, cs, cs);
        } else if (t === 3) {
            // Deep water placeholder
            sctx.fillStyle = 'rgb(15,50,100)';
            sctx.fillRect(sx, sy, cs, cs);
        } else if (t === 12) {
            // Uranium static base — grass + dark rock, no glow
            nv = _getTerrainNoise(col, row);
            sctx.fillStyle = 'rgb(' + (48 + Math.floor(nv * 20)) + ',' + (110 + Math.floor(nv * 30)) + ',' + (35 + Math.floor(nv * 10)) + ')';
            sctx.fillRect(sx, sy, cs, cs);
            sctx.fillStyle = '#3a4a30';
            sctx.beginPath();
            sctx.arc(sx + cs / 2, sy + cs / 2, cs * 0.32, 0, Math.PI * 2);
            sctx.fill();
        } else if (t === 13) {
            // Oil static base — grass + oily ground, no sheen
            nv = _getTerrainNoise(col, row);
            sctx.fillStyle = 'rgb(' + (48 + Math.floor(nv * 22)) + ',' + (108 + Math.floor(nv * 30)) + ',' + (36 + Math.floor(nv * 10)) + ')';
            sctx.fillRect(sx, sy, cs, cs);
            sctx.fillStyle = 'rgba(20,15,10,0.5)';
            sctx.beginPath();
            sctx.ellipse(sx + cs * 0.5, sy + cs * 0.55, cs * 0.4, cs * 0.35, 0, 0, Math.PI * 2);
            sctx.fill();
            sctx.fillStyle = '#1a1208';
            sctx.beginPath();
            sctx.ellipse(sx + cs * 0.45, sy + cs * 0.5, cs * 0.25, cs * 0.2, 0.3, 0, Math.PI * 2);
            sctx.fill();
            sctx.fillStyle = '#0d0a05';
            sctx.beginPath();
            sctx.arc(sx + cs * 0.7, sy + cs * 0.35, cs * 0.08, 0, Math.PI * 2);
            sctx.fill();
            sctx.beginPath();
            sctx.arc(sx + cs * 0.3, sy + cs * 0.7, cs * 0.06, 0, Math.PI * 2);
            sctx.fill();
        } else {
            sctx.fillStyle = COLORS.TERRAIN.grass;
            sctx.fillRect(sx, sy, cs, cs);
        }
    }

    function _ensureStaticTerrainCache() {
        var cs = _cellSize();
        var range = _visibleRange();
        var margin = 10;
        var needsRedraw = false;

        if (!_staticTerrainCanvas) {
            needsRedraw = true;
        } else if (range.startCol < _staticCacheStartCol + 3 ||
                   range.endCol > _staticCacheEndCol - 3 ||
                   range.startRow < _staticCacheStartRow + 3 ||
                   range.endRow > _staticCacheEndRow - 3) {
            needsRedraw = true;
        }

        if (_terrainDirty) {
            needsRedraw = true;
            _terrainDirty = false;
        }

        if (!needsRedraw) return;

        var cols = _gridCols();
        var rows = _gridRows();
        var cStartCol = Math.max(0, range.startCol - margin);
        var cEndCol = Math.min(cols - 1, range.endCol + margin);
        var cStartRow = Math.max(0, range.startRow - margin);
        var cEndRow = Math.min(rows - 1, range.endRow + margin);

        var cacheW = (cEndCol - cStartCol + 1) * cs;
        var cacheH = (cEndRow - cStartRow + 1) * cs;

        if (!_staticTerrainCanvas) {
            _staticTerrainCanvas = document.createElement('canvas');
            _staticTerrainCtx = _staticTerrainCanvas.getContext('2d');
        }
        _staticTerrainCanvas.width = cacheW;
        _staticTerrainCanvas.height = cacheH;

        var sctx = _staticTerrainCtx;
        var col, row, t, hash, sx, sy;
        for (col = cStartCol; col <= cEndCol; col++) {
            for (row = cStartRow; row <= cEndRow; row++) {
                t = Map.getTerrain(col, row);
                sx = (col - cStartCol) * cs;
                sy = (row - cStartRow) * cs;
                hash = _cellHash(col, row);
                _drawStaticTile(sctx, t, col, row, sx, sy, cs, hash);
            }
        }

        _staticCacheStartCol = cStartCol;
        _staticCacheEndCol = cEndCol;
        _staticCacheStartRow = cStartRow;
        _staticCacheEndRow = cEndRow;
    }

    function _drawTerrain(ctx) {
        var cs = _cellSize();
        var range = _visibleRange();
        if (typeof Map === 'undefined' || !Map || typeof Map.getTerrain !== 'function') return;

        _ensureStaticTerrainCache();

        // Blit static terrain cache
        if (_staticTerrainCanvas) {
            var offsetX = _staticCacheStartCol * cs;
            var offsetY = _staticCacheStartRow * cs;
            ctx.drawImage(_staticTerrainCanvas, offsetX, offsetY);
        }

        // Draw ONLY animated tiles on top
        var col, row, t, hash, sx, sy;
        for (col = range.startCol; col <= range.endCol; col++) {
            for (row = range.startRow; row <= range.endRow; row++) {
                t = Map.getTerrain(col, row);
                if (t !== 2 && t !== 3 && t !== 12 && t !== 13) continue;

                sx = col * cs;
                sy = row * cs;
                hash = _cellHash(col, row);

                if (t === 2) {
                    // Flowing water with realistic ripples
                    var wTime = _animFrame * 0.04;
                    var wave = Math.sin(wTime + col * 0.7 + row * 0.4) * 10;
                    var wave2a = Math.sin(wTime * 0.7 + col * 0.3 - row * 0.5) * 6;
                    var wr = 25 + Math.floor(wave + wave2a);
                    var wg = 85 + Math.floor(wave * 1.1 + wave2a * 0.8);
                    var wb = 160 + Math.floor(wave * 0.4);
                    ctx.fillStyle = 'rgb(' + wr + ',' + wg + ',' + wb + ')';
                    ctx.fillRect(sx, sy, cs, cs);
                    var neighbors = [
                        Map.getTerrain(col - 1, row), Map.getTerrain(col + 1, row),
                        Map.getTerrain(col, row - 1), Map.getTerrain(col, row + 1)
                    ];
                    for (var ni = 0; ni < 4; ni++) {
                        if (neighbors[ni] === 0) {
                            ctx.fillStyle = 'rgba(55,130,50,0.15)';
                            if (ni === 0) ctx.fillRect(sx, sy, 4, cs);
                            else if (ni === 1) ctx.fillRect(sx + cs - 4, sy, 4, cs);
                            else if (ni === 2) ctx.fillRect(sx, sy, cs, 4);
                            else ctx.fillRect(sx, sy + cs - 4, cs, 4);
                        }
                    }
                    ctx.strokeStyle = 'rgba(140,200,255,0.2)';
                    ctx.lineWidth = 1;
                    var ripOffset = (_animFrame * 0.6 + col * 4) % cs;
                    ctx.beginPath();
                    ctx.moveTo(sx, sy + ripOffset);
                    ctx.bezierCurveTo(sx + cs * 0.25, sy + ripOffset - 2.5, sx + cs * 0.75, sy + ripOffset + 2.5, sx + cs, sy + ripOffset);
                    ctx.stroke();
                    var ripOffset2 = (ripOffset + cs * 0.45) % cs;
                    ctx.beginPath();
                    ctx.moveTo(sx, sy + ripOffset2);
                    ctx.bezierCurveTo(sx + cs * 0.3, sy + ripOffset2 + 2, sx + cs * 0.6, sy + ripOffset2 - 2, sx + cs, sy + ripOffset2);
                    ctx.stroke();
                    if (Math.sin(wTime * 2 + hash) > 0.85) {
                        ctx.fillStyle = 'rgba(200,230,255,0.4)';
                        ctx.beginPath();
                        ctx.arc(sx + (hash % cs), sy + ((hash * 3) % cs), 1.5, 0, Math.PI * 2);
                        ctx.fill();
                    }
                } else if (t === 3) {
                    // Deep water — darker, slower ripples
                    var deepTime = _animFrame * 0.025;
                    var deepWave = Math.sin(deepTime + col * 0.4 + row * 0.6) * 8;
                    ctx.fillStyle = 'rgb(' + (15 + Math.floor(deepWave)) + ',' + (50 + Math.floor(deepWave * 0.8)) + ',' + (100 + Math.floor(deepWave * 0.3)) + ')';
                    ctx.fillRect(sx, sy, cs, cs);
                    if (Math.sin(deepTime * 1.5 + hash) > 0.9) {
                        ctx.fillStyle = 'rgba(80,130,180,0.2)';
                        ctx.beginPath();
                        ctx.arc(sx + (hash % cs), sy + ((hash * 5) % cs), 2, 0, Math.PI * 2);
                        ctx.fill();
                    }
                } else if (t === 12) {
                    // Uranium deposit — animated glow on top of cached base
                    var uranNv = _getTerrainNoise(col, row);
                    ctx.fillStyle = 'rgb(' + (48 + Math.floor(uranNv * 20)) + ',' + (110 + Math.floor(uranNv * 30)) + ',' + (35 + Math.floor(uranNv * 10)) + ')';
                    ctx.fillRect(sx, sy, cs, cs);
                    ctx.fillStyle = '#3a4a30';
                    ctx.beginPath();
                    ctx.arc(sx + cs / 2, sy + cs / 2, cs * 0.32, 0, Math.PI * 2);
                    ctx.fill();
                    var glowPulse = 0.25 + Math.sin(_animFrame * 0.08 + col) * 0.15;
                    ctx.fillStyle = 'rgba(60,230,60,' + glowPulse + ')';
                    ctx.beginPath();
                    ctx.arc(sx + cs / 2, sy + cs / 2, cs * 0.38, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = 'rgba(120,255,120,0.5)';
                    ctx.beginPath();
                    ctx.arc(sx + cs / 2, sy + cs / 2, cs * 0.14, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(80,220,80,' + (glowPulse * 0.6) + ')';
                    ctx.lineWidth = 1;
                    for (var vi = 0; vi < 3; vi++) {
                        var va = (hash * (vi + 1) * 2.1) % (Math.PI * 2);
                        ctx.beginPath();
                        ctx.moveTo(sx + cs / 2, sy + cs / 2);
                        ctx.lineTo(sx + cs / 2 + Math.cos(va) * cs * 0.35, sy + cs / 2 + Math.sin(va) * cs * 0.35);
                        ctx.stroke();
                    }
                } else if (t === 13) {
                    // Oil deposit — animated sheen on top of cached base
                    var oilNv = _getTerrainNoise(col, row);
                    ctx.fillStyle = 'rgb(' + (48 + Math.floor(oilNv * 22)) + ',' + (108 + Math.floor(oilNv * 30)) + ',' + (36 + Math.floor(oilNv * 10)) + ')';
                    ctx.fillRect(sx, sy, cs, cs);
                    ctx.fillStyle = 'rgba(20,15,10,0.5)';
                    ctx.beginPath();
                    ctx.ellipse(sx + cs * 0.5, sy + cs * 0.55, cs * 0.4, cs * 0.35, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#1a1208';
                    ctx.beginPath();
                    ctx.ellipse(sx + cs * 0.45, sy + cs * 0.5, cs * 0.25, cs * 0.2, 0.3, 0, Math.PI * 2);
                    ctx.fill();
                    var sheenPhase = _animFrame * 0.05 + col * 0.7 + row * 0.3;
                    var sheenR = 80 + Math.floor(Math.sin(sheenPhase) * 40);
                    var sheenG = 60 + Math.floor(Math.sin(sheenPhase + 2) * 40);
                    var sheenB = 100 + Math.floor(Math.sin(sheenPhase + 4) * 40);
                    ctx.fillStyle = 'rgba(' + sheenR + ',' + sheenG + ',' + sheenB + ',0.25)';
                    ctx.beginPath();
                    ctx.ellipse(sx + cs * 0.42, sy + cs * 0.48, cs * 0.15, cs * 0.1, 0.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#0d0a05';
                    ctx.beginPath();
                    ctx.arc(sx + cs * 0.7, sy + cs * 0.35, cs * 0.08, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.beginPath();
                    ctx.arc(sx + cs * 0.3, sy + cs * 0.7, cs * 0.06, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    }

    // ------------------------------------------------------------------------
    // Layer: Deposits
    // ------------------------------------------------------------------------
    function _drawDeposits(ctx) {
        if (typeof Map === 'undefined' || !Map || typeof Map.getDeposits !== 'function') return;
        var deposits = Map.getDeposits();
        if (!deposits || !deposits.length) return;

        var cs = _cellSize();
        var i, d, wx, wy, label;
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (i = 0; i < deposits.length; i++) {
            d = deposits[i];
            if (d.remaining <= 0) continue;
            wx = d.gridX * cs + cs / 2;
            wy = d.gridY * cs + cs / 2;
            if (!_isInViewport(wx, wy, cs)) continue;

            label = DEPOSIT_ICONS[d.type] || '?';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, wx, wy);

            // Remaining indicator (small bar under icon)
            var ratio = d.remaining / d.maxAmount;
            var barW = cs * 0.6;
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(wx - barW / 2, wy + 10, barW, 3);
            ctx.fillStyle = ratio > 0.3 ? '#88cc88' : '#cc8844';
            ctx.fillRect(wx - barW / 2, wy + 10, barW * ratio, 3);
        }
    }

    // ------------------------------------------------------------------------
    // Layer: Grid overlay
    // ------------------------------------------------------------------------
    function _drawGrid(ctx) {
        if (_zoom < 0.5) return;
        var cs = _cellSize();
        var range = _visibleRange();
        var alpha = Math.min((_zoom - 0.5) * 0.4, 0.15);
        if (alpha <= 0) return;

        ctx.strokeStyle = 'rgba(255,255,255,' + alpha + ')';
        ctx.lineWidth = 0.5;
        ctx.beginPath();

        var x, y;
        for (x = range.startCol; x <= range.endCol + 1; x++) {
            var px = x * cs;
            ctx.moveTo(px, range.startRow * cs);
            ctx.lineTo(px, (range.endRow + 1) * cs);
        }
        for (y = range.startRow; y <= range.endRow + 1; y++) {
            var py = y * cs;
            ctx.moveTo(range.startCol * cs, py);
            ctx.lineTo((range.endCol + 1) * cs, py);
        }
        ctx.stroke();
    }

    // ------------------------------------------------------------------------
    // Layer: Placement range indicator
    // ------------------------------------------------------------------------
    function _drawPlacementRange(ctx) {
        if (!_placementPreview) return;
        var cs = _cellSize();
        var def = null;
        if (typeof Config !== 'undefined' && Config && Config.BUILDINGS) {
            def = Config.BUILDINGS[_placementPreview.typeKey];
        }
        if (!def) return;

        var sizeW = def.size ? def.size[0] : 1;
        var sizeH = def.size ? def.size[1] : 1;
        var cx = _placementPreview.gridX * cs + (sizeW * cs) / 2;
        var cy = _placementPreview.gridY * cs + (sizeH * cs) / 2;

        // Weapon range circle
        if (def.range) {
            ctx.beginPath();
            ctx.arc(cx, cy, def.range, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,100,100,0.4)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Placement radius from nearest building
        ctx.beginPath();
        ctx.arc(cx, cy, Config.MAX_PLACEMENT_DISTANCE, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // ------------------------------------------------------------------------
    // Layer: Cables
    // ------------------------------------------------------------------------
    function _drawCables(ctx) {
        if (typeof Buildings === 'undefined' || !Buildings || typeof Buildings.getCables !== 'function') return;
        var cables = Buildings.getCables();
        if (!cables || !cables.length) return;

        var i, cable, fromB, toB, fc, tc;

        ctx.save();
        for (i = 0; i < cables.length; i++) {
            cable = cables[i];
            fromB = Buildings.getById(cable.from);
            toB = Buildings.getById(cable.to);
            if (!fromB || !toB) continue;

            fc = Buildings.getBuildingCenter(fromB);
            tc = Buildings.getBuildingCenter(toB);

            if (!_isInViewport(fc.x, fc.y, 200) && !_isInViewport(tc.x, tc.y, 200)) continue;

            var isHC = cable.type === 'high_capacity';
            var usedShadow = false;

            // Check if energy is flowing through this cable
            var flowing = false;
            if (typeof Energy !== 'undefined' && Energy.isNodeFlowing) {
                flowing = Energy.isNodeFlowing(cable.from) && Energy.isNodeFlowing(cable.to);
            }

            if (flowing) {
                var pulse = 0.5 + Math.sin(_animFrame * 0.15) * 0.5;
                if (isHC) {
                    ctx.shadowBlur = 12 + pulse * 12;
                    ctx.shadowColor = 'rgba(255,180,0,' + (0.5 + pulse * 0.4) + ')';
                    ctx.strokeStyle = 'rgba(255,' + Math.floor(200 + pulse * 55) + ',0,' + (0.8 + pulse * 0.2) + ')';
                    ctx.lineWidth = 4 + pulse * 2;
                } else {
                    ctx.shadowBlur = 8 + pulse * 8;
                    ctx.shadowColor = 'rgba(0,200,255,' + (0.4 + pulse * 0.4) + ')';
                    ctx.strokeStyle = 'rgba(0,' + Math.floor(180 + pulse * 75) + ',' + Math.floor(220 + pulse * 35) + ',' + (0.7 + pulse * 0.3) + ')';
                    ctx.lineWidth = 2 + pulse;
                }
                usedShadow = true;
            } else {
                var active = fromB.active && toB.active;
                if (isHC) {
                    if (active) {
                        ctx.shadowBlur = 6;
                        ctx.shadowColor = 'rgba(255,180,0,0.5)';
                        usedShadow = true;
                    }
                    ctx.strokeStyle = active ? 'rgba(255,180,0,0.7)' : 'rgba(180,120,0,0.4)';
                    ctx.lineWidth = 3;
                } else {
                    if (active) {
                        ctx.shadowBlur = 4;
                        ctx.shadowColor = COLORS.CABLE.glow;
                        usedShadow = true;
                    }
                    ctx.strokeStyle = active ? COLORS.CABLE.active : COLORS.CABLE.normal;
                    ctx.lineWidth = 2;
                }
            }

            ctx.beginPath();
            ctx.moveTo(fc.x, fc.y);
            ctx.lineTo(tc.x, tc.y);
            ctx.stroke();

            if (usedShadow) {
                ctx.shadowBlur = 0;
            }
        }
        ctx.restore();
    }

    // ------------------------------------------------------------------------
    // Layer: Buildings
    // ------------------------------------------------------------------------
    // Custom procedural sci-fi core graphic
    function _drawCoreBuilding(ctx, x, y, w, h, building, selectedId) {
        var cx = x + w / 2;
        var cy = y + h / 2;
        var r = Math.min(w, h) / 2 - 2;
        var t = _animFrame / 60; // time in seconds at 60fps

        ctx.save();

        // Dark base plate
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#1a1a3a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);

        // Outer energy ring (rotating)
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0, 180, 255, 0.4)';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Rotating arc segments
        for (var a = 0; a < 3; a++) {
            var angle = t * 1.5 + (a * Math.PI * 2 / 3);
            ctx.beginPath();
            ctx.arc(cx, cy, r, angle, angle + 0.8);
            ctx.strokeStyle = 'rgba(0, 200, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Inner ring (counter-rotating)
        var innerR = r * 0.65;
        for (a = 0; a < 4; a++) {
            var angle2 = -t * 2.2 + (a * Math.PI / 2);
            ctx.beginPath();
            ctx.arc(cx, cy, innerR, angle2, angle2 + 0.5);
            ctx.strokeStyle = 'rgba(100, 220, 255, 0.7)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Pulsing core glow
        var pulse = 0.5 + 0.5 * Math.sin(t * 3);
        var glowR = r * 0.35;

        // Outer glow
        var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR * 2);
        grad.addColorStop(0, 'rgba(80, 200, 255, ' + (0.3 + pulse * 0.2) + ')');
        grad.addColorStop(0.5, 'rgba(30, 120, 255, ' + (0.15 + pulse * 0.1) + ')');
        grad.addColorStop(1, 'rgba(0, 60, 200, 0)');
        ctx.beginPath();
        ctx.arc(cx, cy, glowR * 2, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Core center
        var coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
        coreGrad.addColorStop(0, 'rgba(200, 240, 255, ' + (0.9 + pulse * 0.1) + ')');
        coreGrad.addColorStop(0.4, 'rgba(60, 180, 255, 0.8)');
        coreGrad.addColorStop(1, 'rgba(20, 80, 200, 0.3)');
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
        ctx.fillStyle = coreGrad;
        ctx.fill();

        // Energy sparks radiating outward
        for (var s = 0; s < 6; s++) {
            var sparkAngle = t * 0.8 + s * Math.PI / 3;
            var sparkDist = innerR + (r - innerR) * ((t * 2 + s) % 1);
            var sx = cx + Math.cos(sparkAngle) * sparkDist;
            var sy = cy + Math.sin(sparkAngle) * sparkDist;
            var sparkSize = 1.5 + Math.sin(t * 5 + s) * 0.5;
            ctx.beginPath();
            ctx.arc(sx, sy, sparkSize, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(150, 220, 255, ' + (0.5 + 0.3 * Math.sin(t * 4 + s * 2)) + ')';
            ctx.fill();
        }

        // HP bar if damaged
        if (building.hp < building.maxHp) {
            _drawHPBar(ctx, cx, y, w, building.hp / building.maxHp);
        }

        // Selection highlight
        if (building.id === selectedId) {
            ctx.strokeStyle = COLORS.UI.selected;
            ctx.lineWidth = 2;
            ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
        }

        ctx.restore();
    }

    function _drawBuildings(ctx) {
        if (typeof Buildings === 'undefined' || !Buildings || typeof Buildings.getAll !== 'function') return;
        var all = Buildings.getAll();
        if (!all || !all.length) return;

        var cs = _cellSize();
        var i, b, def, sizeW, sizeH, pw, ph, color, center;
        var selectedId = -1;
        if (typeof Input !== 'undefined' && Input && typeof Input.getSelectedBuildingId === 'function') {
            var sel = Input.getSelectedBuildingId();
            if (sel != null) selectedId = sel;
        }

        var empDisabled = {};
        if (typeof Combat !== 'undefined' && Combat && typeof Combat.getEmpDisabled === 'function') {
            empDisabled = Combat.getEmpDisabled() || {};
        }

        for (i = 0; i < all.length; i++) {
            b = all[i];
            def = Config.BUILDINGS[b.type];
            if (!def) continue;

            sizeW = def.size ? def.size[0] : 1;
            sizeH = def.size ? def.size[1] : 1;
            pw = sizeW * cs;
            ph = sizeH * cs;

            if (!_isInViewport(b.worldX + pw / 2, b.worldY + ph / 2, pw)) continue;

            color = COLORS.BUILDING[def.category] || '#888888';

            // Custom draw for core building
            if (b.type === 'core') {
                _drawCoreBuilding(ctx, b.worldX, b.worldY, pw, ph, b, selectedId);
                continue;
            }

            // Building body
            ctx.fillStyle = color;
            ctx.fillRect(b.worldX, b.worldY, pw, ph);

            // Border
            ctx.strokeStyle = 'rgba(0,0,0,0.4)';
            ctx.lineWidth = 1;
            ctx.strokeRect(b.worldX, b.worldY, pw, ph);

            // Inactive overlay (no power, no workers, or EMP disabled)
            if (!b.active || empDisabled[b.id]) {
                ctx.fillStyle = 'rgba(0,0,0,0.4)';
                ctx.fillRect(b.worldX, b.worldY, pw, ph);
                // Flashing indicator for EMP
                if (empDisabled[b.id] && _animFrame % 30 < 15) {
                    ctx.fillStyle = 'rgba(50,200,255,0.2)';
                    ctx.fillRect(b.worldX, b.worldY, pw, ph);
                }
            }

            // Icon (emoji)
            if (def.icon) {
                var fontSize = Math.min(pw, ph) * 0.55;
                ctx.font = Math.floor(fontSize) + 'px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#ffffff';
                ctx.fillText(def.icon, b.worldX + pw / 2, b.worldY + ph / 2);
            }

            // Selection highlight
            if (b.id === selectedId) {
                ctx.strokeStyle = COLORS.UI.selected;
                ctx.lineWidth = 2;
                ctx.strokeRect(b.worldX - 1, b.worldY - 1, pw + 2, ph + 2);
            }

            // HP bar (only when damaged)
            if (b.hp < b.maxHp) {
                _drawHPBar(ctx, b.worldX + pw / 2, b.worldY, pw, b.hp / b.maxHp);
            }

            // Depleted deposit indicator for miners
            if (def.category === 'mining' && b.depositRef && b.depositRef.remaining <= 0) {
                ctx.font = 'bold 10px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = '#ff6666';
                ctx.fillText('EMPTY', b.worldX + pw / 2, b.worldY + ph + 2);
            }
        }
    }

    // ------------------------------------------------------------------------
    // Layer: Debug Energy Overlay
    // ------------------------------------------------------------------------
    function _drawDebugEnergyOverlay(ctx) {
        if (typeof Input === 'undefined' || !Input.isDebugMode || !Input.isDebugMode()) return;
        if (typeof Buildings === 'undefined' || !Buildings) return;

        var all = Buildings.getAll();
        var cs = _cellSize();

        ctx.save();
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        // Draw energy stored on each building
        for (var i = 0; i < all.length; i++) {
            var b = all[i];
            var def = Config.BUILDINGS[b.type];
            if (!def) continue;
            var sizeW = def.size ? def.size[0] : 1;
            var sizeH = def.size ? def.size[1] : 1;
            var pw = sizeW * cs;
            var ph = sizeH * cs;
            var cx = b.worldX + pw / 2;
            var cy = b.worldY + ph;

            if (!_isInViewport(cx, cy, pw)) continue;

            var cap = def.energyStorageCapacity || 0;
            var stored = Math.floor(b.energy || 0);
            if (cap <= 0 && stored <= 0) continue;

            var label = '⚡' + stored;
            if (cap > 0) label += '/' + cap;

            // Background pill
            var tw = ctx.measureText(label).width + 6;
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(cx - tw / 2, cy + 1, tw, 11);
            // Text color based on fill ratio
            var ratio = cap > 0 ? stored / cap : 0;
            if (ratio > 0.8) ctx.fillStyle = '#44ff44';
            else if (ratio > 0.3) ctx.fillStyle = '#ffcc00';
            else ctx.fillStyle = '#ff6644';
            ctx.fillText(label, cx, cy + 12);
        }

        // Draw energy flow on cables
        var cables = Buildings.getCables();
        if (cables && cables.length) {
            ctx.font = 'bold 8px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (var j = 0; j < cables.length; j++) {
                var cable = cables[j];
                var fromB = Buildings.getById(cable.from);
                var toB = Buildings.getById(cable.to);
                if (!fromB || !toB) continue;

                var fc = Buildings.getBuildingCenter(fromB);
                var tc = Buildings.getBuildingCenter(toB);
                var mx = (fc.x + tc.x) / 2;
                var my = (fc.y + tc.y) / 2;

                if (!_isInViewport(mx, my, 100)) continue;

                var isHC = cable.type === 'high_capacity';

                // Show actual energy flow rate per second
                var flowData = (typeof Energy !== 'undefined' && Energy.getCableFlowDisplay) ? Energy.getCableFlowDisplay() : {};
                var flowKey = cable.from < cable.to ? cable.from + '-' + cable.to : cable.to + '-' + cable.from;
                var flowAmt = flowData[flowKey] || 0;
                var flowDir, flowLabel;
                if (flowAmt === 0) {
                    flowLabel = '0=';
                } else {
                    // Positive means from lower ID to higher ID
                    var lowerIsFrom = cable.from < cable.to;
                    if (flowAmt > 0) {
                        flowDir = lowerIsFrom ? '→' : '←';
                    } else {
                        flowDir = lowerIsFrom ? '←' : '→';
                    }
                    flowLabel = Math.abs(flowAmt) + flowDir;
                }

                var tw2 = ctx.measureText(flowLabel).width + 4;
                ctx.fillStyle = 'rgba(0,0,0,0.65)';
                ctx.fillRect(mx - tw2 / 2, my - 5, tw2, 10);
                ctx.fillStyle = isHC ? '#ffcc44' : '#66ccff';
                ctx.fillText(flowLabel, mx, my);
            }
        }

        ctx.restore();
    }

    // ------------------------------------------------------------------------
    // Layer: Shields
    // ------------------------------------------------------------------------
    function _drawShields(ctx) {
        if (typeof Buildings === 'undefined' || !Buildings || typeof Buildings.getByCategory !== 'function') return;
        var shields = Buildings.getByCategory('defense');
        if (!shields || !shields.length) return;

        var cs = _cellSize();
        var i, b, def, center, radius, hpRatio;

        for (i = 0; i < shields.length; i++) {
            b = shields[i];
            def = Config.BUILDINGS[b.type];
            if (!def || !def.shieldDiameter) continue;
            if (!b.shieldActive || b.shieldHP <= 0) continue;

            center = Buildings.getBuildingCenter(b);
            radius = def.shieldDiameter / 2;

            if (!_isInViewport(center.x, center.y, radius)) continue;

            hpRatio = b.shieldHP / (def.shieldHP || 1);

            // Fill
            ctx.beginPath();
            ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = COLORS.SHIELD.fill;
            ctx.fill();

            // Border — thickness based on HP
            ctx.strokeStyle = COLORS.SHIELD.border;
            ctx.lineWidth = 1 + hpRatio * 2;
            ctx.stroke();

            // Flash on hit
            if (_shieldFlashes[b.id] && _shieldFlashes[b.id] > 0) {
                ctx.fillStyle = COLORS.SHIELD.hit;
                ctx.fill();
                _shieldFlashes[b.id]--;
            }
        }
    }

    // ------------------------------------------------------------------------
    // Layer: Enemies
    // ------------------------------------------------------------------------
    function _drawEnemies(ctx) {
        if (typeof Enemies === 'undefined' || !Enemies || typeof Enemies.getAll !== 'function') return;
        var all = Enemies.getAll();
        if (!all || !all.length) return;

        var i, e, r, color, hpRatio;

        for (i = 0; i < all.length; i++) {
            e = all[i];
            if (e.hp <= 0) continue;
            if (!_isInViewport(e.x, e.y, 30)) continue;

            r = ENEMY_RADIUS[e.type] || ENEMY_RADIUS_DEFAULT;
            color = COLORS.ENEMY[e.type] || '#cc3333';

            ctx.save();

            // Phase walker: semi-transparent
            if (e.special === 'ignores_shields' || e.type === 'phase_walker') {
                ctx.globalAlpha = 0.5 + Math.sin(_animFrame * 0.15) * 0.2;
            }

            // EMP drone: electric spark effect
            if (e.type === 'emp_drone' && _animFrame % 10 < 5) {
                ctx.shadowBlur = 8;
                ctx.shadowColor = '#33ccff';
            }

            // Bomber: pulsing
            if (e.type === 'bomber') {
                var pulse = 1 + Math.sin(_animFrame * 0.1) * 0.15;
                r = Math.floor(r * pulse);
            }

            // Boss: larger size + golden glow
            var eDef = (typeof Config !== 'undefined' && Config.ENEMIES) ? Config.ENEMIES[e.type] : null;
            if (e.isBoss || (eDef && eDef.isBoss)) {
                r = Math.floor(r * 1.5);
                ctx.shadowBlur = 16;
                ctx.shadowColor = '#ffd700';
            }

            // Stunned indicator
            if (e.stunTimer && e.stunTimer > 0) {
                ctx.globalAlpha = 0.6;
            }

            // Body
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(Math.floor(e.x), Math.floor(e.y), r, 0, Math.PI * 2);
            ctx.fill();

            // Direction indicator (small triangle)
            if (e.path && e.pathIndex < e.path.length) {
                var target = e.path[e.pathIndex];
                var dx = target.x - e.x;
                var dy = target.y - e.y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0.01) {
                    var nx = dx / dist;
                    var ny = dy / dist;
                    var tipX = e.x + nx * (r + 4);
                    var tipY = e.y + ny * (r + 4);
                    var baseX1 = e.x + nx * r - ny * 3;
                    var baseY1 = e.y + ny * r + nx * 3;
                    var baseX2 = e.x + nx * r + ny * 3;
                    var baseY2 = e.y + ny * r - nx * 3;
                    ctx.fillStyle = '#ffffff';
                    ctx.beginPath();
                    ctx.moveTo(tipX, tipY);
                    ctx.lineTo(baseX1, baseY1);
                    ctx.lineTo(baseX2, baseY2);
                    ctx.closePath();
                    ctx.fill();
                }
            }

            ctx.restore();

            // HP bar (only when damaged)
            hpRatio = e.hp / e.maxHp;
            if (hpRatio < 1) {
                _drawHPBar(ctx, Math.floor(e.x), Math.floor(e.y) - r, r * 2, hpRatio);
            }
        }
    }

    // ------------------------------------------------------------------------
    // Layer: Projectiles (missiles)
    // ------------------------------------------------------------------------
    function _drawProjectiles(ctx) {
        if (typeof Combat === 'undefined' || !Combat || typeof Combat.getProjectiles !== 'function') return;
        var projectiles = Combat.getProjectiles();
        if (!projectiles || !projectiles.length) return;

        var i, p, trail, j, alpha;

        // Update trails
        var seenIds = {};
        for (i = 0; i < projectiles.length; i++) {
            p = projectiles[i];
            seenIds[p.id] = true;
            if (!_trails[p.id]) _trails[p.id] = [];
            _trails[p.id].push({ x: p.x, y: p.y });
            if (_trails[p.id].length > TRAIL_LENGTH) {
                _trails[p.id].shift();
            }
        }
        // Clean up old trails
        var key;
        for (key in _trails) {
            if (_trails.hasOwnProperty(key) && !seenIds[key]) {
                delete _trails[key];
            }
        }

        for (i = 0; i < projectiles.length; i++) {
            p = projectiles[i];
            if (!_isInViewport(p.x, p.y, 20)) continue;

            // Trail
            trail = _trails[p.id];
            if (trail && trail.length > 1) {
                for (j = 0; j < trail.length - 1; j++) {
                    alpha = (j + 1) / trail.length * 0.6;
                    ctx.fillStyle = 'rgba(255,68,0,' + alpha.toFixed(2) + ')';
                    var trailR = 2 * ((j + 1) / trail.length);
                    ctx.beginPath();
                    ctx.arc(Math.floor(trail[j].x), Math.floor(trail[j].y), trailR, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // Projectile body
            if (p.isMortar) {
                ctx.fillStyle = '#333333';
                ctx.beginPath();
                ctx.arc(Math.floor(p.x), Math.floor(p.y), 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#666666';
                ctx.beginPath();
                ctx.arc(Math.floor(p.x), Math.floor(p.y), 2, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillStyle = COLORS.MISSILE.body;
                ctx.beginPath();
                ctx.arc(Math.floor(p.x), Math.floor(p.y), 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // ------------------------------------------------------------------------
    // Layer: Laser beams
    // ------------------------------------------------------------------------
    function _drawLaserBeams(ctx) {
        if (typeof Combat === 'undefined' || !Combat || typeof Combat.getLaserBeams !== 'function') return;
        var beams = Combat.getLaserBeams();
        if (!beams || !beams.length) return;

        var i, beam, ramp, lineW, color;

        for (i = 0; i < beams.length; i++) {
            beam = beams[i];

            if (!_isInViewport(beam.fromX, beam.fromY, 50) &&
                !_isInViewport(beam.toX, beam.toY, 50)) continue;

            ramp = beam.rampLevel || 1;

            if (ramp < 4) {
                color = COLORS.LASER.low;
                lineW = 1.5;
            } else if (ramp < 10) {
                color = COLORS.LASER.mid;
                lineW = 2.5;
            } else {
                color = COLORS.LASER.high;
                lineW = 3.5;
            }

            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = lineW;
            if (ramp >= 6) {
                ctx.shadowBlur = 4 + ramp;
                ctx.shadowColor = ramp >= 10 ? COLORS.LASER.glow : color;
            }
            ctx.beginPath();
            ctx.moveTo(beam.fromX, beam.fromY);
            ctx.lineTo(beam.toX, beam.toY);
            ctx.stroke();
            ctx.restore();
        }
    }

    // ------------------------------------------------------------------------
    // Layer: Tesla chain lightning
    // ------------------------------------------------------------------------
    function _drawTeslaChains(ctx) {
        if (typeof Combat === 'undefined' || !Combat || typeof Combat.getTeslaChains !== 'function') return;
        var chains = Combat.getTeslaChains();
        if (!chains || !chains.length) return;

        var i, j, chain, points, p1, p2;
        for (i = 0; i < chains.length; i++) {
            chain = chains[i];
            points = chain.points;
            if (!points || points.length < 2) continue;

            ctx.save();
            ctx.strokeStyle = COLORS.TESLA.chain;
            ctx.lineWidth = 2;
            ctx.shadowBlur = 8;
            ctx.shadowColor = COLORS.TESLA.glow;

            for (j = 0; j < points.length - 1; j++) {
                p1 = points[j];
                p2 = points[j + 1];
                if (!_isInViewport(p1.x, p1.y, 50) && !_isInViewport(p2.x, p2.y, 50)) continue;

                // Draw zigzag segments between chain points
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                var segments = 5;
                var sdx = (p2.x - p1.x) / segments;
                var sdy = (p2.y - p1.y) / segments;
                var perpX = -sdy;
                var perpY = sdx;
                var pLen = Math.sqrt(perpX * perpX + perpY * perpY);
                if (pLen > 0) { perpX /= pLen; perpY /= pLen; }
                for (var s = 1; s < segments; s++) {
                    var offset = (Math.random() - 0.5) * 16;
                    ctx.lineTo(p1.x + sdx * s + perpX * offset, p1.y + sdy * s + perpY * offset);
                }
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    // ------------------------------------------------------------------------
    // Layer: Railgun shots
    // ------------------------------------------------------------------------
    function _drawRailShots(ctx) {
        if (typeof Combat === 'undefined' || !Combat || typeof Combat.getRailShots !== 'function') return;
        var shots = Combat.getRailShots();
        if (!shots || !shots.length) return;

        var i, shot, alpha;
        for (i = 0; i < shots.length; i++) {
            shot = shots[i];
            if (!_isInViewport(shot.fromX, shot.fromY, 50) && !_isInViewport(shot.toX, shot.toY, 50)) continue;

            alpha = shot.timer / 5;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = COLORS.RAILGUN.beam;
            ctx.lineWidth = 3;
            ctx.shadowBlur = 10;
            ctx.shadowColor = COLORS.RAILGUN.glow;
            ctx.beginPath();
            ctx.moveTo(shot.fromX, shot.fromY);
            ctx.lineTo(shot.toX, shot.toY);
            ctx.stroke();
            ctx.restore();
        }
    }

    // ------------------------------------------------------------------------
    // Layer: EMP blast rings
    // ------------------------------------------------------------------------
    function _drawEmpBlasts(ctx) {
        if (typeof Combat === 'undefined' || !Combat || typeof Combat.getEmpBlasts !== 'function') return;
        var blasts = Combat.getEmpBlasts();
        if (!blasts || !blasts.length) return;

        var i, blast, alpha;
        for (i = 0; i < blasts.length; i++) {
            blast = blasts[i];
            if (!_isInViewport(blast.x, blast.y, blast.radius + 50)) continue;

            alpha = blast.timer / 15;
            ctx.save();
            ctx.globalAlpha = alpha;

            // Fill
            ctx.fillStyle = COLORS.EMP.fill;
            ctx.beginPath();
            ctx.arc(blast.x, blast.y, blast.radius, 0, Math.PI * 2);
            ctx.fill();

            // Ring
            ctx.strokeStyle = COLORS.EMP.ring;
            ctx.lineWidth = 2;
            ctx.shadowBlur = 6;
            ctx.shadowColor = COLORS.EMP.ring;
            ctx.beginPath();
            ctx.arc(blast.x, blast.y, blast.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    // ------------------------------------------------------------------------
    // Layer: Flamethrower glow effects
    // ------------------------------------------------------------------------
    function _drawFlameEffects(ctx) {
        if (typeof Buildings === 'undefined' || !Buildings || typeof Buildings.getAll !== 'function') return;
        var buildings = Buildings.getAll();
        if (!buildings || !buildings.length) return;

        var i, b, def, center, cellSz;
        cellSz = (typeof Config !== 'undefined' && Config.GRID_CELL_SIZE) ? Config.GRID_CELL_SIZE : 40;

        for (i = 0; i < buildings.length; i++) {
            b = buildings[i];
            if (b.type !== 'flamethrower' || !b.flameActive) continue;

            def = null;
            if (typeof Config !== 'undefined' && Config.BUILDINGS) {
                def = Config.BUILDINGS[b.type];
            }
            if (!def) continue;

            if (typeof Buildings !== 'undefined' && Buildings.getBuildingCenter) {
                center = Buildings.getBuildingCenter(b);
            } else {
                center = { x: b.gridX * cellSz + cellSz / 2, y: b.gridY * cellSz + cellSz / 2 };
            }

            if (!_isInViewport(center.x, center.y, def.range + 20)) continue;

            var range = def.range || 150;
            var enemies = [];
            if (typeof Enemies !== 'undefined' && Enemies.getAll) {
                var allEnemies = Enemies.getAll();
                for (var j = 0; j < allEnemies.length; j++) {
                    var e = allEnemies[j];
                    if (e.hp <= 0) continue;
                    var edx = e.x - center.x;
                    var edy = e.y - center.y;
                    if (edx * edx + edy * edy <= range * range) {
                        enemies.push(e);
                    }
                }
            }

            ctx.save();

            // Draw flame tongues toward each enemy in range
            var time = Date.now() * 0.005;
            for (var j = 0; j < enemies.length; j++) {
                var ex = enemies[j].x;
                var ey = enemies[j].y;
                var fdx = ex - center.x;
                var fdy = ey - center.y;
                var dist = Math.sqrt(fdx * fdx + fdy * fdy);
                if (dist < 1) continue;
                var nx = fdx / dist;
                var ny = fdy / dist;

                // Draw 3 overlapping flame streams per enemy with slight spread
                for (var f = -1; f <= 1; f++) {
                    var spreadAngle = f * 0.15;
                    var snx = nx * Math.cos(spreadAngle) - ny * Math.sin(spreadAngle);
                    var sny = nx * Math.sin(spreadAngle) + ny * Math.cos(spreadAngle);

                    // Flickering length
                    var flicker = 0.85 + 0.15 * Math.sin(time * 3 + j * 2 + f * 5);
                    var flameLen = dist * flicker;

                    var endX = center.x + snx * flameLen;
                    var endY = center.y + sny * flameLen;
                    var midX = center.x + snx * flameLen * 0.5;
                    var midY = center.y + sny * flameLen * 0.5;

                    // Perpendicular for width
                    var px = -sny;
                    var py = snx;
                    var baseWidth = 8 + Math.abs(f) * 3;
                    var midWidth = 14 + Math.abs(f) * 4;

                    var grad = ctx.createLinearGradient(center.x, center.y, endX, endY);
                    if (f === 0) {
                        grad.addColorStop(0, 'rgba(255, 255, 200, 0.9)');
                        grad.addColorStop(0.3, 'rgba(255, 180, 0, 0.7)');
                        grad.addColorStop(0.7, 'rgba(255, 80, 0, 0.4)');
                        grad.addColorStop(1, 'rgba(200, 30, 0, 0)');
                    } else {
                        grad.addColorStop(0, 'rgba(255, 200, 50, 0.6)');
                        grad.addColorStop(0.4, 'rgba(255, 120, 0, 0.4)');
                        grad.addColorStop(1, 'rgba(180, 30, 0, 0)');
                    }

                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.moveTo(center.x + px * 4, center.y + py * 4);
                    ctx.quadraticCurveTo(midX + px * midWidth, midY + py * midWidth, endX, endY);
                    ctx.quadraticCurveTo(midX - px * midWidth, midY - py * midWidth, center.x - px * 4, center.y - py * 4);
                    ctx.closePath();
                    ctx.fill();
                }
            }

            // Inner glow at source
            var glowGrad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, 25);
            glowGrad.addColorStop(0, 'rgba(255, 255, 200, 0.5)');
            glowGrad.addColorStop(1, 'rgba(255, 100, 0, 0)');
            ctx.fillStyle = glowGrad;
            ctx.beginPath();
            ctx.arc(center.x, center.y, 25, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        }
    }

    // ------------------------------------------------------------------------
    // Layer: Drones
    // ------------------------------------------------------------------------
    function _drawDrones(ctx) {
        if (typeof Combat === 'undefined' || !Combat || typeof Combat.getDrones !== 'function') return;
        var drones = Combat.getDrones();
        if (!drones || !drones.length) return;

        var i, drone;
        for (i = 0; i < drones.length; i++) {
            drone = drones[i];
            if (!_isInViewport(drone.x, drone.y, 20)) continue;

            ctx.save();
            // Body
            ctx.fillStyle = COLORS.DRONE.body;
            ctx.beginPath();
            ctx.arc(Math.floor(drone.x), Math.floor(drone.y), 5, 0, Math.PI * 2);
            ctx.fill();

            // Center dot
            ctx.fillStyle = COLORS.DRONE.dot;
            ctx.beginPath();
            ctx.arc(Math.floor(drone.x), Math.floor(drone.y), 2, 0, Math.PI * 2);
            ctx.fill();

            // HP indicator if damaged
            if (drone.hp < drone.maxHp) {
                var hpRatio = drone.hp / drone.maxHp;
                ctx.fillStyle = hpRatio > 0.5 ? '#44cc44' : '#cc4444';
                ctx.fillRect(Math.floor(drone.x) - 5, Math.floor(drone.y) - 9, Math.floor(10 * hpRatio), 2);
            }
            ctx.restore();
        }
    }

    // ------------------------------------------------------------------------
    // Layer: Plasma projectiles (green/purple glow)
    // ------------------------------------------------------------------------
    function _drawPlasmaProjectiles(ctx) {
        if (typeof Combat === 'undefined' || !Combat || typeof Combat.getProjectiles !== 'function') return;
        var projectiles = Combat.getProjectiles();
        if (!projectiles) return;

        for (var i = 0; i < projectiles.length; i++) {
            var p = projectiles[i];
            if (p.type !== 'plasma') continue;
            if (!_isInViewport(p.x, p.y, 20)) continue;

            ctx.save();
            ctx.shadowColor = '#cc44ff';
            ctx.shadowBlur = 12;
            ctx.fillStyle = '#bb55ff';
            ctx.beginPath();
            ctx.arc(Math.floor(p.x), Math.floor(p.y), 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(Math.floor(p.x), Math.floor(p.y), 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    // ------------------------------------------------------------------------
    // Layer: Fusion beams (cyan/white intense beam)
    // ------------------------------------------------------------------------
    function _drawFusionBeams(ctx) {
        if (typeof Combat === 'undefined' || !Combat || typeof Combat.getFusionBeams !== 'function') return;
        var beams = Combat.getFusionBeams();
        if (!beams || !beams.length) return;

        for (var i = 0; i < beams.length; i++) {
            var beam = beams[i];
            var intensity = Math.min(beam.rampLevel / 8, 1);
            var width = 2 + intensity * 6;

            ctx.save();
            ctx.lineCap = 'round';

            // Outer glow
            ctx.strokeStyle = 'rgba(0, 255, 255, ' + (0.2 + intensity * 0.3) + ')';
            ctx.lineWidth = width + 6;
            ctx.shadowColor = '#00ffff';
            ctx.shadowBlur = 15 + intensity * 15;
            ctx.beginPath();
            ctx.moveTo(Math.floor(beam.fromX), Math.floor(beam.fromY));
            ctx.lineTo(Math.floor(beam.toX), Math.floor(beam.toY));
            ctx.stroke();

            // Core beam
            ctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.6 + intensity * 0.4) + ')';
            ctx.lineWidth = width;
            ctx.shadowBlur = 0;
            ctx.beginPath();
            ctx.moveTo(Math.floor(beam.fromX), Math.floor(beam.fromY));
            ctx.lineTo(Math.floor(beam.toX), Math.floor(beam.toY));
            ctx.stroke();

            ctx.restore();
        }
    }

    // ------------------------------------------------------------------------
    // Layer: Damage numbers
    // ------------------------------------------------------------------------
    function _drawDamageNumbers(ctx) {
        if (!_damageNumbers.length) return;

        var i = _damageNumbers.length;
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        while (i--) {
            var dn = _damageNumbers[i];
            dn.age++;
            dn.y -= 0.5;
            if (dn.age > DAMAGE_NUMBER_DURATION) {
                _damageNumbers.splice(i, 1);
                continue;
            }
            if (!_isInViewport(dn.x, dn.y, 20)) continue;

            var alpha = 1 - (dn.age / DAMAGE_NUMBER_DURATION);
            ctx.fillStyle = 'rgba(255,80,80,' + alpha.toFixed(2) + ')';
            ctx.fillText(dn.text, Math.floor(dn.x), Math.floor(dn.y));
        }
    }

    // ------------------------------------------------------------------------
    // Layer: Placement preview ghost
    // ------------------------------------------------------------------------
    function _drawPlacementPreview(ctx) {
        if (!_placementPreview) return;
        var cs = _cellSize();
        var def = null;
        if (typeof Config !== 'undefined' && Config && Config.BUILDINGS) {
            def = Config.BUILDINGS[_placementPreview.typeKey];
        }
        if (!def) return;

        var sizeW = def.size ? def.size[0] : 1;
        var sizeH = def.size ? def.size[1] : 1;
        var px = _placementPreview.gridX * cs;
        var py = _placementPreview.gridY * cs;
        var pw = sizeW * cs;
        var ph = sizeH * cs;

        // Ghost fill
        ctx.fillStyle = _placementPreview.valid ? COLORS.UI.valid : COLORS.UI.invalid;
        ctx.fillRect(px, py, pw, ph);

        // Ghost border
        ctx.strokeStyle = _placementPreview.valid ? '#00ff00' : '#ff0000';
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, pw, ph);

        // Icon
        if (def.icon) {
            var fontSize = Math.min(pw, ph) * 0.55;
            ctx.font = Math.floor(fontSize) + 'px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = 0.7;
            ctx.fillStyle = '#ffffff';
            ctx.fillText(def.icon, px + pw / 2, py + ph / 2);
            ctx.globalAlpha = 1.0;
        }

        // Weapon range circle
        if (def.range) {
            ctx.beginPath();
            ctx.arc(px + pw / 2, py + ph / 2, def.range, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,100,100,0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Cable connection preview: line to nearest connectable building
        if (typeof Buildings !== 'undefined' && Buildings && typeof Buildings.getAll === 'function') {
            var cx = px + pw / 2;
            var cy = py + ph / 2;
            var bList = Buildings.getAll();
            var closest = null;
            var closestDist = Infinity;
            // Restricted categories can only connect to storage, grid, or core
            var restrictedCats = { weapons: true, mining: true, defense: true };
            var allowedCats = { storage: true, grid: true };
            var placingCat = def.category || '';
            var isRestricted = !!restrictedCats[placingCat];
            for (var bi = 0; bi < bList.length; bi++) {
                var bOther = bList[bi];
                // Filter by allowed connection types
                if (isRestricted) {
                    var otherDef = Config.BUILDINGS[bOther.type];
                    var otherCat = otherDef ? otherDef.category : '';
                    if (!allowedCats[otherCat] && bOther.type !== 'core') continue;
                }
                var bc = Buildings.getBuildingCenter(bOther);
                var dx = bc.x - cx;
                var dy = bc.y - cy;
                var d = Math.sqrt(dx * dx + dy * dy);
                if (d <= Config.CABLE_MAX_LENGTH && d < closestDist) {
                    closestDist = d;
                    closest = bc;
                }
            }
            if (closest) {
                ctx.setLineDash([4, 4]);
                ctx.strokeStyle = COLORS.CABLE.glow;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(closest.x, closest.y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    }

    // ------------------------------------------------------------------------
    // Minimap (screen-space, bottom-right)
    // ------------------------------------------------------------------------
    function _drawMinimap(ctx) {
        var mapW = Config.MAP_WIDTH;
        var mapH = Config.MAP_HEIGHT;
        var size = MINIMAP_SIZE;
        var mx = Config.VIEWPORT_WIDTH - size - MINIMAP_PADDING;
        var my = Config.VIEWPORT_HEIGHT - size - MINIMAP_PADDING - MINIMAP_BOTTOM_OFFSET;

        _minimapFrameCounter++;
        if (_minimapFrameCounter < 12 && _minimapCanvas) {
            ctx.drawImage(_minimapCanvas, mx - 5, my - 5);
            return;
        }
        _minimapFrameCounter = 0;

        if (!_minimapCanvas) {
            _minimapCanvas = document.createElement('canvas');
            _minimapCanvas.width = size + 20;
            _minimapCanvas.height = size + 20;
            _minimapCtx = _minimapCanvas.getContext('2d');
        }

        var mctx = _minimapCtx;
        var ox = 5;  // offset within cache canvas
        var oy = 5;
        mctx.clearRect(0, 0, _minimapCanvas.width, _minimapCanvas.height);

        var scaleX = size / mapW;
        var scaleY = size / mapH;

        // Background
        mctx.fillStyle = 'rgba(0,0,0,0.6)';
        mctx.fillRect(ox, oy, size, size);

        // Terrain (simplified — sample every Nth cell)
        if (typeof Map !== 'undefined' && Map && typeof Map.getTerrain === 'function') {
            var cs = _cellSize();
            var cols = _gridCols();
            var rows = _gridRows();
            var step = Math.max(1, Math.floor(cols / 50));
            var cellW = Math.ceil(size / (cols / step));
            var cellH = Math.ceil(size / (rows / step));
            var col, row, t;

            for (col = 0; col < cols; col += step) {
                for (row = 0; row < rows; row += step) {
                    t = Map.getTerrain(col, row);
                    if (t === 0) mctx.fillStyle = COLORS.TERRAIN.grass;
                    else if (t === 1) mctx.fillStyle = COLORS.TERRAIN.rock;
                    else if (t === 2) mctx.fillStyle = COLORS.TERRAIN.water;
                    else if (t === 3) mctx.fillStyle = COLORS.TERRAIN.deep_water;
                    else if (t === 10) mctx.fillStyle = COLORS.DEPOSIT.iron;
                    else if (t === 11) mctx.fillStyle = COLORS.DEPOSIT.coal;
                    else if (t === 12) mctx.fillStyle = COLORS.DEPOSIT.uranium;
                    else if (t === 13) mctx.fillStyle = COLORS.DEPOSIT.oil;
                    else mctx.fillStyle = COLORS.TERRAIN.grass;

                    mctx.fillRect(
                        ox + Math.floor(col * cs * scaleX),
                        oy + Math.floor(row * cs * scaleY),
                        cellW + 1, cellH + 1
                    );
                }
            }
        }

        // Buildings as dots
        if (typeof Buildings !== 'undefined' && Buildings && typeof Buildings.getAll === 'function') {
            var bList = Buildings.getAll();
            var i, b, def, bColor;
            for (i = 0; i < bList.length; i++) {
                b = bList[i];
                def = Config.BUILDINGS[b.type];
                bColor = def ? (COLORS.BUILDING[def.category] || '#888') : '#888';
                mctx.fillStyle = bColor;
                mctx.fillRect(
                    ox + Math.floor(b.worldX * scaleX),
                    oy + Math.floor(b.worldY * scaleY),
                    3, 3
                );
            }

            // Blinking core indicator
            var blinkOn = (Math.floor(_animFrame / 30) % 2) === 0;
            for (i = 0; i < bList.length; i++) {
                if (bList[i].type === 'core') {
                    var coreX = ox + Math.floor(bList[i].worldX * scaleX);
                    var coreY = oy + Math.floor(bList[i].worldY * scaleY);
                    if (blinkOn) {
                        mctx.fillStyle = 'rgba(255,255,100,0.3)';
                        mctx.beginPath();
                        mctx.arc(coreX + 1, coreY + 1, 6, 0, Math.PI * 2);
                        mctx.fill();
                        mctx.fillStyle = '#ffff66';
                        mctx.beginPath();
                        mctx.arc(coreX + 1, coreY + 1, 3, 0, Math.PI * 2);
                        mctx.fill();
                    } else {
                        mctx.fillStyle = 'rgba(255,255,100,0.4)';
                        mctx.beginPath();
                        mctx.arc(coreX + 1, coreY + 1, 2, 0, Math.PI * 2);
                        mctx.fill();
                    }
                    break;
                }
            }
        }

        // Enemies as red dots
        if (typeof Enemies !== 'undefined' && Enemies && typeof Enemies.getAll === 'function') {
            var eList = Enemies.getAll();
            mctx.fillStyle = '#ff3333';
            for (var ei = 0; ei < eList.length; ei++) {
                if (eList[ei].hp <= 0) continue;
                mctx.fillRect(
                    ox + Math.floor(eList[ei].x * scaleX),
                    oy + Math.floor(eList[ei].y * scaleY),
                    2, 2
                );
            }
        }

        // Viewport rectangle
        var vw = Config.VIEWPORT_WIDTH / _zoom;
        var vh = Config.VIEWPORT_HEIGHT / _zoom;
        mctx.strokeStyle = '#ffffff';
        mctx.lineWidth = 1;
        mctx.strokeRect(
            ox + Math.floor(_camera.x * scaleX),
            oy + Math.floor(_camera.y * scaleY),
            Math.floor(vw * scaleX),
            Math.floor(vh * scaleY)
        );

        // Minimap border
        mctx.strokeStyle = 'rgba(255,255,255,0.3)';
        mctx.strokeRect(ox, oy, size, size);

        // Blit to main canvas
        ctx.drawImage(_minimapCanvas, mx - 5, my - 5);
    }

    function _drawDepositTooltip(ctx) {
        if (typeof Input === 'undefined' || !Input.getDepositTooltip) return;
        var dep = Input.getDepositTooltip();
        if (!dep) return;

        var ms = Input.getMouseScreen();
        var names = { iron: 'Iron Ore', coal: 'Coal', uranium: 'Uranium', rock: 'Rock', water: 'River' };
        var icons = { iron: '⛏️', coal: '🪨', uranium: '☢️', rock: '🪨', water: '🌊' };
        var colors = { iron: '#d4a574', coal: '#3a3a3a', uranium: '#44ff44', rock: '#8a8580', water: '#4488ff' };
        var name = (icons[dep.type] || '') + ' ' + (names[dep.type] || dep.type);

        var isRock = dep.type === 'rock';
        var isWater = dep.type === 'water';
        var line2;
        if (isRock) {
            line2 = 'Terrain only — no resources';
        } else if (isWater) {
            var dirNames = { '0,1': '↓ South', '0,-1': '↑ North', '1,0': '→ East', '-1,0': '← West' };
            var dirKey = (dep.flowDir ? dep.flowDir.dx : 0) + ',' + (dep.flowDir ? dep.flowDir.dy : 0);
            var dirLabel = dirNames[dirKey] || '—';
            line2 = 'Speed: ' + (dep.waterSpeed || 0).toFixed(1) + ' mph  Flow: ' + dirLabel;
        } else {
            line2 = dep.remaining + ' / ' + dep.maxAmount + ' (' + (dep.maxAmount > 0 ? Math.floor((dep.remaining / dep.maxAmount) * 100) : 0) + '%)';
        }

        var padX = 10;
        var padY = 6;
        ctx.font = 'bold 13px monospace';
        var w1 = ctx.measureText(name).width;
        ctx.font = '12px monospace';
        var w2 = ctx.measureText(line2).width;
        var boxW = Math.max(w1, w2) + padX * 2;
        var boxH = 38 + padY * 2;

        var tx = ms.x + 16;
        var ty = ms.y - boxH - 8;
        if (tx + boxW > Config.VIEWPORT_WIDTH) tx = ms.x - boxW - 8;
        if (ty < 0) ty = ms.y + 20;

        // Background
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeStyle = colors[dep.type] || '#aaa';
        ctx.lineWidth = 2;
        _roundRect(ctx, tx, ty, boxW, boxH, 6);
        ctx.fill();
        ctx.stroke();

        // Text
        ctx.fillStyle = colors[dep.type] || '#fff';
        ctx.font = 'bold 13px monospace';
        ctx.fillText(name, tx + padX, ty + padY + 14);
        ctx.fillStyle = '#ccc';
        ctx.font = '12px monospace';
        ctx.fillText(line2, tx + padX, ty + padY + 32);
    }

    function _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    // ========================================================================
    // Public API
    // ========================================================================
    return {

        // --------------------------------------------------------------------
        // Initialization
        // --------------------------------------------------------------------
        init: function () {
            _canvas = document.getElementById('game-canvas');
            if (!_canvas) return;
            _canvas.width = Config.VIEWPORT_WIDTH;
            _canvas.height = Config.VIEWPORT_HEIGHT;
            _ctx = _canvas.getContext('2d');

            // Off-screen terrain canvas
            _terrainCanvas = document.createElement('canvas');
            _terrainCanvas.width = Config.VIEWPORT_WIDTH;
            _terrainCanvas.height = Config.VIEWPORT_HEIGHT;
            _terrainCtx = _terrainCanvas.getContext('2d');

            // Center camera on core building (may not be at map center)
            var coreBld = (typeof Buildings !== 'undefined' && Buildings.getCore) ? Buildings.getCore() : null;
            if (coreBld) {
                var coreDef = Config.BUILDINGS.core;
                var coreW = (coreDef && coreDef.size ? coreDef.size[0] : 2) * Config.GRID_CELL_SIZE;
                var coreH = (coreDef && coreDef.size ? coreDef.size[1] : 2) * Config.GRID_CELL_SIZE;
                _camera.x = coreBld.worldX + coreW / 2 - Config.VIEWPORT_WIDTH / 2;
                _camera.y = coreBld.worldY + coreH / 2 - Config.VIEWPORT_HEIGHT / 2;
            } else {
                _camera.x = Config.MAP_WIDTH / 2 - Config.VIEWPORT_WIDTH / 2;
                _camera.y = Config.MAP_HEIGHT / 2 - Config.VIEWPORT_HEIGHT / 2;
            }
            _clampCamera();

            _terrainDirty = true;
            _lastTime = 0;
            _animFrame = 0;
            _damageNumbers = [];
            _trails = {};
            _shieldFlashes = {};
            _noiseCache = {};
            _smoothNoiseCache = {};
            _staticTerrainCanvas = null;
            _staticTerrainCtx = null;
            _staticCacheStartCol = -1;
            _staticCacheStartRow = -1;
            _staticCacheEndCol = -1;
            _staticCacheEndRow = -1;
        },

        // --------------------------------------------------------------------
        // Main draw
        // --------------------------------------------------------------------
        draw: function (timestamp) {

            if (!_ctx) return;

            // Delta time
            var dt = 0;
            if (_lastTime > 0) {
                dt = (timestamp - _lastTime) / 1000;
                if (dt > 0.1) dt = 0.1; // cap
            }
            _lastTime = timestamp;
            _animFrame = (_animFrame + 1) % 100000;

            // Clear
            _ctx.clearRect(0, 0, Config.VIEWPORT_WIDTH, Config.VIEWPORT_HEIGHT);

            // Camera transform
            _ctx.save();
            if (_zoom !== 1) {
                _ctx.scale(_zoom, _zoom);
            }
            _ctx.translate(-Math.floor(_camera.x), -Math.floor(_camera.y));

            // Layers (world-space)
            _drawTerrain(_ctx);
            _drawDeposits(_ctx);
            _drawGrid(_ctx);
            _drawPlacementRange(_ctx);
            _drawCables(_ctx);
            _drawBuildings(_ctx);
            _drawDebugEnergyOverlay(_ctx);
            _drawShields(_ctx);
            _drawEnemies(_ctx);
            _drawProjectiles(_ctx);
            _drawLaserBeams(_ctx);
            _drawTeslaChains(_ctx);
            _drawRailShots(_ctx);
            _drawEmpBlasts(_ctx);
            _drawFlameEffects(_ctx);
            _drawDrones(_ctx);
            _drawPlasmaProjectiles(_ctx);
            _drawFusionBeams(_ctx);
            _drawDamageNumbers(_ctx);
            _drawPlacementPreview(_ctx);

            _ctx.restore();

            // Screen-space UI
            _drawMinimap(_ctx);
            _drawDepositTooltip(_ctx);
        },

        // --------------------------------------------------------------------
        // Camera
        // --------------------------------------------------------------------
        getCamera: function () {
            return _camera;
        },

        setCamera: function (x, y) {
            _camera.x = x;
            _camera.y = y;
            _clampCamera();
            _terrainDirty = true;
        },

        moveCamera: function (dx, dy) {
            _camera.x += dx;
            _camera.y += dy;
            _clampCamera();
            _terrainDirty = true;
        },

        centerOn: function (worldX, worldY) {
            _camera.x = worldX - (Config.VIEWPORT_WIDTH / _zoom) / 2;
            _camera.y = worldY - (Config.VIEWPORT_HEIGHT / _zoom) / 2;
            _clampCamera();
            _terrainDirty = true;
        },

        getZoom: function () {
            return _zoom;
        },

        setZoom: function (z) {
            if (z < 0.25) z = 0.25;
            if (z > 3.0) z = 3.0;
            // Zoom toward center of viewport
            var centerWX = _camera.x + (Config.VIEWPORT_WIDTH / _zoom) / 2;
            var centerWY = _camera.y + (Config.VIEWPORT_HEIGHT / _zoom) / 2;
            _zoom = z;
            _camera.x = centerWX - (Config.VIEWPORT_WIDTH / _zoom) / 2;
            _camera.y = centerWY - (Config.VIEWPORT_HEIGHT / _zoom) / 2;
            _clampCamera();
            _terrainDirty = true;
        },

        zoom: function (delta, mouseScreenX, mouseScreenY) {
            var step = 0.1;
            var newZoom = _zoom + delta * step;
            if (newZoom < 0.5) newZoom = 0.5;
            if (newZoom > 3.0) newZoom = 3.0;
            // Zoom toward mouse position
            var worldX = mouseScreenX / _zoom + _camera.x;
            var worldY = mouseScreenY / _zoom + _camera.y;
            _zoom = newZoom;
            _camera.x = worldX - mouseScreenX / _zoom;
            _camera.y = worldY - mouseScreenY / _zoom;
            _clampCamera();
            _terrainDirty = true;
        },

        // --------------------------------------------------------------------
        // Coordinate conversion
        // --------------------------------------------------------------------
        worldToScreen: function (wx, wy) {
            _tmpScreen.x = (wx - _camera.x) * _zoom;
            _tmpScreen.y = (wy - _camera.y) * _zoom;
            return _tmpScreen;
        },

        screenToWorld: function (sx, sy) {
            _tmpWorld.x = sx / _zoom + _camera.x;
            _tmpWorld.y = sy / _zoom + _camera.y;
            return _tmpWorld;
        },

        // --------------------------------------------------------------------
        // Placement preview
        // --------------------------------------------------------------------
        setPlacementPreview: function (typeKey, gridX, gridY, valid) {
            if (!_placementPreview) {
                _placementPreview = { typeKey: '', gridX: 0, gridY: 0, valid: false };
            }
            _placementPreview.typeKey = typeKey;
            _placementPreview.gridX = gridX;
            _placementPreview.gridY = gridY;
            _placementPreview.valid = valid;
        },

        clearPlacementPreview: function () {
            _placementPreview = null;
        },

        // --------------------------------------------------------------------
        // Terrain cache
        // --------------------------------------------------------------------
        invalidateTerrain: function () {
            _terrainDirty = true;
        },

        // --------------------------------------------------------------------
        // Damage numbers (called externally when damage is dealt)
        // --------------------------------------------------------------------
        addDamageNumber: function (worldX, worldY, amount) {
            _damageNumbers.push({
                x: worldX,
                y: worldY,
                text: '-' + Math.floor(amount),
                age: 0
            });
        },

        // --------------------------------------------------------------------
        // Shield flash (called when shield is hit)
        // --------------------------------------------------------------------
        flashShield: function (buildingId) {
            _shieldFlashes[buildingId] = 8;
        },

        // --------------------------------------------------------------------
        // Minimap hit test (for Input module)
        // --------------------------------------------------------------------
        getMinimapBounds: function () {
            return {
                x: Config.VIEWPORT_WIDTH - MINIMAP_SIZE - MINIMAP_PADDING,
                y: Config.VIEWPORT_HEIGHT - MINIMAP_SIZE - MINIMAP_PADDING - MINIMAP_BOTTOM_OFFSET,
                width: MINIMAP_SIZE,
                height: MINIMAP_SIZE
            };
        },

        minimapToWorld: function (screenX, screenY) {
            var bounds = this.getMinimapBounds();
            var relX = (screenX - bounds.x) / bounds.width;
            var relY = (screenY - bounds.y) / bounds.height;
            _tmpWorld.x = relX * Config.MAP_WIDTH;
            _tmpWorld.y = relY * Config.MAP_HEIGHT;
            return _tmpWorld;
        },

        // Expose colors for external use
        COLORS: COLORS
    };
})();

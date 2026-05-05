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
            jammer: '#669966',
            scout_drone: '#99ddff',
            heavy_flyer: '#556688',
            tunneler: '#8b5a2b',
            zapper: '#33ff99',
            plasma_parasite: '#ff33ff',
            emp_sniper: '#3399ff',
            flying_bomber: '#885522',
            mirror_sentinel: '#88bbdd',
            swarm_mother: '#ffcc00',
            quake_titan: '#994422',
            the_nexus: '#aa00ff'
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
        spark: 6, runner: 7, swarm: 5,
        scout_drone: 6, heavy_flyer: 13, tunneler: 9,
        zapper: 7, plasma_parasite: 9, emp_sniper: 10,
        flying_bomber: 15, mirror_sentinel: 10,
        swarm_mother: 18, quake_titan: 20, the_nexus: 22
    };
    var ENEMY_RADIUS_DEFAULT = 8;

    // Reusable coordinate objects to avoid allocations in draw loop
    var _tmpScreen = { x: 0, y: 0 };
    var _tmpWorld = { x: 0, y: 0 };

    // Performance: zoom threshold below which shadows are disabled
    var SHADOW_ZOOM_THRESHOLD = 0.85;

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
    var _reduceShadows = true;
    var _minimapCanvas = null;
    var _minimapCtx = null;

    // Projectile trail history (id → array of {x,y})
    var _trails = {};
    var TRAIL_LENGTH = 6;

    // Damage numbers
    var _damageNumbers = [];

    // Player energy overlay toggle
    var _showEnergyOverlay = false;
    var DAMAGE_NUMBER_DURATION = 60; // frames

    // Shield hit flash timers (buildingId → framesRemaining)
    var _shieldFlashes = {};

    // Spatial index for buildings/cables (grid-based, rebuilt when needed)
    var SPATIAL_CELL_SIZE = 400; // world pixels per spatial cell
    var _spatialGrid = {};       // key "cx,cy" → array of building refs
    var _spatialCableGrid = {};  // key "cx,cy" → array of cable indices
    var _spatialDirty = true;    // rebuild flag

    // Building layer cache
    var _buildingCacheCanvas = null;
    var _buildingCacheCtx = null;
    var _buildingCacheDirty = true;
    var _buildingCacheCamX = -1;
    var _buildingCacheCamY = -1;
    var _buildingCacheZoom = -1;
    var _buildingCacheFrame = 0; // track anim frame for periodic refresh

    // ------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------

    // Returns true if shadow effects should be rendered at current zoom
    function _shadowsEnabled() {
        return _zoom >= SHADOW_ZOOM_THRESHOLD;
    }

    var _spatialBuildingCount = 0;
    var _spatialCableCount = 0;

    // Rebuild spatial index for buildings and cables
    function _rebuildSpatialIndex() {
        _spatialGrid = {};
        _spatialCableGrid = {};
        if (typeof Buildings === 'undefined' || !Buildings) return;

        var all = Buildings.getAll();
        if (all) {
            var i, b, def, sizeW, sizeH, cs, cx, cy, minCX, minCY, maxCX, maxCY, key;
            cs = Config.GRID_CELL_SIZE;
            for (i = 0; i < all.length; i++) {
                b = all[i];
                def = Config.BUILDINGS[b.type];
                sizeW = (def && def.size) ? def.size[0] * cs : cs;
                sizeH = (def && def.size) ? def.size[1] * cs : cs;
                minCX = Math.floor(b.worldX / SPATIAL_CELL_SIZE);
                minCY = Math.floor(b.worldY / SPATIAL_CELL_SIZE);
                maxCX = Math.floor((b.worldX + sizeW) / SPATIAL_CELL_SIZE);
                maxCY = Math.floor((b.worldY + sizeH) / SPATIAL_CELL_SIZE);
                for (cx = minCX; cx <= maxCX; cx++) {
                    for (cy = minCY; cy <= maxCY; cy++) {
                        key = cx + ',' + cy;
                        if (!_spatialGrid[key]) _spatialGrid[key] = [];
                        _spatialGrid[key].push(b);
                    }
                }
            }
        }

        var cables = Buildings.getCables ? Buildings.getCables() : null;
        if (cables) {
            for (var ci = 0; ci < cables.length; ci++) {
                var cable = cables[ci];
                var fromB = Buildings.getById(cable.from);
                var toB = Buildings.getById(cable.to);
                if (!fromB || !toB) continue;
                var fc = Buildings.getBuildingCenter(fromB);
                var tc = Buildings.getBuildingCenter(toB);
                var cMinX = Math.floor(Math.min(fc.x, tc.x) / SPATIAL_CELL_SIZE);
                var cMinY = Math.floor(Math.min(fc.y, tc.y) / SPATIAL_CELL_SIZE);
                var cMaxX = Math.floor(Math.max(fc.x, tc.x) / SPATIAL_CELL_SIZE);
                var cMaxY = Math.floor(Math.max(fc.y, tc.y) / SPATIAL_CELL_SIZE);
                for (cx = cMinX; cx <= cMaxX; cx++) {
                    for (cy = cMinY; cy <= cMaxY; cy++) {
                        key = cx + ',' + cy;
                        if (!_spatialCableGrid[key]) _spatialCableGrid[key] = [];
                        _spatialCableGrid[key].push(ci);
                    }
                }
            }
        }
        _spatialDirty = false;
    }

    // Get buildings visible in current viewport
    function _getVisibleBuildings() {
        if (_spatialDirty) _rebuildSpatialIndex();
        var vw = Config.VIEWPORT_WIDTH / _zoom;
        var vh = Config.VIEWPORT_HEIGHT / _zoom;
        var margin = 100;
        var minCX = Math.floor((_camera.x - margin) / SPATIAL_CELL_SIZE);
        var minCY = Math.floor((_camera.y - margin) / SPATIAL_CELL_SIZE);
        var maxCX = Math.floor((_camera.x + vw + margin) / SPATIAL_CELL_SIZE);
        var maxCY = Math.floor((_camera.y + vh + margin) / SPATIAL_CELL_SIZE);
        var result = [];
        var seen = {};
        var cx, cy, key, arr, i;
        for (cx = minCX; cx <= maxCX; cx++) {
            for (cy = minCY; cy <= maxCY; cy++) {
                key = cx + ',' + cy;
                arr = _spatialGrid[key];
                if (!arr) continue;
                for (i = 0; i < arr.length; i++) {
                    if (!seen[arr[i].id]) {
                        seen[arr[i].id] = true;
                        result.push(arr[i]);
                    }
                }
            }
        }
        return result;
    }

    // Get cable indices visible in current viewport
    function _getVisibleCableIndices() {
        if (_spatialDirty) _rebuildSpatialIndex();
        var vw = Config.VIEWPORT_WIDTH / _zoom;
        var vh = Config.VIEWPORT_HEIGHT / _zoom;
        var margin = 200;
        var minCX = Math.floor((_camera.x - margin) / SPATIAL_CELL_SIZE);
        var minCY = Math.floor((_camera.y - margin) / SPATIAL_CELL_SIZE);
        var maxCX = Math.floor((_camera.x + vw + margin) / SPATIAL_CELL_SIZE);
        var maxCY = Math.floor((_camera.y + vh + margin) / SPATIAL_CELL_SIZE);
        var result = [];
        var seen = {};
        var cx, cy, key, arr, i;
        for (cx = minCX; cx <= maxCX; cx++) {
            for (cy = minCY; cy <= maxCY; cy++) {
                key = cx + ',' + cy;
                arr = _spatialCableGrid[key];
                if (!arr) continue;
                for (i = 0; i < arr.length; i++) {
                    if (!seen[arr[i]]) {
                        seen[arr[i]] = true;
                        result.push(arr[i]);
                    }
                }
            }
        }
        return result;
    }

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
        var barH = 5;
        var bx = Math.floor(sx - barW / 2);
        var by = Math.floor(sy - 8);
        // Background
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
        // Red underlay
        ctx.fillStyle = COLORS.UI.hpRed;
        ctx.fillRect(bx, by, barW, barH);
        // Green fill
        var greenColor = ratio > 0.5 ? COLORS.UI.hpGreen : (ratio > 0.25 ? '#ddaa22' : '#dd3333');
        ctx.fillStyle = greenColor;
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
        // Scale margin with zoom: at zoom 0.5 use ~60 cells, at zoom 1.0 use 30
        var margin = Math.ceil(45 / Math.max(_zoom, 0.5));
        var threshold = Math.ceil(margin * 0.25);
        var needsRedraw = false;

        if (!_staticTerrainCanvas) {
            needsRedraw = true;
        } else if (range.startCol < _staticCacheStartCol + threshold ||
                   range.endCol > _staticCacheEndCol - threshold ||
                   range.startRow < _staticCacheStartRow + threshold ||
                   range.endRow > _staticCacheEndRow - threshold) {
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

        var visibleIndices = _getVisibleCableIndices();
        if (!visibleIndices.length) return;

        var ci, i, cable, fromB, toB, fc, tc;
        var useShadows = _shadowsEnabled();

        ctx.save();
        for (ci = 0; ci < visibleIndices.length; ci++) {
            i = visibleIndices[ci];
            cable = cables[i];
            if (!cable) continue;
            fromB = Buildings.getById(cable.from);
            toB = Buildings.getById(cable.to);
            if (!fromB || !toB) continue;

            fc = Buildings.getBuildingCenter(fromB);
            tc = Buildings.getBuildingCenter(toB);

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
                    if (useShadows) {
                        ctx.shadowBlur = 12 + pulse * 12;
                        ctx.shadowColor = 'rgba(255,180,0,' + (0.5 + pulse * 0.4) + ')';
                    }
                    ctx.strokeStyle = 'rgba(255,' + Math.floor(200 + pulse * 55) + ',0,' + (0.8 + pulse * 0.2) + ')';
                    ctx.lineWidth = 4 + pulse * 2;
                } else {
                    if (useShadows) {
                        ctx.shadowBlur = 8 + pulse * 8;
                        ctx.shadowColor = 'rgba(0,200,255,' + (0.4 + pulse * 0.4) + ')';
                    }
                    ctx.strokeStyle = 'rgba(0,' + Math.floor(180 + pulse * 75) + ',' + Math.floor(220 + pulse * 35) + ',' + (0.7 + pulse * 0.3) + ')';
                    ctx.lineWidth = 2 + pulse;
                }
                usedShadow = useShadows;
            } else {
                var active = fromB.active && toB.active;
                if (isHC) {
                    if (active && useShadows) {
                        ctx.shadowBlur = 6;
                        ctx.shadowColor = 'rgba(255,180,0,0.5)';
                        usedShadow = true;
                    }
                    ctx.strokeStyle = active ? 'rgba(255,180,0,0.7)' : 'rgba(180,120,0,0.4)';
                    ctx.lineWidth = 3;
                } else {
                    if (active && useShadows) {
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

    // ========================================================================
    // Custom procedural building graphics — one per building type
    // All share signature: (ctx, x, y, w, h, building, t)
    //   ctx = canvas context, x/y/w/h = world rect, building = data, t = time in seconds
    // ========================================================================

    // --- POWER PLANTS ---

    function _drawSolarPanel(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        ctx.save();
        // Dark base
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(x, y, w, h);
        // Panel grid (3x2 cells)
        var cols = 3, rows = 2;
        var pad = w * 0.08;
        var cw = (w - pad * 2) / cols, ch = (h - pad * 2) / rows;
        for (var r = 0; r < rows; r++) {
            for (var c = 0; c < cols; c++) {
                var px = x + pad + c * cw + 1;
                var py = y + pad + r * ch + 1;
                var shimmer = 0.3 + 0.2 * Math.sin(t * 2 + c * 1.5 + r * 2);
                ctx.fillStyle = 'rgba(60,80,180,' + shimmer.toFixed(2) + ')';
                ctx.fillRect(px, py, cw - 2, ch - 2);
                // Grid lines
                ctx.fillStyle = 'rgba(100,140,220,0.15)';
                ctx.fillRect(px, py + ch / 2 - 0.5, cw - 2, 1);
                ctx.fillRect(px + cw / 2 - 0.5, py, 1, ch - 2);
            }
        }
        // Glint sweep
        var glintX = x + (((t * 0.5) % 1.4 - 0.2)) * w;
        if (glintX > x && glintX < x + w) {
            var grad = ctx.createLinearGradient(glintX - 4, y, glintX + 4, y);
            grad.addColorStop(0, 'rgba(255,255,255,0)');
            grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(glintX - 4, y + pad, 8, h - pad * 2);
        }
        // Border
        ctx.strokeStyle = '#3344aa';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawWindTurbine(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        var r = Math.min(w, h) * 0.38;
        ctx.save();
        // Base plate
        ctx.fillStyle = '#1a1a2a';
        ctx.fillRect(x, y, w, h);
        // Pole
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy + r * 0.8);
        ctx.lineTo(cx, cy - r * 0.1);
        ctx.stroke();
        // Hub
        ctx.fillStyle = '#ccc';
        ctx.beginPath();
        ctx.arc(cx, cy - r * 0.1, r * 0.15, 0, Math.PI * 2);
        ctx.fill();
        // Blades (3)
        var speed = 2 + Math.sin(t * 0.3) * 0.5;
        for (var i = 0; i < 3; i++) {
            var angle = t * speed + i * Math.PI * 2 / 3;
            var bx = cx + Math.cos(angle) * r * 0.85;
            var by = (cy - r * 0.1) + Math.sin(angle) * r * 0.85;
            ctx.beginPath();
            ctx.moveTo(cx, cy - r * 0.1);
            ctx.lineTo(bx, by);
            ctx.strokeStyle = 'rgba(220,230,240,0.9)';
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }
        // Border
        ctx.strokeStyle = 'rgba(100,100,100,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawCoalPlant(ctx, x, y, w, h, building, t) {
        ctx.save();
        // Factory body
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(x, y + h * 0.3, w, h * 0.7);
        // Roof
        ctx.fillStyle = '#3a3a3a';
        ctx.beginPath();
        ctx.moveTo(x, y + h * 0.3);
        ctx.lineTo(x + w * 0.5, y + h * 0.1);
        ctx.lineTo(x + w, y + h * 0.3);
        ctx.closePath();
        ctx.fill();
        // Chimney
        ctx.fillStyle = '#444';
        ctx.fillRect(x + w * 0.7, y, w * 0.15, h * 0.35);
        // Furnace glow
        var glow = 0.4 + 0.3 * Math.sin(t * 3);
        ctx.fillStyle = 'rgba(255,120,20,' + glow.toFixed(2) + ')';
        ctx.fillRect(x + w * 0.15, y + h * 0.55, w * 0.3, h * 0.2);
        // Smoke particles
        for (var s = 0; s < 3; s++) {
            var sy = y - ((t * 15 + s * 8) % 20);
            var sx = x + w * 0.77 + Math.sin(t * 2 + s * 3) * 3;
            var sr = 2 + s;
            var sa = Math.max(0, 0.4 - ((t * 15 + s * 8) % 20) / 50);
            ctx.fillStyle = 'rgba(80,80,80,' + sa.toFixed(2) + ')';
            ctx.beginPath();
            ctx.arc(sx, sy, sr, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y + h * 0.3, w, h * 0.7);
        ctx.restore();
    }

    function _drawGasPlant(ctx, x, y, w, h, building, t) {
        ctx.save();
        // Ground/base pad
        ctx.fillStyle = '#3a4a4a';
        ctx.fillRect(x, y + h * 0.82, w, h * 0.18);
        // Main industrial building body
        ctx.fillStyle = '#2a3a4a';
        ctx.fillRect(x + w * 0.05, y + h * 0.45, w * 0.9, h * 0.4);
        // Scaffolding/framework lines on building
        ctx.strokeStyle = '#4a5a6a';
        ctx.lineWidth = 1;
        // Horizontal beams
        ctx.beginPath();
        ctx.moveTo(x + w * 0.05, y + h * 0.55); ctx.lineTo(x + w * 0.95, y + h * 0.55);
        ctx.moveTo(x + w * 0.05, y + h * 0.65); ctx.lineTo(x + w * 0.95, y + h * 0.65);
        ctx.moveTo(x + w * 0.05, y + h * 0.75); ctx.lineTo(x + w * 0.95, y + h * 0.75);
        ctx.stroke();
        // Vertical framework supports
        ctx.beginPath();
        ctx.moveTo(x + w * 0.25, y + h * 0.45); ctx.lineTo(x + w * 0.25, y + h * 0.85);
        ctx.moveTo(x + w * 0.5, y + h * 0.45); ctx.lineTo(x + w * 0.5, y + h * 0.85);
        ctx.moveTo(x + w * 0.75, y + h * 0.45); ctx.lineTo(x + w * 0.75, y + h * 0.85);
        ctx.stroke();

        // Three tall cylindrical stacks (the main feature)
        var stackPositions = [0.2, 0.5, 0.8];
        var stackWidths = [w * 0.13, w * 0.15, w * 0.13];
        var stackTops = [h * 0.08, h * 0.02, h * 0.1];
        for (var si = 0; si < 3; si++) {
            var sx = x + w * stackPositions[si] - stackWidths[si] / 2;
            var sy = y + stackTops[si];
            var sw = stackWidths[si];
            var sh = y + h * 0.5 - sy;
            // Stack body - steel blue cylinder
            var grad = ctx.createLinearGradient(sx, sy, sx + sw, sy);
            grad.addColorStop(0, '#4a6a7a');
            grad.addColorStop(0.3, '#6a8a9a');
            grad.addColorStop(0.7, '#5a7a8a');
            grad.addColorStop(1, '#3a5a6a');
            ctx.fillStyle = grad;
            ctx.fillRect(sx, sy, sw, sh);
            // Stack top cap (darker ring)
            ctx.fillStyle = '#3a5060';
            ctx.fillRect(sx - 1, sy, sw + 2, h * 0.03);
            // Highlight stripe (reflection)
            ctx.fillStyle = 'rgba(180,210,230,0.15)';
            ctx.fillRect(sx + sw * 0.2, sy + h * 0.02, sw * 0.15, sh - h * 0.02);
            // Stack outline
            ctx.strokeStyle = '#2a4050';
            ctx.lineWidth = 1;
            ctx.strokeRect(sx, sy, sw, sh);
        }

        // Horizontal pipe/walkway connecting stacks at mid-height
        ctx.fillStyle = '#5a6a7a';
        ctx.fillRect(x + w * 0.12, y + h * 0.3, w * 0.76, h * 0.025);
        ctx.fillRect(x + w * 0.12, y + h * 0.38, w * 0.76, h * 0.02);
        // Diagonal braces between stacks
        ctx.strokeStyle = '#4a5a6a';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.27, y + h * 0.3); ctx.lineTo(x + w * 0.43, y + h * 0.45);
        ctx.moveTo(x + w * 0.57, y + h * 0.3); ctx.lineTo(x + w * 0.73, y + h * 0.45);
        ctx.stroke();

        // Small equipment boxes at base
        ctx.fillStyle = '#ccc';
        ctx.fillRect(x + w * 0.08, y + h * 0.76, w * 0.1, h * 0.08);
        ctx.fillRect(x + w * 0.82, y + h * 0.76, w * 0.1, h * 0.08);

        // Subtle heat shimmer / exhaust from tops when active
        if (building.active && !building.manualOff) {
            for (var ei = 0; ei < 3; ei++) {
                var ex = x + w * stackPositions[ei];
                var ey = y + stackTops[ei];
                for (var ep = 0; ep < 2; ep++) {
                    var epy = ey - ((t * 12 + ep * 6 + ei * 4) % 14);
                    var epx = ex + Math.sin(t * 3 + ep * 2 + ei) * 2;
                    var epa = Math.max(0, 0.25 - ((t * 12 + ep * 6 + ei * 4) % 14) / 56);
                    ctx.fillStyle = 'rgba(160,180,200,' + epa.toFixed(2) + ')';
                    ctx.beginPath();
                    ctx.arc(epx, epy, 2 + ep, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // Outer border
        ctx.strokeStyle = '#2a3a4a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawNuclearPlant(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2;
        ctx.save();

        // Ground
        ctx.fillStyle = '#2a2a1a';
        ctx.fillRect(x, y + h * 0.85, w, h * 0.15);

        // Factory building (center, behind towers)
        ctx.fillStyle = '#3a3a4a';
        ctx.fillRect(x + w * 0.3, y + h * 0.5, w * 0.4, h * 0.38);
        ctx.fillStyle = '#4a4a5a';
        ctx.fillRect(x + w * 0.3, y + h * 0.5, w * 0.4, h * 0.04);

        // Radiation symbol on factory
        var radX = cx, radY = y + h * 0.68;
        var radR = Math.min(w, h) * 0.1;
        // Yellow circle background
        ctx.fillStyle = '#ccaa20';
        ctx.beginPath();
        ctx.arc(radX, radY, radR, 0, Math.PI * 2);
        ctx.fill();
        // Black trefoil blades (3 sectors)
        ctx.fillStyle = '#1a1a1a';
        for (var bi = 0; bi < 3; bi++) {
            var angle = bi * (Math.PI * 2 / 3) - Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(radX, radY);
            ctx.arc(radX, radY, radR * 0.9, angle - 0.35, angle + 0.35);
            ctx.closePath();
            ctx.fill();
        }
        // Center dot
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.arc(radX, radY, radR * 0.22, 0, Math.PI * 2);
        ctx.fill();

        // Two cooling towers (hyperboloid shape — wider at bottom, narrower in middle, flared at top)
        var towerPositions = [0.22, 0.78];
        for (var ti = 0; ti < 2; ti++) {
            var tx = x + w * towerPositions[ti];
            var tBot = y + h * 0.88;
            var tTop = y + h * 0.12;
            var tH = tBot - tTop;
            var botW = w * 0.22;
            var midW = w * 0.14;
            var topW = w * 0.18;

            // Tower body using quadratic curves for hyperboloid shape
            var tGrad = ctx.createLinearGradient(tx - botW, tTop, tx + botW, tTop);
            tGrad.addColorStop(0, '#5a5a6a');
            tGrad.addColorStop(0.35, '#8a8a9a');
            tGrad.addColorStop(0.65, '#7a7a8a');
            tGrad.addColorStop(1, '#4a4a5a');
            ctx.fillStyle = tGrad;
            ctx.beginPath();
            // Left side: bottom-left, curve inward at middle, flare at top
            ctx.moveTo(tx - botW, tBot);
            ctx.quadraticCurveTo(tx - midW, tTop + tH * 0.55, tx - topW, tTop);
            // Top edge
            ctx.lineTo(tx + topW, tTop);
            // Right side
            ctx.quadraticCurveTo(tx + midW, tTop + tH * 0.55, tx + botW, tBot);
            ctx.closePath();
            ctx.fill();
            // Tower outline
            ctx.strokeStyle = '#3a3a4a';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(tx - botW, tBot);
            ctx.quadraticCurveTo(tx - midW, tTop + tH * 0.55, tx - topW, tTop);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(tx + botW, tBot);
            ctx.quadraticCurveTo(tx + midW, tTop + tH * 0.55, tx + topW, tTop);
            ctx.stroke();
            // Top rim (ellipse approximation)
            ctx.strokeStyle = '#6a6a7a';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(tx, tTop + 1, topW, topW * 0.2, 0, 0, Math.PI * 2);
            ctx.stroke();

            // Billowing steam clouds from each tower (when active)
            if (building.active && !building.manualOff) {
                for (var si = 0; si < 5; si++) {
                    var seed = ti * 17 + si * 7;
                    var lifeT = (t * 8 + seed) % 25;
                    var steamY = tTop - lifeT * 1.2;
                    var steamX = tx + Math.sin(t * 1.5 + seed * 0.7) * (3 + lifeT * 0.3);
                    var steamR = 3 + lifeT * 0.6;
                    var steamA = Math.max(0, 0.5 - lifeT / 25);
                    ctx.fillStyle = 'rgba(220,220,235,' + steamA.toFixed(2) + ')';
                    ctx.beginPath();
                    ctx.arc(steamX, steamY, steamR, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // Outer border
        ctx.strokeStyle = '#2a2a3a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawHydroPlant(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        ctx.save();
        // Water base
        ctx.fillStyle = '#0a2a5a';
        ctx.fillRect(x, y, w, h);
        // Dam body
        ctx.fillStyle = '#4a4a5a';
        ctx.fillRect(x + w * 0.1, y + h * 0.2, w * 0.8, h * 0.6);
        // Turbine wheel
        var tr = Math.min(w, h) * 0.2;
        ctx.strokeStyle = '#6ac';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, tr, 0, Math.PI * 2);
        ctx.stroke();
        // Spinning spokes
        for (var i = 0; i < 6; i++) {
            var angle = t * 3 + i * Math.PI / 3;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(angle) * tr, cy + Math.sin(angle) * tr);
            ctx.strokeStyle = 'rgba(100,180,220,0.8)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
        // Water flow particles
        for (var p = 0; p < 4; p++) {
            var px = x + ((t * 30 + p * 10) % w);
            var py = y + h * 0.85 + Math.sin(t * 3 + p) * 2;
            ctx.fillStyle = 'rgba(100,180,255,0.5)';
            ctx.fillRect(px, py, 3, 1.5);
        }
        ctx.strokeStyle = '#2a3a5a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    // --- STORAGE ---

    function _drawBattery(ctx, x, y, w, h, building, t, color, accent) {
        var cx = x + w / 2;
        ctx.save();
        // Base
        ctx.fillStyle = '#1a1a2a';
        ctx.fillRect(x, y, w, h);
        // Battery casing
        var bx = x + w * 0.2, by = y + h * 0.15, bw = w * 0.6, bh = h * 0.75;
        ctx.fillStyle = '#2a2a3a';
        ctx.fillRect(bx, by, bw, bh);
        // Terminal nub
        ctx.fillStyle = '#555';
        ctx.fillRect(cx - w * 0.1, y + h * 0.07, w * 0.2, h * 0.1);
        // Fill level
        var cap = building.scaledStorageCapacity || (Config.BUILDINGS[building.type] && Config.BUILDINGS[building.type].energyStorageCapacity) || 1;
        var fill = Math.min(1, (building.energy || 0) / cap);
        var fillH = bh * 0.85 * fill;
        if (fillH > 0) {
            var fillY = by + bh * 0.9 - fillH;
            ctx.fillStyle = color || '#40cc40';
            ctx.fillRect(bx + 2, fillY, bw - 4, fillH);
            // Shimmer
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.fillRect(bx + 2, fillY, (bw - 4) * 0.3, fillH);
        }
        // Lightning bolt icon
        ctx.fillStyle = accent || '#ffdd00';
        ctx.font = Math.floor(Math.min(w, h) * 0.3) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚡', cx, y + h * 0.5);
        // Border
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawSmallBattery(ctx, x, y, w, h, building, t) {
        _drawBattery(ctx, x, y, w, h, building, t, '#40cc40', '#ffdd00');
    }

    function _drawLargeBattery(ctx, x, y, w, h, building, t) {
        ctx.save();
        ctx.fillStyle = '#1a1a2a';
        ctx.fillRect(x, y, w, h);
        // Two cells side by side
        var cap = building.scaledStorageCapacity || (Config.BUILDINGS[building.type] && Config.BUILDINGS[building.type].energyStorageCapacity) || 1;
        var fill = Math.min(1, (building.energy || 0) / cap);
        for (var c = 0; c < 2; c++) {
            var bx = x + w * 0.1 + c * w * 0.4;
            var by = y + h * 0.2, bw = w * 0.35, bh = h * 0.65;
            ctx.fillStyle = '#2a2a3a';
            ctx.fillRect(bx, by, bw, bh);
            var fillH = bh * 0.85 * fill;
            if (fillH > 0) {
                ctx.fillStyle = '#30bb50';
                ctx.fillRect(bx + 1, by + bh * 0.9 - fillH, bw - 2, fillH);
            }
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 1;
            ctx.strokeRect(bx, by, bw, bh);
        }
        // Terminal
        ctx.fillStyle = '#555';
        ctx.fillRect(x + w * 0.4, y + h * 0.08, w * 0.2, h * 0.12);
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawCapacitor(ctx, x, y, w, h, building, t, adv) {
        var cx = x + w / 2, cy = y + h / 2;
        ctx.save();
        ctx.fillStyle = '#1a1a2a';
        ctx.fillRect(x, y, w, h);
        // Cylindrical body
        var cr = Math.min(w, h) * 0.3;
        ctx.fillStyle = adv ? '#2a3a5a' : '#2a2a4a';
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = adv ? '#4a6a9a' : '#4a4a7a';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Arc effect between two plates
        var arcAngle = t * 6;
        var arcLen = 0.3 + 0.2 * Math.sin(t * 8);
        ctx.strokeStyle = adv ? 'rgba(100,180,255,0.9)' : 'rgba(80,140,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, cr * 0.6, arcAngle, arcAngle + arcLen);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, cr * 0.6, arcAngle + Math.PI, arcAngle + Math.PI + arcLen);
        ctx.stroke();
        // Flash
        if (Math.sin(t * 12) > 0.8) {
            ctx.fillStyle = 'rgba(150,200,255,0.3)';
            ctx.beginPath();
            ctx.arc(cx, cy, cr * 0.4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawConsumerBattery(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2;
        ctx.save();
        // Base
        ctx.fillStyle = '#1a1a2a';
        ctx.fillRect(x, y, w, h);
        // Battery casing (gold tint)
        var bx = x + w * 0.2, by = y + h * 0.15, bw = w * 0.6, bh = h * 0.75;
        ctx.fillStyle = '#2a2a1a';
        ctx.fillRect(bx, by, bw, bh);
        // Terminal nub
        ctx.fillStyle = '#665520';
        ctx.fillRect(cx - w * 0.1, y + h * 0.07, w * 0.2, h * 0.1);
        // Fill level (gold)
        var cap = building.scaledStorageCapacity || (Config.BUILDINGS[building.type] && Config.BUILDINGS[building.type].energyStorageCapacity) || 1;
        var fill = Math.min(1, (building.energy || 0) / cap);
        var fillH = bh * 0.85 * fill;
        if (fillH > 0) {
            var fillY = by + bh * 0.9 - fillH;
            ctx.fillStyle = '#cc9920';
            ctx.fillRect(bx + 2, fillY, bw - 4, fillH);
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.fillRect(bx + 2, fillY, (bw - 4) * 0.3, fillH);
        }
        // Dollar sign (prominent, centered)
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold ' + Math.floor(Math.min(w, h) * 0.38) + 'px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('$', cx, y + h * 0.42);
        // Small bolt icon below dollar sign (drawn as lines, not emoji)
        var boltX = cx, boltY = y + h * 0.72;
        var bs = Math.min(w, h) * 0.08;
        ctx.fillStyle = '#ffdd00';
        ctx.beginPath();
        ctx.moveTo(boltX - bs * 0.3, boltY - bs);
        ctx.lineTo(boltX + bs * 0.5, boltY - bs);
        ctx.lineTo(boltX, boltY);
        ctx.lineTo(boltX + bs * 0.3, boltY);
        ctx.lineTo(boltX - bs * 0.5, boltY + bs);
        ctx.lineTo(boltX, boltY);
        ctx.closePath();
        ctx.fill();
        // Sparkle when near full
        if (fill > 0.9) {
            var sparkle = 0.3 + 0.4 * Math.sin(t * 6);
            ctx.fillStyle = 'rgba(255,255,200,' + sparkle.toFixed(2) + ')';
            ctx.beginPath();
            ctx.arc(cx + w * 0.25, y + h * 0.25, 2, 0, Math.PI * 2);
            ctx.fill();
        }
        // Border
        ctx.strokeStyle = '#554400';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    // --- RESOURCE ICON HELPERS ---

    // Iron ingot icon (silver/gray bar shape)
    function _drawIronIcon(ctx, cx, cy, size) {
        var s = size;
        ctx.save();
        ctx.fillStyle = '#b0b0b8';
        ctx.beginPath();
        // 3D ingot: top face
        ctx.moveTo(cx - s * 0.35, cy - s * 0.05);
        ctx.lineTo(cx - s * 0.2, cy - s * 0.35);
        ctx.lineTo(cx + s * 0.35, cy - s * 0.35);
        ctx.lineTo(cx + s * 0.5, cy - s * 0.05);
        ctx.closePath();
        ctx.fill();
        // Front face
        ctx.fillStyle = '#8a8a92';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.35, cy - s * 0.05);
        ctx.lineTo(cx + s * 0.5, cy - s * 0.05);
        ctx.lineTo(cx + s * 0.5, cy + s * 0.2);
        ctx.lineTo(cx - s * 0.35, cy + s * 0.2);
        ctx.closePath();
        ctx.fill();
        // Right side face
        ctx.fillStyle = '#707078';
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.5, cy - s * 0.05);
        ctx.lineTo(cx + s * 0.35, cy - s * 0.35);
        ctx.lineTo(cx + s * 0.35, cy - s * 0.1);
        ctx.lineTo(cx + s * 0.5, cy + s * 0.2);
        ctx.closePath();
        ctx.fill();
        // Highlight
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.15, cy - s * 0.3);
        ctx.lineTo(cx + s * 0.05, cy - s * 0.3);
        ctx.lineTo(cx + s * 0.15, cy - s * 0.1);
        ctx.lineTo(cx - s * 0.05, cy - s * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // Coal lumps icon (dark irregular chunks)
    function _drawCoalIcon(ctx, cx, cy, size) {
        var s = size;
        ctx.save();
        var lumps = [
            { x: -0.15, y: 0.1, r: 0.22 },
            { x: 0.15, y: 0.05, r: 0.2 },
            { x: 0, y: -0.1, r: 0.18 },
            { x: -0.25, y: -0.05, r: 0.14 },
            { x: 0.25, y: -0.12, r: 0.13 },
            { x: 0.05, y: 0.2, r: 0.15 }
        ];
        for (var li = 0; li < lumps.length; li++) {
            var lump = lumps[li];
            ctx.fillStyle = li % 2 === 0 ? '#2a2a2a' : '#3a3a3a';
            ctx.beginPath();
            ctx.arc(cx + lump.x * s, cy + lump.y * s, lump.r * s, 0, Math.PI * 2);
            ctx.fill();
            // Subtle highlight
            ctx.fillStyle = 'rgba(100,100,100,0.3)';
            ctx.beginPath();
            ctx.arc(cx + lump.x * s - lump.r * s * 0.2, cy + lump.y * s - lump.r * s * 0.3, lump.r * s * 0.4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // Oil droplet icon (black teardrop)
    function _drawOilIcon(ctx, cx, cy, size) {
        var s = size;
        ctx.save();
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        // Teardrop: pointed top, round bottom
        ctx.moveTo(cx, cy - s * 0.4);
        ctx.bezierCurveTo(cx - s * 0.35, cy, cx - s * 0.35, cy + s * 0.25, cx, cy + s * 0.35);
        ctx.bezierCurveTo(cx + s * 0.35, cy + s * 0.25, cx + s * 0.35, cy, cx, cy - s * 0.4);
        ctx.closePath();
        ctx.fill();
        // Glossy highlight
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.ellipse(cx - s * 0.08, cy + s * 0.05, s * 0.08, s * 0.15, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Uranium trefoil radiation icon (yellow circle + black blades)
    function _drawUraniumIcon(ctx, cx, cy, size) {
        var s = size;
        ctx.save();
        // Yellow circle
        ctx.fillStyle = '#ddaa20';
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.38, 0, Math.PI * 2);
        ctx.fill();
        // Three black blades
        ctx.fillStyle = '#1a1a1a';
        for (var bi = 0; bi < 3; bi++) {
            var angle = bi * (Math.PI * 2 / 3) - Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, s * 0.35, angle - 0.4, angle + 0.4);
            ctx.closePath();
            ctx.fill();
        }
        // Center dot
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.09, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // --- MINERS ---

    function _drawMiner(ctx, x, y, w, h, building, t, bodyColor, accentColor, iconFn) {
        var cx = x + w / 2;
        ctx.save();
        // Ground pad
        ctx.fillStyle = '#2a2a1a';
        ctx.fillRect(x, y + h * 0.82, w, h * 0.18);
        // Main facility building
        ctx.fillStyle = bodyColor;
        ctx.fillRect(x + w * 0.08, y + h * 0.3, w * 0.84, h * 0.55);
        // Darker lower section
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(x + w * 0.08, y + h * 0.65, w * 0.84, h * 0.2);
        // Roof
        ctx.fillStyle = accentColor;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.05, y + h * 0.3);
        ctx.lineTo(cx, y + h * 0.12);
        ctx.lineTo(x + w * 0.95, y + h * 0.3);
        ctx.closePath();
        ctx.fill();
        // Conveyor belt (animated when active)
        ctx.fillStyle = '#555';
        ctx.fillRect(x + w * 0.7, y + h * 0.7, w * 0.25, h * 0.05);
        if (building.active && !building.manualOff) {
            var beltOff = (t * 30) % 8;
            ctx.fillStyle = '#666';
            for (var bi = 0; bi < 4; bi++) {
                var bx = x + w * 0.72 + ((bi * 8 + beltOff) % (w * 0.22));
                ctx.fillRect(bx, y + h * 0.7, 3, h * 0.05);
            }
        }
        // Resource icon in center of building
        if (iconFn) {
            iconFn(ctx, cx, y + h * 0.52, Math.min(w, h) * 0.35);
        }
        // Smoke/dust when active
        if (building.active && !building.manualOff) {
            for (var d = 0; d < 3; d++) {
                var dx = x + w * 0.85 + Math.sin(t * 2.5 + d * 3) * 3;
                var dy = y + h * 0.12 - ((t * 10 + d * 8) % 15);
                var da = Math.max(0, 0.3 - ((t * 10 + d * 8) % 15) / 30);
                ctx.fillStyle = 'rgba(150,140,130,' + da.toFixed(2) + ')';
                ctx.beginPath();
                ctx.arc(dx, dy, 2 + d * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        // Border
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawOilDrill(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2;
        ctx.save();
        // Ground pad
        ctx.fillStyle = '#2a2a1a';
        ctx.fillRect(x, y + h * 0.82, w, h * 0.18);
        // Main facility building
        ctx.fillStyle = '#2a2a3a';
        ctx.fillRect(x + w * 0.08, y + h * 0.4, w * 0.55, h * 0.45);
        // Darker lower section
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(x + w * 0.08, y + h * 0.7, w * 0.55, h * 0.15);
        // Derrick tower (triangular)
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.72, y + h * 0.85);
        ctx.lineTo(x + w * 0.78, y + h * 0.08);
        ctx.lineTo(x + w * 0.84, y + h * 0.85);
        ctx.stroke();
        // Cross braces on derrick
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#444';
        for (var br = 0; br < 4; br++) {
            var by = y + h * (0.25 + br * 0.15);
            var bwL = cx + w * 0.22 + (0.78 - 0.72) * w * (1 - (by - y) / h) * 0.3;
            ctx.beginPath();
            ctx.moveTo(x + w * 0.73, by);
            ctx.lineTo(x + w * 0.83, by);
            ctx.stroke();
        }
        // Pumpjack arm (animated rocking)
        var rock = Math.sin(t * 2) * 0.2;
        ctx.save();
        ctx.translate(x + w * 0.78, y + h * 0.2);
        ctx.rotate(rock);
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-w * 0.12, 0);
        ctx.lineTo(w * 0.12, 0);
        ctx.stroke();
        ctx.restore();
        // Oil droplet icon on building
        _drawOilIcon(ctx, x + w * 0.35, y + h * 0.58, Math.min(w, h) * 0.3);
        // Oil sheen at base
        var sheen = 'rgba(30,20,60,' + (0.2 + 0.1 * Math.sin(t * 3)).toFixed(2) + ')';
        ctx.fillStyle = sheen;
        ctx.fillRect(x + w * 0.15, y + h * 0.88, w * 0.35, h * 0.06);
        // Border
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawSmelter(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2;
        ctx.save();
        // Base
        ctx.fillStyle = '#2a1a1a';
        ctx.fillRect(x, y, w, h);
        // Furnace body
        ctx.fillStyle = '#3a2a2a';
        ctx.fillRect(x + w * 0.1, y + h * 0.2, w * 0.8, h * 0.75);
        // Molten glow
        var glow = 0.4 + 0.3 * Math.sin(t * 2.5);
        var grad = ctx.createRadialGradient(cx, y + h * 0.7, 0, cx, y + h * 0.7, w * 0.35);
        grad.addColorStop(0, 'rgba(255,140,20,' + glow.toFixed(2) + ')');
        grad.addColorStop(0.6, 'rgba(255,60,10,' + (glow * 0.5).toFixed(2) + ')');
        grad.addColorStop(1, 'rgba(200,30,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(x + w * 0.15, y + h * 0.5, w * 0.7, h * 0.4);
        // Chimney
        ctx.fillStyle = '#444';
        ctx.fillRect(x + w * 0.7, y + h * 0.05, w * 0.12, h * 0.2);
        // Heat shimmer
        if (building.active && !building.manualOff) {
            for (var s = 0; s < 2; s++) {
                var sy = y + h * 0.02 - ((t * 12 + s * 10) % 12);
                var sx = x + w * 0.76 + Math.sin(t * 3 + s) * 2;
                var sa = Math.max(0, 0.25 - ((t * 12 + s * 10) % 12) / 30);
                ctx.fillStyle = 'rgba(255,200,100,' + sa.toFixed(2) + ')';
                ctx.beginPath();
                ctx.arc(sx, sy, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.strokeStyle = '#3a2020';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    // --- WEAPONS ---

    function _drawBlaster(ctx, x, y, w, h, building, t, tier) {
        var cx = x + w / 2, cy = y + h / 2;
        var r = Math.min(w, h) * 0.35;
        ctx.save();
        // Base plate
        ctx.fillStyle = '#1a0a0a';
        ctx.fillRect(x, y, w, h);
        // Turret base circle
        ctx.fillStyle = tier >= 3 ? '#5a2020' : (tier >= 2 ? '#4a1a1a' : '#3a1515');
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        // Barrel(s) — rotate toward target or spin slowly
        var angle = building.turretAngle || (t * 0.5);
        var barrels = tier >= 3 ? 3 : (tier >= 2 ? 2 : 1);
        var barrelLen = r * 1.2;
        var barrelW = 2;
        ctx.strokeStyle = tier >= 3 ? '#ff6644' : (tier >= 2 ? '#dd5533' : '#cc4422');
        ctx.lineWidth = barrelW + tier;
        for (var b = 0; b < barrels; b++) {
            var bAngle = angle + (b - (barrels - 1) / 2) * 0.25;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(bAngle) * barrelLen, cy + Math.sin(bAngle) * barrelLen);
            ctx.stroke();
        }
        // Center dot
        ctx.fillStyle = '#ff4422';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
        ctx.fill();
        // Glow when firing
        if (building.firing) {
            ctx.fillStyle = 'rgba(255,100,50,0.3)';
            ctx.beginPath();
            ctx.arc(cx, cy, r * 1.2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.strokeStyle = '#441111';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawLaserTurret(ctx, x, y, w, h, building, t, tier) {
        var cx = x + w / 2, cy = y + h / 2;
        var r = Math.min(w, h) * 0.3;
        ctx.save();
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(x, y, w, h);
        // Swivel base
        ctx.fillStyle = '#2a2a4a';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.1, 0, Math.PI * 2);
        ctx.fill();
        // Dish/lens
        var angle = building.turretAngle || (t * 0.3);
        var dishR = r * (0.6 + tier * 0.15);
        var dx = cx + Math.cos(angle) * r * 0.5;
        var dy = cy + Math.sin(angle) * r * 0.5;
        ctx.fillStyle = tier >= 3 ? '#8060cc' : (tier >= 2 ? '#6050aa' : '#4040aa');
        ctx.beginPath();
        ctx.arc(dx, dy, dishR, angle - 1, angle + 1);
        ctx.lineTo(cx, cy);
        ctx.closePath();
        ctx.fill();
        // Charging glow
        var charge = 0.2 + 0.3 * Math.sin(t * 4);
        ctx.fillStyle = 'rgba(150,100,255,' + charge.toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(dx, dy, dishR * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#222244';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawMissileLauncher(ctx, x, y, w, h, building, t, tier) {
        var cx = x + w / 2, cy = y + h / 2;
        ctx.save();
        ctx.fillStyle = '#1a0a0a';
        ctx.fillRect(x, y, w, h);
        // Launcher rack
        ctx.fillStyle = '#3a2a2a';
        ctx.fillRect(x + w * 0.15, y + h * 0.2, w * 0.7, h * 0.6);
        // Missile slots
        var slots = tier >= 3 ? 4 : (tier >= 2 ? 3 : 2);
        var slotH = (h * 0.5) / slots;
        for (var s = 0; s < slots; s++) {
            var sy = y + h * 0.25 + s * slotH;
            // Tube
            ctx.fillStyle = '#555';
            ctx.fillRect(x + w * 0.25, sy, w * 0.5, slotH * 0.7);
            // Missile tip
            ctx.fillStyle = '#cc3333';
            ctx.beginPath();
            ctx.moveTo(x + w * 0.75, sy + slotH * 0.1);
            ctx.lineTo(x + w * 0.82, sy + slotH * 0.35);
            ctx.lineTo(x + w * 0.75, sy + slotH * 0.6);
            ctx.closePath();
            ctx.fill();
        }
        // Smoke puff if recently fired
        if (building.firing) {
            ctx.fillStyle = 'rgba(180,180,180,0.4)';
            ctx.beginPath();
            ctx.arc(x + w * 0.85, cy, w * 0.12, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.strokeStyle = '#331111';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawTeslaCoil(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        var r = Math.min(w, h) * 0.35;
        ctx.save();
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(x, y, w, h);
        // Coil tower
        ctx.fillStyle = '#3a3a5a';
        ctx.fillRect(cx - w * 0.08, y + h * 0.25, w * 0.16, h * 0.65);
        // Top sphere
        ctx.fillStyle = '#5a5a8a';
        ctx.beginPath();
        ctx.arc(cx, y + h * 0.22, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
        // Bottom sphere
        ctx.beginPath();
        ctx.arc(cx, y + h * 0.78, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
        // Electric arcs
        var arcCount = building.active ? 3 : 1;
        for (var a = 0; a < arcCount; a++) {
            var arcAngle = t * 5 + a * 2.1;
            var ax = cx + Math.cos(arcAngle) * r * 0.8;
            var ay = y + h * 0.22 + Math.sin(arcAngle) * r * 0.6;
            ctx.strokeStyle = 'rgba(130,100,255,' + (0.5 + 0.3 * Math.sin(t * 8 + a)).toFixed(2) + ')';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx, y + h * 0.22);
            // Zigzag
            var mx = (cx + ax) / 2 + Math.sin(t * 10 + a) * 4;
            var my = (y + h * 0.22 + ay) / 2 + Math.cos(t * 10 + a) * 3;
            ctx.quadraticCurveTo(mx, my, ax, ay);
            ctx.stroke();
        }
        ctx.strokeStyle = '#222244';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawFlamethrower(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        ctx.save();
        ctx.fillStyle = '#1a0a0a';
        ctx.fillRect(x, y, w, h);
        // Base
        ctx.fillStyle = '#3a2a1a';
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(w, h) * 0.28, 0, Math.PI * 2);
        ctx.fill();
        // Nozzle
        var angle = building.turretAngle || (t * 0.4);
        var nx = cx + Math.cos(angle) * w * 0.35;
        var ny = cy + Math.sin(angle) * h * 0.35;
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        // Flame cone (when active)
        if (building.active && !building.manualOff) {
            for (var f = 0; f < 4; f++) {
                var fd = 0.6 + f * 0.15;
                var fx = cx + Math.cos(angle) * w * fd;
                var fy = cy + Math.sin(angle) * h * fd;
                var fr = 3 + f * 1.5;
                var fa = Math.max(0, 0.6 - f * 0.15 + Math.sin(t * 10 + f) * 0.1);
                var fhue = f < 2 ? '255,200,50' : '255,100,20';
                ctx.fillStyle = 'rgba(' + fhue + ',' + fa.toFixed(2) + ')';
                ctx.beginPath();
                ctx.arc(fx, fy, fr, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.strokeStyle = '#331a0a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawRailgun(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        ctx.save();
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(x, y, w, h);
        // Base
        ctx.fillStyle = '#2a2a3a';
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(w, h) * 0.25, 0, Math.PI * 2);
        ctx.fill();
        // Long barrel
        var angle = building.turretAngle || (t * 0.2);
        var barrelLen = Math.min(w, h) * 0.55;
        ctx.strokeStyle = '#6a6a8a';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angle) * barrelLen, cy + Math.sin(angle) * barrelLen);
        ctx.stroke();
        // EM rings along barrel
        for (var r = 0; r < 3; r++) {
            var rd = 0.3 + r * 0.2;
            var rx = cx + Math.cos(angle) * barrelLen * rd;
            var ry = cy + Math.sin(angle) * barrelLen * rd;
            var pulse = 0.3 + 0.4 * Math.sin(t * 4 - r * 1.5);
            ctx.strokeStyle = 'rgba(80,120,255,' + pulse.toFixed(2) + ')';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(rx, ry, 3, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.strokeStyle = '#1a1a2a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawEMPTower(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        var r = Math.min(w, h) * 0.3;
        ctx.save();
        ctx.fillStyle = '#0a1a2a';
        ctx.fillRect(x, y, w, h);
        // Dome
        ctx.fillStyle = '#2a3a5a';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        // Pulse rings
        for (var p = 0; p < 2; p++) {
            var pr = ((t * 1.5 + p * 0.5) % 1) * r * 2;
            var pa = Math.max(0, 0.6 - pr / (r * 2));
            ctx.strokeStyle = 'rgba(50,200,255,' + pa.toFixed(2) + ')';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, pr, 0, Math.PI * 2);
            ctx.stroke();
        }
        // Center glow
        ctx.fillStyle = 'rgba(100,200,255,0.4)';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1a2a3a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawMortar(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        ctx.save();
        ctx.fillStyle = '#1a1a0a';
        ctx.fillRect(x, y, w, h);
        // Base platform
        ctx.fillStyle = '#3a3a2a';
        ctx.fillRect(x + w * 0.15, y + h * 0.5, w * 0.7, h * 0.45);
        // Tube
        var tilt = 0.3 + Math.sin(t * 0.5) * 0.1;
        ctx.save();
        ctx.translate(cx, y + h * 0.55);
        ctx.rotate(-tilt);
        ctx.fillStyle = '#5a5a4a';
        ctx.fillRect(-w * 0.08, -h * 0.4, w * 0.16, h * 0.4);
        // Opening
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(0, -h * 0.4, w * 0.08, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = '#2a2a1a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawDroneBay(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        ctx.save();
        ctx.fillStyle = '#1a1a2a';
        ctx.fillRect(x, y, w, h);
        // Hangar
        ctx.fillStyle = '#2a2a3a';
        ctx.fillRect(x + w * 0.1, y + h * 0.3, w * 0.8, h * 0.65);
        // Hangar door opening
        ctx.fillStyle = '#111';
        ctx.fillRect(x + w * 0.2, y + h * 0.35, w * 0.6, h * 0.25);
        // Mini drone hovering above
        var hover = Math.sin(t * 3) * 3;
        var droneY = y + h * 0.2 + hover;
        ctx.fillStyle = '#8888aa';
        ctx.fillRect(cx - 4, droneY - 2, 8, 4);
        // Rotor blur
        ctx.strokeStyle = 'rgba(150,150,200,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 6, droneY - 3);
        ctx.lineTo(cx + 6, droneY - 3);
        ctx.stroke();
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawMineLayer(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        ctx.save();
        ctx.fillStyle = '#1a1a0a';
        ctx.fillRect(x, y, w, h);
        // Armored box
        ctx.fillStyle = '#3a3a2a';
        ctx.fillRect(x + w * 0.1, y + h * 0.2, w * 0.8, h * 0.6);
        // Warning stripes
        ctx.fillStyle = '#cc9900';
        ctx.fillRect(x + w * 0.1, y + h * 0.2, w * 0.8, h * 0.08);
        ctx.fillStyle = '#222';
        ctx.fillRect(x + w * 0.1, y + h * 0.24, w * 0.2, h * 0.04);
        ctx.fillRect(x + w * 0.5, y + h * 0.24, w * 0.2, h * 0.04);
        // Blinking mine dots
        for (var m = 0; m < 3; m++) {
            var mx = cx - w * 0.2 + m * w * 0.2;
            var my = cy + h * 0.1;
            var blink = Math.sin(t * 3 + m * 2) > 0;
            ctx.fillStyle = blink ? '#ff3333' : '#661111';
            ctx.beginPath();
            ctx.arc(mx, my, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.strokeStyle = '#2a2a1a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawAutocannon(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        var r = Math.min(w, h) * 0.3;
        ctx.save();
        ctx.fillStyle = '#1a0a0a';
        ctx.fillRect(x, y, w, h);
        // Rotating multi-barrel base
        ctx.fillStyle = '#4a2a2a';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        // 4 barrels (gatling style)
        var angle = building.turretAngle || (t * 4);
        for (var b = 0; b < 4; b++) {
            var ba = angle + b * Math.PI / 2;
            var bLen = r * 1.1;
            ctx.strokeStyle = '#888';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(ba) * r * 0.3, cy + Math.sin(ba) * r * 0.3);
            ctx.lineTo(cx + Math.cos(ba) * bLen, cy + Math.sin(ba) * bLen);
            ctx.stroke();
        }
        // Center
        ctx.fillStyle = '#cc4444';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#330a0a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawPlasmaCannon(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        var r = Math.min(w, h) * 0.3;
        ctx.save();
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(x, y, w, h);
        // Base
        ctx.fillStyle = '#2a1a3a';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        // Wide barrel
        var angle = building.turretAngle || (t * 0.3);
        ctx.fillStyle = '#4a2a5a';
        ctx.beginPath();
        var nx = cx + Math.cos(angle) * r * 1.3;
        var ny = cy + Math.sin(angle) * r * 1.3;
        var perpX = -Math.sin(angle) * r * 0.4;
        var perpY = Math.cos(angle) * r * 0.4;
        ctx.moveTo(cx + perpX, cy + perpY);
        ctx.lineTo(nx + perpX * 0.5, ny + perpY * 0.5);
        ctx.lineTo(nx - perpX * 0.5, ny - perpY * 0.5);
        ctx.lineTo(cx - perpX, cy - perpY);
        ctx.closePath();
        ctx.fill();
        // Plasma glow at muzzle
        var pulse = 0.3 + 0.3 * Math.sin(t * 5);
        ctx.fillStyle = 'rgba(200,50,255,' + pulse.toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(nx, ny, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1a0a2a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawFusionBeam(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        var r = Math.min(w, h) * 0.35;
        ctx.save();
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(x, y, w, h);
        // Large dish
        var angle = building.turretAngle || (t * 0.2);
        ctx.fillStyle = '#3a3a5a';
        ctx.beginPath();
        ctx.arc(cx, cy, r, angle - 1.2, angle + 1.2);
        ctx.lineTo(cx, cy);
        ctx.closePath();
        ctx.fill();
        // Inner rings (charging)
        for (var ri = 0; ri < 3; ri++) {
            var rr = r * (0.3 + ri * 0.15);
            var pulse = 0.3 + 0.3 * Math.sin(t * 3 + ri * 1.5);
            ctx.strokeStyle = 'rgba(100,200,255,' + pulse.toFixed(2) + ')';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, rr, angle - 0.8, angle + 0.8);
            ctx.stroke();
        }
        // Core glow
        ctx.fillStyle = 'rgba(150,220,255,0.5)';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1a1a2a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    // --- DEFENSE ---

    function _drawShieldGenerator(ctx, x, y, w, h, building, t, tier) {
        var cx = x + w / 2, cy = y + h / 2;
        var r = Math.min(w, h) * 0.35;
        ctx.save();
        ctx.fillStyle = '#0a0a2a';
        ctx.fillRect(x, y, w, h);
        // Hex base
        ctx.fillStyle = '#2a2a5a';
        ctx.beginPath();
        for (var i = 0; i < 6; i++) {
            var a = i * Math.PI / 3 - Math.PI / 6;
            var px = cx + Math.cos(a) * r;
            var py = cy + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = tier >= 2 ? '#6688ff' : '#4466cc';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Projector dome
        var pulse = 0.3 + 0.3 * Math.sin(t * 2);
        var domColor = tier >= 2 ? 'rgba(80,140,255,' : 'rgba(60,100,200,';
        ctx.fillStyle = domColor + pulse.toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
        // Energy ring
        ctx.strokeStyle = domColor + '0.6)';
        ctx.lineWidth = 1;
        var ringAngle = t * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.7, ringAngle, ringAngle + 1.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.7, ringAngle + Math.PI, ringAngle + Math.PI + 1.5);
        ctx.stroke();
        ctx.strokeStyle = '#1a1a3a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawWall(ctx, x, y, w, h, building, t, variant) {
        ctx.save();
        var baseColor, accentColor;
        if (variant === 'electric') {
            baseColor = '#3a3a5a'; accentColor = '#5a7acc';
        } else if (variant === 'steel') {
            baseColor = '#4a4a5a'; accentColor = '#7a7a8a';
        } else {
            baseColor = '#5a5550'; accentColor = '#6a6560';
        }
        ctx.fillStyle = baseColor;
        ctx.fillRect(x, y, w, h);
        // Brick/rivet pattern
        var brickH = h / 3;
        for (var row = 0; row < 3; row++) {
            var offset = (row % 2) * w * 0.3;
            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(x, y + row * brickH);
            ctx.lineTo(x + w, y + row * brickH);
            ctx.stroke();
            // Vertical line
            ctx.beginPath();
            ctx.moveTo(x + w * 0.5 + offset, y + row * brickH);
            ctx.lineTo(x + w * 0.5 + offset, y + (row + 1) * brickH);
            ctx.stroke();
        }
        // Damage cracks
        var hpRatio = building.hp / building.maxHp;
        if (hpRatio < 0.7) {
            ctx.strokeStyle = 'rgba(0,0,0,0.4)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + w * 0.3, y + h * 0.2);
            ctx.lineTo(x + w * 0.5, y + h * 0.5);
            ctx.lineTo(x + w * 0.4, y + h * 0.8);
            ctx.stroke();
        }
        if (hpRatio < 0.4) {
            ctx.beginPath();
            ctx.moveTo(x + w * 0.7, y + h * 0.1);
            ctx.lineTo(x + w * 0.6, y + h * 0.6);
            ctx.stroke();
        }
        // Electric sparks
        if (variant === 'electric' && building.active) {
            var sparkA = 0.3 + 0.3 * Math.sin(t * 8);
            ctx.fillStyle = 'rgba(100,150,255,' + sparkA.toFixed(2) + ')';
            ctx.beginPath();
            ctx.arc(x + w * 0.5, y + h * 0.3, 2, 0, Math.PI * 2);
            ctx.fill();
        }
        // Steel rivets
        if (variant === 'steel') {
            ctx.fillStyle = '#8a8a9a';
            var corners = [[0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];
            for (var c = 0; c < corners.length; c++) {
                ctx.beginPath();
                ctx.arc(x + w * corners[c][0], y + h * corners[c][1], 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawCoreRepair(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        ctx.save();
        ctx.fillStyle = '#1a2a1a';
        ctx.fillRect(x, y, w, h);
        // Wrench icon
        var pulse = 0.5 + 0.3 * Math.sin(t * 2);
        ctx.strokeStyle = 'rgba(100,200,100,' + pulse.toFixed(2) + ')';
        ctx.lineWidth = 2.5;
        var wr = Math.min(w, h) * 0.25;
        ctx.beginPath();
        ctx.moveTo(cx - wr, cy - wr * 0.5);
        ctx.lineTo(cx + wr * 0.3, cy + wr * 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx - wr, cy - wr * 0.5, wr * 0.3, 0, Math.PI * 2);
        ctx.stroke();
        // Healing particles
        if (building.active && !building.manualOff) {
            var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, wr * 1.5);
            grad.addColorStop(0, 'rgba(100,255,100,' + (pulse * 0.3).toFixed(2) + ')');
            grad.addColorStop(1, 'rgba(100,255,100,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(cx, cy, wr * 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.strokeStyle = '#1a3a1a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    // --- HOUSING ---

    function _drawSmallHouse(ctx, x, y, w, h, building, t) {
        ctx.save();
        // Inset the house to make it smaller within the tile
        var pad = w * 0.1;
        var hx = x + pad, hy = y + pad * 0.6;
        var hw = w - pad * 2, hh = h - pad * 1.2;
        // Ground / yard
        ctx.fillStyle = '#3a5a2a';
        ctx.fillRect(x, y + h * 0.85, w, h * 0.15);
        // House body with gradient
        var wallGrad = ctx.createLinearGradient(hx, hy + hh * 0.4, hx, hy + hh * 0.85);
        wallGrad.addColorStop(0, '#6a7a5a');
        wallGrad.addColorStop(1, '#5a6a4a');
        ctx.fillStyle = wallGrad;
        ctx.fillRect(hx + hw * 0.1, hy + hh * 0.4, hw * 0.8, hh * 0.45);
        // Side shadow
        ctx.fillStyle = 'rgba(0,0,0,0.1)';
        ctx.fillRect(hx + hw * 0.7, hy + hh * 0.4, hw * 0.2, hh * 0.45);
        // Roof with overhang
        ctx.fillStyle = '#8a5a3a';
        ctx.beginPath();
        ctx.moveTo(hx + hw * 0.02, hy + hh * 0.42);
        ctx.lineTo(hx + hw * 0.5, hy + hh * 0.1);
        ctx.lineTo(hx + hw * 0.98, hy + hh * 0.42);
        ctx.closePath();
        ctx.fill();
        // Roof ridge highlight
        ctx.strokeStyle = '#9a6a4a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hx + hw * 0.25, hy + hh * 0.27);
        ctx.lineTo(hx + hw * 0.5, hy + hh * 0.12);
        ctx.lineTo(hx + hw * 0.75, hy + hh * 0.27);
        ctx.stroke();
        // Window - narrower and shorter
        var glow = 0.5 + 0.2 * Math.sin(t * 1.5);
        ctx.fillStyle = 'rgba(255,220,100,' + glow.toFixed(2) + ')';
        ctx.fillRect(hx + hw * 0.32, hy + hh * 0.5, hw * 0.25, hh * 0.14);
        ctx.strokeStyle = '#4a3a2a';
        ctx.lineWidth = 1;
        ctx.strokeRect(hx + hw * 0.32, hy + hh * 0.5, hw * 0.25, hh * 0.14);
        // Window cross
        ctx.beginPath();
        ctx.moveTo(hx + hw * 0.445, hy + hh * 0.5);
        ctx.lineTo(hx + hw * 0.445, hy + hh * 0.64);
        ctx.moveTo(hx + hw * 0.32, hy + hh * 0.57);
        ctx.lineTo(hx + hw * 0.57, hy + hh * 0.57);
        ctx.stroke();
        // Door - narrower and shorter
        ctx.fillStyle = '#5a3a1a';
        ctx.fillRect(hx + hw * 0.42, hy + hh * 0.74, hw * 0.15, hh * 0.11);
        ctx.strokeStyle = '#4a2a0a';
        ctx.lineWidth = 1;
        ctx.strokeRect(hx + hw * 0.42, hy + hh * 0.74, hw * 0.15, hh * 0.11);
        // Door knob
        ctx.fillStyle = '#cc9944';
        ctx.beginPath();
        ctx.arc(hx + hw * 0.53, hy + hh * 0.8, 1, 0, Math.PI * 2);
        ctx.fill();
        // Chimney
        ctx.fillStyle = '#6a5040';
        ctx.fillRect(hx + hw * 0.7, hy + hh * 0.12, hw * 0.1, hh * 0.2);
        // Border
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawMediumHouse(ctx, x, y, w, h, building, t) {
        ctx.save();
        // Ground
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(x, y + h * 0.88, w, h * 0.12);
        // Building body with gradient
        var wallGrad = ctx.createLinearGradient(x, y + h * 0.15, x + w, y + h * 0.15);
        wallGrad.addColorStop(0, '#5a5a6a');
        wallGrad.addColorStop(0.5, '#6a6a7a');
        wallGrad.addColorStop(1, '#4a4a5a');
        ctx.fillStyle = wallGrad;
        ctx.fillRect(x + w * 0.06, y + h * 0.18, w * 0.88, h * 0.7);
        // Flat roof with ledge
        ctx.fillStyle = '#5a5a68';
        ctx.fillRect(x + w * 0.03, y + h * 0.14, w * 0.94, h * 0.07);
        ctx.fillStyle = '#6a6a78';
        ctx.fillRect(x + w * 0.03, y + h * 0.14, w * 0.94, h * 0.025);
        // Floor dividers
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.06, y + h * 0.52);
        ctx.lineTo(x + w * 0.94, y + h * 0.52);
        ctx.stroke();
        // Windows (2x3 grid with frames)
        for (var wr = 0; wr < 2; wr++) {
            for (var wc = 0; wc < 3; wc++) {
                var wx = x + w * 0.12 + wc * w * 0.27;
                var wy = y + h * 0.24 + wr * h * 0.32;
                var lit = Math.sin(t * 1.2 + wr * 3 + wc * 5) > -0.3;
                // Window recess
                ctx.fillStyle = '#2a2a3a';
                ctx.fillRect(wx - 1, wy - 1, w * 0.18 + 2, h * 0.16 + 2);
                ctx.fillStyle = lit ? 'rgba(255,220,100,0.6)' : 'rgba(30,30,50,0.7)';
                ctx.fillRect(wx, wy, w * 0.18, h * 0.16);
                // Window cross frame
                ctx.strokeStyle = lit ? '#8a7a5a' : '#3a3a4a';
                ctx.lineWidth = 0.7;
                ctx.beginPath();
                ctx.moveTo(wx + w * 0.09, wy);
                ctx.lineTo(wx + w * 0.09, wy + h * 0.16);
                ctx.moveTo(wx, wy + h * 0.08);
                ctx.lineTo(wx + w * 0.18, wy + h * 0.08);
                ctx.stroke();
            }
        }
        // Entrance door at bottom center - narrower and shorter
        ctx.fillStyle = '#3a3a2a';
        ctx.fillRect(x + w * 0.43, y + h * 0.75, w * 0.14, h * 0.13);
        // Door frame
        ctx.strokeStyle = '#5a5a4a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + w * 0.43, y + h * 0.75, w * 0.14, h * 0.13);
        // Entrance light
        var lightGlow = 0.4 + 0.2 * Math.sin(t * 2);
        ctx.fillStyle = 'rgba(255,200,100,' + lightGlow.toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(x + w * 0.5, y + h * 0.71, 2, 0, Math.PI * 2);
        ctx.fill();
        // Border
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawLargeHouse(ctx, x, y, w, h, building, t) {
        ctx.save();
        // Ground
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(x, y + h * 0.92, w, h * 0.08);
        // Main tower body with gradient
        var wallGrad = ctx.createLinearGradient(x + w * 0.1, y, x + w * 0.9, y);
        wallGrad.addColorStop(0, '#5a5a6a');
        wallGrad.addColorStop(0.3, '#6a6a7a');
        wallGrad.addColorStop(0.7, '#5a5a68');
        wallGrad.addColorStop(1, '#4a4a5a');
        ctx.fillStyle = wallGrad;
        ctx.fillRect(x + w * 0.08, y + h * 0.06, w * 0.84, h * 0.86);
        // Roof cap
        ctx.fillStyle = '#5a5a68';
        ctx.fillRect(x + w * 0.05, y + h * 0.03, w * 0.9, h * 0.05);
        ctx.fillStyle = '#6a6a78';
        ctx.fillRect(x + w * 0.05, y + h * 0.03, w * 0.9, h * 0.02);
        // Floor dividers
        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 1;
        for (var fl = 1; fl < 5; fl++) {
            var fy = y + h * (0.08 + fl * 0.17);
            ctx.beginPath();
            ctx.moveTo(x + w * 0.08, fy);
            ctx.lineTo(x + w * 0.92, fy);
            ctx.stroke();
        }
        // Windows (3x5 grid with recesses)
        for (var wr = 0; wr < 5; wr++) {
            for (var wc = 0; wc < 3; wc++) {
                var wx = x + w * 0.14 + wc * w * 0.26;
                var wy = y + h * 0.08 + wr * h * 0.17;
                var lit = Math.sin(t * 0.8 + wr * 2.5 + wc * 4.3) > -0.2;
                // Window recess
                ctx.fillStyle = '#2a2a3a';
                ctx.fillRect(wx - 1, wy - 1, w * 0.15 + 2, h * 0.1 + 2);
                ctx.fillStyle = lit ? 'rgba(255,220,100,0.5)' : 'rgba(25,25,45,0.6)';
                ctx.fillRect(wx, wy, w * 0.15, h * 0.1);
                // Curtain effect on some lit windows
                if (lit && ((wr + wc) % 3 === 0)) {
                    ctx.fillStyle = 'rgba(200,160,80,0.3)';
                    ctx.fillRect(wx, wy, w * 0.06, h * 0.1);
                }
            }
        }
        // Antenna
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.5, y + h * 0.03);
        ctx.lineTo(x + w * 0.5, y - h * 0.06);
        ctx.stroke();
        // Antenna cross bar
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.42, y - h * 0.02);
        ctx.lineTo(x + w * 0.58, y - h * 0.02);
        ctx.stroke();
        // Blinking antenna light
        ctx.fillStyle = Math.sin(t * 4) > 0 ? '#ff3333' : '#551111';
        ctx.beginPath();
        ctx.arc(x + w * 0.5, y - h * 0.06, 2, 0, Math.PI * 2);
        ctx.fill();
        // Entrance
        ctx.fillStyle = '#3a3a2a';
        ctx.fillRect(x + w * 0.38, y + h * 0.82, w * 0.24, h * 0.1);
        // Entrance overhang
        ctx.fillStyle = '#5a5a5a';
        ctx.fillRect(x + w * 0.34, y + h * 0.8, w * 0.32, h * 0.03);
        // Border
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    // --- ENVIRONMENT ---

    function _drawCarbonCollector(ctx, x, y, w, h, building, t, tier) {
        var cx = x + w / 2, cy = y + h / 2;
        var r = Math.min(w, h) * 0.32;
        ctx.save();
        ctx.fillStyle = '#0a1a0a';
        ctx.fillRect(x, y, w, h);
        // Collector dish
        ctx.fillStyle = tier >= 2 ? '#2a5a2a' : '#1a4a1a';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        // Spinning fan at center
        for (var f = 0; f < 4; f++) {
            var fa = t * 3 + f * Math.PI / 2;
            ctx.fillStyle = 'rgba(80,180,80,0.6)';
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r * 0.6, fa, fa + 0.6);
            ctx.closePath();
            ctx.fill();
        }
        // Green particles being sucked in
        if (building.active && !building.manualOff) {
            for (var p = 0; p < 4; p++) {
                var pAngle = t * 1.5 + p * Math.PI / 2;
                var pDist = r * 1.5 - ((t * 20 + p * 8) % (r * 1.5));
                var px = cx + Math.cos(pAngle) * pDist;
                var py = cy + Math.sin(pAngle) * pDist;
                var pa = Math.max(0, 0.6 - pDist / (r * 1.5) * 0.4);
                ctx.fillStyle = 'rgba(60,200,60,' + pa.toFixed(2) + ')';
                ctx.beginPath();
                ctx.arc(px, py, 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.strokeStyle = '#0a2a0a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    // --- GRID ---

    function _drawPylonBuilding(ctx, x, y, w, h, building, t, variant) {
        var cx = x + w / 2, cy = y + h / 2;
        ctx.save();

        // Water pylon floating platform base
        if (variant === 'water') {
            ctx.fillStyle = '#2a4a6a';
            ctx.fillRect(x + w * 0.05, y + h * 0.82, w * 0.9, h * 0.15);
            ctx.strokeStyle = 'rgba(80,140,200,0.4)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            var waveY = y + h * 0.96;
            ctx.moveTo(x, waveY);
            for (var wv = 0; wv < w; wv += 4) {
                ctx.lineTo(x + wv, waveY + Math.sin(t * 3 + wv * 0.3) * 1.5);
            }
            ctx.stroke();
        }

        var metalColor = variant === 'hc' ? '#7090bb' : (variant === 'water' ? '#5577aa' : '#888');
        var darkMetal = variant === 'hc' ? '#506888' : (variant === 'water' ? '#3a5577' : '#555');
        var lw = variant === 'hc' ? 2 : 1.5;

        // Tower legs (two angled legs from base converging toward center)
        var baseW = w * 0.4;   // half-width at base
        var topW = w * 0.08;   // half-width at top
        var baseY = y + h * 0.85;
        var topY = y + h * 0.12;

        ctx.strokeStyle = metalColor;
        ctx.lineWidth = lw;
        // Left leg
        ctx.beginPath();
        ctx.moveTo(cx - baseW, baseY);
        ctx.lineTo(cx - topW, topY);
        ctx.stroke();
        // Right leg
        ctx.beginPath();
        ctx.moveTo(cx + baseW, baseY);
        ctx.lineTo(cx + topW, topY);
        ctx.stroke();

        // Cross braces (horizontal + diagonal lattice)
        var braceCount = 4;
        for (var bi = 0; bi < braceCount; bi++) {
            var frac = 0.2 + bi * 0.18;
            var by = y + h * (0.85 - frac * 0.73);
            var bwL = cx - (baseW + (topW - baseW) * frac);
            var bwR = cx + (baseW + (topW - baseW) * frac);
            // Horizontal brace
            ctx.strokeStyle = darkMetal;
            ctx.lineWidth = lw * 0.7;
            ctx.beginPath();
            ctx.moveTo(bwL, by);
            ctx.lineTo(bwR, by);
            ctx.stroke();
            // Diagonal brace (alternating direction)
            if (bi < braceCount - 1) {
                var nextFrac = 0.2 + (bi + 1) * 0.18;
                var ny = y + h * (0.85 - nextFrac * 0.73);
                var nwL = cx - (baseW + (topW - baseW) * nextFrac);
                var nwR = cx + (baseW + (topW - baseW) * nextFrac);
                ctx.lineWidth = lw * 0.5;
                ctx.beginPath();
                if (bi % 2 === 0) {
                    ctx.moveTo(bwL, by); ctx.lineTo(nwR, ny);
                } else {
                    ctx.moveTo(bwR, by); ctx.lineTo(nwL, ny);
                }
                ctx.stroke();
            }
        }

        // Crossarms (horizontal arms at top for wires)
        var armY = y + h * 0.2;
        var armSpan = w * 0.42;
        ctx.strokeStyle = metalColor;
        ctx.lineWidth = lw * 1.2;
        ctx.beginPath();
        ctx.moveTo(cx - armSpan, armY);
        ctx.lineTo(cx + armSpan, armY);
        ctx.stroke();

        // Second smaller crossarm higher
        var arm2Y = y + h * 0.12;
        var arm2Span = w * 0.28;
        ctx.beginPath();
        ctx.moveTo(cx - arm2Span, arm2Y);
        ctx.lineTo(cx + arm2Span, arm2Y);
        ctx.stroke();

        // Insulators (small hanging lines from crossarm tips)
        var insColor = variant === 'hc' ? '#aaccee' : '#bbb';
        ctx.strokeStyle = insColor;
        ctx.lineWidth = 1;
        var insLen = h * 0.06;
        var insPositions = [
            [cx - armSpan, armY], [cx + armSpan, armY], [cx - armSpan * 0.5, armY],
            [cx + armSpan * 0.5, armY], [cx - arm2Span, arm2Y], [cx + arm2Span, arm2Y]
        ];
        for (var ii = 0; ii < insPositions.length; ii++) {
            ctx.beginPath();
            ctx.moveTo(insPositions[ii][0], insPositions[ii][1]);
            ctx.lineTo(insPositions[ii][0], insPositions[ii][1] + insLen);
            ctx.stroke();
            // Insulator dot
            ctx.fillStyle = insColor;
            ctx.beginPath();
            ctx.arc(insPositions[ii][0], insPositions[ii][1] + insLen, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // HC pylon glow at top
        if (variant === 'hc') {
            var pulse = 0.15 + 0.2 * Math.sin(t * 3);
            ctx.fillStyle = 'rgba(80,140,220,' + pulse.toFixed(2) + ')';
            ctx.beginPath();
            ctx.arc(cx, y + h * 0.08, 4, 0, Math.PI * 2);
            ctx.fill();
            // Small arc between top insulators
            if (Math.sin(t * 5) > 0.7) {
                ctx.strokeStyle = 'rgba(100,180,255,0.6)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(cx - arm2Span, arm2Y + insLen);
                var arcMidX = cx;
                var arcMidY = arm2Y + insLen - 3 + Math.sin(t * 8) * 2;
                ctx.quadraticCurveTo(arcMidX, arcMidY, cx + arm2Span, arm2Y + insLen);
                ctx.stroke();
            }
        }

        ctx.restore();
    }

    function _drawGridConnect(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        ctx.save();
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(x, y, w, h);
        // Transformer box
        ctx.fillStyle = '#2a3a2a';
        ctx.fillRect(x + w * 0.15, y + h * 0.15, w * 0.7, h * 0.7);
        // Outlet prongs
        ctx.fillStyle = '#555';
        ctx.fillRect(cx - w * 0.12, y + h * 0.3, w * 0.08, h * 0.2);
        ctx.fillRect(cx + w * 0.05, y + h * 0.3, w * 0.08, h * 0.2);
        // Power indicator
        var pulse = 0.3 + 0.4 * Math.sin(t * 2);
        ctx.fillStyle = building.active ? 'rgba(50,200,50,' + pulse.toFixed(2) + ')' : 'rgba(100,50,50,0.3)';
        ctx.beginPath();
        ctx.arc(cx, cy + h * 0.15, 3, 0, Math.PI * 2);
        ctx.fill();
        // Pulsing energy waves when active
        if (building.active && !building.manualOff) {
            var pr = ((t * 2) % 1) * w * 0.5;
            var pa = Math.max(0, 0.4 - pr / (w * 0.5));
            ctx.strokeStyle = 'rgba(50,200,50,' + pa.toFixed(2) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cx, cy, pr, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    function _drawConsumerMarket(ctx, x, y, w, h, building, t) {
        var cx = x + w / 2, cy = y + h / 2;
        ctx.save();
        // Ground pad
        ctx.fillStyle = '#3a3a2a';
        ctx.fillRect(x, y + h * 0.85, w, h * 0.15);
        // Main building body
        var wallGrad = ctx.createLinearGradient(x, y + h * 0.3, x + w, y + h * 0.3);
        wallGrad.addColorStop(0, '#5a4a2a');
        wallGrad.addColorStop(0.5, '#6a5a3a');
        wallGrad.addColorStop(1, '#4a3a1a');
        ctx.fillStyle = wallGrad;
        ctx.fillRect(x + w * 0.06, y + h * 0.32, w * 0.88, h * 0.53);
        // Storefront window
        ctx.fillStyle = 'rgba(200,180,120,0.25)';
        ctx.fillRect(x + w * 0.12, y + h * 0.5, w * 0.35, h * 0.25);
        ctx.strokeStyle = '#5a4a2a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + w * 0.12, y + h * 0.5, w * 0.35, h * 0.25);
        // Awning with stripes
        ctx.fillStyle = '#cc8833';
        ctx.beginPath();
        ctx.moveTo(x + w * 0.02, y + h * 0.34);
        ctx.lineTo(x + w * 0.5, y + h * 0.1);
        ctx.lineTo(x + w * 0.98, y + h * 0.34);
        ctx.closePath();
        ctx.fill();
        // Awning stripe detail
        ctx.fillStyle = '#bb7722';
        ctx.beginPath();
        ctx.moveTo(x + w * 0.18, y + h * 0.28);
        ctx.lineTo(x + w * 0.34, y + h * 0.17);
        ctx.lineTo(x + w * 0.5, y + h * 0.28);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + w * 0.5, y + h * 0.28);
        ctx.lineTo(x + w * 0.66, y + h * 0.17);
        ctx.lineTo(x + w * 0.82, y + h * 0.28);
        ctx.closePath();
        ctx.fill();
        // Door
        ctx.fillStyle = '#4a3a1a';
        ctx.fillRect(x + w * 0.6, y + h * 0.55, w * 0.22, h * 0.3);
        ctx.strokeStyle = '#5a4a2a';
        ctx.strokeRect(x + w * 0.6, y + h * 0.55, w * 0.22, h * 0.3);
        // Door handle
        ctx.fillStyle = '#cc9944';
        ctx.beginPath();
        ctx.arc(x + w * 0.64, y + h * 0.7, 1.2, 0, Math.PI * 2);
        ctx.fill();
        // Dollar sign on awning
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold ' + Math.floor(Math.min(w, h) * 0.22) + 'px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('$', cx, y + h * 0.22);
        // Small signboard
        ctx.fillStyle = '#2a2a1a';
        ctx.fillRect(x + w * 0.25, y + h * 0.38, w * 0.5, h * 0.08);
        ctx.fillStyle = '#ddaa44';
        ctx.font = Math.floor(Math.min(w, h) * 0.1) + 'px sans-serif';
        ctx.fillText('MARKET', cx, y + h * 0.425);
        // Animated coin sparkle
        var sparkT = (t * 2) % 4;
        if (sparkT < 1.5) {
            var sparkA = 0.6 - sparkT * 0.4;
            ctx.fillStyle = 'rgba(255,215,0,' + Math.max(0, sparkA).toFixed(2) + ')';
            ctx.beginPath();
            ctx.arc(x + w * 0.85, y + h * 0.15, 2, 0, Math.PI * 2);
            ctx.fill();
        }
        // Border
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

    // --- BUILDING DRAW DISPATCH ---

    function _drawBuildingCustom(ctx, x, y, w, h, building, t) {
        var type = building.type;
        switch (type) {
            // Power
            case 'solar': _drawSolarPanel(ctx, x, y, w, h, building, t); return true;
            case 'wind': _drawWindTurbine(ctx, x, y, w, h, building, t); return true;
            case 'coal_plant': return false;
            case 'gas_plant': _drawGasPlant(ctx, x, y, w, h, building, t); return true;
            case 'nuclear_plant': _drawNuclearPlant(ctx, x, y, w, h, building, t); return true;
            case 'hydro_plant': _drawHydroPlant(ctx, x, y, w, h, building, t); return true;
            // Storage
            case 'small_battery': _drawSmallBattery(ctx, x, y, w, h, building, t); return true;
            case 'large_battery': _drawLargeBattery(ctx, x, y, w, h, building, t); return true;
            case 'capacitor': _drawCapacitor(ctx, x, y, w, h, building, t, false); return true;
            case 'advanced_capacitor': _drawCapacitor(ctx, x, y, w, h, building, t, true); return true;
            case 'consumer_battery': _drawConsumerBattery(ctx, x, y, w, h, building, t); return true;
            // Mining
            case 'iron_miner': case 'iron_miner_t2': _drawMiner(ctx, x, y, w, h, building, t, '#8a5a2a', '#aa7744', _drawIronIcon); return true;
            case 'coal_miner': case 'coal_miner_t2': _drawMiner(ctx, x, y, w, h, building, t, '#3a3a3a', '#555', _drawCoalIcon); return true;
            case 'uranium_miner': case 'uranium_miner_t2': _drawMiner(ctx, x, y, w, h, building, t, '#2a4a2a', '#4a8a4a', _drawUraniumIcon); return true;
            case 'oil_drill': case 'oil_drill_t2': _drawOilDrill(ctx, x, y, w, h, building, t); return true;
            case 'smelter': _drawSmelter(ctx, x, y, w, h, building, t); return true;
            // Weapons
            case 'blaster_t1': _drawBlaster(ctx, x, y, w, h, building, t, 1); return true;
            case 'blaster_t2': _drawBlaster(ctx, x, y, w, h, building, t, 2); return true;
            case 'blaster_t3': _drawBlaster(ctx, x, y, w, h, building, t, 3); return true;
            case 'laser_t1': _drawLaserTurret(ctx, x, y, w, h, building, t, 1); return true;
            case 'laser_t2': _drawLaserTurret(ctx, x, y, w, h, building, t, 2); return true;
            case 'laser_t3': _drawLaserTurret(ctx, x, y, w, h, building, t, 3); return true;
            case 'missile_t1': _drawMissileLauncher(ctx, x, y, w, h, building, t, 1); return true;
            case 'missile_t2': _drawMissileLauncher(ctx, x, y, w, h, building, t, 2); return true;
            case 'missile_t3': _drawMissileLauncher(ctx, x, y, w, h, building, t, 3); return true;
            case 'tesla_coil': _drawTeslaCoil(ctx, x, y, w, h, building, t); return true;
            case 'flamethrower': _drawFlamethrower(ctx, x, y, w, h, building, t); return true;
            case 'railgun': _drawRailgun(ctx, x, y, w, h, building, t); return true;
            case 'emp_tower': _drawEMPTower(ctx, x, y, w, h, building, t); return true;
            case 'mortar': _drawMortar(ctx, x, y, w, h, building, t); return true;
            case 'drone_bay': _drawDroneBay(ctx, x, y, w, h, building, t); return true;
            case 'mine_layer': _drawMineLayer(ctx, x, y, w, h, building, t); return true;
            case 'autocannon': _drawAutocannon(ctx, x, y, w, h, building, t); return true;
            case 'plasma_cannon': _drawPlasmaCannon(ctx, x, y, w, h, building, t); return true;
            case 'fusion_beam': _drawFusionBeam(ctx, x, y, w, h, building, t); return true;
            // Defense
            case 'shield_t1': _drawShieldGenerator(ctx, x, y, w, h, building, t, 1); return true;
            case 'shield_t2': _drawShieldGenerator(ctx, x, y, w, h, building, t, 2); return true;
            case 'wall': _drawWall(ctx, x, y, w, h, building, t, 'basic'); return true;
            case 'electric_wall': _drawWall(ctx, x, y, w, h, building, t, 'electric'); return true;
            case 'steel_wall': _drawWall(ctx, x, y, w, h, building, t, 'steel'); return true;
            case 'core_repair': _drawCoreRepair(ctx, x, y, w, h, building, t); return true;
            // Housing
            case 'small_house': _drawSmallHouse(ctx, x, y, w, h, building, t); return true;
            case 'medium_house': _drawMediumHouse(ctx, x, y, w, h, building, t); return true;
            case 'large_house': _drawLargeHouse(ctx, x, y, w, h, building, t); return true;
            // Environment
            case 'carbon_collector_t1': _drawCarbonCollector(ctx, x, y, w, h, building, t, 1); return true;
            case 'carbon_collector_t2': _drawCarbonCollector(ctx, x, y, w, h, building, t, 2); return true;
            // Grid
            case 'pylon': _drawPylonBuilding(ctx, x, y, w, h, building, t, 'standard'); return true;
            case 'water_pylon': _drawPylonBuilding(ctx, x, y, w, h, building, t, 'water'); return true;
            case 'hc_pylon': _drawPylonBuilding(ctx, x, y, w, h, building, t, 'hc'); return true;
            case 'grid_connect': _drawGridConnect(ctx, x, y, w, h, building, t); return true;
            case 'consumer_market': _drawConsumerMarket(ctx, x, y, w, h, building, t); return true;
            default: return false;
        }
    }

    // Render a building icon into a canvas element for UI thumbnails
    function _drawBuildingIcon(type, size) {
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');
        var mockBuilding = {
            type: type,
            energy: 0,
            hp: 100,
            maxHp: 100,
            active: true,
            manualOff: false,
            turretAngle: -Math.PI / 4,
            scaledStorageCapacity: 0
        };
        var def = Config.BUILDINGS[type];
        if (def && def.energyStorageCapacity) {
            mockBuilding.energy = def.energyStorageCapacity * 0.6; // show partially filled
        }
        if (!_drawBuildingCustom(ctx, 0, 0, size, size, mockBuilding, 0)) {
            // Fallback: colored rect with emoji
            var cat = def ? def.category : 'grid';
            ctx.fillStyle = COLORS.BUILDING[cat] || '#888';
            ctx.fillRect(0, 0, size, size);
            if (def && def.icon) {
                ctx.font = Math.floor(size * 0.5) + 'px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(def.icon, size / 2, size / 2);
            }
        }
        return canvas.toDataURL();
    }

    // Icon cache for UI
    var _iconCache = {};
    function _getBuildingIconDataUrl(type, size) {
        var key = type + '_' + size;
        if (!_iconCache[key]) {
            _iconCache[key] = _drawBuildingIcon(type, size || 40);
        }
        return _iconCache[key];
    }

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

        // HP bar — show engine core HP (matches HUD) instead of building HP
        var coreHP = (typeof Engine !== 'undefined' && Engine.getCoreHP) ? Engine.getCoreHP() : building.hp;
        var coreMaxHP = (typeof Config !== 'undefined' && Config.CORE_HP) ? Config.CORE_HP : building.maxHp;
        if (coreHP < coreMaxHP) {
            _drawHPBar(ctx, cx, y, w, coreHP / coreMaxHP);
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
        var all = _getVisibleBuildings();
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

            color = COLORS.BUILDING[def.category] || '#888888';
            var t = _animFrame / 60;

            // Custom draw for core building
            if (b.type === 'core' || b.type === 'core_armored') {
                _drawCoreBuilding(ctx, b.worldX, b.worldY, pw, ph, b, selectedId);
                continue;
            }

            // Try custom procedural drawing; fall back to colored rect
            if (!_drawBuildingCustom(ctx, b.worldX, b.worldY, pw, ph, b, t)) {
                // Fallback: colored rectangle
                ctx.fillStyle = color;
                ctx.fillRect(b.worldX, b.worldY, pw, ph);
                ctx.strokeStyle = 'rgba(0,0,0,0.4)';
                ctx.lineWidth = 1;
                ctx.strokeRect(b.worldX, b.worldY, pw, ph);
                // Icon (emoji)
                if (def.icon) {
                    var fontSize = Math.min(pw, ph) * 0.55;
                    ctx.font = Math.floor(fontSize) + 'px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(def.icon, b.worldX + pw / 2, b.worldY + ph / 2);
                }
            }

            // Inactive overlay (no power, no workers, EMP disabled, or manually off)
            if (!b.active || empDisabled[b.id] || b.manualOff) {
                ctx.fillStyle = 'rgba(0,0,0,0.4)';
                ctx.fillRect(b.worldX, b.worldY, pw, ph);
                // Flashing indicator for EMP
                if (empDisabled[b.id] && _animFrame % 30 < 15) {
                    ctx.fillStyle = 'rgba(50,200,255,0.2)';
                    ctx.fillRect(b.worldX, b.worldY, pw, ph);
                }
            }

            // Resource shortage indicator
            if (b.active && b.resourceShortage && !empDisabled[b.id]) {
                if (_animFrame % 40 < 25) {
                    var badgeX = b.worldX + pw - 8;
                    var badgeY = b.worldY + 8;
                    ctx.fillStyle = 'rgba(255,50,50,0.85)';
                    ctx.beginPath();
                    ctx.arc(badgeX, badgeY, 7, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 8px monospace';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    var shortNames = { iron: 'Fe', coal: 'C', oil: 'Oil', uranium: 'U', steel: 'St', depleted: '⊘' };
                    ctx.fillText(shortNames[b.resourceShortage] || '?', badgeX, badgeY);
                }
            }

            // Worker shortage indicator
            if (!b.active && b.workerShortage && !empDisabled[b.id]) {
                if (_animFrame % 50 < 30) {
                    var wBadgeX = b.worldX + 8;
                    var wBadgeY = b.worldY + 8;
                    ctx.fillStyle = 'rgba(255,140,0,0.9)';
                    ctx.beginPath();
                    ctx.arc(wBadgeX, wBadgeY, 7, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 8px monospace';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('W', wBadgeX, wBadgeY);
                }
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
        var isDebug = (typeof Input !== 'undefined' && Input.isDebugMode && Input.isDebugMode());
        if (!isDebug && !_showEnergyOverlay) return;
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

            var cap = (b.scaledStorageCapacity && b.scaledStorageCapacity > 0) ? b.scaledStorageCapacity : (def.energyStorageCapacity || 0);
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
    // Enemy shape drawing functions
    // Each takes (ctx, x, y, r, anim, angle, color) where angle is movement direction
    // ------------------------------------------------------------------------

    function _getMoveAngle(e) {
        if (e.path && e.pathIndex < e.path.length) {
            var t = e.path[e.pathIndex];
            return Math.atan2(t.y - e.y, t.x - e.x);
        }
        return 0;
    }

    // ⚡ Spark — 4-pointed rotating star
    function _drawSpark(ctx, x, y, r, anim, angle) {
        var rot = anim * 0.05;
        ctx.fillStyle = '#ffee00';
        ctx.beginPath();
        for (var i = 0; i < 4; i++) {
            var a = rot + i * Math.PI / 2;
            ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
            var b = a + Math.PI / 4;
            ctx.lineTo(x + Math.cos(b) * r * 0.4, y + Math.sin(b) * r * 0.4);
        }
        ctx.closePath();
        ctx.fill();
        // White center
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.2, 0, Math.PI * 2);
        ctx.fill();
    }

    // 💨 Runner — elongated diamond pointing in direction
    function _drawRunner(ctx, x, y, r, anim, angle) {
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        ctx.fillStyle = '#ff8800';
        ctx.beginPath();
        ctx.moveTo(x + cos * r * 1.4, y + sin * r * 1.4);           // front tip
        ctx.lineTo(x + (-sin) * r * 0.5, y + cos * r * 0.5);        // left
        ctx.lineTo(x - cos * r * 0.8, y - sin * r * 0.8);           // rear
        ctx.lineTo(x + sin * r * 0.5, y - cos * r * 0.5);           // right
        ctx.closePath();
        ctx.fill();
        // Speed lines
        ctx.strokeStyle = 'rgba(255,136,0,0.4)';
        ctx.lineWidth = 1;
        for (var sl = 1; sl <= 2; sl++) {
            var off = sl * 4 + (anim % 6);
            ctx.beginPath();
            ctx.moveTo(x - cos * (r + off) + (-sin) * sl * 3, y - sin * (r + off) + cos * sl * 3);
            ctx.lineTo(x - cos * (r + off + 5) + (-sin) * sl * 3, y - sin * (r + off + 5) + cos * sl * 3);
            ctx.stroke();
        }
    }

    // 👹 Grunt — pentagon with eyes
    function _drawGrunt(ctx, x, y, r, anim, angle) {
        ctx.fillStyle = '#cc3333';
        ctx.beginPath();
        for (var i = 0; i < 5; i++) {
            var a = -Math.PI / 2 + i * Math.PI * 2 / 5;
            ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#881111';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Eyes
        ctx.fillStyle = '#ffcccc';
        ctx.beginPath();
        ctx.arc(x - r * 0.25, y - r * 0.15, 1.5, 0, Math.PI * 2);
        ctx.arc(x + r * 0.25, y - r * 0.15, 1.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // 🐝 Swarm — tiny oval with oscillating wings
    function _drawSwarm(ctx, x, y, r, anim, angle) {
        // Body
        ctx.fillStyle = '#ffaa00';
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.7, angle, 0, Math.PI * 2);
        ctx.fill();
        // Stripes
        ctx.strokeStyle = '#664400';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 1, y - r * 0.5);
        ctx.lineTo(x - 1, y + r * 0.5);
        ctx.moveTo(x + 1, y - r * 0.5);
        ctx.lineTo(x + 1, y + r * 0.5);
        ctx.stroke();
        // Wings
        var wingFlap = Math.sin(anim * 0.3) * 0.3;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.ellipse(x - 2, y - r * 0.3, r * 0.5, r * 0.3, wingFlap, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x + 2, y - r * 0.3, r * 0.5, r * 0.3, -wingFlap, 0, Math.PI * 2);
        ctx.fill();
    }

    // 🛡️ Shielded Grunt — pentagon with forward shield arc
    function _drawShieldedGrunt(ctx, x, y, r, anim, angle) {
        // Body (pentagon)
        ctx.fillStyle = '#6666cc';
        ctx.beginPath();
        for (var i = 0; i < 5; i++) {
            var a = -Math.PI / 2 + i * Math.PI * 2 / 5;
            ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#333388';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Shield arc on front
        ctx.strokeStyle = '#aaaaff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 3, angle - 0.8, angle + 0.8);
        ctx.stroke();
        // Shield shimmer
        if (anim % 30 < 15) {
            ctx.strokeStyle = 'rgba(200,200,255,0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x, y, r + 4, angle - 0.4, angle + 0.4);
            ctx.stroke();
        }
    }

    // 🐢 Tank — hexagon with thick outline
    function _drawTank(ctx, x, y, r, anim, angle) {
        ctx.fillStyle = '#883333';
        ctx.beginPath();
        for (var i = 0; i < 6; i++) {
            var a = i * Math.PI / 3;
            ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#551111';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        // Inner lighter hexagon
        ctx.fillStyle = '#994444';
        ctx.beginPath();
        for (var j = 0; j < 6; j++) {
            var a2 = j * Math.PI / 3;
            ctx.lineTo(x + Math.cos(a2) * r * 0.5, y + Math.sin(a2) * r * 0.5);
        }
        ctx.closePath();
        ctx.fill();
        // Center cross
        ctx.strokeStyle = '#551111';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.3, y);
        ctx.lineTo(x + r * 0.3, y);
        ctx.moveTo(x, y - r * 0.3);
        ctx.lineTo(x, y + r * 0.3);
        ctx.stroke();
    }

    // 🦏 Heavy Tank — octagon with chevron
    function _drawHeavyTank(ctx, x, y, r, anim, angle) {
        ctx.fillStyle = '#661111';
        ctx.beginPath();
        for (var i = 0; i < 8; i++) {
            var a = i * Math.PI / 4;
            ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#330000';
        ctx.lineWidth = 3;
        ctx.stroke();
        // Chevron pointing forward
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        ctx.strokeStyle = '#993333';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - sin * r * 0.4 - cos * r * 0.2, y + cos * r * 0.4 - sin * r * 0.2);
        ctx.lineTo(x + cos * r * 0.4, y + sin * r * 0.4);
        ctx.lineTo(x + sin * r * 0.4 - cos * r * 0.2, y - cos * r * 0.4 - sin * r * 0.2);
        ctx.stroke();
    }

    // 🏰 Siege Engine — large rounded square with turret
    function _drawSiegeEngine(ctx, x, y, r, anim, angle) {
        // Base (rounded rect approximation)
        var s = r * 0.85;
        ctx.fillStyle = '#441111';
        ctx.beginPath();
        ctx.moveTo(x - s, y - s + 3);
        ctx.lineTo(x - s, y + s - 3);
        ctx.quadraticCurveTo(x - s, y + s, x - s + 3, y + s);
        ctx.lineTo(x + s - 3, y + s);
        ctx.quadraticCurveTo(x + s, y + s, x + s, y + s - 3);
        ctx.lineTo(x + s, y - s + 3);
        ctx.quadraticCurveTo(x + s, y - s, x + s - 3, y - s);
        ctx.lineTo(x - s + 3, y - s);
        ctx.quadraticCurveTo(x - s, y - s, x - s, y - s + 3);
        ctx.fill();
        ctx.strokeStyle = '#220000';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Turret
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        ctx.fillStyle = '#662222';
        ctx.beginPath();
        ctx.arc(x + cos * r * 0.2, y + sin * r * 0.2, r * 0.35, 0, Math.PI * 2);
        ctx.fill();
        // Barrel
        ctx.strokeStyle = '#331111';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + cos * r * 0.2, y + sin * r * 0.2);
        ctx.lineTo(x + cos * r * 0.9, y + sin * r * 0.9);
        ctx.stroke();
        // Track lines
        ctx.strokeStyle = '#220000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - sin * s, y + cos * s);
        ctx.lineTo(x + sin * s, y - cos * s);
        ctx.stroke();
    }

    // 💣 Bomber — circle with fuse
    function _drawBomber(ctx, x, y, r, anim, angle) {
        var pulse = 1 + Math.sin(anim * 0.1) * 0.15;
        var pr = Math.floor(r * pulse);
        // Body
        ctx.fillStyle = '#cc6600';
        ctx.beginPath();
        ctx.arc(x, y, pr, 0, Math.PI * 2);
        ctx.fill();
        // Darker bottom
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.arc(x, y, pr, 0.1, Math.PI - 0.1);
        ctx.fill();
        // Fuse
        ctx.strokeStyle = '#884400';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y - pr);
        ctx.lineTo(x + 2, y - pr - 5);
        ctx.stroke();
        // Spark at fuse tip
        if (anim % 8 < 4) {
            ctx.fillStyle = '#ffff00';
            ctx.beginPath();
            ctx.arc(x + 2, y - pr - 5, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // 🐍 River Serpent — undulating segments
    function _drawRiverSerpent(ctx, x, y, r, anim, angle) {
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        ctx.fillStyle = '#228888';
        // 4 body segments
        for (var seg = 0; seg < 4; seg++) {
            var segR = r * (1 - seg * 0.15);
            var wave = Math.sin(anim * 0.12 + seg * 1.2) * 4;
            var sx = x - cos * seg * r * 0.7 + (-sin) * wave;
            var sy = y - sin * seg * r * 0.7 + cos * wave;
            ctx.beginPath();
            ctx.arc(sx, sy, segR, 0, Math.PI * 2);
            ctx.fill();
        }
        // Eyes on head
        ctx.fillStyle = '#aaffaa';
        ctx.beginPath();
        ctx.arc(x + cos * r * 0.3 - sin * 2, y + sin * r * 0.3 + cos * 2, 1.5, 0, Math.PI * 2);
        ctx.arc(x + cos * r * 0.3 + sin * 2, y + sin * r * 0.3 - cos * 2, 1.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // 🏚️ Home Wrecker — battering ram triangle
    function _drawHomeWrecker(ctx, x, y, r, anim, angle) {
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        ctx.fillStyle = '#996633';
        // Ram head (triangle)
        ctx.beginPath();
        ctx.moveTo(x + cos * r * 1.2, y + sin * r * 1.2);
        ctx.lineTo(x - cos * r * 0.5 - sin * r * 0.7, y - sin * r * 0.5 + cos * r * 0.7);
        ctx.lineTo(x - cos * r * 0.5 + sin * r * 0.7, y - sin * r * 0.5 - cos * r * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#664422';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Handle
        ctx.fillStyle = '#774411';
        ctx.fillRect(x - cos * r * 0.8 - 2, y - sin * r * 0.8 - 2, 4, 4);
    }

    // 🪱 Drill Worm — segmented worm with mandibles
    function _drawDrillWorm(ctx, x, y, r, anim, angle) {
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        ctx.fillStyle = '#997744';
        // 3 body segments with side-to-side wobble
        for (var seg = 0; seg < 3; seg++) {
            var segR = r * (1 - seg * 0.2);
            var wobble = Math.sin(anim * 0.1 + seg * 1.5) * 2;
            var sx = x - cos * seg * r * 0.8 + (-sin) * wobble;
            var sy = y - sin * seg * r * 0.8 + cos * wobble;
            ctx.beginPath();
            ctx.arc(sx, sy, segR, 0, Math.PI * 2);
            ctx.fill();
        }
        // Mandibles (V at front)
        ctx.strokeStyle = '#664422';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + cos * r * 0.5 - sin * r * 0.5, y + sin * r * 0.5 + cos * r * 0.5);
        ctx.lineTo(x + cos * r * 1.2, y + sin * r * 1.2);
        ctx.moveTo(x + cos * r * 0.5 + sin * r * 0.5, y + sin * r * 0.5 - cos * r * 0.5);
        ctx.lineTo(x + cos * r * 1.2, y + sin * r * 1.2);
        ctx.stroke();
    }

    // 💥 Disruptor — 6-pointed spiky star
    function _drawDisruptor(ctx, x, y, r, anim, angle) {
        ctx.fillStyle = '#aa44aa';
        ctx.beginPath();
        for (var i = 0; i < 6; i++) {
            var a = i * Math.PI / 3;
            ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
            var b = a + Math.PI / 6;
            ctx.lineTo(x + Math.cos(b) * r * 0.45, y + Math.sin(b) * r * 0.45);
        }
        ctx.closePath();
        ctx.fill();
        // Pulse rings
        if (anim % 30 < 10) {
            var ringR = r * (1.2 + (anim % 30) * 0.08);
            ctx.strokeStyle = 'rgba(170,68,170,0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x, y, ringR, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // 🔋 Leech — teardrop with mouth
    function _drawLeech(ctx, x, y, r, anim, angle) {
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        // Teardrop body
        ctx.fillStyle = '#44aa44';
        ctx.beginPath();
        ctx.moveTo(x + cos * r * 1.2, y + sin * r * 1.2);   // front point
        ctx.quadraticCurveTo(x - sin * r * 0.9, y + cos * r * 0.9, x - cos * r * 0.7, y - sin * r * 0.7);
        ctx.arc(x - cos * r * 0.2, y - sin * r * 0.2, r * 0.6, Math.PI + angle, angle, true);
        ctx.quadraticCurveTo(x + sin * r * 0.9, y - cos * r * 0.9, x + cos * r * 1.2, y + sin * r * 1.2);
        ctx.fill();
        // Mouth ring
        ctx.strokeStyle = '#226622';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x + cos * r * 0.8, y + sin * r * 0.8, r * 0.3, 0, Math.PI * 2);
        ctx.stroke();
        // Green pulse glow
        if (anim % 20 < 10) {
            ctx.fillStyle = 'rgba(68,170,68,0.2)';
            ctx.beginPath();
            ctx.arc(x, y, r * 1.3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // 🚫 Nullifier — circle with X
    function _drawNullifier(ctx, x, y, r, anim, angle) {
        ctx.fillStyle = '#aa2222';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        // X lines
        var glowAlpha = 0.6 + Math.sin(anim * 0.08) * 0.3;
        ctx.strokeStyle = 'rgba(255,100,100,' + glowAlpha + ')';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.6, y - r * 0.6);
        ctx.lineTo(x + r * 0.6, y + r * 0.6);
        ctx.moveTo(x + r * 0.6, y - r * 0.6);
        ctx.lineTo(x - r * 0.6, y + r * 0.6);
        ctx.stroke();
        // Outer ring
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 1, 0, Math.PI * 2);
        ctx.stroke();
    }

    // 🕵️ Saboteur — cloaked figure
    function _drawSaboteur(ctx, x, y, r, anim, angle) {
        ctx.globalAlpha = (ctx.globalAlpha || 1) * 0.7;
        // Hood (triangle)
        ctx.fillStyle = '#996633';
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x - r * 0.8, y + r * 0.6);
        ctx.lineTo(x + r * 0.8, y + r * 0.6);
        ctx.closePath();
        ctx.fill();
        // Body below
        ctx.fillStyle = '#775522';
        ctx.fillRect(x - r * 0.4, y + r * 0.2, r * 0.8, r * 0.6);
        // Eyes
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath();
        ctx.arc(x - r * 0.2, y - r * 0.1, 1.5, 0, Math.PI * 2);
        ctx.arc(x + r * 0.2, y - r * 0.1, 1.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // 🤖 EMP Drone — diamond with antenna
    function _drawEMPDrone(ctx, x, y, r, anim, angle) {
        // Diamond body
        ctx.fillStyle = '#33ccff';
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#1188aa';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Antenna
        ctx.strokeStyle = '#88eeff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x, y - r - 5);
        ctx.stroke();
        // Blink at tip
        if (anim % 20 < 10) {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(x, y - r - 5, 2, 0, Math.PI * 2);
            ctx.fill();
        }
        // Electric arcs
        if (anim % 30 < 5) {
            ctx.strokeStyle = 'rgba(100,220,255,0.6)';
            ctx.lineWidth = 1;
            for (var ea = 0; ea < 3; ea++) {
                var ea_angle = (ea / 3) * Math.PI * 2 + anim * 0.1;
                ctx.beginPath();
                ctx.moveTo(x + Math.cos(ea_angle) * r, y + Math.sin(ea_angle) * r);
                ctx.lineTo(x + Math.cos(ea_angle) * (r + 6), y + Math.sin(ea_angle) * (r + 6));
                ctx.stroke();
            }
        }
    }

    // 👻 Phase Walker — ghost with wavy bottom
    function _drawPhaseWalker(ctx, x, y, r, anim, angle) {
        // Head (oval top)
        ctx.fillStyle = '#aa44ff';
        ctx.beginPath();
        ctx.arc(x, y - r * 0.2, r * 0.8, Math.PI, 0);
        // Wavy bottom
        var segments = 5;
        var bottomY = y + r * 0.6;
        for (var ws = 0; ws <= segments; ws++) {
            var wx = x - r * 0.8 + (ws / segments) * r * 1.6;
            var wy = bottomY + Math.sin(anim * 0.15 + ws * 1.2) * 3;
            if (ws === 0) {
                ctx.lineTo(wx, wy);
            } else {
                ctx.lineTo(wx, wy);
            }
        }
        ctx.closePath();
        ctx.fill();
        // Eyes
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x - r * 0.25, y - r * 0.3, 2, 0, Math.PI * 2);
        ctx.arc(x + r * 0.25, y - r * 0.3, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    // 📡 Jammer — circle with radar dish and rings
    function _drawJammer(ctx, x, y, r, anim, angle) {
        // Body
        ctx.fillStyle = '#669966';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        // Dish on top
        ctx.strokeStyle = '#88bb88';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y - r * 0.3, r * 0.5, Math.PI + 0.5, -0.5);
        ctx.stroke();
        // Antenna post
        ctx.strokeStyle = '#88bb88';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y - r * 0.3);
        ctx.lineTo(x, y - r - 3);
        ctx.stroke();
        // Pulse rings
        var ringPhase = anim % 40;
        if (ringPhase < 20) {
            var ringR = r * (1.2 + ringPhase * 0.06);
            ctx.strokeStyle = 'rgba(102,153,102,' + (0.5 - ringPhase * 0.025) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x, y, ringR, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // 🛸 Scout Drone — small triangular craft
    function _drawScoutDrone(ctx, x, y, r, anim, angle) {
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        ctx.fillStyle = '#99ddff';
        ctx.beginPath();
        ctx.moveTo(x + cos * r * 1.3, y + sin * r * 1.3);          // nose
        ctx.lineTo(x - cos * r * 0.6 - sin * r * 0.8, y - sin * r * 0.6 + cos * r * 0.8);  // left wing
        ctx.lineTo(x - cos * r * 0.3, y - sin * r * 0.3);           // rear center
        ctx.lineTo(x - cos * r * 0.6 + sin * r * 0.8, y - sin * r * 0.6 - cos * r * 0.8);  // right wing
        ctx.closePath();
        ctx.fill();
        // Engine glow
        ctx.fillStyle = anim % 6 < 3 ? '#ffaa44' : '#ff6622';
        ctx.beginPath();
        ctx.arc(x - cos * r * 0.4 - sin * r * 0.3, y - sin * r * 0.4 + cos * r * 0.3, 1.5, 0, Math.PI * 2);
        ctx.arc(x - cos * r * 0.4 + sin * r * 0.3, y - sin * r * 0.4 - cos * r * 0.3, 1.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // 🦅 Heavy Flyer — wide chevron/wing shape
    function _drawHeavyFlyer(ctx, x, y, r, anim, angle) {
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        ctx.fillStyle = '#556688';
        ctx.beginPath();
        ctx.moveTo(x + cos * r * 1.0, y + sin * r * 1.0);             // nose
        ctx.lineTo(x - cos * r * 0.4 - sin * r * 1.2, y - sin * r * 0.4 + cos * r * 1.2);  // left wingtip
        ctx.lineTo(x - cos * r * 0.6 - sin * r * 0.3, y - sin * r * 0.6 + cos * r * 0.3);  // left inner
        ctx.lineTo(x - cos * r * 0.7, y - sin * r * 0.7);              // tail
        ctx.lineTo(x - cos * r * 0.6 + sin * r * 0.3, y - sin * r * 0.6 - cos * r * 0.3);  // right inner
        ctx.lineTo(x - cos * r * 0.4 + sin * r * 1.2, y - sin * r * 0.4 - cos * r * 1.2);  // right wingtip
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#334455';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Center body ridge
        ctx.strokeStyle = '#667799';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + cos * r * 0.6, y + sin * r * 0.6);
        ctx.lineTo(x - cos * r * 0.5, y - sin * r * 0.5);
        ctx.stroke();
    }

    // 🐛 Tunneler — oval with drill front
    function _drawTunneler(ctx, x, y, r, anim, angle) {
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        // Oval body
        ctx.fillStyle = '#8b5a2b';
        ctx.beginPath();
        ctx.ellipse(x - cos * r * 0.15, y - sin * r * 0.15, r, r * 0.7, angle, 0, Math.PI * 2);
        ctx.fill();
        // Drill tip
        ctx.fillStyle = '#aa7744';
        ctx.beginPath();
        ctx.moveTo(x + cos * r * 1.1, y + sin * r * 1.1);
        ctx.lineTo(x + cos * r * 0.5 - sin * r * 0.4, y + sin * r * 0.5 + cos * r * 0.4);
        ctx.lineTo(x + cos * r * 0.5 + sin * r * 0.4, y + sin * r * 0.5 - cos * r * 0.4);
        ctx.closePath();
        ctx.fill();
        // Mandible arcs
        var mandibleOpen = Math.sin(anim * 0.15) * 0.2;
        ctx.strokeStyle = '#664422';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x + cos * r * 0.6, y + sin * r * 0.6, r * 0.4, angle - 0.8 - mandibleOpen, angle - 0.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + cos * r * 0.6, y + sin * r * 0.6, r * 0.4, angle + 0.2, angle + 0.8 + mandibleOpen);
        ctx.stroke();
    }

    // ⚡👑 Overload Boss — hexagon with crown
    function _drawOverloadBoss(ctx, x, y, r, anim, angle) {
        // Hexagonal body
        ctx.fillStyle = '#443388';
        ctx.beginPath();
        for (var i = 0; i < 6; i++) {
            var a = i * Math.PI / 3;
            ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#221166';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Crown (3 zigzag points on top)
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.6, y - r * 0.5);
        ctx.lineTo(x - r * 0.35, y - r * 0.9);
        ctx.lineTo(x - r * 0.1, y - r * 0.5);
        ctx.lineTo(x + r * 0.15, y - r * 1.0);
        ctx.lineTo(x + r * 0.35, y - r * 0.5);
        ctx.lineTo(x + r * 0.55, y - r * 0.85);
        ctx.lineTo(x + r * 0.7, y - r * 0.5);
        ctx.closePath();
        ctx.fill();
        // Electric arcs between crown points
        if (anim % 10 < 5) {
            ctx.strokeStyle = '#aaccff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x - r * 0.35, y - r * 0.9);
            ctx.lineTo(x + r * 0.15, y - r * 1.0);
            ctx.lineTo(x + r * 0.55, y - r * 0.85);
            ctx.stroke();
        }
        // Inner energy swirl
        var rot = anim * 0.03;
        ctx.strokeStyle = 'rgba(170,200,255,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.5, rot, rot + Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.5, rot + Math.PI, rot + Math.PI * 2);
        ctx.stroke();
    }

    // Wall breaker — square-ish with ram
    function _drawWallBreaker(ctx, x, y, r, anim, angle) {
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        // Blocky body
        ctx.fillStyle = '#886644';
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillRect(-r * 0.7, -r * 0.6, r * 1.4, r * 1.2);
        ctx.strokeStyle = '#553322';
        ctx.lineWidth = 2;
        ctx.strokeRect(-r * 0.7, -r * 0.6, r * 1.4, r * 1.2);
        // Ram (reinforced front)
        ctx.fillStyle = '#aa8855';
        ctx.fillRect(r * 0.5, -r * 0.4, r * 0.5, r * 0.8);
        ctx.restore();
    }

    // ---- Ranged Enemy Draw Functions ----

    function _drawZapper(ctx, x, y, r, anim, angle) {
        ctx.save();
        ctx.translate(x, y);
        if (angle) ctx.rotate(angle);
        // Body: small electric green diamond
        ctx.fillStyle = '#33ff99';
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.7, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r * 0.7, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#00cc66';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Electric spark on top
        var sparkLen = r * 0.5 + Math.sin(anim * 0.3) * r * 0.2;
        ctx.strokeStyle = '#aaffcc';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-sparkLen, -r * 0.3);
        ctx.lineTo(0, -r * 0.6);
        ctx.lineTo(sparkLen, -r * 0.3);
        ctx.stroke();
        // Eye
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, -r * 0.1, r * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function _drawPlasmaParasite(ctx, x, y, r, anim, angle) {
        ctx.save();
        ctx.translate(x, y);
        // Pulsating body
        var pulse = 1 + Math.sin(anim * 0.15) * 0.15;
        var pr = r * pulse;
        // Outer membrane
        ctx.fillStyle = 'rgba(255, 50, 255, 0.3)';
        ctx.beginPath();
        ctx.arc(0, 0, pr + 3, 0, Math.PI * 2);
        ctx.fill();
        // Body
        ctx.fillStyle = '#cc22cc';
        ctx.beginPath();
        ctx.arc(0, 0, pr, 0, Math.PI * 2);
        ctx.fill();
        // Nucleus
        ctx.fillStyle = '#ff88ff';
        ctx.beginPath();
        ctx.arc(Math.sin(anim * 0.1) * 2, Math.cos(anim * 0.12) * 2, pr * 0.4, 0, Math.PI * 2);
        ctx.fill();
        // Tendrils
        ctx.strokeStyle = 'rgba(255, 100, 255, 0.6)';
        ctx.lineWidth = 1;
        for (var t = 0; t < 4; t++) {
            var ta = (t / 4) * Math.PI * 2 + anim * 0.05;
            ctx.beginPath();
            ctx.moveTo(Math.cos(ta) * pr, Math.sin(ta) * pr);
            ctx.lineTo(Math.cos(ta) * (pr + 6), Math.sin(ta) * (pr + 6));
            ctx.stroke();
        }
        ctx.restore();
    }

    function _drawEMPSniper(ctx, x, y, r, anim, angle) {
        ctx.save();
        ctx.translate(x, y);
        if (angle) ctx.rotate(angle);
        // Body: angular armored shape
        ctx.fillStyle = '#225599';
        ctx.beginPath();
        ctx.moveTo(-r, r * 0.5);
        ctx.lineTo(-r * 0.3, -r);
        ctx.lineTo(r * 0.3, -r);
        ctx.lineTo(r, r * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#3399ff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Barrel/antenna
        ctx.strokeStyle = '#66bbff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(0, -r * 1.8);
        ctx.stroke();
        // EMP tip glow
        var glow = 0.5 + Math.sin(anim * 0.2) * 0.3;
        ctx.fillStyle = 'rgba(100, 200, 255, ' + glow + ')';
        ctx.beginPath();
        ctx.arc(0, -r * 1.8, 3, 0, Math.PI * 2);
        ctx.fill();
        // Scope lens
        ctx.fillStyle = '#ff3333';
        ctx.beginPath();
        ctx.arc(0, -r * 0.3, r * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // 💣 Flying Bomber — large bomber plane shape with bomb bay
    // ---- Mirror Sentinel ----
    function _drawMirrorSentinel(ctx, x, y, r, anim, angle) {
        // Body: armored hexagonal shape
        ctx.fillStyle = '#88bbdd';
        ctx.beginPath();
        for (var hi = 0; hi < 6; hi++) {
            var ha = (hi / 6) * Math.PI * 2 + angle;
            var hx = x + Math.cos(ha) * r * 0.9;
            var hy = y + Math.sin(ha) * r * 0.9;
            if (hi === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#4488aa';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Reflective shield shimmer
        var shimmer = 0.3 + Math.sin(anim * 0.12) * 0.2;
        ctx.strokeStyle = 'rgba(200, 230, 255, ' + shimmer + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.3, 0, Math.PI * 2);
        ctx.stroke();
        // Mirror center
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
        ctx.fill();
    }

    // ---- Swarm Mother ----
    function _drawSwarmMother(ctx, x, y, r, anim, angle) {
        // Large insectoid body
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.1, r * 0.7, angle, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#996600';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Wings (translucent, flapping)
        var wingFlap = Math.sin(anim * 0.3) * 0.3;
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        ctx.fillStyle = 'rgba(255, 220, 100, 0.3)';
        ctx.beginPath();
        ctx.ellipse(x - sin * r * (0.8 + wingFlap), y + cos * r * (0.8 + wingFlap), r * 0.9, r * 0.3, angle + 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x + sin * r * (0.8 + wingFlap), y - cos * r * (0.8 + wingFlap), r * 0.9, r * 0.3, angle - 0.5, 0, Math.PI * 2);
        ctx.fill();
        // Crown mark (boss)
        ctx.fillStyle = '#ff6600';
        ctx.beginPath();
        ctx.arc(x + cos * r * 0.4, y + sin * r * 0.4, r * 0.25, 0, Math.PI * 2);
        ctx.fill();
        // Abdomen segments
        ctx.strokeStyle = '#cc9900';
        ctx.lineWidth = 1;
        for (var seg = 0; seg < 3; seg++) {
            var sx = x - cos * r * (0.2 + seg * 0.25);
            var sy = y - sin * r * (0.2 + seg * 0.25);
            ctx.beginPath();
            ctx.moveTo(sx - sin * r * 0.5, sy + cos * r * 0.5);
            ctx.lineTo(sx + sin * r * 0.5, sy - cos * r * 0.5);
            ctx.stroke();
        }
    }

    // ---- Quake Titan ----
    function _drawQuakeTitan(ctx, x, y, r, anim, angle, enemy) {
        var jumpScale = 1.0;
        if (enemy && enemy.isJumping) {
            jumpScale = 1.3; // bulge when jumping
        }
        // Massive rocky body
        ctx.fillStyle = '#994422';
        ctx.beginPath();
        ctx.moveTo(x, y - r * jumpScale);
        ctx.lineTo(x + r * 0.8 * jumpScale, y - r * 0.3 * jumpScale);
        ctx.lineTo(x + r * jumpScale, y + r * 0.4 * jumpScale);
        ctx.lineTo(x + r * 0.5 * jumpScale, y + r * jumpScale);
        ctx.lineTo(x - r * 0.5 * jumpScale, y + r * jumpScale);
        ctx.lineTo(x - r * jumpScale, y + r * 0.4 * jumpScale);
        ctx.lineTo(x - r * 0.8 * jumpScale, y - r * 0.3 * jumpScale);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#552211';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Cracks/lava veins
        ctx.strokeStyle = '#ff6600';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.3, y - r * 0.5);
        ctx.lineTo(x + r * 0.1, y);
        ctx.lineTo(x - r * 0.2, y + r * 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + r * 0.4, y - r * 0.3);
        ctx.lineTo(x + r * 0.1, y + r * 0.2);
        ctx.stroke();
        // Glowing eyes
        ctx.fillStyle = '#ffaa00';
        ctx.beginPath();
        ctx.arc(x - r * 0.25, y - r * 0.3, r * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + r * 0.25, y - r * 0.3, r * 0.12, 0, Math.PI * 2);
        ctx.fill();
        // Shockwave ring when jumping
        if (enemy && enemy.isJumping) {
            var ringAlpha = 0.6;
            ctx.strokeStyle = 'rgba(255, 120, 0, ' + ringAlpha + ')';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // ---- The Nexus ----
    function _drawTheNexus(ctx, x, y, r, anim, angle, enemy) {
        // Swirling void center
        var pulse = 0.7 + Math.sin(anim * 0.08) * 0.3;
        var gradient = ctx.createRadialGradient(x, y, 0, x, y, r * 1.2);
        gradient.addColorStop(0, 'rgba(170, 0, 255, ' + pulse + ')');
        gradient.addColorStop(0.5, 'rgba(80, 0, 150, 0.4)');
        gradient.addColorStop(1, 'rgba(30, 0, 60, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.2, 0, Math.PI * 2);
        ctx.fill();
        // Rotating rings
        ctx.strokeStyle = '#cc66ff';
        ctx.lineWidth = 2;
        for (var ring = 0; ring < 3; ring++) {
            var rAngle = anim * 0.05 * (ring + 1) + ring * (Math.PI * 2 / 3);
            ctx.beginPath();
            ctx.ellipse(x, y, r * (0.6 + ring * 0.25), r * (0.3 + ring * 0.1), rAngle, 0, Math.PI * 2);
            ctx.stroke();
        }
        // Central eye
        ctx.fillStyle = '#ff00ff';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.1, 0, Math.PI * 2);
        ctx.fill();
        // Nexus laser beams (drawn from nexusLaserTargets)
        if (enemy && enemy.nexusLaserTargets && enemy.nexusLaserTargets.length > 0) {
            for (var li = 0; li < enemy.nexusLaserTargets.length; li++) {
                var lt = enemy.nexusLaserTargets[li];
                var ltX = Math.floor(lt.x);
                var ltY = Math.floor(lt.y);
                ctx.strokeStyle = lt.isShield ? 'rgba(255, 100, 100, 0.6)' : 'rgba(170, 0, 255, 0.4)';
                ctx.lineWidth = lt.isShield ? 2 : 1;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(ltX, ltY);
                ctx.stroke();
            }
        }
    }

    function _drawFlyingBomber(ctx, x, y, r, anim, angle) {
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        // Fuselage
        ctx.fillStyle = '#885522';
        ctx.beginPath();
        ctx.moveTo(x + cos * r * 1.1, y + sin * r * 1.1);             // nose
        ctx.lineTo(x - cos * r * 0.3 - sin * r * 1.4, y - sin * r * 0.3 + cos * r * 1.4);  // left wingtip
        ctx.lineTo(x - cos * r * 0.5 - sin * r * 0.4, y - sin * r * 0.5 + cos * r * 0.4);  // left inner
        ctx.lineTo(x - cos * r * 0.9, y - sin * r * 0.9);              // tail
        ctx.lineTo(x - cos * r * 0.5 + sin * r * 0.4, y - sin * r * 0.5 - cos * r * 0.4);  // right inner
        ctx.lineTo(x - cos * r * 0.3 + sin * r * 1.4, y - sin * r * 0.3 - cos * r * 1.4);  // right wingtip
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#553311';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Bomb bay (dark center)
        ctx.fillStyle = '#332211';
        ctx.beginPath();
        ctx.ellipse(x, y, r * 0.35, r * 0.2, angle, 0, Math.PI * 2);
        ctx.fill();
        // Engine glow
        var glow = 0.5 + Math.sin(anim * 0.15) * 0.3;
        ctx.fillStyle = 'rgba(255, 150, 50, ' + glow + ')';
        ctx.beginPath();
        ctx.arc(x - cos * r * 0.7 - sin * r * 0.5, y - sin * r * 0.7 + cos * r * 0.5, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x - cos * r * 0.7 + sin * r * 0.5, y - sin * r * 0.7 - cos * r * 0.5, 3, 0, Math.PI * 2);
        ctx.fill();
        // Tail fins
        ctx.strokeStyle = '#aa7744';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - cos * r * 0.7, y - sin * r * 0.7);
        ctx.lineTo(x - cos * r * 0.9 - sin * r * 0.5, y - sin * r * 0.9 + cos * r * 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - cos * r * 0.7, y - sin * r * 0.7);
        ctx.lineTo(x - cos * r * 0.9 + sin * r * 0.5, y - sin * r * 0.9 - cos * r * 0.5);
        ctx.stroke();
    }

    // ---- Ranged Effect Rendering ----

    function _drawRangedEffects(ctx) {
        if (typeof Enemies === 'undefined' || !Enemies.getRangedEffects) return;
        var effects = Enemies.getRangedEffects();
        if (!effects || !effects.length) return;
        var useShadows = _shadowsEnabled();

        for (var i = 0; i < effects.length; i++) {
            var fx = effects[i];
            var progress = 1 - (fx.timer / fx.maxTimer);
            var alpha = fx.timer / fx.maxTimer;

            if (fx.type === 'zapper_beam') {
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = '#33ff99';
                ctx.lineWidth = 2;
                if (useShadows) {
                    ctx.shadowBlur = 6;
                    ctx.shadowColor = '#33ff99';
                }
                ctx.beginPath();
                ctx.moveTo(Math.floor(fx.fromX), Math.floor(fx.fromY));
                // Jagged beam: add zigzag points
                var zdx = fx.toX - fx.fromX;
                var zdy = fx.toY - fx.fromY;
                var segments = 5;
                for (var s = 1; s < segments; s++) {
                    var t = s / segments;
                    var mx = fx.fromX + zdx * t + (Math.random() - 0.5) * 8;
                    var my = fx.fromY + zdy * t + (Math.random() - 0.5) * 8;
                    ctx.lineTo(Math.floor(mx), Math.floor(my));
                }
                ctx.lineTo(Math.floor(fx.toX), Math.floor(fx.toY));
                ctx.stroke();
                // Impact flash
                ctx.fillStyle = '#aaffcc';
                ctx.beginPath();
                ctx.arc(Math.floor(fx.toX), Math.floor(fx.toY), 4 * alpha, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();

            } else if (fx.type === 'plasma_drain' || fx.type === 'plasma_drain_idle') {
                // Energy flowing from building to parasite
                ctx.save();
                var drainAlpha = fx.type === 'plasma_drain_idle' ? 0.2 : alpha * 0.7;
                ctx.globalAlpha = drainAlpha;
                // Draw flowing particles along the beam
                var pdx = fx.toX - fx.fromX;
                var pdy = fx.toY - fx.fromY;
                var pDist = Math.sqrt(pdx * pdx + pdy * pdy);
                if (pDist > 0) {
                    // Beam
                    ctx.strokeStyle = 'rgba(255, 100, 255, 0.5)';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(Math.floor(fx.fromX), Math.floor(fx.fromY));
                    ctx.lineTo(Math.floor(fx.toX), Math.floor(fx.toY));
                    ctx.stroke();
                    // Flowing energy particles (3 particles along beam)
                    for (var p = 0; p < 3; p++) {
                        var pt = ((progress * 3 + p) / 3) % 1;
                        var px = fx.fromX + pdx * pt;
                        var py = fx.fromY + pdy * pt;
                        var pSize = 3 - pt * 2;
                        ctx.fillStyle = '#ff88ff';
                        if (useShadows) {
                            ctx.shadowBlur = 4;
                            ctx.shadowColor = '#ff44ff';
                        }
                        ctx.beginPath();
                        ctx.arc(Math.floor(px), Math.floor(py), pSize, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                ctx.restore();

            } else if (fx.type === 'plasma_charge') {
                // Supercharge burst effect
                ctx.save();
                ctx.globalAlpha = alpha;
                var chargeR = 20 * progress;
                ctx.strokeStyle = '#ff00ff';
                ctx.lineWidth = 3;
                if (useShadows) {
                    ctx.shadowBlur = 12;
                    ctx.shadowColor = '#ff00ff';
                }
                ctx.beginPath();
                ctx.arc(Math.floor(fx.fromX), Math.floor(fx.fromY), chargeR, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = 'rgba(255, 0, 255, 0.2)';
                ctx.beginPath();
                ctx.arc(Math.floor(fx.fromX), Math.floor(fx.fromY), chargeR * 0.6, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();

            } else if (fx.type === 'emp_missile') {
                // Electric missile traveling from enemy to building
                ctx.save();
                var emDx = fx.toX - fx.fromX;
                var emDy = fx.toY - fx.fromY;
                var emX = fx.fromX + emDx * progress;
                var emY = fx.fromY + emDy * progress;
                // Trail
                ctx.strokeStyle = 'rgba(50, 150, 255, 0.4)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(Math.floor(fx.fromX), Math.floor(fx.fromY));
                ctx.lineTo(Math.floor(emX), Math.floor(emY));
                ctx.stroke();
                // Missile body
                ctx.fillStyle = '#3399ff';
                if (useShadows) {
                    ctx.shadowBlur = 8;
                    ctx.shadowColor = '#66bbff';
                }
                ctx.beginPath();
                ctx.arc(Math.floor(emX), Math.floor(emY), 4, 0, Math.PI * 2);
                ctx.fill();
                // Electric crackle around missile
                ctx.strokeStyle = '#aaddff';
                ctx.lineWidth = 1;
                for (var c = 0; c < 3; c++) {
                    var ca = Math.random() * Math.PI * 2;
                    var cl = 5 + Math.random() * 5;
                    ctx.beginPath();
                    ctx.moveTo(Math.floor(emX), Math.floor(emY));
                    ctx.lineTo(Math.floor(emX + Math.cos(ca) * cl), Math.floor(emY + Math.sin(ca) * cl));
                    ctx.stroke();
                }
                // Impact on arrival
                if (progress > 0.85) {
                    var impactAlpha = (progress - 0.85) / 0.15;
                    ctx.fillStyle = 'rgba(100, 200, 255, ' + (impactAlpha * 0.5) + ')';
                    ctx.beginPath();
                    ctx.arc(Math.floor(fx.toX), Math.floor(fx.toY), 12 * impactAlpha, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            } else if (fx.type === 'bomb_drop') {
                // Bomb falling from flying bomber to target
                ctx.save();
                var bdx = fx.toX - fx.fromX;
                var bdy = fx.toY - fx.fromY;
                var bombX = fx.fromX + bdx * progress;
                var bombY = fx.fromY + bdy * progress + progress * 15;
                var bombSize = 3 + progress * 3;
                // Bomb body
                ctx.fillStyle = '#443322';
                ctx.beginPath();
                ctx.ellipse(Math.floor(bombX), Math.floor(bombY), bombSize, bombSize * 0.7, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#221100';
                ctx.lineWidth = 1;
                ctx.stroke();
                // Fuse spark
                var sparkAlpha = 0.6 + Math.sin(_animFrame * 0.5) * 0.4;
                ctx.fillStyle = 'rgba(255, 200, 50, ' + sparkAlpha + ')';
                ctx.beginPath();
                ctx.arc(Math.floor(bombX), Math.floor(bombY - bombSize), 2, 0, Math.PI * 2);
                ctx.fill();
                // Explosion on impact
                if (progress > 0.7) {
                    var expProgress = (progress - 0.7) / 0.3;
                    var expRadius = 8 + expProgress * 20;
                    var expAlpha = (1 - expProgress) * 0.8;
                    ctx.fillStyle = 'rgba(255, 120, 30, ' + expAlpha + ')';
                    ctx.beginPath();
                    ctx.arc(Math.floor(fx.toX), Math.floor(fx.toY), expRadius, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = 'rgba(255, 220, 100, ' + (expAlpha * 0.6) + ')';
                    ctx.beginPath();
                    ctx.arc(Math.floor(fx.toX), Math.floor(fx.toY), expRadius * 0.5, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            } else if (fx.type === 'quake_shockwave') {
                // Expanding shockwave from quake titan jump
                ctx.save();
                var shockRadius = fx.radius * progress;
                var shockAlpha = alpha * 0.6;
                ctx.strokeStyle = 'rgba(255, 120, 0, ' + shockAlpha + ')';
                ctx.lineWidth = 4 * alpha;
                ctx.beginPath();
                ctx.arc(Math.floor(fx.x), Math.floor(fx.y), shockRadius, 0, Math.PI * 2);
                ctx.stroke();
                // Inner ring
                ctx.strokeStyle = 'rgba(255, 200, 50, ' + (shockAlpha * 0.5) + ')';
                ctx.lineWidth = 2 * alpha;
                ctx.beginPath();
                ctx.arc(Math.floor(fx.x), Math.floor(fx.y), shockRadius * 0.6, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    // Lookup table for enemy draw functions
    var ENEMY_DRAW_FNS = {
        spark: _drawSpark,
        runner: _drawRunner,
        grunt: _drawGrunt,
        swarm: _drawSwarm,
        shielded_grunt: _drawShieldedGrunt,
        tank: _drawTank,
        heavy_tank: _drawHeavyTank,
        siege_engine: _drawSiegeEngine,
        bomber: _drawBomber,
        river_serpent: _drawRiverSerpent,
        home_wrecker: _drawHomeWrecker,
        drill_worm: _drawDrillWorm,
        disruptor: _drawDisruptor,
        leech: _drawLeech,
        nullifier: _drawNullifier,
        saboteur: _drawSaboteur,
        emp_drone: _drawEMPDrone,
        phase_walker: _drawPhaseWalker,
        jammer: _drawJammer,
        scout_drone: _drawScoutDrone,
        heavy_flyer: _drawHeavyFlyer,
        tunneler: _drawTunneler,
        overload_boss: _drawOverloadBoss,
        wall_breaker: _drawWallBreaker,
        zapper: _drawZapper,
        plasma_parasite: _drawPlasmaParasite,
        emp_sniper: _drawEMPSniper,
        flying_bomber: _drawFlyingBomber,
        mirror_sentinel: _drawMirrorSentinel,
        swarm_mother: _drawSwarmMother,
        quake_titan: _drawQuakeTitan,
        the_nexus: _drawTheNexus
    };

    // ------------------------------------------------------------------------
    // Layer: Enemies
    // ------------------------------------------------------------------------
    function _drawEnemies(ctx) {
        if (typeof Enemies === 'undefined' || !Enemies || typeof Enemies.getAll !== 'function') return;
        var all = Enemies.getAll();
        if (!all || !all.length) return;

        var i, e, r, color, hpRatio;
        var useShadows = _shadowsEnabled();

        // Precompute viewport bounds once
        var vw = Config.VIEWPORT_WIDTH / _zoom;
        var vh = Config.VIEWPORT_HEIGHT / _zoom;
        var vpLeft = _camera.x;
        var vpRight = _camera.x + vw;
        var vpTop = _camera.y;
        var vpBottom = _camera.y + vh;

        // Draw nexus shield auras first (behind enemies)
        for (i = 0; i < all.length; i++) {
            e = all[i];
            if (e.mechanic !== 'nexus' || e.hp <= 0) continue;
            if (e.x + 320 < vpLeft || e.x - 320 > vpRight || e.y + 320 < vpTop || e.y - 320 > vpBottom) continue;
            var shieldRadius = 300;
            var shimmer = 0.12 + Math.sin(_animFrame * 0.06) * 0.05;
            ctx.beginPath();
            ctx.arc(Math.floor(e.x), Math.floor(e.y), shieldRadius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(140, 60, 255, ' + shimmer + ')';
            ctx.fill();
            ctx.strokeStyle = 'rgba(170, 100, 255, 0.5)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.strokeStyle = 'rgba(200, 150, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(Math.floor(e.x), Math.floor(e.y), shieldRadius * 0.95, 0, Math.PI * 2);
            ctx.stroke();
        }

        var needsRestore;
        for (i = 0; i < all.length; i++) {
            e = all[i];
            if (e.hp <= 0) continue;
            if (e.x + 30 < vpLeft || e.x - 30 > vpRight || e.y + 30 < vpTop || e.y - 30 > vpBottom) continue;

            r = ENEMY_RADIUS[e.type] || ENEMY_RADIUS_DEFAULT;
            color = COLORS.ENEMY[e.type] || '#cc3333';

            needsRestore = false;

            // Phase walker: semi-transparent
            if (e.special === 'ignores_shields' || e.type === 'phase_walker') {
                ctx.globalAlpha = 0.5 + Math.sin(_animFrame * 0.15) * 0.2;
                needsRestore = true;
            }

            // Boss: larger size + golden glow
            if (e.isBoss) {
                r = Math.floor(r * 1.5);
                if (useShadows) {
                    ctx.shadowBlur = _reduceShadows ? 8 : 16;
                    ctx.shadowColor = '#ffd700';
                    needsRestore = true;
                }
            }

            // Stunned indicator
            if (e.stunTimer && e.stunTimer > 0) {
                ctx.globalAlpha = 0.6;
                needsRestore = true;
            }

            // Charged plasma parasite: bright glow
            if (e.charged && e.type === 'plasma_parasite') {
                if (useShadows) {
                    ctx.shadowBlur = _reduceShadows ? 7 : 14;
                    ctx.shadowColor = '#ff00ff';
                    needsRestore = true;
                }
            }

            // Flying bomber hovering/bombing: pulsing red glow
            if (e.isBombing && e.type === 'flying_bomber') {
                var bombGlow = 0.4 + Math.sin(_animFrame * 0.12) * 0.3;
                if (useShadows) {
                    ctx.shadowBlur = _reduceShadows ? 6 : 12;
                    ctx.shadowColor = 'rgba(255, 80, 20, ' + bombGlow + ')';
                    needsRestore = true;
                }
            }

            // Mirror sentinel reflection shield glow
            if (e.isReflecting && e.mechanic === 'reflects') {
                if (useShadows) {
                    ctx.shadowBlur = _reduceShadows ? 5 : 10;
                    ctx.shadowColor = '#88ddff';
                    needsRestore = true;
                }
                e.isReflecting = false;
            }

            // Overload boss draining/zapping glow
            if (e.mechanic === 'energy_drain') {
                if (useShadows) {
                    if (e.drainState === 'draining') {
                        var drainGlow = 0.5 + Math.sin(_animFrame * 0.15) * 0.3;
                        ctx.shadowBlur = _reduceShadows ? 9 : 18;
                        ctx.shadowColor = 'rgba(100, 150, 255, ' + drainGlow + ')';
                        needsRestore = true;
                    } else if (e.drainState === 'zapping') {
                        ctx.shadowBlur = _reduceShadows ? 12 : 24;
                        ctx.shadowColor = '#aaccff';
                        needsRestore = true;
                    } else if (e.drainState === 'charged') {
                        var chargeGlow = 0.6 + Math.sin(_animFrame * 0.2) * 0.4;
                        ctx.shadowBlur = _reduceShadows ? 11 : 22;
                        ctx.shadowColor = 'rgba(150, 200, 255, ' + chargeGlow + ')';
                        needsRestore = true;
                    }
                }
            }

            // Flying enemy: draw shadow underneath, then offset drawing upward
            var flyOffset = 0;
            var ejx = e.jitterX || 0;
            var ejy = e.jitterY || 0;
            if (e.special === 'flying') {
                // Shadow on the ground
                ctx.fillStyle = 'rgba(0,0,0,0.25)';
                ctx.beginPath();
                ctx.ellipse(Math.floor(e.x + ejx) + 4, Math.floor(e.y + ejy) + 4, r + 2, r * 0.6, 0, 0, Math.PI * 2);
                ctx.fill();
                flyOffset = -8 - Math.sin(_animFrame * 0.08) * 3; // bob up and down
            }

            // Tunneler: dirt particle trail
            if (e.special === 'burrows') {
                ctx.fillStyle = 'rgba(139,90,43,0.4)';
                for (var dt = 0; dt < 3; dt++) {
                    var dox = (Math.random() - 0.5) * r * 2;
                    var doy = (Math.random() - 0.5) * r * 2;
                    ctx.beginPath();
                    ctx.arc(Math.floor(e.x + ejx + dox), Math.floor(e.y + ejy + doy), 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // Body — use shape-specific draw function or fallback to circle
            var jx = e.jitterX || 0;
            var jy = e.jitterY || 0;
            var ex = Math.floor(e.x + jx);
            var ey = Math.floor(e.y + jy) + flyOffset;
            var moveAngle = _getMoveAngle(e);
            var drawFn = ENEMY_DRAW_FNS[e.type];
            if (drawFn) {
                drawFn(ctx, ex, ey, r, _animFrame, moveAngle, e);
            } else {
                // Fallback: colored circle + direction triangle (procedural enemies)
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(ex, ey, r, 0, Math.PI * 2);
                ctx.fill();
                if (e.path && e.pathIndex < e.path.length) {
                    var target = e.path[e.pathIndex];
                    var dx = target.x - e.x;
                    var dy = target.y - e.y;
                    var dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > 0.01) {
                        var nx = dx / dist;
                        var ny = dy / dist;
                        var tipX = ex + nx * (r + 4);
                        var tipY = ey + ny * (r + 4);
                        ctx.fillStyle = '#ffffff';
                        ctx.beginPath();
                        ctx.moveTo(tipX, tipY);
                        ctx.lineTo(ex + nx * r - ny * 3, ey + ny * r + nx * 3);
                        ctx.lineTo(ex + nx * r + ny * 3, ey + ny * r - nx * 3);
                        ctx.closePath();
                        ctx.fill();
                    }
                }
            }

            // Reset modified state instead of save/restore
            if (needsRestore) {
                ctx.globalAlpha = 1;
                ctx.shadowBlur = 0;
            }

            // HP bar (only when damaged)
            hpRatio = e.hp / e.maxHp;
            if (hpRatio < 1) {
                _drawHPBar(ctx, ex, ey - r, r * 2, hpRatio);
            }

            // Overload boss charge progress bar (while draining)
            if (e.mechanic === 'energy_drain' && (e.drainState === 'draining' || e.drainState === 'idle') && e.drainAbsorbed > 0 && e.drainThreshold > 0) {
                var chargeRatio = Math.min(e.drainAbsorbed / e.drainThreshold, 1);
                var cbW = r * 2;
                var cbH = 3;
                var cbX = ex - cbW / 2;
                var cbY = ey + r + 4;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.fillRect(cbX - 1, cbY - 1, cbW + 2, cbH + 2);
                ctx.fillStyle = 'rgba(60, 60, 80, 0.8)';
                ctx.fillRect(cbX, cbY, cbW, cbH);
                var cFill = chargeRatio < 0.5 ? 'rgba(100, 150, 255, 0.9)' : 'rgba(180, 220, 255, 0.95)';
                ctx.fillStyle = cFill;
                ctx.fillRect(cbX, cbY, cbW * chargeRatio, cbH);
            }

            // Overload boss energy drain / zap visuals
            if (e.mechanic === 'energy_drain') {
                // Draining: draw energy beams from batteries to boss
                if (e.drainState === 'draining' && e.drainTargets && e.drainTargets.length > 0) {
                    ctx.save();
                    for (var di = 0; di < e.drainTargets.length; di++) {
                        var dt = e.drainTargets[di];
                        var dtSX = Math.floor(dt.x);
                        var dtSY = Math.floor(dt.y);
                        // Pulsing energy beam from building to boss
                        var drainPulse = 0.4 + Math.sin(_animFrame * 0.2 + di) * 0.2;
                        ctx.strokeStyle = 'rgba(100, 150, 255, ' + drainPulse + ')';
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.moveTo(dtSX, dtSY);
                        // Jagged beam
                        var ddx = ex - dtSX;
                        var ddy = ey - dtSY;
                        for (var ds = 1; ds < 4; ds++) {
                            var dtt = ds / 4;
                            ctx.lineTo(
                                Math.floor(dtSX + ddx * dtt + (Math.random() - 0.5) * 10),
                                Math.floor(dtSY + ddy * dtt + (Math.random() - 0.5) * 10)
                            );
                        }
                        ctx.lineTo(ex, ey);
                        ctx.stroke();
                        // Flowing particles along beam
                        var particleT = (_animFrame * 0.05 + di * 0.3) % 1;
                        var ppx = dtSX + ddx * particleT;
                        var ppy = dtSY + ddy * particleT;
                        ctx.fillStyle = '#88ccff';
                        if (useShadows) {
                            ctx.shadowBlur = 6;
                            ctx.shadowColor = '#4488ff';
                        }
                        ctx.beginPath();
                        ctx.arc(Math.floor(ppx), Math.floor(ppy), 3, 0, Math.PI * 2);
                        ctx.fill();
                        if (useShadows) {
                            ctx.shadowBlur = 0;
                        }
                    }
                    ctx.restore();
                }
                // Zapping: draw tesla-like lightning from boss to weapon
                if (e.drainState === 'zapping' && e.drainZapTarget) {
                    ctx.save();
                    var zt = e.drainZapTarget;
                    var ztSX = Math.floor(zt.x);
                    var ztSY = Math.floor(zt.y);
                    // Main bolt
                    ctx.strokeStyle = '#aaccff';
                    ctx.lineWidth = 3;
                    if (useShadows) {
                        ctx.shadowBlur = 12;
                        ctx.shadowColor = '#6688ff';
                    }
                    ctx.beginPath();
                    ctx.moveTo(ex, ey);
                    var zdx = ztSX - ex;
                    var zdy = ztSY - ey;
                    var segs = 6;
                    for (var zs = 1; zs < segs; zs++) {
                        var zt2 = zs / segs;
                        ctx.lineTo(
                            Math.floor(ex + zdx * zt2 + (Math.random() - 0.5) * 16),
                            Math.floor(ey + zdy * zt2 + (Math.random() - 0.5) * 16)
                        );
                    }
                    ctx.lineTo(ztSX, ztSY);
                    ctx.stroke();
                    // Secondary thinner bolt
                    ctx.strokeStyle = 'rgba(200, 220, 255, 0.6)';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(ex, ey);
                    for (var zs2 = 1; zs2 < segs; zs2++) {
                        var zt3 = zs2 / segs;
                        ctx.lineTo(
                            Math.floor(ex + zdx * zt3 + (Math.random() - 0.5) * 20),
                            Math.floor(ey + zdy * zt3 + (Math.random() - 0.5) * 20)
                        );
                    }
                    ctx.lineTo(ztSX, ztSY);
                    ctx.stroke();
                    // Impact flash at target
                    var zapFlash = 0.5 + Math.sin(_animFrame * 0.3) * 0.3;
                    ctx.fillStyle = 'rgba(150, 200, 255, ' + zapFlash + ')';
                    ctx.beginPath();
                    ctx.arc(ztSX, ztSY, 8, 0, Math.PI * 2);
                    ctx.fill();
                    // Crackling arcs around impact
                    ctx.strokeStyle = 'rgba(180, 220, 255, 0.7)';
                    ctx.lineWidth = 1;
                    for (var za = 0; za < 4; za++) {
                        var zAngle = Math.random() * Math.PI * 2;
                        var zLen = 8 + Math.random() * 10;
                        ctx.beginPath();
                        ctx.moveTo(ztSX, ztSY);
                        ctx.lineTo(
                            Math.floor(ztSX + Math.cos(zAngle) * zLen),
                            Math.floor(ztSY + Math.sin(zAngle) * zLen)
                        );
                        ctx.stroke();
                    }
                    ctx.restore();
                }
            }
        }

        // Draw marked target reticle
        if (typeof Enemies !== 'undefined' && Enemies.getMarkedTarget) {
            var marked = Enemies.getMarkedTarget();
            if (marked && marked.hp > 0 && _isInViewport(marked.x, marked.y, 40)) {
                var mx = Math.floor(marked.x + (marked.jitterX || 0));
                var my = Math.floor(marked.y + (marked.jitterY || 0));
                var mr = (ENEMY_RADIUS[marked.type] || ENEMY_RADIUS_DEFAULT) + 6;
                var pulse = 0.7 + Math.sin(_animFrame * 0.12) * 0.3;

                ctx.save();
                ctx.strokeStyle = 'rgba(255, 50, 50, ' + pulse + ')';
                ctx.lineWidth = 2;

                // Outer circle
                ctx.beginPath();
                ctx.arc(mx, my, mr + 4, 0, Math.PI * 2);
                ctx.stroke();

                // Crosshair lines
                var ch = mr + 8;
                ctx.beginPath();
                ctx.moveTo(mx - ch, my); ctx.lineTo(mx - mr, my);
                ctx.moveTo(mx + mr, my); ctx.lineTo(mx + ch, my);
                ctx.moveTo(mx, my - ch); ctx.lineTo(mx, my - mr);
                ctx.moveTo(mx, my + mr); ctx.lineTo(mx, my + ch);
                ctx.stroke();

                // Target text
                ctx.fillStyle = 'rgba(255, 80, 80, ' + pulse + ')';
                ctx.font = 'bold 9px monospace';
                ctx.textAlign = 'center';
                ctx.fillText('TARGET', mx, my - mr - 10);
                ctx.restore();
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
                var trailColor = (p.type === 'blaster') ? '0,204,255' : (p.type === 'autocannon') ? '255,170,0' : '255,68,0';
                for (j = 0; j < trail.length - 1; j++) {
                    alpha = (j + 1) / trail.length * 0.6;
                    ctx.fillStyle = 'rgba(' + trailColor + ',' + alpha.toFixed(2) + ')';
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
            } else if (p.type === 'blaster') {
                // Cyan energy bolt
                ctx.fillStyle = '#00ccff';
                ctx.beginPath();
                ctx.arc(Math.floor(p.x), Math.floor(p.y), 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(Math.floor(p.x), Math.floor(p.y), 1.5, 0, Math.PI * 2);
                ctx.fill();
            } else if (p.type === 'autocannon') {
                // Yellow/orange bullet
                ctx.fillStyle = '#ffaa00';
                ctx.beginPath();
                ctx.arc(Math.floor(p.x), Math.floor(p.y), 2.5, 0, Math.PI * 2);
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
    // Layer: Mortar impact effects
    // ------------------------------------------------------------------------
    function _drawMortarImpacts(ctx) {
        if (typeof Combat === 'undefined' || !Combat || typeof Combat.getMortarImpacts !== 'function') return;
        var impacts = Combat.getMortarImpacts();
        if (!impacts || !impacts.length) return;

        for (var i = 0; i < impacts.length; i++) {
            var imp = impacts[i];
            var alpha = Math.min(imp.life, 0.35);
            ctx.beginPath();
            ctx.arc(Math.floor(imp.x), Math.floor(imp.y), imp.radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 40, 20, ' + alpha.toFixed(3) + ')';
            ctx.fill();
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
        var useShadows = _shadowsEnabled();

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
            // Reflection beams: cyan color
            if (beam.isReflection) {
                ctx.strokeStyle = '#88ddff';
                ctx.lineWidth = 1.5;
                if (useShadows) {
                    ctx.shadowBlur = _reduceShadows ? 3 : 6;
                    ctx.shadowColor = '#88ddff';
                }
                ctx.setLineDash([4, 4]);
            } else {
                ctx.strokeStyle = color;
                ctx.lineWidth = lineW;
                if (useShadows && ramp >= 6) {
                    ctx.shadowBlur = 4 + ramp;
                    ctx.shadowColor = ramp >= 10 ? COLORS.LASER.glow : color;
                }
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
            if (_shadowsEnabled()) {
                ctx.shadowBlur = _reduceShadows ? 4 : 8;
                ctx.shadowColor = COLORS.TESLA.glow;
            }

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
            if (_shadowsEnabled()) {
                ctx.shadowBlur = _reduceShadows ? 5 : 10;
                ctx.shadowColor = COLORS.RAILGUN.glow;
            }
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
            if (_shadowsEnabled()) {
                ctx.shadowBlur = 6;
                ctx.shadowColor = COLORS.EMP.ring;
            }
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
    // Layer: Mines
    // ------------------------------------------------------------------------
    function _drawMines(ctx) {
        if (typeof Combat === 'undefined' || !Combat || typeof Combat.getMines !== 'function') return;
        var mines = Combat.getMines();
        if (!mines || !mines.length) return;

        // Get drag state
        var dragInfo = (typeof Input !== 'undefined' && Input.getDraggingMine) ? Input.getDraggingMine() : null;
        var dragMineId = dragInfo ? dragInfo.mine.id : -1;

        for (var i = 0; i < mines.length; i++) {
            var mine = mines[i];
            // Hide the original mine being dragged
            if (mine.id === dragMineId) continue;
            if (!_isInViewport(mine.x, mine.y, 15)) continue;

            // Mine body - dark red circle
            ctx.fillStyle = '#882222';
            ctx.beginPath();
            ctx.arc(Math.floor(mine.x), Math.floor(mine.y), 5, 0, Math.PI * 2);
            ctx.fill();
            // Center dot - bright red
            ctx.fillStyle = '#ff4444';
            ctx.beginPath();
            ctx.arc(Math.floor(mine.x), Math.floor(mine.y), 2, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw mine being dragged at preview position
        if (dragInfo && dragInfo.pos) {
            var px = Math.floor(dragInfo.pos.x);
            var py = Math.floor(dragInfo.pos.y);

            // Draw 500px range circle from parent building
            var parent = (typeof Buildings !== 'undefined' && Buildings.getById)
                ? Buildings.getById(dragInfo.mine.buildingId) : null;
            if (parent) {
                var pc = Buildings.getBuildingCenter(parent);
                ctx.strokeStyle = dragInfo.valid ? 'rgba(0,255,100,0.25)' : 'rgba(255,50,50,0.25)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(Math.floor(pc.x), Math.floor(pc.y), 500, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Ghost mine at cursor
            ctx.globalAlpha = 0.7;
            ctx.fillStyle = dragInfo.valid ? '#228822' : '#882222';
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = dragInfo.valid ? '#44ff44' : '#ff4444';
            ctx.beginPath();
            ctx.arc(px, py, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1.0;

            // Banned symbol when too close to another mine or on a building
            if (!dragInfo.valid) {
                var showBanned = false;
                var allMines = Combat.getMines();
                for (var mi = 0; mi < allMines.length; mi++) {
                    if (allMines[mi].id === dragInfo.mine.id) continue;
                    var mdx = px - allMines[mi].x;
                    var mdy = py - allMines[mi].y;
                    if (Math.sqrt(mdx * mdx + mdy * mdy) < 25) { showBanned = true; break; }
                }
                if (!showBanned && typeof Buildings !== 'undefined' && Buildings.getAll) {
                    var cellSize = (typeof Config !== 'undefined' && Config.CELL_SIZE) ? Config.CELL_SIZE : 32;
                    var allBlds = Buildings.getAll();
                    for (var bi2 = 0; bi2 < allBlds.length; bi2++) {
                        var b2 = allBlds[bi2];
                        if (b2.hp <= 0) continue;
                        var bc2 = Buildings.getBuildingCenter(b2);
                        var bDef2 = (typeof Config !== 'undefined' && Config.BUILDINGS) ? Config.BUILDINGS[b2.type] : null;
                        var bsx2 = (bDef2 && bDef2.size) ? bDef2.size[0] : 1;
                        var bsy2 = (bDef2 && bDef2.size) ? bDef2.size[1] : 1;
                        var hw2 = (bsx2 * cellSize) / 2 + 10;
                        var hh2 = (bsy2 * cellSize) / 2 + 10;
                        if (Math.abs(px - bc2.x) < hw2 && Math.abs(py - bc2.y) < hh2) {
                            showBanned = true;
                            break;
                        }
                    }
                }
                if (showBanned) {
                    ctx.strokeStyle = '#ff2222';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(px, py, 10, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(px - 7, py - 7);
                    ctx.lineTo(px + 7, py + 7);
                    ctx.stroke();
                }
            }
        }
    }

    // ------------------------------------------------------------------------
    // Layer: Mine explosions
    // ------------------------------------------------------------------------
    function _drawMineExplosions(ctx) {
        if (typeof Combat === 'undefined' || !Combat || typeof Combat.getMineExplosions !== 'function') return;
        var explosions = Combat.getMineExplosions();
        if (!explosions || !explosions.length) return;

        for (var i = 0; i < explosions.length; i++) {
            var exp = explosions[i];
            var alpha = Math.min(exp.life, 0.4);
            ctx.beginPath();
            ctx.arc(Math.floor(exp.x), Math.floor(exp.y), exp.radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 60, 20, ' + alpha.toFixed(3) + ')';
            ctx.fill();
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
            if (_shadowsEnabled()) {
                ctx.shadowColor = '#cc44ff';
                ctx.shadowBlur = 12;
            }
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
            if (_shadowsEnabled()) {
                ctx.shadowColor = '#00ffff';
                ctx.shadowBlur = 15 + intensity * 15;
            }
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

        // Ghost: try custom procedural drawing first
        var t = _animFrame / 60;
        var fakeBuilding = { type: _placementPreview.typeKey, worldX: px, worldY: py, id: '__preview__' };
        ctx.globalAlpha = 0.7;
        if (!_drawBuildingCustom(ctx, px, py, pw, ph, fakeBuilding, t)) {
            // Fallback: colored ghost fill
            ctx.fillStyle = _placementPreview.valid ? COLORS.UI.valid : COLORS.UI.invalid;
            ctx.fillRect(px, py, pw, ph);
            // Icon
            if (def.icon) {
                var fontSize = Math.min(pw, ph) * 0.55;
                ctx.font = Math.floor(fontSize) + 'px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#ffffff';
                ctx.fillText(def.icon, px + pw / 2, py + ph / 2);
            }
        }
        ctx.globalAlpha = 1.0;

        // Ghost border (valid/invalid)
        ctx.strokeStyle = _placementPreview.valid ? '#00ff00' : '#ff0000';
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, pw, ph);

        // Weapon range circle
        if (def.range) {
            ctx.beginPath();
            ctx.arc(px + pw / 2, py + ph / 2, def.range, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,100,100,0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Cable connection preview: line to nearest (or Alt-cycled) connectable building
        if (!(def && def.noCables) && typeof Buildings !== 'undefined' && Buildings && typeof Buildings.getAll === 'function') {
            var cx = px + pw / 2;
            var cy = py + ph / 2;
            var closest = null;

            // Use Input's eligible targets and override index if available
            if (typeof Input !== 'undefined' && Input.getEligibleCableTargets && Input.getCableTargetIdx) {
                var eligible = Input.getEligibleCableTargets(cx, cy, _placementPreview.typeKey);
                var overrideIdx = Input.getCableTargetIdx();
                if (eligible.length > 0) {
                    var idx = (overrideIdx >= 0 && overrideIdx < eligible.length) ? overrideIdx : 0;
                    closest = eligible[idx].center;
                }
            } else {
                // Fallback: find nearest manually
                var bList = Buildings.getAll();
                var closestDist = Infinity;
                var restrictedCats = { weapons: true, mining: true, defense: true };
                var allowedCats = { storage: true, grid: true };
                var placingCat = def.category || '';
                var isRestricted = !!restrictedCats[placingCat];
                for (var bi = 0; bi < bList.length; bi++) {
                    var bOther = bList[bi];
                    // Walls don't use electricity — skip as cable targets
                    if (bOther.type === 'wall' || bOther.type === 'steel_wall') continue;
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
        var isTouch = ('ontouchstart' in window || navigator.maxTouchPoints > 0);
        var size = isTouch ? Math.min(MINIMAP_SIZE, Math.floor(Config.VIEWPORT_WIDTH * 0.3)) : MINIMAP_SIZE;
        var bottomOff = isTouch ? 80 : MINIMAP_BOTTOM_OFFSET;
        var mx = Config.VIEWPORT_WIDTH - size - MINIMAP_PADDING;
        var my = Config.VIEWPORT_HEIGHT - size - MINIMAP_PADDING - bottomOff;

        _minimapFrameCounter++;
        if (_minimapFrameCounter < 60 && _minimapCanvas) {
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
            // Boss indicators — large pulsing diamond with glow
            var bossPulse = (Math.sin(Date.now() * 0.006) + 1) * 0.5; // 0-1 pulse
            for (var bi = 0; bi < eList.length; bi++) {
                var be = eList[bi];
                if (be.hp <= 0) continue;
                var beDef = Config.ENEMIES[be.type];
                if (!beDef || !beDef.isBoss) continue;
                var bx = ox + Math.floor(be.x * scaleX);
                var by = oy + Math.floor(be.y * scaleY);
                var bossRadius = 4 + bossPulse * 2;
                // Glow
                mctx.fillStyle = 'rgba(255,50,50,' + (0.3 + bossPulse * 0.3) + ')';
                mctx.beginPath();
                mctx.arc(bx, by, bossRadius + 3, 0, Math.PI * 2);
                mctx.fill();
                // Diamond shape
                mctx.fillStyle = '#ff2222';
                mctx.strokeStyle = '#ffff00';
                mctx.lineWidth = 1;
                mctx.beginPath();
                mctx.moveTo(bx, by - bossRadius);
                mctx.lineTo(bx + bossRadius, by);
                mctx.lineTo(bx, by + bossRadius);
                mctx.lineTo(bx - bossRadius, by);
                mctx.closePath();
                mctx.fill();
                mctx.stroke();
                // Skull icon center dot
                mctx.fillStyle = '#ffff00';
                mctx.beginPath();
                mctx.arc(bx, by, 1.5, 0, Math.PI * 2);
                mctx.fill();
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

            // Dynamic sizing for mobile/desktop
            var viewW = window.innerWidth;
            var viewH = window.innerHeight;
            var dpr = window.devicePixelRatio || 1;
            // Cap DPR at 2 for performance on high-DPI phones
            if (dpr > 2) dpr = 2;

            // Update Config to match actual viewport
            Config.VIEWPORT_WIDTH = viewW;
            Config.VIEWPORT_HEIGHT = viewH;

            // Set canvas size with DPI scaling
            _canvas.width = Math.round(viewW * dpr);
            _canvas.height = Math.round(viewH * dpr);
            _canvas.style.width = viewW + 'px';
            _canvas.style.height = viewH + 'px';
            _ctx = _canvas.getContext('2d');
            _ctx.scale(dpr, dpr);

            // Store DPR for coordinate transforms
            _canvas._dpr = dpr;

            // Off-screen terrain canvas (same logical size)
            _terrainCanvas = document.createElement('canvas');
            _terrainCanvas.width = Math.round(viewW * dpr);
            _terrainCanvas.height = Math.round(viewH * dpr);
            _terrainCtx = _terrainCanvas.getContext('2d');
            _terrainCtx.scale(dpr, dpr);

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

            // Handle window resize (orientation change, etc.)
            window.addEventListener('resize', function () {
                var newW = window.innerWidth;
                var newH = window.innerHeight;
                var newDpr = Math.min(window.devicePixelRatio || 1, 2);
                Config.VIEWPORT_WIDTH = newW;
                Config.VIEWPORT_HEIGHT = newH;
                _canvas.width = Math.round(newW * newDpr);
                _canvas.height = Math.round(newH * newDpr);
                _canvas.style.width = newW + 'px';
                _canvas.style.height = newH + 'px';
                _ctx = _canvas.getContext('2d');
                _ctx.scale(newDpr, newDpr);
                _canvas._dpr = newDpr;
                _terrainCanvas.width = Math.round(newW * newDpr);
                _terrainCanvas.height = Math.round(newH * newDpr);
                _terrainCtx = _terrainCanvas.getContext('2d');
                _terrainCtx.scale(newDpr, newDpr);
                _terrainDirty = true;
                if (_minimapCanvas) {
                    _minimapCanvas = null;
                    _minimapCtx = null;
                }
                _clampCamera();
            });

            _terrainDirty = true;
            _spatialDirty = true;
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

            // Pre-build terrain cache for zoomed-out view to avoid first-zoom jank
            var savedZoom = _zoom;
            _zoom = 0.5;
            _ensureStaticTerrainCache();
            _zoom = savedZoom;
        },

        // --------------------------------------------------------------------
        // Main draw
        // --------------------------------------------------------------------
        draw: function (timestamp) {

            if (!_ctx) return;

            // Check if buildings/cables changed — rebuild spatial index immediately
            if (typeof Buildings !== 'undefined' && Buildings) {
                var bAll = Buildings.getAll();
                var cAll = Buildings.getCables ? Buildings.getCables() : null;
                var bCount = bAll ? bAll.length : 0;
                var cCount = cAll ? cAll.length : 0;
                if (bCount !== _spatialBuildingCount || cCount !== _spatialCableCount) {
                    _spatialDirty = true;
                    _spatialBuildingCount = bCount;
                    _spatialCableCount = cCount;
                }
            }

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
            _drawRangedEffects(_ctx);
            _drawProjectiles(_ctx);
            _drawMortarImpacts(_ctx);
            _drawLaserBeams(_ctx);
            _drawTeslaChains(_ctx);
            _drawRailShots(_ctx);
            _drawEmpBlasts(_ctx);
            _drawFlameEffects(_ctx);
            _drawDrones(_ctx);
            _drawMines(_ctx);
            _drawMineExplosions(_ctx);
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
        },

        moveCamera: function (dx, dy) {
            _camera.x += dx;
            _camera.y += dy;
            _clampCamera();
        },

        centerOn: function (worldX, worldY) {
            _camera.x = worldX - (Config.VIEWPORT_WIDTH / _zoom) / 2;
            _camera.y = worldY - (Config.VIEWPORT_HEIGHT / _zoom) / 2;
            _clampCamera();
        },

        getZoom: function () {
            return _zoom;
        },

        setZoom: function (z) {
            if (z < 0.5) z = 0.5;
            if (z > 3.0) z = 3.0;
            // Zoom toward center of viewport
            var centerWX = _camera.x + (Config.VIEWPORT_WIDTH / _zoom) / 2;
            var centerWY = _camera.y + (Config.VIEWPORT_HEIGHT / _zoom) / 2;
            _zoom = z;
            _camera.x = centerWX - (Config.VIEWPORT_WIDTH / _zoom) / 2;
            _camera.y = centerWY - (Config.VIEWPORT_HEIGHT / _zoom) / 2;
            _clampCamera();
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
            _spatialDirty = true;
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
            var isTouch = ('ontouchstart' in window || navigator.maxTouchPoints > 0);
            var size = isTouch ? Math.min(MINIMAP_SIZE, Math.floor(Config.VIEWPORT_WIDTH * 0.3)) : MINIMAP_SIZE;
            var bottomOff = isTouch ? 80 : MINIMAP_BOTTOM_OFFSET;
            return {
                x: Config.VIEWPORT_WIDTH - size - MINIMAP_PADDING,
                y: Config.VIEWPORT_HEIGHT - size - MINIMAP_PADDING - bottomOff,
                width: size,
                height: size
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
        COLORS: COLORS,

        toggleEnergyOverlay: function () {
            _showEnergyOverlay = !_showEnergyOverlay;
            return _showEnergyOverlay;
        },

        isEnergyOverlayOn: function () {
            return _showEnergyOverlay;
        },

        getBuildingIconDataUrl: _getBuildingIconDataUrl
    };
})();

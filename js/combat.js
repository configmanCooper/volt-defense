/* =========================================================================
 *  combat.js — Combat system for Volt Defense
 *  Manages weapon targeting, firing, damage, projectiles, and shields.
 *  Uses the IIFE module pattern. All constants come from Config.
 * ========================================================================= */

var Combat = (function() {
    var _projectiles = [];   // Active missile projectiles
    var _nextProjectileId = 1;
    var _laserBeams = [];    // Active laser beams for rendering
    var _empDisabled = {};   // buildingId -> remaining disable ticks

    // ---- helpers ----

    function _tps() {
        return (typeof Config !== 'undefined' && Config.TICKS_PER_SECOND)
            ? Config.TICKS_PER_SECOND : 10;
    }

    function _distance(x1, y1, x2, y2) {
        var dx = x1 - x2;
        var dy = y1 - y2;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function _getBuildingDef(type) {
        if (typeof Config === 'undefined' || !Config.BUILDINGS) { return null; }
        return Config.BUILDINGS[type] || null;
    }

    function _getEnemyDef(type) {
        if (typeof Config === 'undefined' || !Config.ENEMIES) { return null; }
        return Config.ENEMIES[type] || null;
    }

    function _getBuildingCenter(building) {
        if (typeof Buildings !== 'undefined' && Buildings.getBuildingCenter) {
            return Buildings.getBuildingCenter(building);
        }
        // Fallback: estimate from grid position
        var cellSz = (typeof Config !== 'undefined' && Config.GRID_CELL_SIZE)
            ? Config.GRID_CELL_SIZE : 40;
        return {
            x: building.gridX * cellSz + cellSz / 2,
            y: building.gridY * cellSz + cellSz / 2
        };
    }

    function _getAllBuildings() {
        if (typeof Buildings !== 'undefined' && Buildings.getAll) {
            return Buildings.getAll();
        }
        return [];
    }

    function _getAllEnemies() {
        if (typeof Enemies !== 'undefined' && Enemies.getAll) {
            return Enemies.getAll();
        }
        return [];
    }

    // ---- 1. Process Shields ----

    function _processShields() {
        var buildings = _getAllBuildings();
        var tps = _tps();
        var passiveDrain = (typeof Config !== 'undefined' && Config.SHIELD_PASSIVE_DRAIN != null)
            ? Config.SHIELD_PASSIVE_DRAIN : 20;
        var drainPerTick = passiveDrain / tps;

        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            var def = _getBuildingDef(b.type);
            if (!def || def.category !== 'defense') { continue; }
            if (!b.active || b.hp <= 0) {
                b.shieldActive = false;
                continue;
            }

            // Shield broken — needs recharge before reactivating
            if (b.shieldHP != null && b.shieldHP <= 0) {
                b.shieldActive = false;
                continue;
            }

            // Check passive energy drain
            if (b.energy >= drainPerTick) {
                b.energy -= drainPerTick;
                b.shieldActive = true;
            } else {
                b.shieldActive = false;
                continue;
            }

            // Regenerate shieldHP slowly if below max and energy is available
            var shieldMaxHP = def.shieldHP || 500;
            if (b.shieldHP == null) { b.shieldHP = shieldMaxHP; }
            if (b.shieldActive && b.shieldHP < shieldMaxHP) {
                if (b.energy >= 1) {
                    b.shieldHP = Math.min(b.shieldHP + 1, shieldMaxHP);
                }
            }
        }
    }

    // ---- 2. Shield–Enemy Collisions ----

    function _processShieldCollisions() {
        var buildings = _getAllBuildings();
        var enemies = _getAllEnemies();
        var tps = _tps();
        var shieldRadius = (typeof Config !== 'undefined' && Config.SHIELD_DIAMETER != null)
            ? Config.SHIELD_DIAMETER / 2 : 200;

        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            var def = _getBuildingDef(b.type);
            if (!def || def.category !== 'defense') { continue; }
            if (!b.shieldActive) { continue; }

            var center = _getBuildingCenter(b);
            var energyCostPerDmg = def.shieldEnergyCostPerDamage || 50;

            for (var j = 0; j < enemies.length; j++) {
                var e = enemies[j];
                if (!e || e.hp <= 0) { continue; }

                // Phase walkers ignore shields
                var eDef = _getEnemyDef(e.type);
                if (eDef && eDef.special === 'ignores_shields') { continue; }

                var dist = _distance(center.x, center.y, e.x, e.y);
                if (dist > shieldRadius) { continue; }

                // Enemy attacks shield
                var dmgPerTick = (e.damage || 0) / tps;
                b.shieldHP -= dmgPerTick;

                // Drain energy proportional to damage
                var energyDrain = dmgPerTick * energyCostPerDmg / tps;
                b.energy -= energyDrain;
                if (b.energy < 0) { b.energy = 0; }

                // Stop enemy movement this tick
                e.blocked = true;

                // Shield break check
                if (b.shieldHP <= 0) {
                    b.shieldHP = 0;
                    b.shieldActive = false;
                    break;
                }
            }
        }
    }

    // ---- 3. Process Lasers ----

    function _processLasers() {
        var buildings = _getAllBuildings();
        var tps = _tps();

        // Clear previous beams
        _laserBeams = [];

        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            if (b.type !== 'laser_t1' && b.type !== 'laser_t2' && b.type !== 'laser_t3') {
                continue;
            }

            var def = _getBuildingDef(b.type);
            if (!def) { continue; }

            if (!b.active || b.hp <= 0 || b.energy <= 0) {
                b.laserRampTime = 0;
                continue;
            }

            // Check for jammer range reduction
            var effectiveRange = _getEffectiveRange(b, def.range);

            var center = _getBuildingCenter(b);

            // Find closest enemy in range
            var enemy = null;
            if (typeof Enemies !== 'undefined' && Enemies.getClosest) {
                enemy = Enemies.getClosest(center.x, center.y, effectiveRange);
            }

            if (!enemy) {
                b.laserRampTime = 0;
                b.target = null;
                continue;
            }

            // Target switch resets ramp
            if (b.target !== enemy.id) {
                b.laserRampTime = 0;
            }
            b.target = enemy.id;

            // Initialize ramp time if needed
            if (b.laserRampTime == null) { b.laserRampTime = 0; }
            b.laserRampTime += 1 / tps;

            // Ramp multiplier: doubles every second, capped at maxRamp
            var maxRamp = def.maxRamp || 16;
            var rampMultiplier = Math.pow(2, Math.min(b.laserRampTime, Math.log2(maxRamp)));

            // DPS and energy calculations
            var dps = def.baseDPS * rampMultiplier;
            var damageThisTick = dps / tps;
            var energyDrawThisTick = def.baseEnergyDraw * rampMultiplier / tps;

            // Energy check — reduce damage proportionally if insufficient
            if (b.energy < energyDrawThisTick) {
                var ratio = b.energy / energyDrawThisTick;
                damageThisTick *= ratio;
                b.energy = 0;
            } else {
                b.energy -= energyDrawThisTick;
            }

            // Apply damage with armor bypass
            var armorBypass = (typeof Config !== 'undefined' && Config.LASER_ARMOR_BYPASS != null)
                ? Config.LASER_ARMOR_BYPASS : 0.5;
            var actualDamage = damageThisTick;
            var eDef2 = _getEnemyDef(enemy.type);
            if ((eDef2 && eDef2.mechanic === 'laser_resist') || enemy.mechanic === 'laser_resist') {
                actualDamage *= 0.5;
            }
            var killed = false;
            if (typeof Enemies !== 'undefined' && Enemies.damageEnemy) {
                killed = Enemies.damageEnemy(enemy.id, actualDamage, armorBypass);
            }

            // Add laser beam for rendering
            _laserBeams.push({
                fromX: center.x,
                fromY: center.y,
                toX: enemy.x,
                toY: enemy.y,
                rampLevel: rampMultiplier,
                buildingId: b.id
            });

            if (killed) {
                b.target = null;
                b.laserRampTime = 0;
            }
        }
    }

    // ---- 4. Process Missiles ----

    function _processMissiles() {
        var buildings = _getAllBuildings();
        var tps = _tps();

        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            if (b.type !== 'missile_t1' && b.type !== 'missile_t2' && b.type !== 'missile_t3') {
                continue;
            }

            var def = _getBuildingDef(b.type);
            if (!def) { continue; }

            if (!b.active || b.hp <= 0) { continue; }

            // Reload timer
            if (b.reloadTimer == null) { b.reloadTimer = 0; }
            if (b.reloadTimer > 0) {
                b.reloadTimer--;
                continue;
            }

            // Check for jammer range reduction
            var effectiveRange = _getEffectiveRange(b, def.range);

            var center = _getBuildingCenter(b);

            // Find furthest enemy in range
            var enemy = null;
            if (typeof Enemies !== 'undefined' && Enemies.getFurthest) {
                enemy = Enemies.getFurthest(center.x, center.y, effectiveRange);
            }

            if (!enemy) { continue; }

            // Check iron resource
            var ironCost = def.ironPerShot || 0;
            var hasIron = true;
            if (ironCost > 0) {
                if (typeof Economy !== 'undefined' && Economy.getResource) {
                    hasIron = Economy.getResource('iron') >= ironCost;
                } else {
                    hasIron = false;
                }
            }
            if (!hasIron) { continue; }

            // Check energy (full per-shot cost, not per-tick)
            var energyCost = def.energyPerShot || 0;
            if (b.energy < energyCost) { continue; }

            // Spend resources
            if (ironCost > 0 && typeof Economy !== 'undefined' && Economy.spendResource) {
                Economy.spendResource('iron', ironCost);
            }
            b.energy -= energyCost;

            // Calculate initial angle toward target
            var dx = enemy.x - center.x;
            var dy = enemy.y - center.y;
            var angle = Math.atan2(dy, dx);

            // Create projectile
            _projectiles.push({
                id: _nextProjectileId++,
                x: center.x,
                y: center.y,
                targetId: enemy.id,
                damage: def.damage,
                speed: def.missileSpeed || 300,
                type: b.type,
                angle: angle,
                distanceTraveled: 0,
                maxDistance: effectiveRange * ((typeof Config !== 'undefined' && Config.MISSILE_MAX_RANGE_MULT != null)
                    ? Config.MISSILE_MAX_RANGE_MULT : 1.5)
            });

            // Set reload
            b.reloadTimer = def.reloadTicks || 20;
        }
    }

    // ---- 5. Update Projectiles ----

    function _updateProjectiles() {
        var tps = _tps();
        var homingAngle = (typeof Config !== 'undefined' && Config.MISSILE_HOMING_ANGLE != null)
            ? Config.MISSILE_HOMING_ANGLE : 15;
        var homingRad = homingAngle * Math.PI / 180;
        var hitDist = 15;
        var surviving = [];

        for (var i = 0; i < _projectiles.length; i++) {
            var p = _projectiles[i];

            // Get target enemy
            var target = null;
            if (typeof Enemies !== 'undefined' && Enemies.getById) {
                target = Enemies.getById(p.targetId);
            }

            // Target dead/gone — missile lost
            if (!target || target.hp <= 0) { continue; }

            // Homing: adjust angle toward target
            var desiredAngle = Math.atan2(target.y - p.y, target.x - p.x);
            var angleDiff = desiredAngle - p.angle;

            // Normalize angle difference to [-PI, PI]
            while (angleDiff > Math.PI) { angleDiff -= 2 * Math.PI; }
            while (angleDiff < -Math.PI) { angleDiff += 2 * Math.PI; }

            // Clamp turn rate per tick
            var maxTurn = homingRad / tps;
            if (angleDiff > maxTurn) { angleDiff = maxTurn; }
            else if (angleDiff < -maxTurn) { angleDiff = -maxTurn; }
            p.angle += angleDiff;

            // Move
            var moveDistThisTick = p.speed / tps;
            p.x += Math.cos(p.angle) * moveDistThisTick;
            p.y += Math.sin(p.angle) * moveDistThisTick;
            p.distanceTraveled += moveDistThisTick;

            // Hit check
            var distToTarget = _distance(p.x, p.y, target.x, target.y);
            if (distToTarget <= hitDist) {
                var actualDmg = p.damage;
                var targetDef = _getEnemyDef(target.type);
                if ((targetDef && targetDef.mechanic === 'missile_resist') || target.mechanic === 'missile_resist') {
                    actualDmg *= 0.5;
                }
                if (typeof Enemies !== 'undefined' && Enemies.damageEnemy) {
                    Enemies.damageEnemy(p.targetId, actualDmg, 0);
                }
                continue; // Projectile consumed
            }

            // Max range check
            if (p.distanceTraveled > p.maxDistance) { continue; }

            surviving.push(p);
        }

        _projectiles = surviving;
    }

    // ---- 6. Handle Special Enemies ----

    function _handleSpecialEnemies() {
        var enemies = _getAllEnemies();
        var buildings = _getAllBuildings();
        var tps = _tps();

        // Decrement EMP disable timers
        var disabledKeys = Object.keys(_empDisabled);
        for (var k = 0; k < disabledKeys.length; k++) {
            var key = disabledKeys[k];
            _empDisabled[key]--;
            if (_empDisabled[key] <= 0) {
                // Re-enable building
                for (var bi = 0; bi < buildings.length; bi++) {
                    if (String(buildings[bi].id) === key) {
                        buildings[bi].empDisabled = false;
                        break;
                    }
                }
                delete _empDisabled[key];
            }
        }

        for (var i = 0; i < enemies.length; i++) {
            var e = enemies[i];
            if (!e || e.hp <= 0) { continue; }

            var eDef = _getEnemyDef(e.type);
            if (!eDef || !eDef.special) { continue; }

            // EMP Drone: disable nearby buildings
            if (eDef.special === 'emp_disable') {
                for (var j = 0; j < buildings.length; j++) {
                    var b = buildings[j];
                    if (!b.active || b.hp <= 0) { continue; }
                    if (_empDisabled[String(b.id)]) { continue; }

                    var center = _getBuildingCenter(b);
                    var dist = _distance(e.x, e.y, center.x, center.y);
                    if (dist <= 200) {
                        b.active = false;
                        b.empDisabled = true;
                        _empDisabled[String(b.id)] = 50; // 50 ticks
                    }
                }
            }

            // Bomber targeting now handled in enemies.js via targetCategory

            // Saboteur: damage buildings they pass near (within 1 cell distance)
            if (eDef.special === 'targets_grid') {
                var cellSz = (typeof Config !== 'undefined' && Config.GRID_CELL_SIZE)
                    ? Config.GRID_CELL_SIZE : 40;
                for (var j = 0; j < buildings.length; j++) {
                    var b = buildings[j];
                    if (b.hp <= 0) { continue; }
                    var center = _getBuildingCenter(b);
                    var dist = _distance(e.x, e.y, center.x, center.y);
                    if (dist <= cellSz) {
                        b.hp -= (eDef.damage || 5) / tps;
                        if (b.hp < 0) { b.hp = 0; }
                    }
                }
            }

            // Ranged attack: enemy shoots at nearest building from range
            if ((eDef.mechanic === 'ranged_attack') || (e.mechanic === 'ranged_attack')) {
                if (e.rangedCooldown == null) e.rangedCooldown = 0;
                if (e.rangedCooldown > 0) { e.rangedCooldown--; continue; }

                var nearestB = null;
                var nearestBDist = Infinity;
                for (var j = 0; j < buildings.length; j++) {
                    var b = buildings[j];
                    if (b.hp <= 0) continue;
                    var center = _getBuildingCenter(b);
                    var dist = _distance(e.x, e.y, center.x, center.y);
                    if (dist <= 200 && dist < nearestBDist) {
                        nearestBDist = dist;
                        nearestB = b;
                    }
                }
                if (nearestB) {
                    nearestB.hp -= (e.damage || 10) / tps;
                    if (nearestB.hp < 0) nearestB.hp = 0;
                    e.rangedCooldown = tps * 2;
                }
            }

            // Teleport: enemy teleports forward occasionally
            if ((eDef.mechanic === 'teleport') || (e.mechanic === 'teleport')) {
                if (e.teleportCooldown == null) e.teleportCooldown = tps * 5;
                if (e.teleportCooldown > 0) { e.teleportCooldown--; }
                else {
                    if (e.path && e.pathIndex < e.path.length) {
                        var tp = e.path[Math.min(e.pathIndex + 3, e.path.length - 1)];
                        e.x = tp.x;
                        e.y = tp.y;
                        e.pathIndex = Math.min(e.pathIndex + 3, e.path.length - 1);
                    }
                    e.teleportCooldown = tps * 5;
                }
            }

            // Jammer: range reduction is handled inline via _getEffectiveRange
        }
    }

    // ---- Jammer range reduction helper ----

    function _getEffectiveRange(building, baseRange) {
        var enemies = _getAllEnemies();
        var center = _getBuildingCenter(building);
        var jammerRadius = 300;
        var rangeReduction = 0.30;

        for (var i = 0; i < enemies.length; i++) {
            var e = enemies[i];
            if (!e || e.hp <= 0) { continue; }
            var eDef = _getEnemyDef(e.type);
            if (!eDef || eDef.special !== 'reduces_range') { continue; }

            var dist = _distance(center.x, center.y, e.x, e.y);
            if (dist <= jammerRadius) {
                return baseRange * (1 - rangeReduction);
            }
        }
        return baseRange;
    }

    // ---- EMP re-enable on tick (restore disabled buildings) ----

    function _restoreEmpBuildings() {
        var buildings = _getAllBuildings();
        var disabledKeys = Object.keys(_empDisabled);

        for (var k = 0; k < disabledKeys.length; k++) {
            var key = disabledKeys[k];
            if (_empDisabled[key] <= 0) {
                for (var i = 0; i < buildings.length; i++) {
                    if (String(buildings[i].id) === key) {
                        buildings[i].active = true;
                        buildings[i].empDisabled = false;
                        break;
                    }
                }
                delete _empDisabled[key];
            }
        }
    }

    // ---- public API ----

    return {
        /**
         * Main combat tick — called once per game tick.
         */
        tick: function() {
            if (typeof Config === 'undefined') { return; }

            _processShields();
            _processShieldCollisions();
            _processLasers();
            _processMissiles();
            _updateProjectiles();
            _handleSpecialEnemies();
        },

        getProjectiles: function() { return _projectiles; },
        getLaserBeams: function() { return _laserBeams; },

        getEmpDisabled: function() { return _empDisabled; },

        getSerializableState: function() {
            var projData = [];
            for (var i = 0; i < _projectiles.length; i++) {
                var p = _projectiles[i];
                projData.push({
                    id: p.id,
                    x: p.x,
                    y: p.y,
                    targetId: p.targetId,
                    damage: p.damage,
                    speed: p.speed,
                    type: p.type,
                    angle: p.angle,
                    distanceTraveled: p.distanceTraveled,
                    maxDistance: p.maxDistance
                });
            }

            // Serialize EMP disabled map
            var empData = {};
            var keys = Object.keys(_empDisabled);
            for (var i = 0; i < keys.length; i++) {
                empData[keys[i]] = _empDisabled[keys[i]];
            }

            return {
                projectiles: projData,
                nextProjectileId: _nextProjectileId,
                empDisabled: empData
            };
        },

        loadState: function(data) {
            if (!data) { return; }

            _projectiles = [];
            if (data.projectiles) {
                for (var i = 0; i < data.projectiles.length; i++) {
                    var p = data.projectiles[i];
                    _projectiles.push({
                        id: p.id,
                        x: p.x,
                        y: p.y,
                        targetId: p.targetId,
                        damage: p.damage,
                        speed: p.speed,
                        type: p.type,
                        angle: p.angle,
                        distanceTraveled: p.distanceTraveled,
                        maxDistance: p.maxDistance
                    });
                }
            }

            _nextProjectileId = data.nextProjectileId || 1;
            _laserBeams = [];

            _empDisabled = {};
            if (data.empDisabled) {
                var keys = Object.keys(data.empDisabled);
                for (var i = 0; i < keys.length; i++) {
                    _empDisabled[keys[i]] = data.empDisabled[keys[i]];
                }
            }
        }
    };
})();

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
    var _teslaChains = [];   // Current frame tesla chain data for rendering
    var _railShots = [];     // Active rail shot visual effects
    var _empBlasts = [];     // Active EMP blast visual effects
    var _drones = [];        // Active drones from drone bays
    var _nextDroneId = 1;

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

            // Shield broken — regen slowly before reactivating
            if (b.shieldHP != null && b.shieldHP <= 0) {
                b.shieldActive = false;
                // Regen even when broken, using stored energy
                var shieldMaxHP = def.shieldHP || 500;
                if (b.energy >= 1) {
                    b.shieldHP = Math.min((b.shieldHP || 0) + 1, shieldMaxHP);
                }
                // Reactivate once shield has recharged to 10%
                if (b.shieldHP >= shieldMaxHP * 0.1) {
                    b.shieldActive = true;
                }
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
            if (b.shieldHP < shieldMaxHP) {
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

            // Energy check — stop firing if insufficient
            if (b.energy < energyDrawThisTick) {
                b.laserRampTime = 0;
                continue;
            }
            b.energy -= energyDrawThisTick;

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

            // Plasma projectile handling
            if (p.type === 'plasma') {
                var pTarget = null;
                if (typeof Enemies !== 'undefined' && Enemies.getById) {
                    pTarget = Enemies.getById(p.targetId);
                }
                if (!pTarget || pTarget.hp <= 0) { continue; }

                // Homing
                var pDesired = Math.atan2(pTarget.y - p.y, pTarget.x - p.x);
                var pDiff = pDesired - p.angle;
                while (pDiff > Math.PI) { pDiff -= 2 * Math.PI; }
                while (pDiff < -Math.PI) { pDiff += 2 * Math.PI; }
                var pMaxTurn = homingRad / tps;
                if (pDiff > pMaxTurn) { pDiff = pMaxTurn; }
                else if (pDiff < -pMaxTurn) { pDiff = -pMaxTurn; }
                p.angle += pDiff;

                var pMoveDist = p.speed / tps;
                p.x += Math.cos(p.angle) * pMoveDist;
                p.y += Math.sin(p.angle) * pMoveDist;
                p.distanceTraveled += pMoveDist;

                var pHitDist = _distance(p.x, p.y, pTarget.x, pTarget.y);
                if (pHitDist <= hitDist) {
                    if (typeof Enemies !== 'undefined' && Enemies.damageEnemy) {
                        Enemies.damageEnemy(p.targetId, p.damage, p.armorBypass || 1.0);
                    }
                    continue;
                }
                if (p.distanceTraveled > p.maxDistance) { continue; }
                surviving.push(p);
                continue;
            }

            // Mortar projectile handling
            if (p.isMortar) {
                var moveDistMortar = p.speed / tps;
                p.x += Math.cos(p.angle) * moveDistMortar;
                p.y += Math.sin(p.angle) * moveDistMortar;
                p.distanceTraveled += moveDistMortar;

                // Check arrival
                var arrivalDist = _distance(p.x, p.y, p.targetX, p.targetY);
                if (arrivalDist <= 15 || p.distanceTraveled >= p.maxDistance) {
                    // Splash damage
                    var allEnemies = _getAllEnemies();
                    for (var si = 0; si < allEnemies.length; si++) {
                        var se = allEnemies[si];
                        if (se && se.hp > 0) {
                            var sd = _distance(p.x, p.y, se.x, se.y);
                            if (sd <= p.splashRadius) {
                                if (typeof Enemies !== 'undefined' && Enemies.damageEnemy) {
                                    Enemies.damageEnemy(se.id, p.damage, 0);
                                }
                            }
                        }
                    }
                    continue; // Projectile consumed by explosion
                }

                surviving.push(p);
                continue;
            }

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

    // ---- 5b. New Weapon Processing ----

    function _processTeslaCoils() {
        var buildings = _getAllBuildings();
        var tps = _tps();
        _teslaChains = [];

        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            if (b.type !== 'tesla_coil') { continue; }
            var def = _getBuildingDef(b.type);
            if (!def) { continue; }
            if (!b.active || b.hp <= 0 || b.energy <= 0) { continue; }

            var effectiveRange = _getEffectiveRange(b, def.range);
            var center = _getBuildingCenter(b);
            var energyDraw = (def.energyDraw || 50) / tps;
            if (b.energy < energyDraw) { continue; }

            // Find closest enemy
            var enemy = null;
            if (typeof Enemies !== 'undefined' && Enemies.getClosest) {
                enemy = Enemies.getClosest(center.x, center.y, effectiveRange);
            }
            if (!enemy) { continue; }

            b.energy -= energyDraw;
            var baseDamage = (def.baseDamage || 15) / tps;
            var chainCount = def.chainCount || 3;
            var chainRange = def.chainRange || 150;
            var chainDecay = def.chainDecay || 0.7;

            var chainPoints = [{ x: center.x, y: center.y }];
            var hitEnemies = {};
            var currentDamage = baseDamage;
            var currentTarget = enemy;

            // Hit first target and chain
            for (var c = 0; c <= chainCount; c++) {
                if (!currentTarget || currentTarget.hp <= 0) { break; }
                if (hitEnemies[currentTarget.id]) { break; }
                hitEnemies[currentTarget.id] = true;
                chainPoints.push({ x: currentTarget.x, y: currentTarget.y });

                if (typeof Enemies !== 'undefined' && Enemies.damageEnemy) {
                    Enemies.damageEnemy(currentTarget.id, currentDamage, 0);
                }

                currentDamage *= chainDecay;

                // Find next chain target
                var enemies = _getAllEnemies();
                var bestDist = chainRange;
                var nextTarget = null;
                for (var e = 0; e < enemies.length; e++) {
                    if (hitEnemies[enemies[e].id]) { continue; }
                    if (enemies[e].hp <= 0) { continue; }
                    var d = _distance(currentTarget.x, currentTarget.y, enemies[e].x, enemies[e].y);
                    if (d < bestDist) {
                        bestDist = d;
                        nextTarget = enemies[e];
                    }
                }
                currentTarget = nextTarget;
            }

            if (chainPoints.length > 1) {
                _teslaChains.push({ points: chainPoints });
            }
        }
    }

    function _processFlamethrowers() {
        var buildings = _getAllBuildings();
        var enemies = _getAllEnemies();
        var tps = _tps();

        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            if (b.type !== 'flamethrower') { continue; }
            var def = _getBuildingDef(b.type);
            if (!def) { continue; }
            if (!b.active || b.hp <= 0 || b.energy <= 0) { continue; }

            var effectiveRange = _getEffectiveRange(b, def.range);
            var center = _getBuildingCenter(b);
            var energyDraw = (def.energyDraw || 20) / tps;
            if (b.energy < energyDraw) { continue; }

            // Check oil fuel
            var oilDraw = (def.oilPerTick || 0.02);
            if (oilDraw > 0) {
                if (typeof Economy !== 'undefined' && Economy.getResource) {
                    if (Economy.getResource('oil') < oilDraw) { continue; }
                } else { continue; }
            }

            var anyInRange = false;
            var dps = (def.baseDPS || 8) / tps;
            var burnDPS = def.burnDPS || 3;
            var burnDuration = def.burnDuration || 30;

            for (var j = 0; j < enemies.length; j++) {
                var e = enemies[j];
                if (!e || e.hp <= 0) { continue; }
                var dist = _distance(center.x, center.y, e.x, e.y);
                if (dist <= effectiveRange) {
                    anyInRange = true;
                    if (typeof Enemies !== 'undefined' && Enemies.damageEnemy) {
                        Enemies.damageEnemy(e.id, dps, 0);
                    }
                    // Apply burn DOT
                    e.burnTimer = burnDuration;
                    e.burnDPS = burnDPS;
                }
            }

            if (anyInRange) {
                b.energy -= energyDraw;
                if (oilDraw > 0 && typeof Economy !== 'undefined' && Economy.spendResource) {
                    Economy.spendResource('oil', oilDraw);
                }
                b.flameActive = true;
            } else {
                b.flameActive = false;
            }
        }

        // Process burn DOT on all enemies
        for (var k = 0; k < enemies.length; k++) {
            var en = enemies[k];
            if (en && en.burnTimer && en.burnTimer > 0) {
                en.burnTimer--;
                var burnDmg = (en.burnDPS || 3) / tps;
                if (typeof Enemies !== 'undefined' && Enemies.damageEnemy) {
                    Enemies.damageEnemy(en.id, burnDmg, 0);
                }
            }
        }
    }

    function _processRailguns() {
        var buildings = _getAllBuildings();
        var enemies = _getAllEnemies();

        // Decay existing rail shots
        var activeShots = [];
        for (var r = 0; r < _railShots.length; r++) {
            _railShots[r].timer--;
            if (_railShots[r].timer > 0) {
                activeShots.push(_railShots[r]);
            }
        }
        _railShots = activeShots;

        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            if (b.type !== 'railgun') { continue; }
            var def = _getBuildingDef(b.type);
            if (!def) { continue; }
            if (!b.active || b.hp <= 0) { continue; }

            if (b.reloadTimer == null) { b.reloadTimer = 0; }
            if (b.reloadTimer > 0) { b.reloadTimer--; continue; }

            var effectiveRange = _getEffectiveRange(b, def.range);
            var center = _getBuildingCenter(b);

            // Find closest enemy to aim at
            var target = null;
            if (typeof Enemies !== 'undefined' && Enemies.getClosest) {
                target = Enemies.getClosest(center.x, center.y, effectiveRange);
            }
            if (!target) { continue; }

            // Check iron
            var ironCost = def.ironPerShot || 3;
            if (typeof Economy !== 'undefined' && Economy.getResource) {
                if (Economy.getResource('iron') < ironCost) { continue; }
            } else { continue; }

            // Check energy
            var energyCost = def.energyPerShot || 500;
            if (b.energy < energyCost) { continue; }

            // Fire! Spend resources
            if (typeof Economy !== 'undefined' && Economy.spendResource) {
                Economy.spendResource('iron', ironCost);
            }
            b.energy -= energyCost;
            b.reloadTimer = def.reloadTicks || 40;

            // Calculate shot line
            var dx = target.x - center.x;
            var dy = target.y - center.y;
            var len = Math.sqrt(dx * dx + dy * dy);
            if (len === 0) { continue; }
            var nx = dx / len;
            var ny = dy / len;
            var endX = center.x + nx * effectiveRange;
            var endY = center.y + ny * effectiveRange;

            // Damage ALL enemies along the line
            var damage = def.damage || 80;
            var lineWidth = 20; // hit detection width
            for (var j = 0; j < enemies.length; j++) {
                var e = enemies[j];
                if (!e || e.hp <= 0) { continue; }
                // Point-to-line distance
                var ex = e.x - center.x;
                var ey = e.y - center.y;
                var proj = ex * nx + ey * ny;
                if (proj < 0 || proj > effectiveRange) { continue; }
                var perpX = ex - proj * nx;
                var perpY = ey - proj * ny;
                var perpDist = Math.sqrt(perpX * perpX + perpY * perpY);
                if (perpDist <= lineWidth) {
                    if (typeof Enemies !== 'undefined' && Enemies.damageEnemy) {
                        Enemies.damageEnemy(e.id, damage, 0);
                    }
                }
            }

            _railShots.push({
                fromX: center.x, fromY: center.y,
                toX: endX, toY: endY,
                timer: 5
            });
        }
    }

    function _processEmpTowers() {
        var buildings = _getAllBuildings();
        var enemies = _getAllEnemies();

        // Decay existing EMP blasts
        var activeBlasts = [];
        for (var r = 0; r < _empBlasts.length; r++) {
            _empBlasts[r].timer--;
            if (_empBlasts[r].timer > 0) {
                _empBlasts[r].radius += 8;
                activeBlasts.push(_empBlasts[r]);
            }
        }
        _empBlasts = activeBlasts;

        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            if (b.type !== 'emp_tower') { continue; }
            var def = _getBuildingDef(b.type);
            if (!def) { continue; }
            if (!b.active || b.hp <= 0) { continue; }

            if (b.empCooldown == null) { b.empCooldown = 0; }
            if (b.empCooldown > 0) { b.empCooldown--; continue; }

            var effectiveRange = _getEffectiveRange(b, def.range);
            var center = _getBuildingCenter(b);
            var energyCost = def.energyPerActivation || 1500;
            if (b.energy < energyCost) { continue; }

            // Check if any enemies in range
            var anyInRange = false;
            for (var j = 0; j < enemies.length; j++) {
                if (enemies[j] && enemies[j].hp > 0) {
                    var dist = _distance(center.x, center.y, enemies[j].x, enemies[j].y);
                    if (dist <= effectiveRange) { anyInRange = true; break; }
                }
            }
            if (!anyInRange) { continue; }

            // Activate!
            b.energy -= energyCost;
            b.empCooldown = def.cooldownTicks || 100;
            var stunDuration = def.stunDuration || 30;

            for (var k = 0; k < enemies.length; k++) {
                var e = enemies[k];
                if (!e || e.hp <= 0) { continue; }
                var d = _distance(center.x, center.y, e.x, e.y);
                if (d <= effectiveRange) {
                    e.stunTimer = stunDuration;
                }
            }

            _empBlasts.push({
                x: center.x, y: center.y,
                radius: 10,
                maxRadius: effectiveRange,
                timer: 15
            });
        }
    }

    function _processMortars() {
        var buildings = _getAllBuildings();
        var enemies = _getAllEnemies();

        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            if (b.type !== 'mortar') { continue; }
            var def = _getBuildingDef(b.type);
            if (!def) { continue; }
            if (!b.active || b.hp <= 0) { continue; }

            if (b.reloadTimer == null) { b.reloadTimer = 0; }
            if (b.reloadTimer > 0) { b.reloadTimer--; continue; }

            var effectiveRange = _getEffectiveRange(b, def.range);
            var minRange = def.minRange || 100;
            var center = _getBuildingCenter(b);
            var splashRadius = def.splashRadius || 80;

            // Find best cluster position
            var bestCount = 0;
            var bestX = 0, bestY = 0;
            for (var j = 0; j < enemies.length; j++) {
                var e = enemies[j];
                if (!e || e.hp <= 0) { continue; }
                var dist = _distance(center.x, center.y, e.x, e.y);
                if (dist < minRange || dist > effectiveRange) { continue; }

                var count = 0;
                for (var k = 0; k < enemies.length; k++) {
                    if (enemies[k] && enemies[k].hp > 0) {
                        if (_distance(e.x, e.y, enemies[k].x, enemies[k].y) <= splashRadius) {
                            count++;
                        }
                    }
                }
                if (count > bestCount) {
                    bestCount = count;
                    bestX = e.x;
                    bestY = e.y;
                }
            }
            if (bestCount === 0) { continue; }

            // Check iron
            var ironCost = def.ironPerShot || 2;
            if (typeof Economy !== 'undefined' && Economy.getResource) {
                if (Economy.getResource('iron') < ironCost) { continue; }
            } else { continue; }

            // Check energy
            var energyCost = def.energyPerShot || 200;
            if (b.energy < energyCost) { continue; }

            // Fire
            if (typeof Economy !== 'undefined' && Economy.spendResource) {
                Economy.spendResource('iron', ironCost);
            }
            b.energy -= energyCost;
            b.reloadTimer = def.reloadTicks || 30;

            var dx = bestX - center.x;
            var dy = bestY - center.y;
            var angle = Math.atan2(dy, dx);

            _projectiles.push({
                id: _nextProjectileId++,
                x: center.x, y: center.y,
                targetX: bestX, targetY: bestY,
                damage: def.damage || 60,
                speed: def.mortarSpeed || 200,
                type: 'mortar',
                angle: angle,
                distanceTraveled: 0,
                maxDistance: _distance(center.x, center.y, bestX, bestY),
                splashRadius: splashRadius,
                isMortar: true
            });
        }
    }

    function _processDroneBays() {
        var buildings = _getAllBuildings();
        var enemies = _getAllEnemies();
        var tps = _tps();

        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            if (b.type !== 'drone_bay') { continue; }
            var def = _getBuildingDef(b.type);
            if (!def) { continue; }
            if (!b.active || b.hp <= 0) { continue; }

            var maxDrones = def.maxDrones || 3;
            var spawnTicks = def.droneSpawnTicks || 240;

            // Count active drones for this bay
            var activeDrones = 0;
            for (var d = 0; d < _drones.length; d++) {
                if (_drones[d].bayId === b.id) { activeDrones++; }
            }

            // Spawn timer
            if (b.droneTimer == null) { b.droneTimer = 0; }
            if (activeDrones < maxDrones) {
                b.droneTimer++;
                if (b.droneTimer >= spawnTicks) {
                    // Check resources
                    var ironCost = def.droneIronCost || 10;
                    var energyCost = def.droneEnergyCost || 100;
                    var hasIron = true;
                    if (typeof Economy !== 'undefined' && Economy.getResource) {
                        hasIron = Economy.getResource('iron') >= ironCost;
                    } else { hasIron = false; }

                    if (hasIron && b.energy >= energyCost) {
                        if (typeof Economy !== 'undefined' && Economy.spendResource) {
                            Economy.spendResource('iron', ironCost);
                        }
                        b.energy -= energyCost;
                        var center = _getBuildingCenter(b);
                        _drones.push({
                            id: _nextDroneId++,
                            bayId: b.id,
                            x: center.x,
                            y: center.y,
                            hp: def.droneHP || 50,
                            maxHp: def.droneHP || 50,
                            targetId: null,
                            lifetime: def.droneLifetime || 600,
                            speed: def.droneSpeed || 120,
                            dps: def.droneDPS || 12,
                            homeX: center.x,
                            homeY: center.y,
                            range: def.droneRange || 500
                        });
                        b.droneTimer = 0;
                    }
                }
            } else {
                b.droneTimer = 0;
            }
        }

        // Update all drones
        var survivingDrones = [];
        for (var di = 0; di < _drones.length; di++) {
            var drone = _drones[di];
            drone.lifetime--;
            if (drone.lifetime <= 0 || drone.hp <= 0) { continue; }

            // Find closest enemy within range of home bay
            var bestDist = drone.range;
            var bestEnemy = null;
            for (var ei = 0; ei < enemies.length; ei++) {
                var en = enemies[ei];
                if (!en || en.hp <= 0) { continue; }
                var homeDist = _distance(drone.homeX, drone.homeY, en.x, en.y);
                if (homeDist > drone.range) { continue; }
                var droneDist = _distance(drone.x, drone.y, en.x, en.y);
                if (droneDist < bestDist) {
                    bestDist = droneDist;
                    bestEnemy = en;
                }
            }

            if (bestEnemy) {
                drone.targetId = bestEnemy.id;
                // Move toward enemy
                var ddx = bestEnemy.x - drone.x;
                var ddy = bestEnemy.y - drone.y;
                var dLen = Math.sqrt(ddx * ddx + ddy * ddy);
                if (dLen > 30) {
                    var moveSpeed = drone.speed / tps;
                    drone.x += (ddx / dLen) * moveSpeed;
                    drone.y += (ddy / dLen) * moveSpeed;
                } else {
                    // Attack
                    var dmg = drone.dps / tps;
                    if (typeof Enemies !== 'undefined' && Enemies.damageEnemy) {
                        Enemies.damageEnemy(bestEnemy.id, dmg, 0);
                    }
                }
            } else {
                drone.targetId = null;
                // Return toward home if too far
                var homeD = _distance(drone.x, drone.y, drone.homeX, drone.homeY);
                if (homeD > 50) {
                    var hx = drone.homeX - drone.x;
                    var hy = drone.homeY - drone.y;
                    var hLen = Math.sqrt(hx * hx + hy * hy);
                    var moveSpd = drone.speed / tps;
                    drone.x += (hx / hLen) * moveSpd;
                    drone.y += (hy / hLen) * moveSpd;
                }
            }

            survivingDrones.push(drone);
        }
        _drones = survivingDrones;
    }

    // ---- Plasma Cannon ----

    var _plasmaProjectiles = [];

    function _processPlasmaCanons() {
        var buildings = _getAllBuildings();
        var tps = _tps();

        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            if (b.type !== 'plasma_cannon') { continue; }
            var def = _getBuildingDef(b.type);
            if (!def) { continue; }
            if (!b.active || b.hp <= 0) { continue; }

            // Reload timer
            if (b.reloadTimer == null) { b.reloadTimer = 0; }
            if (b.reloadTimer > 0) { b.reloadTimer--; continue; }

            var effectiveRange = _getEffectiveRange(b, def.range);
            var center = _getBuildingCenter(b);

            // Find closest enemy in range
            var enemy = null;
            if (typeof Enemies !== 'undefined' && Enemies.getClosest) {
                enemy = Enemies.getClosest(center.x, center.y, effectiveRange);
            }
            if (!enemy) { continue; }

            // Check energy
            var energyCost = def.energyPerShot || 400;
            if (b.energy < energyCost) { continue; }

            // Check uranium
            var uraniumCost = def.uraniumPerShot || 1;
            var hasUranium = true;
            if (typeof Economy !== 'undefined' && Economy.getResource) {
                hasUranium = Economy.getResource('uranium') >= uraniumCost;
            } else { hasUranium = false; }
            if (!hasUranium) { continue; }

            // Fire
            b.energy -= energyCost;
            if (typeof Economy !== 'undefined' && Economy.spendResource) {
                Economy.spendResource('uranium', uraniumCost);
            }
            b.reloadTimer = def.reloadTicks || 15;

            // Create plasma projectile
            var dx = enemy.x - center.x;
            var dy = enemy.y - center.y;
            var angle = Math.atan2(dy, dx);
            _projectiles.push({
                id: _nextProjectileId++,
                x: center.x,
                y: center.y,
                targetId: enemy.id,
                damage: def.damage || 45,
                speed: 350,
                type: 'plasma',
                angle: angle,
                distanceTraveled: 0,
                maxDistance: effectiveRange * 1.5,
                armorBypass: def.armorBypass || 1.0
            });
        }
    }

    // ---- Fusion Beam ----

    var _fusionBeams = [];

    function _processFusionBeams() {
        var buildings = _getAllBuildings();
        var tps = _tps();

        _fusionBeams = [];

        for (var i = 0; i < buildings.length; i++) {
            var b = buildings[i];
            if (b.type !== 'fusion_beam') { continue; }
            var def = _getBuildingDef(b.type);
            if (!def) { continue; }

            if (!b.active || b.hp <= 0 || b.energy <= 0) {
                b.fusionRampTime = 0;
                continue;
            }

            var effectiveRange = _getEffectiveRange(b, def.range);
            var center = _getBuildingCenter(b);

            // Find closest enemy in range
            var enemy = null;
            if (typeof Enemies !== 'undefined' && Enemies.getClosest) {
                enemy = Enemies.getClosest(center.x, center.y, effectiveRange);
            }

            if (!enemy) {
                b.fusionRampTime = 0;
                b.target = null;
                continue;
            }

            // Target switch resets ramp
            if (b.target !== enemy.id) {
                b.fusionRampTime = 0;
            }
            b.target = enemy.id;

            if (b.fusionRampTime == null) { b.fusionRampTime = 0; }
            var rampInterval = (typeof Config !== 'undefined' && Config.FUSION_RAMP_INTERVAL != null)
                ? Config.FUSION_RAMP_INTERVAL : 0.33;
            b.fusionRampTime += 1 / tps;

            // Ramp multiplier: doubles every rampInterval seconds, capped at 32
            var maxRamp = 32;
            var rampMultiplier = Math.pow(2, Math.min(b.fusionRampTime / rampInterval, Math.log2(maxRamp)));

            var dps = (def.baseDPS || 20) * rampMultiplier;
            var damageThisTick = dps / tps;
            var energyDrawThisTick = (def.energyDraw || 80) * rampMultiplier / tps;

            // Uranium consumption
            var uraniumPerTick = (def.uraniumPerSecond || 0.5) / tps;
            var hasUranium = true;
            if (typeof Economy !== 'undefined' && Economy.getResource) {
                hasUranium = Economy.getResource('uranium') >= uraniumPerTick;
            } else { hasUranium = false; }

            if (!hasUranium) {
                b.fusionRampTime = 0;
                b.target = null;
                continue;
            }

            // Energy check — stop firing if insufficient
            if (b.energy < energyDrawThisTick) {
                b.fusionRampTime = 0;
                continue;
            }
            b.energy -= energyDrawThisTick;

            // Consume uranium
            if (typeof Economy !== 'undefined' && Economy.spendResource) {
                Economy.spendResource('uranium', uraniumPerTick);
            }

            // Apply damage with high armor bypass
            var armorBypass = (typeof Config !== 'undefined' && Config.FUSION_ARMOR_BYPASS != null)
                ? Config.FUSION_ARMOR_BYPASS : 0.8;
            var killed = false;
            if (typeof Enemies !== 'undefined' && Enemies.damageEnemy) {
                killed = Enemies.damageEnemy(enemy.id, damageThisTick, armorBypass);
            }

            // Add beam for rendering
            _fusionBeams.push({
                fromX: center.x,
                fromY: center.y,
                toX: enemy.x,
                toY: enemy.y,
                rampLevel: rampMultiplier,
                buildingId: b.id
            });

            if (killed) {
                b.target = null;
                b.fusionRampTime = 0;
            }
        }
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
            _processTeslaCoils();
            _processFlamethrowers();
            _processRailguns();
            _processEmpTowers();
            _processMortars();
            _processDroneBays();
            _processPlasmaCanons();
            _processFusionBeams();
            _handleSpecialEnemies();
        },

        getProjectiles: function() { return _projectiles; },
        getLaserBeams: function() { return _laserBeams; },

        getEmpDisabled: function() { return _empDisabled; },

        getTeslaChains: function() { return _teslaChains; },
        getRailShots: function() { return _railShots; },
        getEmpBlasts: function() { return _empBlasts; },
        getDrones: function() { return _drones; },
        getFusionBeams: function() { return _fusionBeams; },

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

            // Serialize rail shots
            var railData = [];
            for (var ri = 0; ri < _railShots.length; ri++) {
                railData.push({
                    fromX: _railShots[ri].fromX, fromY: _railShots[ri].fromY,
                    toX: _railShots[ri].toX, toY: _railShots[ri].toY,
                    timer: _railShots[ri].timer
                });
            }

            // Serialize EMP blasts
            var blastData = [];
            for (var bi2 = 0; bi2 < _empBlasts.length; bi2++) {
                blastData.push({
                    x: _empBlasts[bi2].x, y: _empBlasts[bi2].y,
                    radius: _empBlasts[bi2].radius,
                    maxRadius: _empBlasts[bi2].maxRadius,
                    timer: _empBlasts[bi2].timer
                });
            }

            // Serialize drones
            var droneData = [];
            for (var di = 0; di < _drones.length; di++) {
                var dr = _drones[di];
                droneData.push({
                    id: dr.id, bayId: dr.bayId,
                    x: dr.x, y: dr.y,
                    hp: dr.hp, maxHp: dr.maxHp,
                    targetId: dr.targetId,
                    lifetime: dr.lifetime,
                    speed: dr.speed, dps: dr.dps,
                    homeX: dr.homeX, homeY: dr.homeY,
                    range: dr.range
                });
            }

            return {
                projectiles: projData,
                nextProjectileId: _nextProjectileId,
                empDisabled: empData,
                railShots: railData,
                empBlasts: blastData,
                drones: droneData,
                nextDroneId: _nextDroneId
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

            _railShots = [];
            if (data.railShots) {
                for (var ri = 0; ri < data.railShots.length; ri++) {
                    _railShots.push(data.railShots[ri]);
                }
            }

            _empBlasts = [];
            if (data.empBlasts) {
                for (var bi2 = 0; bi2 < data.empBlasts.length; bi2++) {
                    _empBlasts.push(data.empBlasts[bi2]);
                }
            }

            _drones = [];
            if (data.drones) {
                for (var di = 0; di < data.drones.length; di++) {
                    _drones.push(data.drones[di]);
                }
            }

            _nextDroneId = data.nextDroneId || 1;
        }
    };
})();

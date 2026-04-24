// ============================================================================
// Volt Defense — Master Configuration
// Single source of truth for ALL game constants, buildings, enemies, waves.
// ============================================================================

var Config = {

    // ------------------------------------------------------------------------
    // General
    // ------------------------------------------------------------------------
    VERSION: '0.1.0',
    TICK_RATE: 100,             // ms per tick
    TICKS_PER_SECOND: 10,

    // Map & viewport
    MAP_WIDTH: 10000,
    MAP_HEIGHT: 10000,
    GRID_CELL_SIZE: 40,
    VIEWPORT_WIDTH: 1920,
    VIEWPORT_HEIGHT: 1080,

    // Day/Night & Wind
    DAY_NIGHT_CYCLE: 24,        // seconds for full cycle (12s day, 12s night)
    WIND_CHANGE_INTERVAL: 24,   // seconds between wind speed changes
    WIND_MAX_SPEED: 30,         // mph max
    WIND_BASELINE_SPEED: 15,    // mph where turbines produce rated output

    // Cables
    CABLE_MAX_LENGTH: 200,
    CABLE_MAX_PER_BUILDING: 4,
    CABLE_MAX_THROUGHPUT: 50,
    CABLE_COST: 25,
    HC_CABLE_MAX_THROUGHPUT: 500,
    HC_CABLE_COST_PER_TILE: 50,

    // Placement
    MAX_PLACEMENT_DISTANCE: 200,

    // Hydro
    HYDRO_CURRENT_REDUCTION: 0.15,
    MIN_CURRENT_SPEED: 0.05,

    // Consumer battery
    CONSUMER_BATTERY_SELL_PRICE: 1500,

    // Laser
    LASER_RAMP_INTERVAL: 1.0,
    LASER_ARMOR_BYPASS: 0.5,

    // Missile
    MISSILE_HOMING_ANGLE: 15,
    MISSILE_MAX_RANGE_MULT: 1.5,

    // Fusion Beam
    FUSION_RAMP_INTERVAL: 0.33,  // ramps 3x faster than lasers
    FUSION_ARMOR_BYPASS: 0.8,    // pierces most armor

    // Shield
    SHIELD_DIAMETER: 400,
    SHIELD_POWER_DRAIN_ON_HIT: 50,
    SHIELD_PASSIVE_DRAIN: 0,
    SHIELD_DECAY_RATE: 0.1,

    // Pollution
    POLLUTION_PASSIVE_DECAY: 0.1,           // per tick
    POLLUTION_THRESHOLD_LOW: 50,
    POLLUTION_THRESHOLD_MODERATE: 150,
    POLLUTION_THRESHOLD_HIGH: 300,
    POLLUTION_THRESHOLD_CRITICAL: 500,
    POLLUTION_ENEMY_SPEED_BOOST_MOD: 0.10,
    POLLUTION_ENEMY_SPEED_BOOST_HIGH: 0.20,
    POLLUTION_ENERGY_PENALTY_CRITICAL: 0.20,

    // Workers
    WORKER_RECRUIT_INTERVAL: 30,            // ticks
    WORKER_RECRUIT_AMOUNT: 1,
    WORKER_HOMELESS_GRACE: 300,             // ticks
    WORKER_DEPART_INTERVAL_HIGH: 100,       // ticks
    WORKER_DEPART_INTERVAL_CRITICAL: 50,    // ticks

    // Waves
    FIRST_WAVE_DELAY: 120,                  // seconds
    WAVE_INTERVAL: 60,                      // seconds
    WAVE_COMPLETION_BASE: 500,
    WAVE_COMPLETION_SCALE: 100,

    // Starting resources
    START_MONEY: 2000,
    START_COAL: 50,
    CORE_HP: 100,
    SELL_REFUND_RATIO: 0.5,

    // ------------------------------------------------------------------------
    // Terrain Types
    // ------------------------------------------------------------------------
    TERRAIN_TYPES: {
        grass: 0,
        rock: 1,
        water: 2,
        deep_water: 3,
        iron_deposit: 10,
        coal_deposit: 11,
        uranium_deposit: 12
    },

    // ------------------------------------------------------------------------
    // Buildings
    // ------------------------------------------------------------------------
    BUILDINGS: {

        // ---- Power --------------------------------------------------------
        solar: {
            name: 'Solar Panel',
            category: 'power',
            cost: { money: 300 },
            size: [1, 1],
            hp: 60,
            workersRequired: 1,
            energyGeneration: 30,
            energyConsumption: 0,
            energyStorageCapacity: 0,
            maxChargeRate: 0,
            maxDischargeRate: 0,
            pollution: 0,
            upgradeTo: null,
            description: 'Generates 30 energy during daytime only. No output at night.',
            icon: '☀️'
        },
        wind: {
            name: 'Wind Turbine',
            category: 'power',
            cost: { money: 250 },
            size: [1, 1],
            hp: 50,
            workersRequired: 1,
            energyGeneration: 25,
            energyConsumption: 0,
            energyStorageCapacity: 0,
            maxChargeRate: 0,
            maxDischargeRate: 0,
            pollution: 0,
            variability: 0.2,
            upgradeTo: null,
            description: 'Generates 25 energy. Output fluctuates with wind.',
            icon: '🌀'
        },
        coal_plant: {
            name: 'Coal Plant',
            category: 'power',
            cost: { money: 500 },
            size: [2, 2],
            hp: 120,
            workersRequired: 3,
            energyGeneration: 80,
            energyConsumption: 0,
            energyStorageCapacity: 0,
            maxChargeRate: 0,
            maxDischargeRate: 0,
            pollution: 0.3,
            fuelCost: { coal: 2 },
            fuelInterval: 10,           // ticks
            upgradeTo: 'gas_plant',
            description: 'Reliable 80 energy. Burns 2 coal every 10 ticks. Pollutes.',
            icon: '🏭'
        },
        gas_plant: {
            name: 'Gas Plant',
            category: 'power',
            cost: { money: 800 },
            size: [2, 2],
            hp: 100,
            workersRequired: 3,
            energyGeneration: 100,
            energyConsumption: 0,
            energyStorageCapacity: 0,
            maxChargeRate: 0,
            maxDischargeRate: 0,
            pollution: 0.2,
            fuelCost: { coal: 1 },
            fuelInterval: 10,
            upgradeTo: null,
            description: 'Upgraded plant. 100 energy, less fuel and pollution.',
            icon: '🏗️'
        },
        nuclear_plant: {
            name: 'Nuclear Plant',
            category: 'power',
            cost: { money: 5000, iron: 200 },
            size: [2, 2],
            hp: 200,
            workersRequired: 8,
            energyGeneration: 300,
            energyConsumption: 0,
            energyStorageCapacity: 0,
            maxChargeRate: 0,
            maxDischargeRate: 0,
            pollution: 0.1,
            fuelCost: { uranium: 1 },
            fuelInterval: 50,
            upgradeTo: null,
            description: 'Massive 300 energy output. Requires uranium fuel.',
            icon: '☢️'
        },
        hydro_plant: {
            name: 'Hydro Plant',
            category: 'power',
            cost: { money: 600 },
            size: [1, 1],
            hp: 80,
            workersRequired: 2,
            energyGeneration: 60,
            energyConsumption: 0,
            energyStorageCapacity: 0,
            maxChargeRate: 0,
            maxDischargeRate: 0,
            pollution: 0,
            requiresTerrain: 'water',
            upgradeTo: null,
            description: 'Generates up to 60 energy, scaled by current speed.',
            icon: '🌊'
        },

        // ---- Storage ------------------------------------------------------
        small_battery: {
            name: 'Small Battery',
            category: 'storage',
            cost: { money: 200 },
            size: [1, 1],
            hp: 60,
            workersRequired: 1,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 500,
            maxChargeRate: 20,
            maxDischargeRate: 20,
            pollution: 0,
            upgradeTo: 'large_battery',
            description: 'Stores 500 energy. Steady charge/discharge.',
            icon: '🔋'
        },
        large_battery: {
            name: 'Large Battery',
            category: 'storage',
            cost: { money: 800 },
            size: [1, 1],
            hp: 80,
            workersRequired: 1,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 2000,
            maxChargeRate: 40,
            maxDischargeRate: 40,
            pollution: 0,
            upgradeTo: null,
            description: 'Stores 2000 energy with faster throughput.',
            icon: '🔋'
        },
        capacitor: {
            name: 'Capacitor',
            category: 'storage',
            cost: { money: 600 },
            size: [1, 1],
            hp: 40,
            workersRequired: 1,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 200,
            maxChargeRate: 200,
            maxDischargeRate: 200,
            pollution: 0,
            upgradeTo: null,
            description: 'Low capacity but extremely fast charge/discharge.',
            icon: '⚡'
        },
        consumer_battery: {
            name: 'Consumer Battery',
            category: 'storage',
            cost: { money: 400 },
            size: [1, 1],
            hp: 60,
            workersRequired: 1,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 5000,
            maxChargeRate: 50,
            maxDischargeRate: 0,
            pollution: 0,
            sellPrice: 1500,
            upgradeTo: null,
            description: 'Charge to full and sell for $1500. Cannot discharge.',
            icon: '💰'
        },

        // ---- Mining -------------------------------------------------------
        iron_miner: {
            name: 'Iron Miner',
            category: 'mining',
            cost: { money: 400 },
            size: [1, 1],
            hp: 80,
            workersRequired: 2,
            energyGeneration: 0,
            energyConsumption: 15,
            energyStorageCapacity: 0,
            maxChargeRate: 0,
            maxDischargeRate: 0,
            pollution: 0,
            requiresTerrain: 'iron_deposit',
            extractionRate: 1,
            upgradeTo: 'iron_miner_t2',
            description: 'Extracts 1 iron per cycle from iron deposits.',
            icon: '⛏️'
        },
        iron_miner_t2: {
            name: 'Iron Miner T2',
            category: 'mining',
            cost: { money: 900, iron: 30 },
            size: [1, 1],
            hp: 120,
            workersRequired: 3,
            energyGeneration: 0,
            energyConsumption: 25,
            energyStorageCapacity: 0,
            maxChargeRate: 0,
            maxDischargeRate: 0,
            pollution: 0,
            requiresTerrain: 'iron_deposit',
            extractionRate: 2.5,
            upgradeTo: null,
            description: 'Advanced iron miner. Extracts 2.5 iron per cycle.',
            icon: '⛏️'
        },
        coal_miner: {
            name: 'Coal Miner',
            category: 'mining',
            cost: { money: 350 },
            size: [1, 1],
            hp: 80,
            workersRequired: 2,
            energyGeneration: 0,
            energyConsumption: 15,
            energyStorageCapacity: 0,
            maxChargeRate: 0,
            maxDischargeRate: 0,
            pollution: 0,
            requiresTerrain: 'coal_deposit',
            extractionRate: 1,
            upgradeTo: 'coal_miner_t2',
            description: 'Extracts 1 coal per cycle from coal deposits.',
            icon: '⛏️'
        },
        coal_miner_t2: {
            name: 'Coal Miner T2',
            category: 'mining',
            cost: { money: 800 },
            size: [1, 1],
            hp: 120,
            workersRequired: 3,
            energyGeneration: 0,
            energyConsumption: 25,
            energyStorageCapacity: 0,
            maxChargeRate: 0,
            maxDischargeRate: 0,
            pollution: 0,
            requiresTerrain: 'coal_deposit',
            extractionRate: 2.5,
            upgradeTo: null,
            description: 'Advanced coal miner. Extracts 2.5 coal per cycle.',
            icon: '⛏️'
        },
        uranium_miner: {
            name: 'Uranium Miner',
            category: 'mining',
            cost: { money: 1000, iron: 100 },
            size: [1, 1],
            hp: 100,
            workersRequired: 3,
            energyGeneration: 0,
            energyConsumption: 30,
            energyStorageCapacity: 0,
            maxChargeRate: 0,
            maxDischargeRate: 0,
            pollution: 0,
            requiresTerrain: 'uranium_deposit',
            extractionRate: 0.5,
            upgradeTo: 'uranium_miner_t2',
            description: 'Extracts 0.5 uranium per cycle. Expensive but essential.',
            icon: '☢️'
        },
        uranium_miner_t2: {
            name: 'Uranium Miner T2',
            category: 'mining',
            cost: { money: 2500, iron: 200 },
            size: [1, 1],
            hp: 150,
            workersRequired: 4,
            energyGeneration: 0,
            energyConsumption: 50,
            energyStorageCapacity: 0,
            maxChargeRate: 0,
            maxDischargeRate: 0,
            pollution: 0,
            requiresTerrain: 'uranium_deposit',
            extractionRate: 1.2,
            upgradeTo: null,
            description: 'Advanced uranium miner. Extracts 1.2 uranium per cycle.',
            icon: '☢️'
        },

        // ---- Weapons ------------------------------------------------------
        laser_t1: {
            name: 'Laser Turret T1',
            category: 'weapons',
            cost: { money: 500 },
            size: [1, 1],
            hp: 80,
            workersRequired: 2,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 300,
            maxChargeRate: 100,
            maxDischargeRate: 0,
            pollution: 0,
            baseDPS: 5,
            range: 300,
            baseEnergyDraw: 30,
            maxRamp: 16,
            upgradeTo: 'laser_t2',
            description: 'Continuous beam. DPS ramps up the longer it fires.',
            icon: '🔴'
        },
        laser_t2: {
            name: 'Laser Turret T2',
            category: 'weapons',
            cost: { money: 1500 },
            size: [1, 1],
            hp: 100,
            workersRequired: 3,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 600,
            maxChargeRate: 200,
            maxDischargeRate: 0,
            pollution: 0,
            baseDPS: 12,
            range: 400,
            baseEnergyDraw: 60,
            maxRamp: 16,
            upgradeTo: 'laser_t3',
            description: 'Upgraded laser. Higher DPS and longer range.',
            icon: '🔴'
        },
        laser_t3: {
            name: 'Laser Turret T3',
            category: 'weapons',
            cost: { money: 4000 },
            size: [1, 1],
            hp: 120,
            workersRequired: 5,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 1000,
            maxChargeRate: 300,
            maxDischargeRate: 0,
            pollution: 0,
            baseDPS: 25,
            range: 500,
            baseEnergyDraw: 100,
            maxRamp: 32,
            upgradeTo: null,
            description: 'Top-tier laser. Devastating sustained damage.',
            icon: '🔴'
        },
        missile_t1: {
            name: 'Missile Launcher T1',
            category: 'weapons',
            cost: { money: 400, iron: 50 },
            size: [1, 1],
            hp: 80,
            workersRequired: 2,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 100,
            maxChargeRate: 50,
            maxDischargeRate: 0,
            pollution: 0,
            damage: 40,
            range: 500,
            energyPerShot: 100,
            reloadTicks: 20,
            ironPerShot: 1,
            missileSpeed: 300,
            upgradeTo: 'missile_t2',
            description: 'Fires homing missiles. Costs iron per shot.',
            icon: '🚀'
        },
        missile_t2: {
            name: 'Missile Launcher T2',
            category: 'weapons',
            cost: { money: 1200, iron: 100 },
            size: [1, 1],
            hp: 100,
            workersRequired: 3,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 200,
            maxChargeRate: 100,
            maxDischargeRate: 0,
            pollution: 0,
            damage: 100,
            range: 650,
            energyPerShot: 100,
            reloadTicks: 25,
            ironPerShot: 2,
            missileSpeed: 350,
            upgradeTo: 'missile_t3',
            description: 'Upgraded missiles. Higher damage and range.',
            icon: '🚀'
        },
        missile_t3: {
            name: 'Missile Launcher T3',
            category: 'weapons',
            cost: { money: 3000, iron: 200 },
            size: [1, 1],
            hp: 120,
            workersRequired: 4,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 400,
            maxChargeRate: 200,
            maxDischargeRate: 0,
            pollution: 0,
            damage: 250,
            range: 800,
            energyPerShot: 100,
            reloadTicks: 30,
            ironPerShot: 5,
            missileSpeed: 400,
            upgradeTo: null,
            description: 'Heavy missiles. Devastating single-target damage.',
            icon: '🚀'
        },

        tesla_coil: {
            name: 'Tesla Coil',
            category: 'weapons',
            cost: { money: 800 },
            size: [1, 1],
            hp: 80,
            workersRequired: 2,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 500,
            maxChargeRate: 150,
            maxDischargeRate: 0,
            pollution: 0,
            baseDamage: 15,
            range: 250,
            energyDraw: 50,
            chainCount: 3,
            chainRange: 150,
            chainDecay: 0.7,
            upgradeTo: null,
            description: 'Chain lightning hits closest enemy and jumps to up to 3 more within 150px, dealing 70% damage per jump.',
            icon: '⚡'
        },

        flamethrower: {
            name: 'Flamethrower',
            category: 'weapons',
            cost: { money: 600, coal: 30 },
            size: [1, 1],
            hp: 70,
            workersRequired: 2,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 200,
            maxChargeRate: 80,
            maxDischargeRate: 0,
            pollution: 0,
            baseDPS: 8,
            range: 150,
            energyDraw: 20,
            coalPerTick: 0.02,
            burnDPS: 3,
            burnDuration: 30,
            upgradeTo: null,
            description: 'Short-range AoE that damages all enemies in range. Burns 1 coal per 50 ticks while firing. Applies burning DOT: 3 DPS for 3 seconds.',
            icon: '🔥'
        },

        railgun: {
            name: 'Railgun',
            category: 'weapons',
            cost: { money: 2000, iron: 100 },
            size: [1, 1],
            hp: 90,
            workersRequired: 3,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 1000,
            maxChargeRate: 250,
            maxDischargeRate: 0,
            pollution: 0,
            damage: 100,
            range: 800,
            energyPerShot: 375,
            reloadTicks: 40,
            ironPerShot: 3,
            upgradeTo: null,
            description: 'Piercing shot damages all enemies in a line. Long range, high damage.',
            icon: '🔫'
        },

        emp_tower: {
            name: 'EMP Tower',
            category: 'weapons',
            cost: { money: 1500, iron: 50 },
            size: [1, 1],
            hp: 100,
            workersRequired: 2,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 2000,
            maxChargeRate: 200,
            maxDischargeRate: 0,
            pollution: 0,
            range: 400,
            energyPerActivation: 1500,
            cooldownTicks: 100,
            stunDuration: 30,
            upgradeTo: null,
            description: 'Stuns all enemies in range for 30 ticks. High energy cost per activation.',
            icon: '📡'
        },

        mortar: {
            name: 'Mortar',
            category: 'weapons',
            cost: { money: 700, iron: 40 },
            size: [1, 1],
            hp: 80,
            workersRequired: 2,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 300,
            maxChargeRate: 100,
            maxDischargeRate: 0,
            pollution: 0,
            damage: 60,
            range: 600,
            minRange: 100,
            energyPerShot: 200,
            reloadTicks: 30,
            ironPerShot: 2,
            splashRadius: 80,
            mortarSpeed: 200,
            upgradeTo: null,
            description: 'Lobs explosive shells. Splash damage hits all enemies within 80px radius. Cannot fire at close range.',
            icon: '💥'
        },

        drone_bay: {
            name: 'Drone Bay',
            category: 'weapons',
            cost: { money: 2500, iron: 150 },
            size: [1, 1],
            hp: 120,
            workersRequired: 4,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 800,
            maxChargeRate: 200,
            maxDischargeRate: 0,
            pollution: 0,
            maxDrones: 3,
            droneSpawnTicks: 240,
            droneIronCost: 20,
            droneEnergyCost: 500,
            droneHP: 50,
            droneDPS: 24,
            droneSpeed: 120,
            droneRange: 500,
            droneLifetime: 600,
            upgradeTo: null,
            description: 'Spawns autonomous drones that seek and destroy enemies. Max 3 active drones.',
            icon: '🛸'
        },

        // ---- Uranium Weapons --------------------------------------------------
        plasma_cannon: {
            name: 'Plasma Cannon',
            category: 'weapons',
            cost: { money: 3000, uranium: 20 },
            size: [1, 1],
            hp: 100,
            workersRequired: 3,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 1200,
            maxChargeRate: 300,
            maxDischargeRate: 0,
            pollution: 5,
            range: 500,
            damage: 400,
            energyPerShot: 250,
            uraniumPerShot: 1,
            reloadTicks: 15,
            armorBypass: 1.0,
            upgradeTo: null,
            description: 'Fires superheated plasma bolts that ignore all enemy armor. Uses uranium fuel rods.',
            icon: '🔮'
        },
        fusion_beam: {
            name: 'Fusion Beam',
            category: 'weapons',
            cost: { money: 5000, uranium: 50, iron: 80 },
            size: [2, 2],
            hp: 150,
            workersRequired: 5,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 3000,
            maxChargeRate: 500,
            maxDischargeRate: 0,
            pollution: 8,
            range: 1200,
            baseDPS: 20,
            energyDraw: 80,
            uraniumPerSecond: 0.5,
            upgradeTo: null,
            description: 'Ultra-long-range continuous beam. Ramps 3x faster than lasers, ignores most armor. Consumes uranium.',
            icon: '⚛️'
        },

        // ---- Defense ------------------------------------------------------
        shield_t1: {
            name: 'Shield Generator T1',
            category: 'defense',
            cost: { money: 1500, iron: 50 },
            size: [2, 2],
            hp: 150,
            workersRequired: 3,
            energyGeneration: 0,
            energyConsumption: 20,
            energyStorageCapacity: 500,
            maxChargeRate: 100,
            maxDischargeRate: 0,
            pollution: 0,
            shieldHP: 500,
            shieldDiameter: 400,
            shieldEnergyCostPerDamage: 50,
            upgradeTo: 'shield_t2',
            description: 'Projects a shield dome. Drains energy when hit.',
            icon: '🛡️'
        },
        shield_t2: {
            name: 'Shield Generator T2',
            category: 'defense',
            cost: { money: 4000, iron: 150 },
            size: [2, 2],
            hp: 250,
            workersRequired: 5,
            energyGeneration: 0,
            energyConsumption: 40,
            energyStorageCapacity: 1000,
            maxChargeRate: 200,
            maxDischargeRate: 0,
            pollution: 0,
            shieldHP: 1200,
            shieldDiameter: 400,
            shieldEnergyCostPerDamage: 40,
            upgradeTo: null,
            description: 'Upgraded shield. More HP and efficient energy use.',
            icon: '🛡️'
        },

        // ---- Housing ------------------------------------------------------
        small_house: {
            name: 'Small House',
            category: 'housing',
            cost: { money: 150 },
            size: [1, 1],
            hp: 60,
            workersRequired: 0,
            workersHoused: 4,
            energyGeneration: 0,
            energyConsumption: 3,
            energyStorageCapacity: 10,
            maxChargeRate: 10,
            maxDischargeRate: 0,
            pollution: 0,
            upgradeTo: 'medium_house',
            description: 'Houses 4 workers. Requires a small amount of power.',
            icon: '🏠'
        },
        medium_house: {
            name: 'Medium House',
            category: 'housing',
            cost: { money: 500 },
            size: [1, 1],
            hp: 80,
            workersRequired: 0,
            workersHoused: 12,
            energyGeneration: 0,
            energyConsumption: 7,
            energyStorageCapacity: 20,
            maxChargeRate: 15,
            maxDischargeRate: 0,
            pollution: 0,
            upgradeTo: 'large_house',
            description: 'Houses 12 workers. Moderate power draw.',
            icon: '🏘️'
        },
        large_house: {
            name: 'Large House',
            category: 'housing',
            cost: { money: 1200, iron: 30 },
            size: [2, 2],
            hp: 120,
            workersRequired: 0,
            workersHoused: 30,
            energyGeneration: 0,
            energyConsumption: 14,
            energyStorageCapacity: 40,
            maxChargeRate: 25,
            maxDischargeRate: 0,
            pollution: 0,
            upgradeTo: null,
            description: 'Houses 30 workers. Efficient large-scale housing.',
            icon: '🏢'
        },

        // ---- Environment --------------------------------------------------
        carbon_collector_t1: {
            name: 'Carbon Collector T1',
            category: 'environment',
            cost: { money: 800 },
            size: [1, 1],
            hp: 60,
            workersRequired: 2,
            energyGeneration: 0,
            energyConsumption: 25,
            energyStorageCapacity: 100,
            maxChargeRate: 60,
            maxDischargeRate: 0,
            pollution: 0,
            pollutionReduction: 2,
            upgradeTo: 'carbon_collector_t2',
            description: 'Reduces pollution by 2 per tick. Power-hungry.',
            icon: '🌿'
        },
        carbon_collector_t2: {
            name: 'Carbon Collector T2',
            category: 'environment',
            cost: { money: 2000, iron: 50 },
            size: [2, 2],
            hp: 100,
            workersRequired: 3,
            energyGeneration: 0,
            energyConsumption: 80,
            energyStorageCapacity: 200,
            maxChargeRate: 120,
            maxDischargeRate: 0,
            pollution: 0,
            pollutionReduction: 5,
            upgradeTo: null,
            description: 'Reduces pollution by 5 per tick. Very power-hungry.',
            icon: '🌳'
        },

        // ---- Grid ---------------------------------------------------------
        pylon: {
            name: 'Pylon',
            category: 'grid',
            cost: { money: 50 },
            size: [1, 1],
            hp: 50,
            workersRequired: 0,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 10,
            maxChargeRate: 50,
            maxDischargeRate: 50,
            pollution: 0,
            upgradeTo: null,
            description: 'Relay node. Extends cable network cheaply.',
            icon: '📡'
        },
        water_pylon: {
            name: 'Water Pylon',
            category: 'grid',
            cost: { money: 200 },
            size: [1, 1],
            hp: 50,
            workersRequired: 0,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 10,
            maxChargeRate: 50,
            maxDischargeRate: 50,
            pollution: 0,
            requiresWater: true,
            upgradeTo: null,
            description: 'Relay node for water tiles. Extends cable network across rivers.',
            icon: '🌊'
        },
        hc_pylon: {
            name: 'HC Pylon',
            category: 'grid',
            cost: { money: 400 },
            size: [1, 1],
            hp: 60,
            workersRequired: 0,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 50,
            maxChargeRate: 500,
            maxDischargeRate: 500,
            pollution: 0,
            upgradeTo: null,
            description: 'High-capacity relay. 500 energy/tick throughput for heavy power lines.',
            icon: '⚡'
        },
        core: {
            name: 'Core',
            category: 'grid',
            cost: { money: 0 },
            size: [2, 2],
            hp: 100,
            workersRequired: 0,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 50,
            maxChargeRate: 0,
            maxDischargeRate: 0,
            pollution: 0,
            upgradeTo: null,
            buildable: false,
            description: 'Your base. If this falls, you lose.',
            icon: '🏛️'
        },
        grid_connect: {
            name: 'Consumer Grid Connect',
            category: 'grid',
            cost: { money: 250 },
            size: [1, 1],
            hp: 60,
            workersRequired: 1,
            energyGeneration: 0,
            energyConsumption: 8,
            energyStorageCapacity: 50,
            maxChargeRate: 20,
            maxDischargeRate: 0,
            pollution: 0,
            moneyPerSecond: 3,
            upgradeTo: null,
            description: 'Sells power to the consumer grid. Slowly earns $3/s while powered.',
            icon: '🔌'
        },

        // ---- Defense (Wall) -----------------------------------------------
        wall: {
            name: 'Wall',
            category: 'defense',
            cost: { money: 100, iron: 1 },
            size: [1, 1],
            hp: 200,
            workersRequired: 0,
            energyGeneration: 0,
            energyConsumption: 0,
            energyStorageCapacity: 0,
            maxChargeRate: 0,
            maxDischargeRate: 0,
            pollution: 0,
            upgradeTo: null,
            description: 'Blocks enemy movement. Enemies must path around or destroy it.',
            icon: '🧱'
        }
    },

    // ------------------------------------------------------------------------
    // Enemies
    // ------------------------------------------------------------------------
    ENEMIES: {
        spark: {
            name: 'Spark',
            hp: 20,
            speed: 80,
            damage: 3,
            armor: 0,
            killReward: 10,
            icon: '⚡',
            special: null,
            firstWave: 1
        },
        runner: {
            name: 'Runner',
            hp: 30,
            speed: 140,
            damage: 5,
            armor: 0,
            killReward: 16,
            icon: '💨',
            special: null,
            firstWave: 2
        },
        grunt: {
            name: 'Grunt',
            hp: 80,
            speed: 60,
            damage: 10,
            armor: 2,
            killReward: 24,
            icon: '👹',
            special: null,
            firstWave: 3
        },
        shielded_grunt: {
            name: 'Shielded Grunt',
            hp: 80,
            speed: 55,
            damage: 10,
            armor: 6,
            killReward: 36,
            icon: '🛡️',
            special: null,
            firstWave: 6
        },
        bomber: {
            name: 'Bomber',
            hp: 120,
            speed: 70,
            damage: 40,
            armor: 3,
            killReward: 100,
            icon: '💣',
            special: 'targets_power',
            firstWave: 4
        },
        tank: {
            name: 'Tank',
            hp: 350,
            speed: 30,
            damage: 25,
            armor: 8,
            killReward: 160,
            icon: '🐢',
            special: null,
            firstWave: 10
        },
        emp_drone: {
            name: 'EMP Drone',
            hp: 50,
            speed: 110,
            damage: 0,
            armor: 0,
            killReward: 30,
            icon: '🤖',
            special: 'emp_disable',
            firstWave: 13
        },
        swarm: {
            name: 'Swarm',
            hp: 15,
            speed: 100,
            damage: 2,
            armor: 0,
            killReward: 6,
            icon: '🐝',
            special: null,
            firstWave: 16
        },
        heavy_tank: {
            name: 'Heavy Tank',
            hp: 800,
            speed: 20,
            damage: 50,
            armor: 12,
            killReward: 160,
            icon: '🦏',
            special: null,
            firstWave: 20
        },
        saboteur: {
            name: 'Saboteur',
            hp: 60,
            speed: 90,
            damage: 5,
            armor: 0,
            killReward: 40,
            icon: '🕵️',
            special: 'targets_grid',
            firstWave: 25
        },
        siege_engine: {
            name: 'Siege Engine',
            hp: 1500,
            speed: 12,
            damage: 100,
            armor: 18,
            killReward: 400,
            icon: '🏰',
            special: null,
            firstWave: 30
        },
        phase_walker: {
            name: 'Phase Walker',
            hp: 200,
            speed: 70,
            damage: 15,
            armor: 0,
            killReward: 100,
            icon: '👻',
            special: 'ignores_shields',
            firstWave: 40
        },
        jammer: {
            name: 'Jammer',
            hp: 150,
            speed: 50,
            damage: 10,
            armor: 5,
            killReward: 70,
            icon: '📡',
            special: 'reduces_range',
            firstWave: 50
        },
        river_serpent: {
            name: 'River Serpent',
            hp: 100,
            speed: 90,
            damage: 20,
            armor: 2,
            killReward: 50,
            icon: '🐍',
            special: 'river_spawn',
            firstWave: 6
        },
        home_wrecker: {
            name: 'Home Wrecker',
            hp: 150,
            speed: 65,
            damage: 30,
            armor: 4,
            killReward: 60,
            icon: '🏚️',
            special: 'targets_housing',
            firstWave: 8
        },
        drill_worm: {
            name: 'Drill Worm',
            hp: 120,
            speed: 55,
            damage: 25,
            armor: 3,
            killReward: 55,
            icon: '🪱',
            special: 'targets_mining',
            firstWave: 10
        },
        disruptor: {
            name: 'Disruptor',
            hp: 100,
            speed: 75,
            damage: 20,
            armor: 2,
            killReward: 65,
            icon: '💥',
            special: 'targets_weapons',
            firstWave: 12
        },
        leech: {
            name: 'Leech',
            hp: 80,
            speed: 70,
            damage: 15,
            armor: 1,
            killReward: 55,
            icon: '🔋',
            special: 'targets_storage',
            firstWave: 14
        },
        nullifier: {
            name: 'Nullifier',
            hp: 180,
            speed: 50,
            damage: 35,
            armor: 5,
            killReward: 80,
            icon: '🚫',
            special: 'targets_shields',
            firstWave: 18
        },
        overload_boss: {
            name: 'Overload Boss',
            hp: 3000,
            speed: 25,
            damage: 80,
            armor: 15,
            killReward: 1000,
            icon: '⚡👑',
            special: 'boss',
            firstWave: 20,
            isBoss: true
        }
    },

    // ------------------------------------------------------------------------
    // Wave Definitions (1–50)
    // ------------------------------------------------------------------------
    WAVES: [
        // Wave 1: Intro
        { number: 1, enemies: [{ type: 'spark', count: 3 }], spawnDelay: 800, spawnPoints: 1 },
        // Wave 2
        { number: 2, enemies: [{ type: 'spark', count: 5 }, { type: 'runner', count: 2 }], spawnDelay: 700, spawnPoints: 1 },
        // Wave 3
        { number: 3, enemies: [{ type: 'grunt', count: 3 }, { type: 'spark', count: 4 }], spawnDelay: 600, spawnPoints: 1 },
        // Wave 4: Bombers arrive (target power plants)
        { number: 4, enemies: [{ type: 'grunt', count: 4 }, { type: 'bomber', count: 2 }, { type: 'runner', count: 3 }], spawnDelay: 600, spawnPoints: 1 },
        // Wave 5
        { number: 5, enemies: [{ type: 'grunt', count: 6 }, { type: 'bomber', count: 2 }, { type: 'runner', count: 5 }], spawnDelay: 500, spawnPoints: 1 },
        // Wave 6: River Serpents + Shielded Grunts
        { number: 6, enemies: [{ type: 'shielded_grunt', count: 3 }, { type: 'river_serpent', count: 2 }, { type: 'grunt', count: 5 }], spawnDelay: 500, spawnPoints: 1 },
        // Wave 7
        { number: 7, enemies: [{ type: 'grunt', count: 8 }, { type: 'runner', count: 5 }, { type: 'shielded_grunt', count: 3 }, { type: 'bomber', count: 2 }], spawnDelay: 450, spawnPoints: 1 },
        // Wave 8: Home Wreckers arrive (target housing)
        { number: 8, enemies: [{ type: 'home_wrecker', count: 2 }, { type: 'grunt', count: 6 }, { type: 'river_serpent', count: 2 }, { type: 'runner', count: 4 }], spawnDelay: 450, spawnPoints: 2 },
        // Wave 9
        { number: 9, enemies: [{ type: 'shielded_grunt', count: 5 }, { type: 'bomber', count: 3 }, { type: 'home_wrecker', count: 2 }, { type: 'spark', count: 8 }], spawnDelay: 400, spawnPoints: 2 },
        // Wave 10: Drill Worms + Tank (target mines)
        { number: 10, enemies: [{ type: 'tank', count: 1 }, { type: 'drill_worm', count: 2 }, { type: 'grunt', count: 6 }, { type: 'river_serpent', count: 2 }], spawnDelay: 400, spawnPoints: 2 },
        // Wave 11
        { number: 11, enemies: [{ type: 'tank', count: 1 }, { type: 'bomber', count: 3 }, { type: 'home_wrecker', count: 2 }, { type: 'shielded_grunt', count: 4 }, { type: 'drill_worm', count: 2 }], spawnDelay: 380, spawnPoints: 2 },
        // Wave 12: Disruptors arrive (target weapons)
        { number: 12, enemies: [{ type: 'disruptor', count: 2 }, { type: 'tank', count: 2 }, { type: 'grunt', count: 8 }, { type: 'runner', count: 6 }], spawnDelay: 380, spawnPoints: 2 },
        // Wave 13: EMP Drones join
        { number: 13, enemies: [{ type: 'emp_drone', count: 3 }, { type: 'disruptor', count: 2 }, { type: 'bomber', count: 3 }, { type: 'shielded_grunt', count: 5 }], spawnDelay: 360, spawnPoints: 2 },
        // Wave 14: Leeches arrive (target storage/batteries)
        { number: 14, enemies: [{ type: 'leech', count: 2 }, { type: 'tank', count: 2 }, { type: 'disruptor', count: 2 }, { type: 'emp_drone', count: 2 }, { type: 'runner', count: 6 }], spawnDelay: 350, spawnPoints: 2 },
        // Wave 15
        { number: 15, enemies: [{ type: 'tank', count: 3 }, { type: 'leech', count: 3 }, { type: 'bomber', count: 4 }, { type: 'home_wrecker', count: 2 }, { type: 'river_serpent', count: 3 }], spawnDelay: 340, spawnPoints: 2 },
        // Wave 16: Swarms unleashed
        { number: 16, enemies: [{ type: 'swarm', count: 20 }, { type: 'disruptor', count: 2 }, { type: 'drill_worm', count: 2 }, { type: 'emp_drone', count: 3 }], spawnDelay: 300, spawnPoints: 2 },
        // Wave 17
        { number: 17, enemies: [{ type: 'tank', count: 3 }, { type: 'swarm', count: 15 }, { type: 'bomber', count: 4 }, { type: 'leech', count: 2 }, { type: 'river_serpent', count: 3 }], spawnDelay: 300, spawnPoints: 3 },
        // Wave 18: Nullifiers arrive (target shields)
        { number: 18, enemies: [{ type: 'nullifier', count: 2 }, { type: 'shielded_grunt', count: 8 }, { type: 'swarm', count: 15 }, { type: 'disruptor', count: 2 }, { type: 'home_wrecker', count: 2 }], spawnDelay: 280, spawnPoints: 3 },
        // Wave 19: Pre-boss buildup
        { number: 19, enemies: [{ type: 'tank', count: 4 }, { type: 'nullifier', count: 2 }, { type: 'bomber', count: 5 }, { type: 'leech', count: 3 }, { type: 'swarm', count: 15 }, { type: 'emp_drone', count: 3 }], spawnDelay: 260, spawnPoints: 3 },
        // Wave 20: BOSS WAVE — Overload Boss
        { number: 20, enemies: [{ type: 'overload_boss', count: 1 }, { type: 'heavy_tank', count: 1 }, { type: 'shielded_grunt', count: 8 }, { type: 'swarm', count: 12 }, { type: 'nullifier', count: 2 }], spawnDelay: 250, spawnPoints: 3 },
        // Wave 21-50: Increasingly diverse and difficult
        { number: 21, enemies: [{ type: 'heavy_tank', count: 1 }, { type: 'bomber', count: 5 }, { type: 'emp_drone', count: 4 }, { type: 'disruptor', count: 3 }, { type: 'runner', count: 8 }], spawnDelay: 250, spawnPoints: 3 },
        { number: 22, enemies: [{ type: 'heavy_tank', count: 2 }, { type: 'drill_worm', count: 3 }, { type: 'swarm', count: 20 }, { type: 'river_serpent', count: 3 }], spawnDelay: 240, spawnPoints: 3 },
        { number: 23, enemies: [{ type: 'heavy_tank', count: 2 }, { type: 'nullifier', count: 3 }, { type: 'bomber', count: 5 }, { type: 'home_wrecker', count: 3 }, { type: 'leech', count: 3 }], spawnDelay: 230, spawnPoints: 3 },
        { number: 24, enemies: [{ type: 'tank', count: 5 }, { type: 'swarm', count: 25 }, { type: 'disruptor', count: 3 }, { type: 'emp_drone', count: 4 }], spawnDelay: 220, spawnPoints: 3 },
        { number: 25, enemies: [{ type: 'saboteur', count: 3 }, { type: 'heavy_tank', count: 2 }, { type: 'nullifier', count: 2 }, { type: 'drill_worm', count: 3 }, { type: 'swarm', count: 15 }], spawnDelay: 210, spawnPoints: 3 },
        { number: 26, enemies: [{ type: 'saboteur', count: 4 }, { type: 'bomber', count: 6 }, { type: 'home_wrecker', count: 3 }, { type: 'leech', count: 3 }, { type: 'river_serpent', count: 4 }], spawnDelay: 200, spawnPoints: 3 },
        { number: 27, enemies: [{ type: 'heavy_tank', count: 3 }, { type: 'saboteur', count: 3 }, { type: 'swarm', count: 25 }, { type: 'disruptor', count: 3 }, { type: 'nullifier', count: 2 }], spawnDelay: 200, spawnPoints: 3 },
        { number: 28, enemies: [{ type: 'tank', count: 5 }, { type: 'bomber', count: 6 }, { type: 'drill_worm', count: 3 }, { type: 'emp_drone', count: 5 }, { type: 'leech', count: 3 }], spawnDelay: 190, spawnPoints: 3 },
        { number: 29, enemies: [{ type: 'heavy_tank', count: 3 }, { type: 'home_wrecker', count: 4 }, { type: 'swarm', count: 30 }, { type: 'nullifier', count: 3 }, { type: 'saboteur', count: 3 }], spawnDelay: 180, spawnPoints: 3 },
        { number: 30, enemies: [{ type: 'siege_engine', count: 1 }, { type: 'heavy_tank', count: 2 }, { type: 'bomber', count: 5 }, { type: 'disruptor', count: 3 }, { type: 'swarm', count: 20 }, { type: 'river_serpent', count: 4 }], spawnDelay: 170, spawnPoints: 4 },
        { number: 31, enemies: [{ type: 'siege_engine', count: 1 }, { type: 'saboteur', count: 5 }, { type: 'nullifier', count: 3 }, { type: 'home_wrecker', count: 3 }, { type: 'emp_drone', count: 5 }], spawnDelay: 170, spawnPoints: 4 },
        { number: 32, enemies: [{ type: 'heavy_tank', count: 4 }, { type: 'siege_engine', count: 1 }, { type: 'drill_worm', count: 4 }, { type: 'leech', count: 4 }, { type: 'swarm', count: 25 }], spawnDelay: 160, spawnPoints: 4 },
        { number: 33, enemies: [{ type: 'siege_engine', count: 2 }, { type: 'disruptor', count: 4 }, { type: 'nullifier', count: 3 }, { type: 'bomber', count: 6 }, { type: 'river_serpent', count: 5 }], spawnDelay: 160, spawnPoints: 4 },
        { number: 34, enemies: [{ type: 'heavy_tank', count: 4 }, { type: 'swarm', count: 35 }, { type: 'home_wrecker', count: 4 }, { type: 'saboteur', count: 4 }, { type: 'leech', count: 3 }], spawnDelay: 150, spawnPoints: 4 },
        { number: 35, enemies: [{ type: 'siege_engine', count: 2 }, { type: 'heavy_tank', count: 3 }, { type: 'drill_worm', count: 4 }, { type: 'disruptor', count: 4 }, { type: 'emp_drone', count: 6 }, { type: 'nullifier', count: 3 }], spawnDelay: 150, spawnPoints: 4 },
        { number: 36, enemies: [{ type: 'heavy_tank', count: 5 }, { type: 'bomber', count: 8 }, { type: 'home_wrecker', count: 4 }, { type: 'leech', count: 4 }, { type: 'river_serpent', count: 5 }], spawnDelay: 140, spawnPoints: 4 },
        { number: 37, enemies: [{ type: 'siege_engine', count: 2 }, { type: 'tank', count: 6 }, { type: 'swarm', count: 30 }, { type: 'disruptor', count: 4 }, { type: 'nullifier', count: 3 }], spawnDelay: 140, spawnPoints: 4 },
        { number: 38, enemies: [{ type: 'siege_engine', count: 3 }, { type: 'heavy_tank', count: 4 }, { type: 'drill_worm', count: 4 }, { type: 'saboteur', count: 5 }, { type: 'leech', count: 4 }], spawnDelay: 130, spawnPoints: 4 },
        { number: 39, enemies: [{ type: 'heavy_tank', count: 5 }, { type: 'nullifier', count: 4 }, { type: 'swarm', count: 35 }, { type: 'home_wrecker', count: 4 }, { type: 'emp_drone', count: 6 }], spawnDelay: 130, spawnPoints: 4 },
        // Wave 40: Phase Walkers + Procedural Boss
        { number: 40, enemies: [{ type: 'phase_walker', count: 3 }, { type: 'siege_engine', count: 2 }, { type: 'heavy_tank', count: 3 }, { type: 'disruptor', count: 4 }, { type: 'swarm', count: 25 }, { type: 'river_serpent', count: 5 }], spawnDelay: 120, spawnPoints: 4 },
        { number: 41, enemies: [{ type: 'phase_walker', count: 4 }, { type: 'saboteur', count: 5 }, { type: 'nullifier', count: 3 }, { type: 'heavy_tank', count: 3 }, { type: 'leech', count: 4 }], spawnDelay: 120, spawnPoints: 4 },
        { number: 42, enemies: [{ type: 'siege_engine', count: 3 }, { type: 'phase_walker', count: 3 }, { type: 'swarm', count: 40 }, { type: 'drill_worm', count: 4 }, { type: 'home_wrecker', count: 4 }], spawnDelay: 110, spawnPoints: 4 },
        { number: 43, enemies: [{ type: 'heavy_tank', count: 6 }, { type: 'phase_walker', count: 4 }, { type: 'disruptor', count: 5 }, { type: 'nullifier', count: 4 }, { type: 'emp_drone', count: 6 }], spawnDelay: 110, spawnPoints: 4 },
        { number: 44, enemies: [{ type: 'siege_engine', count: 3 }, { type: 'heavy_tank', count: 5 }, { type: 'phase_walker', count: 4 }, { type: 'bomber', count: 8 }, { type: 'leech', count: 4 }], spawnDelay: 100, spawnPoints: 4 },
        { number: 45, enemies: [{ type: 'siege_engine', count: 4 }, { type: 'phase_walker', count: 5 }, { type: 'drill_worm', count: 5 }, { type: 'home_wrecker', count: 5 }, { type: 'saboteur', count: 5 }, { type: 'river_serpent', count: 6 }], spawnDelay: 100, spawnPoints: 4 },
        { number: 46, enemies: [{ type: 'heavy_tank', count: 6 }, { type: 'siege_engine', count: 3 }, { type: 'nullifier', count: 5 }, { type: 'disruptor', count: 5 }, { type: 'swarm', count: 40 }], spawnDelay: 90, spawnPoints: 4 },
        { number: 47, enemies: [{ type: 'siege_engine', count: 4 }, { type: 'heavy_tank', count: 5 }, { type: 'phase_walker', count: 5 }, { type: 'leech', count: 5 }, { type: 'emp_drone', count: 8 }], spawnDelay: 90, spawnPoints: 4 },
        { number: 48, enemies: [{ type: 'siege_engine', count: 5 }, { type: 'phase_walker', count: 6 }, { type: 'bomber', count: 10 }, { type: 'home_wrecker', count: 5 }, { type: 'drill_worm', count: 5 }], spawnDelay: 80, spawnPoints: 4 },
        { number: 49, enemies: [{ type: 'heavy_tank', count: 8 }, { type: 'siege_engine', count: 4 }, { type: 'nullifier', count: 5 }, { type: 'disruptor', count: 5 }, { type: 'saboteur', count: 6 }], spawnDelay: 70, spawnPoints: 4 },
        // Wave 50: Everything at max
        { number: 50, enemies: [{ type: 'siege_engine', count: 6 }, { type: 'heavy_tank', count: 6 }, { type: 'phase_walker', count: 8 }, { type: 'bomber', count: 10 }, { type: 'swarm', count: 50 }, { type: 'nullifier', count: 5 }, { type: 'disruptor', count: 5 }, { type: 'home_wrecker', count: 5 }, { type: 'drill_worm', count: 5 }, { type: 'leech', count: 5 }, { type: 'river_serpent', count: 6 }], spawnDelay: 60, spawnPoints: 4 }
    ],

    // ------------------------------------------------------------------------
    // Difficulty Presets
    // ------------------------------------------------------------------------
    DIFFICULTY: {
        watt: {
            name: 'Watt',
            icon: '⚡',
            subtitle: 'Easy',
            enemyHPMult: 0.7,
            enemyDamageMult: 0.7,
            enemySpeedMult: 0.9,
            buildingCostMult: 0.8,
            buildingEnergyMult: 0.8,
            waveInterval: 75,
            firstWaveDelay: 150,
            killRewardMult: 1.2,
            waveBonusMult: 1.3,
            startMoney: 2500,
            pollutionDecayMult: 1.3,
            workerRecruitMult: 1.3,
            scalingPerWave: 0.05
        },
        volt: {
            name: 'Volt',
            icon: '🔌',
            subtitle: 'Normal',
            enemyHPMult: 1.0,
            enemyDamageMult: 1.0,
            enemySpeedMult: 1.0,
            buildingCostMult: 1.0,
            buildingEnergyMult: 1.0,
            waveInterval: 60,
            firstWaveDelay: 120,
            killRewardMult: 1.0,
            waveBonusMult: 1.0,
            startMoney: 2000,
            pollutionDecayMult: 1.0,
            workerRecruitMult: 1.0,
            scalingPerWave: 0.08
        },
        amp: {
            name: 'Amp',
            icon: '🔥',
            subtitle: 'Hard',
            enemyHPMult: 1.4,
            enemyDamageMult: 1.3,
            enemySpeedMult: 1.1,
            buildingCostMult: 1.3,
            buildingEnergyMult: 1.2,
            waveInterval: 45,
            firstWaveDelay: 90,
            killRewardMult: 0.9,
            waveBonusMult: 0.8,
            startMoney: 1500,
            pollutionDecayMult: 0.8,
            workerRecruitMult: 0.8,
            scalingPerWave: 0.12
        },
        lightning: {
            name: 'Lightning',
            icon: '⛈️',
            subtitle: 'Extreme',
            enemyHPMult: 2.0,
            enemyDamageMult: 1.8,
            enemySpeedMult: 1.2,
            buildingCostMult: 1.6,
            buildingEnergyMult: 1.5,
            waveInterval: 30,
            firstWaveDelay: 60,
            killRewardMult: 0.8,
            waveBonusMult: 0.6,
            startMoney: 1400,
            pollutionDecayMult: 0.6,
            workerRecruitMult: 0.6,
            scalingPerWave: 0.15
        }
    },

    // ------------------------------------------------------------------------
    // Category Display Order & Icons
    // ------------------------------------------------------------------------
    CATEGORY_ORDER: ['power', 'storage', 'mining', 'weapons', 'defense', 'housing', 'environment', 'grid'],

    CATEGORY_ICONS: {
        power: '⚡',
        storage: '🔋',
        mining: '⛏️',
        weapons: '🎯',
        defense: '🛡️',
        housing: '🏠',
        environment: '🌿',
        grid: '📡'
    },

    // ------------------------------------------------------------------------
    // Energy Distribution Priority (lower number = higher priority)
    // ------------------------------------------------------------------------
    ENERGY_PRIORITY: {
        shields_active: 1,
        weapons: 2,
        miners: 3,
        housing: 4,
        carbon_collectors: 5,
        batteries: 6,
        consumer_batteries: 7
    },

    // ------------------------------------------------------------------------
    // Helper Functions
    // ------------------------------------------------------------------------

    /**
     * Returns an array of [key, definition] pairs for every building in the
     * given category.
     */
    getBuildingsInCategory: function (category) {
        var results = [];
        var keys = Object.keys(this.BUILDINGS);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (this.BUILDINGS[key].category === category) {
                results.push([key, this.BUILDINGS[key]]);
            }
        }
        return results;
    }
};

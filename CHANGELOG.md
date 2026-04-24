# Volt Defense — Changelog

## v0.5.0 — Balance & Weather Update
- **Weather system**: Sunny (50%), Partly Cloudy (25%, -25% solar), Cloudy (25%, -50% solar)
- Reduced solar/wind/hydro energy generation by 50%
- EMP Tower: activation cost 1500→500, stun duration 3s→5s, 10s cooldown
- Mortar rounds show translucent red splash zone on impact
- Laser T3 energy storage increased by 50% (450→675)
- Fusion beam damage ramp restored to 32x, energy ramp stays 8x
- All laser/fusion ramp caps halved (T1/T2 damage 16→8x, T3 16x, fusion 32x)
- All laser/fusion energy storage increased by 50%
- Energy ramp caps: 8x for T1/T2, 16x for T3/fusion
- Fusion beam base energy draw reduced to 60/s
- Laser/fusion energy ramp rate: 50%/s instead of 100%/s

## v0.4.0 — Walls, Weapons & Visual Effects
- **Wall system overhaul**: walls no longer accept cables
- **Electric Wall**: $300 + 5 iron, deals 2 dmg/s contact damage, uses 2 energy/s
- **Wall Breaker enemy**: 🔨 appears wave 7+, targets walls strategically
- **Advanced Capacitor**: $2000, 600 storage, 600/s charge/discharge
- Flamethrower now renders visible directional flame streams
- Laser/fusion beam recharge threshold: waits for 50% energy before re-firing
- Debug mode: right-click to kill enemies
- Wind turbine adjacency penalty: -10% per neighbor, max -50%
- Core repair: charge rate reduced to 50/s, shows status in info panel
- Fix: weapons/core_repair activation for zero-consumption buildings

## v0.3.0 — Energy Flow & Cable Management
- Cable disconnect button in building info panel
- Cable flow rules UI for batteries and capacitors
- Auto HC cable for capacitors
- Pylon cable priority system (P1–P5)
- HC Pylons support 6 cable connections
- Split energy equally among same-priority consumers
- Fix BFS traversal through storage buildings
- Fix cable flow label inflation
- Charge rate enforced globally per building
- Battery charge rates adjusted (small 15, large 35)
- Battery discharge rates doubled (equal to charge rates)
- Mirror cable rules bidirectionally
- Auto-set capacitor cable rules (1st charge, 2nd discharge)
- Restrict cable connections for weapons, miners, defense
- Time-based sell refund tiers
- Upgrade cost subtracts 50% of current building cost

## v0.2.0 — Enemies, Debug & Performance
- Debug testing mode (type 'volt' to activate)
- Debug: stop/resume waves, resource cheats, energy overlay, enemy spawn control
- Enemy formation spawning (cluster, v_shape, wave_front, surround)
- Enemy pathing overhaul with wall building and glossary
- Enemies clickable to show info panel
- Shield generators start at 10% HP, must charge up
- Shields: contact damage, prevent reactivation while enemies inside
- Shield T2 gets +2 tiles range
- Core as high-capacity energy relay (500 storage, 8 cables)
- Core Repair building (defense category)
- Performance overhaul: pathfinding cache, click throttle, energy rounding
- Fix path-blocking check, enemy repath jitter
- Buildings auto-destroy at 0 HP
- Workers freed/reallocated on power loss
- Weapons stop at 0 energy instead of proportional damage
- Miners get energy storage fix
- Reduce weapon energy storage to ~3 seconds

## v0.1.0 — New Weapons & Resources
- 6 new weapons: Tesla Coil, Flamethrower, Railgun, EMP Tower, Mortar, Drone Bay
- Plasma Cannon and Fusion Beam weapons
- High-capacity cables and HC pylons
- Oil resource type, flamethrower uses oil
- River bridges and improved A* pathfinding
- Water Pylon for building near water
- Balance passes: power generation, weapon stats, enemy speeds
- Consumer battery payout fix

## v0.0.1 — Initial Release
- Core game loop with energy grid simulation
- Day/night cycle and dynamic wind speed
- Water flow and hydro plant mechanics
- Power plants: Solar, Wind, Coal, Gas, Nuclear, Hydro
- Storage: Small/Large Battery, Capacitor, Consumer Battery
- Miners for coal, iron, uranium, oil deposits
- Weapons: Missile T1/T2/T3, Laser T1/T2/T3
- Shield generators
- Cable system with 200px range, pylons
- Worker/housing system
- Pollution mechanics with thresholds
- Endless wave mode with difficulty settings
- Path-blocking prevention
- Zoom and pan controls

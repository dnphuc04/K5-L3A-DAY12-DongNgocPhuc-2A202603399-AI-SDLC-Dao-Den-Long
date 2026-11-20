export const HZ = 60
export const neutral = { move: [0, 0], cam_yaw_deg: 0, jump: false, interact: false, pulse: false, dash: false, pause: false }
const radians = Math.PI / 180
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])
const direction = (from, to) => {
  const range = distance(from, to)
  return range ? [(to[0] - from[0]) / range, (to[2] - from[2]) / range] : [1, 0]
}
const advance = ([x, y, z], [dx, dz], amount) => [x + dx * amount, y, z + dz * amount]
const seconds = ticks => Math.max(0, ticks) / HZ
const ticks = duration => Math.round(duration * HZ)
const idOrder = (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)) || a.id.localeCompare(b.id)
const nearest = (items, pos) =>
  items.sort((a, b) => distance(a.pos, pos) - distance(b.pos, pos) || idOrder(a, b))[0]
export const lanternCost = (t, lamp) => lamp.ever_lit ? t.relight_cost : t.lantern_cost
export const carryCapacity = (t, successfulLights) =>
  Math.min(t.capacity_max, t.carry_capacity + t.capacity_per_light * successfulLights)
export const dawnTarget = game => Math.ceil(game.t.win_ratio * game.lanterns.length)
export const isSafe = (t, lamp) => lamp.lit && lamp.fuelUnits >= t.low_fuel_threshold * HZ
const fuelOutput = lamp => Math.round(lamp.fuelUnits * 10 / HZ) / 10
export function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}
const ring = ([x, y, z, radius, count, start, stride = 360 / count]) =>
  Array.from({ length: count }, (_, i) => advance([x, y, z],
    [Math.cos((start + i * stride) * radians), Math.sin((start + i * stride) * radians)], radius))

export function ramps(map) {
  if (!map.ramps) return []
  return map.ramps.angles.map(angle => {
    const axis = [Math.cos(angle * radians), Math.sin(angle * radians)]
    const edge = [-axis[1], axis[0]]
    return { axis, edge, inner: map.tier.outer, outer: map.ramps.outer, half: map.ramps.width / 2, y: map.tier.y }
  })
}

function surface(game, [x, , z]) {
  const { map } = game
  const r = Math.hypot(x, z)
  if (map.disk && r <= map.disk.radius) return { y: map.disk.y }
  if (map.tier && z > 0 && r >= map.tier.inner && r <= map.tier.outer) return { y: map.tier.y }
  for (const ramp of game.ramps) {
    const along = x * ramp.axis[0] + z * ramp.axis[1]
    const across = x * ramp.edge[0] + z * ramp.edge[1]
    if (along >= ramp.inner - 0.06 && along <= ramp.outer && Math.abs(across) <= ramp.half) {
      return { y: Math.min(ramp.y, ramp.y * (ramp.outer - along) / (ramp.outer - ramp.inner)), ramp: true }
    }
  }
  const [left, right, near, far] = map.bridge ?? []
  return map.islands.some(([cx, cz, radius]) => Math.hypot(x - cx, z - cz) <= radius) ||
    (x >= left && x <= right && z >= near && z <= far) ? { y: 0 } : { y: -Infinity }
}

export function createGame(contract, seed, scenario = {}, night = 1) {
  const t = contract.tuning
  const map = contract.maps[night - 1]
  const random = seededRandom(seed)
  const moteSites = map.mote_rings.flatMap(ring)
  const shadeSites = map.shade_rings.flatMap(ring)
  const take = items => items.splice(Math.floor(random() * items.length), 1)[0]
  const lanterns = map.lanterns.map((pos, i) => {
    const id = 'L' + (i + 1)
    const patch = scenario.lanterns?.find(item => item.id === id) ?? {}
    const cost = lanternCost(t, patch)
    const lit = patch.lit ?? (patch.deposited ?? 0) >= cost
    const fuelUnits = lit ? Math.round((patch.fuel ?? t.fuel_max) * HZ) : 0
    return { id, pos: [...(patch.pos ?? pos)], deposited: patch.deposited ?? (lit ? cost : 0),
      lit, fuelUnits, ever_lit: lit || (patch.ever_lit ?? false), relit_count: 0 }
  })
  const initial = [...moteSites]
  const motes = (scenario.motes ?? (scenario.random_motes === false ? [] :
    Array.from({ length: t.mote_initial }, () => take(initial)))).map((entry, i) => {
    const info = Array.isArray(entry) ? { pos: entry } : entry
    const kind = info.kind ?? 'random'
    return { id: info.id ?? 'M' + (i + 1), pos: [...info.pos], kind,
      expires: kind === 'dropped' ? info.ttl_ticks ?? t.drop_ttl_ticks : Infinity, availableAt: 0 }
  })
  const shades = (scenario.shades ?? []).map((entry, i) => ({
    id: 'S' + (i + 1), state: 'chase', ...entry, pos: [...entry.pos],
    until: entry.state_ticks_left ?? 0
  }))
  const drifters = (scenario.drifters ?? []).map((entry, i) => ({
    id: 'D' + (i + 1), state: 'idle', stolen: 0, ...entry, pos: [...entry.pos],
    until: entry.state_ticks_left ?? t.drifter_flee_ticks
  }))
  const charms = (scenario.charms ?? (map.charms ?? []).map(pos => ({ pos }))).map((entry, i) => ({
    id: 'C' + (i + 1), available: true, ...entry,
    pos: [...(entry.pos ?? map.charms?.[i] ?? [0, 0, 0])], ready: entry.respawn_ticks ?? 0
  }))
  const p = scenario.player ?? {}
  const initialTime = scenario.time_left_s ?? t['night' + night + '_duration_s']
  const game = {
    t, map, night, random, take, moteSites, shadeSites, ramps: ramps(map), lanterns, motes, shades, drifters, charms,
    player: { pos: [...(p.pos ?? [0, 0, 0])], vel: [...(p.vel ?? [0, 0, 0])], carried: p.carried ?? 0,
      flames: p.flames ?? t.flames, face: [0, 1], invuln: p.invuln_ticks ?? 0, dashCd: p.dash_cd_ticks ?? 0,
      pulseCd: p.pulse_cd_ticks ?? 0, charm: p.charm_ticks ?? 0, dashUntil: 0, respawn: 0,
      successfulLights: p.successful_lights ?? 0 },
    initialTime, time: initialTime, score: 0, tick: 0, sim: 0, state: 'playing', previous: neutral,
    randomMotes: scenario.random_motes !== false, randomShades: scenario.random_shades !== false,
    randomDrifters: scenario.random_drifters !== false, windEnabled: night === 3 && scenario.wind_enabled !== false,
    wind: { active: false, dir_deg: 0 }, counters: { M: motes.length, S: shades.length, D: drifters.length }
  }
  game.player.grounded = game.player.pos[1] === surface(game, game.player.pos).y ||
    (night === 3 && game.player.pos[1] === 0 && Math.hypot(game.player.pos[0], game.player.pos[2]) <= map.disk.radius)
  return game
}

function nextId(game, prefix, items) {
  let id
  do id = prefix + ++game.counters[prefix]
  while (items.some(item => item.id === id))
  return id
}

export function nearestLantern(game, reachable = false) {
  const { t, player: { pos } } = game
  return nearest(game.lanterns.filter(lamp => (!lamp.lit || lamp.fuelUnits < t.fuel_max * HZ) &&
    (!reachable || Math.abs(lamp.pos[1] - pos[1]) <= t.interact_radius)), pos)
}

function movePlayer(game, input, pressed, emit) {
  const { player: p, t, sim, map } = game
  if (p.respawn) {
    if (sim < p.respawn) return false
    Object.assign(p, { pos: [0, 0, 0], vel: [0, 0, 0], grounded: true, respawn: 0,
      invuln: sim + ticks(t.invuln_s) })
    return true
  }
  const [x, z] = input.move
  const angle = input.cam_yaw_deg * radians
  const norm = Math.max(1, Math.hypot(x, z))
  const move = [(x * Math.cos(angle) + z * Math.sin(angle)) / norm,
    (-x * Math.sin(angle) + z * Math.cos(angle)) / norm]
  if (x || z) p.face = direction([0, 0, 0], [move[0], 0, move[1]])
  const pad = p.grounded && map.pads?.find(item => Math.abs(item.pos[1] - p.pos[1]) < 0.01 &&
    distance(item.pos, p.pos) <= item.radius)
  if (pad) {
    p.launch = direction(pad.pos, pad.target).map(v => v * pad.speed)
    p.vel[1] = pad.up
    p.grounded = false
  } else if (pressed('jump') && p.grounded) {
    p.vel[1] = t.jump_speed
    p.grounded = false
    emit('jump', {}, true)
  }
  const charmed = sim < p.charm
  if (pressed('dash') && sim >= p.dashUntil && (charmed || sim >= p.dashCd)) {
    p.dashUntil = sim + ticks(t.dash_duration_s)
    p.dashCd = charmed ? sim : sim + ticks(t.dash_cooldown_s)
    p.dashDirection = p.face
    emit('dash', {})
  }
  const dashing = sim < p.dashUntil
  const speed = charmed ? t.charm_speed : t.player_speed
  const [vx, vz] = dashing ? p.dashDirection.map(v => v * t.dash_speed) : p.launch ?? move.map(v => v * speed)
  const wind = game.wind.active ? t.wind_speed : 0
  p.vel[0] = vx + wind * Math.cos(game.wind.dir_deg * radians)
  p.vel[2] = vz + wind * Math.sin(game.wind.dir_deg * radians)
  const old = p.pos
  let next = advance(old, [p.vel[0], p.vel[2]], 1 / HZ)
  let floor = surface(game, next)
  let before = surface(game, old)
  // The contract starts Mây at ground level below the central platform.
  if (map.disk && before.y === map.disk.y && old[1] < map.disk.y) {
    before = { y: 0 }
    if (floor.y === map.disk.y) floor = before
  }
  const climbing = p.grounded && (floor.ramp || before.ramp) && floor.y <= old[1] + 0.3
  if ((!climbing && floor.y > old[1] + 1e-7) ||
      (map.tower && Math.hypot(next[0], next[2]) <= map.tower.radius && old[1] >= map.disk.y && old[1] < map.disk.y + map.tower.height)) {
    next = [...old]
    floor = before
    p.vel[0] = p.vel[2] = 0
  }
  if (climbing || (p.grounded && floor.y === old[1])) next[1] = floor.y
  else {
    p.grounded = false
    if (!dashing) {
      next[1] += p.vel[1] / HZ
      p.vel[1] -= t.gravity / HZ
    }
    if (next[1] <= floor.y && p.vel[1] <= 0) {
      next[1] = floor.y
      p.grounded = true
      p.vel[1] = 0
      p.launch = null
    }
  }
  p.pos = next
  if (next[1] >= t.fall_y) return true
  const lost = p.carried
  p.carried = 0
  p.flames--
  p.respawn = sim + t.respawn_ticks
  p.launch = null
  p.dashUntil = sim
  p.vel = [0, 0, 0]
  emit('player_hit', { by: 'fall', flames: p.flames, dropped: 0, lost })
  return false
}

function collect(game, emit) {
  const { t, player: p, sim } = game
  const capacity = carryCapacity(t, p.successfulLights)
  const inReach = pos => distance(pos, p.pos) <= t.pickup_radius && Math.abs(pos[1] - p.pos[1]) <= t.pickup_height
  game.motes = game.motes.filter(mote => {
    if (sim < mote.availableAt || p.carried >= capacity || !inReach(mote.pos)) return true
    emit('mote_picked', { carried: ++p.carried })
    return false
  })
  for (const charm of game.charms) {
    if (!charm.available || !inReach(charm.pos)) continue
    charm.available = false
    charm.ready = sim + t.charm_respawn_ticks
    p.charm = sim + t.charm_ticks
    p.dashCd = sim
    emit('charm_picked', { charm_id: charm.id, charm_ticks: t.charm_ticks })
  }
}

function deposit(game, emit) {
  const { t, player: p } = game
  const lamp = nearestLantern(game, true)
  if (!lamp || !p.carried || distance(lamp.pos, p.pos) > t.interact_radius) return
  if (lamp.lit) {
    const missing = t.fuel_max * HZ - lamp.fuelUnits
    const amount = Math.min(p.carried, Math.ceil(missing / (t.fuel_per_mote * HZ)))
    lamp.fuelUnits += Math.min(missing, amount * t.fuel_per_mote * HZ)
    p.carried -= amount
    game.score += amount * t.score.per_mote
    emit('refuel', { lantern_id: lamp.id, amount, fuel: fuelOutput(lamp) })
    return
  }
  const cost = lanternCost(t, lamp)
  const amount = Math.min(p.carried, cost - lamp.deposited)
  if (amount <= 0) return
  p.carried -= amount
  lamp.deposited += amount
  game.score += amount * t.score.per_mote
  emit('deposit', { lantern_id: lamp.id, amount, deposited: lamp.deposited })
  if (lamp.deposited < cost) return
  const relight = lamp.ever_lit
  lamp.lit = true
  lamp.ever_lit = true
  lamp.fuelUnits = t.fuel_max * HZ
  lamp.relit_count += Number(relight)
  p.successfulLights++
  game.score += relight ? t.score.per_relight : t.score.per_lantern
  emit('lantern_lit', { lantern_id: lamp.id, relight })
}

function drop(game, pos, count, scattered) {
  const { t, sim } = game
  for (let i = 0; i < count; i++) {
    const angle = game.random() * Math.PI * 2
    const [inner, outer] = t.drop_ring
    const next = scattered ? advance(pos, [Math.cos(angle), Math.sin(angle)], inner + game.random() * (outer - inner)) : [...pos]
    const floor = surface(game, next).y
    if (Number.isFinite(floor)) next[1] = floor
    game.motes.push({ id: nextId(game, 'M', game.motes), pos: next, kind: 'dropped',
      expires: sim + t.drop_ttl_ticks, availableAt: sim + 1 })
  }
}

function pulse(game, emit) {
  const { t, sim, player: p } = game
  if (p.carried < t.pulse_cost || sim < p.pulseCd) return
  p.carried -= t.pulse_cost
  p.pulseCd = sim + ticks(t.pulse_cooldown_s)
  const near = pos => Math.hypot(distance(pos, p.pos), pos[1] - p.pos[1] - t.pulse_height) <= t.pulse_radius
  const stunnedIds = []
  for (const shade of game.shades) {
    if (!near(shade.pos)) continue
    game.score += shade.state === 'drain' ? t.score.per_drain_stun : t.score.per_stun
    shade.state = 'stunned'
    shade.target_lantern_id = undefined
    shade.until = sim + ticks(t.pulse_stun_s)
    shade.pushUntil = sim + t.pulse_push_ticks
    shade.push = distance(p.pos, shade.pos) === 0 ? [1, 0] : direction(p.pos, shade.pos)
    stunnedIds.push(shade.id)
  }
  for (const drifter of game.drifters) {
    if (!near(drifter.pos)) continue
    if (drifter.state === 'chase') {
      drifter.state = 'flee'
      drifter.until = sim + t.drifter_flee_ticks
    } else if (drifter.state === 'flee' && drifter.stolen) {
      emit('drifter_drop', { drifter_id: drifter.id, amount: drifter.stolen })
      drop(game, drifter.pos, drifter.stolen, false)
      drifter.stolen = 0
      drifter.until = sim + t.drifter_drop_ticks
    }
  }
  emit('pulse', { stunned_ids: stunnedIds })
}

function updateFuel(game, emit) {
  const { t, sim } = game
  for (const lamp of game.lanterns) {
    if (!lamp.lit) continue
    const draining = game.shades.filter(shade => shade.state === 'drain' &&
      shade.target_lantern_id === lamp.id && !isSafe(t, lamp) &&
      distance(lamp.pos, shade.pos) <= t.drain_radius).sort(idOrder)
    lamp.fuelUnits = Math.max(0, lamp.fuelUnits - t.fuel_decay_per_s - draining.length * t.drain_per_s)
    if (sim % HZ === 0) {
      for (const shade of draining) {
        emit('fuel_drain', { lantern_id: lamp.id, shade_id: shade.id, fuel: fuelOutput(lamp) })
      }
    }
    if (lamp.fuelUnits > 0) continue
    lamp.lit = false
    lamp.deposited = 0
    emit('lantern_out', { lantern_id: lamp.id })
  }
  for (const shade of game.shades) {
    if (shade.state !== 'drain') continue
    const lamp = game.lanterns.find(lamp => lamp.id === shade.target_lantern_id)
    if (lamp?.lit && !isSafe(t, lamp) && distance(lamp.pos, shade.pos) <= t.drain_radius) continue
    shade.state = 'wander'
    shade.target_lantern_id = undefined
  }
}

function shadeMove(game, shade, safe, wanderOnly = false) {
  const { t, sim, player: p, map } = game
  const range = distance(shade.pos, p.pos)
  if (shade.state === 'drain') {
    const target = game.lanterns.find(lamp => lamp.id === shade.target_lantern_id)
    const valid = target?.lit && !isSafe(t, target) && distance(target.pos, shade.pos) <= t.drain_radius
    if (valid && range > t.drain_chase_radius) return false
    shade.state = valid ? 'chase' : 'wander'
    shade.target_lantern_id = undefined
  }
  const exiting = game.lanterns.find(lamp => lamp.lit && lamp.id === shade.exitLamp && sim <= shade.exitEnd)
  const inside = [exiting, ...safe].find(lamp => lamp && distance(lamp.pos, shade.pos) < t.safe_radius - 1e-8)
  if (inside) {
    const range = distance(inside.pos, shade.pos)
    if (shade.exitLamp !== inside.id) {
      shade.exitLamp = inside.id
      shade.exitEnd = sim + t.safe_exit_ticks - 1
    }
    const outward = range === 0 ? [1, 0] : direction(inside.pos, shade.pos)
    shade.pos = advance(shade.pos, outward,
      (t.safe_radius - range) / Math.max(1, shade.exitEnd - sim + 1))
    return false
  }
  shade.exitLamp = null
  if (shade.state === 'spawning' && sim >= shade.until) shade.state = 'wander'
  const recovered = shade.state === 'stunned' && sim >= shade.until
  if (recovered || (shade.state === 'recoil' && sim >= shade.until)) shade.state = 'wander'
  let heading, amount, weak
  if (shade.state === 'stunned') {
    if (sim < shade.pushUntil) {
      heading = shade.push
      amount = t.pulse_push_m / t.pulse_push_ticks
    }
  } else if (shade.state === 'recoil') {
    heading = shade.recoil ?? direction(p.pos, shade.pos)
    amount = t.shade_recoil_distance / t.shade_recoil_ticks
  } else if (shade.state !== 'spawning') {
    shade.state = !wanderOnly && !recovered &&
      range <= (shade.state === 'chase' ? t.shade_lose : t.shade_detect) ? 'chase' : 'wander'
    weak = shade.state === 'wander' && nearest(game.lanterns.filter(lamp => lamp.lit && !isSafe(t, lamp)), shade.pos)
    const target = weak || (shade.state === 'wander' && nearest(game.lanterns.filter(lamp => !lamp.lit), shade.pos))
    heading = shade.state === 'chase' ? direction(shade.pos, p.pos) :
      target ? direction(shade.pos, target.pos) : [Math.cos(sim / HZ), Math.sin(sim / HZ)]
    amount = (map.shade_speed ?? t.shade_speed) / HZ
    if (shade.state === 'chase') amount = Math.min(amount, range)
    if (target) amount = Math.min(amount, Math.max(0, distance(shade.pos, target.pos) - (weak ? t.drain_radius : 0)))
  }
  if (heading) {
    const next = advance(shade.pos, heading, amount)
    const ground = surface(game, next)
    const blocked = safe.find(lamp => distance(lamp.pos, next) < t.safe_radius)
    if (blocked) {
      const [dx, dz] = heading
      const x = shade.pos[0] - blocked.pos[0], z = shade.pos[2] - blocked.pos[2]
      const dot = x * dx + z * dz
      const discriminant = dot * dot - (x * x + z * z - t.safe_radius ** 2)
      if (discriminant >= 0) shade.pos = advance(shade.pos, heading, Math.max(0, -dot - Math.sqrt(discriminant)))
      if (shade.state === 'stunned') shade.pushUntil = sim
    } else if (Number.isFinite(ground.y) && ground.y <= shade.pos[1] + t.pickup_height) shade.pos = next
    else if (shade.state === 'stunned') shade.pushUntil = sim
  }
  if (!recovered && weak && distance(weak.pos, shade.pos) <= t.drain_radius + 1e-8) {
    shade.state = 'drain'
    shade.target_lantern_id = weak.id
    return false
  }
  return shade.state === 'chase' || shade.state === 'wander'
}

export function stepBenchmark(game) {
  game.sim++
  const safe = game.lanterns.filter(lamp => isSafe(game.t, lamp))
  for (const shade of game.shades) shadeMove(game, shade, safe, true)
}

function moveEnemies(game, canTouch, emit) {
  const { t, sim, player: p } = game
  const safe = game.lanterns.filter(lamp => isSafe(t, lamp))
  const hitters = game.shades.filter(shade => shadeMove(game, shade, safe)).sort(idOrder)
  game.drifters = game.drifters.filter(drifter => drifter.state !== 'removed')
  for (const drifter of game.drifters) {
    if (drifter.state === 'flee' && sim >= drifter.until) {
      drifter.state = 'removed'
      continue
    }
    const range = distance(drifter.pos, p.pos)
    if (drifter.state !== 'flee') {
      drifter.state = canTouch && p.carried >= t.drifter_min_carried && range <= t.drifter_detect ? 'chase' : 'idle'
    }
    const heading = drifter.state === 'idle' ? [Math.cos(sim / HZ), Math.sin(sim / HZ)] :
      drifter.state === 'chase' ? direction(drifter.pos, p.pos) : direction(p.pos, drifter.pos)
    const speed = drifter.state === 'idle' ? t.drifter_idle_speed : t.drifter_speed
    drifter.pos = advance(drifter.pos, heading, drifter.state === 'chase' ? Math.min(range, speed / HZ) : speed / HZ)
  }
  if (!canTouch || p.flames <= 0) return
  for (const drifter of game.drifters.sort(idOrder)) {
    if (drifter.state !== 'chase' || distance(drifter.pos, p.pos) > t.drifter_hit) continue
    drifter.stolen = Math.min(t.drifter_steal, p.carried)
    p.carried -= drifter.stolen
    drifter.state = 'flee'
    drifter.until = sim + t.drifter_flee_ticks
    emit('drifter_steal', { drifter_id: drifter.id, amount: drifter.stolen, carried: p.carried })
  }
  if (sim < p.invuln || safe.some(lamp => distance(lamp.pos, p.pos) <= t.safe_radius)) return
  const shade = hitters.find(item => distance(item.pos, p.pos) <= t.shade_hit_radius &&
    Math.abs(item.pos[1] - p.pos[1]) <= t.pickup_height)
  if (!shade) return
  const dropped = Math.floor(p.carried * t.hit_drop_ratio)
  p.carried -= dropped
  p.invuln = sim + ticks(t.invuln_s)
  shade.state = 'recoil'
  shade.recoil = direction(p.pos, shade.pos)
  shade.until = sim + t.shade_recoil_ticks + 1
  drop(game, p.pos, dropped, true)
  emit('player_hit', { by: 'shade', flames: --p.flames, dropped })
}

function spawn(game, emit) {
  const { sim, t, map, player: p } = game
  if (game.randomMotes && sim % t.mote_interval === 0 && game.motes.length < t.mote_cap) {
    const sites = game.moteSites.filter(site => !game.motes.some(mote => distance(site, mote.pos) < 1e-8))
    if (sites.length) game.motes.push({ id: nextId(game, 'M', game.motes), pos: game.take(sites),
      kind: 'random', expires: Infinity, availableAt: sim + 1 })
  }
  const elapsed = sim - t.shade_first_tick
  if (game.randomShades && elapsed >= 0 && elapsed % map.shade_interval === 0) {
    const sites = game.shadeSites.filter(site => distance(site, p.pos) >= t.shade_min_spawn &&
      !game.shades.some(shade => distance(shade.pos, site) < t.shade_hit_radius) &&
      !game.lanterns.some(lamp => isSafe(t, lamp) && distance(lamp.pos, site) < t.safe_radius))
    const count = Math.min(elapsed === 0 ? 2 : 1, sites.length, map.shade_cap - game.shades.length)
    for (let i = 0; i < count; i++) {
      const id = nextId(game, 'S', game.shades)
      game.shades.push({ id, pos: game.take(sites), state: 'spawning', until: sim + 1 })
      emit('shade_spawned', { id })
    }
  }
  if (game.night > 1 && game.randomDrifters && sim % t.drifter_interval === 0 &&
      game.drifters.filter(item => item.state !== 'removed').length < t.drifter_cap) {
    const pos = game.take([...game.shadeSites])
    game.drifters.push({ id: nextId(game, 'D', game.drifters), pos: [pos[0], pos[1] + 0.8, pos[2]],
      state: 'idle', stolen: 0, until: 0 })
  }
}

export function step(game, input = neutral, visualEvents = false) {
  if (game.state === 'won' || game.state === 'lost') return []
  game.tick++
  const events = []
  const pressed = key => input[key] && !game.previous[key]
  const emit = (name, data, visual = false) => {
    if (!visual || visualEvents) events.push({ type: 'event', tick: game.tick, name, data })
  }
  if (pressed('pause')) {
    game.state = game.state === 'paused' ? 'playing' : 'paused'
    emit(game.state === 'paused' ? 'paused' : 'resumed', {})
    game.previous = input
    return events
  }
  if (game.state === 'paused') {
    game.previous = input
    return events
  }
  const sim = ++game.sim
  const { t, player: p } = game
  if (sim === 1) emit('night_start', { night: game.night })
  game.time = Math.max(0, game.initialTime - sim / HZ)
  updateFuel(game, emit)
  if (game.windEnabled) {
    const phase = sim % ticks(t.wind_period)
    if (phase === ticks(t.wind_period - t.wind_warning)) {
      game.wind.dir_deg = game.random() * 360
      emit('wind_warning', {}, true)
    }
    game.wind.active = sim >= ticks(t.wind_period) && phase < ticks(t.wind_duration)
  }
  game.motes = game.motes.filter(mote => mote.expires > sim)
  for (const charm of game.charms) if (!charm.available && charm.ready > 0 && sim >= charm.ready) charm.available = true
  const present = movePlayer(game, input, pressed, emit)
  if (present) {
    collect(game, emit)
    if (pressed('interact')) deposit(game, emit)
    if (pressed('pulse')) pulse(game, emit)
  }
  moveEnemies(game, present, emit)
  spawn(game, emit)
  const lit = game.time <= 0 ? game.lanterns.filter(lamp => lamp.lit) : []
  const reason = p.flames <= 0 ? 'no_flames' : game.time <= 0 ?
    (lit.length >= dawnTarget(game) ? 'dawn_survived' : 'dawn') : null
  if (reason) {
    game.state = reason === 'dawn_survived' ? 'won' : 'lost'
    if (game.state === 'won') {
      game.score += p.flames * t.score.per_flame_left
      for (const lamp of lit) game.score += t.score.per_lit_at_dawn + Math.floor(lamp.fuelUnits / HZ)
    }
    emit('game_over', { result: game.state, reason })
  }
  game.previous = input
  return events
}

export function snapshot(game) {
  const { sim, player: p } = game
  return { type: 'snapshot', tick: game.tick, sim_tick: sim, state: game.state, night: game.night,
    time_left_s: game.time, wind: game.wind, player: { pos: p.pos, vel: p.vel, carried: p.carried,
      flames: p.flames, grounded: p.grounded, invuln: sim < p.invuln, dash_cd_s: seconds(p.dashCd - sim),
      pulse_cd_s: seconds(p.pulseCd - sim), charm_s: seconds(p.charm - sim),
      capacity: carryCapacity(game.t, p.successfulLights) },
    lanterns: game.lanterns.map(({ id, pos, deposited, lit, ever_lit, relit_count, fuelUnits }) =>
      ({ id, pos, deposited, lit, fuel: fuelOutput({ fuelUnits }), ever_lit, relit_count })),
    shades: game.shades.map(({ id, pos, state }) => ({ id, pos, state })),
    motes_active: game.motes.length, motes: game.motes.map(({ id, pos, kind, expires }) =>
      ({ id, pos, kind, ttl_s: Number.isFinite(expires) ? seconds(expires - sim) : null })),
    drifters: game.drifters.map(({ id, pos, state, stolen }) => ({ id, pos, state, stolen })),
    charms: game.charms.map(({ id, available, ready }) => ({ id, available, respawn_s: available ? 0 : seconds(ready - sim) })),
    score: game.score }
}

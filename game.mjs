export const HZ = 60
export const RADIUS = 32
export const neutral = { move: [0, 0], cam_yaw_deg: 0, jump: false, interact: false, pulse: false }
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])
const polar = (angle, radius) => [Math.sin(angle) * radius, 0, Math.cos(angle) * radius]

export function createGame(t, seed, scenario = {}) {
  let rng = seed >>> 0
  function random() {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0
    return rng / 4294967296
  }
  const lanterns = Array.from({ length: t.lantern_count_night1 }, (_, i) => {
    const id = 'L' + (i + 1)
    const patch = scenario.lanterns?.find(lantern => lantern.id === id) ?? {}
    const deposited = patch.deposited ?? (patch.lit ? t.lantern_cost : 0)
    return { id, pos: polar(i * Math.PI * 2 / t.lantern_count_night1, 16),
      deposited, lit: patch.lit ?? (deposited >= t.lantern_cost), ...patch }
  })
  const motes = scenario.motes ?? (scenario.random_motes === false ? [] :
    Array.from({ length: 48 }, (_, i) => polar((i + random()) * 2 * Math.PI / 48, 3 + 25 * random())))
  const shades = scenario.shades ?? (scenario.random_shades === false ? [] :
    Array.from({ length: 3 }, (_, i) => ({ pos: polar((i + random()) * 2 * Math.PI / 3, 23) })))
  const initialTime = scenario.time_left_s ?? t.night1_duration_s
  const player = { pos: [0, 0, 0], carried: 0, flames: t.flames, ...scenario.player }
  const game = {
    player: { ...player, pos: [...player.pos] }, lanterns,
    motes: motes.map(pos => [...pos]),
    shades: shades.map((shade, i) => ({ id: 'S' + (i + 1), ...shade, pos: [...shade.pos], state: 'chase', stunUntil: 0 })),
    initialTime, time: initialTime, tick: 0, state: 'playing', score: 0, verticalSpeed: 0,
    invulnerableUntil: 0, nextPulse: 0, previous: neutral
  }
  return game
}

function isSafe(game, t, pos) {
  return game.lanterns.some(lantern => lantern.lit && distance(lantern.pos, pos) <= t.safe_radius)
}

export function step(game, t, input = neutral) {
  if (game.state !== 'playing') return []
  const events = []
  game.tick++
  game.time = Math.max(0, game.initialTime - game.tick / HZ)
  const emit = (name, data) => events.push({ type: 'event', tick: game.tick, name, data })
  const pressed = key => input[key] && !game.previous[key]
  const player = game.player
  const pos = player.pos
  const yaw = input.cam_yaw_deg * Math.PI / 180
  const [x, z] = input.move
  const speed = t.player_speed / (HZ * Math.max(1, Math.hypot(x, z)))
  pos[0] += speed * (x * Math.cos(yaw) + z * Math.sin(yaw))
  pos[2] += speed * (-x * Math.sin(yaw) + z * Math.cos(yaw))
  const radius = Math.hypot(pos[0], pos[2])
  if (radius > RADIUS) {
    pos[0] *= RADIUS / radius
    pos[2] *= RADIUS / radius
  }
  if (pressed('jump') && pos[1] === 0) game.verticalSpeed = 6
  if (pos[1] > 0 || game.verticalSpeed > 0) {
    pos[1] = Math.max(0, pos[1] + game.verticalSpeed / HZ)
    game.verticalSpeed = pos[1] === 0 ? 0 : game.verticalSpeed - 16 / HZ
  }

  game.motes = game.motes.filter(mote => {
    if (player.carried >= t.carry_capacity || distance(mote, pos) > t.pickup_radius) return true
    player.carried++
    game.score += t.score.per_mote
    emit('mote_picked', { carried: player.carried })
    return false
  })
  if (pressed('interact') && player.carried > 0) {
    let nearest
    let best = Infinity
    for (const lantern of game.lanterns) {
      const range = distance(lantern.pos, pos)
      if (!lantern.lit && range <= t.interact_radius && range < best) {
        nearest = lantern
        best = range
      }
    }
    if (nearest) {
      const amount = Math.min(player.carried, t.lantern_cost - nearest.deposited)
      player.carried -= amount
      nearest.deposited += amount
      emit('deposit', { lantern_id: nearest.id, amount, deposited: nearest.deposited })
      if (nearest.deposited >= t.lantern_cost) {
        nearest.lit = true
        game.score += t.score.per_lantern
        emit('lantern_lit', { lantern_id: nearest.id })
      }
    }
  }
  if (pressed('pulse') && player.carried >= t.pulse_cost && game.tick >= game.nextPulse) {
    player.carried -= t.pulse_cost
    game.nextPulse = game.tick + Math.round(t.pulse_cooldown_s * HZ)
    const stunnedIds = []
    for (const shade of game.shades) {
      const range = distance(shade.pos, pos)
      if (range > t.pulse_radius) continue
      const dx = range ? (shade.pos[0] - pos[0]) / range : 1
      const dz = range ? (shade.pos[2] - pos[2]) / range : 0
      shade.pos[0] += dx * t.pulse_push_m
      shade.pos[2] += dz * t.pulse_push_m
      shade.stunUntil = game.tick + Math.round(t.pulse_stun_s * HZ)
      shade.state = 'stunned'
      stunnedIds.push(shade.id)
    }
    game.score += stunnedIds.length * t.score.per_stun
    emit('pulse', { stunned_ids: stunnedIds })
  }

  const playerSafe = isSafe(game, t, pos)
  for (const shade of game.shades) {
    if (game.tick < shade.stunUntil) continue
    shade.state = 'chase'
    const range = distance(shade.pos, pos)
    if (range > 0 && !playerSafe) {
      const fraction = Math.min(1, t.shade_speed / HZ / range)
      const next = [
        shade.pos[0] + (pos[0] - shade.pos[0]) * fraction, shade.pos[1],
        shade.pos[2] + (pos[2] - shade.pos[2]) * fraction
      ]
      if (!isSafe(game, t, next)) shade.pos = next
    }
    if (!playerSafe && player.flames > 0 && game.tick >= game.invulnerableUntil &&
        distance(shade.pos, pos) <= t.shade_hit_radius) {
      const dropped = Math.floor(player.carried * t.hit_drop_ratio)
      player.carried -= dropped
      player.flames--
      game.invulnerableUntil = game.tick + Math.round(t.invuln_s * HZ)
      emit('player_hit', { by: 'shade', flames: player.flames, dropped })
    }
  }

  const reason = game.lanterns.every(lantern => lantern.lit) ? 'all_lit' :
    player.flames <= 0 ? 'no_flames' : game.time <= 0 ? 'dawn' : null
  if (reason) {
    game.state = reason === 'all_lit' ? 'won' : 'lost'
    if (game.state === 'won') {
      game.score += Math.floor(game.time) * t.score.per_second_left + player.flames * t.score.per_flame_left
    }
    emit('game_over', { result: game.state, reason })
  }
  game.previous = input
  return events
}

export function snapshot(game) {
  return { type: 'snapshot', tick: game.tick, sim_tick: game.tick, state: game.state,
    time_left_s: game.time, player: game.player, lanterns: game.lanterns,
    shades: game.shades.map(({ id, pos, state }) => ({ id, pos, state })),
    motes_active: game.motes.length, score: game.score }
}

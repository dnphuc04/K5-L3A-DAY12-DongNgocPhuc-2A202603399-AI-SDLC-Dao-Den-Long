import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

function run(t, { scenario, frames, ticks = 120, seed = 20, every = 1, night = 1 }) {
  const dir = mkdtempSync(join(tmpdir(), 'dao-den-long-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const out = join(dir, 'out.jsonl')
  const args = ['headless.mjs', '--seed', String(seed), '--night', String(night),
    '--ticks', String(ticks), '--out', out, '--snapshot-every', String(every)]
  for (const [key, value] of [['scenario', scenario], ['inputs', frames && { frames }]]) {
    if (value === undefined) continue
    const path = join(dir, key + '.json')
    writeFileSync(path, JSON.stringify(value))
    args.push('--' + key, path)
  }
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' })
  if (result.status !== 0) return result
  const raw = readFileSync(out, 'utf8')
  const rows = raw.trim().split('\n').map(JSON.parse)
  return {
    raw, events: rows.filter(row => row.type === 'event'),
    snapshots: rows.filter(row => row.type === 'snapshot'), end: rows.at(-1)
  }
}

const empty = { random_motes: false, random_shades: false }

test('tick zero, sparse inputs, camera rotation, diagonal normalization and jump', t => {
  const { snapshots, end } = run(t, { scenario: empty, ticks: 61, frames: [
    { tick: 0, move: [0, 1], cam_yaw_deg: 90 },
    { tick: 30, move: [1, 1], cam_yaw_deg: 0, jump: true }
  ] })
  assert.deepEqual(snapshots[0].player.pos, [0, 0, 0])
  assert.equal(snapshots[30].sim_tick, 30)
  assert.ok(Math.abs(snapshots[30].player.pos[0] - 3) < 1e-9)
  assert.equal(snapshots[30].time_left_s, 239.5)
  assert.ok(snapshots[31].player.pos[1] > 0)
  assert.ok(Math.abs(snapshots[60].player.pos[2] - 3 / Math.sqrt(2)) < 1e-9)
  assert.equal(end.ticks, 61)
})

test('pickup radius and carry limit', t => {
  const { events, snapshots } = run(t, { ticks: 1, scenario: { ...empty,
    player: { carried: 9 }, motes: [[1, 0, 0], [0, 0, 1], [1.01, 0, 0]]
  } })
  assert.deepEqual(events.filter(e => e.name === 'mote_picked').map(e => [e.tick, e.data.carried]), [[1, 10]])
  assert.equal(snapshots[1].motes_active, 2)
})

test('partial deposit, rising edge and final lantern without early victory', t => {
  const lanterns = [1, 2, 3, 4, 5].map(i =>
    i === 1 ? { id: 'L1', pos: [0, 0, 0], deposited: 7 } : { id: 'L' + i, lit: true })
  const { events, snapshots, end } = run(t, { scenario: { ...empty, lanterns,
    player: { carried: 1 }, motes: [[2, 0, 0], [2, 0, 0]]
  }, frames: [
    { tick: 0, interact: true }, { tick: 1, move: [1, 0] },
    { tick: 14, move: [0, 0], interact: false }, { tick: 15, interact: true }
  ] })
  assert.equal(snapshots[0].score, 0)
  assert.equal(events.filter(e => e.name === 'deposit').length, 2)
  assert.deepEqual(events.find(e => e.name === 'deposit').data, { lantern_id: 'L1', amount: 1, deposited: 8 })
  assert.deepEqual(events.at(-1).data, { lantern_id: 'L1', relight: false })
  assert.equal(snapshots[16].player.capacity, 12)
  assert.deepEqual(end, { type: 'end', ticks: 120, state: 'playing', score: 115 })
})

test('pulse costs light, pushes within radius and observes cooldown and stun timing', t => {
  const { events, snapshots } = run(t, { ticks: 122, scenario: { ...empty,
    player: { carried: 4 }, shades: [{ id: 'Near', pos: [5, 0.8, 0] }, { id: 'Far', pos: [6, 0, 0] }]
  }, frames: [{ tick: 0, pulse: true }, { tick: 1, pulse: false }, { tick: 2, pulse: true }] })
  assert.deepEqual(events.filter(e => e.name === 'pulse'), [{ type: 'event', tick: 1, name: 'pulse', data: { stunned_ids: ['Near'] } }])
  assert.equal(snapshots[1].player.carried, 1)
  assert.ok(Math.abs(snapshots[15].shades[0].pos[0] - 9) < 1e-9)
  assert.equal(snapshots[120].shades[0].state, 'stunned')
  assert.equal(snapshots[121].shades[0].state, 'wander')
  assert.equal(snapshots[122].shades[0].state, 'chase')
})

test('a lit lantern protects the player and keeps chasing shades outside its radius', t => {
  const { events, snapshots } = run(t, { scenario: { ...empty,
    lanterns: [{ id: 'L1', lit: true, pos: [0, 0, 0] }], shades: [{ pos: [4, 0, 0] }]
  } })
  assert.deepEqual(events.map(e => e.name), ['night_start'])
  assert.equal(snapshots.at(-1).player.flames, 3)
  assert.ok(Math.abs(snapshots[30].shades[0].pos[0] - 6) < 1e-9)
})

test('collision, invulnerability and defeat from zero flames', t => {
  const { events, end } = run(t, { ticks: 400, scenario: { ...empty, shades: [{ pos: [0, 0, 0] }] } })
  assert.deepEqual(events.filter(e => e.name === 'player_hit').map(e => [e.tick, e.data.flames]),
    [[1, 2], [91, 1], [181, 0]])
  assert.deepEqual(events.at(-1).data, { result: 'lost', reason: 'no_flames' })
  assert.equal(end.ticks, 181)
})

test('dawn terminates at the exact tick and emits end as the final row', t => {
  const { snapshots, events, end } = run(t, { scenario: { ...empty, time_left_s: 1 }, every: 59 })
  assert.deepEqual(snapshots.map(s => s.tick), [0, 59])
  assert.deepEqual(events.filter(e => e.name === 'game_over'), [{ type: 'event', tick: 60, name: 'game_over', data: { result: 'lost', reason: 'dawn' } }])
  assert.deepEqual(end, { type: 'end', ticks: 60, state: 'lost', score: 0 })
})

test('same seed and inputs produce byte-identical output', t => {
  assert.equal(run(t, { every: 60 }).raw, run(t, { every: 60 }).raw)
  assert.notEqual(run(t, { seed: 21, every: 60 }).raw, run(t, { every: 60 }).raw)
})

test('malformed scenario and duplicate ticks exit 2 with stderr', t => {
  for (const options of [{ scenario: { motes: [[1, 2]] } },
    { frames: [{ tick: 2 }, { tick: 2 }] }]) {
    const { status, stderr, stdout } = run(t, options)
    assert.equal(status, 2)
    assert.match(stderr, /Invalid/)
    assert.equal(stdout, '')
  }
})

test('standard map, spawn clocks and duration for all three nights', t => {
  for (const [night, duration, lamps, interval] of [[1, 240, 5, 480], [2, 270, 6, 420], [3, 300, 7, 360]]) {
    const { events, snapshots } = run(t, { night, ticks: 300 + interval, every: 60 })
    assert.equal(snapshots[0].night, night)
    assert.equal(snapshots[0].time_left_s, duration)
    assert.equal(snapshots[0].lanterns.length, lamps)
    assert.equal(snapshots[0].motes.length, 20)
    assert.equal(snapshots[0].shades.length, 0)
    assert.deepEqual(events.filter(e => e.name === 'shade_spawned').map(e => [e.tick, e.data.id]),
      [[300, 'S1'], [300, 'S2'], [300 + interval, 'S3']])
    assert.equal(snapshots.find(row => row.tick === 240).motes.length, 21)
  }
})

test('pause freezes sim clock, buffs, TTL and cooldowns; dash lasts 12 sim ticks', t => {
  const { events, snapshots } = run(t, { ticks: 40, scenario: { ...empty,
    motes: [{ pos: [12, 0, 0], kind: 'dropped', ttl_ticks: 10 }],
    player: { charm_ticks: 50, pulse_cd_ticks: 20 }
  }, frames: [{ tick: 0, dash: true }, { tick: 1, pause: true }, { tick: 2, pause: false },
    { tick: 29, pause: true }, { tick: 30, pause: false }] })
  const paused = snapshots[28], resumed = snapshots[30]
  assert.equal(paused.state, 'paused')
  assert.equal(paused.sim_tick, 1)
  assert.equal(resumed.sim_tick, 1)
  assert.equal(paused.time_left_s, snapshots[1].time_left_s)
  assert.deepEqual(paused.player, snapshots[1].player)
  assert.deepEqual(paused.motes, snapshots[1].motes)
  assert.deepEqual(events.filter(e => ['dash', 'paused', 'resumed'].includes(e.name)).map(e => [e.tick, e.name]),
    [[1, 'dash'], [2, 'paused'], [30, 'resumed']])
  assert.equal(snapshots[40].motes.length, 0)
})

test('dash uses facing, travels 2.8 m in 12 ticks and does not retrigger while held', t => {
  const { events, snapshots } = run(t, { ticks: 100, scenario: empty, frames: [{ tick: 0, dash: true }] })
  assert.equal(events.filter(e => e.name === 'dash').length, 1)
  assert.ok(Math.abs(snapshots[12].player.pos[2] - 2.8) < 1e-9)
  assert.equal(snapshots[13].player.vel[2], 0)
  assert.equal(snapshots[91].player.dash_cd_s, 0)
})

test('fall ignores immunity, loses carried motes once and respawns on schedule', t => {
  const { events, snapshots } = run(t, { ticks: 75,
    scenario: { ...empty, player: { pos: [41, -10, 0], carried: 9, invuln_ticks: 500 } } })
  const hits = events.filter(e => e.name === 'player_hit')
  assert.equal(hits.length, 1)
  assert.deepEqual(hits[0].data, { by: 'fall', flames: 2, dropped: 0, lost: 9 })
  assert.deepEqual(snapshots[hits[0].tick + 60].player.pos, [0, 0, 0])
  assert.equal(snapshots[hits[0].tick + 60].player.invuln, true)
})

test('drifter steals before shade hit, and pulse returns stolen motes', t => {
  const { events, snapshots } = run(t, { night: 2, ticks: 2,
    scenario: { ...empty, player: { carried: 10 }, drifters: [{ pos: [0, 0.8, 0] }],
      shades: [{ pos: [0, 0, 0] }] }, frames: [{ tick: 1, pulse: true }] })
  assert.deepEqual(events.filter(e => e.tick === 1).map(e => e.name), ['night_start', 'drifter_steal', 'player_hit'])
  assert.equal(events.find(e => e.name === 'player_hit').data.dropped, 3)
  assert.equal(events.find(e => e.name === 'drifter_drop').data.amount, 3)
  assert.equal(snapshots[2].motes.filter(m => m.kind === 'dropped').length, 6)
})

test('wind charm increases run speed and allows a second dash without cooldown', t => {
  const { events, snapshots } = run(t, { night: 2, ticks: 20, scenario: { ...empty, player: { pos: [35, 0, 0] } },
    frames: [{ tick: 1, move: [1, 0] }, { tick: 2, dash: true }, { tick: 3, dash: false }, { tick: 14, dash: true }] })
  assert.equal(events.find(e => e.name === 'charm_picked').data.charm_ticks, 600)
  assert.equal(snapshots[2].player.vel[0], 7.2)
  assert.deepEqual(events.filter(e => e.name === 'dash').map(e => e.tick), [3, 15])
})

test('standard jump pads land on the second island and upper disk', t => {
  for (const [night, pos, minX, y] of [[2, [20, 0, 18], 42, 0], [3, [0, 3, 13], 0, 6]]) {
    const { snapshots } = run(t, { night, ticks: 100, scenario: { ...empty, player: { pos } } })
    const landed = snapshots.find(s => s.tick > 2 && s.player.grounded)
    assert.ok(landed, 'missing landing on night ' + night)
    assert.ok(landed.player.pos[0] >= minX)
    assert.equal(landed.player.pos[1], y)
  }
})

test('night 3 starts on the lower floor and wind changes speed only during its window', t => {
  const { snapshots } = run(t, { night: 3, ticks: 2100, every: 60, scenario: empty,
    frames: [{ tick: 0, move: [1, 0] }, { tick: 300, move: [0, 0] }] })
  const at = tick => snapshots.find(row => row.tick === tick)
  assert.equal(at(0).player.grounded, true)
  assert.ok(Math.abs(at(120).player.pos[0] - 12) < 1e-9)
  assert.equal(at(1740).wind.active, false)
  assert.equal(at(1800).wind.active, true)
  assert.ok(Math.abs(Math.hypot(at(1800).player.vel[0], at(1800).player.vel[2]) - 2) < 1e-9)
  assert.equal(at(2100).wind.active, false)
})

test('last flame overrides a simultaneous final lantern and dawn', t => {
  const lanterns = [1, 2, 3, 4, 5].map(i => i === 1 ?
    { id: 'L1', pos: [0, 0, 0], deposited: 9 } : { id: 'L' + i, lit: true })
  const options = { ticks: 1, frames: [{ tick: 0, interact: true }],
    scenario: { ...empty, time_left_s: 1 / 60, player: { flames: 0, carried: 1 }, lanterns } }
  assert.equal(run(t, options).events.at(-1).data.reason, 'no_flames')
  options.scenario.player.flames = 1
  assert.equal(run(t, options).events.at(-1).data.reason, 'dawn_survived')
})

test('night 3 ramps reach the upper ring without jumping', t => {
  for (const angle of [30, 150]) {
    const radians = angle * Math.PI / 180
    const x = Math.cos(radians), z = Math.sin(radians)
    const { snapshots } = run(t, { night: 3, ticks: 80, scenario: { ...empty, player: { pos: [31 * x, 0, 31 * z] } },
      frames: [{ tick: 0, move: [-x, -z] }] })
    assert.equal(snapshots.at(-1).player.pos[1], 3)
    assert.equal(snapshots.at(-1).player.grounded, true)
  }
})

test('fuel expires before interaction and relighting uses five motes, increasing capacity', t => {
  const { snapshots, events, end } = run(t, { ticks: 1, scenario: { ...empty,
    lanterns: [{ id: 'L1', pos: [0, 0, 0], lit: true, fuel: 1 / 60 }],
    player: { carried: 5, successful_lights: 4 }
  }, frames: [{ tick: 0, interact: true }] })
  assert.deepEqual(events.slice(1).map(e => e.name), ['lantern_out', 'deposit', 'lantern_lit'])
  assert.deepEqual(events.at(-1).data, { lantern_id: 'L1', relight: true })
  assert.deepEqual(snapshots[1].lanterns[0], {
    id: 'L1', pos: [0, 0, 0], deposited: 5, lit: true, fuel: 100, ever_lit: true, relit_count: 1
  })
  assert.equal(snapshots[1].player.capacity, 20)
  assert.equal(end.score, 65)
})

test('refuel uses ceiling, caps the tank, respects tie break and does not grow capacity', t => {
  const { snapshots, events, end } = run(t, { ticks: 1, scenario: { ...empty, player: { carried: 18, successful_lights: 12 },
    lanterns: [{ id: 'L2', pos: [-1, 0, 0], lit: true, fuel: 80 },
      { id: 'L1', pos: [1, 0, 0], lit: true, fuel: 80 }]
  }, frames: [{ tick: 0, interact: true }] })
  assert.deepEqual(events.at(-1).data, { lantern_id: 'L1', amount: 3, fuel: 100 })
  assert.equal(events.at(-1).name, 'refuel')
  assert.equal(snapshots[1].player.carried, 15)
  assert.equal(snapshots[1].player.capacity, 20)
  assert.equal(end.score, 15)
})

test('wander targets the nearest weak lantern with ties broken by ID and drains stack', t => {
  const { snapshots, events } = run(t, { ticks: 60, scenario: { ...empty, lanterns: [
    { id: 'L2', pos: [22, 0, 0], lit: true, fuel: 20 },
    { id: 'L1', pos: [20, 0, 0], lit: true, fuel: 20 }
  ], shades: [{ id: 'S2', state: 'wander', pos: [21, 0, 0] },
    { id: 'S1', state: 'drain', pos: [20, 0, 1], target_lantern_id: 'L1' }]
  } })
  assert.deepEqual(snapshots[1].shades.map(s => s.state), ['drain', 'drain'])
  assert.deepEqual(snapshots[60].shades.map(s => s.pos), [[21, 0, 0], [20, 0, 1]])
  assert.deepEqual(events.filter(e => e.name === 'fuel_drain').map(e => [e.tick, e.data]), [
    [60, { lantern_id: 'L1', shade_id: 'S1', fuel: 9.1 }],
    [60, { lantern_id: 'L1', shade_id: 'S2', fuel: 9.1 }]
  ])
  assert.equal(snapshots[60].lanterns[1].fuel, 19)
})

test('pulse gives 15 points for a drainer and five for another shade', t => {
  const { snapshots, end } = run(t, { ticks: 1, scenario: { ...empty, player: { carried: 3 },
    lanterns: [{ id: 'L1', pos: [4, 0, 0], lit: true, fuel: 25 }],
    shades: [{ pos: [4, 0, 0], state: 'drain', target_lantern_id: 'L1' }, { pos: [-4, 0, 0] }]
  }, frames: [{ tick: 0, pulse: true }] })
  assert.deepEqual(snapshots[1].shades.map(s => s.state), ['stunned', 'stunned'])
  assert.equal(end.score, 20)
})

test('pausing freezes lamp fuel; a drainer switches to chase when the player reaches six meters', t => {
  const { snapshots } = run(t, { ticks: 5, scenario: { ...empty,
    player: { pos: [6, 0, 0] }, lanterns: [{ id: 'L1', pos: [0, 0, 0], lit: true, fuel: 20 }],
    shades: [{ pos: [0, 0, 0], state: 'drain', target_lantern_id: 'L1' }]
  }, frames: [{ tick: 0, pause: true }, { tick: 1, pause: false }, { tick: 3, pause: true }] })
  assert.equal(snapshots[3].lanterns[0].fuel, 20)
  assert.equal(snapshots[3].shades[0].state, 'drain')
  assert.equal(snapshots[5].shades[0].state, 'chase')
})

test('threshold of 30 is safe and refuel ejects shades from the restored radius', t => {
  const options = { ticks: 30, scenario: { ...empty, player: { carried: 1 },
    lanterns: [{ id: 'L1', pos: [0, 0, 0], lit: true, fuel: 20.1 }],
    shades: [{ pos: [0, 0, 0], state: 'drain', target_lantern_id: 'L1' }]
  }, frames: [{ tick: 0, interact: true }] }
  const { snapshots, events } = run(t, options)
  assert.equal(events.find(e => e.name === 'refuel').data.fuel, 30)
  assert.equal(snapshots[30].shades[0].pos[0], 6)
  assert.equal(snapshots[30].player.flames, 3)
  options.frames = []
  assert.equal(run(t, options).snapshots[1].player.flames, 2)
})

test('dawn checks the updated fuel and applies the threshold and bonus on every night', t => {
  for (const [night, needed] of [[1, 3], [2, 4], [3, 5]]) {
    const lanterns = Array.from({ length: needed }, (_, i) => ({ id: 'L' + (i + 1), lit: true, fuel: 75 }))
    const options = { night, ticks: 1, scenario: { ...empty, time_left_s: 1 / 60, lanterns } }
    const won = run(t, options)
    assert.equal(won.events.at(-1).data.reason, 'dawn_survived')
    assert.equal(won.end.score, 150 + 124 * needed)
    lanterns[0].fuel = 1 / 60
    const lost = run(t, options)
    assert.deepEqual(lost.events.slice(-2).map(e => e.name), ['lantern_out', 'game_over'])
    assert.equal(lost.events.at(-1).data.reason, 'dawn')
    assert.equal(lost.end.score, 0)
  }
})

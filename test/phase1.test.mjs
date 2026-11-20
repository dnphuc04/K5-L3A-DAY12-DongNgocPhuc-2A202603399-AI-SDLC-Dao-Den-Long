import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

function run(t, { scenario, frames, ticks = 120, seed = 20, every = 1 }) {
  const dir = mkdtempSync(join(tmpdir(), 'dao-den-long-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const out = join(dir, 'out.jsonl')
  const args = ['headless.mjs', '--seed', String(seed), '--night', '1',
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
  assert.equal(snapshots[30].time_left_s, 179.5)
  assert.ok(snapshots[31].player.pos[1] > 0)
  assert.ok(Math.abs(snapshots[60].player.pos[2] - 3 / Math.sqrt(2)) < 1e-9)
  assert.equal(end.ticks, 61)
})

test('pickup radius and carry limit', t => {
  const { events, snapshots } = run(t, { ticks: 1, scenario: { ...empty,
    player: { carried: 7 }, motes: [[1, 0, 0], [0, 0, 1], [1.01, 0, 0]]
  } })
  assert.deepEqual(events.map(event => [event.tick, event.name, event.data.carried]), [[1, 'mote_picked', 8]])
  assert.equal(snapshots[1].motes_active, 2)
})

test('partial deposit, rising edge, final lantern and score', t => {
  const lanterns = [1, 2, 3, 4, 5].map(i =>
    i === 1 ? { id: 'L1', pos: [0, 0, 0], deposited: 1 } : { id: 'L' + i, lit: true })
  const { events, snapshots, end } = run(t, { scenario: { ...empty, lanterns,
    player: { carried: 1 }, motes: [[2, 0, 0], [2, 0, 0]]
  }, frames: [
    { tick: 0, interact: true }, { tick: 1, move: [1, 0] },
    { tick: 14, move: [0, 0], interact: false }, { tick: 15, interact: true }
  ] })
  assert.equal(snapshots[0].score, 0)
  assert.equal(events.filter(e => e.name === 'deposit').length, 2)
  assert.deepEqual(events[0].data, { lantern_id: 'L1', amount: 1, deposited: 2 })
  assert.deepEqual(events.slice(-2).map(event => event.name), ['lantern_lit', 'game_over'])
  assert.deepEqual(events.at(-1).data, { result: 'won', reason: 'all_lit' })
  assert.deepEqual(end, { type: 'end', ticks: 16, state: 'won', score: 628 })
})

test('pulse costs light, pushes within radius and observes cooldown and stun timing', t => {
  const { events, snapshots } = run(t, { ticks: 122, scenario: { ...empty,
    player: { carried: 4 }, shades: [{ id: 'Near', pos: [5, 0, 0] }, { id: 'Far', pos: [6, 0, 0] }]
  }, frames: [{ tick: 0, pulse: true }, { tick: 1, pulse: false }, { tick: 2, pulse: true }] })
  assert.deepEqual(events, [{ type: 'event', tick: 1, name: 'pulse', data: { stunned_ids: ['Near'] } }])
  assert.equal(snapshots[1].player.carried, 2)
  assert.deepEqual(snapshots[1].shades[0].pos, [7, 0, 0])
  assert.equal(snapshots[120].shades[0].state, 'stunned')
  assert.equal(snapshots[121].shades[0].state, 'chase')
})

test('a lit lantern protects the player and keeps chasing shades outside its radius', t => {
  const { events, snapshots } = run(t, { scenario: { ...empty,
    lanterns: [{ id: 'L1', lit: true, pos: [0, 0, 0] }], shades: [{ pos: [4, 0, 0] }]
  } })
  assert.deepEqual(events, [])
  assert.equal(snapshots.at(-1).player.flames, 3)
  assert.ok(snapshots.at(-1).shades[0].pos[0] >= 3)
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
  assert.deepEqual(events, [{ type: 'event', tick: 60, name: 'game_over', data: { result: 'lost', reason: 'dawn' } }])
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

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createGame, stepBenchmark } from '../game.mjs'

const contract = JSON.parse(await readFile(new URL('../game.contract.json', import.meta.url)))

test('benchmark wander ticks move shades without mutating fuel, counters or player', () => {
  const game = createGame(contract, 42, {
    lanterns: [{ id: 'L1', lit: true }], shades: [{ pos: [4, 0, 0], state: 'wander' }]
  })
  const start = game.shades[0].pos
  for (let i = 0; i < 120; i++) stepBenchmark(game)
  assert.notDeepEqual(game.shades[0].pos, start)
  assert.equal(game.shades[0].state, 'wander')
  assert.equal(game.shades.length, 1)
  assert.equal(game.lanterns[0].fuelUnits, 6000)
  assert.deepEqual(game.player.pos, [0, 0, 0])
  assert.equal(game.player.flames, 3)
  assert.equal(game.time, 240)
  assert.equal(game.motes.length, 20)
  assert.equal(game.state, 'playing')
})

test('leaderboard validates input, serializes saves, keeps top ten and exports disk order', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dao-den-long-board-'))
  process.env.LEADERBOARD_FILE = join(directory, 'board.json')
  const { makeServer } = await import('../serve.mjs')
  const server = makeServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  const origin = 'http://127.0.0.1:' + server.address().port
  const url = origin + '/leaderboard'
  const save = (name, score, from = origin) => fetch(url, { method: 'POST',
    headers: { Origin: from, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, score, nights_won: 1, seed: 42 })
  })
  assert.deepEqual(await (await fetch(url)).json(), { entries: [] })
  assert.equal((await save('no!', 9)).status, 400)
  assert.equal((await save('Valid', 9, 'https://example.invalid')).status, 403)
  assert.equal((await save('First', 100)).status, 201)
  assert.equal((await save('Second', 100)).status, 201)
  const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => save('Name_' + i, i)))
  assert.ok(responses.every(response => response.status === 201))
  const data = await (await fetch(url)).json()
  assert.deepEqual(data.entries.map(entry => entry.score), [100, 100, 9, 8, 7, 6, 5, 4, 3, 2])
  assert.deepEqual(data.entries.slice(0, 2).map(entry => entry.name), ['First', 'Second'])
  assert.match(data.entries[0].achieved_at, /Z$/)
  const output = join(directory, 'export.json')
  execFileSync(process.execPath, ['serve.mjs', '--export-leaderboard', output])
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), data)
})

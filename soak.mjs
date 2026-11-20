import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { spawnSync } from 'node:child_process'
import { createGame, HZ, neutral, seededRandom, step } from './game.mjs'

// Run every night in the same worker. Collect at both measurement points so
// temporary allocations and uncollected cycles do not masquerade as leaks.
if (!globalThis.gc) {
  const child = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit' })
  process.exit(child.status ?? 1)
}

try {
  const { values } = parseArgs({ options: {
    seed: { type: 'string' }, nights: { type: 'string' }, out: { type: 'string' }
  } })
  const seed = Number(values.seed), nights = Number(values.nights)
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(nights) || nights < 1 || !values.out) {
    throw new Error('Usage: node soak.mjs --seed INT --nights INT --out FILE')
  }
  const contract = JSON.parse(readFileSync(new URL('./game.contract.json', import.meta.url)))
  const policy = contract.soak
  const started = performance.now(), results = []
  const rss = () => {
    globalThis.gc()
    return process.memoryUsage.rss() / 1048576
  }
  let memStart, crashes = 0
  let game
  for (let i = 0; i < nights; i++) {
    const night = i % 3 + 1
    try {
      game = createGame(contract, seed + i, {}, night)
      if (i === 0) memStart = rss()
      const random = seededRandom(seed + i)
      const limit = contract.tuning['night' + night + '_duration_s'] * HZ
      let move = neutral.move
      for (let tick = 0; tick < limit && game.state === 'playing'; tick++) {
        if (tick % policy.direction_ticks === 0) {
          const angle = random() * Math.PI * 2
          move = [Math.cos(angle), Math.sin(angle)]
        }
        step(game, { ...neutral, move, jump: random() < policy.jump, dash: random() < policy.dash,
          pulse: random() < policy.pulse, interact: random() < policy.interact })
      }
      results.push(game.state)
    } catch (error) {
      crashes++
      results.push('crash')
      console.error('Night ' + (i + 1) + ': ' + error.message)
    } finally {
      game = null
    }
  }
  const memEnd = rss()
  writeFileSync(values.out, JSON.stringify({ nights, crashes, results, mem_start_mb: memStart ?? null,
    mem_end_mb: memEnd, duration_s: (performance.now() - started) / 1000 }, null, 2) + '\n')
  process.exitCode = crashes ? 1 : 0
} catch (error) {
  console.error(error.message)
  process.exitCode = 2
}

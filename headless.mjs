import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createGame, neutral, snapshot, step } from './game.mjs'

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = Number.isFinite
const count = n => Number.isSafeInteger(n) && n >= 0
const bool = n => typeof n === 'boolean'
const vector = (v, size, check = finite) => Array.isArray(v) && v.length === size && v.every(check)
const pos = v => vector(v, 3)
const optional = (obj, key, check) => !Object.hasOwn(obj, key) || check(obj[key])
const list = check => value => Array.isArray(value) && value.every(check)
const id = value => typeof value === 'string' && value.length > 0
const unique = (items, getId) => new Set(items.map(getId)).size === items.length

function framesValid(input) {
  return isObject(input) && list((frame) => isObject(frame) && count(frame.tick) &&
    optional(frame, 'move', v => vector(v, 2, n => finite(n) && Math.abs(n) <= 1)) &&
    optional(frame, 'cam_yaw_deg', finite) &&
    ['jump', 'interact', 'pulse', 'dash'].every(key => optional(frame, key, bool)))(input.frames) &&
    input.frames.every((frame, index, all) => index === 0 || frame.tick > all[index - 1].tick)
}

function scenarioValid(s, t) {
  return isObject(s) &&
    optional(s, 'player', p => isObject(p) && optional(p, 'pos', pos) &&
      optional(p, 'carried', n => count(n) && n <= t.carry_capacity) &&
      optional(p, 'flames', count)) &&
    optional(s, 'time_left_s', n => finite(n) && n >= 0) &&
    optional(s, 'random_motes', bool) && optional(s, 'random_shades', bool) &&
    optional(s, 'motes', list(pos)) &&
    optional(s, 'shades', items => list(x => isObject(x) && pos(x.pos) && optional(x, 'id', id))(items) &&
      unique(items, (x, i) => x.id ?? 'S' + (i + 1))) &&
    optional(s, 'lanterns', items => list(x => isObject(x) &&
      Array.from({ length: t.lantern_count_night1 }, (_, i) => 'L' + (i + 1)).includes(x.id) &&
      optional(x, 'pos', pos) && optional(x, 'lit', bool) &&
      optional(x, 'deposited', n => count(n) && n <= t.lantern_cost))(items) && unique(items, x => x.id))
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
}

try {
  const options = Object.fromEntries(
    ['seed', 'night', 'scenario', 'inputs', 'ticks', 'out', 'snapshot-every'].map(key => [key, { type: 'string' }]))
  const { values: args } = parseArgs({ options })
  const integer = value => /^-?\d+$/.test(value ?? '') ? Number(value) : NaN
  const seed = integer(args.seed)
  const ticks = integer(args.ticks)
  const every = integer(args['snapshot-every'] ?? '60')
  if (!Number.isSafeInteger(seed) || !count(ticks) || !count(every) || every === 0 ||
      integer(args.night) !== 1 || !args.out) {
    throw new Error('Usage: node headless.mjs --seed INT --night 1 --ticks INT --out FILE [--scenario FILE] [--inputs FILE] [--snapshot-every INT]')
  }
  const { tuning } = readJSON(new URL('./game.contract.json', import.meta.url))
  const scenario = args.scenario === undefined ? {} : readJSON(args.scenario)
  const inputs = args.inputs === undefined ? { frames: [] } : readJSON(args.inputs)
  if (!scenarioValid(scenario, tuning)) throw new Error('Invalid scenario')
  if (!framesValid(inputs)) throw new Error('Invalid inputs')
  const game = createGame(tuning, seed, scenario)
  const lines = [JSON.stringify(snapshot(game))]
  let input = neutral
  let index = 0
  while (game.tick < ticks && game.state === 'playing') {
    if (inputs.frames[index]?.tick === game.tick) {
      const { tick, ...frame } = inputs.frames[index++]
      input = { ...input, ...frame }
    }
    for (const event of step(game, tuning, input)) lines.push(JSON.stringify(event))
    if (game.tick % every === 0) lines.push(JSON.stringify(snapshot(game)))
  }
  lines.push(JSON.stringify({ type: 'end', ticks: game.tick, state: game.state, score: game.score }))
  writeFileSync(args.out, lines.join('\n') + '\n')
} catch (error) {
  console.error(error.message)
  process.exitCode = 2
}

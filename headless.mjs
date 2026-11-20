import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { carryCapacity, createGame, lanternCost, neutral, snapshot, step } from './game.mjs'

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
    ['jump', 'interact', 'pulse', 'dash', 'pause'].every(key => optional(frame, key, bool)))(input.frames) &&
    input.frames.every((frame, index, all) => index === 0 || frame.tick > all[index - 1].tick)
}

function scenarioValid(s, t, map) {
  const lanternIds = Array.from({ length: map.lanterns.length }, (_, i) => 'L' + (i + 1))
  return isObject(s) &&
    optional(s, 'player', p => isObject(p) && optional(p, 'pos', pos) &&
      optional(p, 'successful_lights', count) &&
      optional(p, 'carried', n => count(n) && n <= carryCapacity(t, p.successful_lights ?? 0)) &&
      optional(p, 'flames', count) && optional(p, 'vel', pos) &&
      ['invuln_ticks', 'dash_cd_ticks', 'pulse_cd_ticks', 'charm_ticks'].every(key => optional(p, key, count))) &&
    optional(s, 'time_left_s', n => finite(n) && n >= 0) &&
    optional(s, 'random_motes', bool) && optional(s, 'random_shades', bool) &&
    optional(s, 'motes', list(item => pos(item) || isObject(item) && pos(item.pos) &&
      optional(item, 'id', id) && optional(item, 'kind', v => ['random', 'dropped'].includes(v)) &&
      optional(item, 'ttl_ticks', count))) &&
    optional(s, 'random_drifters', bool) && optional(s, 'wind_enabled', bool) &&
    optional(s, 'drifters', list(item => isObject(item) && pos(item.pos) && optional(item, 'id', id) &&
      optional(item, 'state', v => ['idle', 'chase', 'flee', 'removed'].includes(v)) &&
      optional(item, 'stolen', count) && optional(item, 'state_ticks_left', count))) &&
    optional(s, 'charms', list(item => isObject(item) && optional(item, 'pos', pos) &&
      optional(item, 'id', id) && optional(item, 'available', bool) && optional(item, 'respawn_ticks', count))) &&
    optional(s, 'shades', items => list(x => isObject(x) && pos(x.pos) && optional(x, 'id', id) &&
      optional(x, 'state', v => ['spawning', 'wander', 'chase', 'recoil', 'stunned', 'drain'].includes(v)) &&
      optional(x, 'target_lantern_id', v => lanternIds.includes(v)) &&
      optional(x, 'state_ticks_left', count))(items) &&
      unique(items, (x, i) => x.id ?? 'S' + (i + 1))) &&
    optional(s, 'lanterns', items => list(x => isObject(x) &&
      lanternIds.includes(x.id) &&
      optional(x, 'pos', pos) && optional(x, 'lit', bool) &&
      optional(x, 'ever_lit', bool) && optional(x, 'fuel', v => finite(v) && v >= 0 && v <= t.fuel_max) &&
      optional(x, 'deposited', n => count(n) && n <= (x.lit ? t.lantern_cost : lanternCost(t, x))))(items) &&
      unique(items, x => x.id))
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
  const night = integer(args.night)
  const every = integer(args['snapshot-every'] ?? '60')
  if (!Number.isSafeInteger(seed) || !count(ticks) || !count(every) || every === 0 ||
      ![1, 2, 3].includes(night) || !args.out) {
    throw new Error('Usage: node headless.mjs --seed INT --night 1|2|3 --ticks INT --out FILE [--scenario FILE] [--inputs FILE] [--snapshot-every INT]')
  }
  const contract = readJSON(new URL('./game.contract.json', import.meta.url))
  const scenario = args.scenario === undefined ? {} : readJSON(args.scenario)
  const inputs = args.inputs === undefined ? { frames: [] } : readJSON(args.inputs)
  if (!scenarioValid(scenario, contract.tuning, contract.maps[night - 1])) throw new Error('Invalid scenario')
  if (!framesValid(inputs)) throw new Error('Invalid inputs')
  const game = createGame(contract, seed, scenario, night)
  const lines = [JSON.stringify(snapshot(game))]
  let input = neutral
  let index = 0
  while (game.tick < ticks && ['playing', 'paused'].includes(game.state)) {
    if (inputs.frames[index]?.tick === game.tick) {
      const { tick, ...frame } = inputs.frames[index++]
      input = { ...input, ...frame }
    }
    for (const event of step(game, input)) lines.push(JSON.stringify(event))
    if (game.tick % every === 0) lines.push(JSON.stringify(snapshot(game)))
  }
  lines.push(JSON.stringify({ type: 'end', ticks: game.tick, state: game.state, score: game.score }))
  writeFileSync(args.out, lines.join('\n') + '\n')
} catch (error) {
  console.error(error.message)
  process.exitCode = 2
}

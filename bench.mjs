import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { platform, release, arch } from 'node:os'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import { makeServer } from './serve.mjs'

const contract = JSON.parse(readFileSync(new URL('./game.contract.json', import.meta.url)))
let browser, server
try {
  const { values } = parseArgs({ options: {
    seed: { type: 'string' }, duration: { type: 'string' }, out: { type: 'string' }
  } })
  const seed = Number(values.seed), duration = Number(values.duration)
  if (!Number.isSafeInteger(seed) || !Number.isFinite(duration) || duration <= 0 || !values.out) {
    throw new Error('Usage: node bench.mjs --seed INT --duration SECONDS --out FILE')
  }
  const candidates = process.platform === 'win32' ? [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ] : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  const executablePath = process.env.BENCH_BROWSER || candidates.find(path => existsSync(path))
  if (!executablePath) throw new Error('Install Chromium/Chrome/Edge or set BENCH_BROWSER to its executable.')
  const headless = process.env.BENCH_HEADLESS === '1'
  const { width, height, warmup_s } = contract.benchmark
  server = makeServer()
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ executablePath, headless,
    args: ['--disable-frame-rate-limit', '--disable-gpu-vsync', `--window-size=${width},${height}`] })
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  let loadMs
  await page.exposeFunction('benchFirstFrame', () => { loadMs = process.uptime() * 1000 })
  let complete, fail
  const measured = new Promise((resolve, reject) => { complete = resolve; fail = reject })
  await page.exposeFunction('benchComplete', complete)
  page.on('pageerror', fail)
  page.once('crash', () => fail(new Error('Benchmark page crashed')))
  page.once('close', () => fail(new Error('Benchmark page closed before completion')))
  const timeout = setTimeout(() => fail(new Error('Benchmark timed out')), (duration + warmup_s + 30) * 1000)
  let times
  try {
    const [result] = await Promise.all([measured,
      page.goto(`http://127.0.0.1:${server.address().port}/?bench=${seed}&duration=${duration}`)])
    times = result
  } finally {
    clearTimeout(timeout)
  }
  const frames = times.length
  if (!frames || !Number.isFinite(loadMs)) throw new Error('Benchmark measured no complete frames.')
  times.sort((a, b) => a - b)
  const tail = times.slice(-Math.max(1, Math.ceil(frames * .01)))
  const sum = values => values.reduce((total, value) => total + value, 0)
  const round = n => Number(n.toFixed(2))
  writeFileSync(values.out, JSON.stringify({
    contract_version: contract.contract_version, avg_fps: round(1000 * frames / sum(times)),
    p1_low_fps: round(1000 * tail.length / sum(tail)), frame_ms_p95: round(times[Math.ceil(.95 * frames) - 1]),
    frames, load_ms: round(loadMs), peak_mem_mb: null, vsync_off: true,
    renderer: `Canvas 2D projected 3D / Chromium ${browser.version()}${headless ? ' (headless)' : ''}`,
    os: `${platform()} ${release()} ${arch()}`
  }, null, 2) + '\n')
} catch (error) {
  console.error(error.message)
  process.exitCode = 2
} finally {
  await browser?.close()
  server?.close()
}

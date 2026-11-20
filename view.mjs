import { carryCapacity, createGame, dawnTarget, HZ, isSafe, lanternCost, nearestLantern, seededRandom,
  step, stepBenchmark } from './game.mjs'

const byId = id => document.getElementById(id)
const canvas = byId('world')
const ctx = canvas.getContext('2d')
const overlay = byId('overlay')
const start = byId('start')
const contract = await fetch('./game.contract.json').then(response => response.json())
const { tuning } = contract
const names = ['Đảo Bến', 'Đảo Cau', 'Đảo Chuông']
const advice = ['Châm dầu cho đèn để giữ đảo sáng đến bình minh. Bóng Mực tìm đến đèn sắp cạn dầu.',
  'Cầu tre hẹp. Nếu lạc đường, tìm bục nhảy để sang đảo bên kia.',
  'Đi theo dốc lên vành đảo, rồi dùng bục nhảy để tới tháp chuông.']
let night = 1, total = 0, screen = 'menu', settingsBack = 'menu', pauseEdge = false
const defaultKeys = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA'], right: ['KeyD'],
  jump: ['Space'], dash: ['ShiftLeft', 'ShiftRight'], interact: ['KeyE'], pulse: ['KeyQ'], pause: ['Escape', 'KeyP']
}
const actionNames = { up: 'Tiến', down: 'Lùi', left: 'Sang trái', right: 'Sang phải',
  jump: 'Nhảy', dash: 'Lướt', interact: 'Nạp', pulse: 'Tỏa Sáng', pause: 'Tạm dừng' }
const campaignSeed = 1528
let preferences = { volume: 0.4, sensitivity: 0.5, accessiblePalette: false, reduceMotion: false, largeText: false, bindings: {} }
try { Object.assign(preferences, JSON.parse(localStorage.getItem('lantern-settings') ?? '{}')) } catch {}
const binding = action => preferences.bindings?.[action] ?? defaultKeys[action]
const keyHeld = action => binding(action).some(code => keys.has(code))
const keyName = code => code.replace(/^(Key|Digit)/, '').replace(/^Shift(Left|Right)$/, 'Shift')
let rebinding
let nightsWon = 0, scoreSaved = false, scoreSaving = false
let audio, nextNote = 0, windWarning = 0
const tones = {
  mote_picked: [660, 880], lantern_lit: [392, 523, 659], refuel: [523, 659], lantern_out: [294, 196], pulse: [220, 440],
  player_hit: [196, 131], jump: [392, 587], dash: [523, 294], won: [523, 659, 784, 1047],
  lost: [392, 294, 196], shade_spawned: [165, 147], countdown: [740], wind_warning: [294, 330, 294]
}
function sound(notes, gain = 0.15, length = 0.12) {
  if (audio?.state !== 'running' || !preferences.volume || !notes) return
  notes.forEach((pitch, i) => {
    const startAt = audio.currentTime + i * length * 0.75
    const oscillator = audio.createOscillator(), envelope = audio.createGain()
    oscillator.frequency.value = pitch
    envelope.gain.setValueAtTime(gain * preferences.volume, startAt)
    envelope.gain.exponentialRampToValueAtTime(0.001, startAt + length)
    oscillator.connect(envelope).connect(audio.destination)
    oscillator.start(startAt)
    oscillator.stop(startAt + length)
  })
}
const keys = new Set()
const cameraKey = code => ['ArrowLeft', 'ArrowRight'].includes(code)
let game, active = false, yaw = 0, pulseTick = -100
let faces = [], project, cameraPoint, screenPoint
let backdrop, scenery, sceneryMap
const tau = Math.PI * 2
const materials = new Map()
const lightTextures = new Map()
const unitRings = new Map()
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
const lessMotion = () => preferences.reduceMotion || reducedMotion?.matches
const params = new URLSearchParams(location.search)
const benchmarking = params.has('bench') && typeof window.benchComplete === 'function'
let shadeNotice, countdownNotice
const bursts = []
let lightSources = [], mist
let groundDepth
let cameraWorld
let viewportWidth, viewportHeight

const effects = {
  mote_picked: { rgb: '255,226,124', count: 9, life: 28 },
  lantern_lit: { rgb: '255,184,79', count: 24, life: 58 },
  pulse: { rgb: '255,236,159', count: 20, life: 32 },
  dash: { rgb: '145,219,255', count: 12, life: 24 },
  player_hit: { rgb: '212,134,255', count: 12, life: 28 }
}

function input() {
  return {
    move: [Number(keyHeld('right')) - Number(keyHeld('left')), Number(keyHeld('up')) - Number(keyHeld('down'))],
    cam_yaw_deg: yaw, interact: keyHeld('interact'), pulse: keyHeld('pulse'), jump: keyHeld('jump'),
    dash: keyHeld('dash'), pause: pauseEdge
  }
}

function reset() {
  game = createGame(contract, campaignSeed + night - 1, {}, night)
  scoreSaved = false
  byId('score-feedback').hidden = true
  byId('score-name').value = ''
  shadeNotice = countdownNotice = null
  yaw = 0
  pulseTick = -100
  bursts.length = 0
  windWarning = 0
  nextNote = 0
  keys.clear()
  byId('night-label').textContent = 'Đêm ' + night + ' · ' + names[night - 1]
}
function show(next, reason = '') {
  screen = next
  active = next === 'play'
  overlay.hidden = active
  byId('settings-fields').hidden = next !== 'settings'
  byId('pause-actions').hidden = next !== 'pause'
  byId('menu-settings').hidden = next !== 'menu'
  byId('open-leaderboard').hidden = next !== 'menu'
  byId('leaderboard').hidden = next !== 'leaderboard'
  byId('score-form').hidden = scoreSaved || !['loss', 'dawn'].includes(next)
  byId('score-feedback').hidden = !['loss', 'dawn'].includes(next)
  const content = {
    menu: ['Đảo Đèn Lồng', 'Cùng Mây thắp sáng ba hòn đảo.', 'Bắt đầu'],
    intro: ['Đêm ' + night + ' · ' + names[night - 1],
      'Ông Đăng: “Giữ ít nhất ' + dawnTarget(game) + ' đèn sáng tới bình minh. ' + advice[night - 1] + '”', 'Vào đảo'],
    pause: ['Tạm dừng', names[night - 1], 'Tiếp tục'],
    win: ['Đảo đã sáng!', 'Điểm đêm: ' + game.score + ' · Tổng điểm: ' + total, 'Đêm kế tiếp'],
    loss: ['Đêm đã khép lại', reason === 'dawn' ? 'Bình minh đến khi đảo chưa đủ đèn sáng.' : 'Mây đã hết Ngọn Lửa.', 'Chơi lại'],
    dawn: ['Bình Minh', 'Cả ba đảo đã sáng. Tổng điểm: ' + total, 'Về menu'],
    settings: ['Cài đặt', '', 'Quay lại'],
    leaderboard: ['Bảng xếp hạng', '', 'Về menu']
  }
  if (active) return
  const [title, message, label] = content[next]
  byId('title').textContent = title
  byId('message').textContent = message
  start.textContent = label
  start.focus()
}
function mainMenu() {
  night = 1
  total = 0
  nightsWon = 0
  reset()
  show('menu')
}
function resume() {
  if (game.previous.pause) step(game, { ...input(), pause: false })
  step(game, { ...input(), pause: true })
  show('play')
}
function settings() {
  settingsBack = screen
  for (const key of ['volume', 'sensitivity']) byId(key).value = preferences[key]
  byId('accessible-palette').checked = preferences.accessiblePalette
  byId('reduce-motion').checked = preferences.reduceMotion
  byId('large-text').checked = preferences.largeText
  byId('key-feedback').textContent = ''
  show('settings')
}
function applyPreferences() {
  document.body.classList.toggle('accessible-palette', preferences.accessiblePalette)
  document.body.classList.toggle('reduce-motion', preferences.reduceMotion)
  document.body.classList.toggle('large-text', preferences.largeText)
}
function savePreferences() {
  try { localStorage.setItem('lantern-settings', JSON.stringify(preferences)) } catch {}
}
for (const key of ['volume', 'sensitivity']) {
  byId(key).addEventListener('input', event => {
    preferences[key] = Number(event.target.value)
    savePreferences()
  })
}
for (const [id, key] of [['accessible-palette', 'accessiblePalette'], ['reduce-motion', 'reduceMotion'], ['large-text', 'largeText']]) {
  byId(id).addEventListener('change', event => {
    preferences[key] = event.target.checked
    applyPreferences()
    savePreferences()
  })
}
const keyButtons = {}
for (const [action, name] of Object.entries(actionNames)) {
  const button = document.createElement('button')
  button.type = 'button'
  button.onclick = () => {
    rebinding = action
    byId('key-feedback').textContent = 'Bấm phím mới cho ' + name + '.'
  }
  keyButtons[action] = button
  byId('key-bindings').append(button)
}
function updateBindings() {
  for (const [action, button] of Object.entries(keyButtons)) {
    button.textContent = actionNames[action] + ' · ' + binding(action).map(keyName).join('/')
  }
  byId('controls-guide').textContent = ['up', 'down', 'left', 'right'].map(action => keyName(binding(action)[0])).join(' ') +
    ' · Di chuyển / ' + ['jump', 'dash', 'interact', 'pulse', 'pause']
      .map(action => keyName(binding(action)[0]) + ' · ' + actionNames[action]).join(' / ')
}
byId('restore-keys').onclick = () => {
  preferences.bindings = {}
  rebinding = null
  savePreferences()
  updateBindings()
  byId('key-feedback').textContent = 'Đã khôi phục phím mặc định.'
}
applyPreferences()
updateBindings()
byId('open-leaderboard').onclick = async () => {
  show('leaderboard')
  const list = byId('leaderboard')
  list.replaceChildren()
  byId('message').textContent = 'Đang tải…'
  try {
    const response = await fetch('./leaderboard')
    if (!response.ok) throw new Error()
    const { entries } = await response.json()
    if (screen !== 'leaderboard') return
    byId('message').textContent = entries.length ? '' : 'Chưa có điểm đã lưu.'
    for (const entry of entries) {
      const li = document.createElement('li')
      li.textContent = entry.name + ' · ' + entry.score + ' điểm · ' + entry.nights_won + '/3 đêm'
      list.append(li)
    }
  } catch {
    if (screen === 'leaderboard') byId('message').textContent = 'Không thể tải điểm đã lưu.'
  }
}
byId('score-form').onsubmit = async event => {
  event.preventDefault()
  if (scoreSaved || scoreSaving) return
  scoreSaving = true
  start.disabled = true
  const feedback = byId('score-feedback')
  try {
    const response = await fetch('./leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: byId('score-name').value, score: total, nights_won: nightsWon, seed: campaignSeed }) })
    if (!response.ok) throw new Error()
    scoreSaved = true
    byId('score-form').hidden = true
    feedback.textContent = 'Đã lưu điểm.'
  } catch {
    feedback.textContent = 'Không lưu được điểm. Hãy thử lại.'
  } finally {
    scoreSaving = false
    start.disabled = false
  }
}
byId('menu-settings').onclick = settings
byId('pause-settings').onclick = settings
byId('quit').onclick = mainMenu
byId('restart').onclick = () => { reset(); show('intro') }
start.onclick = () => {
  if (!audio && window.AudioContext) audio = new AudioContext()
  audio?.resume().catch(() => {})
  switch (screen) {
    case 'menu': show('intro'); break
    case 'intro': show('play'); break
    case 'pause': resume(); break
    case 'win': night++; reset(); show('intro'); break
    case 'loss': reset(); show('intro'); break
    case 'dawn': mainMenu(); break
    case 'settings': rebinding = null; show(settingsBack); break
    case 'leaderboard': mainMenu(); break
  }
}
mainMenu()

window.addEventListener('keydown', event => {
  if (screen === 'settings' && rebinding && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault()
    const duplicate = Object.keys(defaultKeys).find(action => action !== rebinding && binding(action).includes(event.code))
    if (duplicate || cameraKey(event.code) || !event.code || event.code === 'Tab') {
      byId('key-feedback').textContent = duplicate ? 'Phím trùng với ' + actionNames[duplicate] + '.' : 'Phím này đang được dành riêng.'
      return
    }
    const action = rebinding
    preferences.bindings = { ...preferences.bindings, [action]: [event.code] }
    rebinding = null
    savePreferences()
    updateBindings()
    byId('key-feedback').textContent = 'Đã đổi phím ' + actionNames[action] + '.'
    return
  }
  if (!['play', 'pause'].includes(screen) ||
      !(cameraKey(event.code) || Object.keys(defaultKeys).some(action => binding(action).includes(event.code)))) return
  event.preventDefault()
  if (binding('pause').includes(event.code)) {
    if (!event.repeat && screen === 'pause') resume()
    else if (!event.repeat) pauseEdge = true
    return
  }
  if (active) keys.add(event.code)
})
window.addEventListener('keyup', event => keys.delete(event.code))
window.addEventListener('blur', () => keys.clear())
canvas.addEventListener('mousemove', event => {
  if (active && event.buttons & 1) yaw += event.movementX * preferences.sensitivity
})

const litChannel = (base, shade, offset, haze, fog) =>
  Math.round(Math.min(255, base * shade + offset) * (1 - fog) + haze * fog)

function surfaceColor(vertices, color, depth) {
  if (!materials.has(color)) {
    const hex = Number.parseInt(color.slice(1), 16)
    materials.set(color, [hex >> 16, (hex >> 8) & 255, hex & 255])
  }
  const [a, b, c] = vertices
  let shade = .99
  if (a[1] !== b[1] || a[1] !== c[1]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const normal = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    shade = .73 + (.26 * Math.abs(ny) + .16 * (nx * .6 + nz * .8)) / normal
  }
  const x = (a[0] + c[0]) / 2, y = (a[1] + c[1]) / 2, z = (a[2] + c[2]) / 2
  let warm = 0
  for (const light of lightSources) {
    const dx = x - light.x, dy = y - light.y, dz = z - light.z
    const reach = Math.max(0, 1 - (dx * dx + dy * dy * 2 + dz * dz) / light.rangeSquared)
    warm += reach * reach * light.power
  }
  warm = Math.min(warm, 1)
  const fog = Math.min(.64, Math.max(0, (depth - 14) / 76))
  const [r, g, blue] = materials.get(color)
  return `rgb(${litChannel(r, shade, 1 + 116 * warm, mist[0], fog)},${litChannel(g, shade, 5 + 73 * warm, mist[1], fog)},${litChannel(blue, shade, 12 + 24 * warm, mist[2], fog)})`
}

function polygon(vertices, color, line = false, width = 2, emissive = false, floor = false) {
  const camera = vertices.map(cameraPoint)
  const near = 0.45
  const clipped = []
  for (let i = 0; i < camera.length; i++) {
    const a = camera[i], b = camera[(i + 1) % camera.length]
    if (a[2] >= near) clipped.push(a)
    if ((a[2] < near) !== (b[2] < near)) {
      const t = (near - a[2]) / (b[2] - a[2])
      clipped.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, near])
    }
  }
  if (clipped.length < 3) return
  const depth = clipped.reduce((sum, point) => sum + point[2], 0) / clipped.length
  const visible = clipped.map(screenPoint)
  if (visible.every(p => p[0] < 0) || visible.every(p => p[0] > viewportWidth) ||
      visible.every(p => p[1] < 0) || visible.every(p => p[1] > viewportHeight)) return
  const paintColor = line || emissive || color.length !== 7 ? color : surfaceColor(vertices, color, depth)
  // A broad floor face can have a nearer centroid than Mây even though it lies beneath her.
  const drawDepth = floor && vertices.every(point => point[1] <= game.player.pos[1] + .03)
    ? Math.max(depth, groundDepth + .01) : depth
  faces.push({ points: visible, color: paintColor, line, width, depth: drawDepth })
}

function floorPolygon(vertices, color) {
  polygon(vertices, color, false, 2, false, true)
}
function ring(x, y, z, r, n) {
  if (!unitRings.has(n)) unitRings.set(n,
    Array.from({ length: n }, (_, i) => [Math.cos(i * tau / n), Math.sin(i * tau / n)]))
  return unitRings.get(n).map(([cos, sin]) => [x + cos * r, y, z + sin * r])
}

function frustum(x, y, z, lower, upper, height, colors, sides = 8, emissive = false, cull = false) {
  const a = ring(x, y, z, lower, sides)
  const b = ring(x, y + height, z, upper, sides)
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides
    if (cull) {
      const [nx1, nz1] = unitRings.get(sides)[i], [nx2, nz2] = unitRings.get(sides)[next]
      const [cx, cy, cz] = cameraWorld
      const facing = (nx1 + nx2) * (cx - a[i][0]) + (nz1 + nz2) * (cz - a[i][2]) +
        (1 + nx1 * nx2 + nz1 * nz2) * (lower - upper) / height * (cy - y)
      if (facing <= 0) continue
    }
    polygon([a[i], a[next], b[next], b[i]], colors[i % colors.length], false, 2, emissive)
  }
  if (upper > 0 && (!cull || cameraWorld[1] > y + height)) polygon(b, colors[0], false, 2, emissive)
}

function orb(x, y, z, r, colors, emissive = false, cull = false) {
  frustum(x, y - r, z, 0, r, r, colors, 5, emissive, cull)
  frustum(x, y, z, r, 0, r, colors, 5, emissive, cull)
}

function noise(i) {
  const n = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return n - Math.floor(n)
}

const nightSkies = [
  ['#080F24', '#273663', '#214656', [37, 65, 84]],
  ['#0B1129', '#34365E', '#2C405C', [44, 61, 92]],
  ['#100D24', '#493758', '#333857', [51, 56, 87]]
]

function makeBackdrop(width, height) {
  const image = document.createElement('canvas')
  image.width = width
  image.height = height
  const g = image.getContext('2d')
  const sky = g.createLinearGradient(0, 0, 0, height)
  const [zenith, horizon, valley] = nightSkies[night - 1]
  sky.addColorStop(0, zenith)
  sky.addColorStop(.56, horizon)
  sky.addColorStop(1, valley)
  g.fillStyle = sky
  g.fillRect(0, 0, width, height)
  const moonX = width * .78, moonY = height * .2
  const moonR = Math.max(13, Math.min(width, height) * .043)
  const halo = g.createRadialGradient(moonX, moonY, moonR * .2, moonX, moonY, moonR * 5)
  halo.addColorStop(0, '#D1DFFF59')
  halo.addColorStop(.35, '#A7BBFF26')
  halo.addColorStop(1, '#A7BBFF00')
  g.fillStyle = halo
  g.fillRect(0, 0, width, height)
  for (let i = 0; i < 160; i++) {
    const x = width * noise(i * 3), y = height * .67 * noise(i * 3 + 1)
    if (Math.hypot(x - moonX, y - moonY) < moonR) continue
    g.globalAlpha = .18 + noise(i * 3 + 2) * .62
    g.fillStyle = i % 4 ? '#DFE7FF' : '#FFE9B0'
    g.fillRect(x, y, i % 11 ? 1 : 2, i % 11 ? 1 : 2)
  }
  g.globalAlpha = 1
  g.beginPath()
  g.arc(moonX, moonY, moonR, 0, tau)
  g.fillStyle = '#EEF0E2'
  g.fill()
  g.save()
  g.clip()
  for (let i = 0; i < 24; i++) {
    g.fillStyle = '#A4B5CF28'
    g.beginPath()
    g.ellipse(moonX + (noise(i) - .5) * moonR * 2, moonY + (noise(i + 40) - .5) * moonR * 2,
      moonR * (.07 + noise(i + 80) * .22), moonR * .1, i, 0, tau)
    g.fill()
  }
  g.restore()
  for (let layer = 0; layer < 4; layer++) {
    g.beginPath()
    g.moveTo(0, height)
    for (let x = 0; x < width + 12; x += 12) {
      const u = x / width
      const ridge = Math.abs(Math.sin(u * (12 + layer) + layer * 2)) ** 3
      const detail = Math.sin(u * 43 + layer) * .012 + Math.cos(u * 94) * .006
      g.lineTo(x, height * (.31 + layer * .062 - ridge * (.13 - layer * .016) + detail))
    }
    g.lineTo(width, height)
    g.fillStyle = ['#4E577A', '#3C506C', '#2A4159', valley][layer]
    g.fill()
  }
  for (let i = 0; i < 32; i++) {
    const x = width * noise(i + 99), y = height * (.42 + noise(i + 160) * .55)
    const w = width * (.08 + noise(i + 200) * .17)
    g.save()
    g.translate(x, y)
    g.scale(w, height * .035)
    const mist = g.createRadialGradient(0, 0, 0, 0, 0, 1)
    mist.addColorStop(0, '#B4D9E333')
    mist.addColorStop(1, '#B4D9E300')
    g.fillStyle = mist
    g.fillRect(-1, -1, 2, 2)
    g.restore()
  }
  const vignette = g.createRadialGradient(width * .5, height * .47, height * .25,
    width * .5, height * .47, Math.max(width, height) * .67)
  vignette.addColorStop(0, '#080E2200')
  vignette.addColorStop(1, '#080E2270')
  g.fillStyle = vignette
  g.fillRect(0, 0, width, height)
  return image
}

const meadowColors = [
  ['#385E49', '#477153', '#527658', '#42664C', '#3C6854'],
  ['#315B56', '#3F7063', '#4C7765', '#3D665E', '#365F57'],
  ['#48554F', '#565F50', '#60664F', '#495F50', '#4F6355']
]
const trailColors = ['#666B50', '#5A7060', '#716757']
const terrainMeshes = new WeakMap()

function trailDistance(x, z, start, end) {
  const dx = end[0] - start[0], dz = end[1] - start[1]
  const fraction = Math.max(0, Math.min(1, ((x - start[0]) * dx + (z - start[1]) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(x - start[0] - fraction * dx, z - start[1] - fraction * dz)
}

function buildGroundDisk(cx, cz, y, radius, color, start, arc, inner) {
  const surfaces = [], cliffs = []
  const segments = 48, bands = 9
  const point = (r, a) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]
  const greens = meadowColors[night - 1]
  const sands = ['#C9B48A', '#CDB88F', '#C4AF85']
  for (let i = 0; i < segments; i++) {
    const left = start + i * arc / segments, right = start + (i + 1) * arc / segments
    for (let strip = 0; strip < bands; strip++) {
      const near = inner + (radius - inner) * strip / bands
      const far = near + (radius - inner) / bands
      const corners = [point(near, left), point(far, left), point(far, right), point(near, right)]
      const palette = color === '#C9B48A' ? sands : greens
      const mix = (Math.sin(i * .35 + strip * 1.4) + Math.cos(i * .77 - strip * .81) + 2) / 4
      const x = (corners[0][0] + corners[2][0]) / 2
      const z = (corners[0][2] + corners[2][2]) / 2
      const path = y === 0 && game.map.lanterns.some(([lx, ly, lz]) =>
        ly === 0 && Math.hypot(lx - cx, lz - cz) < radius &&
        trailDistance(x, z, [cx, cz], [lx, lz]) < 1.25)
      surfaces.push([corners, path ? trailColors[night - 1] : palette[Math.min(palette.length - 1, Math.floor(mix * palette.length))]])
    }
    const a = point(radius, left), b = point(radius, right)
    const drop = y ? 3 : 6 + noise(i + 7) * 4
    const inset = radius - (y ? 0 : 2 + noise(i + 12) * 4)
    const lower = [point(inset, left), point(inset, right)]
    lower.forEach(p => { p[1] -= drop })
    const seam = [a, b].map((top, j) => top.map((value, axis) => value * .75 + lower[j][axis] * .25))
    cliffs.push([[a, b, seam[1], seam[0]], i % 3 ? '#646A59' : '#79816B'])
    cliffs.push([[seam[0], seam[1], lower[1]], i % 3 ? '#334C57' : '#48606A'])
    cliffs.push([[seam[0], lower[1], lower[0]], i % 2 ? '#293D49' : '#3D505A'])
  }
  return { surfaces, cliffs }
}

function groundDisk(cx, cz, y, radius, color, start = 0, arc = tau, inner = 0) {
  if (!terrainMeshes.has(game.map)) terrainMeshes.set(game.map, new Map())
  const meshes = terrainMeshes.get(game.map)
  const key = [cx, cz, y, radius, color, start, arc, inner].join(',')
  if (!meshes.has(key)) meshes.set(key, buildGroundDisk(cx, cz, y, radius, color, start, arc, inner))
  const { surfaces, cliffs } = meshes.get(key)
  for (const [vertices, fill] of surfaces) floorPolygon(vertices, fill)
  for (const [vertices, fill] of cliffs) polygon(vertices, fill)
}

function makeScenery(map) {
  const landmarks = [
    [[-5, 16], [5.5, 18], [-8, 22], [8, 28]],
    [[-5, 13], [5.1, 14], [58, 8], [76, 16]],
    [[30, -4], [28, -16], [34, -24], [-30, -14]]
  ][night - 1].map(([x, z], i) => ({ x, z, seed: i * 4 + night, tall: true, edge: false }))
  return map.islands.flatMap(([cx, cz, radius], islandIndex) => {
    const samples = landmarks.filter(({ x, z }) => Math.hypot(x - cx, z - cz) < radius)
    for (let i = 0; i < 118; i++) {
      const seed = i + islandIndex * 151 + night * 173
      const angle = noise(seed) * tau
      const range = radius * (.25 + noise(seed + 400) * .68)
      const x = cx + Math.cos(angle) * range, z = cz + Math.sin(angle) * range
      const tall = i < 23
      if (map.bridge && Math.abs(z) < 5) continue
      if (map.lanterns.some(([lx, , lz]) => Math.hypot(lx - x, lz - z) < (tall ? 5 : 2.3))) continue
      if (map.pads?.some(({ pos: [px, , pz] }) => Math.hypot(px - x, pz - z) < 4)) continue
      if (map.tier && range < map.tier.outer + 2) continue
      if (game.ramps.some(ramp => {
        const along = x * ramp.axis[0] + z * ramp.axis[1]
        const across = x * ramp.edge[0] + z * ramp.edge[1]
        return along > ramp.inner - 2 && along < ramp.outer + 2 && Math.abs(across) < ramp.half + 2
      })) continue
      if (tall && samples.some(prop => prop.tall && Math.hypot(prop.x - x, prop.z - z) < 4)) continue
      samples.push({ x, z, seed, tall, edge: range > radius * .81 })
    }
    return samples
  })
}

function drawScenery(inView) {
  const { map, player } = game
  if (sceneryMap !== map) {
    sceneryMap = map
    scenery = makeScenery(map)
  }
  const distanceLimit = benchmarking ? 40 : 64
  const foliage = [
    ['#245846', '#387657', '#51956C'],
    ['#1C5153', '#307479', '#55938C'],
    ['#50435D', '#77556F', '#A47D86']
  ][night - 1]
  for (const { x, z, seed, tall, edge } of scenery) {
    const distance = Math.hypot(x - player.pos[0], z - player.pos[2])
    if (!tall && distance > 25) continue
    if (!benchmarking && tall && distance < 3.4) continue
    if ((!benchmarking && distance > distanceLimit) || !inView(x, tall ? 2.4 : .3, z, tall ? 3.4 : .8)) continue
    const size = noise(seed + 15)
    if (tall && edge && seed % 3 === 0) {
      const spread = 1.7 + size * 1.45
      frustum(x, 0, z, spread, spread * .54, .65 + size, ['#505D58', '#677267', '#7A8476'], 5, false, true)
      frustum(x, .65 + size, z, spread * .54, .1, .65 + size, ['#536D52', '#728164'], 5, false, true)
    } else if (tall) {
      const height = 2.6 + size * 2.8
      const trunk = ['#594637', '#796146']
      frustum(x, 0, z, .23 + size * .12, .11, height * .72, trunk, 5, false, true)
      const lod = distance > distanceLimit * .55
      if (night === 3 || seed % 3 === 0) {
        const lean = (noise(seed + 19) - .5) * 1.3
        orb(x + lean, height * .83, z, height * .33, foliage, false, true)
        if (!lod) {
          orb(x + lean - .66, height * .66, z + .32, height * .25, foliage, false, true)
          orb(x + lean + .65, height * .70, z - .35, height * .23, foliage, false, true)
        }
      } else {
        const skirt = height * .3
        frustum(x, height * .33, z, skirt, 0, height * .54, foliage, 6, false, true)
        frustum(x, height * .56, z, skirt * .78, 0, height * .47, foliage, 6, false, true)
      }
    } else if (seed % 7 === 0) {
      frustum(x, 0, z, .28 + size * .52, .12, .18 + size * .55, ['#556462', '#788377'], 5, false, true)
    } else {
      const h = .18 + size * .45
      const color = foliage[seed % foliage.length]
      polygon([[x - h * .46, .02, z], [x + h * .45, h, z + h * .3], [x + h * .18, .02, z]], color)
      polygon([[x, .02, z - h * .4], [x - h * .33, h * .76, z], [x, .02, z + h * .37]], foliage[2])
      if (seed % 5 === 0) {
        polygon([[x + h * .24, h * .81, z], [x + h * .43, h * 1.03, z + .05],
          [x + h * .56, h * .87, z + .13]], night === 3 ? '#E6A2B0' : '#D7CC80')
      }
    }
  }
}

function island(inView) {
  const { map } = game
  for (const [cx, cz, radius] of map.islands) groundDisk(cx, cz, 0, radius, '#2F5D50')
  if (map.bridge) {
    const [left, right, near, far] = map.bridge
    for (let x = left; x < right; x++) {
      const end = Math.min(x + .96, right)
      floorPolygon([[x, 0, near], [end, 0, near], [end, 0, far], [x, 0, far]], '#6B4A2F')
    }
    for (const z of [near, far]) {
      for (let x = left + 1; x < right; x += 3) {
        frustum(x, -.2, z, .105, .08, 1.05, ['#865B44', '#A1704C'], 4, false, true)
        const end = Math.min(x + 3, right)
        polygon([[x, .71, z], [end, .71, z], [end, .77, z], [x, .77, z]], '#A28B64')
      }
    }
  }
  if (map.tier) groundDisk(0, 0, map.tier.y, map.tier.outer, '#2F5D50', 0, Math.PI, map.tier.inner)
  if (map.disk) groundDisk(0, 0, map.disk.y, map.disk.radius, '#C9B48A')
  for (const ramp of game.ramps) {
    const point = (r, edge, y) => [r * ramp.axis[0] + edge * ramp.edge[0], y,
      r * ramp.axis[1] + edge * ramp.edge[1]]
    const segments = Math.ceil((ramp.outer - ramp.inner) / .75)
    const edgeAt = (segment, side) => {
      const t = segment / segments
      return point(ramp.inner + (ramp.outer - ramp.inner) * t, side * ramp.half, ramp.y * (1 - t))
    }
    for (let i = 0; i < segments; i++) {
      floorPolygon([edgeAt(i, -1), edgeAt(i, 1), edgeAt(i + 1, 1), edgeAt(i + 1, -1)], '#C9B48A')
    }
  }
  for (const pad of map.pads ?? []) {
    const [x, y, z] = pad.pos
    polygon(ring(x, y + 0.02, z, pad.radius, 16), '#F2C14E', true)
  }
  if (map.tower) {
    const y = map.disk.y, r = map.tower.radius, h = map.tower.height
    frustum(0, y, 0, r, r, .55, ['#40595D', '#53696B'], 8)
    frustum(0, y + .55, 0, r * .89, r * .84, h * .63, ['#6B4A2F', '#705038'], 8)
    frustum(0, y + h * .7, 0, r * .98, r * 1.2, .28, ['#C9B48A', '#BDA880'], 8)
    frustum(0, y + h * .74, 0, r * 1.2, .12, h * .26, ['#263D51', '#304B60'], 8)
    for (let side = 0; side < 8; side++) {
      const angle = side * tau / 8 + tau / 16
      const windowX = Math.cos(angle) * r * .84
      const windowZ = Math.sin(angle) * r * .84
      frustum(windowX, y + h * .53, windowZ, .105, .075, h * .12, ['#DEA45E'], 4, true)
    }
    orb(0, y + h, 0, .19, ['#F2C14E', '#FFE9B0'])
  }
  drawScenery(inView)
}

function lightSprite(pos, radius, rgb, intensity, additive = true) {
  const point = project(pos)
  if (!point) return
  const [x, y, depth] = point
  const r = Math.min(220, radius * viewportHeight / depth)
  if (x < -r || y < -r || x > viewportWidth + r || y > viewportHeight + r) return
  if (r < .45) return
  faces.push({ depth, light: { x, y, r, rgb, intensity, additive } })
}

function lightTexture(rgb) {
  if (lightTextures.has(rgb)) return lightTextures.get(rgb)
  const image = document.createElement('canvas')
  image.width = image.height = 64
  const ink = image.getContext('2d')
  const halo = ink.createRadialGradient(32, 32, 0, 32, 32, 32)
  halo.addColorStop(0, 'rgba(' + rgb + ',1)')
  halo.addColorStop(.3, 'rgba(' + rgb + ',.35)')
  halo.addColorStop(1, 'rgba(' + rgb + ',0)')
  ink.fillStyle = halo
  ink.fillRect(0, 0, 64, 64)
  lightTextures.set(rgb, image)
  return image
}

function addBurst(name, data) {
  const effect = effects[name]
  if (!effect || lessMotion()) return
  const lamp = name === 'lantern_lit' && game.lanterns.find(item => item.id === data.lantern_id)
  const [x, y, z] = lamp ? lamp.pos : game.player.pos
  bursts.push({ ...effect, x, y: y + (lamp ? 2.5 : .75), z, tick: game.sim, seed: game.sim + bursts.length * 73 })
  if (bursts.length > 20) bursts.shift()
}

function drawBursts() {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const burst = bursts[i]
    const age = (game.sim - burst.tick) / burst.life
    if (age >= 1) {
      bursts.splice(i, 1)
      continue
    }
    for (let p = 0; p < burst.count; p++) {
      const seed = burst.seed + p * 13
      const angle = noise(seed) * tau
      const distance = age * (1 + 2 * noise(seed + 1))
      const lift = age * (2 + noise(seed + 2)) - 1.65 * age * age
      lightSprite([burst.x + Math.cos(angle) * distance, burst.y + lift,
        burst.z + Math.sin(angle) * distance], .048 + .047 * noise(seed + 3), burst.rgb, .9 * (1 - age))
    }
  }
}

function drawLanternStatus({ x, y, size, lantern, flicker }) {
  const { lit, deposited, fuelUnits } = lantern
  const cost = lanternCost(tuning, lantern)
  const fuel = Math.floor(fuelUnits / HZ)
  const low = lit && !isSafe(tuning, lantern)
  const text = lit ? `Dầu ${fuel}/${tuning.fuel_max}${low && preferences.accessiblePalette ? ' ⚠' : ''}` :
    `${lantern.ever_lit ? 'Thắp lại ' : ''}${deposited}/${cost}`
  ctx.font = `700 ${size}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const width = Math.max(size * 3, ctx.measureText(text).width + 16)
  const left = x - width / 2
  const height = size + 15
  ctx.beginPath()
  ctx.roundRect(left, y - height, width, height, 6)
  ctx.fillStyle = lit ? '#35230D' : '#10182A'
  ctx.fill()
  const warning = preferences.accessiblePalette ? '#FFFFFF' : '#FF5A5F'
  ctx.strokeStyle = low ? warning : lit ? '#FFD071' : '#8095AE'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = lit ? '#FFE19A' : '#F2F5FC'
  ctx.fillText(text, x, y - height + size / 2 + 4)
  const barWidth = width - 16
  ctx.fillStyle = '#526079'
  ctx.fillRect(left + 8, y - 7, barWidth, 3)
  ctx.fillStyle = low ? warning : '#FFC557'
  ctx.globalAlpha = flicker
  ctx.fillRect(left + 8, y - 7, barWidth * (lit ? fuelUnits / (tuning.fuel_max * HZ) : deposited / cost), 3)
  ctx.globalAlpha = 1
}

function paint() {
  faces.sort((a, b) => b.depth - a.depth)
  for (const { points, color, line, width, light, status, eye } of faces) {
    if (status) {
      drawLanternStatus(status)
      continue
    }
    if (light) {
      const { x, y, r, rgb, intensity, additive } = light
      if (additive) ctx.globalCompositeOperation = 'screen'
      ctx.globalAlpha = intensity
      ctx.drawImage(lightTexture(rgb), x - r, y - r, r * 2, r * 2)
      ctx.globalAlpha = 1
      if (additive) ctx.globalCompositeOperation = 'source-over'
      continue
    }
    if (eye) {
      ctx.fillStyle = eye.color
      ctx.fillRect(eye.x - eye.size / 2, eye.y - eye.size / 2, eye.size, eye.size)
      continue
    }
    ctx.beginPath()
    ctx.moveTo(points[0][0], points[0][1])
    for (const [x, y] of points.slice(1)) ctx.lineTo(x, y)
    ctx.closePath()
    if (line) {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.stroke()
    } else {
      ctx.fillStyle = color
      ctx.fill()
    }
  }
  faces = []
}

function draw(orbitElapsed) {
  const width = viewportWidth = canvas.clientWidth
  const height = viewportHeight = canvas.clientHeight
  const scale = Math.min(window.devicePixelRatio || 1, 2)
  if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  if (!width || !height) return
  if (!backdrop || backdrop.night !== night || backdrop.image.width !== width || backdrop.image.height !== height) {
    backdrop = { night, image: makeBackdrop(width, height) }
  }
  ctx.drawImage(backdrop.image, 0, 0)
  const player = game.player.pos
  const menuOrbit = screen === 'menu' && !lessMotion() ? performance.now() * .008 : 0
  const angle = (yaw + menuOrbit) * Math.PI / 180
  const sin = Math.sin(angle), cos = Math.cos(angle)
  const pitch = .35
  const up = Math.cos(pitch), down = Math.sin(pitch)
  const focal = height * .99
  cameraWorld = [player[0] - sin * 7.8, player[1] + 4.8, player[2] - cos * 7.8]
  cameraPoint = ([x, y, z]) => {
    const dx = x - player[0], dz = z - player[2]
    const forward = dx * sin + dz * cos + 7.8
    const vertical = y - player[1] - 4.8
    return [dx * cos - dz * sin, forward * down + vertical * up, forward * up - vertical * down]
  }
  if (orbitElapsed !== undefined) {
    const b = contract.benchmark
    const angle = tau * orbitElapsed / (b.orbit_seconds * 1000)
    const cx = Math.cos(angle), cz = Math.sin(angle)
    cameraWorld = [cx * b.orbit_radius, b.orbit_height, cz * b.orbit_radius]
    const distance = Math.hypot(b.orbit_radius, b.orbit_height)
    cameraPoint = ([x, y, z]) => {
      const radial = x * cx + z * cz
      return [-x * cz + z * cx, (y * b.orbit_radius - radial * b.orbit_height) / distance,
        distance - (radial * b.orbit_radius + y * b.orbit_height) / distance]
    }
  }
  const eyeSin = orbitElapsed === undefined ? sin : -Math.cos(tau * orbitElapsed / (contract.benchmark.orbit_seconds * 1000))
  const eyeCos = orbitElapsed === undefined ? cos : -Math.sin(tau * orbitElapsed / (contract.benchmark.orbit_seconds * 1000))
  screenPoint = ([x, y, depth]) => [width / 2 + x * focal / depth, height * .43 - y * focal / depth, depth]
  project = point => {
    const p = cameraPoint(point)
    return p[2] >= .45 ? screenPoint(p) : null
  }
  const inView = (x, y, z, radius) => {
    const p = cameraPoint([x, y, z])
    if (p[2] < .45 - radius) return false
    const limit = Math.max(.45, p[2] + radius) / focal
    return Math.abs(p[0]) < width * .5 * limit + radius && Math.abs(p[1]) < height * .58 * limit + radius
  }
  const [x, y, z] = player
  groundDepth = cameraPoint([x, y, z])[2] + .7
  const lx = x + cos * .54, lz = z - sin * .54
  mist = nightSkies[night - 1][3]
  lightSources = [{ x: lx, y: y + .55, z: lz, rangeSquared: 8, power: .47 }]
  for (const lamp of game.lanterns) {
    if (!lamp.lit) continue
    const [x, y, z] = lamp.pos
    lightSources.push({ x, y: y + .75, z, rangeSquared: 36,
      power: benchmarking || lessMotion() ? .9 : .9 + Math.sin(game.sim * .14 + x) * .08 })
  }
  island(inView)
  const ambient = tuning.ambient_base + tuning.ambient_progress *
    game.lanterns.filter(lamp => lamp.lit).length / game.lanterns.length
  const glow = ctx.createRadialGradient(width / 2, height * .64, 0, width / 2, height * .64, Math.max(width, height))
  glow.addColorStop(0, 'rgba(255,179,71,' + (ambient * .1) + ')')
  glow.addColorStop(1, 'rgba(255,179,71,0)')
  for (const { pos: [x, y, z] } of game.motes) {
    if (!inView(x, y + .65, z, 1)) continue
    const hover = y + .65 + Math.sin(game.sim / 19 + x) * .19
    lightSprite([x, hover, z], .68, '255,229,138', .56)
    orb(x, hover, z, .13, ['#FFF6C2', '#FFE58A'], true, true)
    const spark = game.sim / 26 + x
    if (!benchmarking) orb(x + Math.cos(spark) * .31, hover + .1, z + Math.sin(spark) * .31, .035, ['#FFE58A'])
  }
  for (const { pos: [x, y, z], state } of game.drifters) {
    if (state !== 'removed') frustum(x, y, z, .38, .08, .85, ['#8FA3B8'], 5)
  }
  for (const { pos: [x, y, z], available } of game.charms) {
    if (available) {
      const leaf = [[x, y + .35, z], [x + .24, y + .7, z], [x, y + 1.05, z], [x - .24, y + .7, z]]
      polygon(leaf, '#C8102E')
      polygon(leaf, '#F2C14E', true)
    }
  }
  for (const lantern of game.lanterns) {
    const [x, y, z] = lantern.pos
    const gold = '#F2C14E'
    const wood = ['#6B4A2F', '#735035']
    frustum(x, y, z, .78, .7, .18, ['#44585E', '#53666B'], 6)
    frustum(x, y + .18, z, .58, .4, .29, ['#4F656A', '#586C70'], 6)
    frustum(x, y + .47, z, .18, .13, 1.64, wood, 6)
    frustum(x, y + 1.98, z, .32, .58, .18, wood, 8)
    const panel = lantern.lit ? ['#FFB347', '#FFE9B0', '#FFD07B'] :
      lantern.deposited > 0 ? ['#AE7537', '#D09648'] : ['#5B5F6E', '#626777']
    const paperHeight = lantern.lit ? .62 : .62 * .8
    const roof = y + 2.16 + paperHeight
    const low = lantern.lit && !isSafe(tuning, lantern)
    const flicker = low && !lessMotion() && game.sim % HZ >= HZ / 2 ? .4 : 1
    frustum(x, y + 2.16, z, .48, .56, paperHeight,
      flicker < 1 ? ['#A45C30', '#BD883D'] : panel, 8, lantern.lit)
    if (!lantern.lit) {
      const seam = [[x - cos * .12 - sin * .54, roof - .03, z + sin * .12 - cos * .54],
        [x - sin * .54, roof - paperHeight * .36, z - cos * .54],
        [x - cos * .08 - sin * .54, roof - paperHeight * .53, z + sin * .08 - cos * .54],
        [x + cos * .14 - sin * .54, y + 2.2, z - sin * .14 - cos * .54]]
      polygon(seam, '#151323')
    }
    frustum(x, roof, z, .69, .62, .09, [gold], 8)
    frustum(x, roof + .09, z, .76, .12, .46, ['#263C50', '#304A61'], 8)
    orb(x, roof + .58, z, .13, [gold])
    for (let side = 0; side < 4; side++) {
      const angle = side * tau / 4
      frustum(x + Math.cos(angle) * .52, y + 2.18, z + Math.sin(angle) * .52, .035, .035, paperHeight - .02, wood, 4)
    }
    if (lantern.lit) {
      lightSprite([x, y + 2.45, z], 2.65, '255,179,71', .57 * flicker)
      lightSprite([x, y + .08, z], 3.65, '255,179,71', .2 * flicker)
      if (!low) polygon(ring(x, y + .035, z, tuning.safe_radius, 48), '#FFC17285', true, 1.3)
    } else {
      lightSprite([x, y + 2.55, z], .9, '185,208,255', .17)
    }
    const marker = project([x, y + 3.58, z])
    if (marker && marker[0] >= 0 && marker[0] <= width && marker[1] >= 0 && marker[1] <= height) {
      const [x, y, depth] = marker
      const size = (preferences.largeText ? 1.25 : 1) * Math.max(18, Math.min(23, 15 + 68 / depth))
      faces.push({ depth, status: { x, y, size, lantern, flicker } })
    }
  }
  for (const shade of game.shades) {
    const [x, y, z] = shade.pos
    const height = y + .58 + Math.sin(game.sim / 13 + x) * .13
    if (!inView(x, height, z, 1.65)) continue
    const accent = preferences.accessiblePalette ? '#00B3FF' : '#7A3CFF'
    lightSprite([x, height, z], 1.28, preferences.accessiblePalette ? '0,179,255' : '122,60,255', .22, false)
    frustum(x, height - .55, z, .15, .54, .53, ['#120A1A', '#372459'], 7, false, true)
    orb(x, height, z, .73, ['#120A1A', accent], true, true)
    for (const side of [-1, 1]) {
      const point = project([x - eyeSin * .73 + eyeCos * side * .23, height + .1,
        z - eyeCos * .73 - eyeSin * side * .23])
      if (point) faces.push({ depth: point[2], eye: { x: point[0], y: point[1],
        size: Math.max(1, Math.min(18, .16 * focal / point[2])), color: accent } })
    }
    if (shade.state === 'stunned') polygon(ring(x, height + .76, z, .45, 12), '#D4DBF2', true)
    if (shade.state === 'drain') lightSprite([x, height + .4, z], .43, '255,179,71', .45)
  }
  const stride = player[1] >= 0 && game.player.grounded ? Math.sin(game.sim * .2) *
    Math.min(1, Math.hypot(game.player.vel[0], game.player.vel[2]) / tuning.player_speed) : 0
  if (game.player.grounded) {
    const shadowStart = faces.length
    polygon(ring(x, y + .012, z, .64, 18), '#111D2880')
    if (faces.length > shadowStart) faces[shadowStart].depth = groundDepth
  }
  for (const side of [-1, 1]) {
    const dx = cos * side * .14 + sin * stride * side * .19
    const dz = -sin * side * .14 + cos * stride * side * .19
    frustum(x + dx, y + .02, z + dz, .105, .095, .33, ['#253449', '#354760'], 6)
    orb(x + cos * side * .33, y + .65, z - sin * side * .33, .12, ['#E3AA88'])
  }
  frustum(x, y + .31, z, .4, .24, .59, ['#E8E2D0', '#DDD8C7'], 8)
  frustum(x, y + .85, z, .27, .27, .105, ['#C8102E', '#D41737'], 8)
  orb(x, y + 1.08, z, .245, ['#E8B495', '#C88E72'])
  frustum(x, y + 1.23, z, .62, .48, .095, ['#AF8753', '#C09B66'], 12)
  frustum(x, y + 1.325, z, .48, .035, .36, ['#E5C58A', '#D2AD73'], 12)
  frustum(lx, y + .73, lz, .07, .16, .12, ['#F2C14E'], 6)
  frustum(lx, y + .85, lz, .15, .13, .24, ['#FFB347', '#FFE9B0'], 6, true)
  frustum(lx, y + 1.09, lz, .15, .035, .1, ['#A37A46'], 6)
  lightSprite([lx, y + .97, lz], 1.23, '255,179,71', .45)
  if (game.sim - pulseTick < 24) {
    const progress = (game.sim - pulseTick + 1) / 24
    const radius = tuning.pulse_radius * progress
    const alpha = Math.round(255 * (1 - progress)).toString(16).padStart(2, '0')
    polygon(ring(x, y + .13, z, radius, 40), '#ffe999' + alpha, true, 3 - progress * 2)
    if (!lessMotion()) {
      polygon(ring(x, y + .35, z, radius * .86, 32), '#ffb347' + alpha, true, 1)
    }
  }
  drawBursts()
  paint()
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)
  if (!lessMotion() && (windWarning > game.sim || game.wind.active)) {
    ctx.strokeStyle = '#FFDF9E68'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let i = 0; i < 24; i++) {
      const px = (i * 97 + game.sim * 6) % width, py = (i * 59 + game.sim) % height
      ctx.moveTo(px, py)
      ctx.quadraticCurveTo(px - 13, py - 3, px - 19 - noise(i) * 24, py - 10)
    }
    ctx.stroke()
  }
  const target = nearestLantern(game)
  const arrow = byId('direction')
  const point = target && project([target.pos[0], target.pos[1] + 2, target.pos[2]])
  arrow.hidden = !active || !target || Boolean(point && point[0] >= 0 && point[0] <= width && point[1] >= 0 && point[1] <= height)
  if (!arrow.hidden) {
    const dx = target.pos[0] - player[0], dz = target.pos[2] - player[2]
    arrow.style.rotate = Math.atan2(dx * cos - dz * sin, dx * sin + dz * cos) + 'rad'
    arrow.setAttribute('aria-label', 'Hướng tới ' + target.id)
  }
  const shadeMarker = byId('shade-direction')
  shadeMarker.hidden = !active || !shadeNotice || shadeNotice.until <= game.sim
  if (!shadeMarker.hidden) {
    const [dx, , dz] = shadeNotice.pos.map((value, index) => value - player[index])
    const theta = Math.atan2(dx * cos - dz * sin, dx * sin + dz * cos)
    const right = Math.sin(theta), top = -Math.cos(theta)
    const edge = Math.max(Math.abs(right), Math.abs(top)) || 1
    shadeMarker.style.left = 50 + 43 * right / edge + '%'
    shadeMarker.style.top = 50 + 33 * top / edge + '%'
    shadeMarker.style.rotate = theta + 'rad'
  }
}

function updateHud() {
  const player = game.player
  const capacity = carryCapacity(tuning, player.successfulLights)
  const lit = game.lanterns.filter(lantern => lantern.lit).length
  const seconds = Math.ceil(game.time)
  byId('flames').textContent = player.flames
  byId('light').textContent = player.carried + '/' + capacity
  byId('mote-meter').style.setProperty('--fill', 100 * player.carried / capacity + '%')
  byId('mote-meter').style.setProperty('--segment', 100 / capacity + '%')
  byId('light').setAttribute('aria-label', player.carried + ' trên ' + capacity + ' đom đóm')
  byId('lanterns').textContent = lit + '/' + game.lanterns.length
  byId('clock').textContent = (preferences.accessiblePalette && seconds <= 30 ? '⚠ ' : '') +
    Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
  byId('clock').classList.toggle('danger', seconds <= 30)
  byId('score').textContent = game.score
  const cooldown = value => value > game.sim ? ((value - game.sim) / HZ).toFixed(1) + 's' : 'Sẵn sàng'
  byId('dash-cd').textContent = cooldown(player.dashCd)
  byId('pulse-cd').textContent = cooldown(player.pulseCd)
  const target = nearestLantern(game, true)
  const near = target && Math.hypot(target.pos[0] - player.pos[0], target.pos[2] - player.pos[2]) <= tuning.interact_radius
  const interactKey = keyName(binding('interact')[0])
  byId('hint').textContent = active && near ? interactKey + (target.lit ? ' — Châm dầu' :
    ' — Nạp đom đóm (' + target.deposited + '/' + lanternCost(tuning, target) + ')') : ''
  if (active && seconds !== countdownNotice && seconds <= 10 && seconds > 0) {
    sound(tones.countdown)
    countdownNotice = seconds
  }
  const messages = []
  if (shadeNotice?.until > game.sim) messages.push('Bóng Mực xuất hiện')
  if (windWarning > game.sim) messages.push('Gió sắp thổi')
  if (countdownNotice && seconds > 0) messages.push('Còn ' + countdownNotice + ' giây')
  if (game.lanterns.some(lamp => lamp.lit && !isSafe(tuning, lamp))) messages.push('Đèn sắp cạn dầu')
  const captions = byId('captions')
  captions.hidden = !active || messages.length === 0
  const caption = messages.join(' · ')
  if (captions.textContent !== caption) captions.textContent = caption
}

let last = performance.now(), budget = 0
function frame(now) {
  budget += Math.min(100, now - last) * HZ / 1000
  last = now
  while (budget >= 1) {
    budget--
    if (!active) continue
    yaw = (yaw + 2.1 * (Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft')))) % 360
    const events = step(game, input(), true)
    pauseEdge = false
    for (const { name, data } of events) {
      sound(tones[name])
      addBurst(name, data)
      if (name === 'pulse') pulseTick = game.sim
      if (name === 'wind_warning') windWarning = game.sim + tuning.wind_warning * HZ
      if (name === 'shade_spawned') {
        const shade = game.shades.find(shade => shade.id === data.id)
        if (shade) shadeNotice = { pos: shade.pos, until: game.sim + 3 * HZ }
      }
      if (name === 'paused') { keys.clear(); show('pause') }
      if (name === 'game_over') {
        if (data.result === 'won') {
          total += game.score
          nightsWon++
        }
        sound(tones[data.result])
        show(data.result === 'won' ? (night === 3 ? 'dawn' : 'win') : 'loss', data.reason)
      }
    }
    if (active && game.sim >= nextNote) {
      const melody = [147, 196, 220, 262, 220, 196, 175, 196]
      sound([melody[Math.floor(nextNote / 48) % melody.length]], .045, .85)
      nextNote = game.sim + 48
    }
  }
  draw()
  updateHud()
  requestAnimationFrame(frame)
}
function startBenchmark() {
  const b = contract.benchmark
  const seed = Number(params.get('bench'))
  const random = seededRandom(seed)
  const radius = contract.maps[0].islands[0][2]
  const point = () => {
    const angle = random() * tau
    const r = Math.sqrt(random()) * radius
    return [r * Math.cos(angle), 0, r * Math.sin(angle)]
  }
  game = createGame(contract, seed, {
    shades: Array.from({ length: b.shades }, () => ({ pos: point(), state: 'wander' })),
    motes: Array.from({ length: b.motes }, point),
    lanterns: Array.from({ length: b.lit_lanterns }, (_, index) => ({ id: 'L' + (index + 1), lit: true }))
  })
  overlay.hidden = true
  updateHud()
  const duration = Number(params.get('duration')) * 1000
  const warmup = b.warmup_s * 1000, times = []
  let first, previous
  function benchFrame(timestamp) {
    first ??= timestamp
    const elapsed = timestamp - first
    if (elapsed >= warmup + duration) {
      window.benchComplete(times)
      return
    }
    while (game.sim < Math.floor(elapsed * HZ / 1000)) stepBenchmark(game)
    draw(elapsed)
    if (previous === undefined) window.benchFirstFrame()
    else if (previous - first >= warmup) times.push(timestamp - previous)
    previous = timestamp
    requestAnimationFrame(benchFrame)
  }
  requestAnimationFrame(benchFrame)
}
if (benchmarking) startBenchmark()
else requestAnimationFrame(frame)

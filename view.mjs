import { carryCapacity, createGame, dawnTarget, HZ, isSafe, lanternCost, nearestLantern, step } from './game.mjs'

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
let preferences = { volume: 0.4, sensitivity: 0.5, accessiblePalette: false }
try { Object.assign(preferences, JSON.parse(localStorage.getItem('lantern-settings') ?? '{}')) } catch {}
document.body.classList.toggle('accessible-palette', preferences.accessiblePalette)
let audio, nextNote = 0, lastSecond = -1, windWarning = 0
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
const controls = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'Escape', 'KeyP'])
let game, active = false, yaw = 0, pulseTick = -100
let faces = [], project, cameraPoint, screenPoint
let backdrop, scenery, sceneryMap
const tau = Math.PI * 2
const materials = new Map()
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
const bursts = []
let lightSources = [], mist
let groundDepth

const effects = {
  mote_picked: { rgb: '255,226,124', count: 9, life: 28 },
  lantern_lit: { rgb: '255,184,79', count: 24, life: 58 },
  pulse: { rgb: '255,236,159', count: 20, life: 32 },
  dash: { rgb: '145,219,255', count: 12, life: 24 },
  player_hit: { rgb: '212,134,255', count: 12, life: 28 }
}

function input() {
  return {
    move: [Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
      Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'))],
    cam_yaw_deg: yaw, interact: keys.has('KeyE'), pulse: keys.has('KeyQ'), jump: keys.has('Space'),
    dash: keys.has('ShiftLeft') || keys.has('ShiftRight'), pause: pauseEdge
  }
}

function reset() {
  game = createGame(contract, 1528 + night - 1, {}, night)
  yaw = 0
  pulseTick = -100
  bursts.length = 0
  lastSecond = -1
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
  const content = {
    menu: ['Đảo Đèn Lồng', 'Cùng Mây thắp sáng ba hòn đảo.', 'Bắt đầu'],
    intro: ['Đêm ' + night + ' · ' + names[night - 1],
      'Ông Đăng: “Giữ ít nhất ' + dawnTarget(game) + ' đèn sáng tới bình minh. ' + advice[night - 1] + '”', 'Vào đảo'],
    pause: ['Tạm dừng', names[night - 1], 'Tiếp tục'],
    win: ['Đảo đã sáng!', 'Điểm đêm: ' + game.score + ' · Tổng điểm: ' + total, 'Đêm kế tiếp'],
    loss: ['Đêm đã khép lại', reason === 'dawn' ? 'Bình minh đến khi đảo chưa đủ đèn sáng.' : 'Mây đã hết Ngọn Lửa.', 'Chơi lại'],
    dawn: ['Bình Minh', 'Cả ba đảo đã sáng. Tổng điểm: ' + total, 'Về menu'],
    settings: ['Cài đặt', '', 'Quay lại']
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
  show('settings')
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
byId('accessible-palette').addEventListener('change', event => {
  preferences.accessiblePalette = event.target.checked
  document.body.classList.toggle('accessible-palette', preferences.accessiblePalette)
  savePreferences()
})
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
    case 'settings': show(settingsBack); break
  }
}
mainMenu()

window.addEventListener('keydown', event => {
  if (!['play', 'pause'].includes(screen) || !controls.has(event.code)) return
  event.preventDefault()
  if (event.code === 'Escape' || event.code === 'KeyP') {
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

function surfaceColor(vertices, color, depth) {
  if (!materials.has(color)) {
    const hex = Number.parseInt(color.slice(1), 16)
    materials.set(color, [hex >> 16, (hex >> 8) & 255, hex & 255])
  }
  const [a, b, c] = vertices
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
  const normal = Math.hypot(nx, ny, nz) || 1
  const shade = .73 + (.26 * Math.abs(ny) + .16 * (nx * .6 + nz * .8)) / normal
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
  const channel = (base, moon, amber, haze) =>
    Math.round(Math.min(255, base * shade + moon + amber * warm) * (1 - fog) + haze * fog)
  return `rgb(${channel(r, 1, 116, mist[0])},${channel(g, 5, 73, mist[1])},${channel(blue, 12, 24, mist[2])})`
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
  if (visible.every(p => p[0] < 0) || visible.every(p => p[0] > canvas.clientWidth) ||
      visible.every(p => p[1] < 0) || visible.every(p => p[1] > canvas.clientHeight)) return
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
  return Array.from({ length: n }, (_, i) => [x + Math.cos(i * tau / n) * r, y, z + Math.sin(i * tau / n) * r])
}

function frustum(x, y, z, lower, upper, height, colors, sides = 8, emissive = false) {
  const a = ring(x, y, z, lower, sides)
  const b = ring(x, y + height, z, upper, sides)
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides
    polygon([a[i], a[next], b[next], b[i]], colors[i % colors.length], false, 2, emissive)
  }
  if (upper > 0) polygon(b, colors[0], false, 2, emissive)
}

function orb(x, y, z, r, colors, emissive = false) {
  frustum(x, y - r, z, 0, r, r, colors, 5, emissive)
  frustum(x, y, z, r, 0, r, colors, 5, emissive)
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
  for (let layer = 0; layer < 3; layer++) {
    g.beginPath()
    g.moveTo(0, height)
    for (let x = 0; x < width + 12; x += 12) {
      const u = x / width
      const wave = Math.sin(u * 15 + layer * 2) * .035 + Math.sin(u * 39 + layer) * .013
      g.lineTo(x, height * (.45 + layer * .081 + wave))
    }
    g.lineTo(width, height)
    g.fillStyle = ['#28385B', '#24364D', valley][layer]
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

function groundDisk(cx, cz, y, radius, color, start = 0, arc = tau, inner = 0) {
  const segments = 48, bands = 7
  const point = (r, a) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]
  const greens = ['#2F5D50', '#325F52', '#305A4D', '#2D5C52', '#315F4F']
  const sands = ['#C9B48A', '#CDB88F', '#C4AF85']
  for (let i = 0; i < segments; i++) {
    const left = start + i * arc / segments, right = start + (i + 1) * arc / segments
    for (let strip = 0; strip < bands; strip++) {
      const near = inner + (radius - inner) * strip / bands
      const far = near + (radius - inner) / bands
      const corners = [point(near, left), point(far, left), point(far, right), point(near, right)]
      const palette = color === '#C9B48A' ? sands : greens
      floorPolygon(corners, palette[Math.floor(noise(i * bands + strip) * palette.length)])
    }
    const a = point(radius, left), b = point(radius, right)
    const drop = y ? 3 : 6 + noise(i + 7) * 4
    const inset = radius - (y ? 0 : 2 + noise(i + 12) * 4)
    const lower = [point(inset, left), point(inset, right)]
    lower.forEach(p => { p[1] -= drop })
    polygon([a, b, lower[1]], i % 3 ? '#334D50' : '#405C5D')
    polygon([a, lower[1], lower[0]], i % 2 ? '#293D46' : '#354850')
  }
}

function island() {
  const { map } = game
  for (const [cx, cz, radius] of map.islands) groundDisk(cx, cz, 0, radius, '#2F5D50')
  if (map.bridge) {
    const [left, right, near, far] = map.bridge
    for (let x = left; x < right; x++) {
      const end = Math.min(x + .96, right)
      floorPolygon([[x, 0, near], [end, 0, near], [end, 0, far], [x, 0, far]], '#6B4A2F')
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
  if (sceneryMap !== map) {
    sceneryMap = map
    scenery = map.islands.flatMap(([cx, cz, radius], islandIndex) =>
      Array.from({ length: 44 }, (_, i) => {
        const seed = i + islandIndex * 51
        const angle = noise(seed) * tau, range = radius * (.74 + noise(seed + 400) * .24)
        return [cx + Math.cos(angle) * range, cz + Math.sin(angle) * range, seed]
      })).filter(([x, z]) => !(map.bridge && Math.abs(z) < 4 && x > 23 && x < 47))
  }
  for (const [x, z, seed] of scenery) {
    const size = .2 + noise(seed + 15) * .54
    const color = seed % 3 ? '#496E60' : '#789385'
    if (seed % 11 === 0) {
      frustum(x, 0, z, size, size * .66, size * .9, ['#415858', '#526765'], 5)
      continue
    }
    polygon([[x - size * .45, .025, z], [x + size * .2, size, z + size * .35],
      [x + size * .25, .025, z]], color)
    polygon([[x, .03, z - size * .36], [x - size * .4, size * .72, z],
      [x, .03, z + size * .27]], '#547B68')
  }
}

function lightSprite(pos, radius, rgb, intensity, additive = true) {
  const point = project(pos)
  if (!point) return
  const [x, y, depth] = point
  const r = Math.min(220, radius * canvas.clientHeight / depth)
  if (x < -r || y < -r || x > canvas.clientWidth + r || y > canvas.clientHeight + r) return
  if (r < .45) return
  faces.push({ depth, light: { x, y, r, rgb, intensity, additive } })
}

function addBurst(name, data) {
  const effect = effects[name]
  if (!effect || reducedMotion?.matches) return
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
  for (const { points, color, line, width, light, status } of faces) {
    if (status) {
      drawLanternStatus(status)
      continue
    }
    if (light) {
      const { x, y, r, rgb, intensity, additive } = light
      const halo = ctx.createRadialGradient(x, y, 0, x, y, r)
      halo.addColorStop(0, 'rgba(' + rgb + ',' + intensity + ')')
      halo.addColorStop(.3, 'rgba(' + rgb + ',' + intensity * .35 + ')')
      halo.addColorStop(1, 'rgba(' + rgb + ',0)')
      if (additive) ctx.globalCompositeOperation = 'screen'
      ctx.fillStyle = halo
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
      if (additive) ctx.globalCompositeOperation = 'source-over'
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

function draw() {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
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
  const menuOrbit = screen === 'menu' && !reducedMotion?.matches ? performance.now() * .008 : 0
  const angle = (yaw + menuOrbit) * Math.PI / 180
  const sin = Math.sin(angle), cos = Math.cos(angle)
  const pitch = .35
  const up = Math.cos(pitch), down = Math.sin(pitch)
  const focal = height * .99
  cameraPoint = ([x, y, z]) => {
    const dx = x - player[0], dz = z - player[2]
    const forward = dx * sin + dz * cos + 7.8
    const vertical = y - player[1] - 4.8
    return [dx * cos - dz * sin, forward * down + vertical * up, forward * up - vertical * down]
  }
  screenPoint = ([x, y, depth]) => [width / 2 + x * focal / depth, height * .43 - y * focal / depth, depth]
  project = point => {
    const p = cameraPoint(point)
    return p[2] >= .45 ? screenPoint(p) : null
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
      power: reducedMotion?.matches ? .9 : .9 + Math.sin(game.sim * .14 + x) * .08 })
  }
  island()
  const ambient = tuning.ambient_base + tuning.ambient_progress *
    game.lanterns.filter(lamp => lamp.lit).length / game.lanterns.length
  const glow = ctx.createRadialGradient(width / 2, height * .64, 0, width / 2, height * .64, Math.max(width, height))
  glow.addColorStop(0, 'rgba(255,179,71,' + (ambient * .1) + ')')
  glow.addColorStop(1, 'rgba(255,179,71,0)')
  for (const { pos: [x, y, z] } of game.motes) {
    const hover = y + .65 + Math.sin(game.sim / 19 + x) * .19
    lightSprite([x, hover, z], .68, '255,229,138', .56)
    orb(x, hover, z, .13, ['#FFF6C2', '#FFE58A'], true)
    const spark = game.sim / 26 + x
    orb(x + Math.cos(spark) * .31, hover + .1, z + Math.sin(spark) * .31, .035, ['#FFE58A'])
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
    const flicker = low && !reducedMotion?.matches && game.sim % HZ >= HZ / 2 ? .4 : 1
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
      const size = Math.max(12, Math.min(17, 12 + 68 / depth))
      faces.push({ depth, status: { x, y, size, lantern, flicker } })
    }
  }
  for (const shade of game.shades) {
    const [x, y, z] = shade.pos
    const height = y + .58 + Math.sin(game.sim / 13 + x) * .13
    const accent = preferences.accessiblePalette ? '#00B3FF' : '#7A3CFF'
    lightSprite([x, height, z], 1.28, preferences.accessiblePalette ? '0,179,255' : '122,60,255', .22, false)
    frustum(x, height - .55, z, .15, .54, .53, ['#120A1A', '#372459'], 7)
    orb(x, height, z, .73, ['#120A1A', accent], true)
    for (const side of [-1, 1]) {
      orb(x - sin * .55 + cos * side * .23, height + .1, z - cos * .55 - sin * side * .23,
        .09, [accent, '#F5F1E6'], true)
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
    if (!reducedMotion?.matches) {
      polygon(ring(x, y + .35, z, radius * .86, 32), '#ffb347' + alpha, true, 1)
    }
  }
  drawBursts()
  paint()
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)
  if (!reducedMotion?.matches && (windWarning > game.sim || game.wind.active)) {
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
  byId('hint').textContent = active && near ? (target.lit ? 'E — Châm dầu' :
    'E — Nạp đom đóm (' + target.deposited + '/' + lanternCost(tuning, target) + ')') : ''
  if (active && seconds !== lastSecond && seconds <= 10 && seconds > 0) sound(tones.countdown)
  lastSecond = seconds
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
      if (name === 'paused') { keys.clear(); show('pause') }
      if (name === 'game_over') {
        if (data.result === 'won') total += game.score
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
requestAnimationFrame(frame)

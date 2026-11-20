import { createGame, HZ, RADIUS, step } from './game.mjs'

const byId = id => document.getElementById(id)
const canvas = byId('world')
const ctx = canvas.getContext('2d')
const overlay = byId('overlay')
const start = byId('start')
const { tuning } = await fetch('./game.contract.json').then(response => response.json())
const keys = new Set()
const controls = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'Space'])
let game, active = false, yaw = 0, pulseTick = -100
let faces = [], project
const tau = Math.PI * 2

function input() {
  return {
    move: [Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
      Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'))],
    cam_yaw_deg: yaw, interact: keys.has('KeyE'), pulse: keys.has('KeyQ'), jump: keys.has('Space')
  }
}

function reset() {
  game = createGame(tuning, 1528)
  yaw = 0
  pulseTick = -100
}
reset()

start.addEventListener('click', () => {
  reset()
  keys.clear()
  active = true
  overlay.hidden = true
})
window.addEventListener('keydown', event => {
  if (active && controls.has(event.code)) {
    event.preventDefault()
    keys.add(event.code)
  }
})
window.addEventListener('keyup', event => keys.delete(event.code))
window.addEventListener('blur', () => keys.clear())

function polygon(vertices, color, line = false) {
  const points = vertices.map(project)
  if (points.some(point => !point)) return
  faces.push({ points, color, line, depth: points.reduce((sum, point) => sum + point[2], 0) / points.length })
}

function ring(x, y, z, r, n) {
  return Array.from({ length: n }, (_, i) => [x + Math.cos(i * tau / n) * r, y, z + Math.sin(i * tau / n) * r])
}

function frustum(x, y, z, lower, upper, height, colors, sides = 8) {
  const a = ring(x, y, z, lower, sides)
  const b = ring(x, y + height, z, upper, sides)
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides
    polygon([a[i], a[next], b[next], b[i]], colors[i % colors.length])
  }
  if (upper > 0) polygon(b, colors[0])
}

function orb(x, y, z, r, colors) {
  frustum(x, y - r, z, 0, r, r, colors, 5)
  frustum(x, y, z, r, 0, r, colors, 5)
}

function island() {
  polygon(ring(0, -0.025, 0, RADIUS, 64), '#25324c')
  const limit = RADIUS * RADIUS
  for (let x = -30; x <= 30; x += 3) {
    for (let z = -30; z <= 30; z += 3) {
      const vertices = [[x, 0, z], [x + 3, 0, z], [x + 3, 0, z + 3], [x, 0, z + 3]]
      if (vertices.some(([a, , b]) => a * a + b * b > limit)) continue
      const light = game.lanterns.reduce((sum, lantern) => {
        if (!lantern.lit) return sum
        return sum + Math.max(0, 1 - Math.hypot(x + 1.5 - lantern.pos[0], z + 1.5 - lantern.pos[2]) / 11)
      }, 0)
      const noise = 4 * Math.sin(x * 7 + z * 3)
      const color = 'rgb(' + [36 + 73 * light + noise, 56 + 33 * light + noise, 68 - 34 * light + noise].join(',') + ')'
      polygon(vertices, color)
    }
  }
  paint(false)
}

function paint(sort = true) {
  if (sort) faces.sort((a, b) => b.depth - a.depth)
  for (const { points, color, line } of faces) {
    ctx.beginPath()
    ctx.moveTo(points[0][0], points[0][1])
    for (const [x, y] of points.slice(1)) ctx.lineTo(x, y)
    ctx.closePath()
    if (line) {
      ctx.strokeStyle = color
      ctx.lineWidth = 2
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
  const sky = ctx.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, '#14102b')
  sky.addColorStop(.62, '#302245')
  sky.addColorStop(1, '#654563')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, height)
  for (let i = 0; i < 85; i++) {
    ctx.fillStyle = i % 5 ? '#f8d5c871' : '#ffedc3'
    ctx.fillRect((i * 167.77) % width, (i * 83.28) % (height * .55), i % 5 ? 1 : 2, 1)
  }
  ctx.beginPath()
  ctx.arc(width * .78, height * .24, Math.min(width, height) * .04, 0, tau)
  ctx.fillStyle = '#ffdbab'
  ctx.fill()

  const player = game.player.pos
  const angle = yaw * Math.PI / 180
  const sin = Math.sin(angle), cos = Math.cos(angle)
  const pitch = .55
  const up = Math.cos(pitch), down = Math.sin(pitch)
  const focal = height * .89
  project = ([x, y, z]) => {
    const dx = x - player[0], dz = z - player[2]
    const forward = dx * sin + dz * cos + 10
    const vertical = y - player[1] - 7.5
    const depth = forward * up - vertical * down
    if (depth <= .1) return null
    return [width / 2 + (dx * cos - dz * sin) * focal / depth,
      height * .47 - (forward * down + vertical * up) * focal / depth, depth]
  }
  if (active) {
    // The island boundary remains visible even when it crosses the near plane.
    const ground = ring(0, 0, 0, RADIUS, 64)
    for (let i = 0; i < ground.length; i++) {
      const next = ground[(i + 1) % ground.length]
      polygon([ground[i], next, [next[0], -3, next[2]], [ground[i][0], -3, ground[i][2]]], '#392c4b')
    }
    paint(false)
  }
  island()
  for (const [x, , z] of game.motes) {
    orb(x, .75 + Math.sin(game.tick / 18 + x) * .15, z, .19, ['#ffefae', '#ffca64'])
  }
  for (const lantern of game.lanterns) {
    const [x, y, z] = lantern.pos
    frustum(x, y, z, .72, .42, .35, ['#624369', '#4c3657'])
    frustum(x, y + .35, z, .12, .12, 2.4, ['#90665c', '#583c50'])
    frustum(x, y + 2.1, z, .45, .58, .68,
      lantern.lit ? ['#ffd382', '#ff9f49'] : ['#6f5375', '#4c375d'])
    frustum(x, y + 2.78, z, .77, .12, .43, ['#a76a61', '#784d59'])
    if (lantern.lit) polygon(ring(x, y + .035, z, tuning.safe_radius, 32), '#ffc17288', true)
  }
  for (const shade of game.shades) {
    const [x, y, z] = shade.pos
    const height = y + .9 + Math.sin(game.tick / 10 + x) * .12
    orb(x, height, z, .73, shade.state === 'stunned' ? ['#735ba3', '#49346d'] : ['#241234', '#3c2054'])
    for (const side of [-1, 1]) {
      orb(x - sin * .55 + cos * side * .23, height + .1, z - cos * .55 - sin * side * .23,
        .09, ['#e8a8ff', '#c69afa'])
    }
  }
  const [x, y, z] = player
  frustum(x, y, z, .36, .22, .9, ['#b75058', '#7f3a64'])
  orb(x, y + 1.02, z, .25, ['#ffc594', '#b5796e'])
  frustum(x, y + 1.19, z, .56, .02, .36, ['#ffe0a0', '#c89664'])
  orb(x + cos * .46, y + .94, z - sin * .46, .14, ['#fff4b5', '#e2a24d'])
  if (game.tick - pulseTick < 24) {
    polygon(ring(x, y + .13, z, tuning.pulse_radius * (game.tick - pulseTick + 1) / 24, 40), '#ffe999', true)
  }
  paint()
}

function updateHud() {
  const player = game.player
  const lit = game.lanterns.filter(lantern => lantern.lit).length
  const seconds = Math.ceil(game.time)
  byId('flames').textContent = player.flames
  byId('light').textContent = player.carried + '/' + tuning.carry_capacity
  byId('lanterns').textContent = lit + '/' + game.lanterns.length
  byId('clock').textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
  byId('score').textContent = game.score
  const target = game.lanterns.find(lantern => !lantern.lit &&
    Math.hypot(lantern.pos[0] - player.pos[0], lantern.pos[2] - player.pos[2]) <= tuning.interact_radius)
  byId('hint').textContent = active && target ? target.id + ' · ' + target.deposited + '/' +
    tuning.lantern_cost + (player.carried ? ' · Bấm E để nạp' : ' · Tìm thêm đom đóm') : ''
}

let last = performance.now(), budget = 0
function frame(now) {
  budget += Math.min(100, now - last) * HZ / 1000
  last = now
  while (budget >= 1) {
    budget--
    if (!active) continue
    yaw = (yaw + 2.1 * (Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft')))) % 360
    const events = step(game, tuning, input())
    if (events.some(event => event.name === 'pulse')) pulseTick = game.tick
    if (game.state !== 'playing') {
      active = false
      overlay.hidden = false
      byId('title').textContent = game.state === 'won' ? 'Đảo Bến đã sáng!' : 'Đêm đã khép lại'
      const reason = events.find(event => event.name === 'game_over').data.reason
      const description = { all_lit: 'Cả năm đèn đã được thắp.', dawn: 'Đã hết thời gian.', no_flames: 'Mây đã hết lửa.' }
      byId('message').textContent = description[reason] + ' Điểm: ' + game.score
      start.textContent = 'Chơi lại'
      start.focus()
    }
  }
  draw()
  updateHud()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

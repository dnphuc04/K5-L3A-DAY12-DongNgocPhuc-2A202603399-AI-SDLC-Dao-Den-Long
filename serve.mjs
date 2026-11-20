import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { readLeaderboard, saveScore } from './leaderboard.mjs'

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css'],
  '/view.mjs': ['view.mjs', 'text/javascript'],
  '/game.mjs': ['game.mjs', 'text/javascript'],
  '/game.contract.json': ['game.contract.json', 'application/json']
}
export function makeServer() {
  return createServer(async (request, response) => {
    const path = request.url?.split('?')[0]
    if (path === '/leaderboard') {
      try {
        if (request.method === 'GET') {
          const scores = await readLeaderboard()
          response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
            .end(JSON.stringify(scores))
        } else if (request.method === 'POST') {
          if (!['http://localhost', 'http://127.0.0.1'].some(origin =>
            request.headers.origin === origin + ':' + request.socket.localPort) ||
            request.headers['content-type'] !== 'application/json') {
            response.writeHead(403).end()
            return
          }
          let body = ''
          for await (const chunk of request) {
            body += chunk
            if (body.length > 2048) {
              response.writeHead(413).end()
              return
            }
          }
          const scores = await saveScore(JSON.parse(body))
          response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify(scores))
        } else response.writeHead(405).end()
      } catch (error) {
        response.writeHead(error instanceof TypeError || error instanceof SyntaxError ? 400 : 500).end()
      }
      return
    }
    const file = Object.hasOwn(files, path) ? files[path] : null
    if (!file) {
      response.writeHead(404).end()
      return
    }
    try {
      const body = await readFile(new URL(file[0], import.meta.url))
      response.writeHead(200, { 'Content-Type': file[1] }).end(body)
    } catch {
      response.writeHead(500).end()
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--export-leaderboard' && process.argv.length === 4) {
    await writeFile(process.argv[3], JSON.stringify(await readLeaderboard(), null, 2) + '\n')
  } else if (process.argv.length === 2) {
    const port = Number(process.env.PORT ?? 8080)
    makeServer().listen(port, '127.0.0.1', function () {
      console.log('http://localhost:' + this.address().port)
    })
  } else {
    console.error('Usage: node serve.mjs [--export-leaderboard FILE]')
    process.exitCode = 2
  }
}

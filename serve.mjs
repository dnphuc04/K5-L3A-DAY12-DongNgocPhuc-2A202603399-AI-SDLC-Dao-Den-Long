import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css'],
  '/view.mjs': ['view.mjs', 'text/javascript'],
  '/game.mjs': ['game.mjs', 'text/javascript'],
  '/game.contract.json': ['game.contract.json', 'application/json']
}
const port = Number(process.env.PORT ?? 8080)
createServer(async (request, response) => {
  const path = request.url?.split('?')[0]
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
}).listen(port, '127.0.0.1', () => console.log('http://localhost:' + port))

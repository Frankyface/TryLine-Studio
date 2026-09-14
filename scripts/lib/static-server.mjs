/** A loopback-only server for rendering and local verification. */
import { createServer } from 'node:http'
import { readFile, realpath } from 'node:fs/promises'
import { extname, resolve, relative, isAbsolute } from 'node:path'

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

export async function startStaticServer(root, port = 0) {
  const base = await realpath(root)
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      const segments = pathname.split(/[\\/]/).filter(Boolean)
      if (segments.some((part) => part.startsWith('.'))) throw new Error('Hidden path')
      let path = resolve(base, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!extname(path)) path += '.html'
      path = await realpath(path)
      const local = relative(base, path)
      if (local.startsWith('..') || isAbsolute(local)) throw new Error('Outside root')
      const body = await readFile(path)
      response.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream',
        'Cache-Control': 'no-store' })
      response.end(body)
    } catch {
      if (!response.headersSent) response.writeHead(404)
      response.end('Not found')
    }
  })
  await new Promise((done, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', done)
  })
  return { url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done, reject) => {
      server.closeAllConnections()
      server.close((error) => error ? reject(error) : done())
    }) }
}

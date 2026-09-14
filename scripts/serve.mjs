import { fileURLToPath } from 'node:url'
import { startStaticServer } from './lib/static-server.mjs'

const server = await startStaticServer(fileURLToPath(new URL('../', import.meta.url)), 4321)
console.log(`TryLine Studio: ${server.url}`)
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => { await server.close(); process.exit(0) })
}

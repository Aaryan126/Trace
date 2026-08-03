import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export { createServer } from './server.js';
export type {
  ServerConfig,
  TreeNode,
  TreeEdge,
  CaptureItem,
} from './server.js';

// Start the server when this module is executed directly (e.g. `node dist/index.js`)
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('/index.js') || process.argv[1].endsWith('/index.ts') || process.argv[1].endsWith('/index'));

if (isMainModule) {
  const { createServer: start } = await import('./server.js');
  const server = await start();
  const port = Number(process.env.BRAINCH_PORT) || 3333;
  await server.listen({ port, host: '127.0.0.1' });
  const addr = server.addresses()[0];
  console.log(`Brainch API running on http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : port}`);
}

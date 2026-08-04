export { createServer } from './server.js';
export { createRuntime, type TraceRuntime, type RuntimeOptions } from './runtime.js';
export { AutonomousCoordinator, TraceEventBus, type TraceLiveEvent } from './automation.js';
export { BrowserCaptureCoordinator, type BrowserCaptureRequest, type BrowserCapturePayload } from './browser-capture.js';
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
  const [{ createServer: start }, { createRuntime }] = await Promise.all([
    import('./server.js'),
    import('./runtime.js'),
  ]);
  const runtime = createRuntime({ startWatchers: true });
  const server = await start({ _db: runtime.db, _automation: runtime.automation, _captures: runtime.captures });
  const port = runtime.config.dashboardPort;
  await server.listen({ port, host: '127.0.0.1' });
  const addr = server.addresses()[0];
  console.log(`Trace API running on http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : port}`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.close();
    await runtime.close();
  };
  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
}

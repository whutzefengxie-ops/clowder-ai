// Preload runs before the API's static module graph, preserving its argv/entrypoint.
// Fields deliberately exclude paths, environment, configuration and credentials.
import { registerHooks } from 'node:module';
import { isMainThread, threadId } from 'node:worker_threads';

const started = performance.now();
let moduleLoads = 0,
  moduleReadMs = 0,
  moduleResolveMs = 0,
  lastReport = started;
const hook = isMainThread
  ? registerHooks({
      resolve(specifier, context, next) {
        const began = performance.now();
        try {
          return next(specifier, context);
        } finally {
          moduleResolveMs += performance.now() - began;
        }
      },
      load(url, context, next) {
        const began = performance.now();
        try {
          return next(url, context);
        } finally {
          moduleLoads++;
          moduleReadMs += performance.now() - began;
          if (performance.now() - lastReport > 5000) {
            lastReport = performance.now();
            milestone('module-loading');
          }
        }
      },
    })
  : null;
function milestone(phase) {
  const resource = process.resourceUsage();
  console.info(
    '[api-startup]',
    JSON.stringify({
      phase,
      pid: process.pid,
      threadId,
      moduleLoads,
      moduleReadMs: Math.round(moduleReadMs),
      moduleResolveMs: Math.round(moduleResolveMs),
      elapsedMs: Math.round(performance.now() - started),
      processUptimeMs: Math.round(process.uptime() * 1000),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      userCpuMs: Math.round(resource.userCPUTime / 1000),
      systemCpuMs: Math.round(resource.systemCPUTime / 1000),
    }),
  );
  if (phase === 'http-listening') hook?.deregister();
}
globalThis.__clowderStartupMilestone = milestone;
milestone('node-bootstrap');
process.once('exit', (code) => milestone(`exit:${code}`));

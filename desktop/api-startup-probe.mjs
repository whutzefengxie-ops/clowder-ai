// Preload runs before the API's static module graph, preserving its argv/entrypoint.
// Fields deliberately exclude paths, environment, configuration and credentials.
const started = performance.now();
function milestone(phase) {
  const resource = process.resourceUsage();
  console.info(
    '[api-startup]',
    JSON.stringify({
      phase,
      elapsedMs: Math.round(performance.now() - started),
      processUptimeMs: Math.round(process.uptime() * 1000),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      userCpuMs: Math.round(resource.userCPUTime / 1000),
      systemCpuMs: Math.round(resource.systemCPUTime / 1000),
    }),
  );
}
globalThis.__clowderStartupMilestone = milestone;
milestone('node-bootstrap');
process.once('exit', (code) => milestone(`exit:${code}`));

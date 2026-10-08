// Container health check: asks the admin port, which answers /healthz without
// credentials and only after a query against the database.

const port = process.env.ADMIN_PORT || '8081';

try {
  const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) {
    console.log(`unhealthy: ${response.status} ${(await response.text()).trim()}`);
    process.exit(1);
  }
  console.log('healthy');
}
catch (e) {
  console.log(`unhealthy: ${e.message}`);
  process.exit(1);
}

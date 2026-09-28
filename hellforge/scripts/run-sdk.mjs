import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Hellforge owns DOM UI and direct renderer state. Keep engine and render on
// the main thread; moving realms needs a separate UI/engine boundary migration.
export function sdkEnvironment(env) {
  return {
    ...env,
    NODE_OPTIONS: [env.NODE_OPTIONS?.trim(), '--max-old-space-size=16384'].filter(Boolean).join(' '),
    FORGEAX_EXECUTION_WORKERS: JSON.stringify({ engine: false, render: false, kernels: 'auto' }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cli = fileURLToPath(new URL('../node_modules/@forgeax/engine/dist/bin/forgeax.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
    env: sdkEnvironment(process.env),
    stdio: 'inherit',
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}

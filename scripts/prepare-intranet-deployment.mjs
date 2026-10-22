#!/usr/bin/env node
import { prepareIntranetDeployment } from './lib/prepare-intranet-deployment.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'One-time source deployment preparation: node scripts/prepare-intranet-deployment.mjs --host-root <absolute Host directory>',
  );
  console.log(
    'Build the target API first. Existing settings/history are preserved. Restart API after preparation. Normal startup is read-only.',
  );
  console.log(
    'After an interrupted preparation only: append --recover-stale-lock to retain a verified dead-process lock and retry. Live/unknown locks are never removed.',
  );
} else {
  try {
    if (
      ![2, 3].includes(args.length) ||
      args[0] !== '--host-root' ||
      (args.length === 3 && args[2] !== '--recover-stale-lock')
    )
      throw new Error('Expected --host-root <absolute Host directory> [--recover-stale-lock]; use --help');
    const result = await prepareIntranetDeployment({
      hostRoot: args[1],
      deploymentEnv: process.env,
      recoverStaleLock: args[2] === '--recover-stale-lock',
    });
    console.log(JSON.stringify({ ...result, restartRequired: true }));
  } catch (error) {
    console.error(
      `Intranet preparation failed: ${error instanceof Error ? error.message : 'unknown error'}. Existing .env and history were preserved; any readiness event/directories remain. Do not change disk-root ACLs.`,
    );
    process.exitCode = 1;
  }
}

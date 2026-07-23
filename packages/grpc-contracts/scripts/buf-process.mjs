import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const bufCacheDirectory = resolve('node_modules/.cache/buf');

export function runBuf(args) {
  const result = spawnSync('buf', args, {
    env: {
      ...process.env,
      BUF_CACHE_DIR: bufCacheDirectory,
    },
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  return result.status ?? 1;
}

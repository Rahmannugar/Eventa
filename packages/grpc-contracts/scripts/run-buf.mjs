import { runBuf } from './buf-process.mjs';

const status = runBuf(process.argv.slice(2));

if (status !== 0) {
  process.exit(status);
}

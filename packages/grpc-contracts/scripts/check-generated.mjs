import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { runBuf } from './buf-process.mjs';

const generatedDirectory = resolve('src/generated');

function readGeneratedFiles() {
  if (!existsSync(generatedDirectory)) {
    return new Map();
  }

  const files = readdirSync(generatedDirectory, {
    recursive: true,
    withFileTypes: true,
  });

  return new Map(
    files
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const filePath = resolve(entry.parentPath, entry.name);

        return [
          relative(generatedDirectory, filePath),
          readFileSync(filePath, 'utf8'),
        ];
      }),
  );
}

const beforeGeneration = readGeneratedFiles();
const generationStatus = runBuf(['generate']);

if (generationStatus !== 0) {
  process.exit(generationStatus);
}

const afterGeneration = readGeneratedFiles();
const allPaths = new Set([
  ...beforeGeneration.keys(),
  ...afterGeneration.keys(),
]);
const changedPaths = [...allPaths]
  .filter(
    (filePath) =>
      beforeGeneration.get(filePath) !== afterGeneration.get(filePath),
  )
  .sort();

if (changedPaths.length > 0) {
  console.error('Generated protobuf contracts were stale:');
  for (const filePath of changedPaths) {
    console.error(`- ${filePath}`);
  }
  console.error('Run "pnpm proto:generate" and include the generated output.');
  process.exit(1);
}

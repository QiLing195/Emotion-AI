const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cacheRoot = process.env.ELECTRON_BUILDER_CACHE
  || path.join(root, '.electron-builder-cache');
fs.mkdirSync(cacheRoot, { recursive: true });

const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
const result = spawnSync(process.execPath, [cli, '--win', 'portable'], {
  cwd: root,
  env: { ...process.env, ELECTRON_BUILDER_CACHE: cacheRoot },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);

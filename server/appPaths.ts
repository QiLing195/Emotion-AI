import path from 'node:path';

/** Resolve immutable application resources independently from the process working directory. */
export function resolveAppRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  return path.resolve(cwd, env.APP_ROOT?.trim() || '.');
}

export function resolveAppResource(
  relativePath: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  return path.resolve(resolveAppRoot(env, cwd), relativePath);
}

/** Resolve the writable data root shared by every server and desktop persistence path. */
export function resolveMemoriesDir(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  return path.resolve(cwd, env.MEMORIES_DIR?.trim() || 'memories');
}

/** Resolve a persistent file path beneath the configured writable data root. */
export function resolveMemoryPath(
  relativePath: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  return path.resolve(resolveMemoriesDir(env, cwd), relativePath);
}

/** Resolve the built frontend independently from the server module location. */
export function resolveWebDistDir(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  return path.resolve(resolveAppRoot(env, cwd), env.WEB_DIST_DIR?.trim() || 'dist');
}

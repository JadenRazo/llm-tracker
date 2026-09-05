import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = await mkdtemp(path.join(tmpdir(), 'tracker-read-tests-'));
try {
  const outfile = path.join(directory, 'tests.cjs');
  await build({
    entryPoints: ['scripts/read-coalescing.test.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [{
      name: 'isolated-database',
      setup(context) {
        context.onResolve({ filter: /^@\/lib\/db$/ }, () => ({
          path: path.resolve('scripts/fixtures/read-database.ts'),
        }));
      },
    }],
  });
  const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}

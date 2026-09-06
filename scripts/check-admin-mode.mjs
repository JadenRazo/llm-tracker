import assert from 'node:assert/strict';
import { developmentAdminEnabled } from '../src/lib/admin-mode.mjs';
import { build } from 'esbuild';
for (const mode of ['production','test','',undefined,null,'Development']) assert.equal(developmentAdminEnabled(mode),false);
assert.equal(developmentAdminEnabled('development'),true);
console.log('Production and unspecified modes cannot enable the manual administrative endpoint.');

// Execute the actual route while making any config/poller access a test failure.
const result = await build({ entryPoints: ['src/app/api/admin/run-poller/route.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'guarded-services', setup(builder) {
  builder.onResolve({ filter: /^(next\/server|@\/lib\/(env|poller\/runner))$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'next/server'
    ? 'export const NextResponse={json:(body,init)=>Response.json(body,init)};'
    : 'export function env(){throw new Error("private service reached")}; export function isSourceKey(){throw new Error("private service reached")}; export function runSource(){throw new Error("private service reached")};', loader: 'js' }));
} }] });
const { POST } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'));
const previous = process.env.NODE_ENV;
try {
  for (const mode of ['production', 'test', '', undefined]) {
    if (mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = mode;
    for (const headers of [{}, { 'x-admin-token': 'fixture-token', 'x-forwarded-for': '127.0.0.1' }]) {
      const response = await POST(new Request('http://localhost/api/admin/run-poller?source=fixture', { method: 'POST', headers }));
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  }
} finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
console.log('Actual production route rejects anonymous and spoofed-localhost requests before private service access.');

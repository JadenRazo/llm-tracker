import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { database } from './fixtures/read-database';
import { resolveDocToken, resolveDocUrl } from '../src/lib/doc-resolver';
import { getCurrentCliVersion } from '../src/lib/current-cli';

const TTL = 5 * 60 * 1000;
const realNow = Date.now;
let now = realNow();
Date.now = () => now;
after(() => { Date.now = realNow; });
beforeEach(() => {
  now += TTL + 1;
  database.available = true;
  database.queries = [];
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const row = (provider: string, name = '--print') => ({
  id: `${provider}:${name}`, provider, name, kind: 'flag',
  metadata: { aliases: ['-p'] },
  docsUrl: 'https://code.claude.com/docs/en/cli-reference#print',
});

test('48 overlapping guide tokens and links use one provider index read', async (t) => {
  const query = deferred<unknown[]>();
  database.read = () => query.promise;
  const lookups = Array.from({ length: 48 }, (_, i) => i % 3 === 0
    ? resolveDocUrl('https://code.claude.com/docs/en/cli-reference#print')
    : resolveDocToken(i % 3 === 1 ? '`--print`' : '-p'));
  await tick();
  const count = database.queries.length;
  query.resolve([row('claude')]);
  const values = await Promise.all(lookups);
  t.diagnostic(`cold guide: ${count} database queries for 48 lookups`);
  assert.ok(values.every((value) => value?.id === 'claude:--print'));
  assert.equal(count, 1);
  await resolveDocToken('--print');
  assert.equal(database.queries.length, 1);
});

test('concurrent providers remain isolated and exact tokens, aliases and subcommands are preserved', async () => {
  database.read = async ({ params }) => [
    row(String(params[0])),
    { ...row(String(params[0]), 'claude stop <id>'), kind: 'cli-subcommand' },
  ];
  const values = await Promise.all([
    resolveDocToken('-p', 'claude'), resolveDocToken('-p', 'openai'),
    resolveDocToken('claude stop', 'claude'), resolveDocToken('unknown', 'openai'),
  ]);
  assert.deepEqual(values.map((value) => value?.provider ?? null), ['claude', 'openai', 'claude', null]);
  assert.equal(database.queries.length, 2);
});

test('index TTL still expires five minutes from the start of the read', async () => {
  const query = deferred<unknown[]>();
  database.read = () => query.promise;
  const pending = resolveDocToken('--print');
  await tick();
  now += 1000;
  query.resolve([row('claude')]);
  await pending;
  now += TTL - 1001;
  await resolveDocToken('--print');
  assert.equal(database.queries.length, 1);
  now += 1;
  database.read = async () => [row('claude', '--new')];
  assert.equal(await resolveDocToken('--print'), null);
  assert.equal((await resolveDocToken('--new'))?.name, '--new');
  assert.equal(database.queries.length, 2);
});

test('index failures are shared only while pending and the next call retries', async () => {
  const query = deferred<unknown[]>();
  database.read = () => query.promise;
  const first = resolveDocToken('--print');
  const second = resolveDocToken('-p');
  await tick();
  query.reject(new Error('database unavailable'));
  assert.deepEqual(await Promise.all([first, second]), [null, null]);
  assert.equal(database.queries.length, 1);
  database.read = async () => [row('claude')];
  assert.equal((await resolveDocToken('--print'))?.provider, 'claude');
  assert.equal(database.queries.length, 2);
});

test('48 overlapping version lookups use one stable-version query', async (t) => {
  const query = deferred<unknown[]>();
  database.read = () => query.promise;
  const pending = Array.from({ length: 48 }, () => getCurrentCliVersion('openai'));
  await tick();
  const count = database.queries.length;
  query.resolve([{ externalId: '1.2.3' }]);
  assert.deepEqual(await Promise.all(pending), Array(48).fill('1.2.3'));
  t.diagnostic(`cold version: ${count} database queries for 48 lookups`);
  assert.equal(count, 1);
});

test('missing stable version keeps the two-query fallback and provider isolation', async () => {
  let calls = 0;
  database.read = async () => ++calls === 1 ? [] : [{ externalId: '1.2.4-beta' }];
  assert.deepEqual(await Promise.all([
    getCurrentCliVersion('gemini'), getCurrentCliVersion('gemini'),
  ]), ['1.2.4-beta', '1.2.4-beta']);
  assert.equal(database.queries.length, 2);
  database.read = async () => [{ externalId: '9.0.0' }];
  assert.equal(await getCurrentCliVersion('claude'), '9.0.0');
  assert.equal(await getCurrentCliVersion('gemini'), '1.2.4-beta');
});

test('empty version results retain their TTL, failed lookups retry without caching', async () => {
  database.read = async () => [];
  assert.equal(await getCurrentCliVersion(), null);
  database.read = async () => [{ externalId: '2.0.0' }];
  now += TTL - 1;
  assert.equal(await getCurrentCliVersion(), null);
  assert.equal(database.queries.length, 2);
  now += 1;
  database.read = async () => { throw new Error('unavailable'); };
  assert.equal(await getCurrentCliVersion(), null);
  database.read = async () => [{ externalId: '2.0.0' }];
  assert.equal(await getCurrentCliVersion(), '2.0.0');
  assert.equal(database.queries.length, 4);
});

test('missing database is never negatively cached by either reader', async () => {
  database.available = false;
  assert.equal(await resolveDocToken('--print'), null);
  assert.equal(await getCurrentCliVersion(), null);
  database.available = true;
  database.read = async ({ table }) => table === 'cli_reference' ? [row('claude')] : [{ externalId: '3.0.0' }];
  assert.equal((await resolveDocToken('--print'))?.name, '--print');
  assert.equal(await getCurrentCliVersion(), '3.0.0');
  assert.equal(database.queries.length, 2);
});

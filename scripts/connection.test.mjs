import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createServer } from 'vite';
const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const { OdooClient } = await vite.ssrLoadModule('/src/api/odooClient.ts');
after(() => vite.close());
const config = { enabled: true, mode: 'json2', baseUrl: '/mock', apiKey: 'test', database: '', username: '', maxRetries: 1, requestDelayMs: 0, pollMs: 60000 };
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const json = value => new Response(JSON.stringify(value), { status: 200 });

test('slow independent reads use two lanes, duplicate reads share one request', async (t) => {
  let active = 0, peak = 0, calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++; peak = Math.max(peak, ++active);
    await delay(80); active--; return json([{ id: 1 }]);
  });
  const client = new OdooClient(config);
  const start = performance.now();
  await Promise.all([1, 1, 2, 3, 4, 5, 6].map(id => client.read('x_player', [id], ['id'])));
  assert.equal(calls, 6); assert.equal(peak, 2);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 600, `six reads took ${elapsed} ms`);
  console.log(`Six 80 ms reads: ${Math.round(elapsed)} ms, ${calls} requests, peak concurrency ${peak}`);
});

test('a stalled read does not block writes; read-after-write is fresh', async (t) => {
  let release;
  const stalled = new Promise(resolve => { release = resolve; });
  const operations = [];
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const method = url.split('/').at(-1);
    operations.push(method);
    if (method === 'read' && ++reads === 1) await stalled;
    return json(method === 'read' ? [{ id: 1 }] : true);
  });
  const client = new OdooClient(config);
  const oldRead = client.read('x_player', [1], ['id']);
  await delay(5);
  await Promise.all([client.write('x_player', [1], { x_name: 'A' }), client.write('x_player', [1], { x_name: 'B' })]);
  await client.read('x_player', [1], ['id']);
  assert.deepEqual(operations, ['read', 'write', 'write', 'read']);
  release(); await oldRead;
});

test('a dropped create response is not blindly retried', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new TypeError('lost connection'); });
  await assert.rejects(new OdooClient(config).create('x_player', { x_name: 'New player' }));
  assert.equal(calls, 1);
});

test('read retry recovers and releases the lane', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1) throw new TypeError('temporary failure');
    return json([{ id: 1 }]);
  });
  assert.deepEqual(await new OdooClient(config).read('x_player', [1], ['id']), [{ id: 1 }]);
  assert.equal(calls, 2);
});

test('429 backoff recovers without a request burst', async (t) => {
  let calls = 0;
  const starts = [];
  t.mock.method(globalThis, 'fetch', async () => {
    starts.push(performance.now());
    return ++calls === 1 ? new Response('{}', { status: 429, headers: { 'Retry-After': '0.05' } }) : json([]);
  });
  await new OdooClient(config).read('x_player', [1], ['id']);
  assert.equal(calls, 2); assert.ok(starts[1] - starts[0] >= 45);
});

test('incomplete successful mutation response remains a failure', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{', { status: 200 }); });
  await assert.rejects(new OdooClient(config).create('x_player', {}), /Incomplete/);
  assert.equal(calls, 1);
});

test('failed legacy login can recover on reconnect', async (t) => {
  let logins = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.params.service === 'common') return json(++logins === 1 ? { error: { message: 'offline' } } : { result: 2 });
    return json({ result: [{ id: 1 }] });
  });
  const client = new OdooClient({ ...config, mode: 'legacy' });
  await assert.rejects(client.read('x_player', [1], ['id']));
  assert.deepEqual(await client.read('x_player', [1], ['id']), [{ id: 1 }]);
  assert.equal(logins, 2);
});

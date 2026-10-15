const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function worker(fetch) {
  const listeners = {};
  const hits = [];
  const writes = [];
  const cached = { cached: true };
  vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'), 'utf8'), {
    URL, fetch,
    self: { location: { origin: 'https://example.test' }, addEventListener(name, fn) { listeners[name] = fn; } },
    caches: {
      async match(request, options) { hits.push({ request, options }); return cached; },
      async open() { return { async put(request) { writes.push(request); } }; }
    }
  });
  async function request(mode, url) {
    let promise;
    listeners.fetch({ request: { method: 'GET', mode, url }, respondWith(p) { promise = p; } });
    return promise;
  }
  return { request, hits, writes, cached };
}

test('offline navigation returns the cached app shell', async () => {
  const w = worker(async () => { throw Error('offline'); });
  assert.equal(await w.request('navigate', 'https://example.test/app/'), w.cached);
  assert.equal(w.hits[0].request, './index.html');
});

test('online navigation refreshes the cached shell', async () => {
  const response = { ok: true, clone() { return this; } };
  const w = worker(async () => response);
  assert.equal(await w.request('navigate', 'https://example.test/app/'), response);
  assert.deepEqual(w.writes, ['./index.html']);
});

test('versioned assets use the precache offline', async () => {
  const w = worker(async () => { throw Error('must not fetch'); });
  assert.equal(await w.request('cors', 'https://example.test/app/app.js?v=15'), w.cached);
  assert.equal(w.hits[0].options.ignoreSearch, true);
});

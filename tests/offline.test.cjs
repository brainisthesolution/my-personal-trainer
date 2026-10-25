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
    self: { location: { origin: 'https://example.test', href: 'https://example.test/app/sw.js' }, addEventListener(name, fn) { listeners[name] = fn; } },
    caches: {
      async match(request, options) { hits.push({ request, options }); return cached; },
      async open() { return { async match(request, options) { hits.push({ request, options }); return cached; }, async put(request) { writes.push(request); } }; }
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

test('other HTML pages cannot overwrite the offline app shell', async () => {
  const w = worker(async () => { throw Error('should use browser navigation'); });
  assert.equal(await w.request('navigate', 'https://example.test/app/tmp/diagnostics.html'), undefined);
  assert.deepEqual(w.writes, []);
});

test('fetch reads from the current release cache instead of matching an older release', async () => {
  const listeners = {};
  const source = fs.readFileSync(require.resolve('../sw.js'), 'utf8');
  const current = source.match(/CACHE_NAME = "([^"]+)"/)[1];
  const fresh = { version: current };
  vm.runInNewContext(source, {
    URL,
    self: { location: { origin: 'https://example.test', href: 'https://example.test/app/sw.js' }, addEventListener: (name, fn) => listeners[name] = fn },
    caches: { match() { throw Error('Global matching may return obsolete JS'); }, open: async name => { assert.equal(name, current); return { match: async () => fresh }; } }
  });
  let responding;
  listeners.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://example.test/app/app.js?v=20' }, respondWith(p) { responding = p; } });
  assert.equal(await responding, fresh);
});

test('install precaches both practices and every exercise image before activation', async () => {
  const listeners = {};
  const batches = [];
  let skipped = false;
  const library = JSON.parse(fs.readFileSync(require.resolve('../data/exercise-library.json')));
  const face = JSON.parse(fs.readFileSync(require.resolve('../data/face-yoga.json')));
  vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'), 'utf8'), {
    URL, Request,
    self: { location: { href: 'https://example.test/sw.js' }, addEventListener: (name, fn) => listeners[name] = fn, skipWaiting: async () => { skipped = true; } },
    caches: { open: async () => ({
      addAll: async requests => {
        for (const request of requests) assert.equal(request.cache, 'reload');
        batches.push(requests.map(request => `.${new URL(request.url).pathname}`));
      },
      match: async path => ({ json: async () => path.includes('face-yoga') ? face : library })
    }) }
  });
  let installing;
  listeners.install({ waitUntil(promise) { installing = promise; } });
  await installing;
  assert.ok(skipped);
  assert.ok(batches[0].includes('./data/face-yoga.json'));
  for (const exercise of [...library.exercises, ...face.exercises]) assert.ok(batches[1].includes(`./${exercise.image}`));
});

test('activation removes only obsolete app caches, preserving other apps and user history', async () => {
  const listeners = {};
  const removed = [];
  let claimed = false;
  const source = fs.readFileSync(require.resolve('../sw.js'), 'utf8');
  const current = source.match(/CACHE_NAME = "([^"]+)"/)[1];
  vm.runInNewContext(source, {
    self: { addEventListener: (name, fn) => listeners[name] = fn, clients: { claim: async () => { claimed = true; } } },
    caches: {
      keys: async () => ['fit-timer-v1', current, 'another-app-v1'],
      delete: async key => removed.push(key)
    },
    localStorage: { clear() { throw Error('History must never be cleared'); } },
    indexedDB: { deleteDatabase() { throw Error('History must never be cleared'); } }
  });
  let activating;
  listeners.activate({ waitUntil(promise) { activating = promise; } });
  await activating;
  assert.deepEqual(removed, ['fit-timer-v1']);
  assert.equal(claimed, true);
});

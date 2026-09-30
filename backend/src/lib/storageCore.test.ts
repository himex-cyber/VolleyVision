// 9.8: the apps keep the token and offline taps in native Preferences (iOS can
// reclaim WKWebView localStorage). A synchronous in-memory copy, hydrated
// before render, written through in order; old localStorage values migrated.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createNativeStore, type KeyValue, type LegacyStore } from './storageCore';

function fakePrefs(initial: Record<string, string> = {}, failSetOn?: string) {
  const data = new Map(Object.entries(initial));
  const log: string[] = [];
  const prefs: KeyValue = {
    get: async ({ key }) => ({ value: data.get(key) ?? null }),
    set: async ({ key, value }) => {
      await new Promise((r) => setTimeout(r, key.length % 3)); // uneven timing
      if (key === failSetOn) throw new Error('disk full');
      data.set(key, value);
      log.push(`set:${key}=${value}`);
    },
    remove: async ({ key }) => { data.delete(key); log.push(`remove:${key}`); },
    keys: async () => ({ keys: [...data.keys()] }),
  };
  return { prefs, data, log };
}

function fakeLegacy(initial: Record<string, string>): LegacyStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, keys: () => [...data.keys()], get: (k) => data.get(k) ?? null, remove: (k) => { data.delete(k); } };
}

async function main() {
  // Hydrate: only vv_ keys, synchronous reads afterwards.
  {
    const { prefs } = fakePrefs({ vv_token: 't1', 'vv_queue:u:m': '[1]', other: 'x' });
    const store = createNativeStore(prefs);
    assert.equal(await store.hydrate(), true);
    assert.equal(store.get('vv_token'), 't1');
    assert.equal(store.get('other'), null, "only the app's own keys");
    assert.deepEqual(store.keys('vv_queue:'), ['vv_queue:u:m']);
  }

  // Migration: every old value lands in Preferences before localStorage loses it.
  {
    const { prefs, data } = fakePrefs();
    const legacy = fakeLegacy({ vv_token: 'old', 'vv_queue:u:m': '[2]', vv_probe: '1', unrelated: 'y' });
    const store = createNativeStore(prefs);
    assert.equal(await store.hydrate(legacy), true);
    assert.equal(data.get('vv_token'), 'old');
    assert.equal(data.get('vv_queue:u:m'), '[2]');
    assert.equal(store.get('vv_token'), 'old', 'readable straight away');
    assert.deepEqual([...legacy.data.keys()].sort(), ['unrelated', 'vv_probe'], 'migrated keys leave localStorage; others stay');
    assert.equal(data.has('vv_probe'), false, 'the probe key is not migrated');
  }

  // A failed migration keeps localStorage untouched and reports failure.
  {
    const { prefs } = fakePrefs({}, 'vv_token');
    const legacy = fakeLegacy({ vv_token: 'old', 'vv_queue:u:m': '[3]' });
    assert.equal(await createNativeStore(prefs).hydrate(legacy), false);
    assert.equal(legacy.data.get('vv_token'), 'old', 'nothing lost');
    assert.equal(legacy.data.get('vv_queue:u:m'), '[3]');
  }

  // Writes: synchronous in memory, persisted in call order, flush awaits them.
  {
    const { prefs, data, log } = fakePrefs();
    const store = createNativeStore(prefs);
    await store.hydrate();
    store.set('vv_queue:u:m', 'a');
    store.set('vv_queue:u:m', 'ab');
    store.remove('vv_queue:u:m');
    store.set('vv_queue:u:m', 'abc');
    assert.equal(store.get('vv_queue:u:m'), 'abc', 'reads see writes at once');
    await store.flush();
    assert.deepEqual(log, ['set:vv_queue:u:m=a', 'set:vv_queue:u:m=ab', 'remove:vv_queue:u:m', 'set:vv_queue:u:m=abc'], 'in order');
    assert.equal(data.get('vv_queue:u:m'), 'abc');
  }

  // A failed write doesn't stop later ones.
  {
    const { prefs, data } = fakePrefs({}, 'vv_bad');
    const store = createNativeStore(prefs);
    await store.hydrate();
    store.set('vv_bad', 'x');
    store.set('vv_token', 'y');
    await store.flush();
    assert.equal(data.get('vv_token'), 'y');
  }

  // The frontend copy (no test runner there) must not drift from this one.
  const marker = 'export interface KeyValue';
  const from = (file: string) => {
    const s = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    assert.ok(s.includes(marker), `${file} lost its marker`);
    return s.slice(s.indexOf(marker));
  };
  assert.equal(from(path.join(__dirname, '../../../frontend/src/lib/storageCore.ts')), from(path.join(__dirname, 'storageCore.ts')),
    'frontend storageCore.ts drifted');

  console.log('storageCore.test.ts passed');
}

main().catch((err) => { console.error(err); process.exit(1); });

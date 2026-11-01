import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('seed is idempotent and API returns persistent data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gigger-'));
  const env = { ...process.env, DATABASE_PATH: join(dir, 'test.sqlite') };
  let server;
  try {
    for (let i = 0; i < 2; i++) {
      const result = spawnSync(process.execPath, ['dist/seed.js'], { env });
      assert.equal(result.status, 0, result.stderr.toString());
    }
    server = spawn(process.execPath, ['dist/server.js'], { env });
    let response;
    for (let i = 0; i < 50; i++) {
      try { response = await fetch('http://127.0.0.1:3000/items'); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(response, 'server did not start');
    assert.deepEqual(await response.json(), [{ id: 1, name: 'Welcome to Gigger' }]);
    assert.equal((await fetch('http://127.0.0.1:3000/health')).status, 200);
    assert.equal((await fetch('http://127.0.0.1:3000/missing')).status, 404);
  } finally {
    if (server) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
    rmSync(dir, { recursive: true, force: true });
  }
});

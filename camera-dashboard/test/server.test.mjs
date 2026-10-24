import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
async function freePort() {
  const probe = net.createServer();
  await new Promise(done => probe.listen(0, '127.0.0.1', done));
  const port = probe.address().port;
  await new Promise(done => probe.close(done));
  return port;
}
async function start(extra = {}, args = []) {
  const port = await freePort();
  let upstreamPort = await freePort();
  while (upstreamPort === port) upstreamPort = await freePort();
  const child = spawn(process.execPath, ['server.mjs', ...args], {
    cwd: root,
    env: { ...process.env, CAMERA_PASSWORD: 'test-password-never-expose',
      CAMERA_USERNAME: 'admin', HOST: '127.0.0.1', PORT: String(port), GO2RTC_PORT: String(upstreamPort),
      GO2RTC_BIN: join(root, 'fixtures/fake-streamer.mjs'), DASHBOARD_PASSWORD: '', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  await new Promise((done, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Startup timed out: ${logs}`)); }, 10000);
    child.stdout.on('data', data => { logs += data; if (logs.includes('cameras configured')) { clearTimeout(timer); done(); } });
    child.stderr.on('data', data => { logs += data; });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(logs)); });
  });
  return { child, port, url: `http://127.0.0.1:${port}`, logs,
    async close() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise(done => child.once('exit', done));
    } };
}

test('live HTTP and WebSocket proxy expose only configured streams and no credentials', async () => {
  await chmod(join(root, 'fixtures/fake-streamer.mjs'), 0o755);
  const app = await start();
  try {
    const response = await fetch(app.url + '/api/cameras');
    const text = await response.text();
    const body = JSON.parse(text);
    assert.equal(body.demo, false);
    assert.equal(body.cameras.length, 23);
    assert.equal(body.streamerReady, true);
    assert.ok(!text.includes('test-password-never-expose'));
    assert.ok(!text.includes('rtsp://'));
    assert.equal((await fetch(app.url)).status, 200);
    assert.match(await (await fetch(app.url + '/stream/video-rtc.js')).text(), /fake player/);
    assert.equal((await fetch(app.url + '/.env')).status, 404);
    assert.equal((await fetch(app.url + '/api/streams')).status, 404);
    assert.equal((await fetch(app.url, { method: 'POST' })).status, 405);

    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/stream/api/ws?src=camera_29_sub&src2=rtsp://attacker`);
    const message = await new Promise((done, reject) => {
      ws.onmessage = event => done(event.data);
      ws.onerror = reject;
    });
    assert.equal(message, '/api/ws?src=camera_29_sub');
    ws.close();
    const blocked = new WebSocket(`ws://127.0.0.1:${app.port}/stream/api/ws?src=rtsp://attacker`);
    await new Promise((done, reject) => { blocked.onerror = done; blocked.onopen = () => reject(new Error('Unknown source was accepted')); });
  } finally { await app.close(); }
});

test('dashboard authentication works and secrets are never served as assets', async () => {
  const app = await start({ DASHBOARD_PASSWORD: 'wall-password' }, ['--demo']);
  try {
    assert.equal((await fetch(app.url + '/api/cameras')).status, 401);
    const auth = 'Basic ' + Buffer.from('operator:wall-password').toString('base64');
    const response = await fetch(app.url, { headers: { Authorization: auth } });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(app.url + '/api/cameras', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(app.url + '/cameras.json', { headers: { Cookie: cookie } })).status, 404);
    const invalidHostStatus = await new Promise((done, reject) => {
      const request = http.get(app.url, { headers: { Cookie: cookie, Host: 'evil.example' } }, response => {
        response.resume();
        done(response.statusCode);
      });
      request.on('error', reject);
    });
    assert.equal(invalidHostStatus, 403);
  } finally { await app.close(); }
});

test('installed go2rtc accepts generated config and serves its browser player', { skip: !existsSync(join(root, 'bin/go2rtc')) }, async () => {
  const app = await start({ GO2RTC_BIN: join(root, 'bin/go2rtc') });
  try {
    const response = await fetch(app.url + '/stream/video-rtc.js');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /export class VideoRTC/);
    const body = await (await fetch(app.url + '/api/cameras')).json();
    assert.equal(body.streamerReady, true);
  } finally { await app.close(); }
});

test('LAN binding is rejected without a dashboard password', async () => {
  const child = spawn(process.execPath, ['server.mjs', '--demo'], {
    cwd: root, env: { ...process.env, HOST: '0.0.0.0', DASHBOARD_PASSWORD: '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const code = await new Promise(done => child.once('exit', done));
  assert.notEqual(code, 0);
  assert.match(stderr, /DASHBOARD_PASSWORD/);
});

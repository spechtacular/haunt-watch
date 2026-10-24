import http from 'node:http';
import { readFile, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { validateCameras, streamConfig, streamName } from './config.mjs';
import { streamerPlatform, streamerLaunch } from './platform.mjs';
import { startTestVideo } from './sample-video.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const demo = process.argv.includes('--demo');
const testVideo = process.argv.includes('--test-video');
if (demo && testVideo) throw new Error('Choose either --demo or --test-video.');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8088);
const upstreamPort = Number(process.env.GO2RTC_PORT || 1984);
for (const value of [port, upstreamPort]) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('Ports must be between 1 and 65535.');
}
if (port === upstreamPort) throw new Error('Dashboard and go2rtc ports must be different.');
const password = process.env.DASHBOARD_PASSWORD || '';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !password) {
  throw new Error('Set DASHBOARD_PASSWORD before listening on the LAN.');
}
const cameras = testVideo
  ? Array.from({ length: 4 }, (_, index) => ({ id: `test_${index + 1}`, room: `T${index + 1}`,
    name: `Test pattern ${index + 1}`, ip: '127.0.0.1', brand: 'amcrest', port: 554 }))
  : validateCameras(JSON.parse(await readFile(resolve(root, process.env.CAMERAS_FILE || 'cameras.json'), 'utf8')));
const cookie = randomBytes(32).toString('hex');
const expected = Buffer.from(`Basic ${Buffer.from(`operator:${password}`).toString('base64')}`);
function authorized(req) {
  if (!password) return true;
  if ((req.headers.cookie || '').split(';').some(item => item.trim() === `haunt_session=${cookie}`)) return true;
  const supplied = Buffer.from(req.headers.authorization || '');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function allowedOrigin(req) {
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}`;
}
function allowedHost(req) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) return true;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(req.headers.host);
}
let streamer;
let runtime;
let stopping = false;
let streamerReady = false;
let testSources;
const tunnels = new Set();

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/order.js', ['order.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (!allowedHost(req)) { res.writeHead(403).end('Invalid host'); return; }
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Haunt camera wall"' }).end('Sign in as operator.');
    return;
  }
  if (password) res.setHeader('Set-Cookie', `haunt_session=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
  if (req.method !== 'GET') { res.writeHead(405).end(); return; }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/cameras') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      demo, testVideo, cameras, transport: 'MSE', streamerReady,
    }));
    return;
  }
  if (url.pathname === '/stream/video-rtc.js' && !demo) {
    const upstream = http.get({ host: '127.0.0.1', port: upstreamPort, path: '/video-rtc.js', timeout: 5000 }, response => {
      res.writeHead(response.statusCode, { 'Content-Type': 'text/javascript' });
      response.pipe(res);
      response.on('error', () => res.destroy());
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(503).end('Streaming service unavailable'); else res.destroy(); });
    res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
    return;
  }
  const asset = assets.get(url.pathname);
  if (!asset) { res.writeHead(404).end('Not found'); return; }
  try {
    const data = await readFile(join(root, 'public', asset[0]));
    res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }).end(data);
  } catch {
    res.writeHead(500).end('Unable to load dashboard asset');
  }
});

server.on('upgrade', (req, socket, head) => {
  const name = streamName(req.url, cameras);
  if (demo || !name || !authorized(req) || !allowedOrigin(req) || !allowedHost(req)) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  const proxy = http.request({
    host: '127.0.0.1', port: upstreamPort,
    path: `/api/ws?src=${encodeURIComponent(name)}`,
    headers: {
      Connection: 'Upgrade', Upgrade: 'websocket',
      'Sec-WebSocket-Key': req.headers['sec-websocket-key'],
      'Sec-WebSocket-Version': '13',
    },
  });
  proxy.setTimeout(10000, () => proxy.destroy());
  proxy.on('upgrade', (response, upstream, upstreamHead) => {
    proxy.setTimeout(0);
    if (socket.destroyed) { upstream.destroy(); return; }
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstream.write(head);
    tunnels.add(socket);
    tunnels.add(upstream);
    socket.on('close', () => { upstream.destroy(); tunnels.delete(socket); });
    upstream.on('close', () => { socket.destroy(); tunnels.delete(upstream); });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    upstream.pipe(socket).pipe(upstream);
  });
  proxy.on('response', response => { response.resume(); socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); });
  proxy.on('error', () => socket.destroy());
  socket.on('error', () => proxy.destroy());
  socket.on('close', () => proxy.destroy());
  proxy.end();
});

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const socket of tunnels) socket.destroy();
  server.close();
  server.closeAllConnections();
  if (streamer && streamer.exitCode === null && streamer.signalCode === null) {
    streamer.kill('SIGTERM');
    await Promise.race([new Promise(done => streamer.once('exit', done)), new Promise(done => setTimeout(done, 2000))]);
    if (streamer.exitCode === null && streamer.signalCode === null) streamer.kill('SIGKILL');
  }
  testSources?.close();
  if (runtime) await rm(runtime, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
// IPC lets automated tests stop parent and child cleanly on Windows, too.
process.on('message', message => { if (message === 'shutdown') stop(); });

try {
  if (!demo) {
    const username = process.env.CAMERA_USERNAME || process.env.AMCREST_USERNAME || 'admin';
    const cameraPassword = process.env.CAMERA_PASSWORD || process.env.AMCREST_PASSWORD;
    if (!testVideo && !cameraPassword) throw new Error('Set CAMERA_PASSWORD in .env, or use npm run demo for a camera-free preview.');
    const binary = process.env.GO2RTC_BIN || join(root, 'bin', streamerPlatform().executable);
    const accessMode = /\.(?:mjs|js)$/i.test(binary) ? constants.R_OK : constants.X_OK;
    await access(binary, accessMode).catch(() => { throw new Error('Install go2rtc with npm run install:streamer first.'); });
    // Check the port before launching; never attach to someone else's go2rtc.
    const probe = http.createServer();
    await new Promise((done, reject) => { probe.once('error', reject); probe.listen(upstreamPort, '127.0.0.1', done); });
    await new Promise(done => probe.close(done));
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, '.runtime'), { recursive: true, mode: 0o700 });
    runtime = await mkdtemp(join(root, '.runtime/session-'));
    const configPath = join(runtime, 'go2rtc.yaml');
    const config = streamConfig(cameras, username, cameraPassword || '', upstreamPort);
    if (testVideo) {
      testSources = await startTestVideo(root);
      for (const camera of cameras) {
        for (const quality of ['sub', 'main']) config.streams[`${camera.id}_${quality}`] = [testSources.urls[quality]];
      }
    }
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    const launch = streamerLaunch(binary, configPath);
    streamer = spawn(launch.command, launch.args, { stdio: 'ignore', windowsHide: true });
    streamer.on('error', () => { console.error('Unable to launch go2rtc.'); stop(1); });
    streamer.on('exit', () => { if (!stopping) { console.error('go2rtc stopped unexpectedly. Check the binary and port configuration.'); stop(1); } });
    for (let attempt = 0; attempt < 50 && !streamerReady; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${upstreamPort}/video-rtc.js`, { signal: AbortSignal.timeout(500) });
        streamerReady = response.ok;
      } catch { /* Wait for startup. */ }
      if (!streamerReady) await new Promise(done => setTimeout(done, 100));
    }
    if (!streamerReady) throw new Error('go2rtc did not become ready.');
  }
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, host, done); });
  console.log(`Haunt Camera Wall ${demo ? '(preview mode)' : testVideo ? '(synthetic test video)' : '(live)'}: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`${cameras.length} cameras configured. Press Ctrl+C to stop.`);
} catch (error) {
  console.error(`Startup failed: ${error.message}`);
  await stop(1);
}

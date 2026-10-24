import { isIP } from 'node:net';

export function validateCameras(value) {
  if (!Array.isArray(value)) throw new Error('Camera configuration must be an array.');
  const ids = new Set();
  return value.filter(camera => camera.enabled !== false).map(camera => {
    if (!/^[a-zA-Z0-9_-]+$/.test(camera.id || '') || ids.has(camera.id)) {
      throw new Error('Each camera needs a unique id using letters, numbers, underscores or hyphens.');
    }
    ids.add(camera.id);
    if (isIP(camera.ip) !== 4) throw new Error(`Invalid IPv4 address for ${camera.id}.`);
    if (!['amcrest', 'reolink'].includes(camera.brand)) throw new Error(`Unsupported brand for ${camera.id}.`);
    if (typeof camera.name !== 'string' || !camera.name.trim() || typeof camera.room !== 'string') {
      throw new Error(`Camera ${camera.id} needs a room string and a name.`);
    }
    if (camera.port !== undefined && (!Number.isInteger(camera.port) || camera.port < 1 || camera.port > 65535)) {
      throw new Error(`Invalid RTSP port for ${camera.id}.`);
    }
    return { id: camera.id, ip: camera.ip, room: camera.room, name: camera.name,
      brand: camera.brand, port: camera.port || 554 };
  }).sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }) ||
    Number(a.ip.split('.').at(-1)) - Number(b.ip.split('.').at(-1)));
}

export function streamConfig(cameras, username, password, port) {
  const auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`;
  const streams = {};
  for (const camera of cameras) {
    for (const quality of ['sub', 'main']) {
      const path = camera.brand === 'reolink'
        ? `/h264Preview_01_${quality}`
        : `/cam/realmonitor?channel=1&subtype=${quality === 'sub' ? 1 : 0}`;
      streams[`${camera.id}_${quality}`] = [`rtsp://${auth}@${camera.ip}:${camera.port}${path}`];
    }
  }
  // JSON is valid YAML; go2rtc accepts this as its YAML configuration.
  // Only the dashboard proxies browser traffic. Other go2rtc listeners are disabled.
  return { api: { listen: `127.0.0.1:${port}`, origin: '' }, rtsp: { listen: '' },
    webrtc: { listen: '' }, log: { level: 'error' }, streams };
}

export function streamName(rawURL, cameras) {
  const url = new URL(rawURL, 'http://localhost');
  if (url.pathname !== '/stream/api/ws') return null;
  const name = url.searchParams.get('src');
  return cameras.some(camera => name === `${camera.id}_sub` || name === `${camera.id}_main`) ? name : null;
}

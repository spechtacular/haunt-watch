import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCameras, streamConfig, streamName } from '../config.mjs';

const camera = { id: 'entrance', room: '00', name: 'Entrance', ip: '10.168.20.29', brand: 'amcrest' };
test('camera validation rejects duplicates, invalid IPs and unsupported brands', () => {
  assert.throws(() => validateCameras([camera, camera]), /unique/);
  assert.throws(() => validateCameras([{ ...camera, ip: '10.168.20.xxx' }]), /IPv4/);
  assert.throws(() => validateCameras([{ ...camera, brand: 'unknown' }]), /brand/);
  assert.equal(validateCameras([{ ...camera, enabled: false }]).length, 0);
  assert.equal(validateCameras([camera])[0].room, '00');
});
test('SD and HD stream mapping encodes passwords and keeps admin listeners local', () => {
  const config = streamConfig(validateCameras([camera, { ...camera, id: 'reolink', brand: 'reolink' }]), 'admin', 'a#b@c:?&', 1984);
  assert.equal(config.api.listen, '127.0.0.1:1984');
  assert.equal(config.rtsp.listen, '');
  assert.equal(config.webrtc.listen, '');
  assert.match(config.streams.entrance_sub[0], /subtype=1$/);
  assert.match(config.streams.entrance_main[0], /subtype=0$/);
  assert.match(config.streams.reolink_sub[0], /h264Preview_01_sub$/);
  assert.match(config.streams.reolink_main[0], /h264Preview_01_main$/);
  assert.match(config.streams.entrance_sub[0], /a%23b%40c%3A%3F%26@/);
});
test('only configured stream names can enter the proxy', () => {
  assert.equal(streamName('/stream/api/ws?src=entrance_sub', [camera]), 'entrance_sub');
  assert.equal(streamName('/stream/api/ws?src=rtsp://attacker', [camera]), null);
  assert.equal(streamName('/api/streams?src=entrance_sub', [camera]), null);
});

import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// FLV timestamps are explicit; raw H.264 does not carry presentation timestamps.
export function parseTestClip(data) {
  if (data.toString('ascii', 0, 3) !== 'FLV') throw new Error('Invalid FLV test clip.');
  const headerEnd = data.readUInt32BE(5) + 4;
  const groups = new Map();
  for (let offset = headerEnd; offset + 15 <= data.length;) {
    const size = data.readUIntBE(offset + 1, 3);
    const end = offset + 11 + size + 4;
    if (end > data.length) throw new Error('Truncated FLV test clip.');
    const timestamp = data.readUIntBE(offset + 4, 3) + data[offset + 7] * 0x1000000;
    // Keep AVC configuration and video data. Skip metadata and end-of-sequence.
    if (data[offset] === 9 && size >= 2 && data[offset + 12] !== 2) {
      if (!groups.has(timestamp)) groups.set(timestamp, []);
      groups.get(timestamp).push(data.subarray(offset, end));
    }
    offset = end;
  }
  const frames = [...groups].map(([timestamp, tags]) => ({ timestamp, tags }));
  if (frames.length < 2) throw new Error('Test clip contains too few video frames.');
  return { header: data.subarray(0, headerEnd), frames, duration: frames.at(-1).timestamp + 100 };
}

export function frameBytes(frame, loopOffset) {
  return Buffer.concat(frame.tags.map(tag => {
    const bytes = Buffer.from(tag);
    const timestamp = frame.timestamp + loopOffset;
    bytes.writeUIntBE(timestamp % 0x1000000, 4, 3);
    bytes[7] = Math.floor(timestamp / 0x1000000) & 0xff;
    return bytes;
  }));
}

export async function startTestVideo(root) {
  const sources = [];
  try {
    for (const quality of ['sub', 'main']) {
      const clip = parseTestClip(await readFile(join(root, 'fixtures', `test-${quality}.flv`)));
      const sockets = new Set();
      const timers = new Set();
      const server = net.createServer(socket => {
        sockets.add(socket);
        let index = 0;
        let loopOffset = 0;
        socket.write(clip.header);
        const send = () => {
          if (socket.destroyed) return;
          if (socket.writableLength < 1024 * 1024) {
            socket.write(frameBytes(clip.frames[index], loopOffset));
            if (++index === clip.frames.length) { index = 0; loopOffset += clip.duration; }
          }
        };
        send();
        const timer = setInterval(send, 100); // Both clips are encoded at 10 fps.
        timers.add(timer);
        socket.on('error', () => socket.destroy());
        socket.on('close', () => { clearInterval(timer); timers.delete(timer); sockets.delete(socket); });
      });
      await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
      sources.push({ quality, url: `tcp://127.0.0.1:${server.address().port}`,
        close: () => { for (const timer of timers) clearInterval(timer); for (const socket of sockets) socket.destroy(); server.close(); } });
    }
    return { urls: Object.fromEntries(sources.map(source => [source.quality, source.url])),
      close() { for (const source of sources) source.close(); } };
  } catch (error) { for (const source of sources) source.close(); throw error; }
}

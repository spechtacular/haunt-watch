#!/usr/bin/env node
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const config = JSON.parse(readFileSync(process.argv.at(-1), 'utf8'));
const port = Number(config.api.listen.split(':').at(-1));
const server = http.createServer((req, res) => {
  if (req.url === '/video-rtc.js') res.writeHead(200, { 'Content-Type': 'text/javascript' }).end('// fake player module for proxy tests');
  else res.writeHead(404).end();
});
server.on('upgrade', (req, socket) => {
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const payload = Buffer.from(req.url);
  socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
  // Close frames need an unmasked server response.
  socket.on('data', data => { if ((data[0] & 0x0f) === 8) socket.end(Buffer.from([0x88, 0])); });
  socket.on('error', () => {});
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => process.exit(0));

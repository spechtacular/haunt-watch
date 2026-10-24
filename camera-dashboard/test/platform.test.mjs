import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { streamerPlatform, powershellLiteral, streamerLaunch } from '../platform.mjs';
import { parseTestClip, frameBytes } from '../sample-video.mjs';

test('platform downloads match official Windows, macOS and Linux assets', () => {
  assert.deepEqual(streamerPlatform('win32', 'x64'), { asset: 'go2rtc_win64.zip', executable: 'go2rtc.exe', archive: true });
  assert.equal(streamerPlatform('win32', 'arm64').asset, 'go2rtc_win_arm64.zip');
  assert.equal(streamerPlatform('darwin', 'arm64').asset, 'go2rtc_mac_arm64.zip');
  assert.equal(streamerPlatform('darwin', 'x64').asset, 'go2rtc_mac_amd64.zip');
  assert.equal(streamerPlatform('linux', 'x64').asset, 'go2rtc_linux_amd64');
  assert.equal(streamerPlatform('linux', 'arm64').archive, false);
  assert.throws(() => streamerPlatform('win32', 'ia32'), /Supported platforms/);
});
test('Windows extraction quotes spaces and apostrophes without a shell', () => {
  assert.equal(powershellLiteral("C:\\Users\\Ted's PC\\go2rtc.zip"), "'C:\\Users\\Ted''s PC\\go2rtc.zip'");
  const launch = streamerLaunch('C:\\Program Files\\Haunt Watch\\go2rtc.exe', 'C:\\Haunt Watch\\config.yaml');
  assert.equal(launch.command, 'C:\\Program Files\\Haunt Watch\\go2rtc.exe');
  assert.deepEqual(launch.args, ['-config', 'C:\\Haunt Watch\\config.yaml']);
  assert.equal(streamerLaunch('fake.mjs', 'config.yaml').command, process.execPath);
});
test('bundled test video timestamps advance across loop boundaries', async () => {
  for (const quality of ['sub', 'main']) {
    const bytes = await readFile(new URL(`../fixtures/test-${quality}.flv`, import.meta.url));
    const clip = parseTestClip(bytes);
    assert.equal(clip.frames.length, 30);
    assert.equal(clip.duration, 3000);
    const repeated = frameBytes(clip.frames[0], clip.duration);
    assert.equal(repeated.readUIntBE(4, 3) + repeated[7] * 0x1000000, 3000);
  }
  assert.throws(() => parseTestClip(Buffer.from('not video')), /Invalid FLV/);
});

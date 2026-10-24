import { mkdir, writeFile, chmod, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const version = 'v1.9.14';
const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
if (!arch || !['darwin', 'linux'].includes(process.platform)) {
  throw new Error('Supported platforms: macOS and Linux, Intel/AMD 64-bit or ARM64.');
}
const assetName = process.platform === 'darwin' ? `go2rtc_mac_${arch}.zip` : `go2rtc_linux_${arch}`;
const headers = { 'User-Agent': 'haunt-camera-wall-installer' };
const metadata = await fetch(`https://api.github.com/repos/AlexxIT/go2rtc/releases/tags/${version}`, { headers });
if (!metadata.ok) throw new Error(`GitHub release request failed (${metadata.status}).`);
const release = await metadata.json();
const asset = release.assets.find(item => item.name === assetName);
if (!asset) throw new Error(`Release asset ${assetName} was not found.`);
console.log(`Downloading go2rtc ${version} for ${process.platform}/${process.arch}…`);
const response = await fetch(asset.browser_download_url, { headers });
if (!response.ok) throw new Error(`Download failed (${response.status}).`);
const data = Buffer.from(await response.arrayBuffer());
if (asset.digest?.startsWith('sha256:') && asset.digest !== `sha256:${createHash('sha256').update(data).digest('hex')}`) {
  throw new Error('Download checksum did not match the GitHub release digest.');
}
const temporary = await mkdtemp(join(tmpdir(), 'haunt-go2rtc-'));
try {
  await mkdir(join(root, 'bin'), { recursive: true });
  const destination = join(root, 'bin/go2rtc');
  if (process.platform === 'darwin') {
    const archive = join(temporary, 'go2rtc.zip');
    await writeFile(archive, data);
    execFileSync('/usr/bin/unzip', ['-q', archive, '-d', temporary]);
    await copyFile(join(temporary, 'go2rtc'), destination);
  } else {
    await writeFile(destination, data);
  }
  await chmod(destination, 0o755);
  console.log(`Installed: ${destination}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

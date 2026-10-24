import { mkdir, writeFile, chmod, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { streamerPlatform, powershellLiteral } from './platform.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const version = 'v1.9.14';
const platform = streamerPlatform();
const assetName = platform.asset;
const headers = { 'User-Agent': 'haunt-camera-wall-installer' };
const apiHeaders = { ...headers };
if (process.env.GITHUB_TOKEN) apiHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const metadata = await fetch(`https://api.github.com/repos/AlexxIT/go2rtc/releases/tags/${version}`, {
  headers: apiHeaders, signal: AbortSignal.timeout(30000),
});
if (!metadata.ok) throw new Error(`GitHub release request failed (${metadata.status}).`);
const release = await metadata.json();
const asset = release.assets.find(item => item.name === assetName);
if (!asset) throw new Error(`Release asset ${assetName} was not found.`);
console.log(`Downloading go2rtc ${version} for ${process.platform}/${process.arch}…`);
const response = await fetch(asset.browser_download_url, { headers, signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error(`Download failed (${response.status}).`);
const data = Buffer.from(await response.arrayBuffer());
if (asset.digest?.startsWith('sha256:') && asset.digest !== `sha256:${createHash('sha256').update(data).digest('hex')}`) {
  throw new Error('Download checksum did not match the GitHub release digest.');
}
const temporary = await mkdtemp(join(tmpdir(), 'haunt-go2rtc-'));
try {
  await mkdir(join(root, 'bin'), { recursive: true });
  const destination = join(root, 'bin', platform.executable);
  if (platform.archive) {
    const archive = join(temporary, 'go2rtc.zip');
    await writeFile(archive, data);
    if (process.platform === 'win32') {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath ${powershellLiteral(archive)} -DestinationPath ${powershellLiteral(temporary)} -Force`],
      { windowsHide: true });
    } else {
      execFileSync('/usr/bin/unzip', ['-q', archive, '-d', temporary]);
    }
    await copyFile(join(temporary, platform.executable), destination);
  } else {
    await writeFile(destination, data);
  }
  if (process.platform !== 'win32') await chmod(destination, 0o755);
  console.log(`Installed: ${destination}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

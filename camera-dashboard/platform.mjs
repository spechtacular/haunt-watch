import { extname } from 'node:path';

export function streamerPlatform(platform = process.platform, architecture = process.arch) {
  const arch = { x64: 'amd64', arm64: 'arm64' }[architecture];
  if (!arch || !['darwin', 'linux', 'win32'].includes(platform)) {
    throw new Error('Supported platforms: macOS, Linux and Windows 11 on x64 or ARM64.');
  }
  return {
    asset: platform === 'win32'
      ? architecture === 'x64' ? 'go2rtc_win64.zip' : 'go2rtc_win_arm64.zip'
      : platform === 'darwin' ? `go2rtc_mac_${arch}.zip` : `go2rtc_linux_${arch}`,
    executable: platform === 'win32' ? 'go2rtc.exe' : 'go2rtc',
    archive: platform !== 'linux',
  };
}

export function powershellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function streamerLaunch(binary, configPath) {
  // Test fixtures are JavaScript programs; Windows cannot execute a Unix shebang.
  return ['.mjs', '.js'].includes(extname(binary).toLowerCase())
    ? { command: process.execPath, args: [binary, '-config', configPath] }
    : { command: binary, args: ['-config', configPath] };
}

# Haunt Camera Wall

A local browser dashboard for macOS and Linux. Uses Node.js and go2rtc, with no npm packages or cloud services required. The included 23 cameras follow the latest room/IP map in `camera-scan.sh`.

The wall starts with muted substreams, supports 4/9/16/all-camera layouts, room/IP search, paging, pause/resume, reconnect, and fullscreen. Click a tile for the main-stream inspector; switch between SD and HD there. Offline feeds retry automatically. It pauses connections when the browser tab is hidden.

## Requirements

- Node.js **22.9 or newer**, including npm, on macOS or Linux.
- For live video: the server computer can reach the cameras on the LAN, with RTSP enabled (normally port 554).
- A current Safari, Chrome, Firefox, or Edge browser with MediaSource/ManagedMediaSource support. Use **H.264** for both camera streams for broad browser compatibility. H.265 availability depends on the browser and hardware; this app does not transcode.

## Preview without cameras

```bash
cd camera-dashboard
npm run demo
```

Open **http://127.0.0.1:8088**. Preview tiles are labeled placeholders; no video, credentials, or camera connections are simulated. No go2rtc download is needed for preview.

## Set up live video (macOS and Linux)

```bash
cd camera-dashboard
npm run install:streamer
cp .env.example .env
```

The installer downloads the pinned official go2rtc **v1.9.14** binary for the current platform (macOS Intel/Apple Silicon or Linux AMD64/ARM64). macOS extraction uses the built-in `unzip`. No administrator privileges are needed. You can also download go2rtc yourself and set `GO2RTC_BIN` to its absolute path.

Edit `.env` and set your shared camera credentials:

```dotenv
CAMERA_USERNAME=admin
CAMERA_PASSWORD="your camera password"
```

Quote passwords containing `#` so Node's environment-file parser preserves them. Existing exported `AMCREST_USERNAME`/`AMCREST_PASSWORD` variables are accepted as fallbacks. Do not put passwords in `cameras.json`.

Review `cameras.json`: the supplied room list did not identify manufacturers, so entries initially use `"brand": "amcrest"`. Change each Reolink entry to `"brand": "reolink"`. These are configured addresses, not a fresh network scan. Placeholder `.xxx` addresses are omitted.

Then start:

```bash
npm start
```

Open **http://127.0.0.1:8088**. Stop with **Ctrl+C**. The app starts and stops its own go2rtc process. It rejects an occupied go2rtc port rather than attaching to an unrelated service.

## Camera configuration

Edit `cameras.json`, or copy it to ignored `cameras.local.json` and set `CAMERAS_FILE=cameras.local.json` in `.env`. Restart the app after changes.

```json
{
  "id": "camera_29",
  "room": "00",
  "name": "Entrance",
  "ip": "10.168.20.29",
  "brand": "amcrest",
  "enabled": true
}
```

- `id` must be unique and contain only letters, numbers, underscores, or hyphens.
- Preserve room numbers as strings to keep their leading zero.
- `brand`: `amcrest` (also suitable for Dahua) or `reolink`.
- Optional `port`: RTSP port; defaults to 554.
- `enabled: false` excludes a camera.
- Amcrest: `/cam/realmonitor?channel=1&subtype=1` for SD and `subtype=0` for HD.
- Reolink: `/h264Preview_01_sub` for SD and `/h264Preview_01_main` for HD. Model support varies.

The app encodes special characters in RTSP credentials. Each camera currently shares the same username and password. No microphone, recording, or cloud-upload features are enabled in the dashboard.

## View from another computer on the LAN

Set in `.env`:

```dotenv
HOST=0.0.0.0
PORT=8088
DASHBOARD_PASSWORD="choose a dashboard password"
```

Restart and open `http://SERVER_LAN_IP:8088` on the viewing device. Sign in with username **operator** and the dashboard password. Allow inbound TCP port 8088 through the server's firewall if needed. Video travels over the same HTTP/WebSocket connection, so no browser-facing RTSP or WebRTC ports are needed.

This HTTP mode is intended for a trusted LAN. Use an HTTPS reverse proxy or VPN for untrusted networks; do not expose the app directly to the internet. Camera credentials remain on the server. Its generated go2rtc configuration is owner-readable in ignored `.runtime/`, and removed on normal shutdown. After an unclean shutdown it may remain there until deleted. The go2rtc administration API is loopback-only and is not proxied to browsers.

## Troubleshooting

- **Offline:** confirm the IP, manufacturer, credentials, and RTSP port. HTTP port 80 being open does not establish RTSP availability.
- **SD works but HD fails:** set the camera's main stream to H.264, then retry. An unsupported H.265 stream is not automatically transcoded.
- **Connecting but no video:** confirm the selected stream is enabled and H.264. Offline detection waits about 15 seconds without video progress, then reconnects.
- **Too many feeds for a device:** use 4 or 9 tiles per page. `All` opens every camera at once; browser decoding capacity and bandwidth vary.
- **Port occupied:** change `PORT` or `GO2RTC_PORT` in `.env`.
- **Safari:** use a current version. Video is muted for autoplay; if playback is blocked, allow autoplay for the dashboard in Safari's website settings.

## Tests

```bash
npm test
```

Automated tests cover camera configuration, credentials, stream selection, HTTP access control, static serving, and WebSocket proxying against an isolated fake streamer. Live camera playback still needs verification on the camera network. The same source and commands support macOS and Linux; Linux runtime verification requires a Linux host.

References: [go2rtc](https://github.com/AlexxIT/go2rtc), [Amcrest RTSP](https://support.amcrest.com/hc/en-us/articles/360059019972-Accessing-Amcrest-Products-Using-RTSP), [Reolink RTSP](https://support.reolink.com/articles/900000630706-Introduction-to-RTSP/).

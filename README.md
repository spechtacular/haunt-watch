# Haunt Watch

A local camera wall and camera inventory scanner for The Haunt in Atascadero.

## Camera dashboard

Runs on macOS and Linux with Node.js 22.9 or newer and go2rtc.

```bash
cd camera-dashboard
npm run demo
```

Open http://127.0.0.1:8088 for a preview without cameras. For live video, install the streamer with `npm run install:streamer`, copy `.env.example` to `.env`, set camera credentials, and run `npm start`.

See [the full dashboard setup guide](camera-dashboard/README.md) for camera configuration, LAN viewing, and troubleshooting.

## Camera scanner

```bash
bash camera-scan.sh cameras.csv 10.168.20.0/24 snapshots
```

Requires nmap and Python 3. Discovers devices, assigns Haunt room labels, captures Amcrest/Reolink snapshots, and optionally uploads them to Google Drive with shared viewer links in the CSV.

Camera credentials use `AMCREST_USERNAME` and `AMCREST_PASSWORD`. Optional Drive uploads use `GOOGLE_DRIVE_FOLDER_ID` and either `GOOGLE_DRIVE_ACCESS_TOKEN` or the three OAuth variables `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN`.

Credentials, captured images, scan inventories, downloaded binaries, and generated stream configuration are excluded from source control.

## Tests

```bash
cd camera-dashboard
npm test
```

Live camera playback requires access to the camera subnet. The room map is site-specific and camera manufacturers should be reviewed before live use.

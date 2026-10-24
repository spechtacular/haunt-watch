# Windows 11: test Haunt Watch at home

No camera-subnet access or camera passwords are needed for these checks.

## 1. Get the app

Install Node.js LTS (version 22.9 or newer) from https://nodejs.org/. Close and reopen your terminal after installation. Sign in to GitHub, open https://github.com/spechtacular/haunt-watch, choose **Code > Download ZIP**, then **Extract All** in File Explorer. Keep the extracted project in your own user directory.

Open the extracted `camera-dashboard` folder. Right-click inside it and choose **Open in Terminal**, or open PowerShell and use `cd` to enter that folder.

Check Node:

```powershell
node --version
npm.cmd --version
```

Use `npm.cmd` in PowerShell so the setup does not depend on allowing PowerShell npm scripts. No administrator terminal is needed.

## 2. Install the Windows streamer and run automated tests

```powershell
npm.cmd run install:streamer
npm.cmd test
```

The installer selects the official Windows x64 or ARM64 go2rtc binary and extracts it with built-in PowerShell. The tests run real SD/HD video through go2rtc without reaching any cameras.

Expected: all tests pass, with no skipped real-streamer or synthetic-video tests after installation.

## 3. Test the layout

```powershell
npm.cmd run demo
```

Open **http://127.0.0.1:8088** in Edge or Chrome. This mode shows the 23 mapped cameras as placeholders. Check room search, layouts, paging, and fullscreen. Stop the server with **Ctrl+C** before starting a different mode.

## 4. Test real moving video without cameras

```powershell
npm.cmd run test:video
```

Open **http://127.0.0.1:8088**. The banner must say **TEST VIDEO MODE**. There should be four moving generated color/test patterns; these are not camera footage.

Check:

- All four feeds move and show **TEST VIDEO** after connecting.
- Click a tile: its inspector starts in HD (640 x 360).
- Switch to SD (320 x 180), then back to HD; video continues.
- Close the inspector and try pause/resume and reconnect.
- Enter fullscreen and leave with Escape.
- Leave it running for several minutes; patterns loop every three seconds.
- Press Ctrl+C. Refreshing the browser should now fail to connect, confirming the server stopped. Start it again and verify the video returns.

A pass here confirms your Windows installation, streamer, media proxy, and browser decoding work together. It does not verify the actual camera codecs, login credentials, RTSP settings, or haunt network.

## 5. Prepare for the haunt

```powershell
Copy-Item .env.example .env
notepad .env
```

Set `CAMERA_USERNAME` and `CAMERA_PASSWORD`. Review `cameras.json`: Entrance (`10.168.20.29`) and Exit (`10.168.20.27`) are configured as Reolink. If you use `cameras.local.json`, check the brands in that private copy too. Keep both camera streams set to H.264 for broad browser support.

Once connected to the camera subnet:

```powershell
npm.cmd start
```

You can view it on this computer using loopback without sharing it across the LAN. For other viewing computers, follow the password-protected LAN setup in `camera-dashboard/README.md` and allow inbound TCP 8088 on Windows Firewall's private-network profile.

## If something fails

- **Cannot connect to server:** keep the terminal running and use `http://127.0.0.1:8088`, not HTTPS. Read any `Startup failed` message.
- **Port already in use:** stop the other demo/live/test instance with Ctrl+C.
- **Node/npm not found:** reinstall Node with the PATH option, then reopen the terminal.
- **Windows streamer fails to install:** copy the exact installer error; no camera credentials are involved.
- **Tests pass, browser video fails:** try both Edge and Chrome. Report the browser version, the visible tile status, and any error from the terminal.

The separate `camera-scan.sh` scanner is not a native Windows tool yet. It is not needed to run the dashboard.

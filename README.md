# Haunt Watch

A local camera dashboard for The Haunt in Atascadero, with a separate camera inventory scanner. The dashboard runs on **Windows 11, macOS, and Linux** (x64 or ARM64). The app runs in a terminal and you view it in a web browser.

## 1. Install from GitHub

1. Install [Node.js LTS](https://nodejs.org/) with npm. The app requires Node.js **22.9 or newer**. Close and reopen Terminal or PowerShell after installation.
2. Sign in to GitHub and open [spechtacular/haunt-watch](https://github.com/spechtacular/haunt-watch). Your account needs access to this private repository.
3. Click **Code → Download ZIP**. Extract the ZIP completely; on Windows use **Extract All**. Keep the project in your own user directory.
4. Open the extracted `haunt-watch-main` folder, then open `camera-dashboard` in Terminal. On Windows, right-click inside `camera-dashboard` in File Explorer and choose **Open in Terminal**.

If you already use Git, you can clone instead:

```bash
git clone https://github.com/spechtacular/haunt-watch.git
cd haunt-watch/camera-dashboard
```

Git may ask you to authenticate to access the private repository. Do not put an access token in the clone URL.

Check the installation:

| macOS / Linux Terminal | Windows PowerShell |
| --- | --- |
| `node --version` | `node --version` |
| `npm --version` | `npm.cmd --version` |

**Run all commands below from the `camera-dashboard` folder.** There are no npm dependencies to install, so `npm install` is not needed. PowerShell examples use `npm.cmd` to avoid npm script execution-policy problems. An administrator terminal is not required.

## 2. Choose how to run

| Mode | Purpose | Camera subnet / passwords | go2rtc required |
| --- | --- | --- | --- |
| Standalone preview | Room labels, layouts, search, and rearranging with placeholders | No | No |
| Standalone video test | Four moving generated feeds through the real video player | No | Yes |
| Live cameras | Video from the configured Amcrest / Reolink cameras | Yes | Yes |

All modes open at **http://127.0.0.1:8088** on the computer running the app. **Keep the terminal running.** Opening `camera-dashboard/public/index.html` directly as a `file://` page will not run the app; use the HTTP address instead.

Run one mode at a time. Press **Ctrl+C** in its terminal to stop it before starting another mode. The app starts and stops its own go2rtc process when that mode needs video.

## 3. Run standalone preview

No configuration or camera connection is needed.

**macOS / Linux:**

```bash
npm run demo
```

**Windows PowerShell:**

```powershell
npm.cmd run demo
```

Open **http://127.0.0.1:8088**. The banner says **PREVIEW MODE** and the 23 configured cameras appear as placeholders. Test search, layouts, paging, fullscreen, and camera ordering. This mode does not display moving video.

## 4. Run standalone moving video

Install the streamer once, then start the video test.

**macOS / Linux:**

```bash
npm run install:streamer
npm test
npm run test:video
```

**Windows PowerShell:**

```powershell
npm.cmd run install:streamer
npm.cmd test
npm.cmd run test:video
```

The installer downloads the pinned official [go2rtc](https://github.com/AlexxIT/go2rtc) binary for your operating system and architecture. Internet access is needed for this download. After installation, the generated video test runs locally without the camera subnet, credentials, FFmpeg, or cloud services.

Open **http://127.0.0.1:8088**. The banner says **TEST VIDEO MODE**. Check that:

- Four generated test patterns move continuously.
- Clicking a feed opens its HD inspector; SD and HD switching works.
- Pause/resume, reconnect, fullscreen, and dragging camera handles work.
- Your camera order survives refreshing the page.
- Video continues for several minutes. Stop with Ctrl+C, restart the command, and confirm the video returns.

This checks your local streamer, video proxy, and browser playback. Actual camera credentials, codecs, and network access still need checking at the haunt. See the [Windows home-test checklist](camera-dashboard/WINDOWS.md) for more details.

## 5. Configure live cameras

First install the streamer if you have not already done so, then create your private settings file.

**macOS / Linux:**

```bash
npm run install:streamer
cp .env.example .env
cp cameras.json cameras.local.json
```

**Windows PowerShell:**

```powershell
npm.cmd run install:streamer
Copy-Item .env.example .env
Copy-Item cameras.json cameras.local.json
notepad .env
```

Only copy the example files during initial setup; copying them again replaces your saved settings. Edit `.env` with a text editor:

```dotenv
CAMERA_USERNAME=admin
CAMERA_PASSWORD="your shared camera password"
CAMERAS_FILE=cameras.local.json
HOST=127.0.0.1
PORT=8088
DASHBOARD_PASSWORD=
```

Use your actual shared camera username/password. Amcrest and Reolink currently use the same credentials in this app. Quote the password, especially if it contains `#`. Keep credentials in `.env`, which Git ignores; do not add them to the camera list or commit them to GitHub. Existing exported environment variables take precedence over `.env`.

Edit `cameras.local.json`. It is a JSON array; each camera looks like this:

```json
{
  "id": "camera_29",
  "room": "00",
  "name": "Entrance",
  "ip": "10.168.20.29",
  "brand": "reolink",
  "enabled": true
}
```

- Keep each `id` unique. Use only letters, numbers, underscores, and hyphens.
- Keep `room` as a quoted string to preserve leading zeros.
- Set the correct IP and brand: `"amcrest"` or `"reolink"`. The supplied Entrance (`10.168.20.29`) and Exit (`10.168.20.27`) entries use Reolink; the others use Amcrest. Check these brands in existing private copies as well.
- Set `"enabled": false` to hide a camera. An optional `"port"` sets its RTSP port; the default is **554**.
- Preserve valid JSON: double-quoted keys/strings, commas between camera objects, and no trailing commas or comments.

On the cameras, enable RTSP and use **H.264 for both main and substreams**. The dashboard uses RTSP for live video; Amcrest's HTTP port 80 web interface is separate. The computer running the app must be able to reach the cameras on the haunt network. The supplied room/IP list is configuration, not an automatic scan.

`npm start` loads `.env`. The standalone `demo` and `test:video` commands use their built-in defaults and do not automatically load `.env`.

## 6. Run live mode

Connect the computer to the camera network, then run:

**macOS / Linux:**

```bash
npm start
```

**Windows PowerShell:**

```powershell
npm.cmd start
```

Open **http://127.0.0.1:8088** in a current Edge, Chrome, Safari (macOS), or Firefox browser. The grid uses muted SD substreams. Click a feed for the HD inspector. Restart the app after editing `.env` or the camera JSON file. Press **Ctrl+C** to stop.

### View from other computers on the same LAN

For live mode, change these `.env` settings on the computer running Haunt Watch:

```dotenv
HOST=0.0.0.0
PORT=8088
DASHBOARD_PASSWORD="choose a dashboard password"
```

Restart the app. On another device, open `http://SERVER_LAN_IP:8088`, replacing `SERVER_LAN_IP` with the address of the computer running Haunt Watch. Sign in as **operator**, using `DASHBOARD_PASSWORD`. This is separate from the camera login.

Allow inbound TCP **8088** through that computer's firewall if needed. On Windows, allow it on the **private network** profile. Viewing on the server computer itself with `HOST=127.0.0.1` does not require LAN sharing. This HTTP setup is for a trusted LAN; use a VPN or HTTPS reverse proxy for access over untrusted networks. Do not expose it directly to the internet.

## Camera pages and sizing

Choose **1–6 cameras per page** in the toolbar. The default is six, and the selection is saved in your browser. Use the **Page** selector to jump directly to a page or the arrow buttons to move backward/forward. Pages follow your saved camera order and the current search/filter.

Tiles resize to fit the cameras actually on the page: a final page with only three cameras uses one row of three on desktop, even if the page size is six. Desktop pages use the available window height; **Full screen** gives the camera views more space. Video keeps its proportions. Narrow screens use fewer columns.

## Arrange your camera wall

Drag a camera's **⠿ handle** onto another tile. Choose **1–6 cameras per page**; browse with the page selector or arrow buttons. Dragging rearranges cameras on the current page. Video keeps playing during the move. You can also focus a handle with Tab and use the arrow keys.

The layout saves automatically in the current browser for that dashboard address; it does not sync between computers or browsers. **Reset room order** restores the original room/name order. Standalone test-video order is stored separately from the real camera wall.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Browser cannot connect | Start a mode in Terminal and keep it running. Use `http://127.0.0.1:8088`, not HTTPS or the HTML file. Read any terminal startup error. |
| Node/npm command not found | Install Node.js with npm and reopen the terminal. On Windows, check that Node is on PATH. |
| PowerShell blocks npm | Use `npm.cmd` as shown above. |
| Port already in use | Stop the other app instance with Ctrl+C. In live mode you can change `PORT` or `GO2RTC_PORT` in `.env`; use the new dashboard port in the browser. |
| Camera offline | Check subnet access, IP, brand, shared credentials, RTSP, and H.264. Port 80 being open does not establish RTSP access. |
| SD works but HD fails | Check that the camera's main stream is also H.264. The app does not transcode H.265. |
| Video slows with many feeds | Choose fewer cameras per page (1–6) to reduce bandwidth and decoding load. |
| Changes to settings do not appear | Stop and restart live mode. Refresh the browser after updating application files. |

See the [dashboard reference](camera-dashboard/README.md) for stream URLs, runtime files, and additional details.

## Update an existing installation

If you cloned with Git, stop the app and run `git pull` in the repository folder, then return to `camera-dashboard` and restart it. If you installed from ZIP, download and extract the latest ZIP into a new folder, then copy your existing `.env` and `cameras.local.json` into its `camera-dashboard` folder. Run the streamer installer in the new folder and start your chosen mode. Keep your private settings out of GitHub.

## Optional camera inventory scanner

The separate `camera-scan.sh` requires Bash, nmap, and Python 3; it is not a native Windows dashboard requirement. From the repository root on macOS/Linux:

```bash
bash camera-scan.sh cameras.csv 10.168.20.0/24 snapshots
```

It discovers devices, assigns Haunt room labels, captures Amcrest/Reolink snapshots, and optionally uploads them to Google Drive with shared viewer links in the CSV. Camera credentials use `AMCREST_USERNAME` and `AMCREST_PASSWORD`. Optional Drive uploads use `GOOGLE_DRIVE_FOLDER_ID` and either `GOOGLE_DRIVE_ACCESS_TOKEN` or `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN`.

Credentials, captured images, inventories, downloaded binaries, and generated stream configuration are excluded from source control.

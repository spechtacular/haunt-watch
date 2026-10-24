#!/bin/bash

# Camera inventory scanner for macOS.
# Usage: bash camera-scan.sh [output.csv] [subnet] [snapshot-directory]
# Example: bash camera-scan.sh inventory.csv 10.168.20.0/24 snapshots
# Optional environment variables: AMCREST_USERNAME, AMCREST_PASSWORD.
# Both camera brands use HTTP on port 80 for snapshots.
# Existing snapshots are replaced only after a successful JPEG download.
# Optional Drive uploads: GOOGLE_DRIVE_FOLDER_ID plus either
# GOOGLE_DRIVE_ACCESS_TOKEN, or GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
# and GOOGLE_REFRESH_TOKEN. Use OAuth credentials, not your Google password.
# Uploaded images are shared with anyone who has the link.

set -euo pipefail

OUTPUT_FILE="${1:-cameras.csv}"
SUBNET="${2:-10.168.20.0/24}"
SNAPSHOT_DIR="${3:-snapshots}"
PORTS="80,81,443,554,1935,8000,9000,37777"

for dependency in nmap python3; do
    if ! command -v "$dependency" >/dev/null 2>&1; then
        echo "Missing required command: $dependency" >&2
        exit 1
    fi
done

XML_FILE="$(mktemp "${TMPDIR:-/tmp/}camera_scan.XXXXXX")"
trap 'rm -f "$XML_FILE"' EXIT

echo "Camera Network Inventory"
echo "------------------------"
echo "Network:   $SUBNET"
echo "Ports:     $PORTS"
echo "Output:    $OUTPUT_FILE"
echo "Snapshots: $SNAPSHOT_DIR"
echo

sudo nmap -sS -R -p "$PORTS" -oX "$XML_FILE" "$SUBNET"

python3 - "$XML_FILE" "$OUTPUT_FILE" "$SNAPSHOT_DIR" <<'PYTHON'
import csv
import getpass
import ipaddress
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET

xml_file, output_file, snapshot_directory = sys.argv[1:]
PORTS = [80, 81, 443, 554, 1935, 8000, 9000, 37777]
HEADERS = [
    "Browser URL", "Haunt Room ID / Name", "Snapshot",
    "MAC Address", "Manufacturer", "Device Type",
    "80 HTTP", "81 Blue Iris", "443 HTTPS", "554 RTSP",
    "1935 RTMP", "8000 ONVIF", "9000 Reolink", "37777 Amcrest",
]

# Browser URL -> Haunt Room ID / Name.
# Keep leading zeros and allow multiple cameras to share a room.
ROOM_BY_BROWSER_URL = {
    "http://10.168.20.29": "00 / Entrance",
    "http://10.168.20.24": "01 / Bayou",
    "http://10.168.20.25": "01 / Bayou",
    "http://10.168.20.11": "02 / CrossedMen",
    # 03 / Elevator: http://10.168.20.xxx (IP not assigned)
    "http://10.168.20.104": "04 / ElevatorExit",
    "http://10.168.20.26": "05 / PriceOfPassage",
    "http://10.168.20.21": "06 / Tavern",
    "http://10.168.20.41": "07 / Bilge(Knockers)",
    "http://10.168.20.14": "08 / Barrel",
    "http://10.168.20.16": "09 / CaptainQ",
    "http://10.168.20.102": "10 / Curio",
    # 11 / Armory: http://10.168.20.xxx (IP not assigned)
    "http://10.168.20.36": "12 / ShipDeck",
    "http://10.168.20.33": "13 / UnderH2O",
    "http://10.168.20.22": "14 / Sirens(Bungee)",
    "http://10.168.20.15": "15 / FogWall",
    # 16 / BodyBags: http://10.168.20.xxx (IP not assigned)
    "http://10.168.20.18": "17 / Dungeon",
    "http://10.168.20.28": "17 / Dungeon",
    "http://10.168.20.23": "18 / Muriel",
    "http://10.168.20.40": "18 / Muriel",
    "http://10.168.20.20": "19 / Plank(Whisper Hall)",
    "http://10.168.20.34": "20 / Still",
    "http://10.168.20.27": "21 / Exit",
    "http://10.168.20.17": "22 / Makeup : Backstage",
}


def identify_brand(manufacturer, hostname, open_ports):
    vendor = manufacturer.lower()
    host = hostname.lower()
    if "reolink" in vendor or "reolink" in host:
        return "Reolink"
    if "amcrest" in vendor or "amcrest" in host:
        return "Amcrest"
    if "dahua" in vendor or "dahua" in host:
        return "Dahua / Amcrest OEM"
    if "blueiris" in host or "blue-iris" in host:
        return "Possible Blue Iris"
    if 9000 in open_ports and 1935 in open_ports:
        return "Possible Reolink"
    if 37777 in open_ports:
        return "Possible Amcrest/Dahua"
    return "Unknown"


def identify_device_type(manufacturer, hostname, brand, open_ports):
    vendor = manufacturer.lower()
    compact_vendor = "".join(character for character in vendor if character.isalnum())
    name = hostname.lower().replace("-", " ").replace("_", " ").replace(".", " ")
    words = set(name.split())
    if any(vendor_name in compact_vendor for vendor_name in ("tplink", "cisco", "netgear")):
        return "Network device"
    if "computer" in vendor or "computer" in name:
        return "Server"
    if "blue iris" in name or "blueiris" in name:
        return "Server"
    if words & {"router", "switch", "gateway", "firewall", "ap", "wap"}:
        return "Network device"
    if words & {"nvr", "dvr"}:
        return "Video recorder (probable)"
    if words & {"server", "nas"}:
        return "Server"
    if words & {"camera", "cam", "doorbell"}:
        return "Camera"
    if any(camera_brand in brand.lower() for camera_brand in ("amcrest", "dahua", "reolink")):
        return "Camera"
    if 554 in open_ports:
        return "Video device (possible)"
    return "Unknown"


def get_browser_url(ip, open_ports):
    if 80 in open_ports:
        return f"http://{ip}"
    if 81 in open_ports:
        return f"http://{ip}:81"
    if 443 in open_ports:
        return f"https://{ip}"
    return ""


def take_snapshot(device, username, password, directory):
    ip = device["ip"]
    if 80 not in device["ports"]:
        print(f"Snapshot skipped: {ip} (HTTP port 80 is not open)")
        return False

    base = f"http://{ip}"
    if "reolink" in device["brand"].lower():
        # Try the logical-channel API, then the older physical-channel API.
        common = {
            "cmd": "Snap", "rs": uuid.uuid4().hex,
            "user": username, "password": password,
        }
        variants = [
            {"channel": 1, "iLogicChannel": 1, "snapType": "main"},
            {"channel": 0},
        ]
        urls = [
            base + "/cgi-bin/api.cgi?" + urllib.parse.urlencode({**common, **variant})
            for variant in variants
        ]
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    else:
        urls = [f"{base}/cgi-bin/snapshot.cgi?channel=1"]
        credentials = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        credentials.add_password(None, base + "/", username, password)
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPDigestAuthHandler(credentials),
        )

    errors = []
    for url in urls:
        temporary_path = None
        try:
            request = urllib.request.Request(url, headers={"Accept": "image/jpeg"})
            with opener.open(request, timeout=15) as response:
                data = response.read(20 * 1024 * 1024 + 1)
            if len(data) > 20 * 1024 * 1024:
                raise ValueError("snapshot exceeds 20 MB")
            if not data.startswith(b"\xff\xd8\xff") or not data.rstrip().endswith(b"\xff\xd9"):
                raise ValueError("response is not a complete JPEG; check credentials and API support")
            with tempfile.NamedTemporaryFile(dir=directory, suffix=".tmp", delete=False) as file:
                temporary_path = Path(file.name)
                file.write(data)
            destination = directory / f"{ip}.jpg"
            os.replace(temporary_path, destination)
            print(f"Snapshot saved: {destination}")
            return True
        except urllib.error.HTTPError as error:
            errors.append(f"HTTP {error.code}")
        except ValueError as error:
            errors.append(str(error))
        except Exception as error:
            # Do not print request URLs: Reolink URLs contain credentials.
            errors.append(type(error).__name__)
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
    print(f"Snapshot failed: {ip} ({'; '.join(errors)})", file=sys.stderr)
    return False


class DriveClient:
    API = "https://www.googleapis.com/drive/v3"

    def __init__(self, folder_id):
        if not folder_id or any(not (c.isalnum() or c in "_-") for c in folder_id):
            raise ValueError("GOOGLE_DRIVE_FOLDER_ID must contain the folder ID, not its URL")
        self.folder_id = folder_id
        self.access_token = os.environ.get("GOOGLE_DRIVE_ACCESS_TOKEN", "")
        self.expires_at = float("inf")
        self.refresh_values = {
            "client_id": os.environ.get("GOOGLE_CLIENT_ID", ""),
            "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET", ""),
            "refresh_token": os.environ.get("GOOGLE_REFRESH_TOKEN", ""),
            "grant_type": "refresh_token",
        }
        self.can_refresh = all(self.refresh_values.values())
        if not self.access_token and not self.can_refresh:
            raise ValueError(
                "Set GOOGLE_DRIVE_ACCESS_TOKEN or all three OAuth refresh variables: "
                "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN"
            )

    def token(self):
        if self.access_token and time.monotonic() < self.expires_at:
            return self.access_token
        request = urllib.request.Request(
            "https://oauth2.googleapis.com/token",
            data=urllib.parse.urlencode(self.refresh_values).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
        self.access_token = result["access_token"]
        self.expires_at = time.monotonic() + max(1, int(result.get("expires_in", 3600)) - 60)
        return self.access_token

    def request(self, method, url, payload=None, content_type="application/json", raw=False):
        data = payload if raw or payload is None else json.dumps(payload).encode()
        for attempt in range(2):
            request = urllib.request.Request(
                url, data=data, method=method,
                headers={
                    "Authorization": f"Bearer {self.token()}",
                    "Content-Type": content_type,
                },
            )
            try:
                return urllib.request.urlopen(request, timeout=90)
            except urllib.error.HTTPError as error:
                if error.code == 401 and attempt == 0 and self.can_refresh:
                    error.close()
                    self.access_token = ""
                    continue
                raise

    def json_request(self, method, path, payload=None, **params):
        url = self.API + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        with self.request(method, url, payload) as response:
            data = response.read()
        return json.loads(data) if data else {}

    def upload(self, path):
        # Match by exact filename within the selected folder; update existing files.
        result = self.json_request(
            "GET", "/files",
            q=f"'{self.folder_id}' in parents and name = '{path.name}' and trashed = false",
            fields="files(id,mimeType),nextPageToken", pageSize=2,
            supportsAllDrives="true", includeItemsFromAllDrives="true",
        )
        matches = result.get("files", [])
        if len(matches) > 1 or result.get("nextPageToken"):
            raise ValueError("multiple Drive files have this IP filename; remove duplicates first")
        if matches and matches[0].get("mimeType") != "image/jpeg":
            raise ValueError("existing Drive file has this name but is not a JPEG")

        metadata = {"name": path.name, "mimeType": "image/jpeg"}
        file_id = matches[0]["id"] if matches else None
        if file_id:
            suffix = "/" + urllib.parse.quote(file_id, safe="")
            method = "PATCH"
        else:
            suffix = ""
            method = "POST"
            metadata["parents"] = [self.folder_id]

        # A resumable upload works for both small and large snapshots.
        start_url = "https://www.googleapis.com/upload/drive/v3/files" + suffix
        start_url += "?uploadType=resumable&supportsAllDrives=true&fields=id"
        with self.request(method, start_url, metadata) as response:
            upload_url = response.headers.get("Location", "")
        parsed = urllib.parse.urlsplit(upload_url)
        if parsed.scheme != "https" or parsed.netloc != "www.googleapis.com":
            raise ValueError("unexpected Google upload session URL")
        with self.request("PUT", upload_url, path.read_bytes(), "image/jpeg", raw=True) as response:
            uploaded = json.load(response)
        file_id = uploaded["id"]
        file_path = "/files/" + urllib.parse.quote(file_id, safe="")

        # Reuse inherited public access, otherwise grant anyone-with-link viewing.
        page_token = ""
        public = False
        while True:
            params = {
                "fields": "permissions(type,role),nextPageToken",
                "supportsAllDrives": "true",
                "pageSize": 100,
            }
            if page_token:
                params["pageToken"] = page_token
            result = self.json_request("GET", file_path + "/permissions", **params)
            public = public or any(
                permission.get("type") == "anyone"
                and permission.get("role") in ("reader", "commenter", "writer")
                for permission in result.get("permissions", [])
            )
            page_token = result.get("nextPageToken", "")
            if public or not page_token:
                break
        if not public:
            self.json_request(
                "POST", file_path + "/permissions",
                {"type": "anyone", "role": "reader", "allowFileDiscovery": False},
                supportsAllDrives="true",
            )
        result = self.json_request(
            "GET", file_path, fields="webViewLink", supportsAllDrives="true",
        )
        link = result.get("webViewLink", "")
        if not link:
            raise ValueError("Google did not return an image viewer link")
        return link


def write_inventory(devices):
    with open(output_file, "w", newline="", encoding="utf-8-sig") as file:
        writer = csv.writer(file)
        writer.writerow(HEADERS)
        for device in devices:
            browser_url = get_browser_url(device["ip"], device["ports"])
            writer.writerow([
                browser_url, ROOM_BY_BROWSER_URL.get(browser_url, ""),
                device.get("snapshot_link", ""),
                device["mac"], device["manufacturer"], device["type"],
                *("Open" if port in device["ports"] else "" for port in PORTS),
            ])


devices = []
for host in ET.parse(xml_file).getroot().findall("host"):
    status = host.find("status")
    if status is None or status.get("state") != "up":
        continue
    ip, mac, manufacturer = "", "", ""
    for address in host.findall("address"):
        if address.get("addrtype") == "ipv4":
            ip = address.get("addr", "")
        elif address.get("addrtype") == "mac":
            mac = address.get("addr", "")
            manufacturer = address.get("vendor", "")
    if not ip:
        continue
    hostname = next(
        (entry.get("name") for entry in host.findall("hostnames/hostname") if entry.get("name")),
        "",
    )
    open_ports = set()
    for port in host.findall("ports/port"):
        state = port.find("state")
        if port.get("protocol") == "tcp" and state is not None and state.get("state") == "open":
            open_ports.add(int(port.get("portid")))
    brand = identify_brand(manufacturer, hostname, open_ports)
    devices.append({
        "ip": ip, "mac": mac, "manufacturer": manufacturer,
        "brand": brand, "ports": open_ports,
        "type": identify_device_type(manufacturer, hostname, brand, open_ports),
    })

devices.sort(key=lambda device: ipaddress.ip_address(device["ip"]))
write_inventory(devices)

print(f"\nInventory saved to: {output_file}")
print(f"Devices discovered: {len(devices)}")
print(f"Devices with scanned ports open: {sum(bool(d['ports']) for d in devices)}")
print("Device types and snapshot candidates are estimates based on scan results.")

candidates = [
    device for device in devices
    if device["type"] == "Camera"
    and any(brand in device["brand"].lower() for brand in ("amcrest", "dahua", "reolink"))
]
if not candidates:
    print("No probable Amcrest/Dahua/Reolink cameras found for snapshots.")
    sys.exit(0)

username = os.environ.get("AMCREST_USERNAME")
password = os.environ.get("AMCREST_PASSWORD")
if username is None or password is None:
    try:
        with open("/dev/tty", "r+") as terminal:
            if username is None:
                terminal.write("Amcrest/Reolink username [admin]: ")
                terminal.flush()
                entered = terminal.readline()
                if not entered:
                    raise EOFError("no username input")
                username = entered.strip() or "admin"
            if password is None:
                password = getpass.getpass("Amcrest/Reolink password: ", stream=terminal)
    except (OSError, EOFError):
        print("Cannot prompt for credentials. Set AMCREST_USERNAME and AMCREST_PASSWORD.", file=sys.stderr)
        print("Inventory was saved; snapshots were skipped.", file=sys.stderr)
        sys.exit(1)

directory = Path(snapshot_directory)
directory.mkdir(parents=True, exist_ok=True)
drive = None
failures = 0
folder_id = os.environ.get("GOOGLE_DRIVE_FOLDER_ID", "")
if folder_id:
    try:
        drive = DriveClient(folder_id)
        print("Google Drive uploads enabled; images will be shared with anyone who has the link.")
    except ValueError as error:
        print(f"Google Drive configuration error: {error}", file=sys.stderr)
        failures += 1
else:
    print("Google Drive uploads disabled: GOOGLE_DRIVE_FOLDER_ID is not set.")

print(f"\nTaking snapshots from {len(candidates)} probable Amcrest/Dahua/Reolink cameras...")
successful = 0
uploaded = 0
try:
    for device in candidates:
        if not take_snapshot(device, username, password, directory):
            failures += 1
            continue
        successful += 1
        if drive is None:
            continue
        try:
            device["snapshot_link"] = drive.upload(directory / f"{device['ip']}.jpg")
            uploaded += 1
            print(f"Drive image linked: {device['ip']}")
        except urllib.error.HTTPError as error:
            print(f"Drive upload/share failed: {device['ip']} (HTTP {error.code}); Snapshot left blank.", file=sys.stderr)
            failures += 1
        except Exception as error:
            # Avoid logging tokens or OAuth responses.
            print(f"Drive upload/share failed: {device['ip']} ({type(error).__name__}); Snapshot left blank.", file=sys.stderr)
            failures += 1
finally:
    write_inventory(devices)
    print(f"Inventory updated: {output_file}")
print(f"Snapshots saved: {successful}/{len(candidates)}")
print(f"Drive links written: {uploaded}")
if failures:
    sys.exit(1)
PYTHON

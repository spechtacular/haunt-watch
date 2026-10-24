import { restoreOrder, moveCamera } from './order.js';

const $ = selector => document.querySelector(selector);
const state = { cameras: [], demo: true, testVideo: false, page: 0, size: '9', query: '', filter: 'all', paused: false, statuses: new Map(), players: new Set(), focusPlayer: null };
try { state.size = localStorage.getItem('haunt-grid') || '9'; } catch { /* Storage can be unavailable in private windows. */ }
if (!['4', '9', '16', 'all'].includes(state.size)) state.size = '9';
$('#layout').value = state.size;
let VideoClass;
let defaultCameras = [];
let draggedId = null;
let orderKey = 'haunt-camera-order';

function clearDrag() {
  draggedId = null;
  document.querySelectorAll('.camera-card').forEach(card => card.classList.remove('dragging', 'drop-before', 'drop-after'));
}
function saveOrder(message) {
  try {
    localStorage.setItem(orderKey, JSON.stringify(state.cameras.map(camera => camera.id)));
    $('#order-status').textContent = `${message} Saved in this browser.`;
  } catch {
    $('#order-status').textContent = `${message} Browser storage is unavailable; this order lasts until you reload.`;
  }
}
function reorder(sourceId, targetId) {
  if (sourceId === targetId) return;
  state.cameras = moveCamera(state.cameras, sourceId, targetId);
  // CSS order preserves the existing video elements and their connections.
  state.cameras.forEach((camera, index) => {
    const card = document.getElementById(`tile-${camera.id}`);
    if (card) card.style.order = index;
  });
  const camera = state.cameras.find(item => item.id === sourceId);
  saveOrder(`Moved ${camera.room} / ${camera.name}.`);
}
$('#reset-order').addEventListener('click', () => {
  clearDrag();
  state.cameras = [...defaultCameras];
  state.page = 0;
  saveOrder('Room order restored.');
  renderGrid();
});
document.addEventListener('dragend', clearDrag);
document.addEventListener('drop', clearDrag);

function notice(message, error = false) {
  $('#notice').hidden = false;
  $('#notice').classList.toggle('error', error);
  $('#notice').textContent = message;
}
function updateClock() {
  $('#clock').textContent = new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
updateClock();
setInterval(updateClock, 1000);

function status(camera, value, message = '') {
  state.statuses.set(camera.id, value);
  const card = document.getElementById(`tile-${camera.id}`);
  if (card) {
    card.dataset.status = value;
    const badge = card.querySelector('.camera-status');
    badge.className = `camera-status ${value}`;
    badge.textContent = value === 'live' && state.testVideo ? 'TEST VIDEO' : { preview: 'PREVIEW', connecting: 'CONNECTING', live: 'LIVE', offline: 'OFFLINE', paused: 'PAUSED' }[value];
    badge.title = message;
  }
  updateCounts();
}
function updateCounts() {
  const live = [...state.statuses.values()].filter(value => value === 'live').length;
  const offline = [...state.statuses.values()].filter(value => value === 'offline').length;
  $('#live-count').textContent = live;
  $('#offline-count').textContent = offline;
  $('#attention-badge').textContent = offline;
  $('#live-description').textContent = state.paused ? 'Video paused' : state.demo ? 'Preview · no live connections' : state.testVideo ? 'Synthetic video only' : 'Visible feeds only';
}
function placeholder(camera, label = 'Preview · no camera connection') {
  const element = document.createElement('div');
  element.className = 'feed-placeholder';
  element.innerHTML = '<span class="feed-corner tl"></span><span class="feed-corner br"></span><span class="placeholder-icon">◈</span><strong></strong><small></small>';
  element.querySelector('strong').textContent = `ROOM ${camera.room}`;
  element.querySelector('small').textContent = label;
  return element;
}

async function setupPlayer() {
  const { VideoRTC } = await import('/stream/video-rtc.js');
  class HauntVideo extends VideoRTC {
    constructor() {
      super();
      this.mode = 'mse';
      this.media = 'video';
      this.visibilityCheck = false;
      this.RECONNECT_TIMEOUT = 6000;
      this.DISCONNECT_TIMEOUT = 0;
      this.stopped = false;
      this.lastProgress = Date.now();
      this.lastTime = -1;
      this.healthTimer = null;
    }
    report(value, detail = '') { this.dispatchEvent(new CustomEvent('feedstate', { detail: { value, message: detail } })); }
    oninit() {
      super.oninit();
      this.video.controls = false;
      this.video.muted = true;
      this.video.addEventListener('timeupdate', () => {
        if (this.video.currentTime === this.lastTime) return;
        this.lastTime = this.video.currentTime;
        this.lastProgress = Date.now();
        this.report('live');
      });
      this.healthTimer = setInterval(() => {
        if (this.stopped || !this.isConnected || document.hidden) return;
        if (Date.now() - this.lastProgress > 15000) {
          this.report('offline', 'No video frames received. Retrying automatically.');
          if (this.ws) this.ws.close();
        }
      }, 5000);
    }
    onconnect() {
      if (this.stopped) return false;
      const started = super.onconnect();
      if (started) this.report('connecting');
      return started;
    }
    onopen() {
      const modes = super.onopen();
      this.onmessage.wall = message => {
        if (message.type === 'error') this.report('offline', 'Stream unavailable. Check camera credentials, RTSP and H.264 settings.');
      };
      if (!modes.length) this.report('offline', 'This browser does not support MediaSource video.');
      return modes;
    }
    onclose() {
      if (!this.stopped) this.report('offline', 'Connection closed. Retrying automatically.');
      return super.onclose();
    }
    stop() {
      this.stopped = true;
      clearInterval(this.healthTimer);
      clearTimeout(this.reconnectTID);
      clearTimeout(this.disconnectTID);
      this.reconnectTID = 0;
      this.disconnectTID = 0;
      if (this.video) this.ondisconnect();
    }
  }
  customElements.define('haunt-video', HauntVideo);
  VideoClass = HauntVideo;
}

function attachFeed(container, camera, quality, onStatus) {
  container.replaceChildren();
  if (state.demo || state.paused || !VideoClass) {
    const value = state.paused ? 'paused' : state.demo ? 'preview' : 'offline';
    container.append(placeholder(camera, state.paused ? 'Video paused' : state.demo ? 'Preview · no camera connection' : 'Streaming service unavailable'));
    onStatus(value);
    return null;
  }
  const player = new VideoClass();
  player.addEventListener('feedstate', event => onStatus(event.detail.value, event.detail.message));
  container.append(player);
  player.src = `/stream/api/ws?src=${encodeURIComponent(`${camera.id}_${quality}`)}`;
  return player;
}
function stopGrid() {
  for (const player of state.players) player.stop();
  state.players.clear();
  // Preserve last-known offline statuses so the attention filter remains useful.
  for (const [id, value] of state.statuses) if (value !== 'offline') state.statuses.delete(id);
}
function filtered() {
  const query = state.query.toLowerCase().trim();
  return state.cameras.filter(camera =>
    `${camera.room} ${camera.name} ${camera.ip}`.toLowerCase().includes(query) &&
    (state.filter !== 'offline' || state.statuses.get(camera.id) === 'offline'));
}
function renderGrid() {
  stopGrid();
  const matches = filtered();
  const count = state.size === 'all' ? Math.max(matches.length, 1) : Number(state.size);
  const pages = Math.max(1, Math.ceil(matches.length / count));
  state.page = Math.max(0, Math.min(state.page, pages - 1));
  const visible = matches.slice(state.page * count, (state.page + 1) * count);
  $('#grid').replaceChildren();
  $('#grid').style.gridTemplateColumns = `repeat(${state.size === '4' ? 2 : state.size === '16' || state.size === 'all' ? 4 : 3},minmax(0,1fr))`;
  for (const camera of visible) {
    const card = document.createElement('article');
    card.className = 'camera-card';
    card.id = `tile-${camera.id}`;
    card.style.order = state.cameras.indexOf(camera);
    card.innerHTML = '<div class="camera-top"><button class="drag-handle" draggable="true" type="button">⠿</button><div class="camera-title"><span class="room-tag"></span><span class="camera-name"></span></div><span class="camera-status"></span></div><div class="feed" role="button" tabindex="0"><span class="feed-overlay">Inspect camera ↗</span></div><div class="camera-bottom"><span class="camera-ip"></span><span class="stream-label">SD · SUBSTREAM</span></div>';
    const handle = card.querySelector('.drag-handle');
    handle.setAttribute('aria-label', `Move ${camera.room} / ${camera.name}, ${camera.ip}`);
    handle.title = 'Drag to rearrange. Arrow keys move this camera before or after another visible camera.';
    handle.addEventListener('dragstart', event => {
      draggedId = camera.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', camera.id);
      card.classList.add('dragging');
      $('#order-status').textContent = `Drop ${camera.room} / ${camera.name} onto another camera to move it.`;
    });
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const ordered = filtered().filter(item => document.getElementById(`tile-${item.id}`));
      const index = ordered.findIndex(item => item.id === camera.id);
      const direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
      const target = ordered[index + direction];
      if (target) reorder(camera.id, target.id);
    });
    card.addEventListener('dragover', event => {
      if (!draggedId || draggedId === camera.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.drop-before,.drop-after').forEach(item => item.classList.remove('drop-before', 'drop-after'));
      card.classList.add(state.cameras.findIndex(item => item.id === draggedId) < state.cameras.indexOf(camera) ? 'drop-after' : 'drop-before');
    });
    card.addEventListener('dragleave', event => {
      if (!card.contains(event.relatedTarget)) card.classList.remove('drop-before', 'drop-after');
    });
    card.addEventListener('drop', event => {
      if (!draggedId) return;
      event.preventDefault();
      reorder(draggedId, camera.id);
      clearDrag();
    });
    card.querySelector('.room-tag').textContent = camera.room;
    card.querySelector('.camera-name').textContent = camera.name;
    card.querySelector('.camera-ip').textContent = camera.ip;
    const feed = card.querySelector('.feed');
    feed.setAttribute('aria-label', `Inspect ${camera.room} / ${camera.name}, ${camera.ip}`);
    feed.addEventListener('click', () => openFocus(camera));
    feed.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFocus(camera); } });
    $('#grid').append(card);
    const player = attachFeed(feed, camera, 'sub', (value, detail) => status(camera, value, detail));
    if (player) state.players.add(player);
    const overlay = document.createElement('span');
    overlay.className = 'feed-overlay';
    overlay.textContent = 'Inspect camera ↗';
    feed.append(overlay);
  }
  $('#empty').hidden = visible.length > 0;
  $('#page-label').textContent = matches.length ? `Showing ${state.page * count + 1}–${state.page * count + visible.length} of ${matches.length} cameras` : '0 cameras match your filters';
  $('#page-count').textContent = `${state.page + 1} / ${pages}`;
  $('#previous').disabled = state.page === 0;
  $('#next').disabled = state.page >= pages - 1;
  updateCounts();
}
let focused;
function refreshFocus() {
  if (!focused) return;
  state.focusPlayer?.stop();
  state.focusPlayer = attachFeed($('#focus-feed'), focused, $('#quality').value, (value, detail) => {
    $('#focus-status').textContent = detail || (value === 'live' && state.testVideo ? 'Synthetic test video · no camera connection' : { preview: 'Preview mode · no camera connection', paused: 'Video paused', live: 'Live video', connecting: 'Connecting…', offline: 'Offline · retrying' }[value]);
  });
}
function openFocus(camera) {
  focused = camera;
  $('#focus-title').textContent = `${camera.room} / ${camera.name}`;
  $('#focus-ip').textContent = state.testVideo ? 'Generated H.264 test pattern · no camera connection' : `${camera.ip} · ${camera.brand === 'amcrest' ? 'Amcrest' : 'Reolink'}`;
  $('#quality').value = 'main';
  $('#focus-dialog').showModal();
  refreshFocus();
}
$('#focus-dialog').addEventListener('close', () => { state.focusPlayer?.stop(); state.focusPlayer = null; $('#focus-feed').replaceChildren(); focused = null; });
$('#close-focus').addEventListener('click', () => $('#focus-dialog').close());
$('#focus-dialog').addEventListener('click', event => { if (event.target === $('#focus-dialog')) $('#focus-dialog').close(); });
$('#quality').addEventListener('change', refreshFocus);

function resetFilters() {
  state.query = '';
  state.filter = 'all';
  state.page = 0;
  $('#search').value = '';
  document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('selected', button.dataset.filter === 'all'));
  renderGrid();
}
$('#wall-nav').addEventListener('click', resetFilters);
$('#clear-search').addEventListener('click', resetFilters);
$('#search').addEventListener('input', event => { state.query = event.target.value; state.page = 0; renderGrid(); });
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  state.page = 0;
  document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('selected', item === button));
  renderGrid();
}));
$('#layout').addEventListener('change', event => {
  state.size = event.target.value;
  state.page = 0;
  try { localStorage.setItem('haunt-grid', state.size); } catch { /* Optional preference. */ }
  renderGrid();
});
$('#previous').addEventListener('click', () => { state.page--; renderGrid(); });
$('#next').addEventListener('click', () => { state.page++; renderGrid(); });
$('#reconnect').addEventListener('click', () => { renderGrid(); refreshFocus(); });
$('#pause').addEventListener('click', () => {
  state.paused = !state.paused;
  const label = state.paused ? 'Resume all video' : 'Pause all video';
  $('#pause').textContent = state.paused ? '▷' : 'Ⅱ';
  $('#pause').setAttribute('aria-label', label);
  $('#pause').title = label;
  $('#pause').classList.toggle('is-paused', state.paused);
  renderGrid();
  refreshFocus();
});
$('#fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else notice('This browser does not support page fullscreen. Use the browser’s fullscreen command.');
  } catch { notice('Fullscreen was unavailable. Use the browser’s fullscreen command.'); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopGrid(); state.focusPlayer?.stop(); }
  else { renderGrid(); refreshFocus(); }
});
window.addEventListener('pagehide', () => { stopGrid(); state.focusPlayer?.stop(); });

try {
  const response = await fetch('/api/cameras');
  if (!response.ok) throw new Error('Camera configuration request failed.');
  const data = await response.json();
  defaultCameras = [...data.cameras];
  state.cameras = [...defaultCameras];
  // Keep the generated home-test layout separate from the real camera wall.
  orderKey = data.testVideo ? 'haunt-test-camera-order' : 'haunt-camera-order';
  try { state.cameras = restoreOrder(defaultCameras, JSON.parse(localStorage.getItem(orderKey))); }
  catch { /* Ignore malformed or unavailable optional browser preferences. */ }
  state.demo = data.demo;
  state.testVideo = data.testVideo;
  for (const id of ['#total-count', '#nav-count', '#all-badge', '#directory-count']) $(id).textContent = state.cameras.length;
  const groups = new Map();
  for (const camera of defaultCameras) {
    const key = `${camera.room} / ${camera.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(camera);
  }
  for (const cameras of groups.values()) {
    const camera = cameras[0];
    const item = document.createElement('button');
    item.className = 'directory-item';
    item.innerHTML = '<span class="room-number"></span><span class="room-title"></span><span class="camera-number"></span>';
    item.querySelector('.room-number').textContent = camera.room;
    item.querySelector('.room-title').textContent = camera.name;
    item.querySelector('.camera-number').textContent = cameras.length;
    item.title = `${camera.room} / ${camera.name}`;
    item.addEventListener('click', () => openFocus(camera));
    $('#directory').append(item);
  }
  if (state.demo) notice('PREVIEW MODE — Room labels and layouts are ready. These are placeholders, not live camera feeds. Start the app with camera credentials to connect.');
  else {
    if (state.testVideo) notice('TEST VIDEO MODE — Generated moving video runs through go2rtc and the dashboard player. No cameras or camera credentials are used. SD is 320 × 180; HD is 640 × 360.');
    try { await setupPlayer(); }
    catch { notice('The streaming player could not load. Restart the server and check that go2rtc is running.', true); }
  }
  renderGrid();
} catch (error) {
  notice(`Unable to load the camera wall. ${error.message}`, true);
  $('#page-label').textContent = 'Unable to load cameras';
}

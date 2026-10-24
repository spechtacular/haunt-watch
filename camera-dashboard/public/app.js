import { restoreOrder, moveCamera, pageSize, cameraPage, restoreGroups, validateGroup } from './order.js';

const $ = selector => document.querySelector(selector);
const state = { cameras: [], demo: true, testVideo: false, page: 0, size: 6, query: '', filter: 'all', paused: false, statuses: new Map(), players: new Set(), focusPlayer: null };
try { state.size = pageSize(localStorage.getItem('haunt-grid')); } catch { /* Storage can be unavailable in private windows. */ }
$('#layout').value = state.size;
let VideoClass;
let defaultCameras = [];
let draggedId = null;
let orderKey = 'haunt-camera-order';
let groupsKey = 'haunt-pages-v1';
let savedGroups = [];
let activeGroup = '';
let editingGroup = null;
let selectedCameras = new Set();

function currentGroup() { return savedGroups.find(group => group.id === activeGroup); }
function wallCameras() {
  const group = currentGroup();
  return group ? group.cameras.map(id => state.cameras.find(camera => camera.id === id)).filter(Boolean) : state.cameras;
}
function persistGroups(message) {
  try {
    localStorage.setItem(groupsKey, JSON.stringify(savedGroups));
    localStorage.setItem(`${groupsKey}-active`, activeGroup);
    $('#order-status').textContent = `${message} Saved in this browser.`;
  } catch { $('#order-status').textContent = `${message} Browser storage is unavailable; changes last until you reload.`; }
}
function groupControls() {
  const automatic = new Option('All cameras · automatic pages', '');
  $('#group-select').replaceChildren(automatic, ...savedGroups.map(group => new Option(`${group.name} (${group.cameras.length}/6)`, group.id)));
  $('#group-select').value = activeGroup;
  $('#edit-group').disabled = !currentGroup();
  $('#layout').disabled = Boolean(currentGroup());
  $('#layout').closest('label').hidden = Boolean(currentGroup());
  $('#layout').title = currentGroup() ? 'Custom pages show their assigned cameras, up to six. Use Edit page to change them.' : '';
  $('#reset-order').textContent = currentGroup() ? 'Reset page order' : 'Reset room order';
}
function selectGroup(id) {
  activeGroup = savedGroups.some(group => group.id === id) ? id : '';
  state.page = 0;
  state.query = '';
  state.filter = 'all';
  $('#search').value = '';
  document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('selected', button.dataset.filter === 'all'));
  groupControls();
  persistGroups(currentGroup() ? `Viewing ${currentGroup().name}.` : 'Viewing automatic pages.');
  renderGrid();
}
function selectionCount() {
  $('#group-count').textContent = `${selectedCameras.size} / 6 cameras selected`;
  $('#group-picker').querySelectorAll('input').forEach(input => {
    input.disabled = selectedCameras.size >= 6 && !input.checked;
  });
}
function renderPicker() {
  const query = $('#group-search').value.toLowerCase().trim();
  const cameras = defaultCameras.filter(camera => `${camera.room} ${camera.name} ${camera.ip}`.toLowerCase().includes(query));
  $('#group-picker').replaceChildren(...cameras.map(camera => {
    const label = document.createElement('label');
    label.className = 'camera-choice';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = camera.id;
    input.checked = selectedCameras.has(camera.id);
    const text = document.createElement('span');
    text.textContent = `${camera.room} / ${camera.name} · ${camera.ip}`;
    label.append(input, text);
    input.addEventListener('change', () => {
      if (input.checked && selectedCameras.size < 6) selectedCameras.add(camera.id);
      else { selectedCameras.delete(camera.id); input.checked = false; }
      $('#group-error').textContent = '';
      selectionCount();
    });
    return label;
  }));
  $('#group-no-results').hidden = cameras.length > 0;
  selectionCount();
}
function openGroupEditor(group = null) {
  editingGroup = group?.id || null;
  selectedCameras = new Set(group?.cameras || []);
  $('#group-title').textContent = group ? 'Edit camera page' : 'Create camera page';
  $('#group-name').value = group?.name || '';
  $('#group-search').value = '';
  $('#group-error').textContent = '';
  $('#delete-group').hidden = !group;
  $('#delete-confirm').hidden = true;
  renderPicker();
  $('#group-dialog').showModal();
  $('#group-name').focus();
}
$('#new-group').addEventListener('click', () => openGroupEditor());
$('#edit-group').addEventListener('click', () => openGroupEditor(currentGroup()));
$('#close-group').addEventListener('click', () => $('#group-dialog').close());
$('#cancel-group').addEventListener('click', () => $('#group-dialog').close());
$('#group-search').addEventListener('input', renderPicker);
$('#group-select').addEventListener('change', event => selectGroup(event.target.value));
$('#group-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('#group-name').value.trim();
  const cameras = [...selectedCameras];
  const error = validateGroup(name, cameras, savedGroups, editingGroup);
  if (error) { $('#group-error').textContent = error; return; }
  // Page IDs are local identifiers, not credentials; this also works on HTTP LAN URLs.
  const group = { id: editingGroup || `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, name, cameras };
  const index = savedGroups.findIndex(item => item.id === editingGroup);
  if (index < 0) savedGroups.push(group); else savedGroups[index] = group;
  $('#group-dialog').close();
  selectGroup(group.id);
});
$('#delete-group').addEventListener('click', () => { $('#delete-confirm').hidden = false; });
$('#keep-group').addEventListener('click', () => { $('#delete-confirm').hidden = true; });
$('#confirm-delete-group').addEventListener('click', () => {
  savedGroups = savedGroups.filter(group => group.id !== editingGroup);
  $('#group-dialog').close();
  selectGroup('');
});

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
  const group = currentGroup();
  if (group) group.cameras = moveCamera(wallCameras(), sourceId, targetId).map(camera => camera.id);
  else state.cameras = moveCamera(state.cameras, sourceId, targetId);
  // CSS order preserves the existing video elements and their connections.
  wallCameras().forEach((camera, index) => {
    const card = document.getElementById(`tile-${camera.id}`);
    if (card) card.style.order = index;
  });
  const camera = state.cameras.find(item => item.id === sourceId);
  if (group) persistGroups(`Moved ${camera.room} / ${camera.name} on ${group.name}.`);
  else saveOrder(`Moved ${camera.room} / ${camera.name}.`);
}
$('#reset-order').addEventListener('click', () => {
  clearDrag();
  if (currentGroup()) {
    currentGroup().cameras.sort((a, b) => defaultCameras.findIndex(camera => camera.id === a) - defaultCameras.findIndex(camera => camera.id === b));
    persistGroups('Page order restored.');
  } else { state.cameras = [...defaultCameras]; saveOrder('Room order restored.'); }
  state.page = 0;
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
  return wallCameras().filter(camera =>
    `${camera.room} ${camera.name} ${camera.ip}`.toLowerCase().includes(query) &&
    (state.filter !== 'offline' || state.statuses.get(camera.id) === 'offline'));
}
function renderGrid() {
  stopGrid();
  $('#all-badge').textContent = wallCameras().length;
  const matches = filtered();
  const group = currentGroup();
  const { size: count, pages: autoPages, page, visible } = cameraPage(matches, state.page, group ? 6 : state.size);
  const pages = group ? savedGroups.length : autoPages;
  state.page = page;
  $('#grid').replaceChildren();
  const columns = visible.length <= 3 ? Math.max(1, visible.length) : visible.length === 4 ? 2 : 3;
  $('#grid').style.setProperty('--columns', columns);
  $('#grid').style.setProperty('--tablet-columns', Math.min(columns, 2));
  $('#grid').dataset.count = visible.length;
  for (const camera of visible) {
    const card = document.createElement('article');
    card.className = 'camera-card';
    card.id = `tile-${camera.id}`;
    card.style.order = wallCameras().findIndex(item => item.id === camera.id);
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
      card.classList.add(wallCameras().findIndex(item => item.id === draggedId) < wallCameras().findIndex(item => item.id === camera.id) ? 'drop-after' : 'drop-before');
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
  $('#page-label').textContent = group ? `${group.name} · ${visible.length} of ${group.cameras.length} assigned cameras` : matches.length ? `Showing ${state.page * count + 1}–${state.page * count + visible.length} of ${matches.length} cameras` : '0 cameras match your filters';
  const pageIndex = group ? savedGroups.indexOf(group) : state.page;
  $('#page-count').textContent = `${pageIndex + 1} / ${pages}`;
  $('#page-select').replaceChildren(...Array.from({ length: pages }, (_, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = group ? savedGroups[index].name : `Page ${index + 1} of ${pages}`;
    return option;
  }));
  $('#page-select').value = pageIndex;
  $('#page-select').disabled = group ? false : !matches.length;
  $('#previous').disabled = pageIndex === 0;
  $('#next').disabled = pageIndex >= pages - 1;
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
  $('#quality').value = 'sub';
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
  state.size = pageSize(event.target.value);
  state.page = 0;
  try { localStorage.setItem('haunt-grid', state.size); } catch { /* Optional preference. */ }
  renderGrid();
});
function navigatePage(index) {
  if (currentGroup()) selectGroup(savedGroups[index].id);
  else { state.page = index; renderGrid(); }
}
$('#previous').addEventListener('click', () => navigatePage(currentGroup() ? savedGroups.indexOf(currentGroup()) - 1 : state.page - 1));
$('#next').addEventListener('click', () => navigatePage(currentGroup() ? savedGroups.indexOf(currentGroup()) + 1 : state.page + 1));
$('#page-select').addEventListener('change', event => navigatePage(Number(event.target.value)));
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
  groupsKey = data.testVideo ? 'haunt-test-pages-v1' : 'haunt-pages-v1';
  try {
    savedGroups = restoreGroups(JSON.parse(localStorage.getItem(groupsKey)), state.cameras);
    const selected = localStorage.getItem(`${groupsKey}-active`);
    if (savedGroups.some(group => group.id === selected)) activeGroup = selected;
  } catch { /* Optional browser preferences. */ }
  groupControls();
  if (currentGroup()) $('#order-status').textContent = `${currentGroup().name}: use Edit page to change its cameras. Drag handles to rearrange this page.`;
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

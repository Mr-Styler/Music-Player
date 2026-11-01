'use strict';
/* ==========================================================================
   Resonance — local music player
   --------------------------------------------------------------------------
   Storage model
   - You pick a music folder (File System Access API). The folder handle is kept
     in IndexedDB so it can be reopened, and the folder name is kept in
     localStorage ("resonance.folderPath"). Browsers never expose the full
     OS path, only the folder name.
   - Playlists, favorites and play stats live in `playlists.json` inside that
     folder. Choosing a *different* folder starts a fresh playlists.json.
   - Browsers without showDirectoryPicker (Firefox/Safari) fall back to a
     folder <input>; the same JSON is then kept in localStorage.
   ========================================================================== */

/* ---------- Config ---------- */
const AUDIO_EXT = new Set(['mp3', 'flac', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'weba', 'aiff', 'aif', 'webm']);
const LOSSLESS_EXT = new Set(['flac', 'wav', 'aiff', 'aif']);
const DATA_FILE = 'playlists.json';
const LS = {
    folder: 'resonance.folderPath',
    volume: 'resonance.volume',
    shuffle: 'resonance.shuffle',
    repeat: 'resonance.repeat',
    data: 'resonance.data',
};

/* ---------- Tiny helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad2 = (n) => String(n).padStart(2, '0');
const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
const hid = (s) => hash(s).toString(36);

function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
function fmtTotal(sec) {
    if (!sec) return '';
    const m = Math.round(sec / 60);
    if (m < 60) return `${Math.max(1, m)} min`;
    return `${Math.floor(m / 60)} hr ${m % 60} min`;
}
function relDate(ts) {
    if (!ts) return '';
    const days = Math.floor((Date.now() - ts) / 86400000);
    if (days < 1) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) { const w = Math.floor(days / 7); return `${w} week${w > 1 ? 's' : ''} ago`; }
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

/* ---------- Icons ---------- */
const ICONS = {
    wave: '<path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    library: '<path d="M4 4v16M9 4v16"/><path d="m14 5.5 6 1.5v12.5l-6-1.5z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    chevL: '<path d="m15 6-6 6 6 6"/>',
    chevR: '<path d="m9 6 6 6-6 6"/>',
    play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>',
    prev: '<path d="M19 5.5v13L8.5 12z" fill="currentColor"/><path d="M5 5v14"/>',
    next: '<path d="M5 5.5v13L15.5 12z" fill="currentColor"/><path d="M19 5v14"/>',
    shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    repeat1: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1.5v4"/>',
    heart: '<path d="M12 20s-7.5-4.6-9-9.5A5 5 0 0 1 12 6a5 5 0 0 1 9 4.5C19.5 15.4 12 20 12 20z"/>',
    more: '<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    volumeLow: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
    mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    queue: '<path d="M3 6h13M3 12h13M3 18h7"/><path d="m16 15 5 3-5 3z" fill="currentColor"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
};
const icon = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* ---------- State ---------- */
const audio = $('#audio');
const defaultData = () => ({ version: 1, updatedAt: Date.now(), playlists: [], favorites: [], stats: {} });

const state = {
    backend: 'fs', // 'fs' (File System Access) | 'input' (fallback)
    dirHandle: null,
    folderName: lsGet(LS.folder, ''),
    needsPermission: false,
    scanning: false,
    scanCount: 0,
    loaded: false,

    tracks: [],
    sorted: [],
    byId: new Map(),
    albums: [],
    albumById: new Map(),
    artists: [],
    artistById: new Map(),
    data: defaultData(),

    view: { name: 'home', id: null },
    back: [],
    fwd: [],
    query: '',
    ctx: {},

    queue: [],
    baseQueue: [],
    pos: -1,
    currentId: null,
    shuffle: lsGet(LS.shuffle) === '1',
    repeat: lsGet(LS.repeat, 'off'),
    counted: false,
    errors: 0,

    peaks: [],
};
let currentUrl = null;

const getTrack = (id) => state.byId.get(id);
const cur = () => getTrack(state.currentId);
const isFav = (id) => state.data.favorites.includes(id);
const getPl = (id) => state.data.playlists.find((p) => p.id === id);
const hasUserData = () => state.data.playlists.length > 0 || state.data.favorites.length > 0;
const playsOf = (id) => state.data.stats[id]?.plays || 0;

/* ==========================================================================
   Persistence: IndexedDB (folder handle), playlists.json, localStorage
   ========================================================================== */
function idb() {
    return new Promise((res, rej) => {
        const r = indexedDB.open('resonance', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
}
async function idbGet(k) {
    const db = await idb();
    return new Promise((res, rej) => {
        const q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
    });
}
async function idbSet(k, v) {
    const db = await idb();
    return new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}

function setFolderName(name) {
    state.folderName = name;
    lsSet(LS.folder, name);
}

function sanitizeData(raw) {
    const d = defaultData();
    if (!raw || typeof raw !== 'object') return d;
    if (Array.isArray(raw.playlists)) {
        d.playlists = raw.playlists
            .filter((p) => p && typeof p.name === 'string')
            .map((p) => ({ id: String(p.id || uid()), name: p.name, created: p.created || Date.now(), tracks: Array.isArray(p.tracks) ? p.tracks.filter((x) => typeof x === 'string') : [] }));
    }
    if (Array.isArray(raw.favorites)) d.favorites = raw.favorites.filter((x) => typeof x === 'string');
    if (raw.stats && typeof raw.stats === 'object') d.stats = raw.stats;
    return d;
}

async function readData() {
    if (state.backend === 'fs' && state.dirHandle) {
        try {
            const fh = await state.dirHandle.getFileHandle(DATA_FILE);
            const text = await (await fh.getFile()).text();
            return sanitizeData(JSON.parse(text));
        } catch {
            return defaultData();
        }
    }
    try { return sanitizeData(JSON.parse(lsGet(LS.data) || 'null')); } catch { return defaultData(); }
}

let saveTimer = null;
function saveData() {
    state.data.updatedAt = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushData, 350);
}
async function flushData() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const json = JSON.stringify(state.data, null, 2);
    if (state.backend === 'fs' && state.dirHandle) {
        try {
            const fh = await state.dirHandle.getFileHandle(DATA_FILE, { create: true });
            const w = await fh.createWritable();
            await w.write(json);
            await w.close();
        } catch (e) {
            console.error(e);
            toast('Couldn’t save playlists.json — check folder permission');
        }
    } else {
        lsSet(LS.data, json);
    }
}
window.addEventListener('beforeunload', () => { if (saveTimer) flushData(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) flushData(); });

/* ==========================================================================
   Library: folder selection, scanning, metadata
   ========================================================================== */
async function chooseFolder() {
    if (state.backend === 'fs') {
        let handle;
        try {
            handle = await window.showDirectoryPicker({ id: 'resonance-library', mode: 'readwrite' });
        } catch { return; } // cancelled
        let same = false;
        if (state.dirHandle) { try { same = await state.dirHandle.isSameEntry(handle); } catch { same = false; } }
        if (!same && hasUserData()) {
            const ok = await confirmModal('Change library folder?', 'Switching folders starts a fresh playlists.json — your current playlists and favorites will be cleared.', { confirm: 'Switch folder', danger: true });
            if (!ok) return;
        }
        state.dirHandle = handle;
        state.needsPermission = false;
        try { await idbSet('dirHandle', handle); } catch (e) { console.warn('Could not persist folder handle', e); }
        setFolderName(handle.name);
        if (!same) {
            stopPlayback();
            state.data = defaultData();
            await flushData();
        }
        await loadLibrary();
    } else {
        $('#folderInput').click();
    }
}

async function reconnect() {
    if (!state.dirHandle) return chooseFolder();
    try {
        const p = await state.dirHandle.requestPermission({ mode: 'readwrite' });
        if (p === 'granted') { state.needsPermission = false; await loadLibrary(); }
        else toast('Permission was not granted');
    } catch (e) { console.error(e); toast('Couldn’t reopen that folder'); }
}

async function walk(dir, prefix, out) {
    for await (const [name, h] of dir.entries()) {
        if (name.startsWith('.')) continue;
        if (h.kind === 'directory') {
            await walk(h, prefix + name + '/', out);
        } else if (AUDIO_EXT.has(extOf(name))) {
            try {
                const file = await h.getFile();
                out.push({ path: prefix + name, file });
                state.scanCount = out.length;
                if (out.length % 40 === 0) renderFolderCard();
            } catch { /* unreadable file */ }
        }
    }
}

async function loadLibrary() {
    state.scanning = true;
    state.scanCount = 0;
    renderAll();
    try {
        state.data = await readData();
        if (state.backend === 'fs') await flushData(); // make sure playlists.json exists
        const found = [];
        await walk(state.dirHandle, '', found);
        ingest(found);
    } catch (e) {
        console.error(e);
        toast('Couldn’t read that folder');
        state.needsPermission = true;
    }
    state.scanning = false;
    state.loaded = true;
    renderAll();
}

function ingest(entries) {
    state.tracks.forEach((t) => t.cover && URL.revokeObjectURL(t.cover));
    state.tracks = entries.map(makeTrack);
    state.byId = new Map(state.tracks.map((t) => [t.id, t]));
    // Drop references to files that no longer exist
    let changed = false;
    const keep = (id) => state.byId.has(id);
    for (const p of state.data.playlists) {
        const before = p.tracks.length;
        p.tracks = p.tracks.filter(keep);
        if (p.tracks.length !== before) changed = true;
    }
    const favBefore = state.data.favorites.length;
    state.data.favorites = state.data.favorites.filter(keep);
    if (state.data.favorites.length !== favBefore) changed = true;
    if (changed) saveData();
    buildIndexes();
    runMetaQueue(state.tracks.slice());
}

function makeTrack({ path, file }) {
    const parts = path.split('/');
    const fname = parts.pop();
    const ext = extOf(fname);
    let base = fname.replace(/\.[^.]+$/, '');
    let trackNo = 0;
    const m = base.match(/^(\d{1,3})[\s._-]+(.*)$/);
    if (m) { trackNo = parseInt(m[1], 10); base = m[2]; }
    let artist = parts.length >= 2 ? parts[parts.length - 2] : 'Unknown Artist';
    const album = parts.length >= 1 ? parts[parts.length - 1] : 'Unknown Album';
    let title = base;
    const dash = base.split(' - ');
    if (dash.length >= 2 && artist === 'Unknown Artist') { artist = dash[0].trim(); title = dash.slice(1).join(' - ').trim(); }
    return {
        id: path, file, ext, size: file.size, added: file.lastModified,
        title: title || fname, artist, albumArtist: artist, album, year: '', track: trackNo, duration: 0, cover: null,
    };
}

function sortTracks(a, b) {
    return a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album) || (a.track - b.track) || a.title.localeCompare(b.title);
}

function buildIndexes() {
    const albums = new Map(), artists = new Map();
    for (const t of state.tracks) {
        t.albumId = hid(t.albumArtist + '\u0001' + t.album);
        t.artistId = hid(t.artist);
        let a = albums.get(t.albumId);
        if (!a) { a = { id: t.albumId, name: t.album, artist: t.albumArtist, year: t.year, tracks: [] }; albums.set(t.albumId, a); }
        if (!a.year && t.year) a.year = t.year;
        a.tracks.push(t);
        let r = artists.get(t.artistId);
        if (!r) { r = { id: t.artistId, name: t.artist, tracks: [] }; artists.set(t.artistId, r); }
        r.tracks.push(t);
    }
    const byTrack = (x, y) => (x.track - y.track) || x.title.localeCompare(y.title);
    albums.forEach((a) => a.tracks.sort(byTrack));
    artists.forEach((r) => r.tracks.sort((x, y) => x.album.localeCompare(y.album) || byTrack(x, y)));
    state.sorted = state.tracks.slice().sort(sortTracks);
    state.albums = [...albums.values()].sort((a, b) => a.name.localeCompare(b.name));
    state.artists = [...artists.values()].sort((a, b) => a.name.localeCompare(b.name));
    state.albumById = albums;
    state.artistById = artists;
}

/* --- metadata (ID3 / FLAC tags, cover art, duration) --- */
function readTags(file) {
    return new Promise((res) => {
        if (!window.jsmediatags) return res(null);
        try { window.jsmediatags.read(file, { onSuccess: (r) => res(r.tags), onError: () => res(null) }); }
        catch { res(null); }
    });
}
function readDuration(file) {
    return new Promise((res) => {
        const a = new Audio();
        a.preload = 'metadata';
        const url = URL.createObjectURL(file);
        let done = false;
        const finish = (v) => { if (done) return; done = true; a.removeAttribute('src'); URL.revokeObjectURL(url); res(v); };
        a.onloadedmetadata = () => finish(isFinite(a.duration) ? a.duration : 0);
        a.onerror = () => finish(0);
        setTimeout(() => finish(0), 8000);
        a.src = url;
    });
}
async function loadMeta(t) {
    const tags = await readTags(t.file);
    if (tags) {
        if (tags.title) t.title = String(tags.title).trim() || t.title;
        if (tags.artist) t.artist = String(tags.artist).trim() || t.artist;
        t.albumArtist = t.artist;
        try { const aa = tags.TPE2 && tags.TPE2.data; if (aa) t.albumArtist = String(aa).trim() || t.artist; } catch { /* ignore */ }
        if (tags.album) t.album = String(tags.album).trim() || t.album;
        if (tags.year) t.year = String(tags.year).slice(0, 4);
        if (tags.track) { const n = parseInt(String(tags.track), 10); if (n) t.track = n; }
        const pic = tags.picture;
        if (pic && pic.data && pic.data.length) {
            try { t.cover = URL.createObjectURL(new Blob([new Uint8Array(pic.data)], { type: pic.format || 'image/jpeg' })); } catch { /* ignore */ }
        }
    }
    t.duration = await readDuration(t.file);
}

let metaRun = 0, refreshTimer = null;
async function runMetaQueue(list) {
    const token = ++metaRun;
    let i = 0;
    const worker = async () => {
        while (i < list.length && token === metaRun) {
            const t = list[i++];
            try { await loadMeta(t); } catch { /* ignore */ }
            scheduleRefresh();
        }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (token === metaRun) { clearTimeout(refreshTimer); refreshTimer = null; refreshViews(); }
}
function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => { refreshTimer = null; refreshViews(); }, 1500);
}
function refreshViews() {
    if (menuEl || document.querySelector('dialog[open]')) { scheduleRefresh(); return; }
    buildIndexes();
    renderSidebar();
    renderMain({ keepScroll: true });
    renderDockTrack();
    renderQueue();
}

/* ==========================================================================
   Playback
   ========================================================================== */
function shuffled(arr, firstId = null) {
    const rest = arr.filter((x) => x !== firstId);
    for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return firstId !== null && arr.includes(firstId) ? [firstId, ...rest] : rest;
}

function playContext(ids, startId = null) {
    ids = ids.filter((id) => state.byId.has(id));
    if (!ids.length) { toast('Nothing to play yet'); return; }
    state.baseQueue = ids.slice();
    if (state.shuffle) { state.queue = shuffled(ids, startId); state.pos = 0; }
    else { state.queue = ids.slice(); state.pos = startId ? Math.max(0, ids.indexOf(startId)) : 0; }
    playAt(state.pos);
}

function playAt(pos) {
    const id = state.queue[pos];
    const t = getTrack(id);
    if (!t) return;
    state.pos = pos;
    state.currentId = id;
    state.counted = false;
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(t.file);
    audio.src = currentUrl;
    audio.loop = state.repeat === 'one';
    audio.play().catch(() => { /* user gesture / decode errors surface via 'error' */ });
    renderDockTrack();
    updateMediaSession(t);
    updatePlayingUI();
    renderQueue();
    document.title = `${t.title} — ${t.artist} · Resonance`;
    loadPeaks(t);
}

function stopPlayback() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
    state.queue = []; state.baseQueue = []; state.pos = -1; state.currentId = null; state.peaks = [];
    document.title = 'Resonance — Local Music Player';
    renderDockTrack(); updatePlayUI(); updateProgress(); drawWave(); renderQueue();
}

function next(auto = false) {
    if (!state.queue.length) return;
    let p = state.pos + 1;
    if (p >= state.queue.length) {
        if (auto && state.repeat === 'off') {
            audio.pause(); audio.currentTime = 0; updatePlayUI(); return;
        }
        if (state.shuffle) state.queue = shuffled(state.baseQueue.length ? state.baseQueue : state.queue);
        p = 0;
    }
    playAt(p);
}
function prev() {
    if (!state.queue.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    let p = state.pos - 1;
    if (p < 0) {
        if (state.repeat === 'all') p = state.queue.length - 1;
        else { audio.currentTime = 0; return; }
    }
    playAt(p);
}
function togglePlay() {
    if (!state.currentId) {
        if (state.sorted.length) playContext(state.sorted.map((t) => t.id));
        else chooseFolder();
        return;
    }
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

function setShuffle(on) {
    if (state.shuffle === on) return;
    state.shuffle = on;
    lsSet(LS.shuffle, on ? '1' : '0');
    if (state.currentId && state.queue.length) {
        if (on) { state.queue = shuffled(state.baseQueue.length ? state.baseQueue : state.queue, state.currentId); state.pos = 0; }
        else { state.queue = state.baseQueue.slice(); state.pos = Math.max(0, state.queue.indexOf(state.currentId)); }
    }
    updateTransportUI();
    renderQueue();
}
function cycleRepeat() {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    lsSet(LS.repeat, state.repeat);
    audio.loop = state.repeat === 'one';
    updateTransportUI();
    toast(state.repeat === 'off' ? 'Repeat off' : state.repeat === 'all' ? 'Repeat all' : 'Repeat one');
}

function queueInsert(id, asNext) {
    if (state.pos < 0 || !state.queue.length) { playContext([id], id); return; }
    if (asNext) {
        state.queue.splice(state.pos + 1, 0, id);
        const bi = state.baseQueue.indexOf(state.currentId);
        state.baseQueue.splice(bi + 1, 0, id);
    } else {
        state.queue.push(id);
        state.baseQueue.push(id);
    }
    toast(asNext ? 'Playing next' : 'Added to queue');
    renderQueue();
}

audio.addEventListener('play', () => { updatePlayUI(); tick(); });
audio.addEventListener('pause', updatePlayUI);
audio.addEventListener('ended', () => { updatePlayUI(); next(true); });
audio.addEventListener('timeupdate', updateProgress);
audio.addEventListener('loadedmetadata', () => {
    updateProgress();
    const t = cur();
    if (t && isFinite(audio.duration) && !t.duration) { t.duration = audio.duration; }
});
audio.addEventListener('playing', () => {
    state.errors = 0;
    if (!state.counted && state.currentId) {
        state.counted = true;
        const s = state.data.stats[state.currentId] || (state.data.stats[state.currentId] = { plays: 0, last: 0 });
        s.plays += 1; s.last = Date.now();
        saveData();
    }
});
audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    const t = cur();
    toast(`Couldn’t play “${t ? t.title : 'track'}”`);
    state.errors += 1;
    if (state.errors <= 5 && state.queue.length > 1) setTimeout(() => next(true), 500);
});

/* ---------- Media Session (hardware keys / lock screen) ---------- */
function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch { /* unsupported */ } };
    set('play', () => audio.play());
    set('pause', () => audio.pause());
    set('previoustrack', () => prev());
    set('nexttrack', () => next(false));
    set('seekto', (d) => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
}
function updateMediaSession(t) {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title, artist: t.artist, album: t.album,
        artwork: t.cover ? [{ src: t.cover, sizes: '512x512' }] : [],
    });
}

/* ==========================================================================
   Waveform scrubber
   ========================================================================== */
const wave = $('#wave');
const canvas = $('#waveCanvas');
const wctx = canvas.getContext('2d');

function pseudoPeaks(seed, n = 240) {
    let s = seed || 1;
    const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const out = [];
    let v = 0.5;
    for (let i = 0; i < n; i++) {
        v = v * 0.7 + r() * 0.3 + 0.05;
        const env = 0.55 + 0.45 * Math.sin((i / n) * Math.PI);
        out.push(Math.min(1, Math.max(0.08, v * env * 1.1)));
    }
    return out;
}

async function computePeaks(file, n = 240) {
    if (file.size > 90 * 1024 * 1024) return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ac = new Ctx();
    try {
        const buf = await ac.decodeAudioData(await file.arrayBuffer());
        const ch = buf.getChannelData(0);
        const step = Math.max(1, Math.floor(ch.length / n));
        const stride = Math.max(1, Math.floor(step / 200));
        const peaks = [];
        let max = 0;
        for (let i = 0; i < n; i++) {
            let m = 0;
            const end = Math.min(ch.length, (i + 1) * step);
            for (let j = i * step; j < end; j += stride) { const a = Math.abs(ch[j]); if (a > m) m = a; }
            peaks.push(m);
            if (m > max) max = m;
        }
        return peaks.map((p) => Math.max(0.06, Math.sqrt(p / (max || 1))));
    } finally { ac.close().catch(() => {}); }
}

async function loadPeaks(t) {
    state.peaks = pseudoPeaks(hash(t.id));
    drawWave();
    const id = t.id;
    try {
        const real = await computePeaks(t.file);
        if (real && state.currentId === id) { state.peaks = real; drawWave(); }
    } catch { /* undecodable — keep the placeholder shape */ }
}

function drawWave() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wctx.clearRect(0, 0, w, h);
    const peaks = state.peaks;
    if (!peaks.length) {
        wctx.fillStyle = 'rgba(71, 85, 105, 0.5)';
        wctx.fillRect(0, h / 2 - 1, w, 2);
        return;
    }
    const barW = 3, gap = 2, count = Math.max(1, Math.floor((w + gap) / (barW + gap)));
    const progress = audio.duration ? audio.currentTime / audio.duration : 0;
    for (let i = 0; i < count; i++) {
        const p = peaks[Math.min(peaks.length - 1, Math.floor((i / count) * peaks.length))];
        const bh = Math.max(3, p * h);
        const x = i * (barW + gap), y = (h - bh) / 2;
        wctx.fillStyle = i / count < progress ? '#06B6D4' : 'rgba(71, 85, 105, 0.55)';
        if (wctx.roundRect) { wctx.beginPath(); wctx.roundRect(x, y, barW, bh, 1.5); wctx.fill(); }
        else wctx.fillRect(x, y, barW, bh);
    }
}
new ResizeObserver(drawWave).observe(wave);

function updateProgress() {
    $('#timeNow').textContent = fmtTime(audio.currentTime);
    const t = cur();
    $('#timeTotal').textContent = fmtTime(isFinite(audio.duration) && audio.duration ? audio.duration : (t ? t.duration : 0));
    drawWave();
}
let raf = 0;
function tick() {
    cancelAnimationFrame(raf);
    const loop = () => { updateProgress(); if (!audio.paused && !audio.ended) raf = requestAnimationFrame(loop); };
    loop();
}

let dragging = false;
const fracFrom = (e) => { const r = wave.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
wave.addEventListener('pointerdown', (e) => {
    if (!audio.duration) return;
    dragging = true;
    wave.setPointerCapture(e.pointerId);
    audio.currentTime = fracFrom(e) * audio.duration;
    updateProgress();
});
wave.addEventListener('pointermove', (e) => {
    const f = fracFrom(e);
    const x = f * wave.clientWidth;
    $('#hoverLine').style.left = x + 'px';
    const ht = $('#hoverTime');
    ht.style.left = x + 'px';
    ht.textContent = fmtTime(f * (audio.duration || 0));
    if (dragging && audio.duration) { audio.currentTime = f * audio.duration; updateProgress(); }
});
wave.addEventListener('pointerup', () => { dragging = false; });
wave.addEventListener('pointercancel', () => { dragging = false; });

/* ==========================================================================
   Playlists & favorites
   ========================================================================== */
function toggleFavorite(id) {
    const i = state.data.favorites.indexOf(id);
    if (i >= 0) state.data.favorites.splice(i, 1); else state.data.favorites.unshift(id);
    saveData();
    $$('.fav[data-id]').forEach((b) => b.classList.toggle('on', isFav(b.dataset.id)));
    renderSidebar();
    if (state.view.name === 'favorites') renderMain({ keepScroll: true });
}

async function createPlaylistFlow(addIds = []) {
    const r = await promptModal('New playlist', { placeholder: 'Playlist name', confirm: 'Create' });
    const name = (r || '').trim();
    if (!name) return null;
    const pl = { id: uid(), name, created: Date.now(), tracks: [...new Set(addIds)] };
    state.data.playlists.push(pl);
    saveData();
    renderSidebar();
    if (state.view.name === 'playlists') renderMain({ keepScroll: true });
    toast(addIds.length ? `Added to “${name}”` : `Created “${name}”`);
    return pl;
}
async function renamePlaylist(id) {
    const p = getPl(id); if (!p) return;
    const r = await promptModal('Rename playlist', { value: p.name, confirm: 'Save' });
    const name = (r || '').trim();
    if (!name) return;
    p.name = name; saveData(); renderSidebar(); renderMain({ keepScroll: true });
}
async function deletePlaylist(id) {
    const p = getPl(id); if (!p) return;
    const ok = await confirmModal(`Delete “${p.name}”?`, 'This removes the playlist only. Your music files are never touched.', { confirm: 'Delete', danger: true });
    if (!ok) return;
    state.data.playlists = state.data.playlists.filter((x) => x.id !== id);
    saveData();
    if (state.view.name === 'playlist' && state.view.id === id) navigate({ name: 'playlists' }, true, true);
    else { renderSidebar(); renderMain({ keepScroll: true }); }
    toast('Playlist deleted');
}
function addToPlaylist(pid, ids) {
    const p = getPl(pid); if (!p) return;
    const before = p.tracks.length;
    for (const id of ids) if (!p.tracks.includes(id)) p.tracks.push(id);
    saveData();
    toast(p.tracks.length === before ? `Already in “${p.name}”` : `Added to “${p.name}”`);
    renderSidebar();
    if (state.view.name === 'playlist' && state.view.id === pid) renderMain({ keepScroll: true });
}
function removeFromPlaylist(pid, id) {
    const p = getPl(pid); if (!p) return;
    p.tracks = p.tracks.filter((x) => x !== id);
    saveData(); renderSidebar(); renderMain({ keepScroll: true });
    toast('Removed from playlist');
}

/* ==========================================================================
   UI primitives: toast, menu, dialogs
   ========================================================================== */
function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 2400);
}

let menuEl = null;
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function openMenu(anchor, items) {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'menu';
    m.innerHTML = items.map((it, i) => {
        if (it.sep) return '<div class="menu-sep"></div>';
        if (it.heading) return `<div class="menu-head">${esc(it.heading)}</div>`;
        return `<button class="menu-item ${it.danger ? 'danger' : ''}" data-i="${i}">${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>${it.check ? icon('check') : ''}</button>`;
    }).join('');
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const w = m.offsetWidth, h = m.offsetHeight;
    let left = Math.min(r.right - w, innerWidth - w - 8);
    if (r.right - w < 8) left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
    m.style.left = Math.max(8, left) + 'px';
    m.style.top = top + 'px';
    m.addEventListener('click', (e) => {
        const b = e.target.closest('[data-i]');
        if (!b) return;
        const it = items[+b.dataset.i];
        closeMenu();
        if (it.run) it.run();
    });
    menuEl = m;
}
const pointAnchor = (x, y) => ({ getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y }) });

function openDialog(html) {
    return new Promise((res) => {
        const d = document.createElement('dialog');
        d.className = 'modal';
        d.innerHTML = html;
        document.body.appendChild(d);
        d.addEventListener('close', () => {
            const inp = d.querySelector('input');
            const out = { rv: d.returnValue, v: inp ? inp.value : '' };
            d.remove();
            res(out);
        });
        d.addEventListener('click', (e) => { if (e.target === d) d.close(''); });
        const cancel = d.querySelector('[data-cancel]');
        if (cancel) cancel.addEventListener('click', () => d.close(''));
        d.showModal();
        const inp = d.querySelector('input');
        if (inp) { inp.focus(); inp.select(); }
    });
}
async function promptModal(title, { value = '', placeholder = '', confirm = 'Save' } = {}) {
    const r = await openDialog(`<form method="dialog"><h3>${esc(title)}</h3><input class="field" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="80" autocomplete="off"><div class="actions"><button type="button" class="btn-ghost" data-cancel>Cancel</button><button class="btn-primary" value="ok">${esc(confirm)}</button></div></form>`);
    return r.rv === 'ok' ? r.v : null;
}
async function confirmModal(title, message, { confirm = 'Confirm', danger = false } = {}) {
    const r = await openDialog(`<form method="dialog"><h3>${esc(title)}</h3><p>${esc(message)}</p><div class="actions"><button type="button" class="btn-ghost" data-cancel>Cancel</button><button class="btn-primary ${danger ? 'danger' : ''}" value="ok">${esc(confirm)}</button></div></form>`);
    return r.rv === 'ok';
}

/* ==========================================================================
   Rendering
   ========================================================================== */
function coverHTML(t, cls = '') {
    if (t && t.cover) return `<div class="cover ${cls}" style="background-image:url('${t.cover}')"></div>`;
    const h = hash(t ? t.album + t.artist : 'x') % 360;
    return `<div class="cover ph ${cls}" style="--h:${h}">${icon('music')}</div>`;
}
function coverFor(tracks, seed, cls = 'fill') {
    const withArt = tracks.find((x) => x.cover);
    if (withArt) return coverHTML(withArt, cls);
    const h = hash(seed || 'x') % 360;
    return `<div class="cover ph ${cls}" style="--h:${h}">${icon('music')}</div>`;
}
const fmtBadge = (t) => `<span class="fmt ${LOSSLESS_EXT.has(t.ext) ? 'lossless' : ''}">${esc(t.ext.toUpperCase())}</span>`;
const sumDur = (tracks) => tracks.reduce((s, t) => s + (t.duration || 0), 0);
const idsToTracks = (ids) => ids.map(getTrack).filter(Boolean);

function idsFor(list) {
    if (list === 'all') return state.sorted.map((t) => t.id);
    if (list === 'fav') return state.data.favorites.filter((id) => state.byId.has(id));
    if (list.startsWith('pl:')) { const p = getPl(list.slice(3)); return p ? p.tracks.filter((id) => state.byId.has(id)) : []; }
    if (list.startsWith('album:')) { const a = state.albumById.get(list.slice(6)); return a ? a.tracks.map((t) => t.id) : []; }
    if (list.startsWith('artist:')) { const a = state.artistById.get(list.slice(7)); return a ? a.tracks.map((t) => t.id) : []; }
    return [];
}

/* --- shell icons --- */
function hydrateIcons(root = document) {
    $$('[data-icon]', root).forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
}

/* --- sidebar --- */
function navKey() {
    const n = state.view.name;
    if (n === 'home') return 'home';
    if (n === 'discover') return 'discover';
    return 'library';
}
function renderSidebar() {
    const key = state.query ? '' : navKey();
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.nav === key));
    const chipName = ['songs', 'playlists', 'artists', 'albums'].includes(state.view.name) && !state.query ? state.view.name : '';
    $$('.chip').forEach((c) => c.classList.toggle('active', c.dataset.chip === chipName));

    const favN = idsFor('fav').length;
    const favActive = state.view.name === 'favorites' && !state.query;
    let html = `<button class="side-item ${favActive ? 'active' : ''}" data-action="nav" data-view="favorites"><div class="tile fav">${icon('heart')}</div><div class="info"><div class="name">Favorites</div><div class="sub">${plural(favN, 'song')}</div></div></button>`;
    for (const p of state.data.playlists) {
        const n = p.tracks.filter((id) => state.byId.has(id)).length;
        const active = state.view.name === 'playlist' && state.view.id === p.id && !state.query;
        html += `<button class="side-item ${active ? 'active' : ''}" data-action="nav" data-view="playlist" data-id="${esc(p.id)}" data-pid="${esc(p.id)}"><div class="tile">${icon('music')}</div><div class="info"><div class="name">${esc(p.name)}</div><div class="sub">Playlist • ${plural(n, 'song')}</div></div></button>`;
    }
    if (!state.data.playlists.length) html += `<div class="side-empty">Create a playlist with the + above.</div>`;
    $('#sideList').innerHTML = html;
    renderFolderCard();
}
function renderFolderCard() {
    const name = state.folderName;
    let sub;
    if (state.scanning) sub = `Scanning… ${state.scanCount.toLocaleString()} found`;
    else if (state.needsPermission) sub = 'Permission needed';
    else if (state.tracks.length) sub = `${plural(state.tracks.length, 'track')} • ${state.backend === 'fs' ? 'playlists.json' : 'local storage'}`;
    else sub = name ? 'No tracks loaded' : 'Choose a folder to begin';
    $('#folderCard').innerHTML = `<div class="fc-ic">${icon('folder')}</div><div class="fc-body"><div class="fc-name" title="${esc(name || '')}">${esc(name || 'No folder selected')}</div><div class="fc-sub">${esc(sub)}</div></div><button class="icon-btn" data-action="folder-menu" title="Library settings">${icon('settings')}</button>`;
    $('#folderBtn').innerHTML = `${icon('folder')}<span class="lbl">${esc(name || 'Choose music folder')}</span>`;
}

/* --- track table --- */
function tableHTML(ids, { key, playlistId = null } = {}) {
    state.ctx[key] = ids;
    const rows = ids.map((id, i) => {
        const t = getTrack(id);
        if (!t) return '';
        const playing = id === state.currentId;
        return `<div class="trow ${playing ? 'playing' : ''}" data-action="play-row" data-ctx="${key}" data-id="${esc(id)}">
            <div class="c-num num"><span class="n">${i + 1}</span><span class="pl">${icon('play')}</span><span class="eq"><i></i><i></i><i></i></span></div>
            <div class="c-title">${coverHTML(t, 't-cover')}<div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}${fmtBadge(t)}</div></div></div>
            <div class="c-album">${esc(t.album)}</div>
            <div class="c-added">${esc(relDate(t.added))}</div>
            <div class="c-end"><button class="row-btn fav ${isFav(id) ? 'on' : ''}" data-action="fav" data-id="${esc(id)}" title="Favorite">${icon('heart')}</button><span class="dur num">${fmtTime(t.duration)}</span><button class="row-btn more" data-action="menu-track" data-id="${esc(id)}" ${playlistId ? `data-pl="${esc(playlistId)}"` : ''} title="More">${icon('more')}</button></div>
        </div>`;
    }).join('');
    return `<div class="table"><div class="trow thead"><div class="c-num">#</div><div>Title</div><div class="c-album">Album</div><div class="c-added">Date added</div><div class="c-end" style="padding-right:3.25rem">Time</div></div>${rows}</div>`;
}

/* --- cards --- */
function cardHTML({ cover, title, sub, view, id = '', list, badge = '' }) {
    return `<div class="card" data-action="nav" data-view="${view}" data-id="${esc(id)}"><div class="card-art">${cover}${badge}<button class="card-play" data-action="play-list" data-list="${esc(list)}" title="Play">${icon('play')}</button></div><div class="card-title" title="${esc(title)}">${esc(title)}</div><div class="card-sub">${esc(sub)}</div></div>`;
}
function albumCard(a) {
    const lossless = a.tracks.some((t) => LOSSLESS_EXT.has(t.ext));
    const exts = [...new Set(a.tracks.map((t) => t.ext.toUpperCase()))];
    const badge = lossless ? `<div class="fmt-badge"><span class="fmt">${esc(exts.find((e) => LOSSLESS_EXT.has(e.toLowerCase())) || exts[0])}</span></div>` : '';
    return cardHTML({ cover: coverFor(a.tracks, a.name), title: a.name, sub: [a.artist, a.year].filter(Boolean).join(' • '), view: 'album', id: a.id, list: 'album:' + a.id, badge });
}
function artistCard(r) {
    return cardHTML({ cover: coverFor(r.tracks, r.name), title: r.name, sub: plural(r.tracks.length, 'song'), view: 'artist', id: r.id, list: 'artist:' + r.id });
}
function playlistCard(p) {
    const tr = idsToTracks(p.tracks);
    return cardHTML({ cover: coverFor(tr, p.name), title: p.name, sub: `Playlist • ${plural(tr.length, 'song')}`, view: 'playlist', id: p.id, list: 'pl:' + p.id });
}
function miniHTML({ cover, title, sub, view, id = '' }) {
    return `<button class="mini" data-action="nav" data-view="${view}" data-id="${esc(id)}"><div class="art">${cover}</div><div class="info"><div class="name">${esc(title)}</div><div class="sub">${esc(sub)}</div></div></button>`;
}

function heroHTML({ kicker, title, desc, parts, tracks, seed, list, extra = '' }) {
    return `<section class="hero"><div class="hero-art">${coverFor(tracks, seed)}</div><div class="hero-body"><div class="kicker">${esc(kicker)}</div><h2 title="${esc(title)}">${esc(title)}</h2><p class="hero-desc">${esc(desc)}</p><div class="hero-foot"><div class="hero-meta">${parts.filter(Boolean).map((p, i) => (i ? '<i class="dot"></i>' : '') + `<span>${p}</span>`).join('')}</div><div class="hero-actions"><button class="play-main play-lg" data-action="play-list" data-list="${esc(list)}" title="Play">${icon('play')}</button><button class="round-btn" data-action="shuffle-list" data-list="${esc(list)}" title="Shuffle play">${icon('shuffle')}</button>${extra}</div></div></div></section>`;
}
const statParts = (tracks) => [`<b>${plural(tracks.length, 'song')}</b>`, esc(fmtTotal(sumDur(tracks)))];

/* --- views --- */
function emptyHTML() {
    const name = state.folderName;
    if (state.scanning) return `<div class="empty"><div class="spinner"></div><h2>Scanning your library…</h2><p>${state.scanCount.toLocaleString()} tracks found so far</p></div>`;
    if (state.needsPermission && state.dirHandle) {
        return `<div class="empty"><div class="big-ic">${icon('folder')}</div><h2>Reconnect “${esc(name)}”</h2><p>Your browser needs your permission to read this folder again. Your playlists are safe in <b>playlists.json</b>.</p><div class="btns"><button class="btn-primary" data-action="reconnect">Reconnect folder</button><button class="btn-ghost" data-action="choose-folder">Choose another</button></div></div>`;
    }
    if (state.loaded && !state.tracks.length) {
        return `<div class="empty"><div class="big-ic">${icon('music')}</div><h2>No audio files found</h2><p>“${esc(name)}” doesn’t contain any supported audio files (MP3, FLAC, WAV, OGG, M4A, AAC, OPUS…).</p><div class="btns"><button class="btn-primary" data-action="choose-folder">Choose another folder</button>${state.backend === 'fs' ? '<button class="btn-ghost" data-action="rescan">Rescan</button>' : ''}</div></div>`;
    }
    if (state.backend === 'input' && name) {
        return `<div class="empty"><div class="big-ic">${icon('folder')}</div><h2>Re-select “${esc(name)}”</h2><p>This browser can’t reopen a folder automatically. Pick the same folder again and your playlists will be kept.</p><div class="btns"><button class="btn-primary" data-action="choose-folder">Choose folder</button></div><p class="note">Tip: Chrome, Edge and Opera remember your folder between visits.</p></div>`;
    }
    return `<div class="empty"><div class="big-ic">${icon('wave')}</div><h2>Choose your music folder</h2><p>Pick a folder on your computer. Resonance scans it for music and keeps your playlists and favorites in a <b>playlists.json</b> file inside it.</p><div class="btns"><button class="btn-primary" data-action="choose-folder">Choose folder</button></div>${state.backend === 'input' ? '<p class="note">This browser doesn’t support persistent folder access, so playlists are stored in local storage and you’ll re-pick the folder each visit. Chrome/Edge work best.</p>' : ''}</div>`;
}

function homeHTML() {
    const all = state.sorted;
    // Featured: the biggest playlist, otherwise the whole library
    const pls = state.data.playlists.map((p) => ({ p, tr: idsToTracks(p.tracks) })).filter((x) => x.tr.length).sort((a, b) => b.tr.length - a.tr.length);
    let hero;
    if (pls.length) {
        const { p, tr } = pls[0];
        hero = heroHTML({ kicker: 'Featured playlist', title: p.name, desc: 'One of your playlists, ready when you are.', parts: statParts(tr), tracks: tr, seed: p.name, list: 'pl:' + p.id });
    } else {
        hero = heroHTML({ kicker: 'Your library', title: state.folderName || 'All songs', desc: 'Every track in your local library, ready to play in lossless clarity.', parts: statParts(all), tracks: all, seed: 'library', list: 'all' });
    }

    // Jump back in: favorites, playlists, recently played albums
    const mini = [];
    const seen = new Set();
    const push = (k, o) => { if (!seen.has(k)) { seen.add(k); mini.push(o); } };
    const favTr = idsToTracks(idsFor('fav'));
    if (favTr.length) push('fav', { cover: `<div class="cover ph fill" style="--h:190">${icon('heart')}</div>`, title: 'Favorites', sub: plural(favTr.length, 'song'), view: 'favorites' });
    state.data.playlists.forEach((p) => push('p' + p.id, { cover: coverFor(idsToTracks(p.tracks), p.name), title: p.name, sub: 'Playlist', view: 'playlist', id: p.id }));
    const recent = all.filter((t) => state.data.stats[t.id]?.last).sort((a, b) => state.data.stats[b.id].last - state.data.stats[a.id].last);
    recent.forEach((t) => { const a = state.albumById.get(t.albumId); if (a) push('a' + a.id, { cover: coverFor(a.tracks, a.name), title: a.name, sub: a.artist, view: 'album', id: a.id }); });
    state.albums.forEach((a) => push('a' + a.id, { cover: coverFor(a.tracks, a.name), title: a.name, sub: a.artist, view: 'album', id: a.id }));
    const jump = mini.slice(0, 6);

    // Popular tracks
    const played = all.some((t) => playsOf(t.id) > 0);
    const popular = all.slice().sort((a, b) => (playsOf(b.id) - playsOf(a.id)) || (b.added - a.added)).slice(0, 10).map((t) => t.id);

    return `${hero}
    <section class="section"><div class="section-head"><h3>Jump Back In</h3></div><div class="mini-grid">${jump.map(miniHTML).join('')}</div></section>
    <section class="section"><div class="section-head"><h3>${played ? 'Popular Tracks' : 'Recently Added'}</h3><button class="link-btn" data-action="nav" data-view="songs">See All</button></div>${tableHTML(popular, { key: 'pop' })}</section>`;
}

function discoverHTML() {
    const recent = state.sorted.slice().sort((a, b) => b.added - a.added).slice(0, 8).map((t) => t.id);
    const albums = state.albums.slice().sort((a, b) => hash(a.id + 'x') - hash(b.id + 'x')).slice(0, 12);
    return `<div class="page-head"><div><h2>Discover</h2><p>Fresh from your folder, plus a few albums to rediscover.</p></div></div>
    <section><div class="section-head"><h3>Recently Added</h3></div>${tableHTML(recent, { key: 'recent' })}</section>
    <section class="section"><div class="section-head"><h3>Rediscover</h3><button class="link-btn" data-action="nav" data-view="albums">All Albums</button></div><div class="grid">${albums.map(albumCard).join('')}</div></section>`;
}

function songsHTML() {
    return `<div class="page-head"><div><h2>Your Library</h2><p>${plural(state.sorted.length, 'song')} • ${esc(fmtTotal(sumDur(state.sorted)))}</p></div></div>${tableHTML(idsFor('all'), { key: 'songs' })}`;
}
function albumsHTML() {
    return `<div class="page-head"><div><h2>Albums</h2><p>${plural(state.albums.length, 'album')}</p></div></div><div class="grid">${state.albums.map(albumCard).join('')}</div>`;
}
function artistsHTML() {
    return `<div class="page-head"><div><h2>Artists</h2><p>${plural(state.artists.length, 'artist')}</p></div></div><div class="grid">${state.artists.map(artistCard).join('')}</div>`;
}
function playlistsHTML() {
    const favN = idsFor('fav').length;
    const fav = cardHTML({ cover: `<div class="cover ph fill" style="--h:190">${icon('heart')}</div>`, title: 'Favorites', sub: `Playlist • ${plural(favN, 'song')}`, view: 'favorites', list: 'fav' });
    return `<div class="page-head"><div><h2>Playlists</h2><p>${plural(state.data.playlists.length, 'playlist')} saved in ${state.backend === 'fs' ? 'playlists.json' : 'local storage'}</p></div></div><div class="grid">${fav}${state.data.playlists.map(playlistCard).join('')}<button class="card new" data-action="new-playlist">${icon('plus')}<span>New playlist</span></button></div>`;
}
function albumHTML(id) {
    const a = state.albumById.get(id);
    if (!a) return `<div class="hint">That album is no longer in your library.</div>`;
    return heroHTML({ kicker: 'Album', title: a.name, desc: a.artist, parts: [esc(a.year), ...statParts(a.tracks)], tracks: a.tracks, seed: a.name, list: 'album:' + id }) + `<section class="section">${tableHTML(a.tracks.map((t) => t.id), { key: 'album' })}</section>`;
}
function artistHTML(id) {
    const a = state.artistById.get(id);
    if (!a) return `<div class="hint">That artist is no longer in your library.</div>`;
    const albums = state.albums.filter((x) => x.tracks.some((t) => t.artistId === id));
    return heroHTML({ kicker: 'Artist', title: a.name, desc: `${plural(albums.length, 'album')} in your library`, parts: statParts(a.tracks), tracks: a.tracks, seed: a.name, list: 'artist:' + id }) + `<section class="section">${tableHTML(a.tracks.map((t) => t.id), { key: 'artist' })}</section>`;
}
function playlistHTML(id) {
    const p = getPl(id);
    if (!p) return `<div class="hint">That playlist doesn’t exist.</div>`;
    const ids = idsFor('pl:' + id), tr = idsToTracks(ids);
    const extra = `<button class="round-btn" data-action="rename-playlist" data-id="${esc(id)}" title="Rename">${icon('edit')}</button><button class="round-btn" data-action="delete-playlist" data-id="${esc(id)}" title="Delete playlist">${icon('trash')}</button>`;
    const body = ids.length ? tableHTML(ids, { key: 'pl', playlistId: id }) : `<div class="hint">No songs yet. Use the <b>⋯</b> menu on any track and choose “Add to playlist”.</div>`;
    return heroHTML({ kicker: 'Playlist', title: p.name, desc: 'Your playlist, stored in playlists.json next to your music.', parts: statParts(tr), tracks: tr, seed: p.name, list: 'pl:' + id, extra }) + `<section class="section">${body}</section>`;
}
function favoritesHTML() {
    const ids = idsFor('fav'), tr = idsToTracks(ids);
    const body = ids.length ? tableHTML(ids, { key: 'fav' }) : `<div class="hint">Tap the heart on any track to save it here.</div>`;
    return heroHTML({ kicker: 'Your collection', title: 'Favorites', desc: 'The tracks you keep coming back to.', parts: statParts(tr), tracks: tr, seed: 'favorites', list: 'fav' }) + `<section class="section">${body}</section>`;
}
function searchHTML() {
    const words = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = state.sorted.filter((t) => { const hay = `${t.title} ${t.artist} ${t.album}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
    const body = hits.length ? tableHTML(hits.map((t) => t.id), { key: 'search' }) : `<div class="hint">Nothing matches “${esc(state.query)}”.</div>`;
    return `<div class="page-head"><div><h2>Results</h2><p>${plural(hits.length, 'song')} for “${esc(state.query)}”</p></div></div>${body}`;
}

function renderMain({ keepScroll = false } = {}) {
    const stage = $('#stage');
    const top = stage.scrollTop;
    state.ctx = {};
    const v = state.view;
    let html;
    if (!state.tracks.length) html = emptyHTML();
    else if (state.query) html = searchHTML();
    else {
        switch (v.name) {
            case 'discover': html = discoverHTML(); break;
            case 'songs': html = songsHTML(); break;
            case 'albums': html = albumsHTML(); break;
            case 'artists': html = artistsHTML(); break;
            case 'playlists': html = playlistsHTML(); break;
            case 'album': html = albumHTML(v.id); break;
            case 'artist': html = artistHTML(v.id); break;
            case 'playlist': html = playlistHTML(v.id); break;
            case 'favorites': html = favoritesHTML(); break;
            default: html = homeHTML();
        }
    }
    stage.innerHTML = html;
    stage.scrollTop = keepScroll ? top : 0;
    updatePlayingUI();
}

/* --- dock --- */
function renderDockTrack() {
    const t = cur();
    $('#dockTrack').innerHTML = t
        ? `${coverHTML(t, 'dock-cover')}<div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}</div></div><button class="row-btn fav ${isFav(t.id) ? 'on' : ''}" style="opacity:1" data-action="fav" data-id="${esc(t.id)}" title="Favorite">${icon('heart')}</button>`
        : `<div class="meta"><div class="t" style="color:var(--muted)">Nothing playing</div><div class="a">Pick a track to begin</div></div>`;
}
function updatePlayUI() {
    const playing = !audio.paused && !audio.ended && !!audio.getAttribute('src');
    document.body.classList.toggle('is-playing', playing);
    $('#playBtn').innerHTML = icon(playing ? 'pause' : 'play');
}
function updateTransportUI() {
    $('#shuffleBtn').classList.toggle('active', state.shuffle);
    const rb = $('#repeatBtn');
    rb.classList.toggle('active', state.repeat !== 'off');
    rb.innerHTML = icon(state.repeat === 'one' ? 'repeat1' : 'repeat');
}
function updateVolumeUI() {
    const v = audio.muted ? 0 : audio.volume;
    $('#volume').value = v;
    $('#volume').style.setProperty('--p', (v * 100) + '%');
    $('#muteBtn').innerHTML = icon(v === 0 ? 'mute' : v < 0.5 ? 'volumeLow' : 'volume');
}
function updatePlayingUI() {
    const id = state.currentId;
    $$('.trow[data-id]').forEach((r) => r.classList.toggle('playing', r.dataset.id === id));
}

/* --- queue drawer --- */
function qItem(t, pos, now) {
    if (!t) return '';
    return `<button class="q-item ${now ? 'now' : ''}" data-action="queue-jump" data-pos="${pos}">${coverHTML(t, 't-cover')}<div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}</div></div><span class="num">${fmtTime(t.duration)}</span></button>`;
}
function renderQueue() {
    const d = $('#queueDrawer');
    $('#queueBtn').classList.toggle('active', !d.hidden);
    if (d.hidden) return;
    const t = cur();
    const up = state.queue.slice(state.pos + 1, state.pos + 81);
    d.innerHTML = `<div class="qd-head"><h3>Queue</h3><button class="round-btn" data-action="toggle-queue" title="Close">${icon('close')}</button></div><div class="qd-body">${t ? `<div class="menu-head">Now playing</div>${qItem(t, state.pos, true)}` : ''}<div class="menu-head">Next up</div>${up.map((id, i) => qItem(getTrack(id), state.pos + 1 + i, false)).join('') || '<p class="dim pad">Nothing queued.</p>'}</div>`;
}

/* --- navigation --- */
const sameView = (a, b) => a.name === b.name && (a.id || null) === (b.id || null);
function navigate(view, push = true, replace = false) {
    view = { name: view.name, id: view.id || null };
    if (state.query) { state.query = ''; $('#searchInput').value = ''; }
    if (replace) { /* swap current entry without growing history */ }
    else if (push && !sameView(state.view, view)) { state.back.push(state.view); state.fwd = []; }
    state.view = view;
    renderSidebar();
    renderMain();
    updateNavButtons();
}
function updateNavButtons() {
    $('#backBtn').disabled = !state.back.length;
    $('#fwdBtn').disabled = !state.fwd.length;
}
function goBack() { if (!state.back.length) return; state.fwd.push(state.view); state.view = state.back.pop(); afterNav(); }
function goFwd() { if (!state.fwd.length) return; state.back.push(state.view); state.view = state.fwd.pop(); afterNav(); }
function afterNav() {
    if (state.query) { state.query = ''; $('#searchInput').value = ''; }
    renderSidebar(); renderMain(); updateNavButtons();
}

function renderAll() {
    renderSidebar();
    renderMain({ keepScroll: true });
    renderDockTrack();
    updateNavButtons();
}

/* ==========================================================================
   Menus (track / folder / playlist)
   ========================================================================== */
function openTrackMenu(anchor, id, plId) {
    const t = getTrack(id);
    if (!t) return;
    const items = [
        { label: 'Play next', icon: 'next', run: () => queueInsert(id, true) },
        { label: 'Add to queue', icon: 'queue', run: () => queueInsert(id, false) },
        { label: isFav(id) ? 'Remove from favorites' : 'Add to favorites', icon: 'heart', run: () => toggleFavorite(id) },
        { sep: true },
        { heading: 'Add to playlist' },
        ...state.data.playlists.map((p) => ({ label: p.name, icon: 'music', check: p.tracks.includes(id), run: () => addToPlaylist(p.id, [id]) })),
        { label: 'New playlist…', icon: 'plus', run: () => createPlaylistFlow([id]) },
        { sep: true },
        { label: 'Go to album', icon: 'disc', run: () => navigate({ name: 'album', id: t.albumId }) },
        { label: 'Go to artist', icon: 'user', run: () => navigate({ name: 'artist', id: t.artistId }) },
    ];
    if (plId) items.push({ sep: true }, { label: 'Remove from this playlist', icon: 'trash', danger: true, run: () => removeFromPlaylist(plId, id) });
    openMenu(anchor, items);
}
function openFolderMenu(anchor) {
    const items = [{ label: 'Change music folder…', icon: 'folder', run: chooseFolder }];
    if (state.backend === 'fs' && state.dirHandle && !state.needsPermission) items.push({ label: 'Rescan library', icon: 'refresh', run: loadLibrary });
    if (state.needsPermission) items.push({ label: 'Reconnect folder', icon: 'refresh', run: reconnect });
    openMenu(anchor, items);
}

/* ==========================================================================
   Events
   ========================================================================== */
const ACTIONS = {
    nav: (el) => navigate({ name: el.dataset.view, id: el.dataset.id || null }),
    back: goBack,
    fwd: goFwd,
    'play-row': (el) => playContext(state.ctx[el.dataset.ctx] || [], el.dataset.id),
    'play-list': (el) => playContext(idsFor(el.dataset.list)),
    'shuffle-list': (el) => { setShuffle(true); playContext(idsFor(el.dataset.list)); },
    fav: (el) => { toggleFavorite(el.dataset.id); const t = cur(); if (t && t.id === el.dataset.id) renderDockTrack(); },
    'menu-track': (el) => openTrackMenu(el, el.dataset.id, el.dataset.pl || null),
    'new-playlist': () => createPlaylistFlow(),
    'rename-playlist': (el) => renamePlaylist(el.dataset.id),
    'delete-playlist': (el) => deletePlaylist(el.dataset.id),
    'choose-folder': chooseFolder,
    reconnect,
    rescan: loadLibrary,
    'folder-menu': (el) => openFolderMenu(el),
    'toggle-play': togglePlay,
    prev: () => prev(),
    next: () => next(false),
    shuffle: () => setShuffle(!state.shuffle),
    repeat: cycleRepeat,
    mute: () => { audio.muted = !audio.muted; updateVolumeUI(); },
    'toggle-queue': () => { const d = $('#queueDrawer'); d.hidden = !d.hidden; renderQueue(); },
    'queue-jump': (el) => playAt(+el.dataset.pos),
};

document.addEventListener('click', (e) => {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
}, true);
document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.action];
    if (fn) fn(el, e);
});

// Right-click menus
$('#stage').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.trow[data-id]');
    if (!row) return;
    e.preventDefault();
    const more = row.querySelector('.more');
    openTrackMenu(pointAnchor(e.clientX, e.clientY), row.dataset.id, more && more.dataset.pl ? more.dataset.pl : null);
});
$('#sideList').addEventListener('contextmenu', (e) => {
    const it = e.target.closest('[data-pid]');
    if (!it) return;
    e.preventDefault();
    const id = it.dataset.pid;
    openMenu(pointAnchor(e.clientX, e.clientY), [
        { label: 'Play', icon: 'play', run: () => playContext(idsFor('pl:' + id)) },
        { label: 'Rename', icon: 'edit', run: () => renamePlaylist(id) },
        { label: 'Delete', icon: 'trash', danger: true, run: () => deletePlaylist(id) },
    ]);
});

// Search
let searchTimer;
$('#searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        state.query = e.target.value.trim();
        renderSidebar();
        renderMain();
    }, 120);
});
$('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.target.value = ''; state.query = ''; renderSidebar(); renderMain(); e.target.blur(); }
});

// Volume
$('#volume').addEventListener('input', (e) => {
    audio.muted = false;
    audio.volume = +e.target.value;
    lsSet(LS.volume, String(audio.volume));
    updateVolumeUI();
});

// Fallback folder picker (browsers without showDirectoryPicker)
$('#folderInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files).filter((f) => AUDIO_EXT.has(extOf(f.name)));
    e.target.value = '';
    if (!files.length) { toast('No audio files found in that folder'); return; }
    const name = (files[0].webkitRelativePath || '').split('/')[0] || 'Selected folder';
    const same = name === state.folderName;
    if (!same && hasUserData()) {
        const ok = await confirmModal('Change library folder?', 'Switching folders starts a fresh playlist file — your current playlists and favorites will be cleared.', { confirm: 'Switch folder', danger: true });
        if (!ok) return;
    }
    if (!same) { stopPlayback(); state.data = defaultData(); setFolderName(name); await flushData(); }
    else state.data = await readData();
    const entries = files.map((f) => ({ path: (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name, file: f }));
    state.needsPermission = false;
    state.loaded = true;
    ingest(entries);
    renderAll();
    toast(`Loaded ${plural(entries.length, 'track')}`);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#searchInput').focus(); return; }
    if (e.key === 'Escape') { closeMenu(); if (!$('#queueDrawer').hidden && !typing) ACTIONS['toggle-queue'](); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
    switch (e.key) {
        case ' ': e.preventDefault(); togglePlay(); break;
        case 'ArrowRight': e.preventDefault(); if (e.shiftKey) next(false); else if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); break;
        case 'ArrowLeft': e.preventDefault(); if (e.shiftKey) prev(); else audio.currentTime = Math.max(0, audio.currentTime - 5); break;
        case 'ArrowUp': e.preventDefault(); audio.muted = false; audio.volume = Math.min(1, audio.volume + 0.05); lsSet(LS.volume, String(audio.volume)); updateVolumeUI(); break;
        case 'ArrowDown': e.preventDefault(); audio.volume = Math.max(0, audio.volume - 0.05); lsSet(LS.volume, String(audio.volume)); updateVolumeUI(); break;
        case 'm': case 'M': audio.muted = !audio.muted; updateVolumeUI(); break;
        case 's': case 'S': setShuffle(!state.shuffle); break;
        case 'r': case 'R': cycleRepeat(); break;
        case 'q': case 'Q': ACTIONS['toggle-queue'](); break;
        default:
    }
});

/* ==========================================================================
   Boot
   ========================================================================== */
async function init() {
    hydrateIcons();
    $('#kbdHint').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
    const vol = parseFloat(lsGet(LS.volume, '0.8'));
    audio.volume = isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 0.8;
    if (!['off', 'all', 'one'].includes(state.repeat)) state.repeat = 'off';
    setupMediaSession();
    updateTransportUI();
    updateVolumeUI();
    updatePlayUI();
    renderDockTrack();
    drawWave();

    state.backend = typeof window.showDirectoryPicker === 'function' ? 'fs' : 'input';
    if (state.backend === 'fs') {
        let handle = null;
        try { handle = await idbGet('dirHandle'); } catch { /* ignore */ }
        if (handle) {
            state.dirHandle = handle;
            setFolderName(handle.name);
            let perm = 'prompt';
            try { perm = await handle.queryPermission({ mode: 'readwrite' }); } catch { /* ignore */ }
            if (perm === 'granted') { await loadLibrary(); return; }
            state.needsPermission = true;
        }
    } else {
        state.data = await readData();
    }
    renderAll();
}
init();
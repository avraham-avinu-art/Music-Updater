(function () {
  'use strict';

  var PAGE = 12;
  var PC_TIMEOUT = 90000;
  var ICON_DOWN = '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 20h14"/></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  var ICON_INFO = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></svg>';
  var NOTE = '<svg class="note" viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';
  var GRADIENTS = [['#7f7cff', '#c3a6ff'], ['#4fb3ff', '#8be0e6'], ['#ff8fa3', '#ffc48a'], ['#34c5a0', '#a6e36f'], ['#a06bff', '#ff9ad5'], ['#5b7cfa', '#9ad0ff']];
  var AVATAR_COLORS = ['#6d4aff', '#1d9bf0', '#f91880', '#00ba7c', '#ff7a00', '#7856ff', '#e0245e'];
  var SOURCE_NAMES = { nigun: 'שיר חדש', news: 'חדשות המוזיקה', bot: 'שיר בוט' };
  var STATUS_TEXT = { waiting: 'שולח למחשב', tagging: 'מכין קובץ', copying: 'מעתיק לנגן' };

  var el = function (id) { return document.getElementById(id); };
  var native = window.Native;
  var coverBase = native.coverBase();

  var latest = [], all = [], shown = [], visible = [];
  var filter = 'all', query = '';
  var rendered = 0;
  var posts = {};
  var images = [];
  var seenCatalog = '', seenStatus = '', seenCovers = -1;
  var status = { storages: [], jobs: {} };
  var pending = {};
  var storageIndex = 0;
  var askedCovers = {};
  var connected = false;
  var pcAlive = false;
  var sheetSong = null;
  var settingsOpen = false;
  var autoWanted = null;

  try { storageIndex = parseInt(localStorage.getItem('storage') || '0', 10) || 0; } catch (e) {}

  function normalize(t) {
    return String(t).replace(/\.mp3$/i, '').toLowerCase().replace(/[^0-9a-zא-ת]+/g, '');
  }

  function hash(t) {
    var h = 0;
    for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function toast(text) {
    var t = el('toast');
    t.textContent = text;
    t.className = 'toast show';
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.className = 'toast'; }, 3800);
  }

  function make(tag, className, text) {
    var d = document.createElement(tag);
    if (className) d.className = className;
    if (text) d.textContent = text;
    return d;
  }

  function timeAgo(ms) {
    var days = Math.floor((Date.now() - ms) / 86400000);
    if (days < 1) return 'היום';
    if (days === 1) return 'אתמול';
    if (days < 7) return 'לפני ' + days + ' ימים';
    if (days < 14) return 'לפני שבוע';
    var d = new Date(ms);
    return d.getDate() + '/' + (d.getMonth() + 1);
  }

  /* ---------- covers ---------- */

  function coverUrl(id, version) {
    return coverBase + id.replace(':', '_') + '.jpg' + (version ? '?v=' + version : '');
  }

  function fillArt(art, song) {
    var pair = GRADIENTS[hash(song.t) % GRADIENTS.length];
    art.style.background = 'linear-gradient(145deg,' + pair[0] + ',' + pair[1] + ')';
    art.innerHTML = NOTE;
    var img = new Image();
    img.onload = function () { img.className = 'ready'; img.dataset.ok = '1'; };
    img.onerror = function () { img.className = ''; };
    img.src = coverUrl(song.i, seenCovers > 0 ? seenCovers : 0);
    art.appendChild(img);
    images.push({ img: img, id: song.i });
    return img;
  }

  function retryCovers() {
    for (var i = 0; i < images.length; i++) {
      var entry = images[i];
      if (!entry.img.dataset.ok) entry.img.src = coverUrl(entry.id, seenCovers);
    }
  }

  function askMissingCovers() {
    if (!query || !pcAlive) return;
    var ids = [];
    for (var id in posts) {
      if (id.charAt(0) !== 's' || posts[id].img.dataset.ok || askedCovers[id]) continue;
      askedCovers[id] = true;
      ids.push(id.slice(2));
      if (ids.length === 16) break;
    }
    if (ids.length) native.requestCovers(ids.join('_'));
  }

  /* ---------- download state ---------- */

  function musicSet() {
    var target = (status.storages || [])[storageIndex];
    var set = {};
    if (target) for (var i = 0; i < target.music.length; i++) set[normalize(target.music[i])] = true;
    return set;
  }

  function jobFor(id) {
    if (pending[id]) return { st: 'waiting' };
    return (status.jobs || {})[id];
  }

  function stateOf(song, onDevice) {
    var job = jobFor(song.i);
    var st = job ? job.st : '';
    var done = onDevice[normalize(song.t)] || st === 'done';
    return { job: job, st: st, key: done ? 'done' : st === 'downloading' ? 'ring' : (st && st !== 'error') ? 'busy' : 'idle' };
  }

  function paintAction(post, onDevice) {
    var state = stateOf(post.song, onDevice);
    var btn = post.btn;
    if (post.key !== state.key) {
      post.key = state.key;
      btn.className = state.key === 'done' ? 'act dl done' : state.key === 'idle' ? 'act dl' : 'act dl busy';
      if (state.key === 'done') btn.innerHTML = ICON_CHECK + '<span>בנגן</span>';
      else if (state.key === 'idle') btn.innerHTML = ICON_DOWN + '<span>הורדה</span>';
      else if (state.key === 'busy') btn.innerHTML = '<span class="mini"></span><span class="lbl"></span>';
      else btn.innerHTML = '<svg class="ring" viewBox="0 0 20 20"><circle class="track" cx="10" cy="10" r="8"/><circle class="bar" cx="10" cy="10" r="8" stroke-dashoffset="50.3"/></svg><span class="lbl"></span>';
    }
    if (state.key === 'ring') {
      var p = state.job.p || 0;
      btn.querySelector('.bar').style.strokeDashoffset = String(50.3 * (1 - p));
      btn.querySelector('.lbl').textContent = 'מוריד ' + Math.round(p * 100) + '%';
    } else if (state.key === 'busy') {
      btn.querySelector('.lbl').textContent = STATUS_TEXT[state.st] || 'רגע…';
    }
  }

  function paintSheet(onDevice) {
    if (!sheetSong) return;
    var state = stateOf(sheetSong, onDevice);
    var p = state.key === 'ring' ? (state.job.p || 0) : 0;
    el('sheetDl').className = state.key === 'done' ? 'action done' : state.key === 'idle' ? 'action' : 'action busy';
    el('sheetFill').style.width = (p * 100) + '%';
    el('sheetLabel').textContent = state.key === 'done' ? 'נמצא בנגן'
      : state.key === 'idle' ? 'הורדה לנגן'
      : state.key === 'ring' ? 'מוריד ' + Math.round(p * 100) + '%'
      : STATUS_TEXT[state.st] || 'רגע…';
  }

  function paintAll() {
    var set = musicSet();
    for (var id in posts) paintAction(posts[id], set);
    paintSheet(set);
  }

  function download(song) {
    if (stateOf(song, musicSet()).key !== 'idle') return;
    if (!pcAlive) { toast('הנגן לא מחובר למחשב כרגע'); return; }
    pending[song.i] = Date.now();
    native.request(song.i, storageIndex);
    paintAll();
  }

  /* ---------- sheets ---------- */

  function showScrim(on) { el('scrim').className = on ? 'scrim show' : 'scrim'; }

  function addFact(list, label, value) {
    if (!value) return;
    var row = make('div');
    row.appendChild(make('dt', '', label));
    row.appendChild(make('dd', '', value));
    list.appendChild(row);
  }

  function openSheet(song) {
    sheetSong = song;
    fillArt(el('sheetArt'), song);
    el('sheetName').textContent = song.n;
    el('sheetArtist').textContent = song.a || '';
    var facts = el('sheetFacts');
    facts.innerHTML = '';
    addFact(facts, 'אלבום', song.b);
    addFact(facts, 'משך', song.l);
    if (song.d) {
      var d = new Date(song.d);
      addFact(facts, 'פורסם', d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear());
    }
    addFact(facts, 'מקור', SOURCE_NAMES[song.s]);
    el('sheetAbout').textContent = song.x || '';
    el('sheet').scrollTop = 0;
    el('sheet').className = 'sheet show';
    showScrim(true);
    paintSheet(musicSet());
    if (song.i.charAt(0) === 's' && !askedCovers[song.i] && pcAlive) {
      askedCovers[song.i] = true;
      native.requestCovers(song.i.slice(2));
    }
  }

  function openSettings() {
    settingsOpen = true;
    paintSettings();
    el('settings').className = 'sheet settings show';
    showScrim(true);
  }

  window.closeSheet = function () {
    if (!sheetSong && !settingsOpen) return false;
    sheetSong = null;
    settingsOpen = false;
    el('sheet').className = 'sheet';
    el('settings').className = 'sheet settings';
    showScrim(false);
    return true;
  };

  el('scrim').addEventListener('click', window.closeSheet);
  el('sheetClose').addEventListener('click', window.closeSheet);
  el('sheetDl').addEventListener('click', function () { if (sheetSong) download(sheetSong); });
  el('settingsBtn').addEventListener('click', openSettings);

  /* ---------- settings ---------- */

  function autoOn() {
    if (autoWanted && Date.now() - autoWanted.t < 30000 && autoWanted.v !== !!status.auto) return autoWanted.v;
    return !!status.auto;
  }

  function paintSettings() {
    if (!settingsOpen) return;
    var on = autoOn();
    var left = status.autoLeft || 0;
    el('autoRow').className = on ? 'setting on' : 'setting';
    el('autoSub').textContent = !on ? 'כל השירים החדשים יורדו לבד בכל חיבור'
      : status.autoNote ? status.autoNote
      : left ? 'מוריד עכשיו · נשארו ' + left
      : 'פעיל · כל שיר חדש יורד לבד';

    var list = status.storages || [];
    var box = el('storages');
    var names = list.map(function (s) { return s.name; }).join('|') + '#' + storageIndex;
    if (box.dataset.names !== names) {
      box.dataset.names = names;
      box.innerHTML = '';
      if (!list.length) box.appendChild(make('p', 'setting-sub', 'יופיע כשהנגן מחובר'));
      list.forEach(function (s, i) {
        var row = make('button', i === storageIndex ? 'setting on' : 'setting');
        row.type = 'button';
        var text = make('span', 'setting-text');
        text.appendChild(make('span', 'setting-title', s.name));
        text.appendChild(make('span', 'setting-sub', s.music.length + ' שירים בתיקיית Music'));
        row.appendChild(text);
        row.appendChild(make('span', 'radio'));
        row.addEventListener('click', function () {
          storageIndex = i;
          try { localStorage.setItem('storage', String(i)); } catch (e) {}
          paintSettings();
          paintAll();
        });
        box.appendChild(row);
      });
    }
    el('setConn').textContent = !connected ? 'הנגן לא מחובר' : pcAlive ? 'מחובר למחשב' : 'מתחבר למחשב…';
    el('setCount').textContent = latest.length ? latest.length + ' שירים ברשימה, ' + all.length + ' במאגר החיפוש' : '';
  }

  el('autoRow').addEventListener('click', function () {
    if (!pcAlive) { toast('אפשר לשנות כשהנגן מחובר למחשב'); return; }
    var next = !autoOn();
    autoWanted = { v: next, t: Date.now() };
    native.setAuto(next, storageIndex);
    paintSettings();
  });

  /* ---------- feed ---------- */

  function buildPost(song) {
    var post = make('article', 'post');
    post.tabIndex = 0;
    var initial = (song.a || song.n).replace(/^[^א-תA-Za-z]+/, '').charAt(0);
    var avatar = make('div', 'avatar', initial);
    avatar.style.background = AVATAR_COLORS[hash(song.a || song.n) % AVATAR_COLORS.length];

    var body = make('div', 'post-body');
    var head = make('div', 'post-head');
    head.appendChild(make('span', 'author', song.a || SOURCE_NAMES[song.s]));
    head.appendChild(make('span', 'meta', '· ' + SOURCE_NAMES[song.s] + (song.d ? ' · ' + timeAgo(song.d) : '')));
    body.appendChild(head);

    var text = make('div', 'post-text');
    text.appendChild(make('b', '', song.n));
    if (song.b && song.s === 'bot') text.appendChild(document.createTextNode(' · מתוך ' + song.b));
    body.appendChild(text);
    if (song.x) body.appendChild(make('div', 'post-about', song.x));

    var media = make('div', 'media');
    var img = fillArt(media, song);
    body.appendChild(media);

    var actions = make('div', 'actions');
    var btn = make('button', 'act dl');
    btn.type = 'button';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      download(song);
    });
    var info = make('button', 'act');
    info.type = 'button';
    info.innerHTML = ICON_INFO + '<span>פרטים</span>';
    actions.appendChild(btn);
    actions.appendChild(info);
    if (song.l) actions.appendChild(make('span', 'dur', song.l));
    body.appendChild(actions);

    post.appendChild(avatar);
    post.appendChild(body);
    post.addEventListener('click', function () { openSheet(song); });
    posts[song.i] = { btn: btn, img: img, song: song, key: '' };
    return post;
  }

  function appendPage() {
    var feed = el('feed');
    var end = Math.min(rendered + PAGE, visible.length);
    var set = musicSet();
    for (; rendered < end; rendered++) {
      var song = visible[rendered];
      feed.appendChild(buildPost(song));
      paintAction(posts[song.i], set);
    }
    el('more').className = rendered < visible.length ? 'more show' : 'more';
    askMissingCovers();
  }

  function render() {
    visible = filter === 'all' ? shown : shown.filter(function (s) { return s.s === filter; });
    el('feed').innerHTML = '';
    posts = {};
    images = [];
    rendered = 0;
    var results = el('results');
    results.className = query ? 'results' : 'results hidden';
    results.textContent = visible.length ? visible.length + ' תוצאות ל"' + query + '"' : 'לא נמצאו שירים ל"' + query + '"';
    appendPage();
    if (sheetSong) images.push({ img: el('sheetArt').querySelector('img'), id: sheetSong.i });
    window.scrollTo(0, 0);
  }

  function searchSongs(q) {
    var words = q.split(/\s+/).map(normalize).filter(Boolean);
    if (!words.length) return latest;
    var hit = function (text) {
      for (var i = 0; i < words.length; i++) if (text.indexOf(words[i]) < 0) return false;
      return true;
    };
    var out = [], seen = {}, i, s, key;
    for (i = 0; i < latest.length && out.length < 120; i++) {
      s = latest[i];
      key = normalize(s.t);
      if (hit(normalize(s.t + ' ' + (s.b || '')))) { seen[key] = true; out.push(s); }
    }
    for (i = 0; i < all.length && out.length < 120; i++) {
      var row = all[i];
      var title = row[1].indexOf(' - ') >= 0 || !row[2] ? row[1] : row[2] + ' - ' + row[1];
      key = normalize(title);
      if (seen[key] || !hit(normalize(title + ' ' + row[3]))) continue;
      seen[key] = true;
      var split = title.indexOf(' - ');
      out.push({ i: 's:' + row[0], t: title, n: split > 0 ? title.slice(split + 3) : title, a: row[2] || (split > 0 ? title.slice(0, split) : ''), s: 'bot', b: row[3] });
    }
    return out;
  }

  /* ---------- connection ---------- */

  function updateView() {
    var hasList = latest.length > 0;
    el('content').className = hasList ? '' : 'hidden';
    el('state').className = hasList ? 'state hidden' : 'state';
    if (!hasList) {
      el('stateTitle').textContent = !connected ? 'מחפש חיבור' : pcAlive ? 'טוען שירים' : 'מתחבר למחשב';
      el('stateText').textContent = !connected ? 'חבר את הנגן למחשב בכבל'
        : pcAlive ? 'אוסף את החדשים משלושת האתרים' : 'אם זה לוקח זמן, אשר בנגן העברת קבצים';
    }

    var banner = el('banner');
    if (hasList && !connected) {
      banner.className = 'banner show off';
      el('bannerSpin').className = 'bspin hidden';
      el('bannerText').textContent = 'הנגן לא מחובר. אפשר לעיין, וההורדה תחזור בחיבור הבא';
    } else if (hasList && !pcAlive) {
      banner.className = 'banner show';
      el('bannerSpin').className = 'bspin';
      el('bannerText').textContent = 'מתחבר למחשב…';
    } else {
      banner.className = 'banner';
    }

    var current = (status.storages || [])[storageIndex];
    el('conn').className = !connected ? 'conn' : !pcAlive ? 'conn wait' : 'conn on';
    el('connText').textContent = !connected ? 'לא מחובר' : !pcAlive ? 'מתחבר למחשב…' : 'מחובר · שומר אל ' + (current ? current.name : 'הנגן');
  }

  function loadCatalog(stamp) {
    var text = native.readCatalog();
    if (!text) return;
    var data;
    try { data = JSON.parse(text); } catch (e) { return; }
    seenCatalog = stamp;
    latest = data.latest || [];
    all = data.all || [];
    shown = query ? searchSongs(query) : latest;
    render();
  }

  function applyStatus(text) {
    var next;
    try { next = JSON.parse(text); } catch (e) { return; }
    var prev = status.jobs || {};
    status = next;
    status.jobs = status.jobs || {};
    status.storages = status.storages || [];
    for (var id in status.jobs) {
      delete pending[id];
      var job = status.jobs[id];
      if (job.st === 'error' && (!prev[id] || prev[id].st !== 'error') && job.e && posts[id]) {
        toast(posts[id].song.n + ': ' + job.e);
      }
    }
    if (storageIndex >= status.storages.length) storageIndex = 0;
    paintAll();
  }

  function tick() {
    var state;
    try { state = JSON.parse(native.poll()); } catch (e) { return; }
    connected = !!state.usb;
    pcAlive = connected && state.statusAge >= 0 && state.statusAge < PC_TIMEOUT;

    if (state.statusStamp !== seenStatus && state.status) {
      seenStatus = state.statusStamp;
      applyStatus(state.status);
    }
    if (state.catalog !== seenCatalog && state.catalog !== '0') loadCatalog(state.catalog);
    if (state.covers !== seenCovers) {
      seenCovers = state.covers;
      if (seenCovers > 0) retryCovers();
    }
    var now = Date.now();
    for (var key in pending) {
      if (now - pending[key] > 40000) {
        delete pending[key];
        toast('המחשב לא ענה. נסה שוב');
        paintAll();
      }
    }
    updateView();
    paintSettings();
  }

  /* ---------- input ---------- */

  el('searchToggle').addEventListener('click', function () {
    var box = el('searchBox');
    var open = box.className.indexOf('hidden') >= 0;
    box.className = open ? 'search' : 'search hidden';
    if (open) el('search').focus();
    else if (query) {
      el('search').value = '';
      query = '';
      shown = latest;
      render();
    }
  });

  var searchTimer;
  el('search').addEventListener('input', function (e) {
    clearTimeout(searchTimer);
    var value = e.target.value.trim();
    searchTimer = setTimeout(function () {
      query = value;
      shown = query ? searchSongs(query) : latest;
      render();
    }, 220);
  });

  el('tabs').addEventListener('click', function (e) {
    var btn = e.target;
    if (!btn.dataset.source) return;
    filter = btn.dataset.source;
    var buttons = el('tabs').querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) buttons[i].className = buttons[i] === btn ? 'on' : '';
    render();
  });

  window.addEventListener('scroll', function () {
    if (rendered >= visible.length) return;
    if (window.innerHeight + window.pageYOffset > document.body.offsetHeight - 900) {
      clearTimeout(appendPage.timer);
      appendPage.timer = setTimeout(appendPage, 150);
    }
  });

  /* ---------- keypad navigation (phones without a touch screen) ---------- */

  var KEY = { left: 37, up: 38, right: 39, down: 40, enter: 13, center: 23, escape: 27 };
  var returnFocus = null;

  function isVisible(node) {
    if (!node.offsetParent && node.tagName !== 'BODY') return false;
    var r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // While a sheet is open, focus stays inside it.
  function scope() {
    if (settingsOpen) return el('settings');
    if (sheetSong) return el('sheet');
    return document;
  }

  function focusables() {
    var nodes = scope().querySelectorAll('button, input, .post');
    var out = [];
    for (var i = 0; i < nodes.length; i++) if (isVisible(nodes[i])) out.push(nodes[i]);
    return out;
  }

  function focusNode(node) {
    if (!node) return;
    node.focus();
    var top = scope() === document ? el('top') : null;
    var r = node.getBoundingClientRect();
    var headerBottom = top ? top.getBoundingClientRect().bottom : 0;
    if (r.top < headerBottom + 6) window.scrollBy(0, r.top - headerBottom - 10);
    else if (r.bottom > window.innerHeight - 6) window.scrollBy(0, Math.min(r.bottom - window.innerHeight + 10, r.top - headerBottom - 10));
    if (rendered < visible.length && node.className === 'post' && !node.nextSibling) appendPage();
  }

  function postOf(node) {
    while (node && node !== document.body) {
      if (node.className === 'post') return node;
      node = node.parentNode;
    }
    return null;
  }

  // Posts move as whole rows: up/down jumps post to post, left/right walks the post and its buttons.
  function move(dir) {
    var current = document.activeElement;
    var list = focusables();
    if (!current || current === document.body || list.indexOf(current) < 0) {
      focusNode(list.filter(function (n) { return n.className === 'post'; })[0] || list[0]);
      return;
    }
    var post = postOf(current);
    if (post && (dir === 'up' || dir === 'down')) {
      var sibling = dir === 'down' ? post.nextSibling : post.previousSibling;
      if (sibling) { focusNode(sibling); return; }
      if (dir === 'down') return;
    }
    if (post && (dir === 'left' || dir === 'right')) {
      // Reading order in Hebrew: left goes forward (post → הורדה → פרטים), right goes back.
      var stops = [post].concat([].slice.call(post.querySelectorAll('button')));
      var at = stops.indexOf(current) + (dir === 'left' ? 1 : -1);
      if (at >= 0 && at < stops.length) focusNode(stops[at]);
      return;
    }
    var from = current.getBoundingClientRect();
    var cx = from.left + from.width / 2, cy = from.top + from.height / 2;
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var node = list[i];
      if (node === current || (post && postOf(node) === post && (dir === 'up' || dir === 'down'))) continue;
      if ((dir === 'up' || dir === 'down') && post && node.className !== 'post' && postOf(node)) continue;
      var r = node.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      var main = dir === 'left' ? cx - x : dir === 'right' ? x - cx : dir === 'up' ? cy - y : y - cy;
      var side = dir === 'left' || dir === 'right' ? Math.abs(y - cy) : Math.abs(x - cx);
      if (main <= 1) continue;
      var score = main + side * 3;
      if (score < bestScore) { bestScore = score; best = node; }
    }
    if (best) focusNode(best);
  }

  window.goBack = function () {
    if (window.closeSheet()) {
      if (returnFocus && document.body.contains(returnFocus)) focusNode(returnFocus);
      returnFocus = null;
      return true;
    }
    if (el('searchBox').className.indexOf('hidden') < 0) {
      el('searchToggle').click();
      focusNode(el('searchToggle'));
      return true;
    }
    return false;
  };

  document.addEventListener('keydown', function (e) {
    var key = e.keyCode;
    document.body.className = 'keys';
    var inInput = document.activeElement && document.activeElement.tagName === 'INPUT';
    var dir = key === KEY.up ? 'up' : key === KEY.down ? 'down' : key === KEY.left ? 'left' : key === KEY.right ? 'right' : '';
    if (dir && !(inInput && (dir === 'left' || dir === 'right'))) {
      e.preventDefault();
      move(dir);
    } else if (key === KEY.escape) {
      e.preventDefault();
      window.goBack();
    } else if ((key === KEY.enter || key === KEY.center) && document.activeElement && document.activeElement.className === 'post') {
      e.preventDefault();
      document.activeElement.click();
    }
  });

  // Mouse or touch again: hide the focus rings.
  document.addEventListener('mousedown', function () { document.body.className = ''; });
  document.addEventListener('touchstart', function () { document.body.className = ''; });

  // Opening a sheet from the keypad puts focus on its main button; closing it returns to where you were.
  var openSheetPlain = openSheet;
  openSheet = function (song) {
    returnFocus = document.activeElement;
    openSheetPlain(song);
    if (document.body.className === 'keys') setTimeout(function () { el('sheetDl').focus(); }, 50);
  };
  el('settingsBtn').removeEventListener('click', openSettings);
  el('settingsBtn').addEventListener('click', function () {
    returnFocus = el('settingsBtn');
    openSettings();
    if (document.body.className === 'keys') setTimeout(function () { el('autoRow').focus(); }, 50);
  });
  el('scrim').removeEventListener('click', window.closeSheet);
  el('scrim').addEventListener('click', window.goBack);
  el('sheetClose').removeEventListener('click', window.closeSheet);
  el('sheetClose').addEventListener('click', window.goBack);

  tick();
  setInterval(tick, 700);
})();

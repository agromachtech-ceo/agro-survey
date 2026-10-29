/* Агромаштех · Харилцагчийн техникийн судалгаа (офлайн апп) */
(function () {
'use strict';

/* ---------------- Хадгалалт (IndexedDB) ---------------- */
var DB = null;
function idb() {
  if (DB) return Promise.resolve(DB);
  return new Promise(function (res, rej) {
    var r = indexedDB.open('amt-survey', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('kv'); r.result.createObjectStore('queue', { keyPath: 'client_uid' }); };
    r.onsuccess = function () { DB = r.result; res(DB); };
    r.onerror = function () { rej(r.error); };
  });
}
function tx(store, mode, fn) {
  return idb().then(function (db) {
    return new Promise(function (res, rej) {
      var t = db.transaction(store, mode), s = t.objectStore(store), out;
      out = fn(s);
      t.oncomplete = function () { res(out && typeof out === 'object' && 'readyState' in out ? out.result : out); };
      t.onerror = function () { rej(t.error); };
    });
  });
}
var kv = {
  get: function (k) { return tx('kv', 'readonly', function (s) { return s.get(k); }); },
  set: function (k, v) { return tx('kv', 'readwrite', function (s) { s.put(v, k); }); },
  del: function (k) { return tx('kv', 'readwrite', function (s) { s.delete(k); }); }
};
var Q = {
  all: function () { return tx('queue', 'readonly', function (s) { return s.getAll(); }); },
  put: function (x) { return tx('queue', 'readwrite', function (s) { s.put(x); }); },
  del: function (k) { return tx('queue', 'readwrite', function (s) { s.delete(k); }); }
};

/* ---------------- Төлөв ---------------- */
var S = { api: '', token: '', me: null, data: null, view: 'home', stack: [], draft: null, custTab: 'mine', q: '', aimag: '' };
var CROPS = [['wheat_ha', 'Улаан буудай'], ['barley_ha', 'Арвай'], ['oats_ha', 'Овъёос'], ['rapeseed_ha', 'Рапс'], ['fodder_ha', 'Тэжээлийн ургамал'], ['potato_ha', 'Төмс, хүнсний ногоо'], ['fallow_ha', 'Уринш'], ['hay_ha', 'Хадлан']];
var REPLACE = ['', 'Ирэх улиралд', '1–2 жилд', 'Төлөвлөөгүй'];
var FINANCE = ['', 'Өөрийн хөрөнгө', 'Банкны зээл', 'Лизинг', 'Төрийн хөтөлбөр', 'Тодорхойгүй'];
var RENT = ['', 'Түрээсэлдэггүй', 'Техник түрээсэлдэг', 'Ажил гүйцэтгүүлдэг', 'Бусдад түрээслүүлдэг'];
var WHEN = ['', 'Энэ улиралд', 'Ирэх жил', '2–3 жилд', 'Мэдэхгүй'];
var ROLES = ['', 'Захирал', 'Эзэмшигч', 'Агрономич', 'Инженер, механик', 'Нягтлан', 'Ажилтан', 'Гэр бүлийн гишүүн', 'Бусад'];
var MIN_CONTACTS = 2;
function digits(s) { return String(s || '').replace(/\D/g, ''); }

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmt(n) { n = Number(n) || 0; return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function num(v) { var n = Number(String(v || '').replace(',', '.')); return isNaN(n) ? 0 : n; }
function uid() { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function toast(m, e) { var t = $('toast'); t.textContent = m; t.className = 'toast' + (e ? ' e' : ''); clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = 'toast hidden'; }, e ? 5000 : 2500); }
function opts(list, sel) { return list.map(function (x) { var v = Array.isArray(x) ? x[0] : x, l = Array.isArray(x) ? x[1] : (x || '—'); return '<option value="' + esc(v) + '"' + (String(v) === String(sel || '') ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); }
function daysAgo(iso) { if (!iso) return null; var d = new Date(String(iso).replace(' ', 'T')); return isNaN(d) ? null : Math.floor((Date.now() - d) / 864e5); }

/* ---------------- API ---------------- */
function api(action, args) {
  if (!S.api) return Promise.reject(new Error('API холбоос тохируулаагүй байна.'));
  return fetch(S.api, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: action, token: S.token, args: args || {} }) })
    .then(function (r) { if (!r.ok) throw new Error('Сервер ' + r.status); return r.json(); })
    .then(function (r) {
      if (!r.ok) {
        var m = r.error || 'Алдаа';
        if (m.indexOf('AUTH:') === 0) { S.token = ''; kv.del('token'); var e = new Error(m.slice(5).trim()); e.auth = true; throw e; }
        throw new Error(m);
      }
      return r.data;
    });
}

/* ---------------- Сүлжээ ---------------- */
function online() { return navigator.onLine !== false; }
function netBadge() { var n = $('net'); n.className = 'net' + (online() ? '' : ' off'); n.textContent = online() ? '● онлайн' : '● офлайн'; }

/* ---------------- Дэлгэц солих ---------------- */
var VIEWS = {};
function show(view, arg, push) {
  if (push) S.stack.push([S.view, S.arg]);
  S.view = view; S.arg = arg;
  $('back').className = S.stack.length ? 'ib' : 'ib hidden';
  $('tabs').className = S.me ? 'tabbar' : 'tabbar hidden';
  Array.prototype.forEach.call(document.querySelectorAll('.tabbar a'), function (a) { a.className = a.getAttribute('data-t') === view ? 'on' : ''; });
  window.scrollTo(0, 0);
  VIEWS[view](arg);
}
function back() { var p = S.stack.pop(); if (p) show(p[0], p[1]); }
function tab(view) { S.stack = []; show(view); }
function title(t) { $('ttl').textContent = t; }

/* ---------------- Тохиргоо, нэвтрэх ---------------- */
VIEWS.setup = function () {
  title('Тохиргоо');
  $('v').innerHTML = '<div class="card login"><div class="brand">АМТ</div><h3>Серверийн холбоос</h3><p class="small muted">Оффисын програмын «Deploy → Web app» холбоос (…/exec). Нэг удаа оруулна.</p>' +
    '<label>Холбоос</label><input id="apiU" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(S.api) + '"><button class="btn p w" id="apiS">Хадгалах</button><div class="err" id="err"></div></div>';
  $('apiS').onclick = function () {
    var u = $('apiU').value.trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u)) { $('err').textContent = 'Холбоос «https://script.google.com/…/exec» хэлбэртэй байх ёстой.'; return; }
    S.api = u; kv.set('api', u).then(function () { show('login'); });
  };
};
VIEWS.login = function () {
  title('Нэвтрэх');
  $('v').innerHTML = '<div class="card login"><div class="brand">АМТ</div><h3>Харилцагчийн судалгаа</h3><p class="small muted">Нэг удаа нэвтэрнэ. Дараа нь офлайн ажиллана.</p>' +
    '<label>Ажилтан</label><select id="lSt"><option>Ачаалж байна…</option></select><label>PIN</label><input id="lPin" type="password" inputmode="numeric" maxlength="8">' +
    '<button class="btn p w" id="lGo">Нэвтрэх</button><div class="err" id="err"></div><p class="small muted" style="margin-top:16px"><a href="#" id="lSet">Серверийн холбоос солих</a></p></div>';
  $('lSet').onclick = function (e) { e.preventDefault(); show('setup'); };
  if (!online()) { $('err').textContent = 'Анх нэвтрэхэд интернэт хэрэгтэй.'; }
  api('loginList').then(function (list) {
    $('lSt').innerHTML = list.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + ' — ' + esc(s.position) + '</option>'; }).join('');
  }).catch(function (e) { $('err').textContent = e.message; });
  $('lGo').onclick = function () {
    $('err').textContent = '';
    var dev = (navigator.userAgent.match(/\(([^)]+)\)/) || [, 'Утас'])[1].slice(0, 60);
    api('login', { id: $('lSt').value, pin: $('lPin').value, device: dev }).then(function (r) {
      if (r.user.perms.indexOf('survey') < 0) throw new Error('Танд судалгаа бөглөх эрх алга.');
      S.token = r.token; S.me = r.user;
      return kv.set('token', r.token).then(function () { return kv.set('me', r.user); }).then(download);
    }).then(function () { tab('home'); }).catch(function (e) { $('err').textContent = e.message; });
  };
};

/* ---------------- Өгөгдөл татах / илгээх ---------------- */
function download() {
  toast('Мэдээлэл татаж байна…');
  return api('pwaBootstrap').then(function (d) {
    S.data = d; S.me = d.me;
    return kv.set('data', d).then(function () { return kv.set('me', d.me); }).then(function () { toast('Татлаа: ' + d.customers.length + ' харилцагч'); });
  });
}
var syncing = false;
function sync() {
  if (syncing || !online() || !S.token) return Promise.resolve();
  syncing = true;
  return Q.all().then(function (items) {
    items = items.filter(function (x) { return x.state !== 'sent'; }).sort(function (a, b) { return a.saved_at < b.saved_at ? -1 : 1; });
    var sent = 0;
    return items.reduce(function (p, it) {
      return p.then(function () {
        var payload = {}; for (var k in it) if (['state', 'error', 'saved_at', 'cust_name'].indexOf(k) < 0) payload[k] = it[k];
        return api('surveySave', payload).then(function (r) {
          sent++;
          return Q.del(it.client_uid);
        }).catch(function (e) {
          if (e.auth) throw e;
          it.state = 'error'; it.error = e.message;
          return Q.put(it);
        });
      });
    }, Promise.resolve()).then(function () {
      if (sent) { toast(sent + ' судалгаа илгээгдлээ'); return download().catch(function () {}); }
    });
  }).catch(function (e) { if (e.auth) { toast('Дахин нэвтэрнэ үү', true); show('login'); } }).then(function () { syncing = false; qBadge(); if (S.view === 'queue' || S.view === 'home') show(S.view, S.arg); });
}
function qBadge() { Q.all().then(function (a) { var n = a.length; $('qn').textContent = n; $('qn').className = n ? '' : 'hidden'; }); }

/* ---------------- Нүүр ---------------- */
VIEWS.home = function () {
  title('Сайн байна уу, ' + (S.me ? S.me.name : ''));
  Q.all().then(function (q) {
    var d = S.data, age = d ? daysAgo(d.at) : null;
    var mine = d ? d.customers.filter(function (c) { return c.owner === S.me.id; }) : [];
    var done = mine.filter(function (c) { return c.last_survey && String(c.last_survey).slice(0, 4) === String(new Date().getFullYear()); }).length;
    var h = '<div class="kp"><div><b>' + mine.length + '</b><span>Миний харилцагч</span></div><div><b>' + done + '</b><span>Энэ онд судалсан</span></div><div><b>' + q.length + '</b><span>Илгээгдээгүй</span></div></div>';
    h += '<button class="btn y w" id="hNew" style="margin:0 0 12px">+ Шинэ судалгаа</button>';
    h += '<div class="card"><h3>Томилолтод гарахын өмнө</h3><p class="small muted">Сүлжээтэй газар «Мэдээлэл татах» дарж харилцагч, техникийн бүртгэл, нормыг утсандаа хадгална.</p>' +
      '<div class="small">Сүүлд татсан: <b>' + (d ? esc(d.at) : 'татаагүй') + '</b>' + (age !== null && age > 7 ? ' <span class="tag warn">' + age + ' хоногийн өмнө</span>' : '') + '</div>' +
      '<button class="btn p w" id="hDl">Мэдээлэл татах</button></div>';
    if (q.length) h += '<div class="card"><h3>Илгээгдээгүй ' + q.length + ' судалгаа</h3><p class="small muted">Сүлжээ орж ирэхэд автоматаар илгээгдэнэ.</p><button class="btn w" id="hSync">Одоо илгээх</button></div>';
    h += '<div class="card small muted">' + esc(S.me.name) + ' · ' + esc(S.me.roleName || '') + '<div class="row" style="margin-top:8px"><a href="#" id="hOut">Гарах</a></div></div>';
    $('v').innerHTML = h;
    $('hNew').onclick = function () { show('pick', null, true); };
    $('hDl').onclick = function () { if (!online()) return toast('Сүлжээ алга', true); download().then(function () { show('home'); }).catch(function (e) { toast(e.message, true); if (e.auth) show('login'); }); };
    if ($('hSync')) $('hSync').onclick = function () { if (!online()) return toast('Сүлжээ алга', true); sync(); };
    $('hOut').onclick = function (e) {
      e.preventDefault();
      if (q.length && !confirm('Илгээгдээгүй ' + q.length + ' судалгаа устана. Гарах уу?')) return;
      api('logout').catch(function () {});
      S.token = ''; S.me = null; S.data = null;
      Promise.all([kv.del('token'), kv.del('me'), kv.del('data')]).then(function () { S.stack = []; show('login'); });
    };
  });
};

/* ---------------- Харилцагч ---------------- */
function custRows(filterFn) {
  var d = S.data; if (!d) return [];
  var q = S.q.toLowerCase();
  return d.customers.filter(function (c) {
    if (S.custTab === 'mine' && c.owner !== S.me.id) return false;
    if (S.aimag && c.aimag !== S.aimag) return false;
    if (q && (c.name + ' ' + (c.ttds || '') + ' ' + (c.sum || '')).toLowerCase().indexOf(q) < 0) return false;
    return !filterFn || filterFn(c);
  });
}
function custListHtml(rows) {
  return rows.slice(0, 150).map(function (c) {
    return '<div class="li" data-id="' + esc(c.id) + '"><div class="grow"><div class="t">' + esc(c.name) + '</div><div class="s">' + esc([c.aimag, c.sum].filter(String).join(' / ') || 'байршилгүй') + (c.owner_name && c.owner !== S.me.id ? ' · ' + esc(c.owner_name) : '') + '</div></div>' +
      (c.last_survey ? '<span class="tag ok">' + esc(String(c.last_survey).slice(0, 10)) + '</span>' : '<span class="tag">судлаагүй</span>') + '</div>';
  }).join('') + (rows.length > 150 ? '<div class="small muted" style="padding:10px 0">Эхний 150. Хайлтаар нарийсгана уу.</div>' : '') + (!rows.length ? '<div class="muted" style="padding:16px 0">Олдсонгүй.</div>' : '');
}
function custFilters() {
  return '<div class="seg" style="margin-bottom:8px"><a data-c="mine" class="' + (S.custTab === 'mine' ? 'on' : '') + '">Миний</a><a data-c="all" class="' + (S.custTab === 'all' ? 'on' : '') + '">Бүгд</a></div>' +
    '<div class="g2"><input id="cq" placeholder="Нэр, ТТД, сум…" value="' + esc(S.q) + '"><select id="ca"><option value="">Бүх аймаг</option>' + opts(MN_GEO.aimags, S.aimag) + '</select></div>';
}
function bindCust(redraw, onPick) {
  Array.prototype.forEach.call(document.querySelectorAll('.seg a[data-c]'), function (a) { a.onclick = function () { S.custTab = a.getAttribute('data-c'); redraw(); }; });
  $('cq').oninput = function () { S.q = this.value; $('cl').innerHTML = custListHtml(custRows()); bindRows(onPick); };
  $('ca').onchange = function () { S.aimag = this.value; redraw(); };
  bindRows(onPick);
}
function bindRows(onPick) { Array.prototype.forEach.call(document.querySelectorAll('.li[data-id]'), function (el) { el.onclick = function () { onPick(el.getAttribute('data-id')); }; }); }
VIEWS.custs = function () {
  title('Харилцагч');
  if (!S.data) { $('v').innerHTML = '<div class="card">Эхлээд «Нүүр» → «Мэдээлэл татах».</div>'; return; }
  $('v').innerHTML = custFilters() + '<div class="card" id="cl" style="margin-top:10px">' + custListHtml(custRows()) + '</div>';
  bindCust(VIEWS.custs, function (id) { show('cust', id, true); });
};
VIEWS.cust = function (id) {
  var d = S.data, c = d.customers.filter(function (x) { return x.id === id; })[0];
  if (!c) return back();
  title(c.name);
  var fl = d.fleet.filter(function (m) { return m.cust_id === id; }), s = d.lastSurvey[id], hist = d.history[id] || [];
  var h = '<div class="card"><div class="small muted">' + esc(c.id) + (c.ttds ? ' · ТТД ' + esc(c.ttds) : '') + '</div><div>' + esc([c.aimag, c.sum].filter(String).join(' / ') || 'Байршил тодорхойгүй') + '</div><div class="small muted">Хариуцагч: ' + esc(c.owner_name || '—') + '</div>' +
    '<button class="btn y w" id="cNew">' + (s ? 'Судалгаа шинэчлэх' : 'Судалгаа бөглөх') + '</button></div>';
  if (s) h += '<div class="card"><h3>Сүүлийн судалгаа · ' + esc(s.date) + '</h3><div class="small">' + esc(s.by_name) + ' · нийт ' + fmt(s.total_ha) + ' га · ' + esc(s.tech_mode || '') + '</div><div class="small muted">' +
    CROPS.filter(function (k) { return num(s[k[0]]) > 0; }).map(function (k) { return k[1] + ' ' + fmt(s[k[0]]); }).join(' · ') + '</div></div>';
  h += '<div class="card"><h3>Техник (' + fl.length + ')</h3>' + (fl.length ? fl.map(function (m) {
    return '<div class="li"><div class="grow"><div class="t">' + esc([m.brand, m.model].filter(String).join(' ') || m.mtype) + '</div><div class="s">' + esc(m.mtype) + (m.year_made ? ' · ' + esc(m.year_made) + ' он' : '') + (m.cond ? ' · байдал ' + esc(m.cond) + '/5' : '') + '</div></div></div>';
  }).join('') : '<div class="muted small">Бүртгэлгүй</div>') + '</div>';
  if (hist.length) h += '<div class="card"><h3>Манайхаас авсан</h3>' + hist.map(function (x) { return '<div class="hist">' + esc(x.year) + ' · ' + esc(x.name) + ' × ' + esc(x.qty) + '</div>'; }).join('') + '</div>';
  $('v').innerHTML = h;
  $('cNew').onclick = function () { startSurvey(id); };
};
VIEWS.pick = function () {
  title('Харилцагч сонгох');
  if (!S.data) { $('v').innerHTML = '<div class="card">Эхлээд «Нүүр» → «Мэдээлэл татах».</div>'; return; }
  $('v').innerHTML = '<button class="btn w" id="pNew" style="margin:0 0 10px">+ Бүртгэлгүй шинэ харилцагч</button>' + custFilters() + '<div class="card" id="cl" style="margin-top:10px">' + custListHtml(custRows()) + '</div>';
  $('pNew').onclick = function () { startSurvey(null); };
  bindCust(VIEWS.pick, function (id) { startSurvey(id); });
};

/* ---------------- Судалгаа ---------------- */
function startSurvey(custId) {
  var d = S.data, c = custId ? d.customers.filter(function (x) { return x.id === custId; })[0] : null, s = custId ? d.lastSurvey[custId] : null;
  var dr = { client_uid: uid(), cust_id: custId || '', cust_name: c ? c.name : '', new_customer: custId ? null : { name: '', ttd: '' }, date: today(),
             aimag: (c && c.aimag) || '', sum: (c && c.sum) || '', lat: (c && c.lat) || '', lng: (c && c.lng) || '', photos: [], fleet: [] };
  // Өмнөх судалгааны утгыг эхлэлд авна (жилээс жилд ихэвчлэн бага өөрчлөгддөг)
  if (s) ['total_ha', 'tech_mode', 'rent', 'finance', 'expand_ha'].concat(CROPS.map(function (k) { return k[0]; })).forEach(function (k) { if (s[k] !== undefined && s[k] !== '') dr[k] = s[k]; });
  if (!dr.tech_mode) dr.tech_mode = 'Уламжлалт';
  // Холбоо барих хүмүүс: өмнөх судалгаанаас авна, хуучин хэлбэрийг (нэг нэр, утас) хөрвүүлнэ
  var cts = [];
  if (s && s.contacts) { try { cts = JSON.parse(s.contacts); } catch (e) { cts = []; } }
  else if (s && (s.decision_maker || s.phone)) cts = [{ name: s.decision_maker || '', role: '', phones: String(s.phone || '').split(/[,;]/).map(function (x) { return x.trim(); }).filter(String), dm: true }];
  while (cts.length < MIN_CONTACTS) cts.push({ name: '', role: '', phones: [''], dm: false });
  cts.forEach(function (c) { if (!c.phones || !c.phones.length) c.phones = ['']; });
  dr.contacts = cts;
  if (custId) dr.fleet = d.fleet.filter(function (m) { return m.cust_id === custId; }).map(function (m) {
    return { id: m.id, mtype: m.mtype, brand: m.brand, model: m.model, norm_id: m.norm_id, product_code: m.product_code, ours: m.ours === true || m.ours === 'TRUE' || m.ours === 'true',
             year_made: m.year_made, spec: m.spec, hours: m.hours, cond: m.cond, breakdown: m.breakdown === true || m.breakdown === 'TRUE' || m.breakdown === 'true', last_ha: '', replace_plan: m.replace_plan || '' };
  });
  S.draft = dr;
  kv.set('draft', dr);
  show('survey', null, true);
}
function draftSave() { if (S.draft) kv.set('draft', S.draft); }
function sumOptions(aimag) { var l = (S.data && S.data.sums && S.data.sums[aimag]) || []; return l.map(function (x) { return '<option value="' + esc(x) + '">'; }).join(''); }

VIEWS.survey = function () {
  var dr = S.draft, L = S.data.lists;
  title(dr.cust_name || 'Шинэ харилцагч');
  var h = '';
  if (!dr.cust_id) h += '<div class="card"><h3>Шинэ харилцагч</h3><label>Нэр (компани, хоршоо, иргэн)</label><input data-n="nc_name" value="' + esc(dr.new_customer.name) + '"><label>ТТД / регистр</label><input data-n="nc_ttd" inputmode="numeric" value="' + esc(dr.new_customer.ttd) + '"></div>';
  // А. Аж ахуй
  h += '<div class="sec">А. Аж ахуй</div><div class="card"><div class="g2"><div><label>Аймаг</label><select data-f="aimag"><option value="">—</option>' + opts(MN_GEO.aimags, dr.aimag) + '</select></div>' +
    '<div><label>Сум</label><input data-f="sum" list="sumL" value="' + esc(dr.sum) + '"><datalist id="sumL">' + sumOptions(dr.aimag) + '</datalist></div></div>' +
    '<button class="btn sm" id="gps" style="margin-top:10px">📍 Байршил авах</button> <span class="small muted" id="gpsT">' + (dr.lat ? Number(dr.lat).toFixed(4) + ', ' + Number(dr.lng).toFixed(4) : 'GPS-гүй') + '</span>' +
    '<div class="g2">' + CROPS.map(function (k) { return '<div><label>' + k[1] + ', га</label><input data-f="' + k[0] + '" inputmode="decimal" value="' + esc(dr[k[0]]) + '"></div>'; }).join('') + '</div>' +
    '<div class="g2"><div><label>Нийт талбай, га</label><input data-f="total_ha" inputmode="decimal" value="' + esc(dr.total_ha) + '" placeholder="авто"></div><div><label>Ирэх жил тэлэх, га</label><input data-f="expand_ha" inputmode="decimal" value="' + esc(dr.expand_ha) + '"></div></div>' +
    '<label>Технологи</label><select data-f="tech_mode">' + opts(L.techModes, dr.tech_mode) + '</select>' +
    '<label>Техник түрээс</label><select data-f="rent">' + opts(RENT, dr.rent) + '</select></div>';
  // Б. Техник
  h += '<div class="sec">Б. Техникийн парк</div><div id="fl">' + dr.fleet.map(machHtml).join('') + '</div><button class="btn w" id="addM">+ Техник нэмэх</button>';
  // В. Ярилцлага
  h += '<div class="sec">В. Холбоо барих хүмүүс <span class="small muted">(дор хаяж ' + MIN_CONTACTS + ')</span></div><div id="ct">' + dr.contacts.map(contactHtml).join('') + '</div><button class="btn w" id="addC">+ Хүн нэмэх</button>';
  h += '<div class="sec">Г. Ярилцлага</div><div class="card">' +
    '<label>Санхүүжилт</label><select data-f="finance">' + opts(FINANCE, dr.finance) + '</select>' +
    '<label>Аль ажил хамгийн хүнд / удаан байна?</label><select data-f="hardest">' + opts([''].concat(L.works), dr.hardest) + '</select>' +
    '<label>Ямар техник сонирхож байна?</label><input data-f="interest" list="prodL" value="' + esc(dr.interest) + '"><datalist id="prodL">' + S.data.products.map(function (p) { return '<option value="' + esc(p.name) + '">'; }).join('') + '</datalist>' +
    '<label>Хэзээ авах вэ?</label><select data-f="interest_when">' + opts(WHEN, dr.interest_when) + '</select>' +
    '<label>Тэмдэглэл</label><textarea data-f="note" rows="3">' + esc(dr.note) + '</textarea>' +
    '<label>Зураг (талбай, техник)</label><div class="photos" id="ph">' + dr.photos.map(function (p, i) { return '<img src="data:image/jpeg;base64,' + p.b64 + '" data-i="' + i + '">'; }).join('') + '</div>' +
    '<input type="file" accept="image/*" capture="environment" id="phIn" class="hidden"><button class="btn sm" id="phB" style="margin-top:8px">📷 Зураг нэмэх</button></div>';
  h += '<div class="sticky-save"><button class="btn p w" id="svSave">Хадгалах</button><button class="btn d w" id="svDrop">Цуцлах</button></div>';
  $('v').innerHTML = h;
  bindSurvey();
};
function contactHtml(c, i) {
  return '<div class="mach" data-ci="' + i + '"><div class="h"><b class="grow">' + (i + 1) + '. ' + esc(c.name || 'Холбоо барих хүн') + '</b>' +
    (S.draft.contacts.length > MIN_CONTACTS ? '<button class="btn sm d" data-cx="rm">Хасах</button>' : '') + '</div>' +
    '<div class="g2"><div><label>Овог нэр</label><input data-ck="name" value="' + esc(c.name) + '"></div><div><label>Албан тушаал / хамаарал</label><select data-ck="role">' + opts(ROLES, c.role) + '</select></div></div>' +
    '<label>Утасны дугаар</label>' + c.phones.map(function (p, j) {
      return '<div class="row" style="margin-bottom:6px"><input class="grow" type="tel" inputmode="tel" data-cp="' + j + '" value="' + esc(p) + '" placeholder="99112233">' +
        (c.phones.length > 1 ? '<button class="btn sm" data-cpx="' + j + '">✕</button>' : '') + '</div>';
    }).join('') + '<button class="btn sm" data-cx="ph">+ Утас нэмэх</button>' +
    '<label class="chk"><input type="checkbox" data-ck="dm"' + (c.dm ? ' checked' : '') + '> Худалдан авалтын шийдвэр гаргагч</label></div>';
}
function redrawContacts() { $('ct').innerHTML = S.draft.contacts.map(contactHtml).join(''); bindContacts(); draftSave(); }
function bindContacts() {
  Array.prototype.forEach.call(document.querySelectorAll('[data-ci]'), function (box) {
    var i = Number(box.getAttribute('data-ci')), c = S.draft.contacts[i];
    Array.prototype.forEach.call(box.querySelectorAll('[data-ck]'), function (el) {
      el.addEventListener('change', function () { var k = el.getAttribute('data-ck'); c[k] = el.type === 'checkbox' ? el.checked : el.value; if (k === 'name') box.querySelector('.h b').textContent = (i + 1) + '. ' + (c.name || 'Холбоо барих хүн'); draftSave(); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-cp]'), function (el) {
      el.addEventListener('change', function () { c.phones[Number(el.getAttribute('data-cp'))] = el.value.trim(); draftSave(); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-cpx]'), function (b) { b.onclick = function () { c.phones.splice(Number(b.getAttribute('data-cpx')), 1); redrawContacts(); }; });
    Array.prototype.forEach.call(box.querySelectorAll('[data-cx]'), function (b) {
      b.onclick = function () { if (b.getAttribute('data-cx') === 'ph') c.phones.push(''); else S.draft.contacts.splice(i, 1); redrawContacts(); };
    });
  });
}
function machHtml(m, i) {
  var L = S.data.lists;
  var norms = S.data.norms.filter(function (n) { return n.mtype === m.mtype || (L.mtypeWork[m.mtype] && n.work === L.mtypeWork[m.mtype]); });
  return '<div class="mach' + (m.removed ? ' rm' : '') + '" data-m="' + i + '"><div class="h"><b class="grow">' + esc([m.brand, m.model].filter(String).join(' ') || m.mtype || 'Шинэ техник') + '</b>' +
    (m.removed ? '<button class="btn sm" data-x="undo">Сэргээх</button>' : '<button class="btn sm d" data-x="rm">' + (m.id ? 'Байхгүй болсон' : 'Хасах') + '</button>') + '</div>' +
    (m.removed ? '' : '<div class="g2"><div><label>Төрөл</label><select data-k="mtype">' + opts([''].concat(L.mtypes), m.mtype) + '</select></div><div><label>Үйлдвэрлэсэн он</label><input data-k="year_made" inputmode="numeric" value="' + esc(m.year_made) + '"></div>' +
    '<div><label>Брэнд</label><input data-k="brand" value="' + esc(m.brand) + '"></div><div><label>Загвар</label><input data-k="model" list="mdl' + i + '" value="' + esc(m.model) + '"><datalist id="mdl' + i + '">' + norms.map(function (n) { return '<option value="' + esc(n.model) + '">'; }).join('') + '</datalist></div></div>' +
    '<label>Норм (үйлдвэрлэгчийн улирлын, га)</label><select data-k="norm_id"><option value="">' + (norms.length ? 'Сонгох… (байхгүй бол хоосон үлдээ)' : 'Энэ төрөлд норм оруулаагүй') + '</option>' + norms.map(function (n) { return '<option value="' + esc(n.id) + '"' + (n.id === m.norm_id ? ' selected' : '') + '>' + esc(n.model) + ' · ' + fmt(n.norm_ha) + ' га' + (n.spec ? ' · ' + esc(n.spec) : '') + '</option>'; }).join('') + '</select>' +
    '<div class="g2"><div><label>Үзүүлэлт (жатка, м.х., өргөн)</label><input data-k="spec" value="' + esc(m.spec) + '"></div><div><label>Өнгөрсөн улиралд ажилласан, га</label><input data-k="last_ha" inputmode="decimal" value="' + esc(m.last_ha) + '"></div></div>' +
    '<label>Байдал (1 = ажиллахгүй, 5 = шинэ)</label><div class="stars">' + [1, 2, 3, 4, 5].map(function (k) { return '<a data-c="' + k + '" class="' + (String(m.cond) === String(k) ? 'on' : '') + '">' + k + '</a>'; }).join('') + '</div>' +
    '<label>Солих төлөвлөгөө</label><select data-k="replace_plan">' + opts(REPLACE, m.replace_plan) + '</select>' +
    '<label class="chk"><input type="checkbox" data-k="breakdown"' + (m.breakdown ? ' checked' : '') + '> Энэ улиралд том эвдрэл гарсан</label>' +
    '<label class="chk"><input type="checkbox" data-k="ours"' + (m.ours ? ' checked' : '') + '> Агромаштехээс авсан</label>') + '</div>';
}
function bindSurvey() {
  var dr = S.draft;
  Array.prototype.forEach.call(document.querySelectorAll('[data-f]'), function (el) {
    el.addEventListener('change', function () {
      var k = el.getAttribute('data-f'); dr[k] = el.value;
      if (k === 'total_ha') dr._totalManual = el.value !== '';
      if (k === 'aimag') { var dl = $('sumL'); dl.innerHTML = sumOptions(el.value); }
      if (CROPS.some(function (c) { return c[0] === k; })) autoTotal();
      draftSave();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-n]'), function (el) {
    el.addEventListener('change', function () { dr.new_customer[el.getAttribute('data-n') === 'nc_name' ? 'name' : 'ttd'] = el.value; draftSave(); });
  });
  bindFleet();
  bindContacts();
  $('addC').onclick = function () { S.draft.contacts.push({ name: '', role: '', phones: [''], dm: false }); redrawContacts(); };
  $('addM').onclick = function () { dr.fleet.push({ mtype: '', cond: '', ours: false, breakdown: false }); redrawFleet(); };
  $('gps').onclick = function () {
    if (!navigator.geolocation) return toast('GPS алга', true);
    $('gpsT').textContent = 'Хайж байна…';
    navigator.geolocation.getCurrentPosition(function (p) {
      dr.lat = p.coords.latitude.toFixed(5); dr.lng = p.coords.longitude.toFixed(5);
      var a = MN_GEO.aimagAt(p.coords.latitude, p.coords.longitude);
      $('gpsT').textContent = dr.lat + ', ' + dr.lng + (a ? ' · ' + a : '');
      if (a && !dr.aimag) { dr.aimag = a; document.querySelector('[data-f="aimag"]').value = a; $('sumL').innerHTML = sumOptions(a); }
      else if (a && dr.aimag !== a) toast('GPS-ээр ' + a + ' аймаг байна. Шалгана уу.');
      draftSave();
    }, function (e) { $('gpsT').textContent = 'GPS авч чадсангүй'; }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  };
  $('phB').onclick = function () { if (dr.photos.length >= 4) return toast('4 хүртэл зураг', true); $('phIn').click(); };
  $('phIn').onchange = function () {
    var f = this.files[0]; this.value = ''; if (!f) return;
    shrink(f).then(function (b64) { dr.photos.push({ b64: b64, mime: 'image/jpeg' }); draftSave(); $('ph').innerHTML = dr.photos.map(function (p, i) { return '<img src="data:image/jpeg;base64,' + p.b64 + '" data-i="' + i + '">'; }).join(''); bindPh(); }).catch(function () { toast('Зураг уншиж чадсангүй', true); });
  };
  bindPh();
  $('svSave').onclick = saveSurvey;
  $('svDrop').onclick = function () { if (!confirm('Энэ судалгааг цуцлах уу?')) return; S.draft = null; kv.del('draft'); back(); };
}
function bindPh() { Array.prototype.forEach.call(document.querySelectorAll('#ph img'), function (im) { im.onclick = function () { if (confirm('Зургийг устгах уу?')) { S.draft.photos.splice(Number(im.getAttribute('data-i')), 1); draftSave(); im.remove(); } }; }); }
function autoTotal() {
  var dr = S.draft, el = document.querySelector('[data-f="total_ha"]');
  var t = CROPS.reduce(function (s, k) { return s + (k[0] === 'hay_ha' ? 0 : num(dr[k[0]])); }, 0);
  if (!dr._totalManual) { dr.total_ha = t || ''; el.value = dr.total_ha; }
}
function redrawFleet() { $('fl').innerHTML = S.draft.fleet.map(machHtml).join(''); bindFleet(); draftSave(); }
function bindFleet() {
  Array.prototype.forEach.call(document.querySelectorAll('.mach'), function (box) {
    var m = S.draft.fleet[Number(box.getAttribute('data-m'))];
    Array.prototype.forEach.call(box.querySelectorAll('[data-k]'), function (el) {
      el.addEventListener('change', function () {
        var k = el.getAttribute('data-k');
        m[k] = el.type === 'checkbox' ? el.checked : el.value;
        if (k === 'mtype') return redrawFleet();
        if (k === 'model' && !m.norm_id) { var n = S.data.norms.filter(function (x) { return x.model === el.value; })[0]; if (n) { m.norm_id = n.id; if (n.code) m.product_code = n.code; if (!m.brand) m.brand = n.brand; return redrawFleet(); } }
        if (k === 'norm_id') { var nn = S.data.norms.filter(function (x) { return x.id === el.value; })[0]; if (nn && nn.code) m.product_code = nn.code; }
        draftSave();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('.stars a'), function (a) { a.onclick = function () { m.cond = a.getAttribute('data-c'); Array.prototype.forEach.call(box.querySelectorAll('.stars a'), function (b) { b.className = b === a ? 'on' : ''; }); draftSave(); }; });
    Array.prototype.forEach.call(box.querySelectorAll('[data-x]'), function (b) {
      b.onclick = function () {
        var i = Number(box.getAttribute('data-m'));
        if (b.getAttribute('data-x') === 'undo') m.removed = false;
        else if (m.id) m.removed = true; else S.draft.fleet.splice(i, 1);
        redrawFleet();
      };
    });
  });
}
function shrink(file) {
  return new Promise(function (res, rej) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var max = 1280, w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
      var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.7).split(',')[1]);
    };
    img.onerror = rej; img.src = url;
  });
}
function saveSurvey() {
  var dr = S.draft;
  if (!dr.cust_id && !(dr.new_customer.name || '').trim()) return toast('Харилцагчийн нэрийг бичнэ үү', true);
  if (!dr.aimag) return toast('Аймгаа сонгоно уу', true);
  var hasArea = CROPS.some(function (k) { return num(dr[k[0]]) > 0; });
  if (!hasArea && !dr.fleet.length) return toast('Талбай эсвэл техникийн мэдээлэл оруулна уу', true);
  var bad = dr.fleet.filter(function (m) { return !m.removed && !m.mtype; });
  if (bad.length) return toast('Техникийн төрлийг сонгоно уу', true);
  var cts = (dr.contacts || []).map(function (c) { return { name: (c.name || '').trim(), role: c.role || '', dm: !!c.dm, phones: c.phones.map(function (p) { return String(p || '').trim(); }).filter(function (p) { return digits(p).length > 0; }) }; })
    .filter(function (c) { return c.name || c.phones.length; });
  var badPh = cts.filter(function (c) { return c.phones.some(function (p) { return digits(p).length < 6; }); })[0];
  if (badPh) return toast((badPh.name || 'Холбоо барих хүн') + ': утасны дугаар буруу', true);
  var full = cts.filter(function (c) { return c.name && c.phones.length; });
  if (full.length < MIN_CONTACTS) return toast('Дор хаяж ' + MIN_CONTACTS + ' хүний нэр, утасны дугаар оруулна уу', true);
  if (cts.length > full.length) return toast('Холбоо барих хүн бүрт нэр, утас хоёулаа хэрэгтэй', true);
  var it = {};
  for (var k in dr) if (k.charAt(0) !== '_') it[k] = dr[k];
  ['total_ha', 'expand_ha'].concat(CROPS.map(function (c) { return c[0]; })).forEach(function (k) { if (it[k] !== undefined && it[k] !== '') it[k] = num(it[k]); });
  it.fleet = dr.fleet.map(function (m) { var o = {}; for (var k in m) o[k] = m[k]; ['year_made', 'last_ha', 'cond', 'hours'].forEach(function (x) { if (o[x] !== undefined && o[x] !== '') o[x] = num(o[x]); }); return o; });
  it.contacts = cts;
  it.state = 'pending'; it.saved_at = new Date().toISOString();
  Q.put(it).then(function () {
    // Офлайн үед ч харагдахуйц орон нутгийн өгөгдлийг шинэчилнэ
    if (dr.cust_id) {
      var c = S.data.customers.filter(function (x) { return x.id === dr.cust_id; })[0];
      if (c) { c.aimag = dr.aimag; c.sum = dr.sum; if (dr.lat) { c.lat = dr.lat; c.lng = dr.lng; } c.last_survey = dr.date; }
      kv.set('data', S.data);
    }
    S.draft = null; kv.del('draft'); qBadge();
    toast(online() ? 'Хадгаллаа, илгээж байна…' : 'Утсанд хадгаллаа. Сүлжээ орж ирэхэд илгээнэ.');
    S.stack = []; show('home');
    sync();
  }).catch(function (e) { toast('Хадгалж чадсангүй: ' + e.message, true); });
}

/* ---------------- Илгээх дараалал ---------------- */
VIEWS.queue = function () {
  title('Илгээх');
  Q.all().then(function (items) {
    var h = '<div class="card"><h3>Илгээгдээгүй (' + items.length + ')</h3>' + (items.length ? items.map(function (it) {
      return '<div class="li"><div class="grow"><div class="t">' + esc(it.cust_name || (it.new_customer && it.new_customer.name) || '') + '</div><div class="s">' + esc(it.date) + ' · ' + (it.fleet || []).length + ' техник · ' + (it.photos || []).length + ' зураг</div>' +
        (it.error ? '<div class="err">' + esc(it.error) + '</div>' : '') + '</div>' + (it.state === 'error' ? '<span class="tag bad">Алдаа</span>' : '<span class="tag warn">Хүлээгдэж байна</span>') +
        '<button class="btn sm d" data-del="' + esc(it.client_uid) + '">✕</button></div>';
    }).join('') : '<div class="muted">Бүгд илгээгдсэн.</div>') + '</div>';
    if (items.length) h += '<button class="btn p w" id="qGo">Одоо илгээх</button>';
    $('v').innerHTML = h;
    if ($('qGo')) $('qGo').onclick = function () { if (!online()) return toast('Сүлжээ алга', true); sync(); };
    Array.prototype.forEach.call(document.querySelectorAll('[data-del]'), function (b) { b.onclick = function () { if (confirm('Энэ судалгааг илгээлгүй устгах уу?')) Q.del(b.getAttribute('data-del')).then(function () { qBadge(); show('queue'); }); }; });
  });
};

/* ---------------- Газрын зураг ---------------- */
VIEWS.map = function () {
  title('Газрын зураг');
  if (!S.data) { $('v').innerHTML = '<div class="card">Эхлээд «Нүүр» → «Мэдээлэл татах».</div>'; return; }
  var cnt = {};
  S.data.customers.forEach(function (c) { if (c.aimag && (S.custTab === 'all' || c.owner === S.me.id)) cnt[c.aimag] = (cnt[c.aimag] || 0) + 1; });
  var mx = Math.max.apply(null, Object.keys(cnt).map(function (k) { return cnt[k]; }).concat([1]));
  var svg = '<svg viewBox="' + MN_GEO.viewBox + '">';
  MN_GEO.names.forEach(function (a) { var n = cnt[a] || 0; svg += '<path class="aim" data-a="' + esc(a) + '" d="' + MN_GEO.path(a) + '" fill="' + (n ? 'rgba(47,62,143,' + (0.15 + 0.6 * n / mx).toFixed(2) + ')' : '#E9EBF3') + '"' + (a === S.aimag ? ' stroke="#E88215" stroke-width="2.4"' : '') + '></path>'; });
  MN_GEO.names.forEach(function (a) { var c = MN_GEO.centroid(a); if (c && cnt[a] && a !== 'Улаанбаатар') svg += '<text x="' + c[0].toFixed(1) + '" y="' + c[1].toFixed(1) + '" font-size="10" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="middle" pointer-events="none">' + cnt[a] + '</text>'; });
  S.data.customers.forEach(function (c) { if (c.lat && c.lng && (S.custTab === 'all' || c.owner === S.me.id)) { var p = MN_GEO.toXY(Number(c.lat), Number(c.lng)); svg += '<circle class="pt" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="#F7C80A" data-id="' + esc(c.id) + '"></circle>'; } });
  if (S.here) { var q = MN_GEO.toXY(S.here[0], S.here[1]); svg += '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="5" fill="#D64545" stroke="#fff" stroke-width="1.5"></circle>'; }
  svg += '</svg>';
  $('v').innerHTML = '<div class="seg" style="margin-bottom:8px"><a data-c="mine" class="' + (S.custTab === 'mine' ? 'on' : '') + '">Миний</a><a data-c="all" class="' + (S.custTab === 'all' ? 'on' : '') + '">Бүгд</a></div>' +
    '<div class="card mapw">' + svg + '<div class="row" style="margin-top:8px"><span class="small muted grow">Аймаг дээр дарж харилцагчийг харна. Шар цэг = GPS-тэй харилцагч.</span><button class="btn sm" id="here">📍 Би хаана</button></div></div>' +
    '<div class="card" id="cl">' + (S.aimag ? '<h3>' + esc(S.aimag) + '</h3>' + custListHtml(custRows()) : '<div class="muted small">Аймаг сонгоогүй.</div>') + '</div>';
  Array.prototype.forEach.call(document.querySelectorAll('.seg a[data-c]'), function (a) { a.onclick = function () { S.custTab = a.getAttribute('data-c'); VIEWS.map(); }; });
  Array.prototype.forEach.call(document.querySelectorAll('path[data-a]'), function (p) { p.onclick = function () { S.aimag = S.aimag === p.getAttribute('data-a') ? '' : p.getAttribute('data-a'); S.q = ''; VIEWS.map(); }; });
  Array.prototype.forEach.call(document.querySelectorAll('circle[data-id]'), function (p) { p.onclick = function () { show('cust', p.getAttribute('data-id'), true); }; });
  bindRows(function (id) { show('cust', id, true); });
  $('here').onclick = function () {
    navigator.geolocation && navigator.geolocation.getCurrentPosition(function (p) {
      S.here = [p.coords.latitude, p.coords.longitude];
      var a = MN_GEO.aimagAt(S.here[0], S.here[1]); if (a) S.aimag = a;
      VIEWS.map(); toast(a ? 'Та ' + a + ' аймагт байна' : 'Монголын хилээс гадна');
    }, function () { toast('GPS авч чадсангүй', true); }, { enableHighAccuracy: true, timeout: 20000 });
  };
};

/* ---------------- Эхлэл ---------------- */
function boot() {
  netBadge();
  window.addEventListener('online', function () { netBadge(); sync(); });
  window.addEventListener('offline', netBadge);
  $('back').onclick = back;
  Array.prototype.forEach.call(document.querySelectorAll('.tabbar a'), function (a) { a.onclick = function () { tab(a.getAttribute('data-t')); }; });
  if ('serviceWorker' in navigator) {
    // Шинэ хувилбар суусан бол нэг удаа дахин ачаална (дуусаагүй судалгаа хадгалагдсан тул алдагдахгүй)
    var hadCtl = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (hadCtl && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js').then(function (r) { r.update(); }).catch(function () {});
  }
  Promise.all([kv.get('api'), kv.get('token'), kv.get('me'), kv.get('data'), kv.get('draft')]).then(function (r) {
    S.api = r[0] || window.API_URL || ''; S.token = r[1] || ''; S.me = r[2] || null; S.data = r[3] || null;
    if (!S.api) return show('setup');
    if (!S.token || !S.me) return show('login');
    qBadge();
    if (r[4] && S.data) { S.draft = r[4]; S.stack = [['home']]; show('survey'); toast('Дуусаагүй судалгааг сэргээлээ'); }
    else tab('home');
    sync();
  }).catch(function (e) { $('v').innerHTML = '<div class="card err">Утасны санах ойг нээж чадсангүй: ' + esc(e.message) + '</div>'; });
}
document.addEventListener('DOMContentLoaded', boot);
})();

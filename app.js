'use strict';
/* Phase VIII Mind Capture — reaction time (PVT), Stroop focus test, and daily check-in on the phone.
   Data stays on this phone. Export writes one small JSON file the RxBlueprint Mind tab imports (duplicates are skipped by id). */
const VER = '1.0.1', KEY = 'p8mc-v1', APP_ID = 'Phase VIII Mind Capture';
const FAST = /[?&]fast=1/.test(location.search);          // test mode: short tasks (used only for automated testing)
const PVT_MS = FAST ? 6000 : 180000, STROOP_N = FAST ? 8 : 48, PRACTICE_N = FAST ? 2 : 6, MIN_PVT = FAST ? 3 : 20;

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
const nowHM = () => { const d = new Date(); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const num = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1)); };
const r0 = v => v == null ? null : Math.round(v), r1 = v => v == null ? null : Math.round(v * 10) / 10;
const fmtD = iso => { const [y, m, d] = iso.split('-'); return Number(m) + '/' + Number(d); };

/* ---------- storage ---------- */
let S = load();
function load() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.sessions)) return Object.assign({ checkins: [], lastExport: null }, s); } catch (e) { } return { sessions: [], checkins: [], lastExport: null }; }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { alert('Could not save on this phone (storage full or blocked).'); } }

/* ---------- pure statistics (also used by the automated tests) ---------- */
function pvtStats(rts, falseStarts) {
  const v = rts.filter(x => x >= 100);                          // under 100 ms is anticipation, not a response
  return { n: v.length, medianRT: r0(median(v)), meanRT: r0(mean(v)), sdRT: r0(sd(v)), lapses: v.filter(x => x > 500).length, lapses355: v.filter(x => x > 355).length,
    rrt: v.length ? r1(mean(v.map(x => 1000 / x))) : null, falseStarts: falseStarts + rts.filter(x => x < 100).length };
}
function stroopStats(trials) {                                   // trials: [{rt, ok, cong}]
  const ok = trials.filter(t => t.ok), c = ok.filter(t => t.cong).map(t => t.rt), i = ok.filter(t => !t.cong).map(t => t.rt);
  return { n: trials.length, accuracy: trials.length ? r1(100 * ok.length / trials.length) : null, medianRT: r0(median(ok.map(t => t.rt))),
    congMedian: r0(median(c)), incongMedian: r0(median(i)), interference: (c.length >= 3 && i.length >= 3) ? r0(median(i) - median(c)) : null, errors: trials.length - ok.length };
}
function stroopPlan(n) {                                         // half congruent, half clashing, never more than 3 of one kind in a row
  const W = ['red', 'green', 'blue', 'yellow'];
  for (let tries = 0; tries < 200; tries++) {
    const kinds = Array.from({ length: n }, (_, k) => k < n / 2).sort(() => Math.random() - 0.5);
    let run = 1, bad = false; for (let k = 1; k < n; k++) { run = kinds[k] === kinds[k - 1] ? run + 1 : 1; if (run > 3) { bad = true; break; } }
    if (bad) continue;
    const out = []; let prev = '';
    for (let k = 0; k < n; k++) {
      let ink, word, g = 0; do { ink = W[Math.floor(Math.random() * 4)]; word = kinds[k] ? ink : W.filter(x => x !== ink)[Math.floor(Math.random() * 3)]; g++; } while (ink + word === prev && g < 20);
      out.push({ word, ink, cong: kinds[k] }); prev = ink + word;
    }
    return out;
  }
  return Array.from({ length: n }, (_, k) => ({ word: 'red', ink: k % 2 ? 'red' : 'blue', cong: k % 2 === 1 }));
}

/* ---------- screen state ---------- */
let screen = 'home', form = null, result = null, abortTask = null, wake = null;
const app = $('#app');
const sessionsToday = task => S.sessions.filter(s => s.date === today() && s.task === task).length;
const checkinsToday = () => S.checkins.filter(c => c.date === today()).length;

function go(s) { screen = s; render(); window.scrollTo(0, 0); }
function render() {
  if (screen === 'home') app.innerHTML = vHome();
  else if (screen === 'checkin') app.innerHTML = vCheckin();
  else if (screen === 'pvt-intro') app.innerHTML = vIntro('pvt');
  else if (screen === 'stroop-intro') app.innerHTML = vIntro('stroop');
  else if (screen === 'result') app.innerHTML = vResult();
  else if (screen === 'history') app.innerHTML = vHistory();
  else if (screen === 'export') app.innerHTML = vExport();
}

function vHome() {
  const tick = n => n ? `<span class="done">✓${n > 1 ? ' ×' + n : ''}</span>` : '';
  const last = (task) => { const a = S.sessions.filter(s => s.task === task).slice(-1)[0]; return a ? (task === 'pvt' ? `last: ${a.medianRT} ms median` : `last: ${a.interference == null ? '—' : a.interference} ms interference`) + ' · ' + fmtD(a.date) : 'not done yet'; };
  const newCount = unexported().sessions + unexported().checkins;
  return `<h1>Mind Capture <small>v${VER}</small></h1><div class="muted">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
  <button class="btn" data-a="checkin">Daily check-in ${tick(checkinsToday())}<small>mood · stress · energy · sleep · caffeine (about 1 minute)</small></button>
  <button class="btn" data-a="go" data-v="pvt-intro">Reaction test ${tick(sessionsToday('pvt'))}<small>3 minutes · ${last('pvt')}</small></button>
  <button class="btn" data-a="go" data-v="stroop-intro">Focus test (Stroop) ${tick(sessionsToday('stroop'))}<small>about 2 minutes · ${last('stroop')}</small></button>
  <div class="row" style="margin-top:8px"><button class="btn sm" data-a="go" data-v="history">History</button><button class="btn sm primary" data-a="go" data-v="export">Export${newCount ? ' (' + newCount + ' new)' : ''}</button></div>
  <p class="faint" style="margin-top:18px">Try to take the tests at a similar time and in a similar setting each day. Your own trend matters more than any single number.</p>`;
}

/* ---------- check-in ---------- */
function newForm() { return { date: today(), time: nowHM(), mood: null, stress: null, energy: null, sleepHrs: '', sleepQ: null, caffeineY: '', lastCaffY: '', hoursSinceWake: '', note: '' }; }
const scale = (k, cur, a, b) => `<div class="scale">${[1, 2, 3, 4, 5].map(v => `<button type="button" class="${cur === v ? 'on' : ''}" data-a="pick" data-k="${k}" data-v="${v}">${v}</button>`).join('')}</div>${a ? `<div class="ends"><span>${a}</span><span>${b}</span></div>` : ''}`;
function vCheckin() {
  if (!form) form = newForm(); const f = form;
  return `<div class="spread"><h1>Check-in</h1><button class="btn sm ghost" data-a="go" data-v="home">Cancel</button></div>
  <div class="card">
  <div class="field"><label>Mood</label>${scale('mood', f.mood, 'low', 'great')}</div>
  <div class="field"><label>Stress</label>${scale('stress', f.stress, 'calm', 'very stressed')}</div>
  <div class="field"><label>Energy</label>${scale('energy', f.energy, 'drained', 'high')}</div>
  <div class="field"><label>Sleep last night (hours)</label><input type="number" inputmode="decimal" step="0.25" min="0" max="24" data-f="sleepHrs" value="${esc(f.sleepHrs)}"></div>
  <div class="field"><label>Sleep quality</label>${scale('sleepQ', f.sleepQ, 'poor', 'great')}</div>
  <div class="field"><label>Caffeine yesterday (coffee-cup equivalents)</label><input type="number" inputmode="decimal" step="0.1" min="0" data-f="caffeineY" value="${esc(f.caffeineY)}"><div class="faint" style="margin-top:4px">1 = one brewed coffee (about 95 mg). A cup of milk tea is about 0.2.</div></div>
  <div class="field"><label>Time of last cup yesterday</label><input type="time" data-f="lastCaffY" value="${esc(f.lastCaffY)}"></div>
  <div class="field"><label>Note</label><input type="text" data-f="note" value="${esc(f.note)}" placeholder="Anything unusual…"></div>
  <div class="faint">Recorded at ${esc(f.time)} on ${esc(f.date)}.</div></div>
  <button class="btn primary" data-a="save-checkin">Save check-in</button>`;
}

/* ---------- task intros / results ---------- */
function vIntro(kind) {
  const t = kind === 'pvt'
    ? { h: 'Reaction test', b: 'A red number will start counting up at random moments. <b>Tap anywhere as fast as you can</b> as soon as you see it. Don’t tap early. It lasts 3 minutes.', tips: 'Sit comfortably, silence notifications, and rest your thumb on the screen.' }
    : { h: 'Focus test (Stroop)', b: 'A color word appears. <b>Tap the button that matches the ink color</b>, not the word. For example, the word RED shown in blue ink → tap blue. Go fast but stay accurate. 6 practice rounds first, then ' + STROOP_N + ' scored.', tips: 'The four buttons are red, green, blue and yellow.' };
  return `<div class="spread"><h1>${t.h}</h1><button class="btn sm ghost" data-a="go" data-v="home">Back</button></div><div class="card"><p>${t.b}</p><p class="faint">${t.tips}</p></div>
  <button class="btn primary" data-a="start-${kind}">Start</button>`;
}
function vResult() {
  const r = result; if (!r) return '';
  const rec = r.rec, prev = S.sessions.filter(s => s.task === rec.task).slice(-7);
  let cmp = '';
  if (rec.task === 'pvt' && prev.length >= 5) { const m = median(prev.map(s => s.medianRT)), d = rec.medianRT - m; cmp = `<p class="muted">Your usual median (last ${prev.length}): ${r0(m)} ms. Today is ${Math.abs(r0(d))} ms ${d > 0 ? 'slower' : 'faster'}.</p>`; }
  if (rec.task === 'stroop' && prev.length >= 5 && rec.interference != null) { const v = prev.map(s => s.interference).filter(x => x != null), m = median(v); if (v.length >= 5) cmp = `<p class="muted">Your usual interference (last ${v.length}): ${r0(m)} ms.</p>`; }
  const stats = rec.task === 'pvt'
    ? [['Median', rec.medianRT + ' ms'], ['Lapses', rec.lapses], ['False starts', rec.falseStarts], ['Responses', rec.n]]
    : [['Interference', (rec.interference == null ? '—' : rec.interference + ' ms')], ['Accuracy', rec.accuracy + '%'], ['Median', rec.medianRT + ' ms'], ['Trials', rec.n]];
  return `<h1>${rec.task === 'pvt' ? 'Reaction test' : 'Focus test'} done</h1><div class="card"><div class="stat">${stats.map(s => `<div><b>${s[1]}</b><span>${s[0]}</span></div>`).join('')}</div>${cmp}
  ${rec.task === 'stroop' ? '<p class="faint">Interference = how much slower you are when the word clashes with the ink. Smaller means better focus.</p>' : '<p class="faint">Lapses = responses slower than 0.5 seconds. Fewer is better.</p>'}</div>
  <button class="btn primary" data-a="result-keep">Save</button><button class="btn danger" data-a="result-drop">Discard this run</button>`;
}

/* ---------- reaction test (PVT) ---------- */
async function keepAwake() { try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch (e) { } }
function releaseAwake() { try { if (wake) wake.release(); } catch (e) { } wake = null; }
function overlay(html) { const d = document.createElement('div'); d.className = 'task'; d.innerHTML = html; document.body.appendChild(d); return d; }
function startPVT() {
  keepAwake();
  const isiMin = FAST ? 300 : 2000, isiMax = FAST ? 700 : 10000;
  const el = overlay(`<div class="top"><span>Reaction test</span><button class="btn sm ghost" id="x" style="margin:0">Quit</button></div><div class="bar"><i id="pb"></i></div><div class="pvt-num" id="num"></div><div class="pvt-msg" id="msg">Wait for the number…</div>`);
  const num = el.querySelector('#num'), msg = el.querySelector('#msg'), pb = el.querySelector('#pb');
  const st = { t0: performance.now(), rts: [], fs: 0, state: 'wait', stim: 0, timer: null, raf: 0, done: false, startHM: nowHM(), date: today() };
  const clean = () => { st.done = true; clearTimeout(st.timer); cancelAnimationFrame(st.raf); document.removeEventListener('visibilitychange', onHide); el.remove(); releaseAwake(); abortTask = null; };
  const onHide = () => { if (document.hidden) { clean(); toastMsg('Test interrupted — not saved'); go('home'); } };
  document.addEventListener('visibilitychange', onHide);
  abortTask = () => clean();
  el.querySelector('#x').addEventListener('pointerdown', e => { e.stopPropagation(); clean(); go('home'); });
  const finish = () => {
    clean(); const s = pvtStats(st.rts, st.fs);
    if (s.n < MIN_PVT) { toastMsg('Too few responses — run not saved'); go('home'); return; }
    result = { rec: Object.assign({ id: uid(), date: st.date, time: st.startHM, device: 'iphone', task: 'pvt', durSec: Math.round(PVT_MS / 1000), seq: S.sessions.filter(x => x.task === 'pvt').length + 1 }, s) }; go('result');
  };
  const schedule = () => {
    if (st.done) return; st.state = 'wait'; num.textContent = ''; msg.textContent = 'Wait for the number…';
    if (performance.now() - st.t0 >= PVT_MS) { finish(); return; }
    st.timer = setTimeout(show, isiMin + Math.random() * (isiMax - isiMin));
  };
  const tick = () => { if (st.done || st.state !== 'go') return; num.textContent = Math.round(performance.now() - st.stim); st.raf = requestAnimationFrame(tick); };
  const show = () => { if (st.done) return; if (performance.now() - st.t0 >= PVT_MS) { finish(); return; } st.state = 'go'; msg.textContent = ''; st.stim = performance.now(); tick(); };
  el.addEventListener('pointerdown', e => {
    if (st.done) return; const t = performance.now();
    if (st.state === 'wait') { st.fs++; clearTimeout(st.timer); num.textContent = ''; msg.textContent = 'Too early — wait for the number'; st.state = 'fb'; st.timer = setTimeout(schedule, 1200); }
    else if (st.state === 'go') { cancelAnimationFrame(st.raf); const rt = t - st.stim; st.state = 'fb'; num.textContent = Math.round(rt); if (rt < 100) { st.fs++; msg.textContent = 'Too early'; } else st.rts.push(rt); st.timer = setTimeout(schedule, 700); }
  });
  const loop = setInterval(() => { if (st.done) { clearInterval(loop); return; } pb.style.width = Math.min(100, 100 * (performance.now() - st.t0) / PVT_MS) + '%'; }, 250);
  schedule();
}

/* ---------- focus test (Stroop) ---------- */
const INK = { red: '#e5484d', green: '#30a46c', blue: '#3e63dd', yellow: '#f5d90a' };
function startStroop() {
  keepAwake();
  const el = overlay(`<div class="top"><span id="lab">Practice</span><button class="btn sm ghost" id="x" style="margin:0">Quit</button></div><div class="bar"><i id="pb"></i></div>
    <div class="stroop-word" id="w"></div><div class="fb" id="fb"></div>
    <div class="stroop-btns">${Object.keys(INK).map(k => `<button data-c="${k}" style="background:${INK[k]}" aria-label="${k}"></button>`).join('')}</div>`);
  const w = el.querySelector('#w'), fb = el.querySelector('#fb'), pb = el.querySelector('#pb'), lab = el.querySelector('#lab');
  const plan = stroopPlan(PRACTICE_N).map(t => Object.assign(t, { practice: true })).concat(stroopPlan(STROOP_N));
  const st = { i: -1, cur: null, onset: 0, trials: [], done: false, timer: null, startHM: nowHM(), date: today(), accepting: false };
  const clean = () => { st.done = true; clearTimeout(st.timer); document.removeEventListener('visibilitychange', onHide); el.remove(); releaseAwake(); abortTask = null; };
  const onHide = () => { if (document.hidden) { clean(); toastMsg('Test interrupted — not saved'); go('home'); } };
  document.addEventListener('visibilitychange', onHide); abortTask = () => clean();
  el.querySelector('#x').addEventListener('pointerdown', e => { e.stopPropagation(); clean(); go('home'); });
  const next = () => {
    if (st.done) return; st.i++; if (st.i >= plan.length) { finish(); return; }
    const t = plan[st.i]; st.cur = t; st.accepting = false; w.textContent = '+'; w.style.color = '#6d7078'; fb.textContent = '';
    lab.textContent = t.practice ? 'Practice' : 'Trial ' + (st.i - PRACTICE_N + 1) + ' of ' + STROOP_N; pb.style.width = (t.practice ? 0 : 100 * (st.i - PRACTICE_N) / STROOP_N) + '%';
    st.timer = setTimeout(() => { if (st.done) return; w.textContent = t.word.toUpperCase(); w.style.color = INK[t.ink]; st.onset = performance.now(); st.accepting = true; st.timer = setTimeout(() => answer(null), 5000); }, 500);
  };
  const answer = c => {
    if (!st.accepting || st.done) return; st.accepting = false; clearTimeout(st.timer);
    const t = st.cur, rt = performance.now() - st.onset, ok = c === t.ink;
    if (!t.practice) st.trials.push({ rt, ok, cong: t.cong });
    fb.textContent = t.practice ? (ok ? 'Correct' : (c ? 'Wrong — the ink was ' + t.ink : 'Too slow')) : ''; fb.style.color = ok ? '#4cb782' : '#e2685b';
    w.textContent = ''; st.timer = setTimeout(next, t.practice ? 900 : 250);
  };
  el.querySelectorAll('.stroop-btns button').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); answer(b.dataset.c); }));
  const finish = () => {
    clean(); const s = stroopStats(st.trials);
    result = { rec: Object.assign({ id: uid(), date: st.date, time: st.startHM, device: 'iphone', task: 'stroop', seq: S.sessions.filter(x => x.task === 'stroop').length + 1 }, s) }; go('result');
  };
  next();
}

/* ---------- history ---------- */
function vHistory() {
  const items = S.sessions.map(s => ({ k: 's', t: s.date + ' ' + (s.time || ''), s })).concat(S.checkins.map(c => ({ k: 'c', t: c.date + ' ' + (c.time || ''), c }))).sort((a, b) => b.t.localeCompare(a.t)).slice(0, 40);
  const line = it => it.k === 's'
    ? (it.s.task === 'pvt' ? `Reaction · median <b>${it.s.medianRT}</b> ms · ${it.s.lapses} lapses` : `Focus · interference <b>${it.s.interference == null ? '—' : it.s.interference}</b> ms · ${it.s.accuracy}% correct`)
    : `Check-in · mood <b>${it.c.mood}</b> · stress <b>${it.c.stress}</b> · energy <b>${it.c.energy}</b>`;
  return `<div class="spread"><h1>History</h1><button class="btn sm ghost" data-a="go" data-v="home">Back</button></div><div class="card">${items.length ? items.map(it => `<div class="hist"><div class="spread"><span>${line(it)}</span><button class="btn sm ghost danger" data-a="del" data-k="${it.k}" data-id="${esc((it.s || it.c).id)}">Delete</button></div><div class="faint">${fmtD(it.t.slice(0, 10))} ${esc(it.t.slice(11))}</div></div>`).join('') : '<div class="muted">Nothing recorded yet.</div>'}</div>`;
}

/* ---------- export ---------- */
function unexported() { const t = S.lastExport || ''; return { sessions: S.sessions.filter(s => (s.savedAt || '') > t).length, checkins: S.checkins.filter(c => (c.savedAt || '') > t).length }; }
function buildExport() { return { app: APP_ID, version: 1, exportedAt: new Date().toISOString(), sessions: S.sessions, checkins: S.checkins }; }
function vExport() {
  const u = unexported(), total = S.sessions.length + S.checkins.length;
  return `<div class="spread"><h1>Export</h1><button class="btn sm ghost" data-a="go" data-v="home">Back</button></div>
  <div class="card"><p>${total} records on this phone (${S.sessions.length} test sessions, ${S.checkins.length} check-ins). <span class="copper">${u.sessions + u.checkins} not exported yet.</span></p>
  <p class="faint">The file always contains everything, so importing it twice is harmless — RxBlueprint skips what it already has.</p></div>
  <button class="btn primary" data-a="do-export" ${total ? '' : 'disabled'}>Export to Files / Mail…</button>
  <div class="card"><h2>Then</h2><p class="muted">In the share sheet choose <b>Save to Files</b> (or Mail to yourself), get the file to the laptop, and in RxBlueprint go to <b>Mind → Data &amp; files → Choose phone export</b>.</p>
  ${S.lastExport ? `<p class="faint">Last exported: ${new Date(S.lastExport).toLocaleString()}</p>` : ''}</div>`;
}
async function doExport() {
  const d = new Date(), name = 'mind-capture-' + today() + '-' + p2(d.getHours()) + p2(d.getMinutes()) + '.json', text = JSON.stringify(buildExport(), null, 2);
  const file = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Mind Capture export' });
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    S.lastExport = new Date().toISOString(); save(); toastMsg('Exported'); render();
  } catch (e) { if (e && e.name !== 'AbortError') toastMsg('Could not export — try again'); }
}

/* ---------- toast + events ---------- */
function toastMsg(t) { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 26px);transform:translateX(-50%);background:#2b2f37;color:#e8e6e1;padding:11px 18px;border-radius:12px;z-index:20;font-size:15px;max-width:90%;text-align:center'; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]'); if (!el) return; const a = el.dataset.a, v = el.dataset.v;
  switch (a) {
    case 'go': go(v); break;
    case 'checkin': form = newForm(); go('checkin'); break;
    case 'pick': form[el.dataset.k] = form[el.dataset.k] === Number(v) ? null : Number(v); render(); break;
    case 'save-checkin': {
      const f = form; if (!f.mood || !f.stress || !f.energy) { toastMsg('Pick mood, stress and energy first'); return; }
      const sh = num(f.sleepHrs); if (sh != null && (sh < 0 || sh > 24)) { toastMsg('Sleep hours should be between 0 and 24'); return; }
      S.checkins.push({ id: uid(), date: f.date, time: f.time, device: 'iphone', mood: f.mood, stress: f.stress, energy: f.energy, sleepHrs: sh, sleepQ: f.sleepQ || null, caffeineY: num(f.caffeineY), lastCaffY: f.lastCaffY || '', hoursSinceWake: num(f.hoursSinceWake), note: String(f.note || '').trim(), savedAt: new Date().toISOString() });
      save(); form = null; toastMsg('Check-in saved'); go('home'); break; }
    case 'start-pvt': startPVT(); break;
    case 'start-stroop': startStroop(); break;
    case 'result-keep': result.rec.savedAt = new Date().toISOString(); S.sessions.push(result.rec); save(); result = null; toastMsg('Saved'); go('home'); break;
    case 'result-drop': result = null; go('home'); break;
    case 'del': if (confirm('Delete this record?')) { if (el.dataset.k === 's') S.sessions = S.sessions.filter(x => x.id !== el.dataset.id); else S.checkins = S.checkins.filter(x => x.id !== el.dataset.id); save(); render(); } break;
    case 'do-export': doExport(); break;
  }
});
document.addEventListener('input', e => { const el = e.target; if (el.dataset && el.dataset.f && form) form[el.dataset.f] = el.value; });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
window.__mc = { pvtStats, stroopStats, stroopPlan, buildExport, getState: () => S };   // for automated tests
render();

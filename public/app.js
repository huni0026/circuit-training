// 서킷 트레이닝 타이머 — 화면 제어 + 타이머 엔진 + 소리

const PHASE_LABEL = {
  warmup: '준비운동', work: '운동', transition: '전환',
  rest: '휴식', cooldown: '마무리', recovery: '회복',
};

const SETTING_ROWS = [
  { group: '준비운동', key: 'warmupMin', label: '준비운동 시간', zero: '생략' },
  { group: '본운동', key: 'workSec', label: '각 동작 시간' },
  { group: '본운동', key: 'transitionSec', label: '동작 전환 시간', zero: '없음' },
  { group: '본운동', key: 'rounds', label: '바퀴 수' },
  { group: '본운동', key: 'roundRestSec', label: '바퀴 사이 휴식', zero: '없음' },
  { group: '마무리', key: 'cooldownMin', label: '마무리 시간', zero: '생략' },
  { group: '토요일 회복', key: 'recoveryMin', label: '회복 운동 시간' },
];

let data = DataStore.defaults();
let selectedDay = todayKey();
const excluded = {}; // { mon: Set(동작 index) } — 그날만 적용, 저장 안 함

const $ = id => document.getElementById(id);

// ───────── 유틸 ─────────
function todayKey() {
  return DAY_KEYS[(new Date().getDay() + 6) % 7];
}
function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function fmtKo(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m && s) return `${m}분 ${s}초`;
  return m ? `${m}분` : `${s}초`;
}
function splitEven(total, n) {
  const base = Math.floor(total / n), out = Array(n).fill(base);
  for (let i = 0; i < total - base * n; i++) out[i]++;
  return out;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ───────── 세션 생성 ─────────
function activeMoves(dayKey) {
  const ex = excluded[dayKey] || new Set();
  return SCHEDULE.days[dayKey].moves.filter((_, i) => !ex.has(i));
}

function buildSession(dayKey) {
  const s = data.settings, day = SCHEDULE.days[dayKey], steps = [];
  if (day.type === 'rest') return steps;

  if (day.type === 'recovery') {
    const secs = splitEven(s.recoveryMin * 60, day.moves.length);
    day.moves.forEach((m, i) => steps.push({ phase: 'recovery', ...m, sec: secs[i], pos: i + 1, count: day.moves.length }));
    return steps;
  }

  if (s.warmupMin > 0) {
    const w = SCHEDULE.warmup, secs = splitEven(s.warmupMin * 60, w.length);
    w.forEach((m, i) => steps.push({ phase: 'warmup', ...m, sec: secs[i], pos: i + 1, count: w.length }));
  }

  const moves = activeMoves(dayKey);
  for (let r = 1; r <= s.rounds && moves.length; r++) {
    moves.forEach((m, i) => {
      if (i > 0 && s.transitionSec > 0) {
        steps.push({ phase: 'transition', name: m.name, tip: '다음 동작 자세를 잡으세요', sec: s.transitionSec, round: r });
      }
      steps.push({ phase: 'work', ...m, sec: s.workSec, round: r, pos: i + 1, count: moves.length, first: i === 0 });
    });
    if (r < s.rounds && s.roundRestSec > 0) {
      steps.push({ phase: 'rest', name: '바퀴 휴식', tip: '물 한 모금, 호흡 가다듬기', sec: s.roundRestSec, round: r });
    }
  }

  if (s.cooldownMin > 0) {
    const c = SCHEDULE.cooldown, secs = splitEven(s.cooldownMin * 60, c.length);
    c.forEach((m, i) => steps.push({ phase: 'cooldown', ...m, sec: secs[i], pos: i + 1, count: c.length }));
  }
  return steps;
}

function calcTotal(dayKey) {
  const steps = buildSession(dayKey);
  const sum = ph => steps.filter(st => ph.includes(st.phase)).reduce((a, b) => a + b.sec, 0);
  return {
    warm: sum(['warmup']),
    main: sum(['work', 'transition', 'rest']),
    cool: sum(['cooldown']),
    recovery: sum(['recovery']),
    total: steps.reduce((a, b) => a + b.sec, 0),
    moves: activeMoves(dayKey).length,
  };
}

// ───────── 이번 주 기록 ─────────
function weekDoneDays() {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const dates = DAY_KEYS.map((_, i) => dateStr(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
  const done = new Set();
  data.history.forEach(h => {
    const i = dates.indexOf(h.date);
    if (i >= 0) done.add(DAY_KEYS[i]);
  });
  return done;
}

// ───────── 예시 영상 ─────────
function videoButton(name) {
  const n = (VIDEOS[name] || []).length;
  return `<button class="vid-btn" data-video="${esc(name)}" aria-label="${esc(name)} 예시 영상">▶ 영상${n ? ' ' + n : ''}</button>`;
}
function subLink(name) {
  return `<button class="sub-link" data-video="${esc(name)}">${esc(name)}</button>`;
}
function youtubeSearchUrl(name) {
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(name + ' 자세');
}

function openVideos(name) {
  const list = VIDEOS[name] || [];
  $('videoTitle').textContent = `${name} 예시 영상`;
  $('videoList').innerHTML = list.map(([id, title, ch, len]) => `
    <a class="vid-item" href="https://www.youtube.com/watch?v=${encodeURIComponent(id)}" target="_blank" rel="noopener">
      <span class="vid-thumb"><img src="https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg" alt="" loading="lazy"
        onerror="this.remove()"><span class="vid-len">${esc(len)}</span></span>
      <span class="vid-text"><span class="vid-title">${esc(title)}</span><span class="vid-ch">${esc(ch)}</span></span>
    </a>`).join('') || '<p class="hint">등록된 영상이 없습니다. 아래 검색 링크를 이용하세요.</p>';
  $('videoSearch').href = youtubeSearchUrl(name);
  $('videoModal').hidden = false;
}

// ───────── 시작 화면 ─────────
function renderHome() {
  const done = weekDoneDays(), today = todayKey();
  $('dayTabs').innerHTML = DAY_KEYS.map(k => `
    <button class="day-tab ${k === selectedDay ? 'on' : ''} ${k === today ? 'today' : ''}" data-day="${k}">
      <span class="d">${SCHEDULE.days[k].label}</span>
      <span class="mark">${done.has(k) ? '✔' : (k === today ? '오늘' : '')}</span>
    </button>`).join('');

  const day = SCHEDULE.days[selectedDay];
  $('dayTheme').textContent = `${day.label}요일 · ${day.theme}`;

  let body = '';
  if (day.type === 'circuit') {
    const ex = excluded[selectedDay] || new Set();
    body = `<p class="hint">본운동 서킷 — 쉬지 않고 이어서 1바퀴. 뻐근한 부위는 체크를 해제하면 오늘만 빠집니다.</p>
      <ol class="moves">${day.moves.map((m, i) => `
        <li class="${ex.has(i) ? 'off' : ''}">
          <div class="mv-row">
            <label><input type="checkbox" data-move="${i}" ${ex.has(i) ? '' : 'checked'}>
              <span class="mv-name">${esc(m.name)}</span>
              ${m.cardio ? '<span class="tag cardio">유산소</span>' : ''}
              ${m.sides ? '<span class="tag">좌/우</span>' : ''}
            </label>
            ${videoButton(m.name)}
          </div>
          <div class="mv-tip">${esc(m.tip)}</div>
        </li>`).join('')}</ol>
      <div class="sub-list"><b>준비운동</b> ${SCHEDULE.warmup.map(m => subLink(m.name)).join(' · ')}</div>
      <div class="sub-list"><b>마무리</b> ${SCHEDULE.cooldown.map(m => subLink(m.name)).join(' · ')}</div>`;
  } else if (day.type === 'recovery') {
    const secs = splitEven(data.settings.recoveryMin * 60, day.moves.length);
    body = `<p class="hint">전신 스트레칭과 맨몸 요가로 가볍게 회복하는 날입니다.</p>
      <ol class="moves">${day.moves.map((m, i) => `
        <li><div class="mv-row"><span class="mv-name">${esc(m.name)}</span>
          <span class="mv-right"><span class="mv-time">${fmt(secs[i])}</span>${videoButton(m.name)}</span></div>
        <div class="mv-tip">${esc(m.tip)}</div></li>`).join('')}</ol>`;
  } else {
    body = `<div class="rest-day">오늘은 완전 휴식일입니다.<br>충분히 쉬고 다음 주를 준비하세요.</div>`;
  }
  $('dayBody').innerHTML = body;
  renderSummary($('summary'));

  $('btnStart').hidden = day.type === 'rest';
  $('btnStart').disabled = day.type === 'circuit' && activeMoves(selectedDay).length === 0;
  $('weekInfo').textContent = `이번 주 ${done.size}일 완료`;
}

function renderSummary(el) {
  const day = SCHEDULE.days[selectedDay], t = calcTotal(selectedDay), s = data.settings;
  if (day.type === 'rest') {
    el.innerHTML = `<div class="total">휴식</div>`;
  } else if (day.type === 'recovery') {
    el.innerHTML = `<div class="sum-line">회복 운동 ${fmt(t.recovery)} <small>(${day.moves.length}개 동작)</small></div>
      <div class="total">총 ${fmt(t.total)}</div>`;
  } else {
    el.innerHTML = `
      <div class="sum-grid">
        <span>준비운동</span><b>${s.warmupMin ? fmt(t.warm) : '생략'}</b>
        <span>본운동</span><b>${fmt(t.main)}</b>
        <span>마무리</span><b>${s.cooldownMin ? fmt(t.cool) : '생략'}</b>
      </div>
      <div class="sum-detail">${t.moves}동작 × ${s.workSec}초 × ${s.rounds}바퀴 · 전환 ${s.transitionSec}초 · 바퀴 휴식 ${s.roundRestSec}초</div>
      <div class="total">총 ${fmt(t.total)}</div>`;
  }
}

// ───────── 설정 화면 ─────────
function renderSettings() {
  let html = '', group = '';
  SETTING_ROWS.forEach(r => {
    if (r.group !== group) {
      group = r.group;
      html += `<div class="set-group">${group}</div>`;
    }
    const lim = SETTING_LIMITS[r.key], v = data.settings[r.key];
    html += `<div class="set-row">
      <span>${r.label}</span>
      <div class="stepper">
        <button data-key="${r.key}" data-dir="-1" aria-label="${r.label} 줄이기" ${v <= lim.min ? 'disabled' : ''}>−</button>
        <span class="val">${v === 0 && r.zero ? r.zero : v + lim.unit}</span>
        <button data-key="${r.key}" data-dir="1" aria-label="${r.label} 늘리기" ${v >= lim.max ? 'disabled' : ''}>+</button>
      </div></div>`;
  });
  $('setRows').innerHTML = html;
  $('optSound').checked = data.settings.sound;
  $('optVoice').checked = data.settings.voice;
  $('setDayName').textContent = `${SCHEDULE.days[selectedDay].label}요일 기준`;
  renderSummary($('setSummary'));
}

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => DataStore.save(data), 400);
}

function renderNetStatus(st) {
  const el = $('netStatus');
  const map = {
    online: ['PC에 저장됨', 'ok'],
    offline: ['서버 연결 안 됨 · 임시 저장', 'warn'],
    connecting: ['연결 중…', ''],
  };
  const [text, cls] = map[st] || map.connecting;
  el.textContent = text;
  el.className = 'chip ' + cls;
  $('dataStatus').textContent = st === 'online'
    ? '설정과 기록이 PC의 data\\circuit-data.json 파일에 저장됩니다.'
    : '서버에 연결할 수 없어 이 기기에 임시 저장 중입니다. 서버가 다시 켜지면 자동으로 PC에 저장됩니다.';
}

// ───────── 소리 ─────────
const Sound = {
  ctx: null,
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, at, dur, type = 'sine', vol = 0.35) {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  },
  play(kind) {
    if (!data.settings.sound || !this.ctx) return;
    switch (kind) {
      case 'count': this.tone(880, 0, 0.12, 'square', 0.18); break;
      case 'work': this.tone(1320, 0, 0.55, 'square', 0.22); break;
      case 'transition': this.tone(1050, 0, 0.35, 'sine', 0.4); break;
      case 'rest': this.tone(440, 0, 0.16, 'sine', 0.45); this.tone(440, 0.22, 0.16, 'sine', 0.45); break;
      case 'phase': this.tone(660, 0, 0.18); this.tone(880, 0.2, 0.3); break;
      case 'side': this.tone(990, 0, 0.12); this.tone(990, 0.16, 0.12); break;
      case 'done': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.16, 0.4)); break;
    }
  },
};

const Voice = {
  voice: null,
  init() {
    if (!('speechSynthesis' in window)) return;
    const pick = () => {
      const list = speechSynthesis.getVoices();
      this.voice = list.find(v => v.lang && v.lang.toLowerCase().startsWith('ko')) || null;
    };
    pick();
    speechSynthesis.onvoiceschanged = pick;
  },
  say(text) {
    if (!data.settings.voice || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    if (this.voice) u.voice = this.voice;
    u.rate = 1.05;
    speechSynthesis.speak(u);
  },
};

// ───────── 화면 꺼짐 방지 ─────────
// https/localhost 에서는 Wake Lock API, 태블릿에서 http://PC주소 로 접속한 경우에는
// 화면에 보이지 않는 작은 영상을 재생해서 화면이 꺼지지 않게 함 (기기에 따라 동작하지 않을 수 있음)
const Wake = {
  lock: null, video: null, canvas: null, timer: null,
  async on() {
    if ('wakeLock' in navigator && window.isSecureContext) {
      try {
        this.lock = await navigator.wakeLock.request('screen');
        return;
      } catch { /* 아래 방식으로 */ }
    }
    try {
      if (!this.video) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.canvas.height = 2;
        this.video = document.createElement('video');
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.setAttribute('playsinline', '');
        this.video.className = 'keep-awake';
        this.video.srcObject = this.canvas.captureStream(1);
        document.body.appendChild(this.video);
      }
      const g = this.canvas.getContext('2d');
      let f = 0;
      clearInterval(this.timer);
      this.timer = setInterval(() => { g.fillStyle = (f++ % 2) ? '#000' : '#010101'; g.fillRect(0, 0, 2, 2); }, 1000);
      await this.video.play();
    } catch { /* 지원하지 않는 기기 */ }
  },
  off() {
    if (this.lock) { this.lock.release().catch(() => {}); this.lock = null; }
    clearInterval(this.timer);
    if (this.video) this.video.pause();
  },
};

// ───────── 타이머 엔진 ─────────
const T = {
  steps: [], idx: 0, stepEnd: 0, remainMs: 0, running: false,
  elapsedMs: 0, lastTick: 0, lastCount: null, sideDone: false, interval: null, day: null,
};

function stepAnnounce(st, prev) {
  const nameOf = s => s.name;
  if (st.phase === 'work') {
    Sound.play('work');
    Voice.say(st.first && T.steps.some(s => s.round > 1) ? `${st.round}바퀴, ${nameOf(st)}` : nameOf(st));
  } else if (st.phase === 'transition') {
    Sound.play('transition');
    Voice.say(`다음, ${nameOf(st)} 준비`);
  } else if (st.phase === 'rest') {
    Sound.play('rest');
    Voice.say(`휴식 ${fmtKo(st.sec)}, 다음은 ${st.round + 1}바퀴`);
  } else {
    const isFirstOfPhase = !prev || prev.phase !== st.phase;
    Sound.play(isFirstOfPhase ? 'phase' : 'transition');
    const head = isFirstOfPhase ? { warmup: '준비운동, ', cooldown: '마무리 스트레칭, ', recovery: '회복 운동, ' }[st.phase] : '';
    Voice.say(head + nameOf(st));
  }
}

function startWorkout() {
  Sound.unlock();
  T.steps = buildSession(selectedDay);
  if (!T.steps.length) return;
  T.day = selectedDay;
  T.elapsedMs = 0;
  showView('timer');
  goTo(0, true);
  play();
}

function goTo(i, announce) {
  T.idx = Math.max(0, Math.min(i, T.steps.length - 1));
  const st = T.steps[T.idx];
  T.remainMs = st.sec * 1000;
  T.stepEnd = performance.now() + T.remainMs;
  T.lastCount = null;
  T.sideDone = false;
  if (announce) stepAnnounce(st, T.steps[T.idx - 1]);
  renderTimer();
}

function play() {
  Sound.unlock();
  T.running = true;
  T.lastTick = performance.now();
  T.stepEnd = T.lastTick + T.remainMs;
  clearInterval(T.interval);
  T.interval = setInterval(tick, 100);
  Wake.on();
  renderTimer();
}

function pause() {
  if (!T.running) return;
  tick();
  T.running = false;
  T.remainMs = Math.max(0, T.stepEnd - performance.now());
  clearInterval(T.interval);
  Wake.off();
  renderTimer();
}

function stopTimer() {
  T.running = false;
  clearInterval(T.interval);
  Wake.off();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function tick() {
  if (!T.running) return;
  const now = performance.now();
  T.elapsedMs += now - T.lastTick;
  T.lastTick = now;

  // 구간 종료 → 다음 구간 (화면이 백그라운드였다면 여러 구간을 한 번에 따라잡음)
  let moved = false;
  while (now >= T.stepEnd) {
    if (T.idx >= T.steps.length - 1) return finishWorkout();
    const prev = T.steps[T.idx];
    T.idx++;
    T.stepEnd += T.steps[T.idx].sec * 1000;
    T.lastCount = null;
    T.sideDone = false;
    moved = prev;
  }
  if (moved) stepAnnounce(T.steps[T.idx], moved);

  const st = T.steps[T.idx];
  const remain = T.stepEnd - now, sec = Math.ceil(remain / 1000);
  if (sec <= 3 && sec >= 1 && sec !== T.lastCount && st.sec > 5) {
    T.lastCount = sec;
    Sound.play('count');
  }
  if (st.sides && !T.sideDone && remain <= st.sec * 500) {
    T.sideDone = true;
    Sound.play('side');
    Voice.say('반대쪽');
  }
  T.remainMs = remain;
  renderTimer();
}

function renderTimer() {
  const st = T.steps[T.idx];
  if (!st) return;
  const view = $('timer');
  view.className = 'view timer ph-' + st.phase;

  const rounds = data.settings.rounds;
  let pos = '';
  if (st.round) pos = `바퀴 ${st.round} / ${rounds}`;
  else pos = `${PHASE_LABEL[st.phase]} ${st.pos} / ${st.count}`;
  if (st.phase === 'work') pos += ` · 동작 ${st.pos} / ${st.count}`;
  $('tRound').textContent = pos;

  const total = T.steps.reduce((a, b) => a + b.sec, 0);
  const remain = T.remainMs / 1000 + T.steps.slice(T.idx + 1).reduce((a, b) => a + b.sec, 0);
  $('tLeft').textContent = `남은 시간 ${fmt(Math.ceil(remain))}`;
  $('tBarFill').style.width = `${Math.min(100, (1 - remain / total) * 100)}%`;

  $('tPhase').textContent = PHASE_LABEL[st.phase] + (st.cardio ? ' · 유산소' : '');
  $('tName').textContent = st.phase === 'transition' ? `다음 동작 준비: ${st.name}` : st.name;
  $('tTip').textContent = st.tip || '';
  $('tCount').textContent = fmt(Math.ceil(T.remainMs / 1000));
  $('tSide').textContent = st.sides ? (T.sideDone ? '반대쪽' : '한쪽 먼저 · 절반 지나면 반대쪽') : '';

  const nx = T.steps[T.idx + 1];
  let nextText = '다음: 운동 완료';
  if (nx && nx.phase === 'transition') nextText = `다음: ${nx.name} (전환 ${nx.sec}초 후)`;
  else if (nx && nx.phase === 'work') nextText = `다음: ${nx.name} (${fmt(nx.sec)})`;
  else if (nx) nextText = `다음: ${PHASE_LABEL[nx.phase]} · ${nx.name} (${fmt(nx.sec)})`;
  $('tNext').textContent = nextText;

  $('tPlay').textContent = T.running ? '❚❚ 일시정지' : '▶ 계속';
  $('tPlay').classList.toggle('paused', !T.running);
  $('tPrev').disabled = T.idx === 0;
}

function finishWorkout() {
  stopTimer();
  Sound.play('done');
  Voice.say('오늘 운동 완료! 수고하셨습니다');
  const sec = Math.round(T.elapsedMs / 1000);
  const now = new Date();
  data.history.push({
    date: dateStr(now), day: T.day, totalSec: sec,
    plannedSec: T.steps.reduce((a, b) => a + b.sec, 0), completedAt: now.toISOString(),
  });
  DataStore.save(data);
  $('doneDay').textContent = `${SCHEDULE.days[T.day].label}요일 · ${SCHEDULE.days[T.day].theme}`;
  $('doneTime').textContent = fmt(sec);
  $('doneWeek').textContent = `이번 주 ${weekDoneDays().size}일 완료`;
  showView('done');
}

// ───────── 화면 전환 ─────────
function showView(name) {
  ['home', 'timer', 'done'].forEach(v => $(v).hidden = v !== name);
  $('topbar').hidden = name !== 'home';
  if (name === 'home') renderHome();
  window.scrollTo(0, 0);
}

function openSettings() {
  renderSettings();
  $('settingsModal').hidden = false;
}
function closeSettings() {
  $('settingsModal').hidden = true;
  renderHome();
}

// ───────── 이벤트 ─────────
function bindEvents() {
  $('dayTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    selectedDay = b.dataset.day;
    renderHome();
  });

  $('dayBody').addEventListener('click', e => {
    const b = e.target.closest('[data-video]');
    if (b) openVideos(b.dataset.video);
  });
  $('btnCloseVideo').addEventListener('click', () => { $('videoModal').hidden = true; });
  $('videoModal').addEventListener('click', e => { if (e.target.id === 'videoModal') $('videoModal').hidden = true; });

  $('dayBody').addEventListener('change', e => {
    const i = e.target.dataset.move;
    if (i === undefined) return;
    const set = excluded[selectedDay] || (excluded[selectedDay] = new Set());
    if (e.target.checked) set.delete(+i); else set.add(+i);
    renderHome();
  });

  $('btnStart').addEventListener('click', startWorkout);
  $('btnSettings').addEventListener('click', openSettings);
  $('btnCloseSettings').addEventListener('click', closeSettings);
  $('settingsModal').addEventListener('click', e => { if (e.target.id === 'settingsModal') closeSettings(); });

  $('setRows').addEventListener('click', e => {
    const b = e.target.closest('[data-key]');
    if (!b) return;
    const k = b.dataset.key, lim = SETTING_LIMITS[k];
    data.settings[k] = Math.min(lim.max, Math.max(lim.min, data.settings[k] + lim.step * Number(b.dataset.dir)));
    renderSettings();
    saveSoon();
  });
  $('optSound').addEventListener('change', e => { data.settings.sound = e.target.checked; saveSoon(); });
  $('optVoice').addEventListener('change', e => { data.settings.voice = e.target.checked; saveSoon(); });
  $('btnTestSound').addEventListener('click', () => {
    Sound.unlock();
    Sound.play('work');
    Voice.say('소리 테스트입니다');
  });
  $('btnResetSettings').addEventListener('click', () => {
    if (!confirm('시간 설정을 기본값으로 되돌릴까요?')) return;
    data.settings = { ...DataStore.defaults().settings, sound: data.settings.sound, voice: data.settings.voice };
    renderSettings();
    saveSoon();
  });

  $('btnExport').addEventListener('click', () => DataStore.exportFile(data));
  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const d = await DataStore.importFile(f);
      if (!confirm(`불러온 파일로 바꿀까요?\n(운동 기록 ${d.history.length}건)`)) return;
      data = d;
      await DataStore.save(data);
      renderSettings();
    } catch {
      alert('올바른 circuit-data.json 파일이 아닙니다.');
    }
  });
  $('btnClearHistory').addEventListener('click', () => {
    if (!confirm(`운동 기록 ${data.history.length}건을 모두 지울까요?\n지운 뒤에는 되돌릴 수 없습니다.`)) return;
    data.history = [];
    DataStore.save(data);
    renderSettings();
  });

  $('tPlay').addEventListener('click', () => (T.running ? pause() : play()));
  $('tPrev').addEventListener('click', () => goTo(T.idx - 1, T.running));
  $('tNextBtn').addEventListener('click', () => {
    if (T.idx >= T.steps.length - 1) return finishWorkout();
    goTo(T.idx + 1, T.running);
  });
  $('tReset').addEventListener('click', () => {
    if (!confirm('처음부터 다시 시작할까요?')) return;
    pause();
    T.elapsedMs = 0;
    goTo(0, false);
  });
  $('tExit').addEventListener('click', () => {
    if (!confirm('운동을 그만두고 처음 화면으로 갈까요?\n(완료 기록은 남지 않습니다)')) return;
    stopTimer();
    showView('home');
  });
  $('btnDoneHome').addEventListener('click', () => showView('home'));

  document.addEventListener('keydown', e => {
    if ($('timer').hidden || e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); $('tPlay').click(); }
    if (e.code === 'ArrowRight') $('tNextBtn').click();
    if (e.code === 'ArrowLeft') $('tPrev').click();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && T.running) {
      Wake.on();
      tick();
    }
  });
}

// ───────── 시작 ─────────
async function init() {
  Voice.init();
  bindEvents();
  DataStore.onStatus = renderNetStatus;
  renderNetStatus('connecting');
  showView('home');
  data = await DataStore.load();
  renderHome();
}

init();

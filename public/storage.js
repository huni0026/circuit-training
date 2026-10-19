// 데이터 저장
// - 기본 저장소: PC 서버의 파일 DB (data\circuit-data.json) — /api/data
// - 서버에 연결할 수 없으면 브라우저 localStorage 에 임시 저장 후 다음 연결 때 서버로 보냄

const SETTING_LIMITS = {
  warmupMin:     { def: 5,  min: 0,  max: 15,  step: 1,  unit: '분' },
  workSec:       { def: 40, min: 10, max: 120, step: 5,  unit: '초' },
  transitionSec: { def: 10, min: 0,  max: 30,  step: 5,  unit: '초' },
  rounds:        { def: 3,  min: 1,  max: 10,  step: 1,  unit: '바퀴' },
  roundRestSec:  { def: 60, min: 0,  max: 180, step: 15, unit: '초' },
  cooldownMin:   { def: 5,  min: 0,  max: 15,  step: 1,  unit: '분' },
  recoveryMin:   { def: 20, min: 5,  max: 40,  step: 5,  unit: '분' },
};

const DataStore = (() => {
  const LOCAL_KEY = 'circuit-data';
  const DIRTY_KEY = 'circuit-data-dirty';
  let status = 'connecting'; // connecting | online | offline
  let onStatus = () => {};
  let retryTimer = null;

  function defaults() {
    const settings = { sound: true, voice: true };
    for (const k in SETTING_LIMITS) settings[k] = SETTING_LIMITS[k].def;
    return { version: 1, updatedAt: 0, settings, history: [] };
  }

  // 불러온 데이터를 검증하고 기본값과 합침
  function normalize(raw) {
    const d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    const s = raw.settings || {};
    for (const k in SETTING_LIMITS) {
      const lim = SETTING_LIMITS[k];
      const v = Number(s[k]);
      if (Number.isFinite(v)) d.settings[k] = Math.min(lim.max, Math.max(lim.min, Math.round(v)));
    }
    if (typeof s.sound === 'boolean') d.settings.sound = s.sound;
    if (typeof s.voice === 'boolean') d.settings.voice = s.voice;
    if (Array.isArray(raw.history)) {
      d.history = raw.history.filter(h => h && typeof h.date === 'string' && typeof h.day === 'string');
    }
    d.updatedAt = Number(raw.updatedAt) || 0;
    return d;
  }

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY)); } catch { return null; }
  }
  function writeLocal(data, dirty) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
      if (dirty) localStorage.setItem(DIRTY_KEY, '1'); else localStorage.removeItem(DIRTY_KEY);
    } catch { /* 저장소 사용 불가 시 무시 */ }
  }
  function isDirty() {
    try { return localStorage.getItem(DIRTY_KEY) === '1'; } catch { return false; }
  }

  function setStatus(s) {
    status = s;
    onStatus(s);
  }

  async function request(method, body) {
    if (location.protocol === 'file:') throw new Error('no server');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch('api/data', {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  async function load() {
    const local = readLocal();
    try {
      const server = await request('GET');
      setStatus('online');
      const hasServerData = server && server.settings;
      // 오프라인 중 바뀐 로컬 데이터가 더 최신이면 서버로 올림
      if (local && isDirty() && (!hasServerData || (local.updatedAt || 0) > (server.updatedAt || 0))) {
        const data = normalize(local);
        await push(data);
        return data;
      }
      if (hasServerData) {
        const data = normalize(server);
        writeLocal(data, false);
        return data;
      }
      // 서버 파일이 아직 없음 → 기본값(또는 로컬값)으로 생성
      const data = normalize(local);
      await push(data);
      return data;
    } catch {
      setStatus('offline');
      scheduleRetry();
      return normalize(local);
    }
  }

  let current = null;
  async function push(data) {
    current = data;
    try {
      await request('PUT', data);
      writeLocal(data, false);
      setStatus('online');
    } catch {
      writeLocal(data, true);
      setStatus('offline');
      scheduleRetry();
    }
  }

  function save(data) {
    data.updatedAt = Date.now();
    writeLocal(data, true);
    return push(data);
  }

  function scheduleRetry() {
    if (retryTimer || location.protocol === 'file:') return;
    retryTimer = setInterval(async () => {
      try {
        const server = await request('GET');
        clearInterval(retryTimer);
        retryTimer = null;
        setStatus('online');
        const local = current || readLocal();
        if (local && isDirty() && (local.updatedAt || 0) >= ((server && server.updatedAt) || 0)) {
          await push(normalize(local));
        }
      } catch { /* 계속 재시도 */ }
    }, 15000);
  }

  function exportFile(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'circuit-data.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        try {
          const raw = JSON.parse(r.result);
          if (!raw || typeof raw !== 'object' || !raw.settings) throw new Error('형식 오류');
          resolve(normalize(raw));
        } catch (e) {
          reject(e);
        }
      };
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  return {
    defaults, load, save, exportFile, importFile,
    get status() { return status; },
    set onStatus(fn) { onStatus = fn; },
  };
})();

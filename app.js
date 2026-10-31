'use strict';
// FIT · aplicación local (sin servidor, sin dependencias, sin conexiones externas).
// Seguridad: nunca se inserta HTML a partir de datos; todo texto se crea con textContent.
// Todo dato leído del almacenamiento o de una copia importada se valida de forma estricta antes de usarse.
(() => {
  const CFG = self.FIT_CONFIG, ROUTINE = self.FIT_ROUTINE;
  // Ilustraciones anatómicas revisadas (clave "día-ejercicio-alternativa"); mientras falten se muestra una imagen neutra "pendiente".
  const MEDIA = self.FIT_MEDIA || { illustrations: {}, pending: '' };
  // Técnica, músculos y errores comunes: solo contenido aprobado (vacío hasta su aprobación; nunca se inventa).
  const LIBRARY = self.FIT_LIBRARY || {};
  // Esquema 4 = esquema 3 + abdomen, muslo y pantorrilla. Los datos y copias del esquema 3 se aceptan y se completan con valores vacíos.
  const SCHEMA = 4, OLD_SCHEMA = 3, KEY = 'fit3:' + CFG.id, OWNER_KEY = 'fit-origin-owner', MAX_IMPORT_BYTES = 2000000, LOOKBACK_DAYS = 14;
  const DAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
  const REASONS = ['Sin indicar', 'Trabajo / jornada larga', 'Falta de tiempo', 'Cansancio / recuperación', 'Compromiso familiar', 'Salud / molestia', 'Otro'];
  const DECISIONS = { recover: 'Recuperar la sesión pendiente', continue: 'Continuar con la rutina programada', short: 'Versión corta de 15–20 min', rest: 'Descansar y recuperarme' };
  const MEASURES = { waist: 'Cintura', abdomen: 'Abdomen (ombligo)', chest: 'Pecho', hip: 'Cadera/glúteos', arm: 'Brazo', thigh: 'Muslo', calf: 'Pantorrilla' };
  const MKEYS = Object.keys(MEASURES), OLD_MKEYS = ['waist', 'hip', 'chest', 'arm'];
  const nullMeasures = () => Object.fromEntries(MKEYS.map(k => [k, null]));
  const R = { bodyweight: [30, 300], measure: [20, 250], load: [0, 500], reps: [0, 100], goalWeight: [30, 300] };
  const MAX = { sessions: 10000, bodyweights: 10000, measures: 10000, missed: 5000 };

  // ---------- Fechas (siempre en hora local, formato AAAA-MM-DD)
  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => isoOf(new Date());
  const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= '2000-01-01' && isoOf(parseISO(s)) === s;
  const weekdayIdx = s => (parseISO(s).getDay() + 6) % 7; // 0 = lunes … 6 = domingo
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoOf(d); };
  const mondayOf = s => addDays(s, -weekdayIdx(s));
  const fmt = s => parseISO(s).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const fmtShort = s => parseISO(s).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  const fmtNum = v => v.toLocaleString('es', { maximumFractionDigits: 2 });
  const kg = v => fmtNum(v) + ' kg';

  // ---------- Rutina (datos fijos, solo lectura)
  const deepFreeze = o => { Object.freeze(o); Object.values(o).forEach(v => { if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); }); return o; };
  deepFreeze(ROUTINE);
  const DAY = i => ROUTINE.days[i].day;
  const focus = i => ROUTINE.days[i].focus;
  const setsOf = p => { const m = /^(\d+)\s*×/.exec(p); return m ? Math.min(10, Math.max(1, Number(m[1]))) : 3; };
  const exName = (day, i, alt) => { const e = ROUTINE.days[day].exercises[i]; return alt === 0 ? e.name : e.alternatives[alt - 1]; };
  const blankExercises = day => ROUTINE.days[day].exercises.map(e => ({ alt: 0, name: e.name, done: false, sets: Array.from({ length: setsOf(e.prescription) }, () => ({ reps: null, load: null })) }));

  // ---------- Validación estricta
  const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  const isNum = (v, [lo, hi]) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi && Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const ID_RE = /^[A-Za-z0-9-]{6,40}$/;
  const safeText = s => typeof s === 'string' && s.length >= 1 && s.length <= 80 && !/[\u0000-\u001f\u007f<>]/.test(s);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function validateData(d) {
    const errors = [], err = m => { if (errors.length < 25) errors.push(m); };
    const shape = (o, keys, where) => {
      if (!isPlain(o)) { err(where + ': no es un objeto válido'); return false; }
      const extra = Object.keys(o).filter(k => !keys.includes(k));
      if (extra.length) err(where + ': campos no admitidos (' + extra.map(k => k.slice(0, 20)).join(', ') + ')');
      const miss = keys.filter(k => !has(o, k));
      if (miss.length) err(where + ': faltan campos (' + miss.join(', ') + ')');
      return !extra.length && !miss.length;
    };
    const list = (a, max, where) => {
      if (!Array.isArray(a)) { err(where + ': debe ser una lista'); return []; }
      if (a.length > max) { err(where + ': demasiados registros'); return []; }
      return a;
    };
    const date = (v, where) => {
      if (!validDate(v)) { err(where + ': fecha no válida'); return false; }
      if (v > today()) { err(where + ': fecha futura'); return false; }
      return true;
    };
    const ids = new Set();
    const id = (v, where) => {
      if (typeof v !== 'string' || !ID_RE.test(v)) return err(where + ': identificador no válido');
      if (ids.has(v)) err(where + ': identificador repetido');
      ids.add(v);
    };
    if (!shape(d, ['schema', 'app', 'createdAt', 'goals', 'sessions', 'bodyweights', 'measures', 'missed'], 'datos')) return { errors };
    if (d.schema !== SCHEMA && d.schema !== OLD_SCHEMA) err('datos: versión no admitida');
    const mk = d.schema === OLD_SCHEMA ? OLD_MKEYS : MKEYS;
    if (d.app !== CFG.id) err('datos: pertenecen a otra aplicación');
    date(d.createdAt, 'datos: fecha de inicio');
    const out = { schema: SCHEMA, app: CFG.id, createdAt: d.createdAt, goals: null, sessions: [], bodyweights: [], measures: [], missed: [] };

    if (shape(d.goals, ['weight', 'perWeek', ...mk], 'objetivos')) {
      const g = d.goals;
      if (!(g.weight === null || isNum(g.weight, R.goalWeight))) err('objetivos: meta de peso fuera de rango');
      if (!isInt(g.perWeek, 1, 5)) err('objetivos: las sesiones por semana deben ser de 1 a 5');
      for (const k of mk) if (!(g[k] === null || isNum(g[k], R.measure))) err('objetivos: ' + MEASURES[k] + ' fuera de rango');
      out.goals = Object.assign({ weight: g.weight, perWeek: g.perWeek }, nullMeasures(), Object.fromEntries(mk.map(k => [k, g[k]])));
    }

    const seenSession = new Set();
    list(d.sessions, MAX.sessions, 'sesiones').forEach((s, n) => {
      const w = 'sesión ' + (n + 1);
      if (!shape(s, ['id', 'date', 'day', 'completed', 'recovers', 'exercises'], w)) return;
      id(s.id, w); date(s.date, w);
      if (!isInt(s.day, 0, 4)) err(w + ': día de rutina no válido');
      if (typeof s.completed !== 'boolean') err(w + ': estado no válido');
      if (s.recovers !== null) date(s.recovers, w + ' (recuperación)');
      const k = s.date + '/' + s.day;
      if (seenSession.has(k)) err(w + ': sesión repetida para la misma fecha y rutina');
      seenSession.add(k);
      if (!Array.isArray(s.exercises) || s.exercises.length !== 5) return err(w + ': debe tener 5 ejercicios');
      const exercises = s.exercises.map((e, i) => {
        const q = w + ', ejercicio ' + (i + 1);
        if (!shape(e, ['alt', 'name', 'done', 'sets'], q)) return null;
        if (!isInt(e.alt, 0, 3)) err(q + ': variación no válida');
        if (!safeText(e.name)) err(q + ': nombre no válido');
        if (typeof e.done !== 'boolean') err(q + ': estado no válido');
        if (!Array.isArray(e.sets) || e.sets.length < 1 || e.sets.length > 10) { err(q + ': series no válidas'); return null; }
        const sets = e.sets.map((x, j) => {
          if (!shape(x, ['reps', 'load'], q + ', serie ' + (j + 1))) return null;
          if (!(x.reps === null || isInt(x.reps, R.reps[0], R.reps[1]))) err(q + ': repeticiones fuera de rango');
          if (!(x.load === null || isNum(x.load, R.load))) err(q + ': carga fuera de rango');
          return { reps: x.reps, load: x.load };
        });
        return { alt: e.alt, name: e.name, done: e.done, sets };
      });
      out.sessions.push({ id: s.id, date: s.date, day: s.day, completed: s.completed, recovers: s.recovers, exercises });
    });

    const seenW = new Set();
    list(d.bodyweights, MAX.bodyweights, 'pesos').forEach((x, n) => {
      const w = 'peso ' + (n + 1);
      if (!shape(x, ['id', 'date', 'value'], w)) return;
      id(x.id, w); date(x.date, w);
      if (!isNum(x.value, R.bodyweight)) err(w + ': valor fuera de rango');
      if (seenW.has(x.date)) err(w + ': fecha repetida');
      seenW.add(x.date);
      out.bodyweights.push({ id: x.id, date: x.date, value: x.value });
    });

    const seenM = new Set();
    list(d.measures, MAX.measures, 'medidas').forEach((x, n) => {
      const w = 'medida ' + (n + 1);
      if (!shape(x, ['id', 'date', ...mk], w)) return;
      id(x.id, w); date(x.date, w);
      const ks = mk;
      for (const k of ks) if (!(x[k] === null || isNum(x[k], R.measure))) err(w + ': ' + MEASURES[k] + ' fuera de rango');
      if (ks.every(k => x[k] === null)) err(w + ': no contiene ninguna medida');
      if (seenM.has(x.date)) err(w + ': fecha repetida');
      seenM.add(x.date);
      out.measures.push(Object.assign({ id: x.id, date: x.date }, nullMeasures(), Object.fromEntries(mk.map(k => [k, x[k]]))));
    });

    const seenA = new Set();
    list(d.missed, MAX.missed, 'ausencias').forEach((x, n) => {
      const w = 'ausencia ' + (n + 1);
      if (!shape(x, ['id', 'date', 'day', 'reason', 'decision', 'status', 'resolvedBy'], w)) return;
      id(x.id, w); date(x.date, w);
      if (!isInt(x.day, 0, 4)) err(w + ': día no válido');
      if (!REASONS.includes(x.reason)) err(w + ': motivo no admitido');
      if (!has(DECISIONS, x.decision)) err(w + ': decisión no admitida');
      if (x.status !== 'open' && x.status !== 'done') err(w + ': estado no válido');
      if (!(x.resolvedBy === null || (typeof x.resolvedBy === 'string' && ID_RE.test(x.resolvedBy)))) err(w + ': referencia no válida');
      if (seenA.has(x.date)) err(w + ': fecha repetida');
      seenA.add(x.date);
      out.missed.push({ id: x.id, date: x.date, day: x.day, reason: x.reason, decision: x.decision, status: x.status, resolvedBy: x.resolvedBy });
    });

    return errors.length ? { errors } : { data: out };
  }

  const newId = () => {
    if (self.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
  };
  const empty = () => ({ schema: SCHEMA, app: CFG.id, createdAt: today(), goals: Object.assign({ weight: null, perWeek: 5 }, nullMeasures()), sessions: [], bodyweights: [], measures: [], missed: [] });

  // ---------- Migración desde la versión anterior (HTML originales, «version 2»)
  // El resultado se valida después con validateData; si algo no encaja, no se carga nada.
  function fromLegacy(old) {
    if (!isPlain(old)) throw new Error('formato antiguo no válido');
    const arr = v => (Array.isArray(v) ? v.slice(0, 10000) : []);
    const lastByDate = a => { const m = new Map(); for (const x of arr(a)) if (isPlain(x) && typeof x.date === 'string') m.set(x.date, x); return [...m.values()]; };
    const d = empty(), report = { exercisesNotMigrated: 0 };
    d.goals.weight = typeof old.goal === 'number' ? old.goal : null;
    d.bodyweights = lastByDate(old.weights).map(x => ({ id: newId(), date: x.date, value: x.value }));
    d.measures = lastByDate(old.waists).map(x => Object.assign({ id: newId(), date: x.date }, nullMeasures(), { waist: x.value }));
    d.missed = lastByDate(old.missed).map(x => ({ id: newId(), date: x.date, day: validDate(x.date) ? Math.min(4, weekdayIdx(x.date)) : 0, reason: x.reason, decision: x.decision, status: 'done', resolvedBy: null }));
    const seen = new Set();
    for (const s of arr(old.sessions)) {
      if (!isPlain(s) || !isInt(s.day, 0, 4) || seen.has(s.date + '/' + s.day)) continue;
      seen.add(s.date + '/' + s.day);
      d.sessions.push({ id: newId(), date: s.date, day: s.day, completed: true, recovers: null, exercises: blankExercises(s.day) });
    }
    // Los registros antiguos de ejercicios no tenían fecha: se asignan a la sesión más reciente de ese día de rutina.
    if (isPlain(old.entries)) {
      for (const [k, v] of Object.entries(old.entries)) {
        const m = /^([0-4])-([0-4])$/.exec(k);
        if (!m || !isPlain(v)) continue;
        const day = Number(m[1]), i = Number(m[2]);
        const target = d.sessions.filter(s => s.day === day).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
        if (!target) { report.exercisesNotMigrated++; continue; }
        const alt = /^[0-3]$/.test(String(v.alt ?? '0')) ? Number(v.alt ?? 0) : 0;
        const loadStr = String(v.load ?? '').trim().replace(',', '.');
        const load = /^\d{1,3}(\.\d{1,2})?$/.test(loadStr) && Number(loadStr) <= R.load[1] ? Number(loadStr) : null;
        const reps = String(v.reps ?? '').split(/[^0-9]+/).filter(Boolean).slice(0, 10).map(Number).filter(n => n <= R.reps[1]);
        const ex = target.exercises[i];
        ex.alt = alt; ex.name = exName(day, i, alt); ex.done = v.done === true;
        if (reps.length) ex.sets = reps.map(r => ({ reps: r, load }));
        else if (load !== null) ex.sets[0].load = load;
      }
    }
    const dates = [...d.bodyweights, ...d.measures, ...d.missed, ...d.sessions].map(x => x.date).filter(validDate).sort();
    if (dates.length) d.createdAt = dates[0];
    return { data: d, report };
  }

  // ---------- Estado y almacenamiento
  let state = null, mode = 'ok', notice = '', corruptErrors = [];
  const ui = { tab: 'inicio', date: null, day: null, recovers: null, histDate: null, strengthEx: null, measure: 'waist', editWeight: null, editMeasure: null, importErrors: [], open: null, pane: 'alt' };

  function originCheck() {
    let owner, keys;
    try { owner = localStorage.getItem(OWNER_KEY); keys = Object.keys(localStorage); } catch (e) { return 'nostorage'; }
    const foreign = keys.filter(k => CFG.otherIds.some(o => k === 'fit3:' + o || k.startsWith('fit3:' + o + ':')) || CFG.otherLegacyKeys.includes(k));
    if ((owner !== null && owner !== CFG.id) || foreign.length) return 'shared';
    if (owner === null) { try { localStorage.setItem(OWNER_KEY, CFG.id); } catch (e) { return 'nostorage'; } }
    return 'ok';
  }

  function save() {
    if (mode !== 'ok') return mode === 'nostorage';
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (e) { toast('No se pudo guardar: el almacenamiento del navegador está lleno o bloqueado.', true); return false; }
  }

  function load() {
    const raw = localStorage.getItem(KEY);
    if (raw === null) {
      state = empty();
      const legacy = localStorage.getItem(CFG.legacyKey);
      if (legacy !== null) {
        let res = null;
        try { const conv = fromLegacy(JSON.parse(legacy)); const v = validateData(conv.data); if (v.data) res = { data: v.data, report: conv.report }; } catch (e) { res = null; }
        if (res) {
          state = res.data;
          notice = 'Se migraron tus registros de la versión anterior.' + (res.report.exercisesNotMigrated ? ' ' + res.report.exercisesNotMigrated + ' registro(s) de ejercicios sin sesión asociada no se pudieron migrar.' : '');
        } else notice = 'Había datos de la versión anterior que no superaron la validación. No se cargaron y se dejaron intactos.';
      }
      save();
      return;
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = undefined; }
    const v = parsed === undefined ? { errors: ['Los datos guardados no son JSON válido.'] } : validateData(parsed);
    if (v.data) {
      state = v.data;
      // Datos del esquema 3: se conserva una copia exacta antes de actualizarlos al esquema 4 (no se pierde nada).
      if (parsed.schema === OLD_SCHEMA) {
        try { localStorage.setItem(KEY + ':respaldo-esquema3', raw); save(); notice = 'Tus datos se actualizaron para admitir las nuevas medidas (abdomen, muslo y pantorrilla). Se guardó una copia de la versión anterior.'; }
        catch (e) { /* sin espacio: se sigue en memoria sin sobrescribir lo guardado */ }
      }
    }
    else { mode = 'corrupt'; corruptErrors = v.errors; }
  }

  // ---------- Utilidades de interfaz (los textos se insertan siempre como texto, nunca como HTML)
  const $ = s => document.querySelector(s);
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (typeof v === 'boolean' || (k === 'value' && typeof v !== 'string')) el[k] = v;
      else el.setAttribute(k, String(v));
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  const btn = (text, onclick, cls, extra) => h('button', Object.assign({ type: 'button', class: cls || '', onclick }, extra || {}), text);
  const card = (...kids) => h('div', { class: 'card' }, ...kids);
  const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', { class: 'muted' }, hint) : null);
  const stat = (label, value, id) => h('div', { class: 'stat' }, label, h('b', { id }, value));
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.className = ''; }, 3500);
  }
  function readNum(input, [lo, hi], opts) {
    const o = Object.assign({ int: false, optional: true }, opts || {});
    const s = input.value.trim().replace(',', '.');
    if (s === '') return o.optional ? { ok: true, v: null } : { ok: false };
    if (!(o.int ? /^\d{1,4}$/ : /^\d{1,4}(\.\d{1,2})?$/).test(s)) return { ok: false };
    const v = Number(s);
    return v >= lo && v <= hi ? { ok: true, v } : { ok: false };
  }
  const mark = (input, ok) => { if (ok) input.removeAttribute('aria-invalid'); else input.setAttribute('aria-invalid', 'true'); };
  const dateInput = (id, value) => h('input', { type: 'date', id, value, max: today(), min: '2000-01-01' });
  const dateOk = v => validDate(v) && v <= today();
  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  const dataTable = rows => rows.length ? h('details', { class: 'tiny' }, h('summary', {}, 'Ver datos'), h('table', {}, ...rows.map(r => h('tr', {}, ...r.map(c => h('td', {}, c)))))) : null;

  // ---------- Consultas sobre los datos
  const findSession = (date, day) => state.sessions.find(s => s.date === date && s.day === day);
  function ensureSession(date, day) {
    let s = findSession(date, day);
    if (!s) { s = { id: newId(), date, day, completed: false, recovers: null, exercises: blankExercises(day) }; state.sessions.push(s); }
    return s;
  }
  function removeSession(s) {
    state.sessions = state.sessions.filter(x => x !== s);
    for (const m of state.missed) if (m.resolvedBy === s.id) { m.resolvedBy = null; m.status = m.decision === 'recover' ? 'open' : 'done'; }
  }
  const completed = () => state.sessions.filter(s => s.completed);
  const sortedWeights = () => [...state.bodyweights].sort((a, b) => a.date.localeCompare(b.date));
  const volume = s => s.exercises.reduce((t, e) => t + e.sets.reduce((u, x) => u + (x.reps != null && x.load != null ? x.reps * x.load : 0), 0), 0);
  const measureText = m => Object.entries(MEASURES).filter(([k]) => m[k] !== null).map(([k, l]) => l + ' ' + fmtNum(m[k]) + ' cm').join(' · ');
  function pendingMissed() {
    const t = today(), limit = addDays(t, -LOOKBACK_DAYS), out = [];
    for (let d = state.createdAt > limit ? state.createdAt : limit; d < t; d = addDays(d, 1)) {
      const w = weekdayIdx(d);
      if (w > 4) continue;
      if (state.sessions.some(s => s.completed && (s.date === d || s.recovers === d))) continue;
      if (state.missed.some(m => m.date === d)) continue;
      out.push({ date: d, day: w });
    }
    return out;
  }
  const openRecoveries = () => state.missed.filter(m => m.decision === 'recover' && m.status === 'open').sort((a, b) => a.date.localeCompare(b.date));
  function lastPerformance(name, before) {
    const ss = completed().filter(s => s.date < before).sort((a, b) => b.date.localeCompare(a.date));
    for (const s of ss) for (const e of s.exercises) {
      if (e.name !== name) continue;
      const sets = e.sets.filter(x => x.reps !== null || x.load !== null);
      if (sets.length) return 'Última vez (' + fmtShort(s.date) + '): ' + sets.map(x => (x.reps ?? '–') + ' × ' + (x.load === null ? '–' : fmtNum(x.load)) + ' kg').join(' · ');
    }
    return '';
  }
  // Carga máxima por sesión para un ejercicio (series con repeticiones > 0 y carga indicada)
  function strengthSeries(name) {
    const byDate = new Map();
    for (const s of completed()) for (const e of s.exercises) {
      if (e.name !== name) continue;
      for (const x of e.sets) if (x.load !== null && x.reps !== null && x.reps > 0) byDate.set(s.date, Math.max(byDate.get(s.date) ?? -1, x.load));
    }
    return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({ d, v }));
  }
  function strengthNames() {
    const names = new Set();
    for (const s of completed()) for (const e of s.exercises) if (e.sets.some(x => x.load !== null && x.reps !== null && x.reps > 0)) names.add(e.name);
    return [...names].sort((a, b) => a.localeCompare(b, 'es'));
  }
  function countPRs() {
    let n = 0;
    for (const name of strengthNames()) { let best = null; for (const p of strengthSeries(name)) { if (best !== null && p.v > best) n++; best = best === null ? p.v : Math.max(best, p.v); } }
    return n;
  }
  function weeklyCounts(weeks) {
    const start = mondayOf(today()), out = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const m = addDays(start, -7 * i), end = addDays(m, 6);
      out.push({ label: fmtShort(m), v: completed().filter(s => s.date >= m && s.date <= end).length });
    }
    return out;
  }
  function achievements() {
    const done = completed(), n = done.length, per = state.goals.perWeek;
    const weeks = new Map(); for (const s of done) { const m = mondayOf(s.date); weeks.set(m, (weeks.get(m) || 0) + 1); }
    const goalWeeks = [...weeks.entries()].filter(([, c]) => c >= per).map(([m]) => m).sort();
    let streak = 0, best = 0, prev = null;
    for (const m of goalWeeks) { streak = prev && addDays(prev, 7) === m ? streak + 1 : 1; best = Math.max(best, streak); prev = m; }
    const prs = countPRs(), bw = sortedWeights(), g = state.goals.weight;
    const goalReached = g !== null && bw.length >= 2 && (bw[0].value >= g ? bw[bw.length - 1].value <= g : bw[bw.length - 1].value >= g);
    return [
      { id: 'first', name: 'Primer entrenamiento', desc: 'Completa tu primera sesión', ok: n >= 1 },
      { id: 's10', name: '10 sesiones', desc: 'Completa 10 entrenamientos', ok: n >= 10 },
      { id: 's25', name: '25 sesiones', desc: 'Completa 25 entrenamientos', ok: n >= 25 },
      { id: 's50', name: '50 sesiones', desc: 'Completa 50 entrenamientos', ok: n >= 50 },
      { id: 's100', name: '100 sesiones', desc: 'Completa 100 entrenamientos', ok: n >= 100 },
      { id: 'week', name: 'Semana cumplida', desc: 'Alcanza tu objetivo de sesiones en una semana', ok: goalWeeks.length >= 1 },
      { id: 'streak4', name: 'Constancia', desc: '4 semanas seguidas cumpliendo tu objetivo', ok: best >= 4 },
      { id: 'pr', name: 'Primer récord', desc: 'Supera tu mejor carga en un ejercicio', ok: prs >= 1 },
      { id: 'pr10', name: '10 récords', desc: 'Supera tu mejor carga 10 veces', ok: prs >= 10 },
      { id: 'recover', name: 'Sin rendirse', desc: 'Recupera una sesión pendiente', ok: done.some(s => s.recovers !== null) },
      { id: 'weigh', name: 'Primer control', desc: 'Registra tu peso corporal', ok: bw.length >= 1 },
      { id: 'measure', name: 'Medidas en marcha', desc: 'Registra tus medidas', ok: state.measures.length >= 1 },
      { id: 'goal', name: 'Meta de peso', desc: 'Alcanza tu meta de peso configurada', ok: goalReached },
    ];
  }
  const quoteOf = t => { const [y, m, d] = t.split('-').map(Number); return CFG.quotes[Math.floor(Date.UTC(y, m - 1, d) / 864e5) % CFG.quotes.length]; };

  // ---------- Gráficos (canvas, sin librerías)
  function chartSetup(c) {
    const dpr = Math.min(3, self.devicePixelRatio || 1), W = c.clientWidth || 320, H = c.clientHeight || 200;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim();
    x.font = '12px -apple-system, system-ui, sans-serif';
    return { x, W, H, accent: v('--accent'), muted: v('--muted'), line: v('--line'), warn: v('--warn') };
  }
  function drawLine(c, pts, goal, unit) {
    const { x, W, H, accent, muted, line, warn } = chartSetup(c);
    x.fillStyle = muted;
    if (!pts.length) { x.fillText('Sin datos todavía', 12, H / 2); return; }
    const ts = pts.map(p => parseISO(p.d).getTime());
    let t0 = Math.min(...ts), t1 = Math.max(...ts); if (t0 === t1) { t0 -= 864e5; t1 += 864e5; }
    const vals = pts.map(p => p.v).concat(goal !== null && goal !== undefined ? [goal] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals); const padv = Math.max(1, (hi - lo) * 0.12); lo -= padv; hi += padv;
    const L = 48, Rm = 12, T = 12, B = 24, X = t => L + (t - t0) / (t1 - t0) * (W - L - Rm), Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    x.strokeStyle = line; x.lineWidth = 1; x.beginPath(); x.moveTo(L, T); x.lineTo(L, H - B); x.lineTo(W - Rm, H - B); x.stroke();
    x.fillStyle = muted; x.fillText(fmtNum(Math.round(hi * 10) / 10) + ' ' + unit, 2, T + 8); x.fillText(fmtNum(Math.round(lo * 10) / 10), 2, H - B);
    x.fillText(fmtShort(pts[0].d), L, H - 6); const lastLabel = fmtShort(pts[pts.length - 1].d); x.fillText(lastLabel, W - Rm - x.measureText(lastLabel).width, H - 6);
    if (goal !== null && goal !== undefined) { x.setLineDash([6, 5]); x.strokeStyle = warn; x.beginPath(); x.moveTo(L, Y(goal)); x.lineTo(W - Rm, Y(goal)); x.stroke(); x.setLineDash([]); x.fillStyle = warn; x.fillText('meta', W - Rm - 30, Y(goal) - 4); }
    x.strokeStyle = accent; x.lineWidth = 2.5; x.beginPath();
    pts.forEach((p, i) => { const px = X(ts[i]), py = Y(p.v); if (i) x.lineTo(px, py); else x.moveTo(px, py); }); x.stroke();
    x.fillStyle = accent; pts.forEach((p, i) => { x.beginPath(); x.arc(X(ts[i]), Y(p.v), 3.5, 0, Math.PI * 2); x.fill(); });
  }
  function drawBars(c, bars, target) {
    const { x, W, H, accent, muted, line, warn } = chartSetup(c);
    const hi = Math.max(5, target, ...bars.map(b => b.v)), L = 24, B = 24, T = 10, bw = (W - L - 8) / bars.length;
    x.strokeStyle = line; x.beginPath(); x.moveTo(L, H - B); x.lineTo(W - 4, H - B); x.stroke();
    bars.forEach((b, i) => {
      const bh = b.v / hi * (H - B - T);
      x.fillStyle = accent; x.fillRect(L + i * bw + 4, H - B - bh, bw - 8, bh);
      x.fillStyle = muted; x.fillText(String(b.v), L + i * bw + bw / 2 - 3, H - B - bh - 3);
      if (i % 2 === bars.length % 2) x.fillText(b.label, L + i * bw + 2, H - 6);
    });
    const ty = H - B - target / hi * (H - B - T);
    x.setLineDash([6, 5]); x.strokeStyle = warn; x.beginPath(); x.moveTo(L, ty); x.lineTo(W - 4, ty); x.stroke(); x.setLineDash([]);
  }

  function drawSpark(c, pts) {
    const { x, W, H, accent } = chartSetup(c);
    if (pts.length < 2) return;
    const vs = pts.map(p => p.v); let lo = Math.min(...vs), hi = Math.max(...vs); if (hi === lo) { lo -= 1; hi += 1; }
    x.strokeStyle = accent; x.lineWidth = 2; x.lineJoin = 'round'; x.beginPath();
    pts.forEach((p, i) => { const px = 2 + i / (pts.length - 1) * (W - 4), py = 3 + (hi - p.v) / (hi - lo) * (H - 6); if (i) x.lineTo(px, py); else x.moveTo(px, py); });
    x.stroke();
  }

  // ---------- Ilustraciones de ejercicios
  const mediaKey = (day, i, alt) => day + '-' + i + '-' + alt;
  function illustration(day, i, alt, size, cls) {
    const m = MEDIA.illustrations[mediaKey(day, i, alt)], name = exName(day, i, alt);
    return h('img', { src: m ? m[size] : (size === 'thumb' && MEDIA.pendingThumb) || MEDIA.pending, alt: m ? 'Ilustración: ' + name : 'Ilustración pendiente de revisión: ' + name, class: cls + (m ? '' : ' pending'),
      'data-media': mediaKey(day, i, alt), loading: size === 'thumb' ? 'lazy' : null, decoding: 'async' });
  }
  function infoPane(day, i, alt, kind) {
    const lib = LIBRARY[mediaKey(day, i, alt)];
    if (kind === 'tec') {
      if (lib && lib.technique) return h('div', { class: 'info', id: 'pane-tec' }, h('strong', {}, 'Técnica correcta'), h('ol', {}, ...lib.technique.map(t => h('li', {}, t))),
        lib.errors ? h('strong', {}, 'Errores comunes') : null, lib.errors ? h('ul', {}, ...lib.errors.map(t => h('li', {}, t))) : null);
      return h('div', { class: 'info', id: 'pane-tec' }, h('strong', {}, 'Técnica correcta y errores comunes'),
        h('p', { class: 'muted tiny' }, 'Pendiente de contenido aprobado. No se muestran instrucciones sin revisar.'));
    }
    if (lib && lib.muscles) return h('div', { class: 'info', id: 'pane-mus' }, h('strong', {}, 'Músculos principales'), h('ul', {}, ...lib.muscles.map(t => h('li', {}, t))));
    return h('div', { class: 'info', id: 'pane-mus' }, h('strong', {}, 'Músculos trabajados'),
      h('p', { class: 'muted tiny' }, 'Pendiente de contenido aprobado. La ilustración revisada resaltará los músculos principales.'));
  }

  // ---------- Navegación (4 botones; Historial y Peso y medidas viven dentro de Progreso)
  const TABS = ['inicio', 'entrenar', 'historial', 'cuerpo', 'progreso', 'ajustes'];
  const NAV_OF = { inicio: 'inicio', entrenar: 'entrenar', progreso: 'progreso', cuerpo: 'progreso', historial: 'progreso', ajustes: 'ajustes' };
  const SUBS = [['progreso', 'Resumen'], ['cuerpo', 'Peso y medidas'], ['historial', 'Historial']];
  const subnav = () => h('div', { class: 'seg', role: 'group', 'aria-label': 'Secciones de progreso' },
    ...SUBS.map(([t, l]) => btn(l, () => go(t), ui.tab === t ? 'on' : '', { 'data-sub': t, 'aria-pressed': String(ui.tab === t) })));
  let after = [];
  function render() {
    after = [];
    if (mode === 'shared') return renderShared();
    if (mode === 'corrupt') return renderCorrupt();
    const banners = [];
    if (mode === 'nostorage') banners.push(h('div', { class: 'banner bad' }, 'Este navegador no permite guardar datos (¿navegación privada?). Lo que registres se perderá al cerrar.'));
    if (notice) banners.push(h('div', { class: 'banner', id: 'notice' }, notice, btn('Entendido', () => { notice = ''; render(); }, 'small secondary')));
    $('#banner').replaceChildren(...banners);
    for (const t of TABS) $('#tab-' + t).hidden = t !== ui.tab;
    document.querySelectorAll('#nav button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === NAV_OF[ui.tab] ? 'page' : 'false'));
    $('#go-settings').hidden = false;
    const views = { inicio: tabInicio, entrenar: tabEntrenar, historial: tabHistorial, cuerpo: tabCuerpo, progreso: tabProgreso, ajustes: tabAjustes };
    $('#tab-' + ui.tab).replaceChildren(...views[ui.tab]());
    after.forEach(f => f());
  }
  function go(tab) { ui.tab = tab; ui.open = null; render(); self.scrollTo(0, 0); }
  function setDate(d) { ui.date = d; const w = weekdayIdx(d); ui.day = w <= 4 ? w : null; ui.recovers = null; ui.open = null; }

  // ---------- Inicio
  function tabInicio() {
    const t = today(), wd = weekdayIdx(t), out = [], mon = mondayOf(t);
    // Motivación diaria: siempre la primera tarjeta, justo debajo del encabezado.
    out.push(h('div', { class: 'card motivation', id: 'motivation' }, h('div', { class: 'eyebrow' }, 'Motivación diaria'), h('p', { class: 'quote', id: 'quote' }, quoteOf(t))));
    // Calendario de la semana (lunes a viernes)
    out.push(h('div', { class: 'week', id: 'week', role: 'group', 'aria-label': 'Semana actual' }, ...DAY_SHORT.map((l, i) => {
      const d = addDays(mon, i), done = completed().some(s => s.date === d), future = d > t;
      return btn([h('span', { class: 'wd' }, l), h('b', {}, String(parseISO(d).getDate())), h('span', { class: 'dot' }, done ? '✓' : '')],
        future ? null : () => { setDate(d); go('entrenar'); }, 'wday' + (d === t ? ' today' : '') + (done ? ' done' : ''),
        { 'data-date': d, disabled: future, 'aria-label': fmt(d) + (done ? ' · completado' : '') + (d === t ? ' · hoy' : '') });
    })));
    if (wd <= 4) out.push(h('div', { class: 'card' }, h('div', { class: 'eyebrow' }, 'Entrenamiento de hoy'), h('h2', { class: 'today-focus' }, focus(wd)),
      h('p', { id: 'today', class: 'muted tiny' }, DAY(wd) + ' · ' + ROUTINE.days[wd].exercises.length + ' ejercicios · 3 alternativas cada uno'),
      btn('Comenzar entrenamiento →', () => { setDate(t); go('entrenar'); }, 'big', { id: 'go-train' })));
    else out.push(h('div', { class: 'card' }, h('div', { class: 'eyebrow' }, 'Fin de semana'), h('p', { id: 'today' }, 'Hoy es día de descanso según tu plan (lunes a viernes).'), btn('Registrar un entrenamiento igualmente', () => { setDate(t); go('entrenar'); }, 'secondary', { id: 'go-train' })));
    const wk = completed().filter(s => s.date >= mon && s.date <= t).length;
    out.push(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('span', {}, 'Tu progreso de la semana'), h('b', { id: 'stat-semana' }, wk + ' / ' + state.goals.perWeek)),
      h('progress', { id: 'week-progress', max: state.goals.perWeek, value: Math.min(wk, state.goals.perWeek), 'aria-label': 'Sesiones completadas esta semana' })));
    const pend = pendingMissed();
    if (pend.length) out.push(missedCard(pend));
    for (const m of openRecoveries()) out.push(h('div', { class: 'card alert', 'data-recovery': m.date },
      h('h3', {}, 'Sesión por recuperar'),
      h('p', {}, DAY(m.day) + ' · ' + focus(m.day) + ' (pendiente del ' + fmt(m.date) + ')'),
      h('div', { class: 'row' },
        btn('Hacerla hoy', () => { setDate(today()); ui.day = m.day; ui.recovers = m.date; go('entrenar'); }, '', { 'data-action': 'recover-now' }),
        btn('Descartar', () => { if (confirm('¿Descartar la recuperación de esta sesión? Quedará registrada como no recuperada.')) { m.status = 'done'; save(); render(); } }, 'secondary', { 'data-action': 'recover-discard' }))));
    const w = sortedWeights(), last = w[w.length - 1];
    const waists = state.measures.filter(m => m.waist !== null).sort((a, b) => a.date.localeCompare(b.date)), lastWaist = waists[waists.length - 1];
    const sw = h('canvas', { class: 'spark', id: 'spark-weight', 'aria-hidden': 'true' }), sc = h('canvas', { class: 'spark', id: 'spark-waist', 'aria-hidden': 'true' });
    after.push(() => { drawSpark(sw, w.slice(-12).map(x => ({ v: x.value }))); drawSpark(sc, waists.slice(-12).map(x => ({ v: x.waist }))); });
    const tile = (label, value, id, cv) => h('button', { type: 'button', class: 'stat tile', onclick: () => go('cuerpo'), 'aria-label': label + ': ' + value + '. Abrir peso y medidas' }, label, h('b', { id }, value), cv);
    out.push(h('div', { class: 'grid' },
      tile('Peso actual', last ? kg(last.value) : '— kg', 'stat-peso', sw),
      tile('Cintura', lastWaist ? fmtNum(lastWaist.waist) + ' cm' : '— cm', 'stat-cintura', sc),
      stat('Meta de peso', state.goals.weight !== null ? kg(state.goals.weight) : 'Configurar', 'stat-meta'),
      stat('Sesiones completadas', String(completed().length), 'stat-sesiones')));
    out.push(card(h('h3', {}, 'Tu enfoque'), h('p', { class: 'muted' }, CFG.focus), h('p', { class: 'tiny warn', id: 'routine-notice' }, CFG.routineNotice)));
    return out;
  }
  function missedCard(pend) {
    const p = pend[0];
    const reason = h('select', { id: 'pend-reason' }, ...REASONS.map(r => h('option', {}, r)));
    const decide = decision => {
      state.missed.push({ id: newId(), date: p.date, day: p.day, reason: reason.value, decision, status: decision === 'recover' ? 'open' : 'done', resolvedBy: null });
      save(); toast('Decisión guardada. Nada se reprograma sin tu confirmación.'); render();
    };
    return h('div', { class: 'card alert', id: 'pendiente', 'data-date': p.date },
      h('h3', {}, pend.length > 1 ? 'Tienes ' + pend.length + ' entrenamientos sin registrar' : 'Tienes un entrenamiento sin registrar'),
      h('p', {}, fmt(p.date) + ' · ' + DAY(p.day) + ' · ' + focus(p.day)),
      field('Motivo (opcional)', reason),
      h('p', {}, '¿Qué prefieres hacer?'),
      h('div', { class: 'stack' },
        btn(DECISIONS.recover, () => decide('recover'), '', { 'data-decision': 'recover' }),
        btn(DECISIONS.continue, () => decide('continue'), 'secondary', { 'data-decision': 'continue' }),
        btn(DECISIONS.short + ' · pendiente de aprobación', null, 'secondary', { disabled: true, 'data-decision': 'short' }),
        btn(DECISIONS.rest, () => decide('rest'), 'secondary', { 'data-decision': 'rest' })),
      h('p', { class: 'tiny muted' }, 'La versión corta todavía no tiene ejercicios aprobados, por eso no está disponible. Nada se reprograma sin tu confirmación.'),
      btn('Sí entrené ese día: registrarlo', () => { setDate(p.date); go('entrenar'); }, 'outline', { 'data-action': 'log-missed-day' }));
  }

  // ---------- Entrenar
  // Lista del día y pantalla completa de cada ejercicio (ui.open = índice del ejercicio abierto).
  function sessionActions(date, day, s) {
    return h('div', { class: 'stack' },
      !s || !s.completed ? btn('Marcar entrenamiento completado', () => complete(date, day), '', { id: 'complete' })
        : btn('Marcar como no completado', () => { s.completed = false; if (s.recovers) { for (const m of state.missed) if (m.resolvedBy === s.id) { m.resolvedBy = null; m.status = 'open'; } s.recovers = null; } save(); render(); }, 'secondary', { id: 'uncomplete' }),
      s ? btn('Eliminar este registro', () => { if (confirm('¿Eliminar el registro del ' + fmt(date) + ' (' + DAY(day) + ')? No se puede deshacer.')) { removeSession(s); ui.open = null; save(); toast('Registro eliminado'); render(); } }, 'danger', { id: 'delete-session' }) : null);
  }
  const recoverBanner = () => ui.recovers ? h('div', { class: 'banner', id: 'recover-banner' }, 'Recuperando la sesión pendiente del ' + fmt(ui.recovers) + '.', btn('Cancelar', () => { ui.recovers = null; render(); }, 'small secondary')) : null;
  function tabEntrenar() {
    const date = ui.date;
    if (ui.day !== null && ui.open !== null) return detailView(date, ui.day, ui.open);
    const out = [h('h2', {}, 'Entrenamiento')];
    const din = dateInput('train-date', date);
    din.addEventListener('change', () => {
      if (!dateOk(din.value)) { mark(din, false); toast('Elige una fecha válida que no sea futura.', true); din.value = ui.date; return; }
      setDate(din.value); render();
    });
    out.push(card(field('Fecha del entrenamiento', din),
      h('div', { class: 'days', role: 'group', 'aria-label': 'Rutina del día' }, ...ROUTINE.days.map((d, i) =>
        btn(DAY_SHORT[i], () => { ui.day = i; ui.open = null; render(); }, ui.day === i ? 'active' : 'secondary', { 'aria-pressed': String(ui.day === i), 'data-day': String(i) })))));
    out.push(recoverBanner());
    if (ui.day === null) { out.push(card(h('p', { id: 'weekend' }, 'Es fin de semana: según tu plan es día de descanso. Si entrenaste, elige arriba la rutina que hiciste.'))); return out; }
    const day = ui.day, s = findSession(date, day), list = h('div', { id: 'exercises' }), exs = s ? s.exercises : blankExercises(day);
    exs.forEach((e, i) => list.append(exerciseItem(date, day, i, e)));
    out.push(card(
      h('div', { class: 'row between' }, h('div', {}, h('div', { class: 'eyebrow' }, DAY(day)), h('h2', { id: 'work-title' }, DAY(day) + ' · ' + focus(day))),
        h('span', { class: 'pill', id: 'done-count', 'aria-label': 'Ejercicios hechos' }, exs.filter(e => e.done).length + ' / ' + exs.length)),
      h('div', { class: 'row' }, h('span', { class: 'pill', id: 'session-status' }, statusText(s))),
      h('p', { class: 'tiny warn' }, CFG.routineNotice),
      h('p', { class: 'muted tiny' }, 'Toca un ejercicio para abrirlo a pantalla completa: ilustración, alternativas y registro de series.'),
      list, sessionActions(date, day, s)));
    return out;
  }
  const statusText = s => !s ? 'Sin empezar' : s.completed ? 'Completado' : 'En curso';
  function complete(date, day) {
    const s0 = findSession(date, day);
    if (!(s0 && s0.exercises.some(e => e.done)) && !confirm('No marcaste ningún ejercicio como hecho. ¿Guardar el entrenamiento como completado igualmente?')) return;
    const s = ensureSession(date, day);
    s.completed = true;
    if (ui.recovers) {
      s.recovers = ui.recovers;
      const m = state.missed.find(x => x.date === ui.recovers && x.status === 'open');
      if (m) { m.status = 'done'; m.resolvedBy = s.id; }
      ui.recovers = null;
    }
    save(); toast('¡Entrenamiento guardado! Cada esfuerzo cuenta.'); render();
  }
  const updater = (date, day, i) => fn => {
    const s = ensureSession(date, day); fn(s.exercises[i]); save();
    const st = $('#session-status'); if (st) st.textContent = statusText(s);
    const dc = $('#done-count'); if (dc) dc.textContent = s.exercises.filter(x => x.done).length + ' / ' + s.exercises.length;
  };
  const doneBox = (e, i, upd) => { const c = h('input', { type: 'checkbox', checked: e.done, 'aria-label': 'Ejercicio ' + (i + 1) + ' hecho' }); c.addEventListener('change', () => upd(x => { x.done = c.checked; })); return c; };
  const altBadge = e => h('span', { class: 'alt-badge' }, e.alt ? 'Alternativa ' + e.alt + '/3' : 'Principal · 3 alternativas');
  function exerciseItem(date, day, i, e) {
    const base = ROUTINE.days[day].exercises[i];
    return h('div', { class: 'ex', 'data-ex': String(i) }, h('div', { class: 'ex-head' }, doneBox(e, i, updater(date, day, i)),
      h('button', { type: 'button', class: 'ex-toggle', 'aria-expanded': 'false', onclick: () => { ui.open = i; ui.pane = 'alt'; render(); self.scrollTo(0, 0); } },
        illustration(day, i, e.alt, 'thumb', 'thumb'),
        h('span', { class: 'ex-info' }, h('strong', { class: 'ex-name' }, (i + 1) + '. ' + e.name), h('span', { class: 'pill' }, base.prescription), altBadge(e)),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))));
  }
  function detailView(date, day, i) {
    const s = findSession(date, day), exs = s ? s.exercises : blankExercises(day), e = exs[i], n = exs.length, base = ROUTINE.days[day].exercises[i], upd = updater(date, day, i);
    const goEx = j => { ui.open = j; render(); self.scrollTo(0, 0); };
    const choose = alt => { upd(x => { x.alt = alt; x.name = exName(day, i, alt); }); render(); };
    const sel = h('select', { 'aria-label': 'Variación del ejercicio ' + (i + 1) }, h('option', { value: '0' }, 'Principal: ' + base.name), ...base.alternatives.map((a, j) => h('option', { value: String(j + 1) }, (j + 1) + '. ' + a)));
    sel.value = String(e.alt);
    sel.addEventListener('change', () => choose(Number(sel.value)));
    const setRow = (x, j) => {
      const reps = h('input', { type: 'text', inputmode: 'numeric', value: x.reps === null ? '' : String(x.reps), placeholder: 'reps', class: 'reps', autocomplete: 'off', 'aria-label': 'Serie ' + (j + 1) + ': repeticiones' });
      const load = h('input', { type: 'text', inputmode: 'decimal', value: x.load === null ? '' : String(x.load), placeholder: 'kg', class: 'load', autocomplete: 'off', 'aria-label': 'Serie ' + (j + 1) + ': carga en kg' });
      reps.addEventListener('change', () => { const r = readNum(reps, R.reps, { int: true }); mark(reps, r.ok); if (!r.ok) return toast('Repeticiones: número entero entre 0 y 100.', true); upd(y => { y.sets[j].reps = r.v; }); });
      load.addEventListener('change', () => { const r = readNum(load, R.load); mark(load, r.ok); if (!r.ok) return toast('Carga: número entre 0 y 500 kg, con hasta 2 decimales.', true); upd(y => { y.sets[j].load = r.v; }); });
      return h('div', { class: 'set' }, h('span', { class: 'muted tiny' }, 'Serie ' + (j + 1)), load, reps);
    };
    const prev = lastPerformance(e.name, date);
    const tiles = h('div', { class: 'alts', role: 'group', 'aria-label': 'Ejercicio principal y alternativas' }, ...[0, 1, 2, 3].map(a =>
      h('button', { type: 'button', class: 'alt-tile', 'aria-pressed': String(e.alt === a), 'data-alt': String(a), onclick: () => { if (e.alt !== a) choose(a); } },
        illustration(day, i, a, 'thumb', ''), h('span', {}, (a ? a + '. ' : 'Principal: ') + exName(day, i, a)))));
    const panes = { alt: h('div', { id: 'pane-alt' }, tiles, field('Variación', sel)), tec: infoPane(day, i, e.alt, 'tec'), mus: infoPane(day, i, e.alt, 'mus') };
    const pane = panes[ui.pane] ? ui.pane : 'alt';
    const doneDays = exs.filter(x => x.done).length;
    return [h('div', { id: 'ex-detail', class: 'detail', 'data-ex': String(i) },
      h('div', { class: 'detail-top' }, btn('‹ Volver', () => goEx(null), 'back', { id: 'ex-back' }),
        h('span', { class: 'muted tiny' }, DAY(day) + ' · ' + fmtShort(date)), h('span', { class: 'pill', id: 'ex-pos', 'aria-label': 'Ejercicio ' + (i + 1) + ' de ' + n }, (i + 1) + ' / ' + n)),
      recoverBanner(),
      h('h2', { class: 'ex-name' }, (i + 1) + '. ' + e.name),
      h('div', { class: 'row tags' }, h('span', { class: 'pill' }, base.prescription), altBadge(e)),
      h('figure', { class: 'hero' }, illustration(day, i, e.alt, 'large', 'large'),
        h('figcaption', { class: 'tiny muted' }, e.alt ? e.name + ' · alternativa de ' + base.name : e.name)),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Información del ejercicio' },
        ...[['alt', 'Alternativas (3)'], ['tec', 'Técnica'], ['mus', 'Músculos']].map(([k, l]) => btn(l, () => { ui.pane = k; render(); }, pane === k ? 'on' : '', { 'data-pane': k, 'aria-pressed': String(pane === k) }))),
      panes[pane],
      h('h3', { class: 'sets-title' }, 'Series y repeticiones'),
      prev ? h('p', { class: 'tiny muted' }, prev) : null,
      h('div', { class: 'sets' }, h('div', { class: 'set set-head', 'aria-hidden': 'true' }, h('span', {}, 'Serie'), h('span', {}, 'Peso (kg)'), h('span', {}, 'Repeticiones')), ...e.sets.map(setRow)),
      h('div', { class: 'row' },
        btn('+ Añadir serie', () => { upd(x => { if (x.sets.length < 10) x.sets.push({ reps: null, load: null }); }); render(); }, 'small secondary', { 'data-action': 'add-set' }),
        btn('− Quitar serie', () => {
          const sess = findSession(date, day), cur = sess ? sess.exercises[i] : e;
          if (cur.sets.length <= 1) return toast('Cada ejercicio necesita al menos una serie.', true);
          const lastSet = cur.sets[cur.sets.length - 1];
          if ((lastSet.reps !== null || lastSet.load !== null) && !confirm('¿Quitar la última serie y sus datos?')) return;
          upd(x => { x.sets.pop(); }); render();
        }, 'small secondary', { 'data-action': 'remove-set' })),
      h('label', { class: 'done-row' }, doneBox(e, i, upd), h('span', {}, 'Ejercicio hecho')),
      h('div', { class: 'ex-nav' },
        btn('‹ Anterior', () => goEx(i - 1), 'secondary', { disabled: i === 0, 'data-action': 'prev-ex' }),
        btn(i < n - 1 ? 'Siguiente ›' : 'Volver a la lista', () => goEx(i < n - 1 ? i + 1 : null), '', { 'data-action': 'next-ex' }))),
      card(h('div', { class: 'row' }, h('span', { class: 'pill', id: 'session-status' }, statusText(s)), h('span', { class: 'pill', id: 'done-count', 'aria-label': 'Ejercicios hechos' }, doneDays + ' / ' + n)),
        sessionActions(date, day, s))];
  }

  // ---------- Historial
  function tabHistorial() {
    const out = [subnav(), h('h2', {}, 'Historial')], d = ui.histDate || today();
    const din = dateInput('hist-date', d);
    din.addEventListener('change', () => { if (!dateOk(din.value)) { toast('Elige una fecha válida que no sea futura.', true); din.value = d; return; } ui.histDate = din.value; render(); });
    const items = state.sessions.filter(s => s.date === d).map(sessionItem);
    const bw = state.bodyweights.find(x => x.date === d); if (bw) items.push(h('p', {}, 'Peso: ' + kg(bw.value)));
    const ms = state.measures.find(x => x.date === d); if (ms) items.push(h('p', {}, 'Medidas: ' + measureText(ms)));
    const mi = state.missed.find(x => x.date === d); if (mi) items.push(h('p', {}, 'Ausencia: ' + mi.reason + ' · ' + DECISIONS[mi.decision]));
    out.push(card(h('h3', {}, 'Consultar por fecha'), field('Fecha', din), h('div', { id: 'hist-day' }, ...(items.length ? items : [h('p', { class: 'muted' }, 'Sin registros ese día.')]))));
    const all = [...state.sessions].sort((a, b) => b.date.localeCompare(a.date) || a.day - b.day);
    out.push(card(h('h3', {}, 'Entrenamientos (' + all.length + ')'), h('div', { id: 'hist-list' }, ...(all.length ? all.map(sessionItem) : [h('p', { class: 'muted' }, 'Todavía no hay entrenamientos registrados.')]))));
    out.push(missedSection());
    return out;
  }
  function sessionItem(s) {
    const done = s.exercises.filter(e => e.done).length, vol = volume(s);
    return h('div', { class: 'item', 'data-session': s.date + '/' + s.day },
      h('div', {}, h('strong', {}, fmt(s.date) + ' · ' + DAY(s.day)),
        h('div', { class: 'tiny muted' }, focus(s.day) + ' · ' + (s.completed ? 'Completado' : 'Sin completar') + ' · ' + done + '/5 ejercicios' + (vol ? ' · ' + fmtNum(vol) + ' kg de volumen' : '') + (s.recovers ? ' · recupera la sesión del ' + fmtShort(s.recovers) : ''))),
      h('div', { class: 'row' },
        btn('Ver / editar', () => { ui.date = s.date; ui.day = s.day; ui.recovers = null; go('entrenar'); }, 'small secondary', { 'data-action': 'edit-session' }),
        btn('Eliminar', () => { if (confirm('¿Eliminar el registro del ' + fmt(s.date) + ' (' + DAY(s.day) + ')? No se puede deshacer.')) { removeSession(s); save(); toast('Registro eliminado'); render(); } }, 'small danger', { 'data-action': 'delete-session' })));
  }
  const decisionSelect = (id, value) => {
    const s = h('select', id ? { id } : { 'aria-label': 'Decisión' }, ...Object.entries(DECISIONS).map(([k, v]) => h('option', { value: k, disabled: k === 'short' }, k === 'short' ? v + ' (pendiente de aprobación)' : v)));
    s.value = value || 'recover'; return s;
  };
  function missedSection() {
    const din = dateInput('miss-date', today());
    const reason = h('select', { id: 'miss-reason' }, ...REASONS.map(r => h('option', {}, r)));
    const decision = decisionSelect('miss-decision');
    const add = btn('Guardar ausencia', () => {
      const d = din.value;
      if (!dateOk(d)) { mark(din, false); return toast('Elige una fecha válida que no sea futura.', true); }
      if (weekdayIdx(d) > 4) { mark(din, false); return toast('Los fines de semana no hay entrenamiento programado.', true); }
      mark(din, true);
      const prev = state.missed.find(m => m.date === d);
      if (prev && !confirm('Ya hay una ausencia registrada el ' + fmt(d) + '. ¿Reemplazarla?')) return;
      state.missed = state.missed.filter(m => m !== prev);
      state.missed.push({ id: newId(), date: d, day: weekdayIdx(d), reason: reason.value, decision: decision.value, status: decision.value === 'recover' ? 'open' : 'done', resolvedBy: null });
      save(); toast('Ausencia guardada'); render();
    }, '', { id: 'save-missed' });
    const items = [...state.missed].sort((a, b) => b.date.localeCompare(a.date)).map(m => {
      const sel = decisionSelect(null, m.decision);
      sel.addEventListener('change', () => { m.decision = sel.value; m.status = m.decision === 'recover' && !m.resolvedBy ? 'open' : 'done'; save(); toast('Decisión actualizada'); render(); });
      return h('div', { class: 'item', 'data-missed': m.date },
        h('div', {}, h('strong', {}, fmt(m.date) + ' · ' + DAY(m.day)), h('div', { class: 'tiny muted' }, m.reason + (m.decision === 'recover' ? (m.status === 'open' ? ' · pendiente de recuperar' : m.resolvedBy ? ' · recuperada' : ' · no recuperada') : ''))),
        sel,
        h('div', { class: 'row' }, btn('Eliminar', () => { if (confirm('¿Eliminar la ausencia del ' + fmt(m.date) + '?')) { state.missed = state.missed.filter(x => x !== m); save(); toast('Ausencia eliminada'); render(); } }, 'small danger', { 'data-action': 'delete-missed' })));
    });
    return card(h('h3', {}, 'Ausencias y decisiones'), field('Fecha', din), field('Motivo', reason), field('¿Qué prefieres hacer?', decision), add,
      h('p', { class: 'tiny muted' }, 'Nada se reprograma automáticamente.'),
      h('div', { id: 'missed-list' }, ...(items.length ? items : [h('p', { class: 'muted' }, 'Sin ausencias registradas.')])));
  }

  // ---------- Cuerpo: peso y medidas
  function tabCuerpo() {
    const out = [subnav(), h('h2', {}, 'Peso y medidas')];
    // Espacio reservado para el avatar de evolución corporal (se incorporará cuando esté aprobado).
    out.push(h('div', { class: 'card info avatar-slot', id: 'avatar-slot' }, h('div', { class: 'eyebrow' }, 'Avatar de evolución corporal'),
      h('p', { class: 'muted tiny' }, 'Espacio reservado. Se incorporará cuando su diseño esté aprobado; no afecta a tus registros.')));
    const ew = ui.editWeight && state.bodyweights.find(x => x.id === ui.editWeight);
    const val = h('input', { type: 'text', inputmode: 'decimal', id: 'weight-value', placeholder: 'Ej. 80,5', value: ew ? String(ew.value) : '', autocomplete: 'off' });
    const wd = dateInput('weight-date', ew ? ew.date : today());
    const saveW = () => {
      const r = readNum(val, R.bodyweight, { optional: false }); mark(val, r.ok);
      if (!r.ok) return toast('Peso: número entre ' + R.bodyweight[0] + ' y ' + R.bodyweight[1] + ' kg.', true);
      const d = wd.value; mark(wd, dateOk(d));
      if (!dateOk(d)) return toast('Elige una fecha válida que no sea futura.', true);
      const clash = state.bodyweights.find(x => x.date === d && x !== ew);
      if (clash && !confirm('Ya hay un peso registrado el ' + fmt(d) + ' (' + kg(clash.value) + '). ¿Reemplazarlo?')) return;
      state.bodyweights = state.bodyweights.filter(x => x !== clash && x !== ew);
      state.bodyweights.push({ id: ew ? ew.id : newId(), date: d, value: r.v });
      ui.editWeight = null; save(); toast('Peso guardado'); render();
    };
    const wl = [...state.bodyweights].sort((a, b) => b.date.localeCompare(a.date)).map(x => h('div', { class: 'item', 'data-weight': x.date },
      h('div', {}, fmt(x.date) + ': ' + kg(x.value)),
      h('div', { class: 'row' },
        btn('Editar', () => { ui.editWeight = x.id; render(); }, 'small secondary', { 'data-action': 'edit-weight' }),
        btn('Eliminar', () => { if (confirm('¿Eliminar el peso del ' + fmt(x.date) + '?')) { state.bodyweights = state.bodyweights.filter(y => y !== x); if (ui.editWeight === x.id) ui.editWeight = null; save(); toast('Peso eliminado'); render(); } }, 'small danger', { 'data-action': 'delete-weight' }))));
    out.push(card(h('h3', {}, ew ? 'Editar peso' : 'Peso corporal'),
      h('div', { class: 'row' }, field('Peso (kg)', val), field('Fecha', wd)),
      h('div', { class: 'row' }, btn(ew ? 'Guardar cambios' : 'Guardar peso', saveW, '', { id: 'save-weight' }), ew ? btn('Cancelar', () => { ui.editWeight = null; render(); }, 'secondary') : null),
      h('div', { id: 'weight-list' }, ...(wl.length ? wl : [h('p', { class: 'muted' }, 'Registra tu primer peso.')]))));

    const em = ui.editMeasure && state.measures.find(x => x.id === ui.editMeasure);
    const md = dateInput('measure-date', em ? em.date : today());
    const inputs = Object.fromEntries(Object.keys(MEASURES).map(k => [k, h('input', { type: 'text', inputmode: 'decimal', id: 'measure-' + k, placeholder: 'cm', value: em && em[k] !== null ? String(em[k]) : '', autocomplete: 'off' })]));
    const saveM = () => {
      const vals = {}; let bad = false;
      for (const k of Object.keys(MEASURES)) { const r = readNum(inputs[k], R.measure); mark(inputs[k], r.ok); if (!r.ok) bad = true; else vals[k] = r.v; }
      if (bad) return toast('Medidas: números entre ' + R.measure[0] + ' y ' + R.measure[1] + ' cm.', true);
      if (Object.values(vals).every(v => v === null)) return toast('Indica al menos una medida.', true);
      const d = md.value; mark(md, dateOk(d));
      if (!dateOk(d)) return toast('Elige una fecha válida que no sea futura.', true);
      const clash = state.measures.find(x => x.date === d && x !== em);
      if (clash && !confirm('Ya hay medidas registradas el ' + fmt(d) + '. ¿Reemplazarlas?')) return;
      state.measures = state.measures.filter(x => x !== clash && x !== em);
      state.measures.push(Object.assign({ id: em ? em.id : newId(), date: d }, vals));
      ui.editMeasure = null; save(); toast('Medidas guardadas'); render();
    };
    const ml = [...state.measures].sort((a, b) => b.date.localeCompare(a.date)).map(x => h('div', { class: 'item', 'data-measure': x.date },
      h('div', {}, fmt(x.date) + ': ' + measureText(x)),
      h('div', { class: 'row' },
        btn('Editar', () => { ui.editMeasure = x.id; render(); }, 'small secondary', { 'data-action': 'edit-measure' }),
        btn('Eliminar', () => { if (confirm('¿Eliminar las medidas del ' + fmt(x.date) + '?')) { state.measures = state.measures.filter(y => y !== x); if (ui.editMeasure === x.id) ui.editMeasure = null; save(); toast('Medidas eliminadas'); render(); } }, 'small danger', { 'data-action': 'delete-measure' }))));
    out.push(card(h('h3', {}, em ? 'Editar medidas' : 'Medidas corporales'), field('Fecha', md),
      h('div', { class: 'grid' }, ...Object.entries(MEASURES).map(([k, l]) => field(l + ' (cm)', inputs[k]))),
      h('div', { class: 'row' }, btn(em ? 'Guardar cambios' : 'Guardar medidas', saveM, '', { id: 'save-measure' }), em ? btn('Cancelar', () => { ui.editMeasure = null; render(); }, 'secondary') : null),
      h('div', { id: 'measure-list' }, ...(ml.length ? ml : [h('p', { class: 'muted' }, 'Sin medidas registradas.')]))));
    return out;
  }

  // ---------- Progreso
  function tabProgreso() {
    const out = [subnav(), h('h2', {}, 'Progreso')];
    const w = sortedWeights(), g = state.goals.weight;
    const cw = h('canvas', { class: 'chart', id: 'chart-weight', role: 'img', 'aria-label': 'Gráfico de peso corporal' });
    after.push(() => drawLine(cw, w.map(x => ({ d: x.date, v: x.value })), g, 'kg'));
    let summary = 'Registra tu peso para ver tu evolución.';
    if (w.length) {
      const first = w[0].value, last = w[w.length - 1].value, diff = Math.round((last - first) * 10) / 10;
      summary = 'Inicio ' + kg(first) + ' · Actual ' + kg(last) + ' · Cambio ' + (diff > 0 ? '+' : '') + fmtNum(diff) + ' kg';
      if (g !== null) { const rest = Math.round(Math.abs(last - g) * 10) / 10; summary += rest === 0 || (first >= g ? last <= g : last >= g) ? ' · Meta alcanzada' : ' · Faltan ' + kg(rest) + ' para tu meta'; }
    }
    out.push(card(h('h3', {}, 'Peso corporal'), cw, h('p', { class: 'tiny muted', id: 'weight-summary' }, summary), dataTable(w.map(x => [fmt(x.date), kg(x.value)]))));

    const msel = h('select', { id: 'measure-select' }, ...Object.entries(MEASURES).map(([k, l]) => h('option', { value: k }, l)));
    msel.value = ui.measure; msel.addEventListener('change', () => { ui.measure = msel.value; render(); });
    const mp = state.measures.filter(m => m[ui.measure] !== null).sort((a, b) => a.date.localeCompare(b.date)).map(m => ({ d: m.date, v: m[ui.measure] }));
    const cm = h('canvas', { class: 'chart', id: 'chart-measure', role: 'img', 'aria-label': 'Gráfico de ' + MEASURES[ui.measure] });
    after.push(() => drawLine(cm, mp, state.goals[ui.measure], 'cm'));
    out.push(card(h('h3', {}, 'Medidas'), field('Medida', msel), cm, dataTable(mp.map(p => [fmt(p.d), fmtNum(p.v) + ' cm']))));

    const names = strengthNames();
    if (!names.includes(ui.strengthEx)) ui.strengthEx = names[0] || null;
    const ssel = h('select', { id: 'strength-select' }, ...names.map(n => h('option', { value: n }, n)));
    if (ui.strengthEx) ssel.value = ui.strengthEx;
    ssel.addEventListener('change', () => { ui.strengthEx = ssel.value; render(); });
    const sp = ui.strengthEx ? strengthSeries(ui.strengthEx) : [];
    const cs = h('canvas', { class: 'chart', id: 'chart-strength', role: 'img', 'aria-label': 'Gráfico de fuerza' });
    after.push(() => drawLine(cs, sp, null, 'kg'));
    let ssum = 'Completa entrenamientos con cargas registradas para ver tu evolución de fuerza.';
    if (sp.length) { const best = Math.max(...sp.map(p => p.v)), d = Math.round((sp[sp.length - 1].v - sp[0].v) * 100) / 100; ssum = 'Mejor carga ' + kg(best) + ' · Última ' + kg(sp[sp.length - 1].v) + ' · Cambio ' + (d > 0 ? '+' : '') + fmtNum(d) + ' kg'; }
    out.push(card(h('h3', {}, 'Evolución de fuerza'), names.length ? field('Ejercicio', ssel) : null, cs, h('p', { class: 'tiny muted', id: 'strength-summary' }, ssum), dataTable(sp.map(p => [fmt(p.d), kg(p.v)]))));

    const wk = weeklyCounts(8);
    const cb = h('canvas', { class: 'chart', id: 'chart-weeks', role: 'img', 'aria-label': 'Sesiones por semana' });
    after.push(() => drawBars(cb, wk, state.goals.perWeek));
    out.push(card(h('h3', {}, 'Constancia (sesiones por semana)'), cb, h('p', { class: 'tiny muted' }, 'Línea discontinua: tu objetivo de ' + state.goals.perWeek + ' sesiones por semana.'), dataTable(wk.map(b => ['Semana del ' + b.label, String(b.v)]))));

    const ach = achievements();
    out.push(card(h('h3', {}, 'Logros (' + ach.filter(a => a.ok).length + '/' + ach.length + ')'),
      h('div', { class: 'badges', id: 'achievements' }, ...ach.map(a => h('div', { class: 'badge' + (a.ok ? ' on' : ''), 'data-ach': a.id, 'data-ok': String(a.ok) }, h('strong', {}, (a.ok ? '★ ' : '☆ ') + a.name), h('div', { class: 'tiny muted' }, a.desc))))));
    return out;
  }

  // ---------- Ajustes: objetivos, copias, almacenamiento
  function tabAjustes() {
    const out = [h('h2', {}, 'Ajustes')], g = state.goals;
    const gw = h('input', { type: 'text', inputmode: 'decimal', id: 'goal-weight', placeholder: 'Sin meta', value: g.weight === null ? '' : String(g.weight), autocomplete: 'off' });
    const per = h('select', { id: 'goal-perweek' }, ...[1, 2, 3, 4, 5].map(n => h('option', { value: String(n) }, n + (n === 1 ? ' sesión' : ' sesiones'))));
    per.value = String(g.perWeek);
    const gm = Object.fromEntries(Object.keys(MEASURES).map(k => [k, h('input', { type: 'text', inputmode: 'decimal', id: 'goal-' + k, placeholder: 'Sin meta', value: g[k] === null ? '' : String(g[k]), autocomplete: 'off' })]));
    const saveGoals = () => {
      const r = readNum(gw, R.goalWeight); mark(gw, r.ok);
      if (!r.ok) return toast('Meta de peso: número entre ' + R.goalWeight[0] + ' y ' + R.goalWeight[1] + ' kg, o vacío.', true);
      const ms = {}; let bad = false;
      for (const k of Object.keys(MEASURES)) { const x = readNum(gm[k], R.measure); mark(gm[k], x.ok); if (!x.ok) bad = true; else ms[k] = x.v; }
      if (bad) return toast('Metas de medidas: números entre ' + R.measure[0] + ' y ' + R.measure[1] + ' cm, o vacío.', true);
      const pw = Number(per.value); if (!isInt(pw, 1, 5)) return toast('Sesiones por semana: de 1 a 5.', true);
      state.goals = Object.assign({ weight: r.v, perWeek: pw }, ms);
      save(); toast('Objetivos guardados'); render();
    };
    out.push(card(h('h3', {}, 'Mis objetivos'),
      field('Meta de peso (kg)', gw, 'Se guarda solo en este dispositivo. Déjalo vacío si no quieres meta.'),
      field('Sesiones por semana', per),
      h('div', { class: 'grid' }, ...Object.entries(MEASURES).map(([k, l]) => field(l + ' meta (cm)', gm[k]))),
      btn('Guardar objetivos', saveGoals, '', { id: 'save-goals' })));

    out.push(card(h('h3', {}, 'Rutina'), h('p', { class: 'warn', id: 'routine-status' }, CFG.routineNotice),
      h('p', { class: 'muted', id: 'short-status' }, 'Sesiones cortas de 15–20 minutos: pendientes de aprobación. No están disponibles todavía.')));

    const file = h('input', { type: 'file', id: 'import-file', accept: 'application/json,.json', class: 'hidden-file', 'aria-label': 'Elegir copia de seguridad' });
    file.addEventListener('change', () => { const f = file.files && file.files[0]; file.value = ''; importFile(f); });
    const errs = ui.importErrors.length ? h('div', { id: 'import-errors' }, h('p', { class: 'warn' }, 'La copia no se importó:'), h('ul', { class: 'errors' }, ...ui.importErrors.map(e => h('li', {}, e)))) : null;
    out.push(card(h('h3', {}, 'Copia de seguridad'),
      h('p', { class: 'muted tiny' }, 'Tus datos se guardan solo en este dispositivo y nunca se envían a ningún servidor. Exporta una copia de vez en cuando: si borras los datos de Safari, se perderían.'),
      h('div', { class: 'stack' }, btn('Exportar copia (JSON)', exportData, '', { id: 'export' }), field('Importar copia', file)), errs));

    const ps = h('p', { class: 'tiny muted', id: 'storage-status' }, 'Comprobando…');
    after.push(() => {
      if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(p => { ps.textContent = p ? 'El navegador protege estos datos frente a borrados automáticos.' : 'El navegador podría borrar los datos si no usas la app durante semanas. Añádela a la pantalla de inicio y exporta copias.'; }).catch(() => { ps.textContent = 'No se pudo comprobar la protección del almacenamiento.'; });
      else ps.textContent = 'Este navegador no informa si protege los datos. Exporta copias periódicamente.';
    });
    out.push(card(h('h3', {}, 'Almacenamiento'), ps,
      h('p', { class: 'tiny muted' }, 'Para instalarla en el iPhone: Safari › Compartir › «Añadir a pantalla de inicio».'),
      btn('Borrar todos los datos', () => {
        if (!confirm('¿Borrar TODOS los registros de ' + CFG.name + ' en este dispositivo?')) return;
        if (!confirm('Esta acción no se puede deshacer. ¿Seguro? Te recomendamos exportar una copia antes.')) return;
        state = empty(); save(); setDate(today()); toast('Datos borrados'); render();
      }, 'danger', { id: 'wipe' })));
    return out;
  }
  function exportData() {
    download(JSON.stringify({ format: 'fit-backup', app: CFG.id, schema: SCHEMA, exportedAt: new Date().toISOString(), data: state }, null, 2), CFG.id + '-copia-' + today() + '.json');
    toast('Copia exportada');
  }
  function parseBackup(text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { return { errors: ['El archivo no es JSON válido.'] }; }
    if (isPlain(o) && o.format === 'fit-backup') {
      const extra = Object.keys(o).filter(k => !['format', 'app', 'schema', 'exportedAt', 'data'].includes(k));
      if (extra.length) return { errors: ['La copia tiene campos no admitidos.'] };
      if (o.app !== CFG.id) return { errors: ['La copia pertenece a otra aplicación.'] };
      if (o.schema !== SCHEMA && o.schema !== OLD_SCHEMA) return { errors: ['Versión de copia no admitida.'] };
      if (!isPlain(o.data) || o.data.schema !== o.schema) return { errors: ['La versión de la copia no coincide con sus datos.'] };
      if (typeof o.exportedAt !== 'string' || o.exportedAt.length > 40) return { errors: ['Fecha de exportación no válida.'] };
      return validateData(o.data);
    }
    if (isPlain(o) && o.version === 2 && o.app === CFG.legacyName) {
      try { const c = fromLegacy(o.data); const v = validateData(c.data); return v.data ? { data: v.data, report: c.report } : v; }
      catch (e) { return { errors: ['La copia de la versión anterior no es válida.'] }; }
    }
    if (isPlain(o) && typeof o.app === 'string') return { errors: ['La copia pertenece a otra aplicación.'] };
    return { errors: ['El archivo no corresponde a una copia de ' + CFG.name + '.'] };
  }
  function importFile(f, onDone) {
    if (!f) return;
    if (f.size > MAX_IMPORT_BYTES) { ui.importErrors = ['El archivo es demasiado grande para ser una copia válida.']; return render(); }
    const reader = new FileReader();
    reader.onload = () => {
      const res = parseBackup(String(reader.result));
      if (res.errors) { ui.importErrors = res.errors; toast('La copia no se importó.', true); return render(); }
      ui.importErrors = [];
      const d = res.data;
      if (!confirm('¿Reemplazar todos los registros actuales por esta copia? Contiene ' + d.sessions.length + ' entrenamientos, ' + d.bodyweights.length + ' pesos y ' + d.measures.length + ' medidas.')) return render();
      state = d;
      if (onDone) onDone();
      save(); setDate(today());
      toast('Copia restaurada' + (res.report && res.report.exercisesNotMigrated ? ' (' + res.report.exercisesNotMigrated + ' registros antiguos sin sesión no se migraron)' : ''));
      render();
    };
    reader.onerror = () => { ui.importErrors = ['No se pudo leer el archivo.']; render(); };
    reader.readAsText(f);
  }

  // ---------- Pantallas de bloqueo
  function hideAll() { for (const t of TABS) $('#tab-' + t).hidden = t !== 'inicio'; $('#nav').hidden = true; $('#go-settings').hidden = true; $('#banner').replaceChildren(); }
  function renderShared() {
    hideAll();
    $('#tab-inicio').replaceChildren(h('div', { class: 'card alert', id: 'blocked' },
      h('h2', {}, 'Dirección compartida'),
      h('p', {}, 'Esta dirección web ya la usa otra aplicación FIT. Para proteger la privacidad, ' + CFG.name + ' no lee ni guarda datos aquí.'),
      h('p', { class: 'muted' }, 'Abre ' + CFG.name + ' desde su propia dirección.')));
  }
  function renderCorrupt() {
    hideAll();
    const file = h('input', { type: 'file', id: 'import-file', accept: 'application/json,.json', 'aria-label': 'Elegir copia de seguridad' });
    file.addEventListener('change', () => { const f = file.files && file.files[0]; file.value = ''; importFile(f, () => { mode = 'ok'; $('#nav').hidden = false; }); });
    $('#tab-inicio').replaceChildren(h('div', { class: 'card alert', id: 'corrupt' },
      h('h2', {}, 'Datos guardados no válidos'),
      h('p', {}, 'Los datos de este dispositivo no superaron la validación de seguridad, así que no se cargaron. No se ha borrado nada.'),
      h('ul', { class: 'errors' }, ...corruptErrors.slice(0, 8).map(e => h('li', {}, e))),
      ui.importErrors.length ? h('ul', { class: 'errors', id: 'import-errors' }, ...ui.importErrors.map(e => h('li', {}, e))) : null,
      h('div', { class: 'stack' },
        btn('Descargar los datos tal como están', () => download(localStorage.getItem(KEY) || '', CFG.id + '-datos-no-validos-' + today() + '.json'), 'secondary', { id: 'download-raw' }),
        field('Restaurar una copia válida', file),
        btn('Borrar y empezar de cero', () => {
          if (!confirm('¿Borrar los datos no válidos y empezar de cero?')) return;
          if (!confirm('No se puede deshacer. ¿Seguro?')) return;
          mode = 'ok'; state = empty(); save(); setDate(today()); $('#nav').hidden = false; render();
        }, 'danger', { id: 'reset-corrupt' }))));
  }

  // ---------- Arranque
  function boot() {
    document.querySelectorAll('#nav button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
    $('#go-settings').addEventListener('click', () => go('ajustes'));
    mode = originCheck();
    if (mode === 'ok') load(); else if (mode === 'nostorage') state = empty();
    if (state) setDate(today());
    render();
    if (mode === 'ok' && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && mode !== 'shared') navigator.serviceWorker.register('sw.js').catch(() => {});
    let shown = today();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state && today() !== shown) { shown = today(); if (ui.tab === 'inicio') render(); } });
  }
  boot();
})();

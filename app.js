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
  // Esquema 4 = esquema 3 + abdomen, muslo y pantorrilla. Esquema 5 = esquema 4 + unidad de carga por sesión (kg o lb) y preferencias.
  // Los datos y copias de los esquemas 3 y 4 se aceptan: sus cargas se conservan tal cual, marcadas en kg (la unidad en que se registraron).
  const SCHEMA = 5, OLD_SCHEMA = 3, PREV_SCHEMAS = [3, 4], KEY = 'fit3:' + CFG.id, OWNER_KEY = 'fit-origin-owner', MAX_IMPORT_BYTES = 2000000, LOOKBACK_DAYS = 14;
  const PHOTO_KEY = KEY + ':foto', MAX_PHOTO_CHARS = 200000, PHOTO_SIZE = 320;
  // Unidades: cargas en lb o kg (elegible), peso corporal siempre en kg y medidas siempre en cm.
  const UNITS = ['lb', 'kg'], LB_KG = 0.45359237, DEFAULT_LOAD_UNIT = 'lb';
  const loadRange = u => u === 'lb' ? [0, 1100] : [0, 500];
  const conv = (v, from, to) => from === to ? v : to === 'kg' ? v * LB_KG : v / LB_KG;
  const r1 = v => Math.round(v * 10) / 10;
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
  const withUnit = (v, u) => fmtNum(v) + ' ' + u;

  // ---------- Rutina (datos fijos, solo lectura)
  const deepFreeze = o => { Object.freeze(o); Object.values(o).forEach(v => { if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); }); return o; };
  deepFreeze(ROUTINE);
  const DAY = i => ROUTINE.days[i].day;
  const focus = i => ROUTINE.days[i].focus;
  const setsOf = p => { const m = /^(\d+)\s*×/.exec(p); return m ? Math.min(10, Math.max(1, Number(m[1]))) : 3; };
  const exName = (day, i, alt) => { const e = ROUTINE.days[day].exercises[i]; return alt === 0 ? e.name : e.alternatives[alt - 1]; };
  // Una sesión registrada con otra versión de la rutina (p. ej. antes de reordenar los días) no encaja con la actual:
  // se conserva tal cual (récords e historial siguen por nombre) y se muestra en solo lectura para no mezclar ejercicios.
  const fitsRoutine = s => s.exercises.length === ROUTINE.days[s.day].exercises.length && s.exercises.every((e, i) => e.name === exName(s.day, i, e.alt));
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
    const TOP = ['schema', 'app', 'createdAt', 'goals', 'sessions', 'bodyweights', 'measures', 'missed'], v5 = isPlain(d) && d.schema === SCHEMA;
    if (!shape(d, v5 ? [...TOP, 'prefs'] : TOP, 'datos')) return { errors };
    if (d.schema !== SCHEMA && !PREV_SCHEMAS.includes(d.schema)) err('datos: versión no admitida');
    const mk = d.schema === OLD_SCHEMA ? OLD_MKEYS : MKEYS;
    if (d.app !== CFG.id) err('datos: pertenecen a otra aplicación');
    date(d.createdAt, 'datos: fecha de inicio');
    const out = { schema: SCHEMA, app: CFG.id, createdAt: d.createdAt, prefs: { loadUnit: DEFAULT_LOAD_UNIT }, goals: null, sessions: [], bodyweights: [], measures: [], missed: [] };
    if (v5 && shape(d.prefs, ['loadUnit'], 'preferencias')) { if (UNITS.includes(d.prefs.loadUnit)) out.prefs.loadUnit = d.prefs.loadUnit; else err('preferencias: unidad de carga no admitida'); }

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
      if (!shape(s, v5 ? ['id', 'date', 'day', 'completed', 'recovers', 'unit', 'exercises'] : ['id', 'date', 'day', 'completed', 'recovers', 'exercises'], w)) return;
      const unit = v5 ? s.unit : 'kg';
      if (!UNITS.includes(unit)) return err(w + ': unidad de carga no válida');
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
          if (!(x.load === null || isNum(x.load, loadRange(unit)))) err(q + ': carga fuera de rango');
          return { reps: x.reps, load: x.load };
        });
        return { alt: e.alt, name: e.name, done: e.done, sets };
      });
      out.sessions.push({ id: s.id, date: s.date, day: s.day, completed: s.completed, recovers: s.recovers, unit, exercises });
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
  const empty = () => ({ schema: SCHEMA, app: CFG.id, createdAt: today(), prefs: { loadUnit: DEFAULT_LOAD_UNIT }, goals: Object.assign({ weight: null, perWeek: 5 }, nullMeasures()), sessions: [], bodyweights: [], measures: [], missed: [] });

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
      d.sessions.push({ id: newId(), date: s.date, day: s.day, completed: true, recovers: null, unit: 'kg', exercises: blankExercises(s.day) });
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
      // Datos de un esquema anterior: se conserva una copia exacta antes de actualizarlos (no se pierde nada).
      if (parsed.schema !== SCHEMA) {
        try {
          localStorage.setItem(KEY + ':respaldo-esquema' + parsed.schema, raw); save();
          notice = (parsed.schema === OLD_SCHEMA ? 'Tus datos se actualizaron para admitir las nuevas medidas (abdomen, muslo y pantorrilla). ' : 'Tus datos se actualizaron. ')
            + 'Ahora las cargas se registran en libras (lb); tus cargas anteriores se conservan en kg tal como las anotaste. Se guardó una copia de la versión anterior.';
        } catch (e) { /* sin espacio: se sigue en memoria sin sobrescribir lo guardado */ }
      }
    }
    else { mode = 'corrupt'; corruptErrors = v.errors; }
  }

  // ---------- Foto de perfil (opcional, solo en este dispositivo)
  // Se recorta a un cuadrado de 320 px y se vuelve a codificar como JPEG: así desaparecen GPS, fecha, modelo y demás metadatos.
  // Se guarda aparte de los registros (clave fit3:<app>:foto) y nunca sale del dispositivo salvo en tus copias de seguridad.
  const PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
  function photoBytes(d) { try { const b = atob(d.slice(d.indexOf(',') + 1)); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; } catch (e) { return null; } }
  function photoValid(d) { if (typeof d !== 'string' || d.length > MAX_PHOTO_CHARS || !PHOTO_RE.test(d)) return false; const b = photoBytes(d); return !!b && b.length > 100 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff; }
  // Quita del JPEG todos los bloques de metadatos (APP1–APP15 y comentarios): algunos navegadores añaden su propio EXIF al codificar.
  function cleanJpeg(d) {
    const b = photoBytes(d); if (!b || b[0] !== 0xff || b[1] !== 0xd8) return null;
    const out = [b.subarray(0, 2)]; let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const m = b[i + 1];
      if (m === 0xda) { out.push(b.subarray(i)); break; }           // inicio de la imagen: el resto se copia tal cual
      const len = (b[i + 2] << 8) | b[i + 3]; if (len < 2 || i + 2 + len > b.length) return null;
      if (!((m >= 0xe1 && m <= 0xef) || m === 0xfe)) out.push(b.subarray(i, i + 2 + len));
      i += 2 + len;
    }
    let bin = ''; for (const part of out) for (let k = 0; k < part.length; k += 8192) bin += String.fromCharCode.apply(null, part.subarray(k, k + 8192));
    return 'data:image/jpeg;base64,' + btoa(bin);
  }
  let photoUrl = null;
  function photoSrc() {
    let d = null; try { d = localStorage.getItem(PHOTO_KEY); } catch (e) { d = null; }
    if (!d || !photoValid(d)) { if (photoUrl) { URL.revokeObjectURL(photoUrl.url); photoUrl = null; } return null; }
    if (!photoUrl || photoUrl.data !== d) { if (photoUrl) URL.revokeObjectURL(photoUrl.url); photoUrl = { data: d, url: URL.createObjectURL(new Blob([photoBytes(d)], { type: 'image/jpeg' })) }; }
    return photoUrl.url;
  }
  function setPhoto(d) { try { if (d === null) localStorage.removeItem(PHOTO_KEY); else localStorage.setItem(PHOTO_KEY, d); return true; } catch (e) { toast('No se pudo guardar la foto: almacenamiento lleno o bloqueado.', true); return false; } }
  async function decodeImage(file) {
    if (self.createImageBitmap) { try { return await createImageBitmap(file); } catch (e) { /* se intenta con <img> */ } }
    const url = URL.createObjectURL(file);
    try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { URL.revokeObjectURL(url); }
  }
  async function processPhoto(file) {
    if (!file) return;
    if (file.size > 30000000) return toast('La imagen es demasiado grande.', true);
    let img; try { img = await decodeImage(file); } catch (e) { return toast('No se pudo leer la imagen. Prueba con otra foto.', true); }
    const w = img.width, hh = img.height, side = Math.min(w, hh);
    if (!side) return toast('No se pudo leer la imagen.', true);
    const c = document.createElement('canvas'); c.width = c.height = PHOTO_SIZE;
    c.getContext('2d').drawImage(img, (w - side) / 2, (hh - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    if (img.close) img.close();
    let q = 0.86, d = cleanJpeg(c.toDataURL('image/jpeg', q));
    while (d && d.length > MAX_PHOTO_CHARS && q > 0.4) { q -= 0.12; d = cleanJpeg(c.toDataURL('image/jpeg', q)); }
    if (!photoValid(d)) return toast('No se pudo preparar la foto.', true);
    if (setPhoto(d)) { toast('Foto de perfil guardada en este dispositivo.'); render(); }
  }
  function avatar(cls, label) {
    const src = photoSrc();
    return src ? h('img', { src, alt: label || 'Foto de perfil', class: 'avatar ' + (cls || '') }) : h('span', { class: 'avatar placeholder ' + (cls || ''), 'aria-hidden': 'true' }, CFG.letter);
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
    if (!s) { s = { id: newId(), date, day, completed: false, recovers: null, unit: state.prefs.loadUnit, exercises: blankExercises(day) }; state.sessions.push(s); }
    return s;
  }
  function removeSession(s) {
    state.sessions = state.sessions.filter(x => x !== s);
    for (const m of state.missed) if (m.resolvedBy === s.id) { m.resolvedBy = null; m.status = m.decision === 'recover' ? 'open' : 'done'; }
  }
  const completed = () => state.sessions.filter(s => s.completed);
  const sortedWeights = () => [...state.bodyweights].sort((a, b) => a.date.localeCompare(b.date));
  const LU = () => state.prefs.loadUnit;
  // Volumen de una sesión en la unidad elegida (cada sesión conserva la unidad en que se registró).
  const volume = s => r1(s.exercises.reduce((t, e) => t + e.sets.reduce((u, x) => u + (x.reps != null && x.load != null ? conv(x.reps * x.load, s.unit, LU()) : 0), 0), 0));
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
  // Última vez que se hizo un ejercicio, con las cargas expresadas en la unidad pedida (redondeo a 0,1).
  function lastPerformance(name, before, unit) {
    const ss = completed().filter(s => s.date < before).sort((a, b) => b.date.localeCompare(a.date));
    for (const s of ss) for (const e of s.exercises) {
      if (e.name !== name) continue;
      const sets = e.sets.filter(x => x.reps !== null || x.load !== null).map(x => ({ reps: x.reps, load: x.load === null ? null : r1(conv(x.load, s.unit, unit)) }));
      if (sets.length) return { date: s.date, sets, converted: s.unit !== unit, from: s.unit,
        text: 'Última vez (' + fmtShort(s.date) + '): ' + sets.map(x => (x.reps ?? '–') + ' × ' + (x.load === null ? '–' : fmtNum(x.load)) + ' ' + unit).join(' · ') + (s.unit !== unit ? ' (convertido desde ' + s.unit + ')' : '') };
    }
    return null;
  }
  // Carga máxima por sesión para un ejercicio (series con repeticiones > 0 y carga indicada)
  function strengthSeries(name) {
    const byDate = new Map();
    for (const s of completed()) for (const e of s.exercises) {
      if (e.name !== name) continue;
      for (const x of e.sets) if (x.load !== null && x.reps !== null && x.reps > 0) byDate.set(s.date, Math.max(byDate.get(s.date) ?? -1, r1(conv(x.load, s.unit, LU()))));
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
  // Mensajes al completar (se van alternando) y al batir un récord. Neutros: valen para las dos apps.
  const DONE_MSGS = ['¡Entrenamiento guardado! Cada esfuerzo cuenta.', '¡Hecho! Hoy has sumado un día más a tu constancia.', 'Sesión completada. Tu yo del futuro te lo agradece.',
    '¡Bien hecho! La disciplina de hoy es el resultado de mañana.', 'Guardado. Volver a entrenar es lo que marca la diferencia.', '¡Otra sesión en el bolsillo! Descansa y recupérate bien.',
    'Completado. No hace falta que sea perfecto: hace falta que sea constante.', '¡Gran trabajo! Cada repetición te acerca a tu meta.'];
  const PR_MSGS = ['¡Nuevo récord en {x}!', '¡Has superado tu mejor carga en {x}!', '¡Récord personal en {x}! Sigue así.'];
  const pick = (list, seed) => list[Math.abs(seed) % list.length];
  const quoteOf = t => { const [y, m, d] = t.split('-').map(Number); return CFG.quotes[Math.floor(Date.UTC(y, m - 1, d) / 864e5) % CFG.quotes.length]; };

  // <silueta-generada> (exportar_silueta.py: misma figura que los mapas musculares; no editar a mano)
  const BODY = Object.freeze({"trunk":"M54 31C51.8 32.2 54.7 36.3 53 38C51.3 39.7 47 40 44 41C41 42 37.3 42.8 35 44C32.7 45.2 30.3 45.3 30 48C29.7 50.7 32 55.7 33 60C34 64.3 35.2 69 36 74C36.8 79 37.5 85 38 90C38.5 95 39 99.3 39 104C39 108.7 38.3 112 38 118C37.7 124 37 133 37 140C37 147 37.8 154.3 38 160C38.2 165.7 38.2 169 38 174C37.8 179 36.8 184.3 37 190C37.2 195.7 38.5 202.7 39 208C39.5 213.3 40.7 218.2 40 222C39.3 225.8 33.5 229.2 35 231C36.5 232.8 46.5 234.5 49 233C51.5 231.5 49.7 227.5 50 222C50.3 216.5 50.7 207.3 51 200C51.3 192.7 51.3 186.3 52 178C52.7 169.7 54 158.7 55 150C56 141.3 57.2 130.8 58 126C58.8 121.2 59.7 121.8 60 121C60.3 120.2 59.7 120.2 60 121C60.3 121.8 61.2 121.2 62 126C62.8 130.8 64 141.3 65 150C66 158.7 67.3 169.7 68 178C68.7 186.3 68.7 192.7 69 200C69.3 207.3 69.7 216.5 70 222C70.3 227.5 68.5 231.5 71 233C73.5 234.5 83.5 232.8 85 231C86.5 229.2 80.7 225.8 80 222C79.3 218.2 80.5 213.3 81 208C81.5 202.7 82.8 195.7 83 190C83.2 184.3 82.2 179 82 174C81.8 169 81.8 165.7 82 160C82.2 154.3 83 147 83 140C83 133 82.3 124 82 118C81.7 112 81 108.7 81 104C81 99.3 81.5 95 82 90C82.5 85 83.2 79 84 74C84.8 69 86 64.3 87 60C88 55.7 90.3 50.7 90 48C89.7 45.3 87.3 45.2 85 44C82.7 42.8 79 42 76 41C73 40 68.7 39.7 67 38C65.3 36.3 68.2 32.2 66 31C63.8 29.8 56.2 29.8 54 31Z","arms":["M31 46C29.5 45.3 27.2 49 26 52C24.8 55 24.5 60 24 64C23.5 68 23.3 72 23 76C22.7 80 22.5 84.3 22 88C21.5 91.7 20.8 94 20 98C19.2 102 17.5 108 17 112C16.5 116 16.5 118.8 17 122C17.5 125.2 18.7 129.5 20 131C21.3 132.5 24 132.5 25 131C26 129.5 25.2 125.8 26 122C26.8 118.2 28.8 112.3 30 108C31.2 103.7 32.2 100 33 96C33.8 92 34.5 88.3 35 84C35.5 79.7 36 74.7 36 70C36 65.3 35.8 60 35 56C34.2 52 32.5 46.7 31 46Z","M85 56C84.2 60 84 65.3 84 70C84 74.7 84.5 79.7 85 84C85.5 88.3 86.2 92 87 96C87.8 100 88.8 103.7 90 108C91.2 112.3 93.2 118.2 94 122C94.8 125.8 94 129.5 95 131C96 132.5 98.7 132.5 100 131C101.3 129.5 102.5 125.2 103 122C103.5 118.8 103.5 116 103 112C102.5 108 100.8 102 100 98C99.2 94 98.5 91.7 98 88C97.5 84.3 97.3 80 97 76C96.7 72 96.5 68 96 64C95.5 60 95.2 55 94 52C92.8 49 90.5 45.3 89 46C87.5 46.7 85.8 52 85 56Z"],"front":{"trapecio":["M53 38C51.8 37.3 47.3 40 45 41C42.7 42 37.8 43.3 39 44C40.2 44.7 49.7 46 52 45C54.3 44 54.2 38.7 53 38Z","M68 45C70.3 46 79.8 44.7 81 44C82.2 43.3 77.3 42 76 41C72.7 40 68.2 37.3 67 38C65.8 38.7 65.7 44 68 45Z"],"deltoides":["M40 44C38.2 44 34.2 44.5 32 46C29.8 47.5 27.8 50.3 27 53C26.2 55.7 26.5 59.8 27 62C27.5 64.2 28.7 66.7 30 66C31.3 65.3 33.3 60.5 35 58C36.7 55.5 38.7 53 40 51C41.3 49 43 47.2 43 46C43 44.8 41.8 44 40 44Z","M77 46C77 47.2 78.7 49 80 51C81.3 53 83.3 55.5 85 58C86.7 60.5 88.7 65.3 90 66C91.3 66.7 92.5 64.2 93 62C93.5 59.8 93.8 55.7 93 53C92.2 50.3 90.2 47.5 88 46C85.8 44.5 81.8 44 80 44C78.2 44 77 44.8 77 46Z"],"pectoral":["M58.5 47C56.2 43.7 48.4 45 45 46C41.6 47 39.3 50.3 38 53C36.7 55.7 36.5 59.5 37 62C37.5 64.5 38.8 66.8 41 68C43.2 69.2 47.1 69.3 50 69C52.9 68.7 57.1 69.7 58.5 66C59.9 62.3 60.8 50.3 58.5 47Z","M61.5 66C62.9 69.7 67.1 68.7 70 69C72.9 69.3 76.8 69.2 79 68C81.2 66.8 82.5 64.5 83 62C83.5 59.5 83.3 55.7 82 53C80.7 50.3 78.4 47 76 46C71.6 45 63.8 43.7 61.5 47C59.2 50.3 60.1 62.3 61.5 66Z"],"biceps":["M30 67C28.7 67.7 27.7 70.2 27 73C26.3 76 25.8 81 26 84C26.2 87 27 90.2 28 91C29 91.8 31 91 32 89C33 87 33.5 82.3 34 79C34.5 76 35.7 71 35 69C34.3 67 31.3 66.3 30 67Z","M85 69C84.3 71 85.5 76 86 79C86.5 82.3 87 87 88 89C89 91 91 91.8 92 91C93 90.2 93.8 87 94 84C94.2 81 93.7 76 93 73C92.3 70.2 91.3 67.7 90 67C88.7 66.3 85.7 67 85 69Z"],"antebrazo":["M27 94C25.5 95.5 24.2 100.2 23 104C21.8 107.8 20 114 20 117C20 120 21.8 121.3 23 122C24.2 122.7 25.8 123.3 27 121C28.2 118.7 29.2 112.3 30 108C30.8 103.7 32.5 97.3 32 95C31.5 92.7 28.5 92.5 27 94Z","M88 95C87.5 97.3 89.2 103.7 90 108C90.8 112.3 91.8 118.7 93 121C94.2 123.3 95.8 122.7 97 122C98.2 121.3 100 120 100 117C100 114 98.2 107.8 97 104C95.8 100.2 94.5 95.5 93 94C91.5 92.5 88.5 92.7 88 95Z"],"abdomen":["M58.5 71C57.2 64.3 52.6 69.5 51 71C49.4 72.5 49.3 76 49 80C48.7 84.3 48.7 92.5 49 97C49.3 101.5 49.4 104.7 51 107C52.6 109.3 57.2 117 58.5 111C59.8 105 59.8 77.7 58.5 71Z","M61.5 111C62.8 117 67.4 109.3 69 107C70.6 104.7 70.7 101.5 71 97C71.3 92.5 71.3 84.3 71 80C70.7 76 70.6 72.5 69 71C67.4 69.5 62.8 64.3 61.5 71C60.2 77.7 60.2 105 61.5 111Z"],"oblicuos":["M47 71C46 68.5 42.3 69.2 41 71C39.7 72.8 39.2 77.8 39 82C38.8 86.2 39.3 92.5 40 96C40.7 99.5 41.7 101.7 43 103C44.3 104.3 47.3 106.8 48 104C48.7 101.2 47.2 91.5 47 86C46.8 80.5 48 73.5 47 71Z","M73 86C72.8 91.5 71.3 101.2 72 104C72.7 106.8 76 104.3 77 103C78.3 101.7 79.3 99.5 80 96C80.7 92.5 81.2 86.2 81 82C80.8 77.8 80.3 72.8 79 71C77.7 69.2 74 68.5 73 71C72 73.5 73.2 80.5 73 86Z"],"cuadriceps":["M54 120C52.2 116.8 47.3 112.8 45 113C42.7 113.2 41 116.5 40 121C39 125.5 39 133.8 39 140C39 146.2 39.2 153.5 40 158C40.8 162.5 42.2 165.7 44 167C45.8 168.3 49.3 168.7 51 166C52.7 163.3 53.2 156.7 54 151C54.8 145.3 56 137.2 56 132C56 126.8 55.8 123.2 54 120Z","M64 132C64 137.2 65.2 145.3 66 151C66.8 156.7 67.3 163.3 69 166C70.7 168.7 74.2 168.3 76 167C77.8 165.7 79.2 162.5 80 158C80.8 153.5 81 146.2 81 140C81 133.8 81 125.5 80 121C79 116.5 77.3 113.2 76 113C72.7 112.8 67.8 116.8 66 120C64.2 123.2 64 126.8 64 132Z"],"aductores":["M58.5 121C58.2 119.7 57 122.8 56.5 126C56 129.2 55.4 136.5 55.5 140C55.6 143.5 56.5 148 57 147C57.5 146 58.2 138.3 58.5 134C58.8 129.7 58.8 122.3 58.5 121Z","M61.5 134C61.8 138.3 62.5 146 63 147C63.5 148 64.4 143.5 64.5 140C64.6 136.5 64 129.2 63.5 126C63 122.8 61.8 119.7 61.5 121C61.2 122.3 61.2 129.7 61.5 134Z"],"pantorrilla":["M40 177C38.5 179.2 38.8 184.8 39 190C39.2 195.2 40.2 203.2 41 208C41.8 212.8 42.8 217.2 44 219C45.2 220.8 47 221.5 48 219C49 216.5 49.7 209.5 50 204C50.3 198.5 50.3 190.5 50 186C49.7 181.5 49.7 178.5 48 177C46.3 175.5 41.5 174.8 40 177Z","M72 177C70.3 178.5 70.3 181.5 70 186C69.7 190.5 69.7 198.5 70 204C70.3 209.5 71 216.5 72 219C73 221.5 74.8 220.8 76 219C77.2 217.2 78.2 212.8 79 208C79.8 203.2 80.8 195.2 81 190C81.2 184.8 81.5 179.2 80 177C78.5 174.8 73.7 175.5 72 177Z"]},"back":{"trapecio":["M60 34C59 29 56.8 35.5 54 37C51.2 38.5 43.8 40.7 43 43C42.2 45.3 47 48.2 49 51C51 53.8 53.2 57.3 55 60C56.8 62.7 59.2 71.3 60 67C60.8 62.7 61 39 60 34Z","M60 67C60.8 71.3 63.2 62.7 65 60C66.8 57.3 69 53.8 71 51C73 48.2 77.8 45.3 77 43C76.2 40.7 68.8 38.5 66 37C63.2 35.5 61 29 60 34C59 39 59.2 62.7 60 67Z"],"deltoides":["M41 45C39 44.7 34.3 44.7 32 46C29.7 47.3 27.8 50.3 27 53C26.2 55.7 26.5 59.8 27 62C27.5 64.2 28.7 66.7 30 66C31.3 65.3 33.3 60.5 35 58C36.7 55.5 38.5 52.7 40 51C41.5 49.3 43.8 49 44 48C44.2 47 43 45.3 41 45Z","M76 48C76.2 49 78.5 49.3 80 51C81.5 52.7 83.3 55.5 85 58C86.7 60.5 88.7 65.3 90 66C91.3 66.7 92.5 64.2 93 62C93.5 59.8 93.8 55.7 93 53C92.2 50.3 90.3 47.3 88 46C85.7 44.7 81 44.7 79 45C77 45.3 76 47 76 48Z"],"dorsal":["M56 64C54.5 59.5 51.5 56.2 49 55C46.5 53.8 42.8 55.2 41 57C39.2 58.8 38 62.2 38 66C38 69.8 39.5 76 41 80C42.5 84.3 44.7 89.2 47 92C49.3 94.8 53.2 98.7 55 97C56.8 95.3 57.8 87.5 58 82C58.2 76.5 57.5 68.5 56 64Z","M62 82C62.2 87.5 63.2 95.3 65 97C66.8 98.7 70.7 94.8 73 92C76 89.2 77.5 84.3 79 80C80.5 76 82 69.8 82 66C82 62.2 80.8 58.8 79 57C77.2 55.2 73.5 53.8 71 55C68.5 56.2 65.5 59.5 64 64C62.5 68.5 61.8 76.5 62 82Z"],"triceps":["M30 65C28.7 66 27.7 68.7 27 72C26.3 76 25.8 81.7 26 85C26.2 88.3 26.8 91.5 28 92C29.2 92.5 31.8 90.5 33 88C34.2 85.5 34.7 80.7 35 77C35.3 73.3 35.8 68 35 66C34.2 64 31.3 64 30 65Z","M85 66C84.2 68 84.7 73.3 85 77C85.3 80.7 85.8 85.5 87 88C88.2 90.5 90.8 92.5 92 92C93.2 91.5 93.8 88.3 94 85C94.2 81.7 93.7 76 93 72C92.3 68.7 91.3 66 90 65C88.7 64 85.8 64 85 66Z"],"antebrazo":["M27 94C25.5 95.5 24.2 100.2 23 104C21.8 107.8 20 114 20 117C20 120 21.8 121.3 23 122C24.2 122.7 25.8 123.3 27 121C28.2 118.7 29.2 112.3 30 108C30.8 103.7 32.5 97.3 32 95C31.5 92.7 28.5 92.5 27 94Z","M88 95C87.5 97.3 89.2 103.7 90 108C90.8 112.3 91.8 118.7 93 121C94.2 123.3 95.8 122.7 97 122C98.2 121.3 100 120 100 117C100 114 98.2 107.8 97 104C95.8 100.2 94.5 95.5 93 94C91.5 92.5 88.5 92.7 88 95Z"],"lumbar":["M58.5 84C57.9 79.8 55.9 83.3 55 86C54.1 88.7 53.2 96.2 53 100C52.8 103.8 53.1 107.2 54 109C54.9 110.8 57.8 115.2 58.5 111C59.2 106.8 59.1 88.2 58.5 84Z","M61.5 111C62.2 115.2 65.1 110.8 66 109C66.9 107.2 67.2 103.8 67 100C66.8 96.2 65.9 88.7 65 86C64.1 83.3 62.1 79.8 61.5 84C60.9 88.2 60.8 106.8 61.5 111Z"],"gluteos":["M59 113C57.5 109.2 52.8 109.2 50 109C47.2 108.8 43.8 109.7 42 112C40.2 114.3 38.8 119.5 39 123C39.2 126.5 40.8 130.8 43 133C45.2 135.2 49.3 136.2 52 136C54.7 135.8 57.8 135.8 59 132C60.2 128.2 60.5 116.8 59 113Z","M61 132C62.2 135.8 65.3 135.8 68 136C70.7 136.2 74.8 135.2 77 133C79.2 130.8 80.8 126.5 81 123C81.2 119.5 79.8 114.3 78 112C76.2 109.7 72.8 108.8 70 109C67.2 109.2 62.5 109.2 61 113C59.5 116.8 59.8 128.2 61 132Z"],"isquios":["M57 139C55 137 47.8 136 45 137C42.2 138 41 141.3 40 145C39 148.7 38.7 155 39 159C39.3 163 40.2 167 42 169C43.8 171 48 172.5 50 171C52 169.5 52.8 163.7 54 160C55.2 156.3 56.5 152.5 57 149C57.5 145.5 59 141 57 139Z","M63 149C63.5 152.5 64.8 156.3 66 160C67.2 163.7 68 169.5 70 171C72 172.5 76.2 171 78 169C79.8 167 80.7 163 81 159C81.3 155 81 148.7 80 145C79 141.3 77.8 138 76 137C72.2 136 65 137 63 139C61 141 62.5 145.5 63 149Z"],"pantorrilla":["M41 176C39.2 177.7 38.2 183.8 38 188C37.8 192.2 39 197.3 40 201C41 204.7 42.7 209.2 44 210C45.3 210.8 47 209.3 48 206C49 202.7 49.8 194.7 50 190C50.2 185.3 50.5 180.3 49 178C47.5 175.7 42.8 174.3 41 176Z","M71 178C69.5 180.3 69.8 185.3 70 190C70.2 194.7 71 202.7 72 206C73 209.3 74.7 210.8 76 210C77.3 209.2 79 204.7 80 201C81 197.3 82.2 192.2 82 188C81.8 183.8 80.8 177.7 79 176C77.2 174.3 72.5 175.7 71 178Z"]}});
  // </silueta-generada>
  // ---------- Zonas por meta (verde / rojo / gris)
  // Solo compara centímetros medidos con la meta: no afirma nada sobre grasa o músculo.
  // Verde: la última medida está a ≤ 0,5 cm de la meta o al menos 0,5 cm más cerca que la primera. Rojo: al menos 0,5 cm más lejos.
  // Gris: sin meta, menos de dos medidas o cambio menor de 0,5 cm.
  const ZONE_TOL = 0.5;
  function zoneOf(k) {
    const g = state.goals[k], ms = state.measures.filter(m => m[k] !== null).sort((a, b) => a.date.localeCompare(b.date));
    const first = ms[0] ? ms[0][k] : null, last = ms.length ? ms[ms.length - 1][k] : null;
    let status = 'gray', why = g === null ? 'Sin meta' : ms.length < 2 ? 'Faltan medidas para comparar' : 'Sin cambio significativo';
    if (g !== null && last !== null && Math.abs(last - g) <= ZONE_TOL) { status = 'green'; why = 'Meta alcanzada'; }
    else if (g !== null && ms.length >= 2) {
      const d0 = Math.abs(first - g), d1 = Math.abs(last - g);
      if (d0 - d1 >= ZONE_TOL) { status = 'green'; why = 'Más cerca de la meta (' + fmtNum(r1(d0 - d1)) + ' cm)'; }
      else if (d1 - d0 >= ZONE_TOL) { status = 'red'; why = 'Más lejos de la meta (' + fmtNum(r1(d1 - d0)) + ' cm)'; }
    }
    const pct = g !== null && first !== null && last !== null && first !== g ? Math.max(0, Math.min(100, Math.round((first - last) / (first - g) * 100))) : (g !== null && last !== null && Math.abs(last - g) <= ZONE_TOL ? 100 : null);
    return { k, label: MEASURES[k], goal: g, first, last, status, why, pct };
  }
  const ZONE_TXT = { green: 'Verde', red: 'Rojo', gray: 'Gris' };
  function zonesCard(id) {
    const zs = MKEYS.map(zoneOf);
    return h('div', { class: 'card', id }, h('h3', {}, 'Metas de medidas'),
      h('div', { class: 'zones' }, ...zs.map(z => h('div', { class: 'zone ' + z.status, 'data-zone': z.k, 'data-status': z.status },
        h('div', { class: 'row between' }, h('strong', {}, h('span', { class: 'zdot ' + z.status, 'aria-hidden': 'true' }), z.label), h('span', { class: 'tiny muted' }, ZONE_TXT[z.status] + ' · ' + z.why)),
        h('div', { class: 'tiny muted' }, (z.first !== null ? 'Inicio ' + fmtNum(z.first) + ' cm · Actual ' + fmtNum(z.last) + ' cm' : 'Sin medidas') + (z.goal !== null ? ' · Meta ' + fmtNum(z.goal) + ' cm' : '')),
        z.pct !== null ? h('div', { class: 'bar', role: 'img', 'aria-label': z.pct + ' % del camino hacia la meta' }, h('i', { style: null, 'data-pct': String(z.pct) })) : null))),
      h('p', { class: 'tiny muted' }, 'Criterio: verde si la medida se acerca a la meta (0,5 cm o más) o la alcanza; rojo si se aleja 0,5 cm o más; gris si no hay meta, faltan medidas o el cambio es menor. Las medidas no indican por sí solas si el cambio es grasa o músculo.'));
  }
  const fillBars = root => root.querySelectorAll('.bar i[data-pct]').forEach(i => { i.style.width = i.dataset.pct + '%'; });

  // ---------- Silueta 2D: colorea la figura (frente y espalda) con el estado de cada zona (mismo criterio que la lista)
  const ZONE_REGIONS = { chest: { front: ['pectoral'] }, arm: { front: ['biceps'], back: ['triceps'] }, waist: { front: ['oblicuos'] }, abdomen: { front: ['abdomen'] },
    hip: { back: ['gluteos'] }, thigh: { front: ['cuadriceps', 'aductores'], back: ['isquios'] }, calf: { front: ['pantorrilla'], back: ['pantorrilla'] } };
  const SVGNS = "http://www.w3.org/2000/svg"; // espacio de nombres SVG (no es una conexión)
  const sv = (tag, attrs) => { const el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); return el; };
  function bodyCard() {
    const zs = Object.fromEntries(MKEYS.map(k => [k, zoneOf(k)])), owner = {};
    for (const [k, views] of Object.entries(ZONE_REGIONS)) for (const [view, regs] of Object.entries(views)) for (const r of regs) owner[view + ':' + r] = k;
    const svg = sv('svg', { viewBox: '0 0 260 250', class: 'body-map', role: 'img', 'aria-label': 'Silueta con tus zonas: ' + MKEYS.map(k => MEASURES[k] + ' ' + ZONE_TXT[zs[k].status].toLowerCase()).join(', ') });
    ['front', 'back'].forEach((view, n) => {
      const g = sv('g', { transform: 'translate(' + (6 + n * 128) + ' 4)' });
      g.append(sv('ellipse', { cx: '60', cy: '19', rx: '10.5', ry: '12.5', class: 'bz-skin' }), sv('path', { d: BODY.trunk, class: 'bz-skin' }), ...BODY.arms.map(d => sv('path', { d, class: 'bz-skin' })));
      for (const [r, ds] of Object.entries(BODY[view])) {
        const k = owner[view + ':' + r], cls = k ? 'bz-zone ' + zs[k].status : 'bz-muscle';
        for (const d of ds) { const p = sv('path', { d, class: cls }); if (k) p.setAttribute('data-zone', k); g.append(p); }
      }
      svg.append(g);
      const t = sv('text', { x: String(66 + n * 128), y: '246', 'text-anchor': 'middle', class: 'bz-label' }); t.textContent = n ? 'Espalda' : 'Frente'; svg.append(t);
    });
    return h('div', { class: 'card', id: 'body-card' }, h('div', { class: 'eyebrow' }, 'Evolución corporal'), h('h3', {}, 'Tu cuerpo según tus metas'), svg,
      h('div', { class: 'body-legend tiny' }, ...[['green', 'Se acerca o alcanza la meta'], ['red', 'Se aleja'], ['gray', 'Sin meta o sin datos']].map(([s, l]) => h('span', {}, h('span', { class: 'zdot ' + s, 'aria-hidden': 'true' }), l))),
      h('p', { class: 'tiny muted' }, 'Representación sencilla de tus zonas; no es una imagen real de tu cuerpo.'));
  }

  // ---------- Gráficos (canvas, sin librerías)
  function chartSetup(c) {
    const dpr = Math.min(3, self.devicePixelRatio || 1), W = c.clientWidth || 320, H = c.clientHeight || 200;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim();
    x.font = '12px -apple-system, system-ui, sans-serif';
    return { x, W, H, accent: v('--accent'), muted: v('--muted'), line: v('--line'), warn: v('--warn') };
  }
  // Línea con cuadrícula, área, meta y último valor. Al tocar el gráfico se muestra el punto más cercano.
  function drawLine(c, pts, goal, unit) {
    const draw = sel => {
      const { x, W, H, accent, muted, line, warn } = chartSetup(c);
      x.fillStyle = muted;
      if (!pts.length) { x.fillText('Sin datos todavía', 12, H / 2); return; }
      const ts = pts.map(p => parseISO(p.d).getTime());
      let t0 = Math.min(...ts), t1 = Math.max(...ts); if (t0 === t1) { t0 -= 864e5; t1 += 864e5; }
      const vals = pts.map(p => p.v).concat(goal !== null && goal !== undefined ? [goal] : []);
      let lo = Math.min(...vals), hi = Math.max(...vals); const padv = Math.max(1, (hi - lo) * 0.15); lo -= padv; hi += padv;
      const L = 44, Rm = 14, T = 26, B = 24, X = t => L + (t - t0) / (t1 - t0) * (W - L - Rm), Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
      x.strokeStyle = line; x.lineWidth = 1; x.fillStyle = muted;
      for (let k = 0; k <= 3; k++) { const v = lo + (hi - lo) * k / 3, y = Y(v); x.globalAlpha = .55; x.beginPath(); x.moveTo(L, y); x.lineTo(W - Rm, y); x.stroke(); x.globalAlpha = 1; x.fillText(fmtNum(Math.round(v * 10) / 10), 2, y + 4); }
      x.fillText(unit, 2, 10);
      x.fillText(fmtShort(pts[0].d), L, H - 6); const lastLabel = fmtShort(pts[pts.length - 1].d); x.fillText(lastLabel, W - Rm - x.measureText(lastLabel).width, H - 6);
      if (goal !== null && goal !== undefined) { x.setLineDash([6, 5]); x.strokeStyle = warn; x.lineWidth = 1.5; x.beginPath(); x.moveTo(L, Y(goal)); x.lineTo(W - Rm, Y(goal)); x.stroke(); x.setLineDash([]); x.fillStyle = warn; x.fillText('meta ' + fmtNum(goal), L + 4, Y(goal) - 5); }
      const P = pts.map((p, i) => ({ px: X(ts[i]), py: Y(p.v), p }));
      if (P.length > 1) { const g = x.createLinearGradient(0, T, 0, H - B); g.addColorStop(0, accent + '66'); g.addColorStop(1, accent + '00');
        x.fillStyle = g; x.beginPath(); x.moveTo(P[0].px, H - B); P.forEach(q => x.lineTo(q.px, q.py)); x.lineTo(P[P.length - 1].px, H - B); x.closePath(); x.fill(); }
      x.strokeStyle = accent; x.lineWidth = 2.5; x.lineJoin = 'round'; x.beginPath(); P.forEach((q, i) => i ? x.lineTo(q.px, q.py) : x.moveTo(q.px, q.py)); x.stroke();
      x.fillStyle = accent; P.forEach(q => { x.beginPath(); x.arc(q.px, q.py, 3, 0, Math.PI * 2); x.fill(); });
      const k = sel === undefined ? P.length - 1 : sel, q = P[k], label = (sel === undefined ? '' : fmtShort(q.p.d) + ': ') + fmtNum(q.p.v) + ' ' + unit;
      x.beginPath(); x.arc(q.px, q.py, 6, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill(); x.lineWidth = 3; x.strokeStyle = accent; x.stroke();
      x.font = '600 12px -apple-system, system-ui, sans-serif'; const tw = x.measureText(label).width + 12, bx = Math.min(W - Rm - tw, Math.max(L, q.px - tw / 2)), by = Math.max(0, q.py - 30);
      x.fillStyle = accent; x.beginPath(); x.roundRect ? x.roundRect(bx, by, tw, 20, 6) : x.rect(bx, by, tw, 20); x.fill(); x.fillStyle = '#fff'; x.fillText(label, bx + 6, by + 14);
      c._hit = P;
    };
    draw();
    if (!c._bound && pts.length) {
      c._bound = true;
      const near = ev => { const r = c.getBoundingClientRect(), px = ev.clientX - r.left; let best = 0; (c._hit || []).forEach((q, i) => { if (Math.abs(q.px - px) < Math.abs(c._hit[best].px - px)) best = i; }); draw(best); };
      c.addEventListener('pointerdown', near); c.addEventListener('pointermove', ev => { if (ev.buttons || ev.pointerType === 'touch') near(ev); });
    }
  }
  function drawBars(c, bars, target) {
    const { x, W, H, accent, muted, line, warn } = chartSetup(c);
    const hi = Math.max(5, target, ...bars.map(b => b.v)), L = 24, B = 24, T = 10, bw = (W - L - 8) / bars.length;
    x.strokeStyle = line; x.beginPath(); x.moveTo(L, H - B); x.lineTo(W - 4, H - B); x.stroke();
    const ok = getComputedStyle(document.documentElement).getPropertyValue('--ok').trim();
    bars.forEach((b, i) => {
      const bh = b.v / hi * (H - B - T);
      x.fillStyle = b.v >= target ? ok : accent; x.globalAlpha = i === bars.length - 1 ? 1 : .8;
      x.beginPath(); x.roundRect ? x.roundRect(L + i * bw + 4, H - B - bh, bw - 8, bh, [6, 6, 0, 0]) : x.rect(L + i * bw + 4, H - B - bh, bw - 8, bh); x.fill(); x.globalAlpha = 1;
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
    const src = photoSrc(), ab = $('#avatar-btn');
    if (ab) { ab.hidden = !src; if (src) ab.replaceChildren(h('img', { src, alt: '', class: 'avatar' })); }
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
    const rb = recoverBanner(); if (rb) out.push(rb);
    const sc = ui.day !== null ? summaryCard(date, ui.day) : null; if (sc) out.push(sc);
    if (ui.day === null) { out.push(card(h('p', { id: 'weekend' }, 'Es fin de semana: según tu plan es día de descanso. Si entrenaste, elige arriba la rutina que hiciste.'))); return out; }
    const day = ui.day, s = findSession(date, day), list = h('div', { id: 'exercises' }), exs = s ? s.exercises : blankExercises(day);
    if (s && !fitsRoutine(s)) { out.push(legacyCard(s)); return out; }
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
  // Récords: ejercicios de la sesión cuya mayor carga (con repeticiones) supera la mejor de las sesiones completadas ANTERIORES.
  function sessionPRs(s) {
    const out = [];
    for (const e of s.exercises) {
      const loads = e.sets.filter(x => x.load !== null && x.reps !== null && x.reps > 0).map(x => r1(conv(x.load, s.unit, LU())));
      if (!loads.length) continue;
      const prev = strengthSeries(e.name).filter(p => p.d < s.date);
      if (prev.length && Math.max(...loads) > Math.max(...prev.map(p => p.v))) out.push({ name: e.name, value: Math.max(...loads) });
    }
    return out;
  }
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
    const prs = sessionPRs(s);
    ui.summary = { date, day, prs, vol: volume(s), done: s.exercises.filter(e => e.done).length };
    save(); toast(prs.length ? pick(PR_MSGS, completed().length).replace('{x}', prs[0].name) : pick(DONE_MSGS, completed().length)); render();
  }
  // Resumen que aparece al completar una sesión
  function summaryCard(date, day) {
    const m = ui.summary; if (!m || m.date !== date || m.day !== day) return null;
    return h('div', { class: 'card celebrate', id: 'session-summary' },
      h('div', { class: 'eyebrow' }, 'Sesión completada'),
      h('div', { class: 'grid three' }, h('div', { class: 'kpi' }, h('b', {}, m.done + '/5'), 'ejercicios'), h('div', { class: 'kpi' }, h('b', {}, m.vol ? withUnit(m.vol, LU()) : '—'), 'volumen'), h('div', { class: 'kpi' }, h('b', { id: 'summary-prs' }, String(m.prs.length)), m.prs.length === 1 ? 'récord' : 'récords')),
      m.prs.length ? h('ul', { class: 'prs' }, ...m.prs.map(p => h('li', {}, '★ ' + p.name + ': ' + withUnit(p.value, LU())))) : null,
      btn('Cerrar', () => { ui.summary = null; render(); }, 'small secondary'));
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
  // Registro de una versión anterior de la rutina: consulta y eliminación, sin edición.
  function legacyCard(s) {
    const setTxt = (x, u) => (x.reps !== null ? x.reps + ' rep.' : '— rep.') + (x.load !== null ? ' · ' + withUnit(x.load, u) : '');
    return card(h('div', { class: 'eyebrow' }, 'Rutina anterior'), h('h2', { id: 'work-title' }, DAY(s.day) + ' · ' + fmt(s.date)),
      h('p', { class: 'muted tiny', id: 'legacy-note' }, 'Este entrenamiento se registró con la versión anterior de tu rutina. Se conserva tal cual: puedes consultarlo o eliminarlo, pero no editarlo. Tus récords y gráficos lo siguen contando.'),
      h('ul', { class: 'legacy-list', id: 'legacy-list' }, ...s.exercises.map(e => h('li', {}, h('strong', {}, (e.done ? '✓ ' : '') + e.name),
        h('div', { class: 'tiny muted' }, e.sets.filter(x => x.reps !== null || x.load !== null).map(x => setTxt(x, s.unit)).join(' · ') || 'Sin series registradas')))),
      h('div', { class: 'row' }, h('span', { class: 'pill' }, statusText(s))),
      btn('Eliminar este registro', () => { if (confirm('¿Eliminar el registro del ' + fmt(s.date) + ' (' + DAY(s.day) + ')? No se puede deshacer.')) { removeSession(s); save(); toast('Registro eliminado'); render(); } }, 'danger', { id: 'delete-session' }));
  }
  function detailView(date, day, i) {
    { const s0 = findSession(date, day); if (s0 && !fitsRoutine(s0)) { ui.open = null; return tabEntrenar(); } }
    const s = findSession(date, day), exs = s ? s.exercises : blankExercises(day), e = exs[i], n = exs.length, base = ROUTINE.days[day].exercises[i], upd = updater(date, day, i);
    const goEx = j => { ui.open = j; render(); self.scrollTo(0, 0); };
    const choose = alt => { upd(x => { x.alt = alt; x.name = exName(day, i, alt); }); render(); };
    const sel = h('select', { 'aria-label': 'Variación del ejercicio ' + (i + 1) }, h('option', { value: '0' }, 'Principal: ' + base.name), ...base.alternatives.map((a, j) => h('option', { value: String(j + 1) }, (j + 1) + '. ' + a)));
    sel.value = String(e.alt);
    sel.addEventListener('change', () => choose(Number(sel.value)));
    // Cada sesión guarda la unidad en que se registró; una sesión nueva usa la unidad elegida en Ajustes.
    const u = s ? s.unit : LU(), lr = loadRange(u);
    const setRow = (x, j) => {
      const reps = h('input', { type: 'text', inputmode: 'numeric', value: x.reps === null ? '' : String(x.reps), placeholder: 'reps', class: 'reps', autocomplete: 'off', 'aria-label': 'Serie ' + (j + 1) + ': repeticiones' });
      const load = h('input', { type: 'text', inputmode: 'decimal', value: x.load === null ? '' : String(x.load), placeholder: u, class: 'load', autocomplete: 'off', 'aria-label': 'Serie ' + (j + 1) + ': carga en ' + u });
      reps.addEventListener('change', () => { const r = readNum(reps, R.reps, { int: true }); mark(reps, r.ok); if (!r.ok) return toast('Repeticiones: número entero entre 0 y 100.', true); upd(y => { y.sets[j].reps = r.v; }); });
      load.addEventListener('change', () => { const r = readNum(load, lr); mark(load, r.ok); if (!r.ok) return toast('Carga: número entre 0 y ' + lr[1] + ' ' + u + ', con hasta 2 decimales.', true); upd(y => { y.sets[j].load = r.v; }); });
      return h('div', { class: 'set' }, h('span', { class: 'muted tiny' }, 'Serie ' + (j + 1)), load, reps);
    };
    const prev = lastPerformance(e.name, date, u);
    const emptySets = e.sets.every(x => x.reps === null && x.load === null);
    const repeat = prev && emptySets ? btn('↺ Repetir la última vez (' + prev.sets.length + (prev.sets.length === 1 ? ' serie)' : ' series)'), () => {
      upd(x => { x.sets = prev.sets.slice(0, 10).map(y => ({ reps: y.reps, load: y.load !== null && y.load <= lr[1] ? y.load : null })); }); toast('Series copiadas de la última vez. Ajusta lo que cambie.'); render();
    }, 'small outline', { 'data-action': 'repeat-last' }) : null;
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
      prev ? h('p', { class: 'tiny muted', id: 'last-time' }, prev.text) : null, repeat,
      h('div', { class: 'sets' }, h('div', { class: 'set set-head', 'aria-hidden': 'true' }, h('span', {}, 'Serie'), h('span', {}, 'Peso (' + u + ')'), h('span', {}, 'Repeticiones')), ...e.sets.map(setRow)),
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
        h('div', { class: 'tiny muted' }, (fitsRoutine(s) ? focus(s.day) : 'Rutina anterior') + ' · ' + (s.completed ? 'Completado' : 'Sin completar') + ' · ' + done + '/5 ejercicios' + (vol ? ' · ' + withUnit(vol, LU()) + ' de volumen' : '') + (s.recovers ? ' · recupera la sesión del ' + fmtShort(s.recovers) : ''))),
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
    // Silueta 2D con las zonas por meta (sustituye al espacio reservado para el avatar 3D, aparcado).
    out.push(bodyCard());
    out.push(zonesCard('zones-body')); after.push(() => fillBars($('#zones-body')));
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
    out.push(zonesCard('zones-progress')); after.push(() => fillBars($('#zones-progress')));

    const names = strengthNames();
    if (!names.includes(ui.strengthEx)) ui.strengthEx = names[0] || null;
    const ssel = h('select', { id: 'strength-select' }, ...names.map(n => h('option', { value: n }, n)));
    if (ui.strengthEx) ssel.value = ui.strengthEx;
    ssel.addEventListener('change', () => { ui.strengthEx = ssel.value; render(); });
    const sp = ui.strengthEx ? strengthSeries(ui.strengthEx) : [];
    const cs = h('canvas', { class: 'chart', id: 'chart-strength', role: 'img', 'aria-label': 'Gráfico de fuerza' });
    after.push(() => drawLine(cs, sp, null, LU()));
    let ssum = 'Completa entrenamientos con cargas registradas para ver tu evolución de fuerza.';
    if (sp.length) { const best = Math.max(...sp.map(p => p.v)), d = Math.round((sp[sp.length - 1].v - sp[0].v) * 100) / 100; ssum = 'Mejor carga ' + withUnit(best, LU()) + ' · Última ' + withUnit(sp[sp.length - 1].v, LU()) + ' · Cambio ' + (d > 0 ? '+' : '') + fmtNum(d) + ' ' + LU(); }
    out.push(card(h('h3', {}, 'Evolución de fuerza'), names.length ? field('Ejercicio', ssel) : null, cs, h('p', { class: 'tiny muted', id: 'strength-summary' }, ssum), dataTable(sp.map(p => [fmt(p.d), withUnit(p.v, LU())]))));

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
    const pf = h('input', { type: 'file', id: 'photo-file', accept: 'image/*', class: 'hidden-file', 'aria-label': 'Elegir foto de perfil' });
    pf.addEventListener('change', () => { const f = pf.files && pf.files[0]; pf.value = ''; processPhoto(f); });
    const hasPhoto = !!photoSrc();
    out.push(h('div', { class: 'card profile', id: 'profile' },
      h('div', { class: 'row' }, h('div', { class: 'avatar-wrap' }, avatar('big', 'Tu foto de perfil')),
        h('div', {}, h('h3', {}, 'Perfil'), h('p', { class: 'tiny muted' }, 'Foto opcional. Se recorta en círculo y se guarda solo en este iPhone, sin ubicación ni otros datos de la foto. No se sube a ningún servidor.'))),
      h('div', { class: 'row' }, h('label', { class: 'button-like', for: 'photo-file' }, hasPhoto ? 'Cambiar foto' : 'Elegir foto'), pf,
        hasPhoto ? btn('Quitar foto', () => { if (confirm('¿Quitar la foto de perfil de este dispositivo?')) { setPhoto(null); toast('Foto quitada'); render(); } }, 'secondary', { id: 'photo-remove' }) : null)));
    const lu = h('select', { id: 'load-unit' }, h('option', { value: 'lb' }, 'Libras (lb)'), h('option', { value: 'kg' }, 'Kilogramos (kg)'));
    lu.value = LU();
    lu.addEventListener('change', () => { if (!UNITS.includes(lu.value)) return; state.prefs.loadUnit = lu.value; save(); toast('Las cargas nuevas se registrarán en ' + lu.value + '.'); render(); });
    out.push(card(h('h3', {}, 'Unidades'), field('Cargas de los ejercicios', lu, 'Se aplica a los entrenamientos nuevos. Los ya registrados conservan su unidad; gráficos y resúmenes se convierten (1 lb = 0,4536 kg).'),
      h('p', { class: 'tiny muted', id: 'fixed-units' }, 'Peso corporal en kilogramos (kg) y medidas en centímetros (cm).')));
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
        state = empty(); save(); setPhoto(null); setDate(today()); toast('Datos borrados'); render();
      }, 'danger', { id: 'wipe' })));
    return out;
  }
  function exportData() {
    const backup = { format: 'fit-backup', app: CFG.id, schema: SCHEMA, exportedAt: new Date().toISOString(), data: state };
    let ph = null; try { ph = localStorage.getItem(PHOTO_KEY); } catch (e) { ph = null; }
    if (ph && photoValid(ph)) backup.photo = ph;
    download(JSON.stringify(backup, null, 2), CFG.id + '-copia-' + today() + '.json');
    toast('Copia exportada');
  }
  function parseBackup(text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { return { errors: ['El archivo no es JSON válido.'] }; }
    if (isPlain(o) && o.format === 'fit-backup') {
      const extra = Object.keys(o).filter(k => !['format', 'app', 'schema', 'exportedAt', 'data', 'photo'].includes(k));
      if (extra.length) return { errors: ['La copia tiene campos no admitidos.'] };
      if (o.app !== CFG.id) return { errors: ['La copia pertenece a otra aplicación.'] };
      if (o.schema !== SCHEMA && !PREV_SCHEMAS.includes(o.schema)) return { errors: ['Versión de copia no admitida.'] };
      if (has(o, 'photo') && !photoValid(o.photo)) return { errors: ['La foto de la copia no es válida.'] };
      if (!isPlain(o.data) || o.data.schema !== o.schema) return { errors: ['La versión de la copia no coincide con sus datos.'] };
      if (typeof o.exportedAt !== 'string' || o.exportedAt.length > 40) return { errors: ['Fecha de exportación no válida.'] };
      const v = validateData(o.data); if (v.data && has(o, 'photo')) v.photo = o.photo; return v;
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
      if (res.photo) setPhoto(res.photo);
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
    if ($('#avatar-btn')) $('#avatar-btn').addEventListener('click', () => go('ajustes'));
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

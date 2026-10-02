// データ層（この端末の localStorage に保存する版。Firebase を使わない場合に動く）
import { normalizeId, findStudent, seatOf } from './attendance.js';

const KEY_COURSES = 'att.courses';
const KEY_SESSIONS = 'att.sessions';
const KEY_DEVICE = 'att.deviceId';

const listeners = new Set();

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  notify();
}

function notify() {
  listeners.forEach((fn) => fn());
}

// 別タブでの変更（学生タブ → 教員タブなど）を受け取る
window.addEventListener('storage', (e) => {
  if (e.key && e.key.startsWith('att.')) notify();
});

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function newId() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 端末ID。URL に ?device=xxx を付けると別端末として扱える（動作確認用）
export function deviceId() {
  const override = new URLSearchParams(location.search).get('device');
  if (override) return `test-${override}`;
  let id = localStorage.getItem(KEY_DEVICE);
  if (!id) {
    id = newId() + newId();
    localStorage.setItem(KEY_DEVICE, id);
  }
  return id;
}

// ログインは使わない版なので、常に「教員として扱う」
export const auth = {
  ready: Promise.resolve(),
  user: () => ({ uid: 'local', name: 'この端末', email: '' }),
  isTeacher: () => true,
  emailAllowed: () => true,
  signIn: async () => {},
  signOut: async () => {},
};

function defaultCourse() {
  const now = new Date();
  return {
    title: '',
    roomName: '',
    year: now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear(),
    term: now.getMonth() >= 3 && now.getMonth() < 8 ? '前期' : '後期',
    day: 1,
    period: 1,
    cols: 6,
    rows: 5,
    roster: [],
    seats: {},
    disabled: [],
    colGaps: [],
    rowGaps: [],
    groups: {},
    flipped: false,
    freeSeating: false, // true なら座席を指定せず、学生が好きな空席を選ぶ
  };
}

function emptySession(date) {
  return { date, open: true, memo: '', records: {}, devices: {} };
}

export async function listCourses() {
  return Object.values(load(KEY_COURSES));
}

export async function getCourse(id) {
  const c = load(KEY_COURSES)[id];
  return c ? { ...defaultCourse(), ...c } : null;
}

export async function createCourse(data) {
  const all = load(KEY_COURSES);
  const id = newId();
  const now = Date.now();
  all[id] = { ...defaultCourse(), ...data, id, createdAt: now, lastAccess: now };
  save(KEY_COURSES, all);
  return id;
}

export async function updateCourse(id, patch) {
  const all = load(KEY_COURSES);
  if (!all[id]) throw new Error('授業が見つかりません');
  const cur = { ...defaultCourse(), ...all[id] };
  const next = typeof patch === 'function' ? patch(structuredClone(cur)) : { ...cur, ...patch };
  all[id] = next;
  save(KEY_COURSES, all);
  return next;
}

export async function touchCourse(id) {
  const all = load(KEY_COURSES);
  if (!all[id]) return;
  all[id].lastAccess = Date.now();
  localStorage.setItem(KEY_COURSES, JSON.stringify(all));
}

export async function deleteCourse(id) {
  const courses = load(KEY_COURSES);
  const sessions = load(KEY_SESSIONS);
  delete courses[id];
  delete sessions[id];
  localStorage.setItem(KEY_SESSIONS, JSON.stringify(sessions));
  save(KEY_COURSES, courses);
}

export async function getSession(courseId, date) {
  return load(KEY_SESSIONS)[courseId]?.[date] || emptySession(date);
}

export async function listSessions(courseId) {
  return Object.values(load(KEY_SESSIONS)[courseId] || {}).sort((a, b) => a.date.localeCompare(b.date));
}

// fn の中で例外を投げると保存されない
function updateSession(courseId, date, fn) {
  const all = load(KEY_SESSIONS);
  all[courseId] ??= {};
  const cur = all[courseId][date] || emptySession(date);
  const next = fn(structuredClone(cur));
  all[courseId][date] = next;
  save(KEY_SESSIONS, all);
  return next;
}

export async function setOpen(courseId, date, open) {
  return updateSession(courseId, date, (s) => ((s.open = open), s));
}

export async function setMemo(courseId, date, memo) {
  return updateSession(courseId, date, (s) => ((s.memo = memo), s));
}

export async function clearSession(courseId, date) {
  return updateSession(courseId, date, (s) => ((s.records = {}), (s.devices = {}), s));
}

// 教員による出欠の変更。status が null なら記録を消して「未登録」に戻す
export async function setStatus(courseId, date, studentId, status, { seat = null, name = '' } = {}) {
  return updateSession(courseId, date, (s) => {
    const prev = s.records[studentId];
    if (!status) {
      delete s.records[studentId];
      for (const [d, sid] of Object.entries(s.devices)) if (sid === studentId) delete s.devices[d];
      return s;
    }
    s.records[studentId] = {
      seat: prev?.seat ?? seat,
      name: prev?.name || name,
      time: prev?.time ?? (status === 'absent' || status === 'excused' ? null : Date.now()),
      method: prev?.method ?? 'teacher',
      status,
    };
    return s;
  });
}

// 名簿にない学生の記録について、入力間違いの学籍番号や氏名を直す
export async function renameRecord(courseId, date, oldSid, newSid, newName) {
  return updateSession(courseId, date, (s) => {
    const rec = s.records[oldSid];
    if (!rec) throw new Error('記録が見つかりません');
    if (newSid !== oldSid && s.records[newSid]) throw new Error('その学籍番号は、すでにこの日に登録されています');
    delete s.records[oldSid];
    s.records[newSid] = { ...rec, name: newName };
    for (const [d, sid] of Object.entries(s.devices)) if (sid === oldSid) s.devices[d] = newSid;
    return s;
  });
}

// 席の入れ替え・シャッフルに合わせて、記録上の座席も動かす
export async function updateRecordSeats(courseId, date, moves) {
  return updateSession(courseId, date, (s) => {
    for (const [sid, seat] of Object.entries(moves)) if (s.records[sid]) s.records[sid].seat = seat;
    return s;
  });
}

// 学生による出席登録
export async function checkIn(courseId, { seat, studentId, name, device }) {
  const id = normalizeId(studentId);
  const inputName = String(name ?? '').trim();
  const course = await getCourse(courseId);
  if (!course) throw new Error('授業が見つかりません');

  return updateSession(courseId, todayStr(), (s) => {
    if (!s.open) throw new Error('現在、出席の受付は停止中です');
    if (s.devices[device]) throw new Error('この端末からはすでに出席登録されています');
    if (!id) throw new Error('学籍番号を入力してください');
    if (s.records[id]) throw new Error('この学籍番号はすでに出席登録されています');
    if (course.disabled.includes(seat)) throw new Error('この席は使用できません');

    let recName;
    const assigned = course.seats[seat];
    if (assigned) {
      if (assigned !== id) throw new Error('学籍番号が一致しません。自分の名前の席か確認してください');
      recName = findStudent(course, id)?.name || '';
    } else {
      if (Object.values(s.records).some((r) => r.seat === seat)) throw new Error('この席はすでに使われています');
      const own = seatOf(course, id);
      if (own) throw new Error(`あなたの席は ${own} です。自分の名前の席を選んでください`);
      recName = findStudent(course, id)?.name || inputName;
      if (!recName) throw new Error('氏名を入力してください');
    }
    s.records[id] = { status: 'present', seat, name: recName, time: Date.now(), method: 'student' };
    s.devices[device] = id;
    return s;
  });
}

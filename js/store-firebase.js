// データ層（Firebase 版）。store-local.js と同じ関数をそろえてある。
//
// 保存の形（学籍番号は priv と checkins にしか置かない）
//   courses/{cid}                        授業の基本情報・座席の配置（だれでも読める／個人情報なし）
//   courses/{cid}/pub/seatmap            席→氏名（学生の画面に出す。学籍番号は含めない）
//   courses/{cid}/priv/roster            名簿（学籍番号を含む。担当教員だけ）
//   courses/{cid}/notes/{date}           授業メモ（担当教員だけ）
//   courses/{cid}/sessions/{date}        受付中かどうか
//   courses/{cid}/sessions/{date}/seats/{席}       誰が座ったか（氏名と時刻だけ）
//   courses/{cid}/sessions/{date}/checkins/{uid}   学生本人の登録（学籍番号を含む。担当教員だけが読める）
//   courses/{cid}/sessions/{date}/marks/{学籍番号}  教員が付けた出欠
import { firebaseConfig, allowedEmailDomain } from './firebase-config.js';
import { normalizeId, findStudent } from './attendance.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut as fbSignOut,
  GoogleAuthProvider,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const fbAuth = getAuth(app);
const db = getFirestore(app);

// ---------- 共通 ----------
const listeners = new Set();
const cache = new Map();
const subs = new Map();
const ready = new Map();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn());
}

export function newId() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 最初のデータが届くまで待てるようにしたうえで、変更を購読する
function watch(key, start) {
  if (!subs.has(key)) {
    let done;
    ready.set(key, new Promise((r) => (done = r)));
    subs.set(
      key,
      start((value) => {
        cache.set(key, value);
        done();
        notify();
      }),
    );
  }
  return ready.get(key);
}

const watchDoc = (key, ref) =>
  watch(key, (cb) =>
    onSnapshot(
      ref,
      (snap) => cb(snap.exists() ? snap.data() : null),
      () => cb(null), // 権限がない場合（学生の画面から名簿を見ようとした場合など）
    ),
  );

const watchCol = (key, ref) =>
  watch(key, (cb) =>
    onSnapshot(
      ref,
      // 送信中（サーバーの確認前）の書き込みは表示しない。
      // 出席登録が拒否されたのに、一瞬「登録できた」ように見えるのを防ぐため。
      (snap) => cb(snap.docs.filter((d) => !d.metadata.hasPendingWrites).map((d) => ({ id: d.id, ...d.data() }))),
      () => cb([]),
    ),
  );

// ---------- ログイン ----------
let user = null;
let readyResolve;
const authReady = new Promise((r) => (readyResolve = r));

onAuthStateChanged(fbAuth, async (u) => {
  if (!u) {
    // 学生はログインなしで使えるように、見えないところで匿名ログインする（端末の識別に使う）
    try {
      await signInAnonymously(fbAuth);
      return;
    } catch (e) {
      console.warn('匿名ログインに失敗しました', e);
    }
  }
  user = u;
  readyResolve();
  notify();
});

function emailAllowed(email) {
  if (!allowedEmailDomain) return true;
  return String(email || '').toLowerCase().endsWith('@' + allowedEmailDomain.toLowerCase());
}

export const auth = {
  ready: authReady,
  user: () =>
    user ? { uid: user.uid, name: user.displayName || '', email: user.email || '', anonymous: user.isAnonymous } : null,
  isTeacher: () => !!user && !user.isAnonymous && emailAllowed(user.email),
  emailAllowed: () => emailAllowed(user?.email),
  signIn: async () => {
    await signInWithPopup(fbAuth, new GoogleAuthProvider());
  },
  signOut: async () => {
    await fbSignOut(fbAuth);
  },
};

export function deviceId() {
  return user?.uid || 'unknown';
}

const uid = () => user?.uid || null;

// ---------- 参照 ----------
const courseRef = (cid) => doc(db, 'courses', cid);
const pubRef = (cid) => doc(db, 'courses', cid, 'pub', 'seatmap');
const privRef = (cid) => doc(db, 'courses', cid, 'priv', 'roster');
const sessRef = (cid, date) => doc(db, 'courses', cid, 'sessions', date);
const noteRef = (cid, date) => doc(db, 'courses', cid, 'notes', date);
const seatsCol = (cid, date) => collection(db, 'courses', cid, 'sessions', date, 'seats');
const checkinsCol = (cid, date) => collection(db, 'courses', cid, 'sessions', date, 'checkins');
const marksCol = (cid, date) => collection(db, 'courses', cid, 'sessions', date, 'marks');

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

// ---------- 授業 ----------
function buildCourse(cid) {
  const base = cache.get(`course:${cid}`);
  if (!base) return null;
  const course = { ...defaultCourse(), ...base, id: cid };
  const priv = cache.get(`priv:${cid}`);
  if (priv) {
    course.roster = priv.students || [];
    course.seats = priv.seats || {};
  } else {
    // 学生の画面：公開されている「席→氏名」だけで組み立てる（学籍番号は取得しない）
    const names = cache.get(`pub:${cid}`)?.names || {};
    course.roster = Object.entries(names).map(([seat, name]) => ({ id: `#${seat}`, name }));
    course.seats = Object.fromEntries(Object.keys(names).map((seat) => [seat, `#${seat}`]));
  }
  return course;
}

export async function getCourse(cid) {
  await authReady;
  await Promise.all([
    watchDoc(`course:${cid}`, courseRef(cid)),
    watchDoc(`pub:${cid}`, pubRef(cid)),
    watchDoc(`priv:${cid}`, privRef(cid)),
  ]);
  return buildCourse(cid);
}

export async function listCourses() {
  await authReady;
  if (!auth.isTeacher()) return [];
  const key = `courses:${uid()}`;
  await watch(key, (cb) =>
    onSnapshot(
      query(collection(db, 'courses'), where('ownerUid', '==', uid())),
      (snap) => cb(snap.docs.map((d) => ({ ...defaultCourse(), ...d.data(), id: d.id }))),
      () => cb([]),
    ),
  );
  return cache.get(key) || [];
}

export async function createCourse(data) {
  await authReady;
  if (!auth.isTeacher()) throw new Error('ログインが必要です');
  const cid = newId();
  const now = Date.now();
  const { roster, seats, ...rest } = { ...defaultCourse(), ...data };
  const batch = writeBatch(db);
  batch.set(courseRef(cid), { ...rest, ownerUid: uid(), createdAt: now, lastAccess: now });
  batch.set(privRef(cid), { students: [], seats: {}, ids: [], names: {} });
  batch.set(pubRef(cid), { names: {} });
  await batch.commit();
  notify();
  return cid;
}

export async function updateCourse(cid, patch) {
  const cur = await getCourse(cid);
  if (!cur) throw new Error('授業が見つかりません');
  const next = typeof patch === 'function' ? patch(structuredClone(cur)) : { ...cur, ...patch };
  const { roster = [], seats = {}, id, ...rest } = next;

  const batch = writeBatch(db);
  batch.set(courseRef(cid), {
    ...rest,
    ownerUid: cur.ownerUid,
    createdAt: cur.createdAt ?? Date.now(),
    lastAccess: Date.now(),
  });
  batch.set(privRef(cid), {
    students: roster,
    seats,
    ids: roster.map((s) => s.id),
    names: Object.fromEntries(roster.map((s) => [s.id, s.name])),
  });
  batch.set(pubRef(cid), {
    names: Object.fromEntries(
      Object.entries(seats).map(([seat, sid]) => [seat, findStudent({ roster }, sid)?.name || '']),
    ),
  });
  await batch.commit();
  notify();
  return next;
}

export async function touchCourse(cid) {
  if (!auth.isTeacher()) return;
  try {
    await updateDoc(courseRef(cid), { lastAccess: Date.now() });
  } catch {
    /* 自分の授業でない場合は何もしない */
  }
}

export async function deleteCourse(cid) {
  const sessions = await getDocs(collection(db, 'courses', cid, 'sessions'));
  for (const s of sessions.docs) {
    for (const col of [seatsCol(cid, s.id), checkinsCol(cid, s.id), marksCol(cid, s.id)]) {
      const snap = await getDocs(col);
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    }
    await deleteDoc(s.ref);
  }
  const notes = await getDocs(collection(db, 'courses', cid, 'notes'));
  await Promise.all(notes.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(privRef(cid));
  await deleteDoc(pubRef(cid));
  await deleteDoc(courseRef(cid));
  notify();
}

// ---------- 授業日（出欠） ----------
// 自分が登録した直後は、サーバーからの反映を待つ間だけ手元の記録で表示する
const justRegistered = new Map();

function buildSession(cid, date) {
  const open = cache.get(`sess:${cid}:${date}`)?.open;
  const session = {
    date,
    open: open !== false,
    memo: cache.get(`note:${cid}:${date}`)?.memo || '',
    records: {},
    devices: {},
  };

  const checkins = cache.get(`checkins:${cid}:${date}`);
  if (checkins && checkins.length) {
    // 教員の画面：学生本人の登録を学籍番号ごとにまとめる
    for (const c of checkins) {
      session.records[c.sid] = { status: 'present', seat: c.seat, name: c.name, time: c.at || null, method: 'student' };
      session.devices[c.id] = c.sid;
    }
  } else {
    // 学生の画面：公開されている「席→氏名・時刻」だけを使う
    for (const s of cache.get(`seats:${cid}:${date}`) || []) {
      session.records[`#${s.id}`] = { status: 'present', seat: s.id, name: s.name, time: s.at || null, method: 'student' };
      if (s.by && s.by === uid()) session.devices[s.by] = `#${s.id}`;
    }
    // 自分の登録（席の一覧を読み込まない大教室でも、自分の状態は分かるようにする）
    const own = cache.get(`mine:${cid}:${date}`);
    if (own && own.seat) {
      session.records[`#${own.seat}`] = { status: 'present', seat: own.seat, name: own.name || '', time: own.at || null, method: 'student' };
      session.devices[uid()] = `#${own.seat}`;
    }
  }

  const mine = justRegistered.get(`${cid}:${date}`);
  if (mine && !Object.values(session.records).some((r) => r.seat === mine.seat) && Date.now() - mine.at < 15000) {
    session.records[`#${mine.seat}`] = { status: 'present', seat: mine.seat, name: mine.name, time: mine.at, method: 'student' };
    session.devices[mine.uid] = `#${mine.seat}`;
  }

  for (const m of cache.get(`marks:${cid}:${date}`) || []) {
    const prev = session.records[m.id];
    session.records[m.id] = {
      status: m.status,
      seat: prev?.seat ?? m.seat ?? null,
      name: prev?.name || m.name || '',
      time: prev?.time ?? m.at ?? null,
      method: prev?.method ?? 'teacher',
    };
  }
  return session;
}

// 学生の画面で「誰が座っているか」を表示するのは、この席数までの授業に限る。
// 大人数の授業で全員が座席表を見張ると、Firebase の無料枠（1日5万回の読み取り）を
// 超えてしまうため、大教室では自分の登録だけを読み込む。
const SMALL_CLASS_SEATS = 60;

// 埋まっている席を1回だけ読み込む（変更の見張りはしない）
async function loadSeatsOnce(cid, date) {
  const key = `seats:${cid}:${date}`;
  if (subs.has(key)) return;
  subs.set(key, () => {});
  try {
    const snap = await getDocs(seatsCol(cid, date));
    cache.set(
      key,
      snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    );
  } catch {
    cache.set(key, []);
  }
}

export async function getSession(cid, date) {
  await authReady;
  const jobs = [watchDoc(`sess:${cid}:${date}`, sessRef(cid, date))];
  if (auth.isTeacher()) {
    jobs.push(
      watchCol(`seats:${cid}:${date}`, seatsCol(cid, date)),
      watchCol(`checkins:${cid}:${date}`, checkinsCol(cid, date)),
      watchCol(`marks:${cid}:${date}`, marksCol(cid, date)),
      watchDoc(`note:${cid}:${date}`, noteRef(cid, date)),
    );
  } else {
    // 学生の画面：自分の登録だけを見張る（読み取り1件）
    jobs.push(watchDoc(`mine:${cid}:${date}`, doc(checkinsCol(cid, date), uid() || 'anonymous')));
    const course = cache.get(`course:${cid}`);
    const seats = course ? (course.cols || 0) * (course.rows || 0) : 0;
    if (seats && seats <= SMALL_CLASS_SEATS) jobs.push(loadSeatsOnce(cid, date));
  }
  await Promise.all(jobs);
  return buildSession(cid, date);
}

export async function listSessions(cid) {
  const snap = await getDocs(collection(db, 'courses', cid, 'sessions'));
  const out = [];
  for (const s of snap.docs.sort((a, b) => a.id.localeCompare(b.id))) {
    const date = s.id;
    const [checkins, marks, note] = await Promise.all([
      getDocs(checkinsCol(cid, date)),
      getDocs(marksCol(cid, date)),
      getDoc(noteRef(cid, date)).catch(() => null),
    ]);
    cache.set(`sess:${cid}:${date}`, s.data());
    cache.set(
      `checkins:${cid}:${date}`,
      checkins.docs.map((d) => ({ id: d.id, ...d.data() })),
    );
    cache.set(
      `marks:${cid}:${date}`,
      marks.docs.map((d) => ({ id: d.id, ...d.data() })),
    );
    cache.set(`note:${cid}:${date}`, note && note.exists() ? note.data() : null);
    out.push(buildSession(cid, date));
  }
  return out;
}

export async function setOpen(cid, date, open) {
  await setDoc(sessRef(cid, date), { open }, { merge: true });
  notify();
}

export async function setMemo(cid, date, memo) {
  await setDoc(sessRef(cid, date), { open: true }, { merge: true });
  await setDoc(noteRef(cid, date), { memo }, { merge: true });
  notify();
}

export async function clearSession(cid, date) {
  for (const col of [seatsCol(cid, date), checkinsCol(cid, date), marksCol(cid, date)]) {
    const snap = await getDocs(col);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }
  notify();
}

export async function setStatus(cid, date, studentId, status, { seat = null, name = '' } = {}) {
  const session = buildSession(cid, date);
  const prev = session.records[studentId];
  if (!status) {
    await deleteDoc(doc(marksCol(cid, date), studentId)).catch(() => {});
    const mine = await getDocs(query(checkinsCol(cid, date), where('sid', '==', studentId)));
    await Promise.all(mine.docs.map((d) => deleteDoc(d.ref)));
    if (prev && prev.seat) await deleteDoc(doc(seatsCol(cid, date), prev.seat)).catch(() => {});
  } else {
    await setDoc(sessRef(cid, date), { open: session.open }, { merge: true });
    await setDoc(doc(marksCol(cid, date), studentId), {
      status,
      seat: prev?.seat ?? seat,
      name: prev?.name || name,
      at: prev?.time ?? (status === 'absent' ? null : Date.now()),
    });
  }
  notify();
}

export async function updateRecordSeats(cid, date, moves) {
  const session = buildSession(cid, date);
  const seats = cache.get(`seats:${cid}:${date}`) || [];
  const checkins = cache.get(`checkins:${cid}:${date}`) || [];
  const marks = cache.get(`marks:${cid}:${date}`) || [];
  const batch = writeBatch(db);
  for (const [sid, seat] of Object.entries(moves)) {
    const rec = session.records[sid];
    if (!rec || rec.seat === seat) continue;
    const old = seats.find((s) => s.id === rec.seat);
    if (old) {
      batch.delete(doc(seatsCol(cid, date), old.id));
      batch.set(doc(seatsCol(cid, date), seat), { name: old.name, at: old.at || null, by: old.by || '' });
    }
    const checkin = checkins.find((c) => c.sid === sid);
    if (checkin) batch.update(doc(checkinsCol(cid, date), checkin.id), { seat });
    if (marks.some((m) => m.id === sid)) batch.update(doc(marksCol(cid, date), sid), { seat });
  }
  await batch.commit();
  notify();
}

// ---------- 学生による出席登録 ----------
export async function checkIn(cid, { seat, studentId, name }) {
  await authReady;
  if (!user) throw new Error('接続できませんでした。通信状態を確認してください');
  const id = normalizeId(studentId);
  if (!id) throw new Error('学籍番号を入力してください');

  const date = todayStr();
  const course = await getCourse(cid);
  const session = await getSession(cid, date);
  if (!course) throw new Error('授業が見つかりません');
  if (!session.open) throw new Error('現在、出席の受付は停止中です');
  if (course.disabled.includes(seat)) throw new Error('この席は使用できません');
  if (session.devices[user.uid]) throw new Error('この端末からはすでに出席登録されています');
  if ((cache.get(`seats:${cid}:${date}`) || []).some((s) => s.id === seat)) throw new Error('この席はすでに使われています');

  const assignedName = (cache.get(`pub:${cid}`)?.names || {})[seat];
  const typedName = String(name ?? '').trim();
  if (!assignedName && !course.freeSeating && !typedName) throw new Error('氏名を入力してください');

  const write = async (recName) => {
    const at = Date.now();
    const batch = writeBatch(db);
    batch.set(doc(checkinsCol(cid, date), user.uid), {
      sid: id,
      seat,
      name: recName,
      at,
      status: 'present',
      method: 'student',
    });
    batch.set(doc(seatsCol(cid, date), seat), { name: recName, at, by: user.uid });
    await batch.commit();
    // 登録できた場合だけ覚えておく（サーバーからの反映が届くまでの表示に使う）
    justRegistered.set(`${cid}:${date}`, { seat, name: recName, at, uid: user.uid });
  };
  const denied = (e) => String(e && e.code).includes('permission-denied');

  try {
    // 自由席のときは、まず名簿の学生として登録する（氏名は教員の画面だけに出すので空にする）
    await write(assignedName || (course.freeSeating ? '' : typedName));
  } catch (e) {
    if (!denied(e)) throw new Error('登録できませんでした。通信状態を確認してください');
    // 自由席で名簿にない学生の場合は、入力された氏名で登録し直す
    if (course.freeSeating && typedName) {
      try {
        await write(typedName);
        notify();
        return;
      } catch {
        /* 下のメッセージを出す */
      }
    }
    // 席がすでに使われていることが原因かどうかを確かめる
    // （大教室では席の一覧を読み込んでいないため、ここで1件だけ読む）
    let taken = false;
    try {
      taken = (await getDoc(doc(seatsCol(cid, date), seat))).exists();
    } catch {
      /* 確認できなければ下のメッセージを出す */
    }
    if (taken) throw new Error('この席はすでに使われています。別の席を選んでください');
    throw new Error(
      assignedName
        ? '学籍番号が一致しません。自分の名前の席か確認してください'
        : course.freeSeating
          ? '学籍番号が名簿にありません。番号を確認してください（履修登録前の方は、氏名も入力してください）'
          : 'この学籍番号では登録できません。名簿にある場合は、自分の名前の席を選んでください',
    );
  }
  notify();
}

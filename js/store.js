// 保存先の切り替え。
// js/firebase-config.js に設定値があれば Firebase、なければこの端末の localStorage を使う。
import { useFirebase } from './firebase-config.js';

// 動作確認用：URL に ?local=1 を付けると、Firebase を使わず、この端末の中だけで動く。
// 本番のデータには一切触れないので、新しい機能の練習や確認に使える。
const forceLocal = new URLSearchParams(location.search).has('local');
const impl = useFirebase && !forceLocal ? await import('./store-firebase.js') : await import('./store-local.js');

export const {
  subscribe,
  newId,
  todayStr,
  deviceId,
  auth,
  listCourses,
  getCourse,
  createCourse,
  updateCourse,
  touchCourse,
  deleteCourse,
  getSession,
  listSessions,
  setOpen,
  setMemo,
  clearSession,
  setStatus,
  updateRecordSeats,
  renameRecord,
  checkIn,
} = impl;

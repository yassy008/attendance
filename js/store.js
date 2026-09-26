// 保存先の切り替え。
// js/firebase-config.js に設定値があれば Firebase、なければこの端末の localStorage を使う。
import { useFirebase } from './firebase-config.js';

const impl = useFirebase ? await import('./store-firebase.js') : await import('./store-local.js');

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
  checkIn,
} = impl;

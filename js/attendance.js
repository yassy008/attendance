// 出席に関するルール（試作版ではブラウザ内で判定。Firebase 版ではセキュリティルール側でも同じ判定を行う）

export const STATUS_LABEL = { present: '出席', late: '遅刻', absent: '欠席' };
export const STATUS_MARK = { present: '○', late: '遅', absent: '欠' };
export const METHOD_LABEL = { student: '学生登録', teacher: '教員入力' };

export const seatKey = (r, c) => `${r}-${c}`;

// 全角英数字 → 半角、前後の空白除去、英字は大文字に
export function normalizeId(s) {
  return String(s ?? '').normalize('NFKC').replace(/\s/g, '').toUpperCase();
}

export function findStudent(course, id) {
  return course.roster.find((s) => s.id === id) || null;
}

export function seatOf(course, studentId) {
  return Object.keys(course.seats).find((k) => course.seats[k] === studentId) || null;
}

// 座席1つ分の表示用情報
export function seatInfo(course, session, key) {
  const disabled = course.disabled.includes(key);
  let studentId = course.seats[key] || null;
  let record = studentId ? session.records[studentId] || null : null;
  if (!studentId) {
    const hit = Object.entries(session.records).find(([, r]) => r.seat === key);
    if (hit) [studentId, record] = hit;
  }
  const student = studentId ? findStudent(course, studentId) || { id: studentId, name: record?.name || '' } : null;
  return {
    key,
    disabled,
    assigned: !!course.seats[key],
    student,
    record,
    status: record?.status || null,
    group: course.groups[key] || null,
  };
}

// 出席簿の行：名簿の学生＋名簿外で登録した学生
export function bookStudents(course, sessions) {
  const map = new Map(course.roster.map((s) => [s.id, { ...s }]));
  for (const ses of sessions) {
    for (const [id, r] of Object.entries(ses.records)) {
      if (!map.has(id)) map.set(id, { id, name: r.name, outside: true });
    }
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id, 'ja', { numeric: true }));
}

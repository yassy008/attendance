// 出席簿：学生 × 授業日の一覧
import * as store from './store.js';
import { bookStudents, seatOf, STATUS_LABEL, STATUS_MARK, METHOD_LABEL } from './attendance.js';
import { ensureTeacher, authBar } from './login.js';
import { $, esc, param, fmtDateShort, fmtTime, slotLabel, asText, csvText, downloadText } from './util.js';

const courseId = param('id');
const CYCLE = [null, 'present', 'late', 'absent', 'excused'];
let course;
let sessions = [];
let students = [];

async function refresh() {
  course = await store.getCourse(courseId);
  if (!course) {
    $('main').innerHTML = '<p class="empty-msg">授業が見つかりません</p>';
    return;
  }
  sessions = await store.listSessions(courseId);
  students = bookStudents(course, sessions);
  document.title = `出席簿 - ${course.title}`;
  $('#title').textContent = `出席簿：${course.title}`;
  $('#sub').textContent = `${course.year}年度 ${course.term} ${slotLabel(course)}限 ／ 授業 ${sessions.length}回 ／ ${students.length}名`;
  $('#back').href = `room.html?id=${courseId}&mode=teacher`;
  render();
}

function totals(st) {
  let present = 0;
  let late = 0;
  let excused = 0;
  let absent = 0;
  for (const s of sessions) {
    const status = s.records[st.id]?.status;
    if (status === 'present') present++;
    else if (status === 'late') late++;
    else if (status === 'excused') excused++;
    else absent++;
  }
  // 出席扱い（公欠）は出席率に含める
  const rate = sessions.length ? Math.round(((present + late + excused) / sessions.length) * 100) : 0;
  return { present, late, excused, absent, rate };
}

function render() {
  if (!sessions.length) {
    $('#book').innerHTML = '<p class="empty-msg">まだ出席記録がありません</p>';
    return;
  }
  const head = `<tr><th>学籍番号</th><th>氏名</th>${sessions
    .map((s, i) => `<th title="${esc(s.memo)}" style="text-align:center">${fmtDateShort(s.date)}${s.memo ? ' 📝' : ''}<br><span class="muted" style="font-weight:400">第${i + 1}回</span></th>`)
    .join('')}<th>出席</th><th>遅刻</th><th>出席扱い</th><th>欠席</th><th>出席率</th></tr>`;

  const body = students
    .map((st) => {
      const cells = sessions
        .map((s) => {
          const r = s.records[st.id];
          const tip = r ? `${STATUS_LABEL[r.status]}${r.time ? ` ${fmtTime(r.time)}` : ''}${r.seat ? ` 座席${r.seat}` : ''}` : '未登録';
          return `<td class="cell${r ? ` m-${r.status}` : ''}" data-id="${esc(st.id)}" data-date="${s.date}" title="${esc(tip)}">${r ? STATUS_MARK[r.status] : ''}</td>`;
        })
        .join('');
      const t = totals(st);
      return `<tr><td>${esc(st.id)}</td><td>${esc(st.name)}${st.outside ? ' <span class="muted">（名簿外）</span>' : ''}</td>${cells}<td>${t.present}</td><td>${t.late}</td><td>${t.excused}</td><td>${t.absent}</td><td>${t.rate}%</td></tr>`;
    })
    .join('');
  $('#book').innerHTML = `<table class="list book">${head}${body}</table>`;
}

$('#book').addEventListener('click', async (e) => {
  const td = e.target.closest('td.cell');
  if (!td) return;
  const s = sessions.find((x) => x.date === td.dataset.date);
  const st = students.find((x) => x.id === td.dataset.id);
  const cur = s.records[st.id]?.status || null;
  const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
  await store.setStatus(courseId, s.date, st.id, next, { seat: seatOf(course, st.id), name: st.name });
});

$('#csv-table').addEventListener('click', () => {
  const header = ['学籍番号', '氏名', ...sessions.map((s) => s.date), '出席', '遅刻', '出席扱い', '欠席', '出席率'];
  const rows = students.map((st) => {
    const t = totals(st);
    return [asText(st.id), st.name, ...sessions.map((s) => STATUS_LABEL[s.records[st.id]?.status] || ''), t.present, t.late, t.excused, t.absent, `${t.rate}%`];
  });
  downloadText(`出席簿_${course.title}.csv`, csvText([header, ...rows]));
});

$('#csv-records').addEventListener('click', () => {
  const header = ['日付', '授業名', '曜日時限', '学籍番号', '氏名', '座席', '出欠', '登録時刻', '登録方法'];
  const rows = sessions.flatMap((s) =>
    students.map((st) => {
      const r = s.records[st.id];
      return [
        s.date,
        course.title,
        `${slotLabel(course)}限`,
        asText(st.id),
        st.name,
        asText(r?.seat || ''),
        r ? STATUS_LABEL[r.status] : '未登録',
        fmtTime(r?.time),
        r ? METHOD_LABEL[r.method] : '',
      ];
    }),
  );
  downloadText(`出席記録_${course.title}.csv`, csvText([header, ...rows]));
});

authBar($('#authbar'));
if (await ensureTeacher(document.querySelector('main'), '出席簿を見るには、教員用のログインが必要です。')) {
  store.subscribe(refresh);
  refresh();
}

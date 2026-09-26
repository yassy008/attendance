// 授業ページ（学生モード／教員モードの切り替えと、データ変更時の再描画）
import * as store from './store.js';
import { $, $$, esc, param, fmtDateJa, dialog, toast } from './util.js';
import * as student from './student.js';
import * as teacher from './teacher.js';
import { ensureTeacher, authBar } from './login.js';

const courseId = param('id');
const state = {
  courseId,
  course: null,
  session: null,
  mode: param('mode') === 'teacher' ? 'teacher' : 'student',
  date: store.todayStr(),
  refresh,
};

function currentDate() {
  return state.mode === 'teacher' ? state.date : store.todayStr();
}

async function refresh() {
  state.course = await store.getCourse(courseId);
  if (!state.course) {
    document.querySelector('main').innerHTML = '<p class="empty-msg">授業が見つかりません。URLを確認してください。</p>';
    return;
  }
  state.session = await store.getSession(courseId, currentDate());
  renderHeader();
  if (state.mode === 'teacher') {
    if (!(await ensureTeacher($('#teacher-area')))) {
      $('#seatmap').innerHTML = '';
      return;
    }
    teacher.init(state);
    teacher.render(state);
  } else {
    student.init(state);
    student.render(state);
  }
}

function renderHeader() {
  const c = state.course;
  document.title = `${c.title} - 出席確認`;
  $('#title').textContent = c.title;
  $('#rename').hidden = state.mode !== 'teacher';
  $$('.mode-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
  $('#student-area').hidden = state.mode !== 'student';
  $('#teacher-area').hidden = state.mode !== 'teacher';
  $('#info').textContent = `${c.title}${c.roomName ? `（${c.roomName}）` : ''} | ${fmtDateJa(currentDate())}`;
  const n = Object.values(state.session.records).filter((r) => r.status === 'present' || r.status === 'late').length;
  $('#count').textContent = `出席人数: ${n}人`;
}

$('.mode-tabs').addEventListener('click', (e) => {
  const mode = e.target.closest('[data-mode]')?.dataset.mode;
  if (!mode || mode === state.mode) return;
  state.mode = mode;
  const url = new URL(location.href);
  if (mode === 'teacher') url.searchParams.set('mode', 'teacher');
  else url.searchParams.delete('mode');
  history.replaceState(null, '', url);
  refresh();
});

$('#rename').addEventListener('click', async () => {
  const res = await dialog({
    title: '名前を変更',
    body: `<div class="field"><label>授業名</label><input type="text" name="title" value="${esc(state.course.title)}" required></div>
           <div class="field"><label>教室名（任意）</label><input type="text" name="roomName" value="${esc(state.course.roomName)}"></div>`,
    okText: '変更する',
  });
  if (!res || !res.title.trim()) return;
  await store.updateCourse(courseId, { title: res.title.trim(), roomName: res.roomName.trim() });
  toast('変更しました');
});

authBar($('#authbar'));
store.subscribe(refresh);
if (state.mode === 'teacher') store.touchCourse(courseId);
refresh();

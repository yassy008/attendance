import * as store from './store.js';
import { renderSeatmap } from './seatmap.js';
import { ensureTeacher, authBar } from './login.js';
import { $, $$, esc, DAYS, slotLabel, dialog, toast } from './util.js';

const form = $('#create-form');
const SORT_KEY = 'att.ui.sort';
let sortBy = localStorage.getItem(SORT_KEY) || 'slot';

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function fillSelect(sel, items, value) {
  sel.innerHTML = items
    .map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
}

function initForm() {
  const now = new Date();
  const el = form.elements;
  el.year.value = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  fillSelect(el.term, ['前期', '後期', '通年', '集中'].map((t) => [t, t]), now.getMonth() >= 3 && now.getMonth() < 8 ? '前期' : '後期');
  fillSelect(el.day, [1, 2, 3, 4, 5, 6, 0].map((d) => [d, `${DAYS[d]}曜日`]), 1);
  fillSelect(el.period, range(1, 7).map((p) => [p, `${p}限`]), 1);
  fillSelect(el.cols, range(1, 20).map((n) => [n, `${n}列`]), 6);
  fillSelect(el.rows, range(1, 20).map((n) => [n, `${n}行`]), 5);

  form.addEventListener('change', drawPreview);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = el.title.value.trim();
    if (!title) return toast('授業名を入力してください', 'error');
    try {
      const id = await store.createCourse({
        title,
        roomName: el.roomName.value.trim(),
        year: Number(el.year.value),
        term: el.term.value,
        day: Number(el.day.value),
        period: Number(el.period.value),
        cols: Number(el.cols.value),
        rows: Number(el.rows.value),
      });
      location.href = `room.html?id=${id}&mode=teacher`;
    } catch (err) {
      const msg = String(err?.message || err);
      toast(
        msg.includes('insufficient permissions') || msg.includes('permission')
          ? '作成できませんでした。Firebaseの「ルール」が公開されているか確認してください'
          : `作成できませんでした：${msg}`,
        'error',
      );
    }
  });
  drawPreview();
}

function drawPreview() {
  const cols = Number(form.elements.cols.value);
  const rows = Number(form.elements.rows.value);
  const course = { cols, rows, roster: [], seats: {}, disabled: [], colGaps: [], rowGaps: [], groups: {} };
  const el = $('#preview');
  el.style.maxWidth = `${cols * 64}px`;
  renderSeatmap(el, course, { records: {} }, { view: 'student' });
}

async function renderList() {
  const all = await store.listCourses();

  const sel = $('#filter-term');
  const current = sel.value || 'all';
  const terms = [...new Set(all.map((c) => `${c.year}|${c.term}`))].sort().reverse();
  fillSelect(sel, [['all', 'すべての年度・学期'], ...terms.map((t) => [t, t.replace('|', '年度 ')])], terms.includes(current) ? current : 'all');

  const list = sel.value === 'all' ? all : all.filter((c) => `${c.year}|${c.term}` === sel.value);
  const dayOrder = (d) => (d === 0 ? 7 : d);
  const sorters = {
    slot: (a, b) => dayOrder(a.day) - dayOrder(b.day) || a.period - b.period || a.title.localeCompare(b.title, 'ja'),
    access: (a, b) => b.lastAccess - a.lastAccess,
    created: (a, b) => b.createdAt - a.createdAt,
  };
  list.sort(sorters[sortBy]);
  $$('.sort-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.sort === sortBy));

  const fmt = (ms) => (ms ? new Date(ms).toLocaleDateString('ja-JP') : '—');
  $('#course-list').innerHTML = list.length
    ? list
        .map(
          (c) => `
      <article class="course-card">
        <div class="top">
          <div class="slot">${slotLabel(c)}</div>
          <div>
            <div class="title">${esc(c.title)}</div>
            <div class="meta">${c.year}年度 ${esc(c.term)}${c.roomName ? ` ・ ${esc(c.roomName)}` : ''}</div>
            <div class="meta">名簿 ${c.rosterCount ?? c.roster?.length ?? 0}名 ・ 最終アクセス ${fmt(c.lastAccess)}</div>
          </div>
        </div>
        <div class="actions">
          <a class="btn btn-sm" href="room.html?id=${c.id}&mode=teacher">教員モード</a>
          <a class="btn btn-outline btn-sm" href="room.html?id=${c.id}" target="_blank">学生画面</a>
          <a class="btn btn-outline btn-sm" href="book.html?id=${c.id}">出席簿</a>
          <button type="button" class="btn btn-red btn-sm" data-del="${c.id}" style="margin-left: auto">削除</button>
        </div>
      </article>`,
        )
        .join('')
    : `<p class="empty-msg" style="grid-column: 1 / -1">まだ授業がありません。「＋ 新しい授業を作成」から作成してください。</p>`;
  if (!all.length) $('#create-panel').hidden = false;
}

function start() {
  $('#course-list').addEventListener('click', async (e) => {
    const id = e.target.closest('[data-del]')?.dataset.del;
    if (!id) return;
    const course = await store.getCourse(id);
    const res = await dialog({
      title: '授業の削除',
      body: `<p>「${esc(course.title)}」を削除します。<b>出席記録もすべて削除され、元に戻せません。</b></p>
             <div class="field"><label>確認のため、授業名を入力してください</label><input type="text" name="confirm" autocomplete="off"></div>`,
      okText: '削除する',
      danger: true,
    });
    if (!res) return;
    if (res.confirm.trim() !== course.title) return toast('授業名が一致しないため、削除しませんでした', 'error');
    await store.deleteCourse(id);
    toast('削除しました');
    renderList();
  });

  $('.sort-tabs').addEventListener('click', (e) => {
    const key = e.target.closest('[data-sort]')?.dataset.sort;
    if (!key) return;
    sortBy = key;
    localStorage.setItem(SORT_KEY, key);
    renderList();
  });

  $('#open-create').addEventListener('click', () => {
    const panel = $('#create-panel');
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.elements.title.focus({ preventScroll: true });
  });

  $('#filter-term').addEventListener('change', renderList);
  store.subscribe(renderList);

  initForm();
  renderList();
}

authBar($('#authbar'));
if (await ensureTeacher(document.querySelector('main'), '授業の一覧と作成には、教員用のログインが必要です。')) start();

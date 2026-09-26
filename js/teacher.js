// 教員モード：タブ式のツールバー（出欠／座席／グループ／名簿／授業設定）と座席表の操作
import * as store from './store.js';
import { seatInfo, seatOf, findStudent, bookStudents, STATUS_LABEL, METHOD_LABEL } from './attendance.js';
import { renderSeatmap } from './seatmap.js';
import { assignEmpty, cleanup, reshuffle, swapSeats, autoGroups, stepGroup, groupSummary } from './layout.js';
import { readRosterFile, chooseColumns, rowsToStudents, parsePaste, mergeRoster } from './roster.js';
import { studentUrl } from './student.js';
import { $, $$, esc, fmtTime, DAYS, slotLabel, dialog, toast, csvText, downloadText } from './util.js';

let S = null; // room.js の state（同じオブジェクトを使い続ける）
let tab = 'attend';
let tool = null;
let gmode = 'size';

const TOOL_HINT = {
  disabled: '席をクリックすると「使わない席」に切り替わります。',
  group: '左クリック＝次のグループへ／右クリック＝前のグループへ／Shift＋右クリック＝グループから外す',
  aisle: '座席の間の帯をクリックすると、通路（広い間隔）に切り替わります。',
  drag: '学生の席をドラッグして別の席に重ねると入れ替わります（空席へは移動）。',
  absent: '席をクリックすると欠席になります。もう一度クリックすると元に戻ります。',
  late: '席をクリックすると遅刻になります。もう一度クリックすると出席に戻ります。',
};

const options = (items) => items.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

export function init(state) {
  if (S) return;
  S = state;
  $('#teacher-area').innerHTML = `
  <div class="toolbar">
    <nav class="tabs">
      <button type="button" data-tab="attend">出欠</button>
      <button type="button" data-tab="seats">座席</button>
      <button type="button" data-tab="groups">グループ</button>
      <button type="button" data-tab="roster">名簿</button>
      <button type="button" data-tab="settings">授業設定</button>
    </nav>

    <div class="tab-panel" data-panel="attend">
      <div class="tool-group">
        <span class="tool-group-title">出欠の記録</span>
        <input type="date" id="date" style="width:auto">
        <button type="button" class="btn btn-outline btn-sm" id="today">今日</button>
        <button type="button" class="btn btn-toggle" id="open-toggle"></button>
        <button type="button" class="btn btn-toggle t-red" data-tool="absent" data-label="欠席を付ける"></button>
        <button type="button" class="btn btn-toggle t-orange" data-tool="late" data-label="遅刻を付ける"></button>
        <button type="button" class="btn btn-outline" id="not-yet"></button>
        <button type="button" class="btn btn-outline" id="memo">授業メモ</button>
      </div>
      <div class="tool-group">
        <span class="tool-group-title">表示・出力</span>
        <button type="button" class="btn btn-dark" id="display">プロジェクター表示（別ウィンドウ）</button>
        <a class="btn btn-dark" id="book-link">出席簿を開く</a>
        <button type="button" class="btn btn-green" id="export">この日のCSVを保存</button>
      </div>
    </div>

    <div class="tab-panel" data-panel="seats" hidden>
      <div class="tool-group">
        <span class="tool-group-title">座席の編集</span>
        <button type="button" class="btn btn-toggle t-gray" data-tool="disabled" data-label="使わない席を設定"></button>
        <button type="button" class="btn btn-toggle" data-tool="aisle" data-label="通路を設定"></button>
        <button type="button" class="btn btn-toggle t-orange" data-tool="drag" data-label="ドラッグで入れ替え"></button>
        <button type="button" class="btn btn-outline" id="flip">前後を反転（教卓側から見る）</button>
      </div>
      <div class="tool-group">
        <span class="tool-group-title">割り当て</span>
        <button type="button" class="btn btn-toggle" id="free-seating"></button>
        <button type="button" class="btn" id="shuffle">席をシャッフル</button>
        <button type="button" class="btn btn-red" id="clear-all">クリア…</button>
      </div>
      <div class="tool-group">
        <span class="tool-group-title">座席数</span>
        <label>列数（横）</label><input type="number" id="cols" min="1" max="20" style="width:80px">
        <label>行数（縦）</label><input type="number" id="rows" min="1" max="20" style="width:80px">
        <button type="button" class="btn" id="resize">変更</button>
      </div>
    </div>

    <div class="tab-panel" data-panel="groups" hidden>
      <div class="tool-group">
        <span class="tool-group-title">自動で分ける</span>
        <div class="segmented" id="gmode">
          <button type="button" data-gmode="size" class="active">1グループの人数で指定</button>
          <button type="button" data-gmode="count">グループ数で指定</button>
        </div>
        <input type="number" id="gvalue" value="4" min="1" style="width:80px"><span id="gvalue-unit">人ずつ</span>
        <button type="button" class="btn" id="auto-group">グループに分ける</button>
      </div>
      <div class="tool-group">
        <span class="tool-group-title">手動で調整</span>
        <button type="button" class="btn btn-toggle" data-tool="group" data-label="グループを手動で編集"></button>
        <button type="button" class="btn btn-red" id="clear-group">グループ分けを解除</button>
      </div>
    </div>

    <div class="tab-panel" data-panel="roster" hidden>
      <div class="tool-group">
        <span class="tool-group-title">ファイルから読み込む（xlsx / xls / csv）</span>
        <input type="file" id="roster-file" accept=".xlsx,.xls,.csv">
      </div>
      <div class="tool-group" style="align-items:flex-end">
        <span class="tool-group-title">貼り付けて読み込む（1行に「学籍番号 氏名」。Excelからのコピーも可。空行は無視）</span>
        <textarea id="roster-paste" rows="4" style="width:min(460px,100%)" placeholder="20260001　山田 太郎"></textarea>
        <button type="button" class="btn" id="paste-assign">読み込んで空席に配置</button>
      </div>
      <div class="tool-group">
        <span class="tool-group-title">現在の名簿</span>
        <span id="roster-count"></span>
        <button type="button" class="btn btn-outline btn-sm" id="roster-show">一覧・削除</button>
      </div>
    </div>

    <div class="tab-panel" data-panel="settings" hidden>
      <div class="tool-group">
        <span class="tool-group-title">学生用URL（QRコードと同じ）</span>
        <input type="text" id="url" readonly style="width:min(460px,100%)">
        <button type="button" class="btn" id="copy-url">コピー</button>
      </div>
      <div class="tool-group">
        <span class="tool-group-title">時間割</span>
        <input type="number" id="year" style="width:100px"><label>年度</label>
        <select id="term">${options(['前期', '後期', '通年', '集中'].map((t) => [t, t]))}</select>
        <select id="day">${options([1, 2, 3, 4, 5, 6, 0].map((d) => [d, `${DAYS[d]}曜日`]))}</select>
        <select id="period">${options([1, 2, 3, 4, 5, 6, 7].map((p) => [p, `${p}限`]))}</select>
        <button type="button" class="btn" id="save-slot">保存</button>
      </div>
    </div>

    <p class="tool-hint" id="tool-hint"></p>
  </div>`;
  bind();
}

function sync(sel, value) {
  const el = $(sel);
  if (document.activeElement !== el) el.value = value;
}

export function render(state) {
  const { course, session } = state;
  sync('#url', studentUrl(state.courseId));
  sync('#year', course.year);
  sync('#term', course.term);
  sync('#day', course.day);
  sync('#period', course.period);
  sync('#cols', course.cols);
  sync('#rows', course.rows);
  sync('#date', state.date);
  $('#roster-count').textContent = `${course.roster.length}名（座席の割り当て ${Object.keys(course.seats).length}名）`;

  const open = $('#open-toggle');
  open.textContent = session.open ? '出席を受付中' : '受付を停止中';
  open.classList.toggle('on', session.open);

  const free = !!course.freeSeating;
  const fs = $('#free-seating');
  fs.textContent = `座席指定なし（自由席）：${free ? 'ON' : 'OFF'}`;
  fs.classList.toggle('on', free);
  $('#shuffle').disabled = free;
  $('#not-yet').textContent = `未登録の学生（${course.roster.filter((s) => !session.records[s.id]).length}名）`;

  $$('.tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab));
  $$('[data-tool]').forEach((b) => {
    b.classList.toggle('on', tool === b.dataset.tool);
    b.textContent = b.dataset.label;
  });
  $('#tool-hint').textContent = TOOL_HINT[tool] || '席をクリックすると、その学生の出欠を個別に変更したり、空席に学生を割り当てたりできます。';
  $('#book-link').href = `book.html?id=${state.courseId}`;

  renderSeatmap($('#seatmap'), course, session, {
    view: 'teacher',
    flipped: course.flipped,
    aisleEdit: tool === 'aisle',
    draggable: tool === 'drag',
    onSeatClick,
    onSeatContext: tool === 'group' ? onSeatContext : null,
    onGapToggle,
    onSwap,
  });
}

const updateCourse = (fn) => store.updateCourse(S.courseId, (c) => (fn(c), c));

// ---------- 座席のクリック ----------
async function onSeatClick(key, e) {
  const info = seatInfo(S.course, S.session, key);
  const name = info.student?.name || '';
  switch (tool) {
    case 'disabled': {
      let unseated = 0;
      const displaced = S.course.seats[key];
      await updateCourse((c) => {
        const i = c.disabled.indexOf(key);
        if (i >= 0) c.disabled.splice(i, 1);
        else c.disabled.push(key);
        unseated = c.freeSeating ? (cleanup(c), 0) : assignEmpty(c);
      });
      if (displaced) toast(`${name} さんを別の空席に移動しました${unseated ? `（${unseated}名は席が足りません）` : ''}`);
      return;
    }
    case 'group':
      return updateCourse((c) => stepGroup(c.groups, key, +1));
    case 'absent':
      if (!info.student || info.disabled) return;
      if (info.status === 'absent') return store.setStatus(S.courseId, S.date, info.student.id, info.record.time ? 'present' : null);
      return store.setStatus(S.courseId, S.date, info.student.id, 'absent', { seat: key, name });
    case 'late':
      if (!info.student || info.disabled) return;
      return store.setStatus(S.courseId, S.date, info.student.id, info.status === 'late' ? 'present' : 'late', { seat: key, name });
    case 'aisle':
    case 'drag':
      return;
    default:
      return seatDialog(info);
  }
}

function onSeatContext(key, e) {
  updateCourse((c) => stepGroup(c.groups, key, e.shiftKey ? 0 : -1));
}

function onGapToggle(type, n) {
  updateCourse((c) => {
    const list = type === 'col' ? c.colGaps : c.rowGaps;
    const i = list.indexOf(n);
    if (i >= 0) list.splice(i, 1);
    else list.push(n);
  });
}

async function onSwap(a, b) {
  if (S.course.disabled.includes(a) || S.course.disabled.includes(b)) return;
  await updateCourse((c) => swapSeats(c, a, b));
  const moves = {};
  for (const [sid, r] of Object.entries(S.session.records)) {
    if (r.seat === a) moves[sid] = b;
    else if (r.seat === b) moves[sid] = a;
  }
  if (Object.keys(moves).length) await store.updateRecordSeats(S.courseId, S.date, moves);
}

async function seatDialog(info) {
  const { course, courseId, date } = S;
  if (info.disabled) return toast('使わない席に設定されています。「座席」タブで元に戻せます');

  if (info.student) {
    const cur = info.status || 'none';
    const radios = [['present', '出席'], ['late', '遅刻'], ['absent', '欠席'], ['none', '未登録']]
      .map(([v, l]) => `<label style="margin-right:14px"><input type="radio" name="status" value="${v}"${v === cur ? ' checked' : ''}> ${l}</label>`)
      .join('');
    const rec = info.record;
    const res = await dialog({
      title: `${info.key}　${info.student.name}`,
      body: `<p style="margin-top:0">学籍番号：${esc(info.student.id)}<br>${rec?.time ? `登録時刻：${fmtTime(rec.time)}（${METHOD_LABEL[rec.method]}）` : '登録時刻：なし'}</p>
             <div class="field">${radios}</div>
             ${info.assigned ? '<label><input type="checkbox" name="unassign"> この席の割り当てを外す</label>' : ''}`,
      okText: '保存',
    });
    if (!res) return;
    const status = res.status === 'none' ? null : res.status;
    if (status !== info.status) await store.setStatus(courseId, date, info.student.id, status, { seat: info.key, name: info.student.name });
    if (res.unassign === 'on') await updateCourse((c) => delete c.seats[info.key]);
    return;
  }

  if (!course.roster.length) return toast('名簿がありません。「名簿」タブで読み込むと、席を割り当てられます');

  // 自由席のときは、席の割り当てではなく「その席に座っている学生を出席にする」
  if (course.freeSeating) {
    const yet = course.roster
      .filter((s) => !S.session.records[s.id])
      .sort((a, b) => a.id.localeCompare(b.id, 'ja', { numeric: true }));
    if (!yet.length) return toast('名簿の全員が登録済みです');
    const res = await dialog({
      title: `座席 ${info.key} の学生を出席にする`,
      body: `<p class="muted" style="margin-top:0">スマートフォンを忘れた学生などを、先生が代わりに登録できます。</p>
             <div class="field"><select name="sid">${yet
               .map((s) => `<option value="${esc(s.id)}">${esc(s.id)} ${esc(s.name)}</option>`)
               .join('')}</select></div>`,
      okText: '出席にする',
    });
    if (!res) return;
    await store.setStatus(courseId, date, res.sid, 'present', { seat: info.key, name: findStudent(course, res.sid)?.name || '' });
    return;
  }

  const seated = new Set(Object.values(course.seats));
  const list = [...course.roster].sort((a, b) => seated.has(a.id) - seated.has(b.id) || a.id.localeCompare(b.id, 'ja', { numeric: true }));
  const res = await dialog({
    title: `座席 ${info.key} に学生を割り当て`,
    body: `<div class="field"><select name="sid">${list
      .map((s) => `<option value="${esc(s.id)}">${esc(s.id)} ${esc(s.name)}${seated.has(s.id) ? `（現在 ${seatOf(course, s.id)}）` : '（席なし）'}</option>`)
      .join('')}</select></div>`,
    okText: '割り当てる',
  });
  if (!res) return;
  await updateCourse((c) => {
    const old = seatOf(c, res.sid);
    if (old) delete c.seats[old];
    c.seats[info.key] = res.sid;
  });
  if (S.session.records[res.sid]) await store.updateRecordSeats(S.courseId, S.date, { [res.sid]: info.key });
}

// ---------- ボタン類 ----------
function bind() {
  const on = (sel, fn) => $(sel).addEventListener('click', fn);

  $$('.tabs [data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tab;
      tool = null;
      render(S);
    }),
  );

  $$('[data-tool]').forEach((b) =>
    b.addEventListener('click', () => {
      tool = tool === b.dataset.tool ? null : b.dataset.tool;
      render(S);
    }),
  );

  // 出欠
  $('#date').addEventListener('change', (e) => {
    S.date = e.target.value || store.todayStr();
    S.refresh();
  });
  on('#today', () => {
    S.date = store.todayStr();
    S.refresh();
  });
  on('#open-toggle', () => store.setOpen(S.courseId, S.date, !S.session.open));
  on('#not-yet', showNotYet);
  on('#memo', editMemo);
  on('#display', () => window.open(`display.html?id=${S.courseId}`, `display-${S.courseId}`, 'width=1280,height=800'));
  on('#export', exportCsv);

  // 座席
  on('#flip', () => updateCourse((c) => (c.flipped = !c.flipped)));
  on('#free-seating', toggleFreeSeating);
  on('#shuffle', shuffleSeats);
  on('#clear-all', clearAll);
  on('#resize', async () => {
    const clamp = (v) => Math.min(20, Math.max(1, Math.round(Number(v) || 1)));
    let unseated = 0;
    await updateCourse((c) => {
      c.cols = clamp($('#cols').value);
      c.rows = clamp($('#rows').value);
      unseated = c.freeSeating ? (cleanup(c), 0) : assignEmpty(c);
    });
    toast(unseated ? `座席数を変更しました。${unseated}名分の席が足りません` : '座席数を変更しました', unseated ? 'error' : 'info');
  });

  // グループ
  $$('#gmode [data-gmode]').forEach((b) =>
    b.addEventListener('click', () => {
      gmode = b.dataset.gmode;
      $$('#gmode [data-gmode]').forEach((x) => x.classList.toggle('active', x === b));
      $('#gvalue-unit').textContent = gmode === 'count' ? 'グループ' : '人ずつ';
    }),
  );
  on('#auto-group', async () => {
    const value = Math.floor(Number($('#gvalue').value));
    if (!(value >= 1)) return toast('1以上の数を入力してください', 'error');
    const c = await updateCourse((c) => (c.groups = autoGroups(c, { mode: gmode, value })));
    const count = new Set(Object.values(c.groups)).size;
    if (!count) return toast('グループに分ける席がありません', 'error');
    const note = gmode === 'count' && count < value ? `（人数が${count}名のため${count}グループ）` : '';
    toast(`${count}グループに分けました：${groupSummary(c.groups)}${note}`, 'success');
  });
  on('#clear-group', () => updateCourse((c) => (c.groups = {})));

  // 名簿
  $('#roster-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const rows = await readRosterFile(file);
      if (!rows.length) return toast('ファイルにデータがありません', 'error');
      const cols = await chooseColumns(rows);
      if (cols) importStudents(rowsToStudents(rows, cols));
    } catch (err) {
      toast(`読み込みに失敗しました：${err.message}`, 'error');
    }
  });
  on('#paste-assign', async () => {
    if (await importStudents(parsePaste($('#roster-paste').value))) $('#roster-paste').value = '';
  });
  on('#roster-show', showRoster);

  // 授業設定
  on('#copy-url', async () => {
    try {
      await navigator.clipboard.writeText($('#url').value);
      toast('URLをコピーしました', 'success');
    } catch {
      $('#url').select();
      toast('コピーできませんでした。選択された文字をコピーしてください', 'error');
    }
  });
  on('#save-slot', async () => {
    const c = await updateCourse((c) => {
      c.year = Number($('#year').value) || c.year;
      c.term = $('#term').value;
      c.day = Number($('#day').value);
      c.period = Number($('#period').value);
    });
    toast(`${c.year}年度 ${c.term} ${slotLabel(c)}限に保存しました`);
  });
}

async function importStudents({ students, skipped }) {
  if (!students.length) {
    toast('読み込める学生がいませんでした。「学籍番号 氏名」の形になっているか確認してください', 'error');
    return false;
  }
  let added = 0;
  let unseated = 0;
  let free = false;
  await updateCourse((c) => {
    added = mergeRoster(c, students);
    free = !!c.freeSeating;
    unseated = free ? (cleanup(c), 0) : assignEmpty(c);
  });
  let msg = `${students.length}名を読み込みました（新規 ${added}名）`;
  if (free) msg += '。自由席のため、座席の割り当ては行いません';
  if (skipped) msg += `。${skipped}行は学籍番号か氏名がないため飛ばしました`;
  if (unseated) msg += `。${unseated}名は席が足りません`;
  toast(msg, unseated ? 'error' : 'success');
  return true;
}

async function showRoster() {
  const { course } = S;
  if (!course.roster.length) return toast('名簿はまだありません');
  const rows = [...course.roster]
    .sort((a, b) => a.id.localeCompare(b.id, 'ja', { numeric: true }))
    .map((s) => `<tr><td><input type="checkbox" name="del:${esc(s.id)}"></td><td>${esc(s.id)}</td><td>${esc(s.name)}</td><td>${seatOf(course, s.id) || '—'}</td></tr>`)
    .join('');
  const res = await dialog({
    title: `名簿（${course.roster.length}名）`,
    body: `<div class="table-wrap" style="max-height:50vh"><table class="list"><tr><th>削除</th><th>学籍番号</th><th>氏名</th><th>座席</th></tr>${rows}</table></div>
           <p class="hint">削除したい学生にチェックを入れて「削除」を押してください。出席簿の過去の記録は残ります。</p>`,
    okText: '選択した学生を削除',
    cancelText: '閉じる',
    danger: true,
  });
  if (!res) return;
  const ids = new Set(Object.keys(res).map((k) => k.slice(4)));
  if (!ids.size) return;
  await updateCourse((c) => {
    c.roster = c.roster.filter((s) => !ids.has(s.id));
    for (const k of Object.keys(c.seats)) if (ids.has(c.seats[k])) delete c.seats[k];
  });
  toast(`${ids.size}名を名簿から削除しました`);
}

async function clearAll() {
  const res = await dialog({
    title: 'クリア',
    body: `<p style="margin-top:0">消去する内容を選んでください。</p>
      <label style="display:block"><input type="checkbox" name="records" checked> ${esc(S.date)} の出席記録</label>
      <label style="display:block"><input type="checkbox" name="seats"> 座席の割り当て（名簿は残る）</label>
      <label style="display:block"><input type="checkbox" name="groups"> グループ分け</label>
      <label style="display:block"><input type="checkbox" name="roster"> 名簿（座席の割り当ても消えます）</label>`,
    okText: '消去する',
    danger: true,
  });
  if (!res || !Object.keys(res).length) return;
  if (res.seats || res.groups || res.roster) {
    await updateCourse((c) => {
      if (res.seats || res.roster) c.seats = {};
      if (res.groups) c.groups = {};
      if (res.roster) c.roster = [];
    });
  }
  if (res.records) await store.clearSession(S.courseId, S.date);
  toast('消去しました');
}

// 座席指定なし（自由席）の切り替え
async function toggleFreeSeating() {
  const turningOn = !S.course.freeSeating;
  if (turningOn && Object.keys(S.course.seats).length) {
    const ok = await dialog({
      title: '座席指定なし（自由席）にする',
      body: `<p style="margin-top:0">いまの座席の割り当てをすべて解除し、学生が好きな空席を選べるようにします。</p>
             <p class="hint">名簿はそのまま残ります。学生は座った席をタップし、学籍番号を入力すると出席になります。氏名は先生の画面とプロジェクター表示にだけ出ます。</p>`,
      okText: '自由席にする',
    });
    if (!ok) return;
  }
  await updateCourse((c) => {
    c.freeSeating = turningOn;
    if (turningOn) c.seats = {};
  });
  toast(turningOn ? '自由席にしました' : '座席指定に戻しました。「席をシャッフル」で席を決められます');
}

// まだ出席登録していない学生の一覧
async function showNotYet() {
  const { course, session } = S;
  if (!course.roster.length) return toast('名簿がありません');
  const yet = course.roster
    .filter((s) => !session.records[s.id])
    .sort((a, b) => a.id.localeCompare(b.id, 'ja', { numeric: true }));
  if (!yet.length) return toast('名簿の全員が登録済みです', 'success');

  const res = await dialog({
    title: `未登録の学生（${yet.length}名）`,
    body: `<div class="table-wrap" style="max-height:50vh"><table class="list"><tr><th>学籍番号</th><th>氏名</th></tr>
           ${yet.map((s) => `<tr><td>${esc(s.id)}</td><td>${esc(s.name)}</td></tr>`).join('')}</table></div>
           <p class="hint">この${yet.length}名を、まとめて欠席にできます（あとから個別に直せます）。</p>`,
    okText: '全員を欠席にする',
    cancelText: '閉じる',
    danger: true,
  });
  if (!res) return;
  for (const s of yet) await store.setStatus(S.courseId, S.date, s.id, 'absent', { name: s.name });
  toast(`${yet.length}名を欠席にしました`);
}

async function shuffleSeats() {
  if (S.course.freeSeating) return toast('自由席のため、席の割り当ては行いません（「座席指定なし」をOFFにしてください）', 'error');
  if (!S.course.roster.length) return toast('名簿がありません');
  const ok = await dialog({ title: '席をシャッフル', body: '<p>名簿の全員の席を、ランダムに並べ替えます。よろしいですか？</p>', okText: 'シャッフルする' });
  if (!ok) return;
  let unseated = 0;
  const c = await updateCourse((c) => (unseated = reshuffle(c)));
  const moves = {};
  for (const id of Object.keys(S.session.records)) {
    const k = seatOf(c, id);
    if (k) moves[id] = k;
  }
  if (Object.keys(moves).length) await store.updateRecordSeats(S.courseId, S.date, moves);
  toast(unseated ? `シャッフルしました。${unseated}名分の席が足りません` : 'シャッフルしました', unseated ? 'error' : 'success');
}

async function editMemo() {
  const res = await dialog({
    title: `授業メモ（${S.date}）`,
    body: `<textarea name="memo" rows="8" placeholder="この日の授業内容、連絡事項など">${esc(S.session.memo)}</textarea>`,
    okText: '保存',
  });
  if (!res) return;
  await store.setMemo(S.courseId, S.date, res.memo);
  toast('メモを保存しました');
}

function exportCsv() {
  const { course, session, date } = S;
  const header = ['日付', '授業名', '曜日時限', '学籍番号', '氏名', '座席', '出欠', '登録時刻', '登録方法'];
  const rows = bookStudents(course, [session]).map((st) => {
    const r = session.records[st.id];
    return [
      date,
      course.title,
      `${slotLabel(course)}限`,
      st.id,
      st.name,
      r?.seat || seatOf(course, st.id) || '',
      r ? STATUS_LABEL[r.status] : '未登録',
      fmtTime(r?.time),
      r ? METHOD_LABEL[r.method] : '',
    ];
  });
  downloadText(`出席_${course.title}_${date}.csv`, csvText([header, ...rows]));
}

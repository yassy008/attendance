// 座席表の描画（学生モード・教員モード・プロジェクター表示で共通）
import { seatKey, seatInfo, STATUS_LABEL } from './attendance.js';
import { esc, fmtTime } from './util.js';

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

/**
 * @param {HTMLElement} el
 * @param {object} opt
 *   view: 'student' | 'teacher' | 'display'
 *   flipped: 教卓側から見た向きにする
 *   aisleEdit: 通路の幅を編集する
 *   draggable: ドラッグで入れ替えできる
 *   myStudentId: 学生モードで自分の席を強調する
 *   onSeatClick(info, event) / onSeatContext(info, event) / onGapToggle('col'|'row', n) / onSwap(fromKey, toKey)
 */
export function renderSeatmap(el, course, session, opt = {}) {
  const { view = 'student', flipped = false, aisleEdit = false, draggable = false, myStudentId = null } = opt;
  el._opt = opt;
  bindEvents(el);

  const rows = flipped ? range(course.rows).reverse() : range(course.rows);
  const cols = flipped ? range(course.cols).reverse() : range(course.cols);

  const tracks = (list, gaps) =>
    list.flatMap((n, i) => {
      if (i === list.length - 1) return ['minmax(0, 1fr)'];
      const wide = gaps.includes(Math.min(n, list[i + 1]));
      return ['minmax(0, 1fr)', wide ? 'var(--aisle)' : 'var(--gap)'];
    });
  const colTracks = tracks(cols, course.colGaps);
  const rowTracks = tracks(rows, course.rowGaps).map((t) => (t.startsWith('minmax') ? 'auto' : t));

  let cells = '';
  rows.forEach((r, ri) => {
    cols.forEach((c, ci) => {
      const info = seatInfo(course, session, seatKey(r, c));
      const calls = (info.student && opt.calls?.[info.student.id]?.n) || 0;
      cells += seatHtml(info, view, myStudentId, draggable, ri * 2 + 1, ci * 2 + 1, calls);
    });
  });

  if (aisleEdit) {
    for (let i = 0; i < cols.length - 1; i++) {
      const n = Math.min(cols[i], cols[i + 1]);
      const on = course.colGaps.includes(n) ? ' on' : '';
      cells += `<button type="button" class="gap-btn gap-col${on}" data-gap="col" data-n="${n}" style="grid-column:${i * 2 + 2};grid-row:1/-1" title="通路の切り替え"></button>`;
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const n = Math.min(rows[i], rows[i + 1]);
      const on = course.rowGaps.includes(n) ? ' on' : '';
      cells += `<button type="button" class="gap-btn gap-row${on}" data-gap="row" data-n="${n}" style="grid-row:${i * 2 + 2};grid-column:1/-1" title="通路の切り替え"></button>`;
    }
  }

  const board = `<div class="board">黒板</div>`;
  el.className = `seatmap view-${view}${aisleEdit ? ' aisle-edit' : ''}`;
  el.innerHTML = `
    <div class="seatmap-inner" style="min-width:calc(${course.cols} * var(--seat-min))">
      ${flipped ? '' : board}
      <div class="seat-grid" style="grid-template-columns:${colTracks.join(' ')};grid-template-rows:${rowTracks.join(' ')}">${cells}</div>
      ${flipped ? board : ''}
    </div>`;
}

function seatHtml(info, view, myStudentId, draggable, gridRow, gridCol, calls = 0) {
  const cls = ['seat'];
  // 学生の画面には「着席しているかどうか」だけを出す（欠席・出席扱いは出さない）
  const showStatus =
    view === 'teacher' ? info.status : info.status === 'present' || info.status === 'late' ? 'present' : null;
  if (info.disabled) cls.push('disabled');
  else if (showStatus) cls.push(`st-${showStatus}`);
  else if (info.student) cls.push('assigned');
  else cls.push('empty');
  if (myStudentId && info.student?.id === myStudentId) cls.push('mine');
  const group = info.disabled ? null : info.group;
  if (group) cls.push('grouped', `g${(group - 1) % 10}`);

  let inner = `<span class="seat-label">${info.key}</span>`;
  if (group) inner += `<span class="seat-group">G${group}</span>`;
  if (info.disabled) {
    inner += `<span class="seat-x">×</span>`;
  } else if (info.student) {
    // 自由席では学生の画面に氏名を出さないので、代わりに「着席済み」と表示する
    const shownName = info.student.name || (view === 'teacher' ? '' : '着席済み');
    if (view === 'teacher') inner += `<span class="seat-id">${esc(info.student.id)}</span>`;
    if (shownName) inner += `<span class="seat-name">${esc(shownName)}</span>`;
    if (view === 'teacher' && info.status) {
      const t = info.record.time ? ` ${fmtTime(info.record.time)}` : '';
      inner += `<span class="seat-status">${STATUS_LABEL[info.status]}${t}</span>`;
    } else if (view !== 'teacher' && showStatus) {
      inner += `<span class="seat-status">✓</span>`;
    }
  }
  // 指名した回数（教員の画面だけに出す）
  if (view === 'teacher' && calls > 0) inner += `<span class="seat-calls">指名${calls}</span>`;
  const drag = draggable && info.student && !info.disabled ? ' draggable="true"' : '';
  return `<div class="${cls.join(' ')}" data-key="${info.key}"${drag} style="grid-row:${gridRow};grid-column:${gridCol}"><div class="seat-inner">${inner}</div></div>`;
}

function bindEvents(el) {
  if (el._bound) return;
  el._bound = true;
  const infoOf = (target) => {
    const seat = target.closest('.seat');
    return seat ? seat.dataset.key : null;
  };

  el.addEventListener('click', (e) => {
    const gap = e.target.closest('.gap-btn');
    if (gap) return el._opt.onGapToggle?.(gap.dataset.gap, Number(gap.dataset.n));
    const key = infoOf(e.target);
    if (key) el._opt.onSeatClick?.(key, e);
  });

  el.addEventListener('contextmenu', (e) => {
    const key = infoOf(e.target);
    if (key && el._opt.onSeatContext) {
      e.preventDefault();
      el._opt.onSeatContext(key, e);
    }
  });

  el.addEventListener('dragstart', (e) => {
    const key = infoOf(e.target);
    if (key) e.dataTransfer.setData('text/plain', key);
  });
  el.addEventListener('dragover', (e) => {
    if (el._opt.draggable && infoOf(e.target)) e.preventDefault();
  });
  el.addEventListener('drop', (e) => {
    const to = infoOf(e.target);
    const from = e.dataTransfer.getData('text/plain');
    if (to && from && to !== from) {
      e.preventDefault();
      el._opt.onSwap?.(from, to);
    }
  });
}

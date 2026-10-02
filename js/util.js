export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const DAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export function param(name) {
  return new URLSearchParams(location.search).get(name);
}

export function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDateJa(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = DAYS[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日（${w}）`;
}

export function fmtDateShort(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}`;
}

export function slotLabel(course) {
  return `${DAYS[course.day] ?? ''}${course.period ?? ''}`;
}

export function toast(message, type = 'info') {
  let box = $('#toast-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-box';
    document.body.append(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  box.append(el);
  setTimeout(() => el.remove(), 3500);
}

// 簡易ダイアログ。OK で入力値（フォーム要素の name → value）を返し、キャンセルで null を返す
export function dialog({ title, body = '', okText = 'OK', cancelText = 'キャンセル', danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg';
    dlg.innerHTML = `
      <form method="dialog">
        <h3>${esc(title)}</h3>
        <div class="dlg-body">${body}</div>
        <p class="dlg-error" hidden></p>
        <div class="dlg-actions">
          ${cancelText ? `<button value="cancel" class="btn btn-gray" formnovalidate>${esc(cancelText)}</button>` : ''}
          <button value="ok" class="btn ${danger ? 'btn-red' : 'btn-primary'}">${esc(okText)}</button>
        </div>
      </form>`;
    document.body.append(dlg);
    dlg.addEventListener('close', () => {
      // キャンセル（またはEsc）のときだけ null。独自ボタンは _action で受け取れる
      const ok = dlg.returnValue !== '' && dlg.returnValue !== 'cancel';
      const values = Object.fromEntries(new FormData(dlg.querySelector('form')));
      dlg.remove();
      resolve(ok ? { ...values, _action: dlg.returnValue } : null);
    });
    dlg.showModal();
    dlg.querySelector('input, textarea, select')?.focus();
  });
}

// Excel は「3-2」を日付（3月2日）に、先頭が0の学籍番号を数値に変えてしまう。
// 数式の形にしておくと、そのままの文字として読み込まれる。
export function asText(value) {
  const s = value == null ? '' : String(value);
  return s === '' ? '' : `="${s.replace(/"/g, '""')}"`;
}

export function csvText(rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Excel で文字化けしないよう BOM を付ける
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

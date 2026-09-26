// 名簿の読み込み（xlsx / xls / csv ファイル、または貼り付け）
import { normalizeId } from './attendance.js';
import { esc, dialog } from './util.js';

export async function readRosterFile(file) {
  if (!window.XLSX) throw new Error('Excel読み込み用のライブラリを読み込めませんでした。ネット接続を確認してください');
  const buf = await file.arrayBuffer();
  let wb;
  if (/\.csv$/i.test(file.name)) {
    // 大学のシステムから出力した CSV は Shift_JIS のことが多いので、UTF-8 で読めなければ Shift_JIS で読む
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      text = new TextDecoder('shift_jis').decode(buf);
    }
    wb = XLSX.read(text.replace(/^\uFEFF/, ''), { type: 'string', raw: true });
  } else {
    wb = XLSX.read(buf, { type: 'array' });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  return rows.map((r) => r.map((v) => String(v).trim())).filter((r) => r.some((v) => v !== ''));
}

// 学籍番号・氏名の列を選ぶダイアログ。キャンセルなら null
export async function chooseColumns(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  const header = rows[0] || [];
  const isName = (h) => /氏名|名前|なまえ/.test(h) && !/カナ|かな|ふりがな|フリガナ|ローマ|英字/.test(h);
  const idGuess = header.findIndex((h) => /学籍|学生番号|番号|ID/i.test(h));
  const nameGuess = header.findIndex(isName);
  const hasHeader = idGuess >= 0 || nameGuess >= 0;

  const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `列${i + 1}`);
  const options = (selected) =>
    Array.from({ length: width }, (_, i) => {
      const label = `${letter(i)}列${hasHeader && header[i] ? `（${esc(header[i])}）` : ''}`;
      return `<option value="${i}"${i === selected ? ' selected' : ''}>${label}</option>`;
    }).join('');

  const preview = rows
    .slice(0, 6)
    .map((r) => `<tr>${Array.from({ length: width }, (_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`)
    .join('');

  const res = await dialog({
    title: '読み込む列の確認',
    body: `
      <div class="table-wrap" style="max-height:180px;margin-bottom:12px">
        <table class="list"><tr>${Array.from({ length: width }, (_, i) => `<th>${letter(i)}</th>`).join('')}</tr>${preview}</table>
      </div>
      <div class="field"><label>学籍番号の列</label><select name="idCol">${options(Math.max(idGuess, 0))}</select></div>
      <div class="field"><label>氏名の列</label><select name="nameCol">${options(nameGuess >= 0 ? nameGuess : Math.min(1, width - 1))}</select></div>
      <label><input type="checkbox" name="skipHeader"${hasHeader ? ' checked' : ''}> 1行目は見出しなので読み込まない</label>
      <p class="hint">全${rows.length}行。同じ学籍番号の学生はすでに名簿にあれば氏名を更新し、新しい学生は空席にランダムに配置します。</p>`,
    okText: '読み込む',
  });
  if (!res) return null;
  return { idCol: Number(res.idCol), nameCol: Number(res.nameCol), skipHeader: res.skipHeader === 'on' };
}

export function rowsToStudents(rows, { idCol, nameCol, skipHeader }) {
  return collect((skipHeader ? rows.slice(1) : rows).map((r) => [r[idCol], r[nameCol]]));
}

// 貼り付け：1行に「学籍番号 氏名」（タブ・カンマ・空白区切り）
export function parsePaste(text) {
  const pairs = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([^\t,]+)[\t,]+(.+)$/) || line.match(/^(\S+)\s+(.+)$/);
      return m ? [m[1], m[2].replace(/[\t,]+/g, ' ')] : [line, ''];
    });
  return collect(pairs);
}

function collect(pairs) {
  const map = new Map();
  let skipped = 0;
  for (const [rawId, rawName] of pairs) {
    const id = normalizeId(rawId);
    const name = String(rawName ?? '').trim();
    if (!id || !name) {
      skipped++;
      continue;
    }
    map.set(id, { id, name });
  }
  return { students: [...map.values()], skipped };
}

export function mergeRoster(course, students) {
  const byId = new Map(course.roster.map((s) => [s.id, s]));
  let added = 0;
  for (const s of students) {
    if (!byId.has(s.id)) added++;
    byId.set(s.id, { ...byId.get(s.id), ...s });
  }
  course.roster = [...byId.values()];
  return added;
}

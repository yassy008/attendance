// 学生モード：QRコードの表示と、座席タップによる出席登録
import * as store from './store.js';
import { seatInfo, STATUS_LABEL } from './attendance.js';
import { renderSeatmap } from './seatmap.js';
import { $, esc, fmtTime, dialog, toast } from './util.js';

const device = store.deviceId();
let inited = false;

export function studentUrl(courseId) {
  return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}room.html?id=${courseId}`;
}

export function init(state) {
  if (inited) return;
  inited = true;
  const url = studentUrl(state.courseId);
  $('#student-area').innerHTML = `
    <section class="panel">
      <div class="checkin">
        <div>
          <h2>出席のしかた</h2>
          <ol class="steps">
            <li>スマートフォンでQRコードを読み取る</li>
            <li>座席表から自分の名前の席をタップする（名簿にない人は、空いている席）</li>
            <li>学籍番号を入力して「出席する」を押す</li>
          </ol>
          <div id="my-status" style="margin-top: 12px"></div>
        </div>
        <div class="qr-card qr-block">
          <p>このQRコードを読み取ってください</p>
          <div id="qr"></div>
          <div><button type="button" class="btn btn-outline btn-sm" id="print-qr">印刷用に表示</button></div>
        </div>
      </div>
    </section>`;
  if (window.QRCode) {
    new QRCode($('#qr'), { text: url, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
  } else {
    $('#qr').textContent = url;
  }
  $('#print-qr').addEventListener('click', () => printQr(state.course, url));
}

export function render(state) {
  const { course, session } = state;
  const myId = session.devices[device] || null;
  const mine = myId ? session.records[myId] : null;

  let notice;
  if (mine) {
    const label = mine.status === 'present' ? '出席登録済み' : STATUS_LABEL[mine.status];
    notice = `<div class="notice ok">✅ ${label}：<b>${esc(mine.seat ?? '')}　${esc(mine.name)}</b> さん（${fmtTime(mine.time)}）</div>`;
  } else if (!session.open) {
    notice = `<div class="notice">現在、出席の受付は停止中です。</div>`;
  } else {
    notice = `<div class="notice">まだ出席登録していません。下の座席表から自分の席をタップしてください。</div>`;
  }
  $('#my-status').innerHTML = notice;

  renderSeatmap($('#seatmap'), course, session, {
    view: 'student',
    myStudentId: myId,
    onSeatClick: (key) => onSeat(state, key, myId),
  });
}

async function onSeat(state, key, myId) {
  if (myId) return toast('この端末からはすでに出席登録されています', 'error');
  const info = seatInfo(state.course, state.session, key);
  if (info.disabled) return;
  if (!state.session.open) return toast('現在、出席の受付は停止中です', 'error');
  if (info.record) return toast('この席はすでに出席登録されています', 'error');

  const free = !info.assigned && !!state.course.freeSeating; // 座席指定なしの授業
  let error = '';
  const values = { studentId: '', name: '' };
  for (;;) {
    const body = `
      ${error ? `<p class="dlg-error">${esc(error)}</p>` : ''}
      ${info.assigned || free ? '<p class="muted" style="margin-top:0">本人確認のため、学籍番号を入力してください。</p>' : ''}
      <div class="field"><label>学籍番号</label><input type="text" name="studentId" value="${esc(values.studentId)}" autocomplete="off" required></div>
      ${
        info.assigned
          ? ''
          : `<div class="field"><label>氏名${free ? '（名簿にない場合のみ）' : ''}</label>
             <input type="text" name="name" value="${esc(values.name)}" autocomplete="off"${free ? '' : ' required'}></div>`
      }`;
    const res = await dialog({
      title: info.assigned ? `座席 ${key}　${info.student.name} さん` : `座席 ${key} で出席登録`,
      body,
      okText: '出席する',
    });
    if (!res) return;
    Object.assign(values, res);
    try {
      await store.checkIn(state.courseId, { seat: key, studentId: res.studentId, name: res.name, device });
      toast('出席を登録しました', 'success');
      return;
    } catch (e) {
      error = e.message;
    }
  }
}

function printQr(course, url) {
  const src = $('#qr canvas')?.toDataURL() || $('#qr img')?.src || '';
  const w = window.open('', '_blank');
  if (!w) return toast('ポップアップがブロックされました', 'error');
  w.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>QRコード - ${esc(course.title)}</title>
    <style>body{font-family:sans-serif;text-align:center;padding:32px}h1{font-size:40px;margin:0 0 8px}
    img{width:65vmin;height:65vmin;image-rendering:pixelated;margin:24px 0}p{font-size:20px;word-break:break-all}</style></head>
    <body><h1>${esc(course.title)}</h1><p>スマートフォンで読み取って出席登録してください</p>
    <img src="${src}" alt="QRコード"><p>${esc(url)}</p></body></html>`);
  w.document.close();
  w.onload = () => w.print();
}

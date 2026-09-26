// プロジェクター表示：座席と氏名だけを大きく表示（学籍番号は出さない）
import * as store from './store.js';
import { renderSeatmap } from './seatmap.js';
import { $, param } from './util.js';

const courseId = param('id');

async function refresh() {
  const course = await store.getCourse(courseId);
  if (!course) {
    $('#seatmap').innerHTML = '<p class="empty-msg">授業が見つかりません</p>';
    return;
  }
  document.title = `座席表 - ${course.title}`;
  const session = await store.getSession(courseId, store.todayStr());
  renderSeatmap($('#seatmap'), course, session, { view: 'display' });
}

$('#fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
});

store.subscribe(refresh);
refresh();

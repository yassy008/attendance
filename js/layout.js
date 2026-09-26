// 座席の割り当て・グループ分けの計算（course のコピーを受け取って書き換える）
import { seatKey } from './attendance.js';
import { shuffle } from './util.js';

export function usableSeats(course) {
  const keys = [];
  for (let r = 1; r <= course.rows; r++) {
    for (let c = 1; c <= course.cols; c++) {
      const k = seatKey(r, c);
      if (!course.disabled.includes(k)) keys.push(k);
    }
  }
  return keys;
}

// 範囲外になった席・名簿にない学生・使えない席の割り当てを取り除く
export function cleanup(course) {
  const ids = new Set(course.roster.map((s) => s.id));
  const usable = new Set(usableSeats(course));
  for (const k of Object.keys(course.seats)) {
    if (!usable.has(k) || !ids.has(course.seats[k])) delete course.seats[k];
  }
  for (const k of Object.keys(course.groups)) {
    if (!usable.has(k)) delete course.groups[k];
  }
  course.disabled = course.disabled.filter((k) => {
    const [r, c] = k.split('-').map(Number);
    return r <= course.rows && c <= course.cols;
  });
  course.colGaps = course.colGaps.filter((n) => n < course.cols);
  course.rowGaps = course.rowGaps.filter((n) => n < course.rows);
}

// 席のない学生を空席にランダムに配置する。座れなかった人数を返す
export function assignEmpty(course) {
  cleanup(course);
  const seated = new Set(Object.values(course.seats));
  const empty = shuffle(usableSeats(course).filter((k) => !course.seats[k]));
  const waiting = course.roster.filter((s) => !seated.has(s.id));
  waiting.forEach((s, i) => {
    if (i < empty.length) course.seats[empty[i]] = s.id;
  });
  return Math.max(0, waiting.length - empty.length);
}

export function reshuffle(course) {
  course.seats = {};
  return assignEmpty(course);
}

export function swapSeats(course, a, b) {
  const x = course.seats[a];
  const y = course.seats[b];
  if (y) course.seats[a] = y;
  else delete course.seats[a];
  if (x) course.seats[b] = x;
  else delete course.seats[b];
}

// 列のまとまり：通路で区切られた範囲を、さらに width 列ずつに分ける
function columnStrips(course, width) {
  const ends = [...new Set(course.colGaps)].filter((n) => n < course.cols).sort((a, b) => a - b);
  ends.push(course.cols);
  const strips = [];
  let start = 1;
  for (const end of ends) {
    for (let c = start; c <= end; c += width) strips.push([c, Math.min(end, c + width - 1)]);
    start = end + 1;
  }
  return strips;
}

// グループごとの人数（mode: 'size' は1グループの人数、'count' はグループ数）
export function groupSizes(n, { mode, value }) {
  if (!n || value < 1) return [];
  if (mode === 'count') {
    const k = Math.min(value, n);
    return Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
  }
  const sizes = Array.from({ length: Math.ceil(n / value) }, (_, i) => Math.min(value, n - i * value));
  // 最後が1人だけになるときは、直前のグループに合流させる
  if (sizes.length > 1 && sizes.at(-1) === 1) sizes[sizes.length - 2] += sizes.pop();
  return sizes;
}

// 自動グループ分け。
// 座席を「列のまとまりごとに、前→後ろ、次のまとまりは後ろ→前」と蛇行する順に並べ、
// 先頭から groupSizes の人数ずつ区切る（隣り合う席が同じグループになりやすい）
export function autoGroups(course, opt) {
  const usable = usableSeats(course);
  const occupied = usable.filter((k) => course.seats[k]);
  const targets = new Set(occupied.length ? occupied : usable);
  const sizes = groupSizes(targets.size, opt);
  if (!sizes.length) return {};

  const avg = Math.ceil(targets.size / sizes.length);
  const width = Math.min(course.cols, avg <= 3 ? avg : Math.max(2, Math.round(Math.sqrt(avg))));
  const ordered = [];
  columnStrips(course, width).forEach(([c1, c2], i) => {
    const rows = Array.from({ length: course.rows }, (_, r) => r + 1);
    if (i % 2) rows.reverse();
    for (const r of rows) {
      for (let c = c1; c <= c2; c++) {
        const k = seatKey(r, c);
        if (targets.has(k)) ordered.push(k);
      }
    }
  });

  const groups = {};
  let i = 0;
  sizes.forEach((size, g) => {
    for (let j = 0; j < size; j++) groups[ordered[i++]] = g + 1;
  });
  return groups;
}

// 「4人×6、2人×1」のような要約
export function groupSummary(groups) {
  const counts = {};
  for (const g of Object.values(groups)) counts[g] = (counts[g] || 0) + 1;
  const bySize = {};
  for (const n of Object.values(counts)) bySize[n] = (bySize[n] || 0) + 1;
  return Object.entries(bySize)
    .sort((a, b) => b[0] - a[0])
    .map(([size, k]) => `${size}人×${k}`)
    .join('、');
}

// 手動グループ編集。dir: +1 次のグループ / -1 前のグループ / 0 解除
export function stepGroup(groups, key, dir) {
  const max = Math.max(0, ...Object.values(groups));
  const next = dir === 0 ? 0 : (groups[key] || 0) + dir;
  if (next <= 0) delete groups[key];
  else groups[key] = Math.min(next, max + 1);
  return groups;
}

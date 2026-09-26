// 教員用ログイン（大学のGoogleアカウント）。Firebase を使わない設定のときは、何もせず通す。
import * as store from './store.js';
import { allowedEmailDomain } from './firebase-config.js';
import { $, esc, toast } from './util.js';

const domainNote = allowedEmailDomain
  ? `<p class="hint">大学のアカウント（@${esc(allowedEmailDomain)}）でログインしてください。</p>`
  : '';

export async function ensureTeacher(container, message = '教員用の画面です。Googleアカウントでログインしてください。') {
  await store.auth.ready;
  if (store.auth.isTeacher()) return true;

  const u = store.auth.user();
  const wrongAccount = u && !u.anonymous && u.email;
  container.innerHTML = wrongAccount
    ? `<section class="panel" style="max-width: 520px; margin: 40px auto; text-align: center">
         <h2 style="justify-content: center">このアカウントでは使えません</h2>
         <p class="muted">いま <b>${esc(u.email)}</b> でログインしています。${
           allowedEmailDomain ? `大学のアカウント（@${esc(allowedEmailDomain)}）に切り替えてください。` : ''
         }</p>
         <button type="button" class="btn btn-lg btn-outline" id="signout-switch" style="margin-top: 10px">別のアカウントでログイン</button>
       </section>`
    : `<section class="panel" style="max-width: 520px; margin: 40px auto; text-align: center">
         <h2 style="justify-content: center">教員用ログイン</h2>
         <p class="muted">${esc(message)}</p>
         <button type="button" class="btn btn-lg" id="signin" style="margin-top: 10px">Googleでログイン</button>
         ${domainNote}
         <p class="hint">学生は、ログインせずにQRコードから出席できます。</p>
       </section>`;

  $('#signout-switch')?.addEventListener('click', async () => {
    await store.auth.signOut();
    location.reload();
  });

  $('#signin')?.addEventListener('click', async () => {
    try {
      await store.auth.signIn();
      location.reload();
    } catch (e) {
      const code = String(e?.code || '');
      if (code.includes('popup-blocked')) toast('ポップアップがブロックされました。許可してからもう一度お試しください', 'error');
      else if (code.includes('popup-closed') || code.includes('cancelled-popup')) toast('ログインが中断されました', 'error');
      else if (code.includes('unauthorized-domain')) toast('このアドレスはFirebaseで許可されていません（承認済みドメインに追加してください）', 'error');
      else toast(`ログインできませんでした：${e?.message || e}`, 'error');
    }
  });
  return false;
}

// 上部バーに「ログイン中のアカウント」と「ログアウト」を出す
export async function authBar(el) {
  if (!el) return;
  await store.auth.ready;
  const u = store.auth.user();
  if (!u || u.anonymous || !u.email) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<span class="muted" style="font-size: 12.5px">${esc(u.email)}</span>
    <button type="button" class="link-btn" id="signout">ログアウト</button>`;
  $('#signout').addEventListener('click', async () => {
    await store.auth.signOut();
    location.href = 'index.html';
  });
}

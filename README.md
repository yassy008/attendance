# 出席確認システム（試作版）

QRコードで学生が自分の席をタップして出席登録し、教員が座席表・出席簿で確認するWebアプリです。

## いまの段階

**Step 2：Firebase 接続**（データは Firebase に保存。先生はGoogleログイン、学生はログインなし）

- `js/firebase-config.js` に設定値が入っていれば Firebase を使い、空にすると「このPCのブラウザ内だけに保存」の試作版の動きに戻ります。
- 準備の手順は [docs/firebase-setup.md](docs/firebase-setup.md) を参照してください。
- アクセス制限のルールは `firestore.rules` です。Firebase の画面に貼り付けて公開します。

## 起動方法（Windows）

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1
```

ブラウザで http://localhost:8123 を開きます。

### 動作確認のコツ

- 学生画面のURLの末尾に `&device=1`、`&device=2` などを付けると、別々の端末として出席登録を試せます。
- 教員モードで「表示する日付」を変えると、過去の日付の出欠を修正できます。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `index.html` / `js/top.js` | トップページ（授業一覧・作成） |
| `room.html` / `js/room.js` | 授業ページ（学生モード／教員モードの切り替え） |
| `js/student.js` | 学生モード（QRコード、出席登録） |
| `js/teacher.js` | 教員モード（名簿、座席操作、欠席・遅刻、CSV） |
| `display.html` / `js/display.js` | プロジェクター用の座席表（氏名のみ） |
| `book.html` / `js/book.js` | 出席簿（学生×日付） |
| `js/seatmap.js` | 座席表の描画（全画面共通） |
| `js/attendance.js` | 出席登録のルール（本人確認、1台1人など） |
| `js/layout.js` | 座席割り当て・シャッフル・グループ分け |
| `js/roster.js` | 名簿の読み込み（xlsx/xls/csv、貼り付け） |
| `js/store.js` | データの保存（Firebase版ではここを差し替え） |

## 次のステップ

- **Step 2**：Firebase（Firestore・Authentication）に接続。教員はGoogleログイン、学生はログインなし。
- **Step 3**：GitHub Pages で公開し、授業で試用。

## GitHub Pages で公開する

1. GitHub で**空のリポジトリ**を作る（公開／Public、READMEなどは付けない）。
2. このフォルダを push する。
3. リポジトリの Settings → Pages → Source を「Deploy from a branch」、ブランチを `main`、フォルダを `/ (root)` にする。
4. 数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で開ける。
5. Firebase の Authentication →「設定」→「承認済みドメイン」に `<ユーザー名>.github.io` を追加する（教員のログインに必要）。

`js/firebase-config.js` の値は公開して問題ないものです。名簿や出席記録は Firebase 側にあり、リポジトリには入りません。

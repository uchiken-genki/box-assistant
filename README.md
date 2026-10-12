# Box Assistant

Web ページで選んだテキストから、Box の社内資料検索と Box AI 回答を呼び出す Chrome 拡張機能です。

Client ID / Client Secret / 質問先 Hub などの認証情報は **ソースコードに含めていません**。各利用者が設定画面で入力し、Chrome のローカルストレージにだけ保存されます。

```
Webページでテキストを選択
  → 右クリック「Box Assistantに聞く」
  → サイドパネル
  → Box検索 / 関連資料 / Box AI / Hub AI
```

## できること

- 選択テキストで Box Search
- 関連ファイルを根拠に Box AI（`POST /2.0/ai/ask`）へ質問
- アクセスできる Box Hub を選んで保存し、Hub 全体へ質問（Box AI for Hubs）
- フォルダ / ファイルの Metadata 表示
- サイドパネルを別ウィンドウで開く

## インストール

1. このリポジトリを clone する
2. Chrome で `chrome://extensions` を開く
3. 「デベロッパーモード」をオンにする
4. 「パッケージ化されていない拡張機能を読み込む」
5. このフォルダ（`manifest.json` がある場所）を選ぶ
6. アドレスバー右のパズルアイコンから **Box Assistant** を開く（ピン留め推奨）

ショートカット: `Ctrl+Shift+Y`（Mac は `Command+Shift+Y`）

## 動作確認環境

次の環境で動作することを確認しています。

- Windows 11
- Google Chrome `155.0.8059.40`

## 初回設定

1. [Box Developer Console](https://app.box.com/developers/console) で **Platform App**（OAuth 2.0）を作成する
2. Application Scopes で次を有効にする
   - Read all files and folders stored in Box
   - Manage AI
3. 拡張機能の設定画面に表示される **Redirect URI** と **CORS Origin** を Developer Console に登録する
4. Client ID と Client Secret を設定画面に入力して保存する（次回から自動で読み込みます）
5. 管理者コンソールでアプリを認可する。スコープ追加後は再認可が必要です
6. サイドパネルの「Boxに接続」でログインする
7. **Hub** タブで質問先 Hub を選び、「このHubを保存」する（次回からその Hub を使います）

Client Secret を GitHub やチャットに貼らないでください。

## Hub AI

Hub タブで、ログイン中のユーザーがアクセスできる Hub 一覧から選択できます。保存した Hub ID は Chrome に残り、再起動後も使われます。

Box AI for Hubs は、テナントで有効化され、対象 Hub のコンテンツがインデックスされている必要があります。

## アーキテクチャ

```
src/
  background.js          Service Worker
  content.js             選択テキストと Box フォルダID
  handlers.js            メッセージ処理
  lib/auth.js            OAuth 2.0（資格情報は chrome.storage.local）
  lib/box-api.js         Search / Folder / Metadata / AI / Hubs
  lib/hub.js             Hub 質問用プロンプト
  sidepanel/             Side Panel UI
  options/               Client ID / Secret / Hub の保存
```

トークンと API 呼び出しは Service Worker に集約しています。

## ライセンス

MIT

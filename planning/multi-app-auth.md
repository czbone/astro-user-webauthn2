# 認証サーバーと複数アプリ

本ファイルは、このアプリを認証サーバーとし、複数の Astro アプリでユーザーとアクセス範囲を共有する構成の仕様です。ログイン、パスキー、招待、復旧の手続き自体は [specification.md](../docs/specification.md) と [session-management.md](../docs/session-management.md) に従います。Redis の既存キーは [redis.md](../docs/redis.md) に従い、本ファイルは複数アプリで増えるキーと権限だけを定めます。参加アプリの実装手順は [participant-app.md](./participant-app.md) です。

現行の実装は単一アプリです。本ファイルは、その先の構成仕様です。

## 1. 構成

```text
ブラウザ
  ├─ 認証サーバー（このアプリ）  ホスト専用 Cookie
  └─ 参加アプリ（Astro SSR が複数）  アプリごとのホスト専用 Cookie

認証サーバーと参加アプリ
  ├─ PostgreSQL（User / WebAuthnCredential / App / AppGrant）
  └─ Redis（セッション、引き渡しコード、既存の短命データ）
```

| 役割 | 持つもの | 持たないもの |
|------|----------|----------------|
| 認証サーバー | ログイン、パスキー、招待、マジックリンク、復旧、ユーザー作成、`App` / `AppGrant` の変更、セッションの作成 | 参加アプリの業務データ |
| 参加アプリ | 自分のホスト専用セッションの検証、自分の `AppGrant` の参照、自分の業務データ | パスキー儀式、ユーザー作成、権限の変更、他アプリのセッション作成 |

参加アプリは HTTP のイントロスペクションを呼ばず、PostgreSQL と Redis へ直接接続します。接続権限で、書ける範囲を認証サーバーに限定します。

アプリはサブドメインで分けます（例: `auth.example.com`、`app.example.com`）。Cookie の `Domain` は付けません。親ドメイン共通の Cookie は使わないので、あるホストへ届いた生トークンを、そのホストが他アプリへ再送できません。

親ドメインは環境変数 `PARENT_DOMAIN` で一つに固定します。公開サフィックスからの推定はしません。許すホストは `{ラベル}.{PARENT_DOMAIN}` だけです。ラベルは1つで、小文字・数字・ハイフンです。頂点ドメインと、もう一段深いホストは拒否します。`App` に親ドメイン列は置かず、正は各アプリの完全オリジンです。参加アプリのホストは認証サーバーのホストとは別です。開発は `PARENT_DOMAIN=localhost`、`auth.localhost` と `app.localhost` です。

## 2. 接続権限

### PostgreSQL

| ロール | `User` | `WebAuthnCredential` | `App` / `AppGrant` | そのアプリの業務テーブル |
|--------|--------|----------------------|--------------------|--------------------------|
| 認証サーバー | 読み書き | 読み書き | 読み書き | 認証サーバー自身の業務テーブルのみ |
| 参加アプリ | `id` / `email` / `name` の参照 | `id` / `userId` の参照（件数だけ） | 参照 | 読み書き |

参加アプリには `User.password`、`User.role`、`WebAuthnCredential` の公開鍵・カウンタ・`credentialId`・`transports` を与えません。

`User.role` は認証サーバー上の権限です（ユーザー招待と `AppGrant` の編集）。参加アプリの画面権限には使いません。

### Redis

論理キーの `{appId}` はそのアプリの ID です。ACL はプレフィックス単位とします。

| ロール | 許可する操作 |
|--------|----------------|
| 認証サーバー | セッション、引き渡し、challenge、招待、再設定、マジックリンク、レート制限の読み書き |
| 参加アプリ | `sess:{appId}:*` の GET、EXPIRE、DEL。`handoff:{appId}:*` の GET、GETDEL、DEL。`sess:user:*` の SREM |

参加アプリはセッションの SET と、ユーザー索引への SADD を持ちません。引き渡しコードを消費したあと、自分でセッション行を作ることはできません。

## 3. データモデル

### PostgreSQL

既存の `User` と `WebAuthnCredential` は [specification.md](../docs/specification.md) のとおりです。`Post` は認証サーバー、またはそれを業務として持つアプリのテーブルであり、共有しません。

`App`

| 列 | 内容 |
|----|------|
| `id` | 小文字・数字・ハイフン、1〜32 文字。Redis キーに使う安定した ID |
| `name` | 表示名 |
| `origin` | `https://` のオリジン。ポートを含めて完全一致 |
| `redirectUris` | 引き渡し先 URL の一覧。各要素のオリジンは `origin` と一致する |

アプリの登録は認証サーバーの管理者が行います。参加アプリからの自己登録はありません。

`AppGrant`

| 列 | 内容 |
|----|------|
| `userId` | `User.id` |
| `appId` | `App.id` |
| `permission` | `admin` または `user` |

一意制約は `(userId, appId)` です。行が無いユーザーは、そのアプリを使えません。`permission` はそのアプリの中の権限です。認証サーバーの `User.role` とは独立です。

seed 管理者は、全アプリへ自動では通しません。認証サーバーの `User.role = admin` だけを持ち、各アプリの利用は `AppGrant` を明示して与えます。

### Redis のセッション

キー: `sess:{appId}:{tokenHash}`

```json
{
  "id": "<uuid>",
  "userId": "<uuid>",
  "appId": "<appId>",
  "createdAt": "<ISO8601>"
}
```

`tokenHash` は生トークンの SHA-256 です。値にメール、ロール、権限は載せません。ユーザー索引 `sess:user:{userId}` の要素は `{appId}/{tokenHash}` です。全失効のとき、この要素から各セッションキーを削除します。

認証サーバー自身のログインセッションも同じ形です。`appId` は認証サーバー用に登録した `App.id` です。

TTL は現行どおり `SESSION_MAX_AGE_SECONDS`（既定 30 日、スライディング）です。

### Redis の引き渡しコード

キー: `handoff:{appId}:{codeHash}`

TTL は 60 秒です。単回使用で、消費は `GETDEL` です。`GET` のあとに `DEL` する実装にはしません。

```json
{
  "token": "<生のセッショントークン>",
  "userId": "<uuid>",
  "state": "<引き渡し開始時の state>",
  "redirectUri": "<完全一致した戻り先>"
}
```

生トークンを Redis に置くのはこの 60 秒だけです。消費後に生トークンを持つのは、参加アプリが発行した Cookie だけです。

## 4. Cookie

すべてのセッション Cookie はホスト専用です。

| 項目 | 仕様 |
|------|------|
| 名前 | `__Host-session` |
| 属性 | `Secure`、`HttpOnly`、`SameSite=Lax`、`Path=/`、`Domain` なし、`Max-Age=2592000` |
| 値 | 暗号学的乱数トークン |

`__Host-` は、ブラウザが `Secure`、`Path=/`、`Domain` なしを強制する接頭辞です。他ホストからこの Cookie を上書きできません。`Domain` を付ける構成にはしません。

引き渡し開始時だけ、参加アプリが次の Cookie を発行します。

| 項目 | 仕様 |
|------|------|
| 名前 | `__Host-handoff` |
| 値 | `state` と、参加アプリ内の戻り先パス。形式は [participant-app.md](./participant-app.md) |
| 属性 | `Secure`、`HttpOnly`、`SameSite=Lax`、`Path=/`、`Max-Age=300` |

## 5. ログインとアプリへの引き渡し

パスキーの登録とログイン、招待マジックリンク、復旧は認証サーバーのオリジンだけで行います。手続きは [specification.md](../docs/specification.md) のとおりです。Credential が 1 件も無いセッションでは、引き渡しを発行しません。パスキー設定が終わるまで認証サーバー内に留めます。

`state` は `^[\w.~-]{1,128}$` に一致する暗号学的乱数です。`redirect_uri` に `?` と `#` は含めません。オリジンは `App.origin` と一致し、値そのものが `App.redirectUris` に含まれるときだけ受けます。

参加アプリにセッションが無いとき、そのアプリは自分でログイン画面を出さず、次の順で認証サーバーへ渡します。

```text
参加アプリ
  state を生成し __Host-handoff に保存
  ↓
認証サーバー GET /auth/handoff?app=&redirect_uri=&state=
  認証サーバーのセッションを検証
  Credential が 1 件以上
  AppGrant がある
  redirect_uri が App.redirectUris と完全一致
  ↓
sess:{appId}:{tokenHash} を作成し、ユーザー索引へ追加
handoff:{appId}:{codeHash} を作成（TTL 60 秒）
  ↓
redirect_uri?code=&state= へ 303
  ↓
参加アプリ
  __Host-handoff の state とクエリの state が一致
  handoff キーを GETDEL
  値の state、userId、redirectUri が一致
  __Host-session を発行
  __Host-handoff を削除
```

失敗時はセッションを作らず、Cookie も発行しません。コードの再利用は、キーが無いので拒否します。`redirect_uri` の不一致、`state` の不一致、`AppGrant` が無い場合も同じです。

戻り先の応答には `Referrer-Policy: no-referrer` と `Cache-Control: no-store` を付けます。コードが他ホストの Referer に載らないようにします。

## 6. リクエストごとの検証

参加アプリがセッションを解決する公開の入口は、アプリ ID を必須にします。権限確認を省いた解決は公開しません。

```text
__Host-session
  ↓
SHA-256
  ↓
GET sess:{appId}:{tokenHash}
  ↓
無し、または値の appId が一致しない → Cookie を削除し未認証
  ↓
PostgreSQL から User（id, email, name）と Credential 件数を取得
  ↓
Credential が 0 件 → 認証サーバーのパスキー設定へ誘導（TTL は延ばさない）
  ↓
AppGrant が無い → 403（TTL は延ばさない）
  ↓
EXPIRE sess:{appId}:{tokenHash} と Cookie の Max-Age を更新
  ↓
ユーザーと、そのアプリの permission で処理
```

権限を外した効果は、次のリクエストから効きます。セッションの作り直しは要りません。

GET と HEAD は状態を変えません。POST、PUT、PATCH、DELETE は、`Origin` がそのアプリの `App.origin` と完全一致するときだけ処理します。`Origin` が無い更新リクエストは拒否します。他オリジン向けの `Access-Control-Allow-Credentials` は返しません。ブラウザの API 呼び出しは同一オリジン（`credentials: 'same-origin'`）だけです。

## 7. ログアウトと全失効

| 操作 | 効果 |
|------|------|
| 参加アプリのログアウト | そのアプリの Cookie を削除し、`sess:{appId}:{tokenHash}` を DEL し、ユーザー索引からその要素を SREM する。他アプリのセッションは残す |
| 認証サーバーの「すべてのアプリからログアウト」 | ユーザー索引の全要素を削除し、認証サーバーの Cookie を削除する |
| パスワード再設定の完了、招待マジックリンク再送 | 現行仕様どおり全セッションを失効する。索引に参加アプリの要素も含まれるので、全アプリが対象になる |

全失効のあと、参加アプリに Cookie が残っていても、次の検証でキーが無く未認証になります。そのとき参加アプリは Cookie を削除します。

## 8. WebAuthn

パスキーのオプション発行と検証は認証サーバーだけが行います。

| 項目 | 仕様 |
|------|------|
| RP ID | 認証サーバーのホスト名（`WEBAUTHN_RP_ID`） |
| 検証する origin | 認証サーバーのオリジンだけ |
| 参加アプリ | WebAuthn のエンドポイントを持たない |

RP ID を親ドメインにしないので、他サブドメインは認証サーバー向けのパスキー認証を開始できません。

## 9. 実装の置き場所

セッション解決、Cookie の発行と削除、トークンハッシュ、`Origin` 検査の手続きは [participant-app.md](./participant-app.md) に書きます。共有パッケージは必須にしません。参加アプリは、その手続きを自分のプロセスで実装します。

公開するセッション解決は、アプリ ID を受け取り、セクション 6 の順で許可まで確認したものだけです。Redis の生クライアントを使った回避は、セクション 2 の ACL でセッション作成ができないようにします。

## 10. 環境変数

認証サーバーは [specification.md](../docs/specification.md) の環境変数に加え、自分を表す `App` 行の ID を持ちます。

参加アプリは次を持ちます。

| 変数 | 用途 |
|------|------|
| `APP_ID` | `App.id`。セッションキーと引き渡しキーのプレフィックス |
| `APP_ORIGIN` | このアプリのオリジン。`Origin` 検査に使う |
| `AUTH_ORIGIN` | 認証サーバーのオリジン。未ログイン時の誘導先 |
| `DATABASE_URL` | セクション 2 の参加アプリ用ロール |
| `REDIS_URL` | セクション 2 の参加アプリ用 ACL ユーザー |
| `REDIS_KEY_PREFIX` | 認証サーバーと同じ値 |
| `SESSION_MAX_AGE_SECONDS` | 認証サーバーと同じ値 |

参加アプリの一覧と戻り先 URL は環境変数にせず、`App` 行を正とします。

## 11. ローカル開発

Cookie はポートを区別しません。`localhost` の別ポートではホスト専用 Cookie が混ざります。開発ホストは `auth.localhost` と `app.localhost` のようにホスト名で分けます。

`__Host-` は `Secure` が必須です。ブラウザは `localhost` とそのサブドメインを安全なコンテキストとして扱うため、開発時の HTTPS 終端が無くてもこの Cookie を発行できます。

## 12. 必須事項

- セッション Cookie に `Domain` を付けない
- 引き渡しコードは 60 秒、`GETDEL` の単回、`state` と `redirect_uri` の完全一致
- `AppGrant` が無いユーザーにはセッションを作らず、既存セッションも TTL を延ばさない
- 参加アプリの Redis 権限に、セッションの SET と索引の SADD を含めない
- 更新リクエストは自オリジンの `Origin` だけを受ける
- パスキー儀式の origin は認証サーバーだけ
- 業務データの権限（投稿の所有者判定など）は、各アプリが `AppGrant` に加えて現行仕様どおり判定する

## 13. 残るリスク

参加アプリのサーバが侵害されると、そのアプリを開いたユーザーの生トークンがそのリクエストから見えます。攻撃者はそのアプリに対して、トークンの TTL が切れるまで再送できます。他アプリの Cookie は届かず、セッションの新規作成と `AppGrant` の変更は接続権限でできません。

あるアプリの XSS は、そのオリジンの中ではユーザーとして操作できます。他アプリの応答を読むことと、他アプリの更新は、セクション 6 の `Origin` 検査と CORS の制限で拒否します。

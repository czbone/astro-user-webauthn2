# 参加アプリ実装仕様

本ファイルは、参加アプリを作るための仕様です。認証サーバーとの共通契約は [multi-app-auth.md](./multi-app-auth.md) です。ログイン、パスキー、招待、マジックリンク、復旧は [specification.md](../docs/specification.md) と [session-management.md](../docs/session-management.md) に従い、参加アプリでは実装しません。

業務テーブルは置きません。画面は、ログイン中の利用者の表示と、`AppGrant.permission` による読み取りの差までです。

共有パッケージは使いません。本ファイルの手続きに従えば、別リポジトリでも同じ契約で実装できます。

## 1. 役割

参加アプリは自分のホスト専用セッションを検証し、認証サーバーが持つ `User`、`WebAuthnCredential`、`AppGrant` を参照してアクセスを決めます。PostgreSQL と Redis へ直接接続します。HTTP のイントロスペクションは呼びません。

| 行うこと | 行わないこと |
|----------|----------------|
| 未ログインの画面を認証サーバーの引き渡しへ送る | ログイン画面、パスキー儀式、ユーザー作成 |
| `/callback` で引き渡しコードを消費し、自ホストのセッション Cookie を発行する | セッションの Redis `SET`、ユーザー索引への `SADD` |
| リクエストごとにセッション、パスキー有無、`AppGrant` を確認する | `App` / `AppGrant` の作成・更新・削除 |
| 自分のログアウト | 他アプリのセッション削除、認証サーバーのログアウト |

パスキーの登録が終わるまで、認証サーバーは引き渡しを発行しません。参加アプリにセッションが届くのは、Credential が 1 件以上あり、このアプリの `AppGrant` があるユーザーだけです。その後にパスキーが消えた、または付与が外れた場合は、セクション 3 で扱います。

## 2. 画面

文言は日本語です。サーバーで HTML を描画します。ブラウザの API 呼び出しは同一オリジン（`credentials: 'same-origin'`）だけです。

| パス | 条件 | 内容 |
|------|------|------|
| `/` | `permission` が `admin` または `user` | 自分の email、name、permission。ログアウトのフォーム |
| `/grants` | `permission` が `admin` | このアプリの `AppGrant` 一覧。列は email、name、permission。並びは email の昇順。変更操作は置かない |
| `/grants` | `permission` が `user` | 403「この画面を利用する権限がありません」。`/` へのリンクを出す |
| `/callback` | 引き渡しの戻り | セクション 5。成功時は保存したパスへ 303 |
| `/logged-out` | セッション不要 | 「ログアウトしました」。再入場は `/` へのリンクだけ。このページから引き渡しを開始しない |
| 上記以外の画面 | セッションが無い | セクション 4 の引き渡しを開始する |
| 付与が無い | セッションはある | 403「このアプリを利用する権限がありません」。ログアウトだけできる。TTL は延ばさない |

permission の表示は、`admin` を「管理者」、`user` を「利用者」とします。

`/callback` と `/logged-out` は、セッションが無くても引き渡しを開始しません。コードが無い `/callback` は 400「引き渡しに失敗しました」です。

更新は `POST /logout` だけです。手順はセクション 8 です。

## 3. アクセス制御

公開する解決は、アプリ ID を必須にし、次の順で許可まで確認したものだけです。権限確認を省いた解決は出しません。

```text
__Host-session
  ↓
SHA-256（hex 小文字）
  ↓
GET sess:{APP_ID}:{tokenHash}
  ↓
無し、JSON でない、値の appId が APP_ID と違う
  → Cookie を削除。キーがあるときは DEL。userId があれば索引から SREM。未認証
  ↓
User を id で取得（id, email, name だけ）
  ↓
行が無い → セッションを DEL し、索引から SREM し、Cookie を削除。未認証
  ↓
WebAuthnCredential の件数
  ↓
0 件 → TTL も Cookie も延ばさない
        画面は AUTH_ORIGIN/setup-passkey へ 302
        更新は 403「先にパスキーを登録してください」
  ↓
AppGrant（userId, APP_ID）
  ↓
行が無い、または permission が admin / user 以外
  → 403「このアプリを利用する権限がありません」
    Cookie は残す。TTL も Cookie の Max-Age も延ばさない
    ログアウトだけ通す
  ↓
EXPIRE sess:{APP_ID}:{tokenHash} と Cookie の Max-Age を更新
  ↓
permission で画面を分ける
```

未認証の画面はセクション 4 へ進みます。未認証の更新は 401「ログインが必要です」とし、引き渡しへは送りません。

`User.role` は読みません。認証サーバー上の権限であり、参加アプリの画面権限には使いません。`User.password`、パスキーの公開鍵、カウンタ、`credentialId`、`transports` も読みません。

付与を外した効果は、次のリクエストから効きます。セッションの作り直しは要りません。`permission` の変更も同じです。変更できるのは認証サーバーの管理画面だけです。

`/grants` の拒否は、上の流れで付与が有効だったあとに行います。`user` が `/grants` を開いたときも、セッションの TTL は延ばします。

GET と HEAD は状態を変えません。ただしセクション 6 の成功時の `EXPIRE` と、失効した Cookie の削除は行います。POST、PUT、PATCH、DELETE は、`Origin` が `APP_ORIGIN` と完全一致するときだけ処理します。`Origin` が無い、または一致しない更新は 403「オリジンが不正です」です。他オリジン向けの `Access-Control-Allow-Credentials` は返しません。

### 参照する SQL

接続ロールはセクション 10 の列権限だけを持ちます。

```sql
SELECT id, email, name FROM "User" WHERE id = $1

SELECT COUNT(id) FROM "WebAuthnCredential" WHERE "userId" = $1

SELECT permission FROM "AppGrant" WHERE "userId" = $1 AND "appId" = $2

SELECT u.email, u.name, g.permission
FROM "AppGrant" g
JOIN "User" u ON u.id = g."userId"
WHERE g."appId" = $1
ORDER BY u.email ASC
```

最後の一覧は、解決済みの `permission` が `admin` のときだけ実行します。

### 業務テーブルを後から足すとき

テーブルは参加アプリの所有です。共有の `User` や `Post` には書きません。入場条件は本セクションのままです。

閲覧範囲は `AppGrant.permission` で分けます。認証サーバーの投稿と同じです。

- `user` は、公開された行と、自分の行を読む
- `admin` は、他者の非公開行も含めて読む
- 書き込みは、`admin` でも本人の行だけ

判定に `User.role` は使いません。本ファイルでは投稿機能は移しません。

## 4. 引き渡しの開始

セッションが必要な画面で未認証のとき、参加アプリはログイン画面を出さず、次を行います。

1. `state` を作る。暗号学的乱数 32 バイトを base64url にした文字列です。認証サーバーは `^[\w.~-]{1,128}$` だけを受けます。
2. 戻り先パスを決める。今の GET / HEAD のパスとクエリです。`/` で始まり、`//` と `/\` では始まらず、バックスラッシュと制御文字を含まないものだけを使います。それ以外は `/` です。`/callback` と `/logged-out` は `/` にします。
3. `__Host-handoff` を発行する。値は次の JSON です。

```json
{"state":"<state>","returnPath":"/grants"}
```

4. 次の URL へ 302 する。`redirect_uri` は `APP_ORIGIN` とパス `/callback` を連結した文字列で、`?` と `#` を含めません。

```text
{AUTH_ORIGIN}/auth/handoff?app={APP_ID}&redirect_uri={urlencode(APP_ORIGIN/callback)}&state={urlencode(state)}
```

Cookie の属性はセクション 7 です。

認証サーバーは、セッションが無いブラウザを自分のログインへ送ったあと、同じ引き渡し URL に戻します。Credential が 0 件のセッションは `/setup-passkey` に留め、コードを発行しません。アプリ未登録、`redirect_uri` の不一致、`AppGrant` が無い場合は、認証サーバーが 403「引き渡し先のアプリを利用できません」を返し、参加アプリへは戻りません。

## 5. コールバック

`GET /callback?code=&state=` を `App.redirectUris` に登録します。応答には `Cache-Control: no-store` と `Referrer-Policy: no-referrer` を付けます。

成功する条件はすべて満たすときだけです。`state` と `redirectUri` の比較は定数時間で行います。一つでも欠ければセッション Cookie を発行せず、`__Host-handoff` を削除し、400「引き渡しに失敗しました」を返します。引き渡しの再開始は、そのページのリンクからにします。

1. クエリの `code` と `state` がある。`state` は `^[\w.~-]{1,128}$` に一致する
2. `__Host-handoff` の JSON が読め、その `state` とクエリの `state` が一致する
3. `code` の SHA-256（hex 小文字）で `handoff:{APP_ID}:{codeHash}` を `GETDEL` する。値が無いときは失敗（期限切れ、再利用、別アプリ）
4. 値の `state` がクエリの `state` と一致する
5. 値の `redirectUri` が `APP_ORIGIN/callback` と完全一致する
6. 値の `userId` と `token` が空でない
7. `GET sess:{APP_ID}:{sha256(token)}` が存在し、値の `userId` が引き渡しの `userId` と一致し、値の `appId` が `APP_ID` と一致する

成功時は、値の `token` をそのまま `__Host-session` に入れます。参加アプリは新しいセッショントークンを作りません。`__Host-handoff` を削除し、保存していた `returnPath` へ 303 します。この応答では `EXPIRE` しません。延長は、続くリクエストのセクション 3 が付与を確認したあとです。

生トークンと `code` はログに残しません。

## 6. セッションの延長

セクション 3 でパスキーがあり、`AppGrant.permission` が `admin` または `user` のときだけ、次を行います。

- `EXPIRE sess:{APP_ID}:{tokenHash} SESSION_MAX_AGE_SECONDS`
- `__Host-session` の Max-Age を同じ秒数で再設定する。トークンの値は変えません

ユーザー索引 `sess:user:{userId}` の `EXPIRE` は行いません。参加アプリの Redis 権限に含まれません。索引からの削除はログアウト時の `SREM` だけです。

認証サーバーのページ解決が付与確認より先に TTL を延ばす実装があっても、参加アプリはセクション 3 の順に従います。

## 7. Cookie

両方ともホスト専用です。`Domain` は付けません。

| 項目 | `__Host-session` | `__Host-handoff` |
|------|------------------|------------------|
| 値 | 引き渡しで受け取った生トークン | セクション 4 の JSON |
| 属性 | `Secure`、`HttpOnly`、`SameSite=Lax`、`Path=/` | 同じ |
| Max-Age | `SESSION_MAX_AGE_SECONDS`（既定 2592000） | 300 |

削除は、同じ名前と属性で Max-Age を 0 にします。

## 8. ログアウト

`POST /logout` だけです。`Origin` が `APP_ORIGIN` と完全一致するときだけ処理します。

セッションがあるときは、次を行います。

- `DEL sess:{APP_ID}:{tokenHash}`
- `SREM sess:user:{userId} {APP_ID}/{tokenHash}`

`__Host-session` と `__Host-handoff` を削除し、`/logged-out` へ 303 します。他アプリのセッションは残します。認証サーバーのログアウトは呼びません。

## 9. 環境変数

| 変数 | 用途 |
|------|------|
| `APP_ID` | `App.id`。小文字・数字・ハイフンの 1〜32 文字。セッションキーと引き渡しキーのプレフィックス |
| `APP_ORIGIN` | このアプリのオリジン。スキーム、ホスト、ポートまで。パスは含めない。`Origin` 検査と `redirect_uri` に使う |
| `AUTH_ORIGIN` | 認証サーバーのオリジン。引き渡しとパスキー設定への誘導先 |
| `DATABASE_URL` | セクション 10 の参加アプリ用ロール |
| `REDIS_URL` | セクション 10 の参加アプリ用 ACL ユーザー |
| `REDIS_KEY_PREFIX` | 認証サーバーと同じ値。実際のキーは `{REDIS_KEY_PREFIX}{論理キー}` |
| `SESSION_MAX_AGE_SECONDS` | 認証サーバーと同じ値。未設定時は 2592000 |

`APP_ID` は認証サーバー自身の `App.id` とは別です。参加アプリの一覧と戻り先 URL は環境変数にせず、`App` 行を正とします。

起動前に、認証サーバーの管理者がこのアプリの `App` を登録します。

| 列 | 値 |
|----|-----|
| `id` | `APP_ID` |
| `origin` | `APP_ORIGIN` と完全一致 |
| `redirectUris` | `APP_ORIGIN/callback` を含む。各要素のオリジンは `origin` と一致し、`?` と `#` を含まない |

利用者ごとに `AppGrant` を付けます。行が無いユーザーは使えません。seed 管理者にも自動では付きません。

## 10. 接続権限

PostgreSQL のひな型は [participant-access.sql](./participant/participant-access.sql) です。Redis の ACL は [redis.md](../docs/redis.md) です。

| 対象 | 許す操作 |
|------|----------|
| `User` | `id`、`email`、`name` の `SELECT` |
| `WebAuthnCredential` | `id` と `userId` の `SELECT`（件数のみ） |
| `App`、`AppGrant` | `SELECT` |
| `sess:{APP_ID}:*` | `GET`、`EXPIRE`、`DEL` |
| `handoff:{APP_ID}:*` | `GET`、`GETDEL`、`DEL` |
| `sess:user:*` | `SREM` |

`password`、`role`、`publicKey`、`counter`、`credentialId`、`transports` は与えません。セッションの `SET` と、ユーザー索引への `SADD` も与えません。コードの消費は `GETDEL` です。`GET` のあとに `DEL` する実装にはしません。

## 11. ローカル開発

開発の親ドメインは `localhost`、参加アプリのホストは `app.localhost` です。`APP_ORIGIN` の例は `http://app.localhost:4000`、戻り先は `http://app.localhost:4000/callback` です。`localhost` の別ポートではホスト専用 Cookie が混ざるため、ホスト名で分けます。

`__Host-` は `Secure` が必須です。ブラウザは `localhost` とそのサブドメインを安全なコンテキストとして扱うため、開発時の HTTPS 終端が無くてもこの Cookie を発行できます。

本番以外では、`APP_ORIGIN` のホスト以外への GET / HEAD を、同じパスの `APP_ORIGIN` へ 302 します。

## 12. 必須事項

- セッション Cookie に `Domain` を付けない
- 引き渡しコードは 60 秒、`GETDEL` の単回、`state` と `redirect_uri` の完全一致
- セッション Cookie の値は、引き渡し JSON の `token` だけ
- `AppGrant` が無いユーザーには、既存セッションの TTL を延ばさない
- 画面の権限は `AppGrant.permission` だけを見る
- 更新リクエストは自オリジンの `Origin` だけを受ける
- ログアウト後の完了画面から、引き渡しを自動では開始しない
- パスキー儀式の origin は認証サーバーだけ

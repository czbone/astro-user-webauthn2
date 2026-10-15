# 参加アプリ

本ファイルでは、利用許可に関して参加アプリが担う処理を定めます。実効許可の判定には、[grant.md](grant.md) の手順だけを使います。引き渡しコードの消費、Cookie、ログアウト、オリジン検査は、認証サーバーの [participant-app.md](https://github.com/czbone/astro-user-webauthn2/blob/main/planning/participant-app.md) に従います。

参加アプリは `App` と `AppGrant` を参照しますが、行の作成、既定の変更、マイグレーションは行いません。

## アクセス可否の確認

画面の表示や更新処理の前に、セッション、ユーザーの有効状態、パスキー、実効許可の順で確認します。入場の可否に `User.role` は使いません。入場後の管理操作とアプリ内ロール管理では、`User.role` を読み取ります。

```text
__Host-session の値を取得する
  ↓
SHA-256 でハッシュ化する（16進数の小文字）
  ↓
セッションを取得する（GET sess:{APP_ID}:{tokenHash}）
  ↓
キーがない、JSON ではない、値の appId が APP_ID と異なる
  → Cookie を削除する。セッションキーがあれば削除する（DEL）。userId があれば、ユーザー索引からこのセッションを外す（SREM）。未認証として扱う
  ↓
User を id で取得する（id、email、name、role、disabledAt）
  ↓
User の行がない、または disabledAt がある → セッションを削除し（DEL）、ユーザー索引からこのセッションを外し（SREM）、Cookie を削除する。未認証として扱う
  ↓
パスキー（WebAuthnCredential）の件数を確認する
  ↓
0 件 → セッションの有効期限（TTL）も Cookie の Max-Age も延長しない
        画面リクエストは AUTH_ORIGIN/setup-passkey へリダイレクトする（302）
        更新リクエストには 403「先にパスキーを登録してください」を返す
  ↓
grant.md の手順で実効許可を判定する
  ↓
付与なし
  → 403「このアプリを利用する権限がありません」を返す
    Cookie は残す。セッションの有効期限（TTL）と Cookie の Max-Age は延長しない
    ログアウトだけは許可する
  ↓
allow
  → 画面のリクエストでは、セッションの有効期限を延長し（EXPIRE）、Cookie の Max-Age を更新する
```

未認証の画面リクエストでは引き渡しを開始します。未認証の更新リクエストには 401「ログインが必要です」を返し、引き渡しは開始しません。

入場できたあとの操作は、次で分けます。クライアントが送ったロール名は使いません。

- 業務操作は、このアプリが `User.id` に割り当てたアプリ内ロールで判定する。ロール定義は当初、固定設定としてよい
- 共通 `admin` は、アプリ内ロールがなくても管理操作ができる。業務ロールは自動では付かない
- 共通 `manager` は、アプリ内ロールの割り当て・変更・解除だけができる。`manager` だけでは業務操作はできない
- 利用許可が `allow` でない利用者は、共通ロールがあってもこのアプリでは操作できない。引き渡し自体が拒否される

## 画面

文言は日本語です。`/` は、入場できた利用者に email、name、共通ロールを出します。利用許可の表示は「利用可」です。

アプリ内ロールの管理画面は、共通ロールが `admin` または `manager` の場合に限り表示します。それ以外の場合は 403「この画面を利用する権限がありません」を返し、`/` へのリンクを表示します。この場合も、入場が `allow` であればセッションの TTL を延長します。

利用許可の例外一覧は、共通ロールが `admin` の場合に限り表示します。列はメールアドレス、名前、利用許可とし、メールアドレスの昇順に並べます。`allow` は「利用可」、`none` は「利用不可」と表示します。既定値が `allow` の場合は「全利用者に利用を許可」、`NULL` の場合は「利用を許可しない（個別のみ）」と表示します。変更操作は認証サーバーの管理画面に置きます。

## 参照する SQL

実効許可は次の二つのクエリで判定します。`App` の行がない場合は付与なしです。`AppGrant` の行がある場合はその `permission` を、ない場合は `defaultPermission` を [grant.md](grant.md) の手順に渡します。

```sql
SELECT "defaultPermission" FROM "App" WHERE id = $1

SELECT permission
FROM "AppGrant"
WHERE "userId" = $1 AND "appId" = $2
```

利用許可の例外一覧は、共通ロールが `admin` の場合にだけ取得します。既定の取得には上記の最初のクエリを使い、行の一覧は次のクエリで取得します。ユーザーの取得には `role` と `disabledAt` も含めます。

```sql
SELECT u.email, u.name, g.permission
FROM "AppGrant" g
JOIN "User" u ON u.id = g."userId"
WHERE g."appId" = $1
ORDER BY u.email ASC
```

データベース接続に使用するロールには、`App` と `AppGrant` の参照権限（`SELECT`）に加え、`User` の `id`、`email`、`name`、`role`、`disabledAt` の参照権限を与えます。`User.password` とパスキーの公開鍵情報への参照権限は与えません。認証サーバー自身は参加アプリとしてこの確認を行わず、自身の管理操作は共通ロールで認可します。

アプリ内ロールは、このアプリのデータベースに `User.id` をキーとして置きます。認証サーバーの `AppGrant` には書きません。`allow` 以外の文字列は、行または既定にあっても付与なしです。

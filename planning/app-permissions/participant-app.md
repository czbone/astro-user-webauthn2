# 参加アプリ

本ファイルは、利用権限について参加アプリが行うことです。実効権限は [grant.md](grant.md) の手順だけを使います。引き渡しの消費、Cookie、ログアウト、オリジン検査は、認証サーバーの [participant-app.md](https://github.com/czbone/astro-user-webauthn2/blob/main/planning/participant-app.md) のとおりです。

参加アプリは `App` と `AppGrant` を参照します。行の作成、既定の変更、マイグレーションはしません。

## 解決

画面と更新の前に、セッション、パスキー、実効権限の順で確認します。`User.role` は読みません。

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
grant.md の実効権限
  ↓
付与なし
  → 403「このアプリを利用する権限がありません」
    Cookie は残す。TTL も Cookie の Max-Age も延ばさない
    ログアウトだけ通す
  ↓
正の権限
  → 画面では EXPIRE と Cookie の Max-Age を更新し、その権限で描く
```

未認証の画面は引き渡しを始めます。未認証の更新は 401「ログインが必要です」で、引き渡しへは送りません。

`/grants` を下位の権限で拒否するのは、実効権限が正の権限だったあとです。この拒否では TTL を延ばします。

## 画面

文言は日本語です。表示は次です。

| 実効権限 | `/` の表示 | 開く画面 |
| --- | --- | --- |
| `admin` | 管理者 | `/` と `/grants`。下位に開く画面も開く |
| `user` | 利用者 | `/` |
| 追加された正の権限 | 追加時に定めた表示 | `/` と、追加時に開くと定めた画面 |
| 付与なし | 画面に権限は出さない | 403「このアプリを利用する権限がありません」 |

「付与一覧」のリンクは、実効権限が `admin` のときだけ出します。

`/grants` は、実効権限が `admin` のときだけ読みます。それ以外の正の権限は 403「この画面を利用する権限がありません」で、`/` へのリンクを出します。

一覧の先頭に、そのアプリの既定を出します。

| 既定 | 表示 |
| --- | --- |
| 正の権限 | その権限の表示名 |
| `NULL` | 個別に付与した人だけ |
| 正の権限でない値 | 設定エラー。既定からは付与しない |

続けて `AppGrant` の行を出します。列はメールアドレス、名前、権限で、メールアドレスの昇順です。既定だけで入っている利用者は出しません。行が無いときは「例外の付与はありません」です。`none` の表示は「利用不可」です。変更操作は置きません。

## 参照する SQL

実効権限は次の二つで判定します。`App` の行が無いときは付与なしです。`AppGrant` の行があるときはその `permission` を、無いときは `defaultPermission` を、[grant.md](grant.md) の手順に渡します。

```sql
SELECT "defaultPermission" FROM "App" WHERE id = $1

SELECT permission
FROM "AppGrant"
WHERE "userId" = $1 AND "appId" = $2
```

付与一覧は、実効権限が `admin` のときだけ読みます。既定は上の一つ目です。行の一覧は次です。

```sql
SELECT u.email, u.name, g.permission
FROM "AppGrant" g
JOIN "User" u ON u.id = g."userId"
WHERE g."appId" = $1
ORDER BY u.email ASC
```

接続ロールは `App` と `AppGrant` の `SELECT` を持ちます。`defaultPermission` は `App` の参照列に含めます。`User.role` は与えません。認証サーバー自身は参加アプリとしてこのアクセス解決を行わず、管理操作を `User.role` で認可します。

## 権限を足すとき

正の権限を [grant.md](grant.md) の一覧に足した変更で、次を決めます。

- `/` に出す日本語の表示名
- その権限で開く画面。定めていない画面はその権限では開かない
- `admin` は、`admin` に定めた画面と、下位のどれかに定めた画面を開く

一覧へ足す前の文字列は、行にあっても既定にあっても付与なしのままです。

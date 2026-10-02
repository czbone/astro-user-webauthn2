# Redis 仕様

セッションと短命データの Redis ストア設計です。セッションの振る舞い（Cookie・スライディング・失効）は [session-management.md](./session-management.md) を参照してください。

## 役割

| ストア | 対象 |
|--------|------|
| PostgreSQL | `User`, `WebAuthnCredential`, `Post`, `App`, `AppGrant` |
| Redis | Session、WebAuthn challenge / reauth-ok、Rate limit、DeviceInvite、PasswordReset、MagicLink |

クライアントは `ioredis` を想定し、接続はプロセス内シングルトンとする（開発時の HMR では `globalThis` 再利用を推奨）。

## 環境変数

| 変数 | 必須 | デフォルト | 用途 |
|------|------|------------|------|
| `REDIS_URL` | 本番必須 | `redis://localhost:6379/` | 接続 URL |
| `REDIS_KEY_PREFIX` | 任意 | （空） | 全キーの先頭に付与する prefix（共有 Redis・環境分離用） |
| `SESSION_MAX_AGE_SECONDS` | 任意 | `2592000` | セッション TTL（秒）。Cookie Max-Age と一致させる |

ローカル起動時は Redis が利用可能であること（例: ローカルインストールまたは Docker）。`REDIS_URL` 未設定時の開発既定は `redis://localhost:6379/`。

実際の Redis キーは `{REDIS_KEY_PREFIX}{論理キー}` とする。以下の表記は論理キー（prefix 未適用）を指す。

## キー命名と TTL

| 論理キー | 型 | TTL | 用途 |
|----------|-----|-----|------|
| `sess:{appId}:{tokenHash}` | string (JSON) | `SESSION_MAX_AGE_SECONDS`（既定 30 日） | セッション本体 |
| `sess:user:{userId}` | set | 本体に合わせて維持 | ユーザーの `{appId}/{tokenHash}` 一覧（全失効用） |
| `handoff:{appId}:{codeHash}` | string (JSON) | 60 秒 | 参加アプリへの引き渡し。単回使用。消費は `GETDEL` |
| `chal:{kind}:{userId}` | string (JSON) | 300 秒 | WebAuthn challenge（userId 付き） |
| `chal:{kind}:{challenge}` | string (JSON) | 300 秒 | userId なしの challenge |
| `chal:auth-challenge:{challenge}` | string (JSON) | 300 秒 | auth 用逆引き |
| `rl:{logicalKey}` | string (カウンタ) | ウィンドウ秒数 | レート制限 |
| `invite:{tokenHash}` | string (JSON) | 3600 秒 | デバイス招待 |
| `invite:user:{userId}` | set | 本体に合わせて維持 | 未使用招待の一括無効化 |
| `reset:{tokenHash}` | string (JSON) | 3600 秒 | パスワード再設定 |
| `reset:user:{userId}` | set | 本体に合わせて維持 | 未使用再設定の一括無効化 |
| `magic:{tokenHash}` | string (JSON) | 3600 秒 | 招待マジックリンク |
| `magic:user:{userId}` | set | 本体に合わせて維持 | 未使用マジックリンクの一括無効化 |

`tokenHash` はいずれも生トークンの SHA-256（hex 等、アプリ内で統一したエンコード）。

## Session

### 値

```json
{
  "id": "<uuid>",
  "userId": "<uuid>",
  "appId": "<appId>",
  "createdAt": "<ISO8601>"
}
```

ユーザースナップショットは載せない。認証解決時は `userId` で PostgreSQL から User を取得する。

### 操作

| 操作 | Redis |
|------|-------|
| 作成 | `SET sess:{appId}:{tokenHash} JSON EX ttl` + `SADD sess:user:{userId} {appId}/{tokenHash}`（索引 SET にも適切な TTL を付与または更新） |
| 検証成功 | パスキーがあり、必要な `AppGrant` があるときだけ `EXPIRE sess:{appId}:{tokenHash} ttl` + Cookie Max-Age 再設定 |
| ログアウト | `DEL sess:{appId}:{tokenHash}` + `SREM sess:user:{userId} {appId}/{tokenHash}` |
| 全失効 | `SMEMBERS sess:user:{userId}` → 各 `DEL sess:{appId}:{hash}` → `DEL sess:user:{userId}` |

キー不存在または TTL 切れは未認証とみなす。明示的な `revokedAt` は持たない。

## WebAuthn challenge / reauth-ok

値:

```json
{
  "challenge": "<string>",
  "userId": "<uuid | optional>",
  "kind": "<string>"
}
```

- `kind` 例: `reg`, `auth`, `reauth`, `reauth-ok`
- `save` は `SET` + `EX 300`
- `auth` は userId キー（`chal:auth:{userId}`）と `chal:auth-challenge:{challenge}` の二重登録
- `take*` は GET のあと DEL（消費型）。auth は関連キーを両方削除
- `reauth-ok` も同じストア（`kind=reauth-ok`）

## Rate limit

固定ウィンドウ方式。

- キー例: `rl:pwd:{ip}:{email}`, `rl:method:{ip}:{email}`, `rl:reset:{ip}:{email}`, `rl:magic:{ip}`, `rl:magic-resend:{ip}:{email}`
- `INCR`。カウンタが 1 のときだけ `PEXPIRE` でウィンドウのミリ秒を設定
- 制限値（現行どおり）:
  - password: 10 / 15 分
  - method: 30 / 15 分
  - reset: 5 / 15 分
  - magic consume: 10 / 15 分
  - magic resend: 5 / 15 分
- 超過時は `PTTL` から `retryAfterSec` を算出

## DeviceInvite / PasswordReset / MagicLink

値:

```json
{
  "id": "<uuid>",
  "userId": "<uuid>",
  "createdAt": "<ISO8601>"
}
```

| 操作 | 挙動 |
|------|------|
| 発行 | 本体 `SET ... EX 3600` + ユーザー索引へ `SADD` |
| 検証 | `GET`。無し / TTL 切れは無効 |
| 使用済み | 本体キー削除 + 索引から `SREM`（`usedAt` は持たない） |
| 未使用の一括無効化 | 索引 SET の全要素を削除し、索引自体も削除 |

メール内リンクのトークン可用性は Redis のデータ存続に依存する。Redis の再起動や永続化なしの消失では、未使用の招待・再設定・マジックリンクトークンは無効になる。

## 障害時の挙動

| 状況 | 期待挙動 |
|------|----------|
| Redis 接続不可 | セッション発行・検証、challenge、レート制限、招待・再設定・マジックリンクが失敗する。認証系 API は 5xx またはサービス不可として扱う |
| セッションキー消失 | 当該リクエストは未認証。再ログインが必要 |
| 招待・再設定・マジックリンクキー消失 | リンク無効。再発行が必要 |
| PostgreSQL のみ障害 | セッションキーがあっても User 解決に失敗し認証不可 |

Redis は可用性の単一障害点になる。本番では永続化（AOF / RDB）と監視を推奨する。

## ローカル開発

1. Redis を起動する（例: `redis-server` または Docker で `6379` を公開）
2. `.env` に `REDIS_URL=redis://localhost:6379/` を設定（未設定時も同既定を使用可）
3. 必要なら `REDIS_KEY_PREFIX` で他プロジェクトとキー空間を分離する

## 参加アプリの接続権限

参加アプリは自分の業務テーブルだけを書き、共有データは参照します。認証サーバーのプロセスは、これまでどおり読み書きできるロールで接続します。

PostgreSQL では、参加アプリ用ロールに次の `SELECT` だけを与えます。`User.password`、`User.role`、パスキーの公開鍵・カウンタ・`credentialId`・`transports` は与えません。手順のひな型は [planning/participant/participant-access.sql](../planning/participant/participant-access.sql) です。

- `User` の `id`、`email`、`name`
- `WebAuthnCredential` の `id`、`userId`（件数用。`SELECT COUNT(id)`）
- `App`、`AppGrant` の全列

このログインロールは、管理者が認証サーバーと同じデータベースへ一度だけ作成します。ひな型の `CREATE ROLE` と `GRANT` はコメントアウトされているので、データベース名とパスワードを置き換えてから実行します。認証サーバーの起動処理、Prisma のマイグレーション、参加アプリは、このコマンドを実行しません。

ロール名の例は `app_participant` です。列権限は参加アプリに共通なので、アプリを増やすたびにロールは作りません。各参加アプリの `DATABASE_URL` には、このロールで同じデータベースへ接続する文字列を設定します。

```text
DATABASE_URL="postgresql://app_participant:replace-me@localhost:5432/database_name?schema=public"
```

`replace-me` は `CREATE ROLE` で決めたパスワードです。`database_name` は認証サーバーの `DATABASE_URL` と同じデータベース名です。認証サーバーの `DATABASE_URL` は、読み書きできる既存のユーザーのままにします。

共有テーブル（`User`、`WebAuthnCredential`、`App`、`AppGrant`、認証サーバーの `Post`）のマイグレーションは認証サーバーだけが行います。参加アプリ用ロールは `SELECT` だけなので、この接続ではテーブルを作成しません。アプリ固有のテーブルを書き始めるときは、そのテーブルへの書き込みをそのアプリのロールだけに与えます。

Redis ACL は、`REDIS_KEY_PREFIX` を含めたプレフィックス単位にします。ACL ユーザーはアプリごとに作成します。参加アプリ `{appId}` に許すコマンドは次だけです。

- `sess:{appId}:*` の GET、EXPIRE、DEL
- `handoff:{appId}:*` の GET、GETDEL、DEL
- `sess:user:*` の SREM

セッションの SET と、ユーザー索引への SADD は与えません。引き渡しコードの消費は `GETDEL` です。例（プレフィックスが空のとき）:

```text
ACL SETUSER app_posts on >password ~sess:posts:* +get +expire +del ~handoff:posts:* +get +getdel +del ~sess:user:* +srem
```

`REDIS_KEY_PREFIX` があるときは、各パターンの先頭にそのプレフィックスを付けます。

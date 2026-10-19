# Redis 仕様

セッションと有効期間の短いデータを保存する Redis の設計です。セッションの動作（Cookie、スライディング更新、失効）については、[session-management.md](./session-management.md) を参照してください。

## 役割

| ストア | 対象 |
|--------|------|
| PostgreSQL | `User`, `WebAuthnCredential`, `App`, `AppGrant` |
| Redis | Session、WebAuthn challenge / reauth-ok、Rate limit、DeviceInvite、PasswordReset、MagicLink、EmailChange |

クライアントには `ioredis` を想定し、接続はプロセス内のシングルトンとします。開発時の HMR では `globalThis` を再利用することを推奨します。

## 環境変数

| 変数 | 必須 | デフォルト | 用途 |
|------|------|------------|------|
| `REDIS_URL` | 本番必須 | `redis://localhost:6379/` | 接続 URL |
| `REDIS_KEY_PREFIX` | 任意 | （空） | 全キーの先頭に付与する prefix（共有 Redis・環境分離用） |
| `SESSION_MAX_AGE_SECONDS` | 任意 | `2592000` | セッション TTL（秒）。Cookie Max-Age と一致させる |

ローカルで起動する場合は、Redis が利用可能である必要があります（ローカルへのインストールまたは Docker の利用など）。`REDIS_URL` が未設定の場合、開発時は `redis://localhost:6379/` に接続します。

実際の Redis キーは `{REDIS_KEY_PREFIX}{論理キー}` です。以下では、prefix 適用前の論理キーを記載します。

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
| `emailchg:{tokenHash}` | string (JSON) | 3600 秒 | メールアドレス変更。受信済みでも確定まで残す |
| `emailchg:user:{userId}` | set | 本体に合わせて維持 | 対象ユーザーの未使用変更 |
| `emailchg:addr:{email}` | string | 3600 秒 | 手続き中アドレスからトークンハッシュへの索引 |
| `emailchg:users` | set | 手続きが残る間 | 手続き中ユーザー ID の一覧 |

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

ユーザースナップショットは載せない。利用許可も `User.role` も載せない。認証解決時は `userId` で PostgreSQL から User を取得する。参加アプリの入場は、セッションではなくリクエスト時の実効許可で決める。`disabledAt` があるユーザーのセッションは、解決時に全件破棄する。

### 操作

| 操作 | Redis |
|------|-------|
| 作成 | `SET sess:{appId}:{tokenHash} JSON EX ttl` + `SADD sess:user:{userId} {appId}/{tokenHash}`（索引 SET にも適切な TTL を付与または更新） |
| 検証成功 | 認証サーバーではパスキーがあり、無効でないときだけ `EXPIRE sess:{appId}:{tokenHash} ttl` + Cookie Max-Age 再設定。入場に `AppGrant` は使わない。引き渡しは実効許可が `allow` のときだけ参加アプリのセッションを作り、付与なしのときは認証サーバーの TTL も延ばさない |
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

- キー例: `rl:pwd:{ip}:{email}`, `rl:method:{ip}:{email}`, `rl:reset:{ip}:{email}`, `rl:magic:{ip}`, `rl:magic-resend:{ip}:{email}`, `rl:emailchg:{ip}:{userId}`, `rl:emailchg-verify:{ip}`, `rl:emailchg-commit:{ip}:{actorUserId}`
- `INCR`。カウンタが 1 のときだけ `PEXPIRE` でウィンドウのミリ秒を設定
- 制限値（現行どおり）:
  - password: 10 / 15 分
  - method: 30 / 15 分
  - reset: 5 / 15 分
  - magic consume: 10 / 15 分
  - magic resend: 5 / 15 分
  - email change request: 5 / 15 分
  - email change verify: 10 / 15 分
  - email change commit: 10 / 15 分
- 超過時は `PTTL` から `retryAfterSec` を算出

## DeviceInvite / PasswordReset / MagicLink / EmailChange

値:

```json
{
  "id": "<uuid>",
  "userId": "<uuid>",
  "createdAt": "<ISO8601>"
}
```

EmailChange の値には、確定前の新しいメールアドレスと受信確認時刻を含めます。未確認の場合、`verifiedAt` は `null` です。

```json
{
  "id": "<uuid>",
  "userId": "<uuid>",
  "email": "<new email>",
  "createdAt": "<ISO8601>",
  "verifiedAt": null
}
```

| 操作 | 挙動 |
|------|------|
| 発行 | 本体 `SET ... EX 3600` + ユーザー索引へ `SADD` |
| 検証 | `GET`。無し / TTL 切れは無効 |
| 使用済み | 本体キー削除 + 索引から `SREM`（`usedAt` は持たない） |
| 未使用の一括無効化 | 索引 SET の全要素を削除し、索引自体も削除 |
| EmailChange の受信確認 | `verifiedAt` を記録する。本体キーとアドレス索引は残す。TTL は発行時の残り時間を超えて延ばさない |
| EmailChange の確定・再申請 | 本体、ユーザー索引、アドレス索引を削除する |

メール内リンクのトークン可用性は Redis のデータ存続に依存する。Redis の再起動や永続化なしの消失では、未使用の招待・再設定・マジックリンク・メール変更トークンは無効になる。

メールアドレス変更の確定用再認証は `chal:emailchg-reauth:{userId}` と `chal:emailchg-reauth-ok:{userId}` を使う。デバイス招待の `reauth` / `reauth-ok` とは別キーであり、流用できない。

## 障害時の挙動

| 状況 | 期待挙動 |
|------|----------|
| Redis 接続不可 | セッション発行・検証、challenge、レート制限、招待・再設定・マジックリンク・メール変更が失敗する。認証系 API は 5xx またはサービス不可として扱う |
| セッションキー消失 | 当該リクエストは未認証。再ログインが必要 |
| 招待・再設定・マジックリンク・メール変更キー消失 | リンク無効。再発行が必要 |
| PostgreSQL のみ障害 | セッションキーがあっても User 解決に失敗し認証不可 |

Redis は可用性の単一障害点になる。本番では永続化（AOF / RDB）と監視を推奨する。

## ローカル開発

1. Redis を起動する（例: `redis-server` または Docker で `6379` を公開）
2. `.env` に `REDIS_URL=redis://localhost:6379/` を設定（未設定時も同既定を使用可）
3. 必要なら `REDIS_KEY_PREFIX` で他プロジェクトとキー空間を分離する

## 参加アプリの接続権限

参加アプリは自分の業務テーブルだけを書き、共有データは参照します。認証サーバーのプロセスは、これまでどおり読み書きできるロールで接続します。

PostgreSQL では、参加アプリ用ロールに次の `SELECT` だけを与えます。`User.password`、パスキーの公開鍵・カウンタ・`credentialId`・`transports` は与えません。`User.role` と `User.disabledAt` は、入場後の認可に必要なので与えます。手順のひな型は [planning/participant/participant-access.sql](../planning/participant/participant-access.sql) です。

- `User` の `id`、`email`、`name`、`role`、`disabledAt`
- `WebAuthnCredential` の `id`、`userId`（件数用。`SELECT COUNT(id)`）
- `App`（`defaultPermission` を含む）、`AppGrant` の全列

このログインロールは、管理者が認証サーバーと同じデータベースへ一度だけ作成します。ひな型の `CREATE ROLE` と `GRANT` はコメントアウトされているので、データベース名とパスワードを置き換えてから実行します。認証サーバーの起動処理、Prisma のマイグレーション、参加アプリは、このコマンドを実行しません。

ロール名の例は `app_participant` です。列権限は参加アプリに共通なので、アプリを増やすたびにロールは作りません。各参加アプリの `DATABASE_URL` には、このロールで同じデータベースへ接続する文字列を設定します。

```text
DATABASE_URL="postgresql://app_participant:replace-me@localhost:5432/database_name?schema=public"
```

`replace-me` は `CREATE ROLE` で決めたパスワードです。`database_name` は認証サーバーの `DATABASE_URL` と同じデータベース名です。認証サーバーの `DATABASE_URL` は、読み書きできる既存のユーザーのままにします。上の `schema=public` は、共有テーブルを参照する接続です。

共有テーブル（`User`、`WebAuthnCredential`、`App`、`AppGrant`、`RoleChange`）は `public` にあり、マイグレーションは認証サーバーだけが行います。参加アプリ用ロールは `SELECT` だけなので、この接続ではテーブルを作成しません。`RoleChange` は参加アプリに `SELECT` を与えません。

アプリ固有のテーブルは、アプリごとに `public` 以外の PostgreSQL スキーマへ置き、そのアプリが自分の Prisma 定義からマイグレーションします。両方の Prisma が `public` を管理すると、相手のテーブルを差分とみなします。分担は [specification.md](./specification.md) の「データベースの分担」に従います。固有テーブルへの書き込みは、そのアプリのスキーマにだけ与えます。`app_participant` の接続では、そのスキーマを作成しません。

Redis の ACL ユーザーは、全参加アプリで `app_participant` の1人です。アプリごとに作りません。認証サーバーの `REDIS_URL` は、これまでどおり読み書きできるユーザー（Coolify の Redis リソースが渡すユーザーを含む）のままです。

`PARTICIPANT_REDIS_PASSWORD` が設定されている場合、プロセス起動後、最初の HTTP リクエストを処理する直前に、認証サーバーの `REDIS_URL` を使って `app_participant` のパスワードを設定します。この設定は `entrypoint.sh` では行わず、同一プロセス内では一度だけ実行します。プロセスを再起動すると、次のリクエストの処理前に再度設定します。環境変数が未設定の場合は、ユーザーを作成・更新しません。ここで設定するパスワードは、PostgreSQL の `app_participant` のパスワードとは別のものです。

Redis 7 の ACL セレクターを使い、キーのパターンごとに許可するコマンドを指定します。`KEYS` と `SCAN` は許可しません。また、セッションキーの `SET` とユーザー索引への `SADD` も許可しません。これにより、参加アプリのサーバーが侵害された場合でも、パスキー認証と認証サーバーからの引き渡しを経ずにセッションを作成されることを防ぎます。

- `sess:*` の GET、EXPIRE、DEL
- `handoff:*` の GET、GETDEL、DEL
- `sess:user:*` の SREM

各参加アプリの実装が操作するのは、自分の `sess:{appId}:*` と `handoff:{appId}:*` だけです。ACL はアプリごとの分離を強制しません。引き渡しコードの消費は `GETDEL` です。

`REDIS_KEY_PREFIX` があるときは、各パターンの先頭にそのプレフィックスを付けます。プレフィックスが空のときのコマンドは次です。

```text
ACL SETUSER app_participant reset on >password (~sess:* +get +expire +del) (~handoff:* +get +getdel +del) (~sess:user:* +srem)
```

参加アプリの `REDIS_URL` は、このユーザーで同じ Redis へ接続します。

```text
REDIS_URL="redis://app_participant:replace-me@localhost:6379/"
```

`replace-me` は `PARTICIPANT_REDIS_PASSWORD` と同じ値です。Coolify の Redis ユーザーを参加アプリでもそのまま使う場合、この制限は掛からず、セッションの `SET` もできます。

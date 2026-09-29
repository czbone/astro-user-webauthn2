# Astro User WebAuthn

Astro 7（SSR）+ Hono + Prisma 7 + PostgreSQL + Redis による、管理者招待制のパスキー（WebAuthn）認証アプリケーションです。

詳細仕様は [`docs/specification.md`](docs/specification.md)、[`docs/session-management.md`](docs/session-management.md)、[`docs/redis.md`](docs/redis.md) を参照してください。テスト方法は [`docs/testing.md`](docs/testing.md) を参照してください。

![ログイン画面](docs/screenshots/login.png)

## 主な機能

- 管理者招待（マジックリンク＋メール通知）
- 初回マジックリンクログイン → パスキー必須登録 → 以降パスキーログイン
- セッション（Cookie + Redis、30日スライディング）
- デバイス追加（再認証＋メール招待）
- ログインできないときの復旧（パスワード再設定。全パスキー削除＋全 Session 失効）
- 投稿（`AppGrant` があるユーザーが公開投稿を閲覧、書き込みは本人のみ）
- 管理者ダッシュボード / ユーザー管理 / 参加アプリと利用権限

## 技術スタック

- Astro 7（SSR / Node adapter / Advanced routing）
- Hono
- Prisma 7 + PostgreSQL
- Redis（ioredis）— セッション・challenge・レート制限・招待／再設定／マジックリンクトークン
- React 19 Islands
- Tailwind CSS 4
- `@simplewebauthn/server` / `@simplewebauthn/browser`
- nodemailer（`MAIL_MODE=console|smtp`）

## セットアップ

### 1. 依存関係

```bash
pnpm install
```

### 2. 環境変数

`.env.example` をコピーして `.env` を作成します。

```env
DATABASE_URL="postgresql://username:password@localhost:5432/database_name?schema=public"
# DB_LOG_LEVEL="query"
REDIS_URL="redis://localhost:6379/"
APP_URL="http://auth.localhost:3000"
APP_ID="auth"
PARENT_DOMAIN="localhost"
WEBAUTHN_RP_ID="auth.localhost"
WEBAUTHN_RP_NAME="Astro User WebAuthn"
WEBAUTHN_ORIGIN="http://auth.localhost:3000"
MAIL_MODE="console"
SEED_ADMIN_EMAIL="admin@example.com"
SEED_ADMIN_PASSWORD="admin-change-me"
```

### 3. PostgreSQL / Redis 起動

```bash
# テスト用 compose に Postgres + Redis が含まれます（ローカル開発でも利用可）
docker compose -f docker-compose.db.yaml up -d
```

### 4. DB 初期化

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

### 5. 開発サーバー

```bash
pnpm dev
```

`http://auth.localhost:3000` で起動します。`__Host-session` はポートを区別しないため、開発ホストは `auth.localhost` にします。seed 管理者でパスワードログインし、パスキーを登録してください。投稿を使うには、管理画面で認証サーバーアプリへの `AppGrant` を付けます。

`pnpm db:seed` は認証サーバーの `App` 行を毎回 upsert します。管理者は **User が 0 件のときだけ** 作成し、`AppGrant` は付けません。全消ししてやり直すときは `pnpm db:reset` を使います。

ローカルでは `MAIL_MODE=console` のため、招待・再設定メールはサーバーログに出力されます。

## 主な画面

| パス | 説明 |
|------|------|
| `/login` | ログイン |
| `/auth/link/[token]` | 招待マジックリンク確認 |
| `/setup-passkey` | 初回パスキー登録 |
| `/posts` | 投稿 |
| `/devices` | デバイス管理 |
| `/dashboard` | 管理者ダッシュボード |
| `/admin/users` | ユーザー招待・一覧 |
| `/forgot-password` / `/reset-password/[token]` | ログインできないときの復旧 |
| `/invite/device/[token]` | デバイス用パスキー登録 |

## API

- `/api/auth/*` — 認証・パスキー・再設定
- `/api/admin/*` — 管理者
- `/api/devices/*` — デバイス
- `/api/posts/*` — 投稿

## アーキテクチャ

1. `src/fetch.ts` — `middleware()` → `/api`（Hono）→ `pages()`
2. Cookie は `App.getSetCookieFromResponse()` で明示付与
3. ブラウザ API は `src/api-client` 経由
4. 永続データは `src/server/db`（Prisma）、セッション等の短命データは Redis（`src/lib/redis.ts`）

## テスト

詳細は [`docs/testing.md`](docs/testing.md) を参照してください。

### 自動テスト

```bash
pnpm test
```

Vitest で純関数テストと API スモーク（DB モック）を実行します。ウォッチ実行は `pnpm test:watch` です。

実 PostgreSQL + Redis を使う統合テスト:

```bash
docker compose -f docker-compose.db.yaml up -d
# .env に TEST_DATABASE_URL を設定（.env.example 参照）
# REDIS_URL 未設定時は redis://localhost:6379/ を使用
pnpm test:integration
```

単体と統合の両方は `pnpm test:all` です。

### 静的チェック

```bash
pnpm lint
pnpm build
```

### 手動検証

セットアップ後に `pnpm dev` で起動し、seed 管理者でログインしてパスキーを登録したうえで、主要フロー（招待・デバイス追加・再設定・投稿など）をブラウザで確認します。`MAIL_MODE=console` のときは招待・再設定リンクがサーバーログに出ます。

## 本番（Coolify）の初期管理者

初回デプロイで管理者を入れる場合:

```env
DATABASE_URL="postgresql://..."
REDIS_URL="redis://..."
APP_URL="https://auth.example.com"
APP_ID="auth"
PARENT_DOMAIN="example.com"
WEBAUTHN_RP_ID="auth.example.com"
WEBAUTHN_ORIGIN="https://auth.example.com"
RUN_SEED="true"
SEED_ADMIN_EMAIL="admin@example.com"
SEED_ADMIN_PASSWORD="既定値以外の強いパスワード"
```

- 本番イメージは `NODE_ENV=production` 固定。必須変数が未設定、または `localhost` のままだと起動時チェックでコンテナが止まる
- HTTPS 必須（セッション Cookie に `Secure` が付く）
- `DB_LOG_LEVEL`（`silent` / `error` / `warn` / `info` / `query`）で Prisma ログを切り替え。未設定は本番 `warn`。変更後は再起動が必要
- `pnpm db:seed`（コンテナ内では `node dist/seed.mjs`）は User が空のときだけ作成する
- 作成後も `RUN_SEED=true` のままで再デプロイしてよい（スキップされる）。外してもよい
- `NODE_ENV=production` では `SEED_ADMIN_PASSWORD` 未設定、または既定値 `admin-change-me` だとシードは失敗し、コンテナは起動しない
- 手動実行: アプリコンテナで `pnpm db:seed`

## 本番メール

```env
MAIL_MODE="smtp"
SMTP_HOST="smtp.example.com"
SMTP_PORT="587"
SMTP_USER="..."
SMTP_PASS="..."
SMTP_FROM="noreply@example.com"
```

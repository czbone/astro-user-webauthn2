# テスト方法

## 自動テスト

### 単体・API スモーク（DB モック）

```bash
pnpm install
pnpm test
```

開発中のウォッチ実行:

```bash
pnpm test:watch
```

対象:

- `src/server/auth/*.test.ts` — パスワード・トークン・レート制限・チャレンジなどの純関数
- `src/server/api/app.test.ts` — `app.request()` による API スモーク（未認証応答など）
- `src/server/env-check.test.ts` — 本番の環境変数チェック
- `src/server/db-log.test.ts` — Prisma のログレベル

実 PostgreSQL / Playwright / パスキー UI は使いません。

### 統合テスト（実 PostgreSQL + Redis）

専用 DB（`TEST_DATABASE_URL`）と Redis（`REDIS_URL`）に対して、モックなしで API + Prisma + Redis を検証します。パスキー登録セレモニー自体は対象外です（Credential 行のフィクスチャ挿入のみ）。

```bash
# 1. テスト用 Postgres + Redis（Docker がある場合）
docker compose -f docker-compose.db.yaml up -d

# 既存のローカル Postgres を使う場合は、DATABASE_URL と同じ接続先に
# DB `astro_webauthn_test` を作り .env へ TEST_DATABASE_URL を追記できる:
# pnpm exec tsx scripts/ensure-test-db.mjs

# 2. .env に TEST_DATABASE_URL を設定（.env.example 参照）
# TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/astro_webauthn_test?schema=public"
# REDIS_URL 未設定時は redis://localhost:6379/ を使用

# 3. Prisma Client（未生成の場合）
pnpm db:generate

# 4. 実行（初回に migrate deploy が走る）
pnpm test:integration
```

`TEST_DATABASE_URL` 未設定のときは分かりやすいエラーで失敗します。開発用 `DATABASE_URL` とは別 DB を使ってください。統合テストは `REDIS_KEY_PREFIX` を自動設定し、テスト間で Redis キーを掃除します。

単体と統合をまとめて実行する場合:

```bash
pnpm test:all
```

対象:

- `src/server/api/auth.integration.test.ts` — パスワード／マジックリンク、セッション、ログアウト、再設定、パスキー登録
- `src/server/api/admin.integration.test.ts` — ユーザー招待・一覧・統計
- `src/server/api/devices.integration.test.ts` — 一覧、削除、再認証、招待、登録
- `src/server/api/posts.integration.test.ts` — パスキー未登録 403、一覧、作成・更新・削除、下書き権限
- `src/server/db/*.integration.test.ts` — User / Credential / Post / Session / DeviceInvite / PasswordReset / MagicLink

## 静的チェック

```bash
pnpm lint
pnpm build
```

- `pnpm lint` — ESLint
- `pnpm build` — Astro SSR ビルドが通るかの確認

## 手動検証

### 前提

```bash
pnpm install
# .env.example を .env にコピーして DATABASE_URL / REDIS_URL 等を設定
docker compose -f docker-compose.db.yaml up -d
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`http://localhost:3000` で起動します。seed 管理者（`.env` の `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`）でパスワードログインし、パスキーを登録してください。

ローカルでは `MAIL_MODE=console` のため、招待・再設定メールはサーバーログに出力されます。

WebAuthn はブラウザのパスキー UI が必要です（`localhost` + `WEBAUTHN_RP_ID=localhost` でローカル検証を想定）。

### 確認フロー

| 流れ | 画面 / API |
|------|------------|
| 初回マジックリンクログイン → パスキー登録 | `/auth/link/[token]` → `/setup-passkey` |
| 以降のパスキーログイン | `/login` |
| 管理者によるユーザー招待 | `/admin/users`（ログの招待リンク） |
| デバイス追加 | `/devices` → `/invite/device/[token]` |
| ログインできないときの復旧 | `/forgot-password` → `/reset-password/[token]` |
| 投稿の閲覧・作成 | `/posts` |
| 管理者ダッシュボード | `/dashboard` |

# Copilot Instructions

このリポジトリで GitHub Copilot がコード提案・自動生成を行うときは、以下の前提と規約を強く優先してください。

## プロジェクト概要
- Astro を SSR モードで使用し、Node.js アダプターで配信するフルスタック構成です。
- UI は Astro ページをベースにし、対話的な箇所だけ React コンポーネントを Islands として `client:load` で読み込みます。
- データアクセスは Prisma 7 と PostgreSQL を使用します。
- スタイリングは Tailwind CSS 4 を使い、既存のユーティリティクラス中心の書き方に合わせます。
- パッケージマネージャーは pnpm です。コマンド例は pnpm を前提にしてください。
- 仕様の正本は `docs/specification.md` と `docs/session-management.md` です。

## 技術スタック
- Astro 7
- TypeScript
- React 19
- Tailwind CSS 4
- Prisma 7
- PostgreSQL
- @prisma/adapter-pg
- Hono（Advanced routing 経由の API）
- @simplewebauthn/server / @simplewebauthn/browser
- nodemailer（MAIL_MODE=console|smtp）

## 実装方針
- Astro ページは `src/pages`、React コンポーネントは `src/components`、共通ロジックは `src/lib`、認証は `src/server/auth`、データアクセスは `src/server/db`、API は `src/server/api`、ブラウザ側 API 呼び出しは `src/api-client` に置いてください。
- Advanced routing のエントリは `src/fetch.ts` です。`astro/hono` の `middleware()` → `/api` → `pages()` の順を崩さないでください。
- インポートは `@/*` エイリアスを優先してください。
- TypeScript は strict 前提です。`any` は避けてください。
- セミコロンなし、シングルクォート、簡潔な関数実装に合わせてください。
- UI / エラーメッセージは日本語を優先してください。

## 認証・権限
- ユーザー作成は管理者招待のみ（マジックリンク＋メール）。自己登録はありません。
- 招待ユーザーは初回マジックリンク、seed 管理者はパスワードログイン。パスキー登録後はパスキーのみ。
- パスキーでログインできないときの復旧はパスワード再設定（自動化しない）。招待ユーザーも同じ。
- パスキー未設定セッションは setup / logout / me 以外を拒否してください。
- 2台目以降のパスキーは再認証＋デバイス招待メール経由のみです。
- ロールは `admin` / `user`。ダッシュボードとユーザー管理は admin のみ。
- 公開 Post はログイン済み全員が閲覧可。書き込みは本人のみ。admin は他人の下書きも閲覧可。

## Astro と React の指針
- ページの認可は `getPageSession` / `redirectForAuth`（`src/lib/auth-page.ts`）を使ってください。
- React はフォームや対話部分に限定し、`useState` と素直なハンドラを優先してください。
- ブラウザからの API 呼び出しは必ず `src/api-client` 経由にしてください。
- mutation 成功後は `window.location.reload()` せず、再取得で state を更新してください（認証完了時の遷移は除く）。

## API ルートの指針
- Hono ルートは `src/server/api/routes` に置き、`src/server/api/app.ts` で `/auth` `/admin` `/devices` `/posts` として集約してください。
- Prisma 操作は `src/server/db` 経由にしてください。
- `src/pages/api` の Astro API Routes は使わないでください。

## Prisma の指針
- Prisma Client は `src/lib/prisma.ts` の `prisma` のみを使ってください。
- import は `@/generated/prisma/client` です。
- ID は UUID（文字列）です。

## データモデルの前提
- PostgreSQL: `User`（email unique, password(scrypt hash), name, role）/ `WebAuthnCredential` / `Post`
- Redis: Session / DeviceInvite / PasswordReset / WebAuthn challenge / rate limit（詳細は `docs/redis.md`）
- Session / Invite / Reset トークンはクライアントに生値、Redis キーは SHA-256 ハッシュ

## 推奨コマンド
- 開発: `pnpm dev`
- Lint: `pnpm lint`
- Build: `pnpm build`
- Prisma Client 生成: `pnpm db:generate`
- マイグレーション: `pnpm db:migrate`
- Seed: `pnpm db:seed`

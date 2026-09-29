# Agent instructions

このリポジトリでコードを提案・変更するときは、`.cursor/rules/` と仕様ドキュメントを優先する。

- 常時適用: `.cursor/rules/core.mdc`、`.cursor/rules/auth.mdc`
- 対象ファイルに応じて: `astro-react.mdc` / `api.mdc` / `prisma.mdc`
- 仕様の正本: `docs/specification.md`、`docs/session-management.md`、`docs/redis.md`
- GitHub Copilot 向けの同内容: `.github/copilot-instructions.md`

ユーザー作成は管理者招待のみ。パスキー未設定セッションは setup / logout / me 以外を拒否する。API は Hono（`src/server/api`）、ページ認可は `getPageSession` / `redirectForAuth`。Prisma は `src/lib/prisma.ts` の `prisma` のみ。

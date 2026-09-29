# Coolify向けAstro + Node.js + PostgreSQL + Prismaアプリケーション用Dockerfile
# マルチステージビルドで本番イメージを軽量化

# ベースステージ: Node.js 24 Alpine
FROM node:24-alpine AS base
WORKDIR /app

# pnpmのインストール
RUN corepack enable && corepack prepare pnpm@latest --activate

# 依存関係ステージ
FROM base AS dependencies
WORKDIR /app

# package.jsonとロックファイルをコピー
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# 本番依存関係のインストール
RUN pnpm install --frozen-lockfile --prod

# ビルドステージ
FROM base AS build
WORKDIR /app

# package.jsonとロックファイルをコピー
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# すべての依存関係（devDependencies含む）をインストール
RUN pnpm install --frozen-lockfile

# ソースコードをコピー
COPY . .

# Prisma Clientの生成
RUN pnpm run db:generate

# Astroアプリケーションのビルド
RUN pnpm run build

# 本番ステージ
FROM node:24-alpine AS production
WORKDIR /app

# 必要なシステムパッケージをインストール（PostgreSQL接続用）
RUN apk add --no-cache bash curl

# pnpmのインストール（Prismaマイグレーション実行に必要）
RUN corepack enable && corepack prepare pnpm@latest --activate

# 非rootユーザーの作成
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# package.jsonとロックファイルをコピー
COPY --chown=nodejs:nodejs package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# 本番依存関係をdependenciesステージからコピー
COPY --from=dependencies --chown=nodejs:nodejs /app/node_modules ./node_modules

# ビルド成果物をコピー
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist
COPY --from=build --chown=nodejs:nodejs /app/src/generated ./src/generated

# Prismaスキーマとマイグレーションファイルをコピー（マイグレーション実行に必要）
COPY --chown=nodejs:nodejs prisma ./prisma
COPY --chown=nodejs:nodejs prisma.config.ts ./

# シードランナー（pnpm db:seed → dist/seed.mjs）
COPY --chown=nodejs:nodejs scripts/run-seed.mjs ./scripts/run-seed.mjs

# 起動スクリプトをコピー
COPY --chown=nodejs:nodejs entrypoint.sh healthcheck.sh ./
RUN chmod +x entrypoint.sh healthcheck.sh

# 非rootユーザーに切り替え
USER nodejs

# 実行時のみ production（base/build には書かない。pnpm install が devDependencies を落とすため）
ENV NODE_ENV=production

# 待ち受けポートは Coolify の Ports Exposes で指定（PORT 環境変数として注入される）
# NOTE: EXPOSE / ENV PORT は Dockerfile に書かない（Coolify 設定と競合し docker ps が 3000-3001 になる）

# ヘルスチェック（healthcheck.sh が実行時の PORT を参照）
HEALTHCHECK --interval=30s --timeout=3s --start-period=90s --retries=3 \
    CMD ./healthcheck.sh

# 起動スクリプトを実行
ENTRYPOINT ["./entrypoint.sh"]

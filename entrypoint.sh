#!/bin/bash
set -e

echo "🚀 Starting application..."

# DATABASE_URL環境変数の検証
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL environment variable is not set"
    exit 1
fi

echo "🔎 Checking environment variables..."
if node dist/env-check.mjs; then
    echo "✅ Environment OK"
else
    echo "❌ Environment check failed"
    exit 1
fi

# データベース接続の待機（オプション：PostgreSQLが起動するまで待つ）
echo "⏳ Waiting for database connection..."
max_attempts=30
attempt=0

until pnpm prisma db execute --stdin <<< "SELECT 1;" > /dev/null 2>&1 || [ $attempt -eq $max_attempts ]; do
    attempt=$((attempt + 1))
    # 5回おきまたは最終試行でログ出力
    if [ $((attempt % 5)) -eq 0 ] || [ $attempt -eq $max_attempts ]; then
        echo "   Attempt $attempt/$max_attempts..."
    fi
    if [ $attempt -lt $max_attempts ]; then
        sleep 2
    fi
done

if [ $attempt -eq $max_attempts ]; then
    echo "❌ Error: Could not connect to database after $max_attempts attempts"
    echo "📋 Detailed error information:"
    echo "   DATABASE_URL is set: $([ -n "$DATABASE_URL" ] && echo 'Yes' || echo 'No')"
    pnpm prisma db execute --stdin <<< "SELECT 1;" 2>&1
    exit 1
fi

echo "✅ Database connected"

# Prismaマイグレーションの実行
echo "🔄 Running migrations..."
pnpm prisma migrate deploy > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo "✅ Migrations completed"
else
    echo "❌ Migration failed"
    pnpm prisma migrate deploy 2>&1
    exit 1
fi

# オプション：初回デプロイ時のシード実行（User が空のときだけ管理者を作成）
# 環境変数 RUN_SEED=true を設定すると実行される
if [ "$RUN_SEED" = "true" ]; then
    echo "🌱 Running seed..."
    if pnpm run db:seed; then
        echo "✅ Seed completed"
    else
        echo "❌ Seed failed"
        exit 1
    fi
fi

# Node.jsサーバーの起動
echo "🎯 Starting Node.js server..."
exec node dist/server/entry.mjs

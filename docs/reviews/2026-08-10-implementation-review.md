# 実装レビュー（2026-08-10）

## 概要

本ドキュメントは、WebAuthn ユーザー認証アプリケーションの実装が仕様ドキュメントと整合しているか、セキュリティ面で問題がないかを調査した結果をまとめたものです。

## 全体的な評価

✅ **実装は仕様ドキュメントと高い整合性を保っており、セキュリティ面でも適切な実装が行われています。主要な機能は正しく動作すると考えられます。**

## 仕様との整合性が確認できた点

### 1. 認証フロー
- パスワード初回ログイン → パスキー必須登録 → 以降パスキーのみログインの流れが正しく実装されている
- `POST /api/auth/login/password` は Credential 0 件のみ受け付ける仕様が守られている
- パスキー登録後のパスワードログイン拒否が実装されている

### 2. セッション管理
- Cookie + Redis、スライディング30日の実装が正しい
- トークンの SHA-256 ハッシュ化が適切に行われている
- セッション検証時の TTL 延長（スライディング）が実装されている
- ログアウト時の単一セッション削除と全セッション失効の区別が正しい

### 3. Redis 設計
- すべてのキー設計がドキュメント通り実装されている：
  - `sess:{tokenHash}` - セッション本体
  - `sess:user:{userId}` - ユーザー索引
  - `chal:{kind}:{id}` - チャレンジ
  - `rl:{logicalKey}` - レート制限
  - `invite:{tokenHash}` / `reset:{tokenHash}` - 招待・再設定
- TTL の設定が仕様通り（Session: 30日、challenge: 5分、invite/reset: 1時間）

### 4. セキュリティ
- scrypt によるパスワードハッシュ化が適切
- レート制限の実装（固定ウィンドウ方式）
- 再認証フローの実装（デバイス追加時）
- トークンのハッシュ化（Session, Invite, Reset）

### 5. 権限管理
- ミドルウェアでの認証チェック（`requireAuth`, `requirePasskey`, `requireAdmin`）
- パスキー未設定セッションの制限（setup / logout / me 以外拒否）
- admin 権限チェックが適切に実装されている
- 投稿の閲覧権限（公開 or 本人 or admin）が正しく実装されている

### 6. データモデル
- PostgreSQL（User, WebAuthnCredential, Post）と Redis（Session等）の役割分担が適切
- Prisma スキーマが仕様通り
- onDelete: Cascade の設定が適切

## 潜在的な問題点と改善提案

### ⚠️ 1. レート制限のキー衝突リスク

**場所**: [src/server/api/routes/auth.ts:41-44](../../src/server/api/routes/auth.ts#L41-L44)

```typescript
const ip = c.req.header('x-forwarded-for') || 'local'
const limited = await checkRateLimit(`pwd:${ip}:${email}`, 10, 15 * 60 * 1000)
```

**問題**: 本番環境でリバースプロキシが `X-Forwarded-For` ヘッダーを正しく設定しない場合、すべてのユーザーが同じ `'local'` キーを共有し、レート制限が正しく機能しません。

**推奨**:
- リバースプロキシの設定確認を README やデプロイドキュメントに明記する
- IP フォールバック時にログ警告を出力する実装を追加する
- または環境変数で `TRUST_PROXY` を設定し、未設定時はエラーにする

### ⚠️ 2. WebAuthn の challenge 取得ロジック

**場所**: [src/server/auth/webauthn.ts:156-161](../../src/server/auth/webauthn.ts#L156-L161)

```typescript
const challengeFromClient = extractChallengeFromClientData(response.response.clientDataJSON)
const expected =
  (challengeFromClient && (await takeAuthChallengeByValue(challengeFromClient))) ||
  (await takeAuthChallengeForUser(credential.userId))
```

**観察**: この実装は柔軟ですが、`challengeFromClient` が存在しても対応する Redis キーが見つからない場合、フォールバックで userId キーを使用します。これにより、意図しない challenge が使われる可能性があります。

**推奨**:
- 両方のチャレンジ取得を試みた結果をログに記録し、デバッグを容易にする
- または、challengeFromClient がある場合はそれのみを使用し、見つからない場合はエラーにする

### ⚠️ 3. パスワード再設定時の通知

**場所**: [src/server/api/routes/auth.ts:260-278](../../src/server/api/routes/auth.ts#L260-L278)

**問題**: パスワード再設定が完了すると、すべてのパスキーと全セッションが無効化されますが、**ユーザーへのメール通知は実装されていません**。

**推奨**:
- セキュリティインシデントの検知のため、パスワード再設定完了時に「パスワードが変更されました」という通知メールを送信する
- メール内容例：
  ```
  パスワードが変更されました。
  - 変更日時: YYYY-MM-DD HH:MM
  - すべてのパスキーが無効化されました
  - すべてのセッションがログアウトされました
  
  心当たりがない場合は、至急管理者に連絡してください。
  ```

### 💡 4. admin 権限の変更

**観察**: 仕様では管理者招待時に `role` を指定できますが、**既存ユーザーの role を変更する API が実装されていません**。

**推奨**:
- これが意図的な設計（role は作成時のみ設定可能）なのか、今後実装予定なのかを `docs/specification.md` に明記する
- 将来的に `PATCH /api/admin/users/:id` で role 変更を実装する場合は、監査ログの記録も検討する

### ℹ️ 5. エラーメッセージの情報漏洩防止

**場所**: [src/server/api/routes/auth.ts:98-104](../../src/server/api/routes/auth.ts#L98-L104)

```typescript
const user = await UserDB.findByEmail(email)
if (!user) {
  return c.json({ error: 'ログインに失敗しました' }, 401)
}
```

**観察**: `/api/auth/login/method` エンドポイントは、ユーザーの存在を確認してログイン方法を返すため、ユーザー列挙攻撃のリスクがあります。

**状況**: 仕様上、メールアドレスが存在するか判定して認証方法を返す必要があるため、これはトレードオフの設計です。

**推奨**:
- セキュリティドキュメントに「`/api/auth/login/method` エンドポイントはユーザー存在を確認できる」というリスクを明記する
- レート制限（現在 30 req/15分）で緩和されているが、十分か検討する

## 良い実装パターン

### ✅ 1. copilot-instructions.md の遵守
- `window.location.reload()` を使わず、API レスポンス後の状態更新が適切
- ただし認証完了時の遷移は `window.location.href` で正しく実装されている

### ✅ 2. 型安全性
- TypeScript の型定義が適切で、`any` の使用を避けている
- Prisma の生成型を活用している

### ✅ 3. テストカバレッジ
- 単体テスト（`*.test.ts`）と統合テスト（`*.integration.test.ts`）が存在
- 重要な機能（セッション、認証、レート制限）がカバーされている

### ✅ 4. エラーハンドリング
- try-catch が適切に配置され、ログ出力も行われている
- 汎用エラーメッセージで内部情報の漏洩を防いでいる

### ✅ 5. Redis 接続
- HMR 対応でグローバル再利用するパターンが実装されている
- エラーハンドリングも適切

### ✅ 6. セキュリティベストプラクティス
- HttpOnly Cookie の使用
- 本番環境での Secure フラグ設定
- SameSite=Lax の設定
- 暗号学的に安全な乱数生成（`randomBytes`）
- タイミング攻撃対策（`timingSafeEqual`）

## その他の確認事項

### Redis 永続化
[docs/redis.md](../redis.md) で言及されている通り、本番環境では AOF/RDB の設定が必要です。

**推奨**: デプロイガイドに Redis 永続化設定の手順を追加する。

### 環境変数の設定
`.env.example` の存在を確認し、すべての必要な環境変数が文書化されていることを確認してください。

**必須環境変数**:
- `DATABASE_URL`
- `REDIS_URL`
- `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGIN`
- `APP_URL`
- `MAIL_MODE` / `SMTP_*`
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`

### WebAuthn RP_ID
ローカル開発では `localhost` ですが、本番環境では適切なドメインを設定する必要があります。

**注意**: RP_ID を変更すると既存のパスキーが使用不可になるため、初回デプロイ前に確定する必要があります。

## レビュー対象ファイル

### 主要実装
- [src/server/auth/session.ts](../../src/server/auth/session.ts) - セッション管理
- [src/server/db/session.ts](../../src/server/db/session.ts) - セッション Redis 操作
- [src/server/auth/challenges.ts](../../src/server/auth/challenges.ts) - チャレンジ管理
- [src/server/auth/webauthn.ts](../../src/server/auth/webauthn.ts) - WebAuthn 処理
- [src/server/auth/rate-limit.ts](../../src/server/auth/rate-limit.ts) - レート制限
- [src/server/middleware/auth.ts](../../src/server/middleware/auth.ts) - 認証ミドルウェア
- [src/server/api/routes/auth.ts](../../src/server/api/routes/auth.ts) - 認証 API
- [src/server/api/routes/devices.ts](../../src/server/api/routes/devices.ts) - デバイス管理 API
- [src/server/api/routes/admin.ts](../../src/server/api/routes/admin.ts) - 管理者 API
- [src/server/api/routes/posts.ts](../../src/server/api/routes/posts.ts) - 投稿 API

### データアクセス
- [src/server/db/user.ts](../../src/server/db/user.ts)
- [src/server/db/credential.ts](../../src/server/db/credential.ts)
- [src/server/db/post.ts](../../src/server/db/post.ts)
- [src/server/db/invite.ts](../../src/server/db/invite.ts)
- [src/server/db/password-reset.ts](../../src/server/db/password-reset.ts)

### ページ
- [src/pages/login.astro](../../src/pages/login.astro)
- [src/pages/setup-passkey.astro](../../src/pages/setup-passkey.astro)
- [src/pages/dashboard.astro](../../src/pages/dashboard.astro)
- [src/pages/posts.astro](../../src/pages/posts.astro)
- [src/pages/devices.astro](../../src/pages/devices.astro)
- [src/pages/admin/users.astro](../../src/pages/admin/users.astro)
- [src/pages/invite/device/[token].astro](../../src/pages/invite/device/[token].astro)
- [src/pages/reset-password/[token].astro](../../src/pages/reset-password/[token].astro)

### テスト
- [src/server/api/auth.integration.test.ts](../../src/server/api/auth.integration.test.ts)
- [src/server/api/posts.integration.test.ts](../../src/server/api/posts.integration.test.ts)
- 各種単体テスト（`*.test.ts`）

## 結論

**プログラムの仕様や動作に重大な問題は見当たりません。**

実装はドキュメントと整合しており、セキュリティのベストプラクティスに従っています。上記の改善提案は、主に運用上のリスク軽減と将来の拡張性に関するものです。

本番環境へのデプロイ前に以下を確認してください：
1. ✅ Redis 永続化設定（AOF/RDB）
2. ✅ リバースプロキシの `X-Forwarded-For` ヘッダー設定
3. ✅ WebAuthn RP_ID の確定
4. ✅ SMTP 設定（本番では `MAIL_MODE=smtp`）
5. ✅ 環境変数の設定（特に `WEBAUTHN_*`, `APP_URL`）

---

**レビュー実施日**: 2026-08-10  
**レビュー対象**: [docs/specification.md](../specification.md), [docs/session-management.md](../session-management.md), [docs/redis.md](../redis.md) に基づく実装全体

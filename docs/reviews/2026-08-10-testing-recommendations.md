# テストカバレッジ評価と推奨事項

**日付**: 2026-08-10  
**対象**: astro-user-webauthn プロジェクト  
**評価者**: GitHub Copilot

## 現状の評価

### 既存のテスト

プロジェクトには以下のテストが実装されています：

#### 単体テスト（DB モック）
- `src/server/auth/password.test.ts` - パスワードハッシュ化と検証
- `src/server/auth/tokens.test.ts` - トークン生成とハッシュ化
- `src/server/auth/challenges.test.ts` - チャレンジの保存と消費
- `src/server/auth/rate-limit.test.ts` - レート制限ロジック
- `src/server/api/app.test.ts` - API スモークテスト（未認証応答確認）

#### 統合テスト（実 PostgreSQL + Redis）
- `src/server/api/auth.integration.test.ts` - 認証フロー
  - パスワードログイン
  - セッション作成と検証
  - ログアウト
  - パスワード再設定リクエスト
  - 誤ったパスワードの拒否
- `src/server/api/posts.integration.test.ts` - 投稿API
  - パスキー未登録時の 403
  - パスキーありでの一覧取得

### テストカバレッジの課題

以下の主要機能が**未テスト**です：

1. **Admin API** (`/api/admin/*`) - 完全に未テスト
2. **Devices API** (`/api/devices/*`) - 完全に未テスト
3. **Auth API の重要シナリオ** - パスキーログイン、初回登録、パスワード再設定確定など
4. **Posts API の CRUD** - 作成・更新・削除が未テスト
5. **DB モジュール** - Prisma 操作の直接的な単体テストなし

## 推奨事項

### 優先度高：統合テスト（実 DB + Redis）

#### 1. Admin API のテスト

新規ファイル: `src/server/api/admin.integration.test.ts`

**必須テストケース**:
```typescript
describe('admin integration', () => {
  // GET /admin/users - ユーザー一覧取得
  it('lists all users for admin')
  it('returns 403 for non-admin users')
  
  // POST /admin/users - ユーザー招待
  it('creates a new user with temporary password and sends email')
  it('rejects duplicate email addresses with 409')
  it('validates required fields (email, name)')
  it('defaults role to user and accepts admin role')
  it('verifies sendUserInviteMail was called with correct params')
  
  // GET /admin/stats - 統計情報
  it('returns correct counts for users, admins, posts, and published posts')
  
  // 認可チェック
  it('requires authentication for all endpoints')
  it('requires admin role for all endpoints')
  it('requires passkey setup for all endpoints')
})
```

**重要性**: ユーザー招待は認証システムの入口であり、セキュリティ上重要。

#### 2. Devices API のテスト

新規ファイル: `src/server/api/devices.integration.test.ts`

**必須テストケース**:
```typescript
describe('devices integration', () => {
  // GET /devices - デバイス一覧
  it('lists devices for authenticated user with passkey')
  it('returns 403 without passkey setup')
  
  // DELETE /devices/:id - デバイス削除
  it('deletes a device successfully')
  it('rejects deletion of the last device with 400')
  it('returns 404 for non-existent device')
  it('prevents deleting another user\'s device')
  
  // POST /devices/reauth/* - 再認証
  it('creates reauth options')
  it('verifies reauth response and stores reauth-ok flag')
  
  // POST /devices/invite - デバイス招待
  it('requires reauth before creating invite')
  it('creates invite token and sends email')
  it('invalidates previous pending invites')
  it('returns 403 without reauth')
  
  // POST /devices/register/* - 招待経由の登録
  it('creates registration options with valid invite token')
  it('verifies registration and marks invite as used')
  it('rejects invalid or expired invite tokens')
  it('allows registration without session cookie')
})
```

**重要性**: デバイス追加フローはパスキーの運用上不可欠。セキュリティ要件（再認証必須）の検証が必要。

#### 3. Auth API の追加シナリオ

既存ファイルに追加: `src/server/api/auth.integration.test.ts`

**追加すべきテストケース**:
```typescript
describe('auth integration', () => {
  // 既存のテストに加えて...
  
  // POST /auth/login/method - ログイン方式判定
  it('returns password method for users without passkeys')
  it('returns passkey method and options for users with passkeys')
  it('returns 401 for non-existent email')
  
  // パスキーログイン完全フロー
  it('completes passkey login flow with options and verify')
  it('creates session after successful passkey authentication')
  it('updates credential lastUsedAt on authentication')
  
  // 初回パスキー登録
  it('allows first passkey registration for authenticated user')
  it('completes passkey registration with options and verify')
  it('rejects second passkey registration from /auth (requires /devices)')
  
  // パスワード再設定確定
  it('resets password and deletes all credentials on confirm')
  it('revokes all sessions for the user on confirm')
  it('invalidates pending device invites on confirm')
  it('creates new session and redirects to setup-passkey')
  it('rejects invalid or expired reset tokens')
  
  // セキュリティ制約
  it('rejects password login for users with passkeys (403)')
  it('enforces passkey requirement before accessing protected routes')
  
  // レート制限（統合レベル）
  it('returns 429 after exceeding password login attempts')
  it('returns 429 after exceeding reset request attempts')
})
```

**重要性**: パスキーログインと再設定フローは認証の中核。全体的な動作検証が必須。

#### 4. Posts API の追加シナリオ

既存ファイルに追加: `src/server/api/posts.integration.test.ts`

**追加すべきテストケース**:
```typescript
describe('posts integration', () => {
  // 既存のテストに加えて...
  
  // POST /posts - 作成
  it('creates a published post')
  it('creates a draft post (published=false)')
  it('rejects posts without title (400)')
  
  // GET /posts/:id - 詳細
  it('retrieves a published post for any authenticated user')
  it('retrieves own draft for the author')
  it('retrieves any draft for admin')
  it('returns 404 for another user\'s draft (non-admin)')
  it('returns 404 for non-existent post')
  
  // PATCH /posts/:id - 更新
  it('updates own post successfully')
  it('updates title, content, and published status')
  it('returns 404 when updating another user\'s post')
  it('returns 404 for non-existent post')
  
  // DELETE /posts/:id - 削除
  it('deletes own post successfully')
  it('returns 404 when deleting another user\'s post')
  it('returns 404 for non-existent post')
  
  // 権限チェック
  it('lists only published posts and own drafts for regular user')
  it('lists all posts including others\' drafts for admin')
})
```

**重要性**: 投稿機能の CRUD とロールベースのアクセス制御の検証。

### 優先度中：DB モジュールの単体テスト

各 DB モジュール（`src/server/db/*.ts`）の Prisma 操作を直接テストすることで、統合テストのデバッグが容易になります。

**推奨ファイル構成**:
- `src/server/db/user.test.ts`
- `src/server/db/credential.test.ts`
- `src/server/db/post.test.ts`
- `src/server/db/session.test.ts`
- `src/server/db/invite.test.ts`
- `src/server/db/password-reset.test.ts`

**テスト例** (`user.test.ts`):
```typescript
describe('UserDB', () => {
  it('finds user by email (case-insensitive)')
  it('creates user with hashed password')
  it('updates password')
  it('counts credentials for user')
  it('lists all users')
  it('counts total users and admins')
})
```

**利点**:
- API レイヤーから切り離したデータアクセスロジックの検証
- バグの早期発見と局所化
- リファクタリング時の安全性向上

### 優先度中：セキュリティシナリオ

#### 5. レート制限の統合確認

既存の `rate-limit.test.ts` は単体テストのみです。実際の API エンドポイントでの動作を統合テストで確認：

```typescript
describe('rate limiting integration', () => {
  it('blocks password login after 10 attempts in 15 minutes')
  it('blocks password reset requests after 5 attempts in 15 minutes')
  it('blocks login method checks after 30 attempts in 15 minutes')
  it('resets rate limit after time window expires')
})
```

#### 6. トークンの単回使用性

```typescript
describe('token single-use verification', () => {
  it('rejects reuse of consumed device invite token')
  it('rejects reuse of consumed password reset token')
  it('rejects revoked session token')
  it('allows different tokens for same user simultaneously')
})
```

#### 7. セッション管理

仕様書（`docs/session-management.md`）に基づく動作検証：

```typescript
describe('session management', () => {
  it('extends session TTL on valid access')
  it('maintains multiple active sessions for one user')
  it('revokes all sessions on password reset')
  it('revokes single session on logout (others remain active)')
  it('rejects expired session tokens')
})
```

### 優先度低：将来的な追加

#### 8. E2E テスト（Playwright 等）

現在のテストは実際のブラウザ WebAuthn API を使用していません。将来的に：

- 実際のパスキー登録と認証フロー
- React コンポーネント（`src/components/*.tsx`）の動作
- Astro ページ（`src/pages/*.astro`）のレンダリングと遷移
- フォーム送信とバリデーション

#### 9. エッジケース

```typescript
describe('edge cases', () => {
  it('handles malformed JSON gracefully')
  it('handles empty request bodies')
  it('validates and rejects extremely long input values')
  it('handles concurrent token usage attempts')
  it('handles database connection failures')
  it('handles Redis connection failures')
})
```

## 推奨アクション

### 短期（優先度高）

1. **Admin API テスト** を最優先で追加
   - ユーザー招待は認証システムの入口
   - メール送信の動作確認が重要

2. **Devices API テスト** を次に追加
   - デバイス追加フローの複雑性（再認証必須）
   - セキュリティ要件の検証

3. **Auth と Posts の統合テストを拡充**
   - パスキーログインの完全フロー
   - パスワード再設定の全影響（Credential 削除、Session 失効）
   - Posts CRUD と権限チェック

### 中期（優先度中）

4. **DB モジュールの単体テスト** を順次追加
   - まず User / Credential / Session から
   - デバッグ効率の向上が目的

5. **セキュリティシナリオ** の統合確認
   - レート制限の実動作
   - トークンの単回使用性
   - セッション管理の仕様準拠

### 長期（優先度低）

6. **E2E テスト** の導入検討
   - Playwright 等での WebAuthn 実装テスト
   - CI/CD パイプラインへの組み込み

7. **エッジケースとカオステスト**
   - 異常系の網羅的なカバレッジ
   - 並行アクセスのストレステスト

## 期待される効果

### テスト追加による利点

1. **バグの早期発見**: 主要機能の動作を自動検証
2. **リファクタリングの安全性**: コード変更時の影響を即座に検出
3. **仕様の明確化**: テストコードが動作仕様の文書となる
4. **開発速度の向上**: 手動テストの削減、CI/CD での自動化

### カバレッジ目標

- **統合テスト**: 全 API エンドポイントの主要フローを網羅（目標 100%）
- **単体テスト**: ビジネスロジックと認証ロジックを網羅（目標 80%+）
- **E2E テスト**: クリティカルパス（ユーザー招待→登録→ログイン→投稿）を網羅

## まとめ

現在のテストは認証の基本フローをカバーしていますが、Admin API、Devices API、Posts CRUD が未テストです。これらは本番運用で頻繁に使用される重要な機能であり、早急にテストを追加すべきです。

推奨順序：
1. Admin API テスト（ユーザー招待の動作確認）
2. Devices API テスト（デバイス追加の複雑なフロー）
3. Auth/Posts の追加シナリオ（既存テストの拡充）
4. DB モジュール単体テスト（デバッグ効率向上）
5. セキュリティシナリオ（レート制限、トークン管理）

この順序で実装することで、リスクの高い領域から段階的にテストカバレッジを向上させることができます。

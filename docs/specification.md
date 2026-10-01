# WebAuthn ユーザー認証アプリケーション仕様

本ドキュメントは本プロジェクトの確定仕様です。セッション管理の詳細は [session-management.md](./session-management.md)、Redis キー設計は [redis.md](./redis.md) を参照してください。

## 概要

Astro 7（SSR）+ Hono + Prisma 7 + PostgreSQL + Redis + React Islands による、管理者招待制の WebAuthn（パスキー）認証アプリです。

- 通常ユーザーは招待マジックリンクで初回ログインし、パスキー登録後はパスキーのみでログインする
- seed 管理者だけが初回パスワードログインする。パスキー登録後はパスワードログイン不可
- セッションは Cookie + Redis（30日スライディング）
- WebAuthn challenge・レート制限・デバイス招待・復旧用パスワード再設定・招待マジックリンクトークンも Redis
- 永続ドメインデータ（User / Credential / Post）は PostgreSQL
- デバイス追加・アカウント復旧・ユーザー招待はメール連携（`MAIL_MODE` で切替）

## 認証フロー

ログイン手段は「誰が・いつ」で分かれる。

| 対象 | 初回 | 日常 | パスキー不能時 |
|------|------|------|----------------|
| 招待ユーザー | マジックリンク（確認ボタンでトークン消費 → Session 発行）。パスワードは推測不能ハッシュで、ユーザーは使わない | パスキーのみ | パスワード再設定（下記の復旧） |
| seed 管理者 | 環境変数の初期パスワード | パスキーのみ | 同じ復旧 |

1. 管理者がユーザーを招待すると、サーバーが招待マジックリンクをメール通知し、同時に User を作成する（Credential なし）
2. seed 管理者は環境変数の初期パスワードで作成される
3. ログイン後に **パスキー必須登録**（未設定中は setup / logout / me 以外不可）
4. Credential が1件以上ある以降は **パスキーログインのみ**（パスワードログイン・マジックリンクは拒否）
5. 2台目以降のパスキーは、既存端末の再認証＋デバイス招待メールのみ（クリックではログインしない）
6. **復旧**（自動化しない）: パスキーでログインできないときだけ。招待ユーザーも seed 管理者も同じ。`/login` の「ログインできないとき」→ メール → 新パスワードを本人が入力 → 全パスキー削除＋全 Session 失効 → 自動ログイン → パスキー再登録必須

復旧について:

- 開始条件はパスキーでログインできないとき（端末喪失、最後のパスキーを無効化したいとき）
- 初回セットアップ画面やデバイス招待画面には出さない。`/login` からの復旧入口である
- 招待ユーザーは Credential が1件でもあるとマジックリンクに戻れない。復旧の唯一の手段がパスワード再設定
- ここで決めたパスワードは、パスキー再登録までの一時入場用。再登録後の日常ログインには使わない
- パスキー再登録前にログアウトした場合、ログイン画面は招待ユーザーと同じ（パスキー 0 件）になる。再送が主で、復旧で決めたパスワードでも入れる
- 再設定は自動化しない（メール誤タップでの全パスキー削除を防ぎ、再登録までの再入場を残す）
- API はパスキー残存を検査しない。メールが届く人は完了でき、まだ使えるパスキーも削除される

```text
管理者招待 → マジックリンクメール → 確認ボタンでログイン → パスキー必須登録 → 利用開始
seed 管理者: 初期パスワードログイン → パスキー必須登録 → 利用開始
日常: パスキーログイン（または有効 Session）→ Post / デバイス管理
端末追加: 既存端末で再認証 → 招待メール → 新端末でパスキー登録（ログインしない）
復旧: ログインできないとき → メール → 新パスワード（警告）→ 自動ログイン → パスキー再登録
```

## ロールと権限

| 機能 | user | admin |
|------|------|-------|
| パスワード初回ログイン | ×（招待ユーザーは使わない） | ○（seed 管理者の初回） |
| 招待マジックリンク（初回） | ○ | ○ |
| パスキー設定（ログイン後必須） | ○ | ○ |
| パスキーログイン | ○ | ○ |
| アカウント復旧（パスワード再設定・パスキー全削除） | ○ | ○ |
| 自分のデバイス管理 | ○ | ○ |
| 公開 Post（`published=true`）の閲覧 | ○ | ○ |
| 自分の下書き閲覧 / 自分の Post CRUD | ○ | ○ |
| 他人の下書き閲覧 | × | ○ |
| 他人の Post の書き込み | × | × |
| `/dashboard` | × | ○ |
| ユーザー招待・一覧 | × | ○ |

- ロール値: `admin` / `user`
- 管理者招待時の role 既定は `user`（`admin` は明示選択のみ）

## データモデル

### PostgreSQL（永続）

- `User`: id(UUID), email, password(scrypt ハッシュ), name, role
- `WebAuthnCredential`: credentialId, publicKey, counter, transports, deviceName（登録時は必須。同一ユーザー内で重複不可。既存の未設定レコードは null 可）
- `Post`: title, content, published, authorId

ブラウザへ渡す資格情報一覧は ID のみとする。対象はログインと再認証の `allowCredentials`、登録時の `excludeCredentials`。`transports` は付けない。Chrome は `transports` を絞り込みに使い、候補が 0 件だと「利用可能なパスキーがありません」を出す。

`transports` は登録応答から PostgreSQL に保存し、パスキー検証と再認証検証で署名を確かめるときだけ使う。`allowCredentials` は外さない。入力したメールアドレスの資格情報に儀式を縛る。

### Redis（短命・セッション）

- Session: `sess:{appId}:{tokenHash}`（値: id, userId, appId, createdAt）+ `sess:user:{userId}` 索引（要素は `{appId}/{tokenHash}`）
- Handoff: `handoff:{appId}:{codeHash}`（TTL 60 秒）
- DeviceInvite: `invite:{tokenHash}` + `invite:user:{userId}` 索引（TTL 1h）
- PasswordReset: `reset:{tokenHash}` + `reset:user:{userId}` 索引（TTL 1h）
- MagicLink: `magic:{tokenHash}` + `magic:user:{userId}` 索引（TTL 1h、招待専用）
- WebAuthn challenge / reauth-ok: `chal:*`（TTL 5分、消費型）
- Rate limit: `rl:*`（固定ウィンドウ）

Session / Invite / Reset / Magic のトークンは生値を Cookie・URL・メールにのみ載せ、Redis キーには SHA-256 ハッシュを用いる。使用済みはキー削除とし、`usedAt` / `revokedAt` は持たない。

## セッション

| 項目 | 仕様 |
|------|------|
| Cookie 名 | `__Host-session` |
| 属性 | Secure / HttpOnly / SameSite=Lax / Path=/ / Domain なし / Max-Age=2592000 |
| 方式 | 永続 Cookie + Redis 検証、スライディング 30 日 |
| Token | 通常アクセスでは変更しない（Cookie Max-Age と Redis TTL のみ更新） |
| ログアウト | Cookie 削除 + 当該 Session キー削除（他アプリ・他デバイスは残す） |
| すべてのアプリからログアウト | ユーザー索引の全要素を削除し、認証サーバーの Cookie を削除する |
| 全失効 | `sess:user:{userId}` 経由で全キー削除（パスワード再設定時、招待マジックリンク再送時） |

詳細は [session-management.md](./session-management.md)。

## メール

- `MAIL_MODE=console`: 実送信せずログ出力（ローカル既定）
- `MAIL_MODE=smtp`: nodemailer で実 SMTP 送信
- 対象: ユーザー招待（マジックリンク）、デバイス招待、アカウント復旧（パスワード再設定）

## API 概要

### 認証 `/api/auth`

- `POST /login/password` — Credential 0 件のみ（seed 管理者の初回、および復旧直後のパスキー再登録前）
- `POST /login/method` — メールアドレスからログイン方式を判定。Credential ありはパスキー（options 付き。資格情報一覧は ID のみ）、0 件はマジックリンク。存在しないメールは 401
- `POST /login/passkey/options|verify` — options の資格情報一覧は ID のみ（上記）
- `POST /passkey/register/options|verify` — 初回のみセッションから直接登録可。verify はデバイス名必須・同一ユーザーで重複不可
- `POST /magic/consume` — 招待トークン消費（確認ボタン）。パスキー済みは拒否
- `POST /magic/resend` — パスキー 0 件のときだけ再発行。発行時は既存 Session を全削除
- `POST /password-reset/request|confirm` — パスキー不能時の復旧。confirm 確定時に全 Credential 削除。自動化しない（新パスワード入力が必要）
- `POST /logout` / `POST /logout-all` / `GET /me`
- `GET /auth/handoff` — 参加アプリへのセッション引き渡し（`/api` の外）

### 管理者 `/api/admin`

- `GET /users` / `POST /users`（招待マジックリンク＋メール。`AppGrant` は自動では付かない）
- `GET /stats`
- `GET|POST /apps`、`PATCH|DELETE /apps/:id`（認証サーバー自身の `App` は削除しない。`id` と `origin` は変更しない）
- `GET|PUT /grants`、`DELETE /grants/:userId/:appId`

### デバイス `/api/devices`

- `GET /` / `DELETE /:id`（最後の1件は削除不可）
- `POST /reauth/options|verify`
- `POST /invite`（再認証必須＋メール）
- `POST /register/options|verify`（招待トークン、ログイン不要）。verify はデバイス名必須・同一ユーザーで重複不可

### 投稿 `/api/posts`

- セッション必須・パスキー設定済み必須・認証サーバーアプリの `AppGrant` 必須
- GET: 公開 Post、または自分の下書き（`AppGrant.permission = admin` は全件）
- 書き込み: 常に本人のみ
- `User.role` はダッシュボードとユーザー・アプリ管理に使い、投稿の全件閲覧には使わない

## 環境変数

- `DATABASE_URL`
- `REDIS_URL`（本番必須、既定 `redis://localhost:6379/`）
- `REDIS_KEY_PREFIX`（任意）
- `SESSION_MAX_AGE_SECONDS`（任意、既定 `2592000`）
- `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGIN`（開発既定は RP ID `auth.localhost`、オリジン `http://auth.localhost:3000`。RP ID は認証サーバーのホスト名）
- `APP_URL`（開発既定 `http://auth.localhost:3000`。本番では `WEBAUTHN_ORIGIN` と origin が一致すること）
- `APP_ID`（認証サーバー自身の `App.id`。既定 `auth`）
- `PARENT_DOMAIN`（直下サブドメインの親。開発既定 `localhost`）
- `MAIL_MODE` / `SMTP_*`
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
- `DB_LOG_LEVEL`（任意。`silent` / `error` / `warn` / `info` / `query`。未設定は本番 `warn`、開発 `query`）
- `RUN_SEED`（任意。`true` のとき起動時にシード。User が空のときだけ管理者を作成。本番では `SEED_ADMIN_PASSWORD` に既定値以外が必要）

詳細は [redis.md](./redis.md)。

## セキュリティ上の必須事項

- 変更系 API（POST / PUT / PATCH / DELETE）は `Origin` が認証サーバーのオリジン（`WEBAUTHN_ORIGIN`）と一致しないとき 403（`オリジンが不正です`）
- 開発時（`NODE_ENV` が `production` でないとき）は、認証サーバー以外のホストへの GET / HEAD をそのオリジンへ 302 する。`pnpm dev` が表示する `http://localhost:3000` を開いても `http://auth.localhost:3000` に移る
- `__Host-session` はポートを区別しない。ローカルのホストは `localhost` ではなく `auth.localhost` とし、別ポートのアプリとセッションが混ざらないようにする
- DeviceInvite / PasswordReset / MagicLink は短命・単回使用（目安: 1h）
- ログイン・再設定・マジックリンク発行に簡易レート制限（Redis 固定ウィンドウ）
- パスキー未設定セッションは setup / logout / me 以外を拒否
- パスキー登録時のデバイス名は必須。同一ユーザー内で重複不可
- 2台目以降のパスキーは再認証＋メール招待のみ（クリックではログインしない）
- パスワード再設定は「ログインできないときの復旧」であり、自動化しない。UI で全パスキー無効化を警告表示
- 再設定完了時は全 Credential 削除・全 Session 失効・未使用 DeviceInvite / MagicLink 無効化
- 招待マジックリンクの再送は、パスキー 0 件で新リンクを発行するときだけ既存 Session を全削除する
- GET ではトークンを消費しない（確認ボタンの POST で消費）

## トレードオフ

- メール受信箱の侵害は初回アカウント掌握および復旧（全パスキー削除）につながる（メール側保護が前提）
- パスワード再設定は1台紛失でも全パスキーをリセットする（安全側）。パスキーが残っていても完了できる
- 招待・再設定リンクの可用性は Redis の永続化設定に依存する（Redis 再起動・データ消失で未使用トークンは無効になる）

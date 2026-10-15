# セッション管理仕様

本ファイルでは、セッションと短期データの管理方法を定めます。Redis キー設計の詳細は [redis.md](./redis.md) を参照してください。

## 1. 認証方式

認証には WebAuthn を使用します。招待ユーザーは初回にマジックリンクでログインし、seed 管理者は初回にパスワードでログインした後、パスキーに移行します。パスキーでログインできない場合は、パスワード再設定で復旧します（自動化はしません）。

```text
招待マジックリンク（または seed のパスワード）
        ↓
   Session 発行
        ↓
   パスキー登録
        ↓
以降は WebAuthn Credential でログイン
```

WebAuthn の Credential と Session は別々に管理します。

## 2. ストアの役割

| ストア | 対象 |
|--------|------|
| PostgreSQL | `User`, `WebAuthnCredential`, `App`, `AppGrant` |
| Redis | Session、WebAuthn challenge / reauth-ok、Rate limit、DeviceInvite、PasswordReset、MagicLink、EmailChange |

## 3. ログイン時

認証に成功すると、新しい Session を発行します。

```text
認証成功
    ↓
User の特定
    ↓
ランダムな Session Token 生成
    ↓
Token の SHA-256 ハッシュをキーに Redis へ保存
    ↓
ユーザー索引の SET に tokenHash を追加
    ↓
Cookie 発行
```

- Session Token は、暗号学的に安全な乱数から生成します
- Redis には生の Token を保存せず、そのハッシュをキーとして使用します
- Cookie 署名は使用せず、高エントロピーのトークンとハッシュ照合で検証します

### Redis 上のセッション値

キー: `sess:{appId}:{tokenHash}`

```json
{
  "id": "<uuid>",
  "userId": "<uuid>",
  "createdAt": "<ISO8601>"
}
```

ユーザー索引 `sess:user:{userId}` は Redis SET で、要素は `{appId}/{tokenHash}` です。パスワード再設定時の全セッション失効に使用します。認証サーバー自身の `appId` は環境変数 `APP_ID` で指定します。

セッション値にはユーザー情報のスナップショットを保存しません。権限や `User.role` も保存しません。ロールとパスキーの有無は、リクエストごとに PostgreSQL から取得します。参加アプリの既定値や `AppGrant` を変更すると、次のリクエストから反映されます。セッションを作り直す必要はありません。

## 4. セッション Cookie

Cookie は永続 Cookie とします。

```http
__Host-session
HttpOnly
Secure
SameSite=Lax
Path=/
Max-Age=2592000
```

`Domain` は指定しません。`__Host-` Cookie では、`Secure` と `Path=/` を指定し、`Domain` を省略する必要があります。Cookie はホスト単位で管理され、ポートは区別されません。ローカルでは `auth.localhost` を使い、別ポートの `localhost` とセッションが混在しないようにします。開発サーバーは `http://localhost:3000` でも待ち受けますが、本番以外ではページへの GET / HEAD リクエストを `WEBAUTHN_ORIGIN`（既定値 `http://auth.localhost:3000`）へリダイレクトします。

`Max-Age` の既定値は30日です（`SESSION_MAX_AGE_SECONDS`、未設定時は `2592000`）。ブラウザを閉じても Cookie は保持されます。

| 項目 | 仕様 |
|------|------|
| Cookie 名 | `__Host-session` |
| 値 | 暗号学的乱数トークン |
| 方式 | 永続 Cookie + Redis 検証、スライディング 30 日 |

## 5. セッションの有効期間

有効期間はスライディング方式です。最後のアクセスから30日間アクセスがない場合は、再ログインが必要です。

通常のアクセスでは Token 自体は変更せず、Cookie の Max-Age と Redis キーの TTL（`EXPIRE`）だけを更新します。`revokedAt` は使用せず、キーの削除によってセッションを失効させます。

## 6. サーバー側検証

Cookie のみを信頼せず、リクエストごとに Redis で Session を検証します。

```text
Cookie token
  ↓
SHA-256 ハッシュ化
  ↓
GET sess:{appId}:{hash}
  ↓
無し / TTL 切れ？
  ├─ YES → 未認証 → ログイン要求
  └─ NO
       ↓
     userId で PostgreSQL から User 取得（hasPasskey 等を算出）
       ↓
     行が無い
       → そのセッションを破棄して未認証
     disabledAt がある
       → そのユーザーの全セッションを破棄して未認証
       ↓
     Credential が 0 件のときは TTL も Cookie も延ばさない
       ↓
     認証サーバー自身の入場に AppGrant は使わない
       ↓
     許可されたアクセスだけ EXPIRE（TTL 延長）+ Cookie Max-Age 再設定
       ↓
     認証済み
```

参加アプリへの引き渡しでは、対象アプリの実効許可が `allow` の場合に限り、そのアプリのセッションを作成します。許可がない場合はセッションを作成せず、認証サーバーのセッション TTL も延長しません。共通ロールだけでは引き渡しません。

## 7. ログアウト

Cookie と該当 Session の Redis キーを削除し（`DEL sess:{appId}:{tokenHash}`）、索引からも該当 Session を削除します（`SREM`）。他のアプリやデバイスの Session には影響しません。

## 8. 全セッション失効

パスワード再設定、招待マジックリンクの再送、メールアドレス変更の確定、アカウントの無効化に成功したとき、および無効化を再実行したときに、全セッションを失効させます。メールの受信確認だけでは失効させません。アカウントを再有効化しても、セッションは作成しません。無効ユーザーのセッションを解決した場合も、そのユーザーの全セッションを破棄します。

```text
SMEMBERS sess:user:{userId}
  ↓
各 sess:{appId}:{tokenHash} を DEL
  ↓
sess:user:{userId} を DEL
  ↓
必要なら新 Session を発行
```

## 9. 複数デバイス

ユーザーは複数の WebAuthn Credential と Session を保持できます。デバイスの追加にはメール招待方式を用い、招待の発行時に既存の WebAuthn による再認証を要求します。

## 10. 有効期間の短いデータ（概要）

いずれも Redis に保存し、TTL によって自動的に失効します。詳細は [redis.md](./redis.md) を参照してください。

| データ | TTL | 備考 |
|--------|-----|------|
| WebAuthn challenge / reauth-ok | 300 秒 | 消費型（GET + DEL） |
| Rate limit | ウィンドウごと（例: 15 分） | 固定ウィンドウ、`INCR` + `PEXPIRE` |
| DeviceInvite | 3600 秒 | 単回使用、ユーザー索引 SET あり |
| PasswordReset | 3600 秒 | 単回使用、ユーザー索引 SET あり |
| MagicLink | 3600 秒 | 単回使用、ユーザー索引 SET あり、招待専用 |
| EmailChange | 3600 秒 | ユーザー索引 SET あり。受信済みフラグを持ち、確定または再申請まで残る |

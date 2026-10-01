# セッション管理仕様

本ファイルはセッションと短命データの管理仕様です。Redis キー設計の詳細は [redis.md](./redis.md) を参照してください。

## 1. 認証方式

認証には WebAuthn を使用します（招待ユーザーは初回マジックリンク、seed 管理者は初回パスワードログイン後にパスキーへ移行）。パスキーでログインできないときの復旧はパスワード再設定（自動化しない）です。

```text
招待マジックリンク（または seed のパスワード）
        ↓
   Session発行
        ↓
   パスキー登録
        ↓
以降は WebAuthn Credential でログイン
```

WebAuthn の Credential と Session は別物として管理します。

## 2. ストアの役割

| ストア | 対象 |
|--------|------|
| PostgreSQL | `User`, `WebAuthnCredential`, `Post` |
| Redis | Session、WebAuthn challenge / reauth-ok、Rate limit、DeviceInvite、PasswordReset、MagicLink |

## 3. ログイン時

認証に成功したら新しい Session を発行します。

```text
認証成功
    ↓
User特定
    ↓
ランダムな Session Token 生成
    ↓
Token の SHA-256 ハッシュをキーに Redis へ保存
    ↓
ユーザー索引 SET に tokenHash を追加
    ↓
Cookie 発行
```

- Session Token は暗号学的に安全な乱数から生成する
- Redis には生の Token ではなく、そのハッシュをキーとして用いる
- Cookie 署名は用いない（高エントロピートークン + ハッシュ照合）

### Redis 上のセッション値

キー: `sess:{appId}:{tokenHash}`

```json
{
  "id": "<uuid>",
  "userId": "<uuid>",
  "createdAt": "<ISO8601>"
}
```

ユーザー索引: `sess:user:{userId}` = Redis SET（要素は `{appId}/{tokenHash}`）。パスワード再設定時の全セッション失効に使う。認証サーバー自身の `appId` は環境変数 `APP_ID` です。

セッション値にユーザースナップショットは載せない。ロールやパスキー有無はリクエストごとに PostgreSQL から解決する。

## 4. セッション Cookie

永続 Cookie とします。

```http
__Host-session
HttpOnly
Secure
SameSite=Lax
Path=/
Max-Age=2592000
```

`Domain` は付けません。`__Host-` が `Secure`、`Path=/`、`Domain` なしを強制します。Cookie はホスト単位で、ポートは区別されません。ローカルでは `auth.localhost` を使い、別ポートの `localhost` とセッションが混ざらないようにします。開発サーバーは `http://localhost:3000` でも待ち受けますが、本番以外ではページの GET / HEAD を `WEBAUTHN_ORIGIN`（既定 `http://auth.localhost:3000`）へリダイレクトします。

`Max-Age` の既定は 30 日（`SESSION_MAX_AGE_SECONDS`、未設定時 `2592000`）。ブラウザを閉じても Cookie は残ります。

| 項目 | 仕様 |
|------|------|
| Cookie 名 | `__Host-session` |
| 値 | 暗号学的乱数トークン |
| 方式 | 永続 Cookie + Redis 検証、スライディング 30 日 |

## 5. セッションの有効期間

スライディング方式です。最後にアクセスしてから 30 日間アクセスがなければログインを要求します。

通常アクセスでは Token 自体は変更せず、Cookie の Max-Age と Redis キーの TTL（`EXPIRE`）のみ更新します。`revokedAt` は用いず、キー削除が失効です。

## 6. サーバー側検証

Cookie だけを信頼せず、リクエストごとに Redis で Session を検証します。

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
     Credential が 0 件、または必要な AppGrant が無いときは TTL も Cookie も延ばさない
       ↓
     許可されたアクセスだけ EXPIRE（TTL 延長）+ Cookie Max-Age 再設定
       ↓
     認証済み
```

## 7. ログアウト

Cookie 削除と、当該 Session の Redis キー削除（`DEL sess:{appId}:{tokenHash}` + 索引からの `SREM`）を行います。他アプリと他デバイスの Session には影響しません。

## 8. 全セッション失効

パスワード再設定完了時など:

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

ユーザーは複数の WebAuthn Credential と複数の Session を持てます。デバイス追加はメール招待方式とし、招待発行時は既存 WebAuthn による再認証を要求します。

## 10. 短命データ（概要）

いずれも Redis に保存し、TTL で自動失効します。詳細は [redis.md](./redis.md)。

| データ | TTL | 備考 |
|--------|-----|------|
| WebAuthn challenge / reauth-ok | 300 秒 | 消費型（GET + DEL） |
| Rate limit | ウィンドウごと（例: 15 分） | 固定ウィンドウ、`INCR` + `PEXPIRE` |
| DeviceInvite | 3600 秒 | 単回使用、ユーザー索引 SET あり |
| PasswordReset | 3600 秒 | 単回使用、ユーザー索引 SET あり |
| MagicLink | 3600 秒 | 単回使用、ユーザー索引 SET あり、招待専用 |

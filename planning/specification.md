セッションは次の仕様で管理します。

## セッション管理仕様

### 1. 認証方式

パスキー登録後のログインには **WebAuthn** を使用します。

招待ユーザーの初回はマジックリンク、seed 管理者の初回はパスワードログインです。いずれもパスキー登録後は WebAuthn のみでログインします。パスキーでログインできないときの復旧はパスワード再設定です。

```text
WebAuthn Credential
        ↓
    本人確認
        ↓
   Session発行
        ↓
   Cookieに保存
```

WebAuthnのCredentialとSessionは別物として管理します。

---

### 2. ログイン時

認証に成功したら、新しいSessionを発行します。

```text
認証成功
    ↓
User特定
    ↓
ランダムなSession Token生成
    ↓
SHA-256ハッシュをキーにRedisへ保存
    ↓
Cookie発行
```

Session Tokenは暗号学的に安全な乱数から生成します。

Redisには生のTokenを保存しません。キーは Token の SHA-256 ハッシュです。

```text
sess:{tokenHash}
├─ id
├─ userId
└─ createdAt
```

---

### 3. セッションCookie

Cookieは永続Cookieにします。名前は `session` です。

```http
HttpOnly
Secure（本番のみ）
SameSite=Lax
Path=/
Max-Age=2592000
```

`Max-Age=2592000` は30日です。`Secure` は `NODE_ENV=production` のときだけ付けます。

これにより、**ブラウザを閉じてもCookieは残ります**。

したがって、翌日にブラウザを起動してアクセスしても、WebAuthnによる再ログインは不要です。

---

### 4. セッションの有効期間

セッションは**スライディング方式**にします。

つまり、

> 最後にアクセスしてから30日間アクセスがなければログインを要求する

という仕様です。

例えば、

```text
8/1   ログイン
      ↓
      Cookie有効期限：8/31

8/15  アクセス
      ↓
      Cookie有効期限：9/14

8/30  アクセス
      ↓
      Cookie有効期限：9/29
```

というように、アクセスするたびに有効期限を30日延長します。Cookie の Max-Age と Redis キーの TTL は同じ秒数です。

---

### 5. Session Token自体は毎回変更しない

ここは重要です。

通常のアクセスでは、Cookie に載っている

```text
Session Token = ABCDEF...
```

を維持します。

アクセスごとに、

```text
Cookieの有効期限
RedisキーのTTL（EXPIRE）
```

だけを更新します。

**Session Tokenを毎回再生成する必要はありません。**

ただし、新しいログインに成功したときは、新しい Session Token を発行します。

---

### 6. サーバー側でも30日を検証

Cookieだけを信頼しません。

リクエストを受け取ったら、

```text
Cookie
  ↓
TokenをSHA-256
  ↓
Redisの sess:{hash} を検索
  ↓
キーなし / TTL切れ？
  ├─ YES → Session無効 → ログイン要求
  └─ NO  → 認証済み（TTLとCookie期限を30日延長）
```

とします。

つまり、**CookieとRedisの両方でセッションの有効性を管理**します。

Cookieが何らかの理由で残っていても、Redis側でキーが無ければログインできません。

---

### 7. ログアウト

ユーザーがログアウトした場合は、

```text
当該SessionのRedisキーを削除
     ↓
Cookie削除
```

とします。

Cookieを削除し、Redis上のそのSessionも削除します。他デバイスのSessionには影響しません。

---

### 8. 複数デバイス

ユーザーは複数のWebAuthn Credentialを持てるようにします。

```text
User
├─ WebAuthn Credential（PC）
├─ WebAuthn Credential（スマートフォン）
└─ WebAuthn Credential（タブレット）
```

さらにSessionもデバイスごとに独立させます。

```text
User
├─ Session（PC）
├─ Session（スマートフォン）
└─ Session（タブレット）
```

そのため、PCからログアウトしてもスマートフォンのSessionには影響しません。

---

### 9. デバイス追加

デバイス追加はメール招待方式にします。

```text
既存ユーザー
    ↓
デバイス追加を要求
    ↓
メール招待
    ↓
招待Token
    ↓
WebAuthn Credential登録
    ↓
新しいデバイス追加
```

招待TokenとSession Tokenは**完全に別物**として扱います。

また、既にログインしているユーザーがデバイスを追加する場合は、重要操作なので**既存のWebAuthnによる再認証**を要求します。

---

## 最終的な動作

全体としては次のようになります。

```text
初回アクセス
    ↓
Session Cookieなし
    ↓
ログイン（パスキー登録後はWebAuthn）
    ↓
Session発行
    ↓
Cookie（30日）発行
    ↓
──────────────────
通常利用
    ↓
Cookie送信
    ↓
RedisでSession確認
    ↓
キーが存在しTTL内
    ↓
ログイン済み
    ↓
Cookie期限を30日延長
Redis TTLを30日延長
──────────────────
```

30日間アクセスしなかった場合：

```text
アクセス
  ↓
Cookieなし/期限切れ
または
RedisのTTL切れ（キー不存在）
  ↓
Session無効
  ↓
WebAuthnログイン
  ↓
新しいSession発行
```

そして、

```text
ユーザーがログアウト
        ↓
当該SessionのRedisキーを削除
        ↓
Cookie削除
```

となります。

### 最終仕様

| 項目 | 仕様 |
| --- | --- |
| 認証 | パスキー登録後は WebAuthn。初回はマジックリンクまたはパスワード。復旧はパスワード再設定 |
| Session | Redis管理（`sess:{tokenHash}`） |
| Session Token | 暗号学的乱数。Cookieに生値、Redisキーは SHA-256 |
| Redisの値 | `id` / `userId` / `createdAt` |
| Cookie | 名前 `session`。HttpOnly / SameSite=Lax / Path=/（Secure は本番のみ） |
| Cookie寿命 | 30日 |
| Cookie方式 | 永続Cookie |
| 有効期限 | 最終アクセスから30日（Redis TTL） |
| アクセス時 | Cookie期限と Redis TTL を30日延長 |
| Session Token | 通常アクセスでは変更しない |
| 30日アクセスなし | Session無効・WebAuthn再認証 |
| ログアウト | Cookie削除＋当該Redisキー削除 |
| 複数デバイス | Credential / Sessionともに複数管理 |
| デバイス追加 | メール招待＋WebAuthn登録 |
| 重要操作 | WebAuthnによる再認証 |

この仕様なら、**「普段はログインを意識せず使えるが、1か月使わなければWebAuthnで再認証する」**という挙動になります。

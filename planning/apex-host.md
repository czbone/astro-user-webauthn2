# 参加アプリの頂点ドメイン

本ファイルは、参加アプリのホストに `PARENT_DOMAIN` 自身を許す変更の下書きです。ログイン、引き渡し、Cookie、パスキーは [multi-app-auth.md](./multi-app-auth.md)、[participant-app.md](./participant-app.md)、[specification.md](../docs/specification.md)、[session-management.md](../docs/session-management.md) に従います。本ファイルが変えるのは、参加アプリのホストとして許す名前だけです。

これは下書きです。確定するまでは [multi-app-auth.md](./multi-app-auth.md) の「頂点ドメインは拒否する」が優先します。確定するときは、まず `docs/specification.md` を更新し、その内容に合わせてルールファイルも更新します。

## 1. 変えること

`PARENT_DOMAIN=example.com` のとき、参加アプリのオリジンを `https://example.com` にできます。認証サーバーは `auth.example.com` のような直下サブドメインのままです。

```text
example.com            参加アプリ（頂点。1オリジンだけ）
auth.example.com       認証サーバー
app.example.com        別の参加アプリ（直下の1ラベル）
foo.app.example.com    拒否
```

## 2. 許すホスト

親ドメインは環境変数 `PARENT_DOMAIN` で一つに固定します。公開サフィックスからの推定はしません。`com` や `co.jp` を `PARENT_DOMAIN` にはしません。

参加アプリのホストは、次のどちらかです。比較の前にホストと `PARENT_DOMAIN` を小文字にします。

| 形 | 例（`PARENT_DOMAIN=example.com`） |
|----|--------------------------------------|
| `PARENT_DOMAIN` 自身 | `example.com` |
| `{ラベル}.{PARENT_DOMAIN}` | `app.example.com` |

ラベルは1つで、小文字・数字・ハイフンです。先頭と末尾のハイフンは拒否します。`App` に親ドメイン列は置かず、正は各アプリの完全オリジンです。

次は拒否します。

- もう一段深いホスト（`foo.app.example.com`）
- 認証サーバーと同じホスト
- `PARENT_DOMAIN` が `localhost` のときの頂点 `localhost`

頂点に置けるオリジンは、`App.origin` の一意制約で一つです。`https://example.com` を登録したあとも、`https://www.example.com` のような直下サブドメインは別の参加アプリとして登録できます。オリジンの正規化、本番の `https`、戻り先 URL のオリジン一致は現行のままです。ポートはオリジンに含め、ホスト名の判定には使いません。

登録時の拒否メッセージは「ホストは親ドメインか、その直下のサブドメインである必要があります」です。

## 3. 認証サーバー

認証サーバーのホストと `WEBAUTHN_RP_ID` は、`PARENT_DOMAIN` の直下のサブドメインのままです。頂点にはしません。RP ID を親ドメインにしないので、頂点の参加アプリも他のサブドメインも、認証サーバー向けのパスキー認証を開始できません。

起動時の検査メッセージは現行のままです。`WEBAUTHN_RP_ID` が直下のサブドメインでないときはエラーにします。

## 4. 登録と引き渡し

参加アプリの登録と `GET /auth/handoff` は、同じホスト規則で判定します。登録できるホストは、引き渡しでも受けます。

引き渡しの他の条件は現行のままです。認証サーバーの有効なセッション、Credential が 1 件以上、実効許可が `allow`、`redirect_uri` が `App.redirectUris` と完全一致、戻り先のオリジンが `App.origin` と一致し、認証サーバーのオリジンとは別であることです。

引き渡しコードは 60 秒、`GETDEL` の単回です。戻り先の応答には `Referrer-Policy: no-referrer` と `Cache-Control: no-store` を付けます。頂点ドメインでも、コードをサーバーで消費してから画面を返します。

## 5. Cookie

セッション Cookie はホスト専用のままです。

| 項目 | 仕様 |
|------|------|
| 名前 | `__Host-session`（引き渡し開始時の `__Host-handoff` も同じ） |
| 属性 | `Secure`、`HttpOnly`、`SameSite=Lax`、`Path=/`、`Domain` なし |

`__Host-` は、ブラウザが `Domain` なしを強制する接頭辞です。頂点の参加アプリに置いたセッショントークンは、認証サーバーや他のサブドメインへ送りません。認証サーバーのセッショントークンも頂点へ送りません。認可に読む Cookie は `__Host-session` だけです。

頂点の参加アプリが `Domain=PARENT_DOMAIN` を付けた別の Cookie を出すと、その Cookie は認証サーバーを含むサブドメインへ送られます。それはセッションではありません。認証サーバーも参加アプリも、その Cookie を認可に使いません。

`example.com` と `auth.example.com` は同一サイトです。これは直下サブドメインの参加アプリでも同じです。変更系リクエストは、自オリジンと完全一致する `Origin` だけを受けます。

## 6. 変えないこと

- Redis のキー、引き渡しコードの中身、セッションの作成権限
- パスキーの儀式を認証サーバーのオリジンだけに置くこと
- 開発のホスト。`PARENT_DOMAIN=localhost` では `auth.localhost` と `app.localhost` のように直下の名前で分ける。`localhost` はポートを区別しないため、頂点にはしない
- ログアウト、利用許可、共通ロール

## 7. 確定時に更新する箇所

確定した内容は次へ反映します。

| 箇所 | 反映 |
|------|------|
| `docs/specification.md` | `PARENT_DOMAIN` の説明。参加アプリは親ドメイン自身か直下の1ラベル。認証サーバーは直下のサブドメイン |
| `planning/multi-app-auth.md` | ホスト規則の「頂点ドメインは拒否する」を、本ファイルの規則に置き換える |
| `.cursor/rules/auth.mdc` | 「アプリのホストは `PARENT_DOMAIN` の直下サブドメインだけ」を、参加アプリと認証サーバーで分けて書く |

実装では、認証サーバー用の直下判定は残します。参加アプリの登録と引き渡しだけ、親ドメイン自身も許す判定にします。対象は `src/server/auth/app-host.ts`、`src/server/auth/app-registration.ts`、`src/server/auth/handoff.ts` と、そのテストです。

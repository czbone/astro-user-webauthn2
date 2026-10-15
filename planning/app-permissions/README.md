# 権限仕様

アプリの利用可否は、アプリごとの既定値と、利用者ごとの例外設定で決定します。利用者全員分の行は作成しません。

認証サーバーは、認証、ユーザー管理、参加アプリの登録・権限管理を担い、投稿などの業務機能は提供しません。認証サーバー自身の管理操作は `User.role` に基づいて認可し、参加アプリへのアクセス可否は `App.defaultPermission` と `AppGrant` に基づいて判定します。認証サーバー自身のアクセス判定には `AppGrant` を使用しません。

認証サーバーと参加アプリ間の引き渡し、Cookie、Redis、パスキーの仕様は、認証サーバーの [multi-app-auth.md](https://github.com/czbone/astro-user-webauthn2/blob/main/planning/multi-app-auth.md) と [participant-app.md](https://github.com/czbone/astro-user-webauthn2/blob/main/planning/participant-app.md) に従います。権限の決定方法については、本ディレクトリの文書を正とし、リンク先の記述に優先します。

投稿機能と `Post` データモデルは廃止します。既存文書に記載された投稿機能の定義は、本仕様に置き換えます。実装時には、既存の投稿 API、画面、データモデル、関連する管理統計も削除し、正本の仕様書にも本方針を反映します。

| 文書 | 内容 |
| --- | --- |
| [grant.md](grant.md) | 認証サーバーと参加アプリが共通で利用する仕様 |
| [auth-server.md](auth-server.md) | 認証サーバーの権限管理、管理画面/API、引き渡し条件 |
| [participant-app.md](participant-app.md) | 参加アプリのアクセス可否の判定、画面、判定に用いる SQL |

利用許可として認める値は `allow` のみです。`admin` と `user` は参加アプリの業務ロールではなく、過去に利用していた値です。マイグレーションで `allow` に置き換えます。業務ロールは各参加アプリで管理し、本ディレクトリで定める利用許可とは別に判定します。

# 権限の仕様

アプリの利用権限は、アプリの既定と、利用者ごとの例外で決めます。利用者全員の行は作りません。

認証サーバーは認証、ユーザー管理、参加アプリの登録と権限管理を担い、投稿などの業務機能は持ちません。認証サーバー自身の管理操作は `User.role` で認可し、参加アプリへのアクセスは `App.defaultPermission` と `AppGrant` から決めます。認証サーバー自身への入場判定に `AppGrant` は使いません。

引き渡し、Cookie、Redis、パスキーは、認証サーバーの [multi-app-auth.md](https://github.com/czbone/astro-user-webauthn2/blob/main/planning/multi-app-auth.md) と [participant-app.md](https://github.com/czbone/astro-user-webauthn2/blob/main/planning/participant-app.md) に従います。本ディレクトリは、その中の権限の決め方を置き換えます。

投稿機能と `Post` データモデルは廃止します。本仕様は、投稿機能を定義している既存文書より後の構成を定めます。実装時には、既存の投稿 API、画面、データモデル、関連する管理統計も削除し、正本の仕様書を本方針に合わせます。

| 文書 | 内容 |
| --- | --- |
| [grant.md](grant.md) | 認証サーバーと参加アプリが同じ手順で使う仕様 |
| [auth-server.md](auth-server.md) | 認証サーバーの権限管理、管理画面/API、引き渡し条件 |
| [participant-app.md](participant-app.md) | 参加アプリの解決、画面、参照する SQL |

今の実装は、利用者ごとの `AppGrant` が `admin` または `user` のときだけ通します。本ディレクトリは、これからの仕様です。

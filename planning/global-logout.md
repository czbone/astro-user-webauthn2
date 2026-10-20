# 全体のログアウト

本ファイルは、認証サーバーと参加アプリのログアウトを一つにする仕様です。ログイン、引き渡し、Cookie のホスト専用は [multi-app-auth.md](./multi-app-auth.md) のままです。参加アプリの画面と `POST /logout` の置き場所は [participant-app.md](./participant-app.md) です。Redis のキーは [redis.md](../docs/redis.md) です。

ログアウトは常に、そのユーザーの全セッション失効です。認証サーバーの「すべてのアプリからログアウト」と、ホストのセッションだけを消すログアウトはありません。

## 1. 変えないこと

ログインの入口は変えません。認証サーバーがセッションを発行し、参加アプリは引き渡しで自分の `__Host-session` を受け取ります。認証サーバーにログインしただけでは、参加アプリの Cookie は発行しません。参加アプリを開いたときの引き渡しは [multi-app-auth.md](./multi-app-auth.md) のとおりです。

Cookie に `Domain` は付けません。`__Host-session` はホスト専用のままです。パスキー未設定セッションがログアウトできることも変えません。

パスワード再設定、招待マジックリンクの再送、メールアドレス変更の確定、アカウントの無効化、無効化の再実行、無効ユーザーのセッション解決は、これまでどおり全セッションを失効します。本ファイルのログアウトは、その同じ手順です。

## 2. ログアウトの効果

ログアウトは、操作したホストが認証サーバーでも参加アプリでも、次を行います。

```text
SMEMBERS sess:user:{userId}
  ↓
各 sess:{appId}:{tokenHash} を DEL
  ↓
sess:user:{userId} を DEL
  ↓
操作したホストの __Host-session を削除
```

対象は、そのユーザーの全アプリ、全ブラウザ、全端末のセッションです。索引に含まれる認証サーバーのセッションと、参加アプリのセッションを区別しません。他のセッションを残すログアウトはありません。

失効のあと、まだ開いていないホストに Cookie が残っていても、Redis にキーが無いので認可しません。次のリクエストで、そのホストは Cookie を削除して未認証にします。認証サーバーはページ解決で、参加アプリはセッション解決で、すでにキーが無い Cookie を削除します。

```text
ログアウトしたホスト
  → その場で Cookie を削除する
まだ開いていないホスト
  → Cookie は残る
  → 次のリクエストでキーが無く、Cookie を削除して未認証
```

スライディング有効期限はセッションごとです。ログアウト以外で、あるホストのセッションだけが期限切れになることは、これまでどおり起きます。

## 3. 認証サーバー

画面のログアウトは一つです。文言は「ログアウト」です。「すべてのアプリからログアウト」は出しません。

`POST /api/auth/logout` だけです。`requireAuth` のまま、パスキーの有無では拒否しません。処理はセクション 2 の全失効と、認証サーバーの Cookie 削除です。成功後の画面は `/login` です。

`POST /api/auth/logout-all` は提供しません。

## 4. 参加アプリ

`POST /logout` だけです。`Origin` が `APP_ORIGIN` と完全一致するときだけ処理します。認証サーバーの HTTP は呼びません。

セッションがあるときは、セクション 2 の全失効を行います。`userId` は、自分の `sess:{APP_ID}:{tokenHash}` から読みます。索引に含まれる他アプリのキーも、このログアウトでは削除します。

その後、`__Host-session` と `__Host-handoff` を削除し、`/logged-out` へ 303 します。`/logged-out` から引き渡しは開始しません。

普段の検証で行う `GET`、`EXPIRE`、自分のセッションの `DEL` は、自分の `sess:{APP_ID}:*` と `handoff:{APP_ID}:*` だけです。他アプリのセッションキーを削除してよいのは、このログアウトで索引から得たキーだけです。ユーザー索引の `EXPIRE` は行いません。

公開画面から送る `POST /logout` も、この手順です。手順の詳細は本ファイルを正とし、[participant-public-pages.md](./participant-public-pages.md) は入口の条件だけを定めます。

## 5. Redis の権限

参加アプリ共通ユーザー `app_participant` に、ユーザー索引の読み取りと削除を足します。セッションの `SET` と、索引への `SADD` は与えません。`KEYS` と `SCAN` も与えません。

| パターン | 許可するコマンド |
|----------|------------------|
| `sess:*` | `GET`、`EXPIRE`、`DEL` |
| `handoff:*` | `GET`、`GETDEL`、`DEL` |
| `sess:user:*` | `SREM`、`SMEMBERS`、`DEL` |

`REDIS_KEY_PREFIX` があるときは、各パターンの先頭にそのプレフィックスを付けます。プレフィックスが空のときのコマンドは次です。

```text
ACL SETUSER app_participant reset on >password (~sess:* +get +expire +del) (~handoff:* +get +getdel +del) (~sess:user:* +srem +smembers +del)
```

`PARTICIPANT_REDIS_PASSWORD` がある環境では、認証サーバーが次のリクエストの前に、この ACL でユーザーを上書きします。

侵害された参加アプリは、利用者 ID を知っていれば、そのユーザーのセッションキー名を列挙し、全セッションを削除できます。生トークンは索引に無いので、列挙だけでは他アプリへなりすましできません。セッションの新規作成は、これまでどおり `SET` と `SADD` が無いことで拒否します。

## 6. 関連する文書

次の文書は、本ファイルのログアウトに従います。レビュー文書（`docs/reviews/`）は過去の記録なので変えません。

- [specification.md](../docs/specification.md) のセッション表と `POST /logout`
- [session-management.md](../docs/session-management.md) セクション 7 と 8
- [redis.md](../docs/redis.md) のログアウト操作と、`app_participant` の ACL
- [multi-app-auth.md](./multi-app-auth.md) セクション 2、7、13
- [participant-app.md](./participant-app.md) セクション 1、6、8、10
- [participant/participant-access.sql](./participant/participant-access.sql) の ACL コメント
- [specification.md](./specification.md) セクション 7

認証サーバーでは、`POST /logout` が全失効を呼びます。`POST /logout-all` と、画面の二つ目のボタンはありません。テストは、ログアウトが認証サーバーと参加アプリの両方のセッションを消すこと、およびセクション 5 の ACL を確認します。

## 7. 必須事項

- ログアウトは、そのユーザーの全セッション失効だけである
- 認証サーバーに「すべてのアプリからログアウト」を別に置かない
- 参加アプリの `POST /logout` も同じ全失効である
- 参加アプリはログアウトのために認証サーバーの HTTP を呼ばない
- 操作したホスト以外の Cookie は、次のリクエストでキーが無いことを確認して削除する
- セッション Cookie に `Domain` を付けない
- 参加アプリにセッションの `SET` と索引への `SADD` を与えない
- 他アプリのセッションキーを削除してよいのは、ログアウトで索引から得たキーだけである

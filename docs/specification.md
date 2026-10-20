# WebAuthn ユーザー認証アプリケーション仕様

本ドキュメントは、本プロジェクトの確定仕様を定めます。セッション管理の詳細は [session-management.md](./session-management.md)、Redis キー設計は [redis.md](./redis.md) を参照してください。

## 概要

Astro 7（SSR）+ Hono + Prisma 7 + PostgreSQL + Redis + React Islands による、管理者招待制の WebAuthn（パスキー）認証アプリです。

- 通常ユーザーは招待マジックリンクで初回ログインし、パスキー登録後はパスキーのみでログインする
- seed 管理者だけが初回パスワードログインする。パスキー登録後はパスワードログイン不可
- セッションは Cookie + Redis（30日スライディング）
- WebAuthn challenge・レート制限・デバイス招待・復旧用パスワード再設定・招待マジックリンクトークンも Redis
- 永続ドメインデータ（User / Credential / App / AppGrant）は PostgreSQL
- デバイス追加・アカウント復旧・ユーザー招待はメール連携（`MAIL_MODE` で切替）

## 認証フロー

ログイン方法は、ユーザー種別と利用タイミングによって異なります。

| 対象         | 初回                                                                                                          | 日常         | パスキー不能時                 |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------ |
| 招待ユーザー | マジックリンク（確認ボタンでトークンを消費し、Session を発行）。パスワードは推測困難なハッシュで保存し、ユーザーは使用しない | パスキーのみ | パスワード再設定（下記の復旧） |
| seed 管理者  | 環境変数で設定した初期パスワード                                                                                      | パスキーのみ | 同じ復旧                       |

1. admin または manager がユーザーを招待すると、サーバーは招待用マジックリンクをメールで送り、同時に Credential のない User を作成する
2. seed 管理者は、環境変数で設定した初期パスワードを使って作成する
3. ログイン後は **パスキーの登録が必須**（未登録の間は setup / logout / me 以外の操作を拒否）
4. Credential が1件以上登録された後は **パスキーログインのみ**（パスワードログインとマジックリンクは拒否）
5. 2台目以降のパスキーは、既存端末の再認証＋デバイス招待メールのみ（クリックではログインしない）
6. **復旧**（自動化しない）: パスキーでログインできない場合に限る。招待ユーザーと seed 管理者で手順は共通。`/login` の「ログインできないとき」からメールを送り、新しいパスワードを本人が入力する。全パスキーと全 Session を失効させた後、自動ログインし、パスキーを再登録する

復旧について:

- パスキーでログインできない場合（端末を紛失した場合や、最後のパスキーを無効化したい場合）に開始する
- 初回セットアップ画面やデバイス招待画面には復旧機能を表示せず、`/login` から利用できるようにする
- 招待ユーザーは Credential が1件でも登録されると、マジックリンクでのログインに戻れないため、パスワード再設定が唯一の復旧手段となる
- ここで設定したパスワードは、パスキーを再登録するまでの一時的なログインにのみ使用する。再登録後の日常的なログインには使用しない
- パスキー再登録前にログアウトした場合、ログイン画面は招待ユーザーと同じ（パスキー 0 件）になる。再送が主で、復旧で決めたパスワードでも入れる
- 再設定は自動化しない（メール誤タップでの全パスキー削除を防ぎ、再登録までの再入場を残す）
- API はパスキーが残っているかを検査しない。そのため、メールを受信できる人は復旧を完了でき、その時点で使用可能なパスキーが残っていてもすべて削除される

```text
管理者招待 → マジックリンクメール → 確認ボタンでログイン → パスキー必須登録 → 利用開始
seed 管理者: 初期パスワードログイン → パスキー必須登録 → 利用開始
日常: パスキーログイン（または有効 Session）→ デバイス管理
端末追加: 既存端末で再認証 → 招待メール → 新端末でパスキー登録（ログインしない）
復旧: ログインできないとき → メール → 新パスワード（警告）→ 自動ログイン → パスキー再登録
```

## メールアドレス変更

同じ人のメールボックスが変わった場合は、`User.id` を維持したままメールアドレスだけを変更します。アカウントは作り直さず、パスキー、ロール、`AppGrant` も維持します。本人が自分のアドレスを変更する経路は設けません。メールアドレスを別の人が使う場合は、この操作を使わず、通常の招待で別の `User` を作成します。

申請と確定の要件は同じです。操作者は、パスキーを登録済みの `admin` または `manager` である必要があります。

- `admin` は、対象のロールが `admin`、`manager`、`user` のいずれであっても変更を申請し、受信確認済みの変更を確定できる
- `manager` は、対象の現在のロールが `user` または `manager` の場合に限り、変更を申請・確定できる。対象が `admin` の場合は、申請も確定も拒否する
- 申請した人と確定する人は別人でもよい。確定の可否は、確定する人とその時点の対象ロールで決める
- 一覧には、その操作者が確定できる対象の手続きだけを返す。manager には `admin` 宛ての新しいアドレスを表示しない
- `/admin/users` の変更操作は admin と manager に表示する。manager が対象を選ぶ際は `admin` を選択肢に含めない。API でも同じ条件で拒否する

1. 操作者が対象ユーザーと新しいアドレスを指定して申請する。この時点では `User.email` もセッションも変更しない。メールアドレスは招待時と同様に小文字へ正規化して一意性を確認する。対象ユーザーや他のユーザーが現在使用しているアドレス、および他の未使用 EmailChange が確保しているアドレスは受け付けない。ユーザー招待でも、未使用 EmailChange が確保しているアドレスは受け付けない。申請の有無から対象ユーザーを特定できる情報は返さない。再申請時は、そのユーザーの未使用のメール変更トークンだけを無効にして、新しいリンクを送る。
2. 新しいアドレス宛てに確認リンクを送る。平文トークンはメール内 URL にのみ含め、Redis キーには SHA-256 ハッシュを使用する。TTL は1時間とする。GET リクエストでは受信確認を完了させない。
3. 受信者が確認ボタンを押すと、該当する EmailChange に受信確認時刻を記録する。この時点では `User.email`、セッション、パスキー、他のメールトークンを変更せず、セッションも発行しない。すでに受信確認済みの場合は、その状態を返す。トークンは削除せず、有効期限も延長しない。
4. ログイン中の操作者は、受信確認済みのアドレスを確認し、自分のパスキーで再認証して変更を確定する。再認証にはデバイス招待とは別のチャレンジを使い、相互に流用できないようにする。書き込むアドレスはクライアントから受け取らず、受信確認済みレコードの値だけを使う。確定直前に、対象ユーザーの現在のロールを PostgreSQL から再取得する。申請後に対象が `admin` になっていた場合、manager による確定は拒否する。また、そのアドレスが他のユーザーの現在のアドレスや、他の未使用 EmailChange が確保しているアドレスと重複しないことも確認する。検査に通過したら `User.email` を更新し、対象ユーザーの全セッションを `sess:user:{userId}` 経由で失効させる。未使用の MagicLink、DeviceInvite、PasswordReset、および該当する EmailChange を無効化する。古いアドレスには変更通知を送るが、新しいアドレス、復旧リンク、ログインリンクは記載しない。
5. 確定後、パスキーが 1 件以上ある利用者は、ログイン画面で新しいアドレスを入れ、既存のパスキーで入り直す。パスキーの `userID` は `User.id` のままなので再登録は不要。認証器に残る `userName` は登録時のアドレスのままでよい。パスキーが 0 件の利用者は、ログイン画面の既存のマジックリンク再送を新しいアドレスへ使う。

受信済みのまま期限が切れた申請は無効になる。アドレスは変わらない。対象が申請後に `admin` になった手続きは、manager の一覧から外れる。そのアドレスの予約は、期限が切れるか admin が確定または再申請するまで残る。操作者が自分のアドレスを確定したときも、自分のセッションは確定時に失効する。再認証はその前に済ませ、再入場は新しいアドレスでのパスキーログインである。

`SEED_ADMIN_EMAIL` は User が空のときの作成にだけ使う。変更後のデータベース上のアドレスには追従しない。

## ロールと権限

| 機能                                               | user                        | manager                       | admin                  |
| -------------------------------------------------- | --------------------------- | ----------------------------- | ---------------------- |
| パスワード初回ログイン                             | ×（招待ユーザーは使わない） | ×（招待ユーザーは使わない）   | ○（seed 管理者の初回） |
| 招待マジックリンク（初回）                         | ○                           | ○                             | ○                      |
| パスキー設定（ログイン後必須）                     | ○                           | ○                             | ○                      |
| パスキーログイン                                   | ○                           | ○                             | ○                      |
| アカウント復旧（パスワード再設定・パスキー全削除） | ○                           | ○                             | ○                      |
| 自分のデバイス管理                                 | ○                           | ○                             | ○                      |
| `/dashboard`                                       | ×                           | ×                             | ○                      |
| ユーザー招待・一覧                                 | ×                           | ○（`user` のみ）              | ○                      |
| 共通ロールの変更                                   | ×                           | ×                             | ○（最後の有効な admin は降格できない） |
| アカウントの無効化・再有効化                       | ×                           | ×                             | ○（最後の有効な admin は無効化できない） |
| メールアドレス変更（受信確認のあとパスキーで確定） | ×                           | ○（`user` と `manager` のみ） | ○（全ロール）          |
| アプリ登録・利用許可・`AppGrant` の編集            | ×                           | ×                             | ○                      |

- ロール値: `admin` / `manager` / `user`
- 招待時の role 既定は `user`。`admin` は `admin` / `manager` / `user` を指定できる。`manager` は `user` だけを指定できる
- 共通ロールの変更は admin だけが行う。成功と、最後の有効な admin を降格しようとした失敗は `RoleChange` に残す。admin 以外の呼び出しは履歴に残さない
- 有効な admin は、`role` が `admin` かつ `disabledAt` が null のユーザーである。最後の1人は降格も無効化もできない。判定と更新は同じトランザクションで、対象行と有効な admin 行をロックしてから行う。削除 API は置かない
- 無効ユーザー（`disabledAt` がある）にはセッションを発行しない。ログイン方式の判定、パスキー認証の開始、デバイス招待によるパスキー登録も拒否する。既存セッションは解決時に、そのユーザーの全セッションを破棄する。無効化に成功したとき、およびすでに無効なユーザーへの無効化の再実行でも、そのユーザーの全セッションを失効する。再有効化はセッションを作らない
- `User.role` は認証サーバーの管理操作と、参加アプリが読む共通ロールである。利用許可の計算には使わない。共通ロールが `admin` や `manager` でも、利用許可がなければ参加アプリへは渡さない
- 認証サーバー自身への入場に `AppGrant` は使わない

## 参加アプリの利用許可

参加アプリに入れるかは、アプリの既定と利用者ごとの例外で決める。利用者全員の `AppGrant` は作らない。この値は業務ロールではない。

- `App.defaultPermission`: `NULL`、または `allow`。`NULL` は、行がある人だけ入れる。空文字と `none` は既定に書かない
- `AppGrant.permission`: `allow`、または `none`。`none` はその利用者だけを拒否する。`(userId, appId)` は一意
- 実効許可は `User.role` を見ない。`App` が無い、または `AppGrant` が `none`・空・`allow` 以外なら付与なし。行があるときはその値を使い、既定へは進まない。行が無く既定が `allow` なら入れる。それ以外は付与なし
- 例外行は既定を置き換える
- セッション JSON に利用許可も `User.role` も載せない。既定や行の変更は次のリクエストから効き、セッションの作り直しは要らない
- 認証サーバー自身の `App` 行は対象外。`isAuthServer` は `App.id === APP_ID` で算出し、列にはしない。そのアプリへの引き渡し、`App` 行の更新・削除、`AppGrant` の作成・更新・削除は拒否する。一覧では固定テキストにし、空の `redirectUris` は出さない

## 参加アプリの認可

参加アプリ本体はこのリポジトリに置かない。参加アプリは次の順で、サーバー側の操作を認可する。クライアントが送ったロール名は信頼しない。識別子は変わらない `User.id` を使い、メールアドレスは識別子にしない。

1. セッションを検証し、共通ユーザー ID を得る
2. `disabledAt` があれば拒否する。パスキーが無いときも拒否する
3. 上の利用許可が `allow` でなければ、業務操作も管理操作も拒否する
4. 業務操作は、そのアプリが `User.id` に割り当てたアプリ内ロールで判定する。ロール定義は、最初はアプリ内の固定設定でよい
5. 共通 `admin` は、アプリ内ロールを割り当てなくても、そのアプリの管理操作ができる。業務ロールそのものは自動では付かない
6. 共通 `manager` は、全参加アプリのアプリ内ロールを割り当て・変更・解除できる。管理対象アプリの個別テーブルは作らない。`manager` だけでは業務操作はできない

## データベースの分担

参加アプリ用の PostgreSQL データベースは別に作らない。認証サーバーと同じデータベースを使う。

共有テーブルは PostgreSQL スキーマ `public` に置く。定義は認証サーバーの `prisma/schema.prisma` だけが持ち、マイグレーションも認証サーバーだけが行う。対象は `User`、`WebAuthnCredential`、`App`、`AppGrant`、`RoleChange` である。参加アプリの Prisma 定義にはこれらのモデルを置かず、参加アプリから `public` をマイグレーションしない。

アプリ固有のテーブルは、アプリごとに `public` 以外の PostgreSQL スキーマへ置く。定義とマイグレーションは、そのアプリのリポジトリにある `schema.prisma` だけが持つ。Prisma の `schemas` にはそのスキーマだけを書く。定義に含まれないスキーマのテーブルは差分にしない。あるアプリのマイグレーションが、別のアプリや `public` のテーブルを変更してはならない。

アプリ内ロールの割り当ては、そのアプリのスキーマに `User.id` をキーとして置く。認証サーバーの `AppGrant` には書かない。ロール定義は、最初はアプリ内の固定設定でよい。あるアプリの変更が、別のアプリのロールに影響してはならない。

共有テーブルの参照は、参加アプリ共通のログインロール `app_participant` の `SELECT` で行う。このロールでは共有テーブルを作成しない。固有テーブルへの書き込みは、そのアプリのスキーマにだけ与える。接続手順は [redis.md](./redis.md) の「参加アプリの接続権限」に従う。

## データモデル

### PostgreSQL（永続）

- `User`: id(UUID), email, password(scrypt ハッシュ), name, role, disabledAt（null が有効）
- `WebAuthnCredential`: credentialId, publicKey, counter, transports, deviceName（登録時は必須。同一ユーザー内で重複不可。既存の未設定レコードは null 可）
- `App`: id, name, origin, redirectUris, defaultPermission（nullable。`allow` または null）
- `AppGrant`: userId, appId, permission（`allow` または `none`）。`userId` は必須。一意は `(userId, appId)`
- `RoleChange`: actorId, targetId, fromRole, toRole, success, reason, createdAt。ユーザー削除は無いので、外部キーは Restrict

ブラウザへ渡す資格情報一覧は ID のみとする。対象はログインと再認証の `allowCredentials`、登録時の `excludeCredentials`。`transports` は付けない。Chrome は `transports` を絞り込みに使い、候補が 0 件だと「利用可能なパスキーがありません」を出す。

`transports` は登録応答から PostgreSQL に保存し、パスキー認証と再認証で署名を検証するときにだけ使用します。`allowCredentials` は省略せず、入力されたメールアドレスに対応する資格情報だけを指定して認証対象を限定します。

### Redis（短命・セッション）

- Session: `sess:{appId}:{tokenHash}`（値: id, userId, appId, createdAt）+ `sess:user:{userId}` 索引（要素は `{appId}/{tokenHash}`）
- Handoff: `handoff:{appId}:{codeHash}`（TTL 60 秒）
- DeviceInvite: `invite:{tokenHash}` + `invite:user:{userId}` 索引（TTL 1h）
- PasswordReset: `reset:{tokenHash}` + `reset:user:{userId}` 索引（TTL 1h）
- MagicLink: `magic:{tokenHash}` + `magic:user:{userId}` 索引（TTL 1h、招待専用）
- EmailChange: `emailchg:{tokenHash}` + `emailchg:user:{userId}` 索引（TTL 1h、受信済みでもキーは残し、確定または再申請で削除）
- WebAuthn challenge / reauth-ok: `chal:*`（TTL 5分、消費型）
- Rate limit: `rl:*`（固定ウィンドウ）

Session / Invite / Reset / Magic のトークンは、平文のまま Cookie・URL・メールにのみ含め、Redis キーには SHA-256 ハッシュを使用します。使用済みのトークンはキーを削除し、`usedAt` / `revokedAt` は保持しません。

## セッション

| 項目                         | 仕様                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| Cookie 名                    | `__Host-session`                                                                      |
| 属性                         | Secure / HttpOnly / SameSite=Lax / Path=/ / Domain なし / Max-Age=2592000             |
| 方式                         | 永続 Cookie + Redis 検証、スライディング 30 日                                        |
| Token                        | 通常アクセスでは変更しない（Cookie Max-Age と Redis TTL のみ更新）                    |
| ログアウト                   | ユーザー索引の全要素を削除し、操作したホストの Cookie を削除する。他ホストの Cookie は、次のリクエストでキーが無いことを確認して削除する |
| 全失効                       | `sess:user:{userId}` 経由で全キー削除（ログアウト、パスワード再設定時、招待マジックリンク再送時、メールアドレス変更の確定時、アカウント無効化時、無効化の再実行時、無効ユーザーのセッション解決時） |

詳細は [session-management.md](./session-management.md)。

## メール

- `MAIL_MODE=console`: 実送信せずログ出力（ローカル既定）
- `MAIL_MODE=smtp`: nodemailer で実 SMTP 送信
- 対象: ユーザー招待（マジックリンク）、デバイス招待、アカウント復旧（パスワード再設定）、メールアドレス変更（新しいアドレスへの確認、古いアドレスへの通知）

## API 概要

### 認証 `/api/auth`

- `POST /login/password` — Credential 0 件のみ（seed 管理者の初回、および復旧直後のパスキー再登録前）
- `POST /login/method` — メールアドレスからログイン方式を判定。Credential ありはパスキー（options 付き。資格情報一覧は ID のみ）、0 件はマジックリンク。存在しないメールは 401。無効ユーザーは 403 で、方式もオプションも返さない
- `POST /login/passkey/options|verify` — options の資格情報一覧は ID のみ（上記）。無効ユーザーは options を作る前に 403
- `POST /passkey/register/options|verify` — 初回のみセッションから直接登録可。verify はデバイス名必須・同一ユーザーで重複不可
- `POST /magic/consume` — 招待トークン消費（確認ボタン）。パスキー済みは拒否
- `POST /magic/resend` — パスキー 0 件のときだけ再発行。発行時は既存 Session を全削除
- `POST /password-reset/request|confirm` — パスキー不能時の復旧。confirm 確定時に全 Credential 削除。自動化しない（新パスワード入力が必要）
- `POST /email-change/verify` — メールアドレス変更の受信確認。セッションは発行しない。`User.email` は変えない
- `POST /logout` / `GET /me`
- `GET /auth/handoff` — 参加アプリへのセッション引き渡し（`/api` の外）

### 管理者 `/api/admin`

- `GET /users` / `POST /users`（招待マジックリンク＋メール。`AppGrant` は自動では付かない。未使用 EmailChange が押さえているアドレスは 409。一覧は `disabledAt` を含む）
- `PATCH /users/:id/role`（admin だけ。共通ロールを変更し、`RoleChange` を残す。最後の有効な admin の降格は 409）
- `PATCH /users/:id/disabled`（admin だけ。`disabled` が true なら無効化し全セッションを失効する。すでに無効でも再実行で全セッションを失効する。false なら再有効化し、セッションは作らない。最後の有効な admin の無効化は 409）
- `GET /email-changes` / `POST /email-changes`（申請は確認メールを送るだけで `User.email` もセッションも変えない。admin は全ロール、manager は対象の現在のロールが `user` または `manager` のときだけ。一覧は操作者が確定できる対象だけ）
- `POST /email-changes/reauth/options|verify`（確定用。操作者自身のパスキー。デバイス招待の再認証とは別チャレンジ）
- `POST /email-changes/:userId/commit`（受信済みの記録にあるアドレスだけを書き、対象の全セッションを失効する。申請者と別人でもよい。確定直前に対象ロールを読み直し、manager は対象が `admin` なら拒否する）
- `GET /stats`（ユーザー数と、有効な admin の人数）
- `GET /apps` は各アプリに `defaultPermission`（`null` または `allow`）と `isAuthServer` を含める。認証サーバーの行は固定テキストで、値がある項目だけ出す
- `POST /apps` は `id`、`name`、`origin`、`redirectUris`、`defaultPermission` を受け取る。`defaultPermission` は必須で `null` または `allow`。認証サーバー自身の ID は登録できない
- `PATCH /apps/:id` は、参加アプリでは `defaultPermission` を省略すると変えない。指定時は `null` または `allow`。`id` と `origin` は変更しない。認証サーバー自身への `PATCH` は拒否する
- `DELETE /apps/:id` は認証サーバー自身を削除しない
- `GET /grants` は参加アプリの例外行（`none` を含む）を返す。認証サーバー自身の行は返さない
- `PUT /grants` は `userId`、`appId`、`permission`（`allow` または `none`）で upsert する。認証サーバー自身は拒否する
- `DELETE /grants/:userId/:appId` は例外行を消し、その利用者を既定の判定に戻す。認証サーバー自身は拒否する
- 空文字、既定への `none`、一覧に無い値は 400

### デバイス `/api/devices`

- `GET /` / `DELETE /:id`（最後の1件は削除不可）
- `POST /reauth/options|verify`
- `POST /invite`（再認証必須＋メール）
- `POST /register/options|verify`（招待トークン、ログイン不要）。verify はデバイス名必須・同一ユーザーで重複不可。無効ユーザーは 403 で、登録オプションも認証器も作らない

### 引き渡し `GET /auth/handoff`

セッションを作る条件は、認証サーバーの有効なセッション、Credential が 1 件以上、対象アプリの実効許可が `allow`、`redirect_uri` が `App.redirectUris` と完全一致。`appId` が認証サーバー自身、または戻り先のオリジンが認証サーバーと同じときは拒否する。実効許可が付与なしのときはセッションを作らず 403「引き渡し先のアプリを利用できません」。このとき認証サーバーのセッション TTL も延ばさない。共通ロールだけでは引き渡さない。

## 環境変数

- `DATABASE_URL`
- `REDIS_URL`（本番必須、既定 `redis://localhost:6379/`。認証サーバーは読み書きできるユーザー）
- `REDIS_KEY_PREFIX`（任意）
- `PARTICIPANT_REDIS_PASSWORD`（任意。設定時、プロセス起動後の最初のリクエストで参加アプリ共通の Redis ユーザー `app_participant` を用意する。未設定なら作らない。手順と `SET` を与えない理由は [redis.md](./redis.md)）
- `SESSION_MAX_AGE_SECONDS`（任意、既定 `2592000`）
- `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGIN`（開発既定は RP ID `auth.localhost`、オリジン `http://auth.localhost:3000`。RP ID は認証サーバーのホスト名）
- `APP_URL`（開発既定 `http://auth.localhost:3000`。本番では `WEBAUTHN_ORIGIN` と origin が一致すること）
- `APP_ID`（認証サーバー自身の `App.id`。既定 `auth`）
- `PARENT_DOMAIN`（直下サブドメインの親。開発既定 `localhost`）
- `MAIL_MODE` / `SMTP_*`
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
- `DB_LOG_LEVEL`（任意。`silent` / `error` / `warn` / `info` / `query`。未設定は本番 `warn`、開発 `query`）
- `RUN_SEED`（任意。`true` のとき起動時にシード。User が空のときだけ管理者を作成。本番では `SEED_ADMIN_PASSWORD` に既定値以外が必要）

詳細は [redis.md](./redis.md)。参加アプリ用の PostgreSQL ロールと Redis ACL ユーザーの作成手順は、同ファイルの「参加アプリの接続権限」です。

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
- メールアドレス変更の確定時は、対象ユーザーの全 Session を失効し、未使用の DeviceInvite / PasswordReset / MagicLink / EmailChange を無効化する。Credential は削除しない。受信確認だけでは失効しない
- メールアドレス変更の確定用再認証は、デバイス招待の再認証を流用できない
- メールアドレス変更の申請と確定の要件は同じ。`admin` は全ロールを対象にでき、`manager` は対象の現在のロールが `user` または `manager` の場合に限り申請・確定できる。対象が `admin` の場合は、`admin` だけが申請・確定できる
- 招待マジックリンクの再送は、パスキー 0 件で新リンクを発行するときだけ既存 Session を全削除する
- GET ではトークンを消費しない（確認ボタンの POST で消費）

## トレードオフ

- メール受信箱の侵害は初回アカウント掌握および復旧（全パスキー削除）につながる（メール側保護が前提）
- パスキーを持つ admin は全ロールの、パスキーを持つ manager は `user` と `manager` の、受信済みアドレスへ復旧先を移せる。`admin` の復旧先は admin だけが移せる。セッションだけでは確定できず、確認リンクのクリックだけでも確定できない
- パスワード再設定は1台紛失でも全パスキーをリセットする（安全側）。パスキーが残っていても完了できる
- 招待・再設定リンクの可用性は Redis の永続化設定に依存する（Redis 再起動・データ消失で未使用トークンは無効になる）

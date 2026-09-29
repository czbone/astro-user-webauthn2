-- 参加アプリ用の PostgreSQL ロールのひな型です。
-- データベース名、ロール名、パスワードは環境に合わせて置き換えてください。
-- 認証サーバー自身はこのロールを使わず、読み書きできる既存の接続のままです。

-- CREATE ROLE app_participant LOGIN PASSWORD 'replace-me';
-- GRANT CONNECT ON DATABASE your_database TO app_participant;
-- GRANT USAGE ON SCHEMA public TO app_participant;
-- GRANT SELECT ON TABLE "User", "WebAuthnCredential", "App", "AppGrant" TO app_participant;

# 非公開相談の保存・公開前確認

## 現在の境界

- API は `CONSULTATIONS_ENABLED=true` のときだけ有効です。未設定時は状態確認以外を 404 にし、新しい相談テーブルを問い合わせません。
- 所有者はログイン済みセッションの数値 `userId` を使い、毎回 `users.id` が存在することをサーバーで確認して決めます。リクエストの `userId`、`ownerId`、`familyId`、papa/mama 値は受け付けません。
- 一覧、詳細、投稿、変更、削除はすべて `owner_user_id = session userId` を条件にします。他人の UUID、不正な UUID、存在しない UUID は同じ 404 です。
- `users.role = supporter` の利用者、および `supporter_accounts` に紐付く利用者は対象外です。これは既存のサポーター用の家族共有権限とは別の、相談専用の拒否です。`parent_access` は確認しません。
- 既存 `users` 表には有効/停止を表す列がありません。そのため今回意味のある「現在有効な利用者」の確認は、署名済みセッションの数値 ID と対応する `users` 行の存在確認までです。削除済み行の古いセッションは拒否しますが、将来の無効化・退会停止状態を判定する保証はありません。既存表へ active 列は追加していません。
- 既存の LINE ログインが外部主体を検証して設定したセッションを前提にしています。今回 OAuth 全体は変更していません。公開前には、OAuth state を暗号学的乱数にして有効期限・使い捨てを設けること、コールバックのプロキシ由来 host/proto を許可リスト化すること、ログイン成功時のセッション ID 再発行と、ログアウト/アカウント削除時のセッション失効を見直すことが必要です。

## リクエスト保護とデータ最小化

- クライアント向け API は次です。`GET /api/consultations/status` は
  `{enabled, authenticated, eligible, csrfToken, userId}` を返します。
  `userId` はサーバーが確認した数値 ID を文字列化した値（または `null`）で、
  画面側の下書き・キャッシュを本人ごとに切り替えるためだけに使います。
  `GET /api/consultations?offset=0` は
  `{consultations:[{id,title,createdAt,updatedAt}],nextOffset}` を返します。
  `POST /api/consultations` は `{title,requestId}` を受け
  `{consultation}` を返します。`GET /api/consultations/:id` は
  `{consultation,messages:[{id,content,authorType,createdAt}]}`、投稿は
  `POST /api/consultations/:id/messages` に `{content,requestId}`、
  タイトル変更は `PATCH /api/consultations/:id` に `{title}`、削除は
  `DELETE /api/consultations/:id`（204）です。
- 書き込みは、セッションに保存した CSRF トークンを `X-CSRF-Token` で送り、`Origin` がその要求の `req.protocol` と `Host` から得たオリジンと完全一致する場合だけ受け付けます。`Sec-Fetch-Site: cross-site` も拒否します。トークンには発行時の数値ユーザー ID も保存し、同じセッションでログイン利用者が変わった場合は status 取得時にトークンを交換します。書き込み側で交換して受け入れることはなく、以前の利用者の遅延した送信は拒否します。
- 相談本文・タイトルを通常ログ、エラーログ、監査ログ、通知へ書き出しません。相談ルートの JSON 解析エラーも専用の一般エラーとして返し、解析器の本文を含むエラーを上流のエラーログへ渡しません。
- タイトルは 120 文字、本文は 10,000 文字までです。各相談は 200 メッセージまでで、上限を超えた履歴は隠して表示せず、閲覧・追加を明示的に拒否します。
- 一人あたりの相談は 500 件までです。一覧は更新日時・UUID の固定順で 50 件ずつ返し、`offset` は 0〜100,000、続きがある場合は `nextOffset` を返します。これは古い相談を画面の「さらに読み込む」で到達可能にするためです。
- 生成・投稿は UUID の `requestId` を所有者ごと/相談ごとに一意にし、同一内容の再送は同じ結果を返します。異なる内容で同じ ID を使うと 409 です。トランザクション内のロックと一意制約で同時送信も重複しません。

## 削除と外部共有

- `consultation_messages.consultation_id` は `ON DELETE CASCADE` なので、相談削除時にメッセージも削除されます。
- `consultations.owner_user_id` は `ON DELETE RESTRICT` です。ユーザー削除により、本人のみの相談が気付かないうちに消えることを避けるためです。将来アカウント削除を提供する時は、本人確認、保持期間、削除方法を決めた専用処理で相談を先に削除または匿名化します。
- AI、専門職返信、家庭共有、サポーター閲覧、研究用 DB 転送は今回ありません。DB 運用管理者が技術的に読めないという保証もしていません。

## 公開前に決めること

1. 利用者への保存期間・削除方法・同意文、およびバックアップ内の削除反映時期。
2. 本番バックアップ後に `private-consultations-migration.sql` を一度だけ適用する手順とロールバック方針。
3. アカウントの停止/退会状態を表す既存認証の信頼できる仕組み（`users` 表を無計画に変更しない）。
4. 上記 OAuth/セッション強化の設計と、実環境での CSRF・本人/別本人/サポーター拒否の確認。

## 検証状況（引き継ぎ用）

2026-09-17 に、所有確認済みの新しい一時 DB で対象の全テストが成功しました。
通常の開発 DB・本番 DB には接続していません。

1. **できるようになった操作**: ログインした本人の相談の作成、50 件ずつの一覧
   （続きの読み込み）、詳細表示、本人メモの追加、タイトル変更、確認を伴う削除です。
   本文を保存しても AI 回答は表示・生成しません。
2. **主な変更ファイル**: `server/consultations.ts`、`shared/schema.ts`、
   `server/routes.ts`、`client/src/pages/Consultations.tsx`、
   `client/src/hooks/use-consultations.ts`、ルーティングと設定画面、
   `tests/consultations-integration.test.mts`、
   `tests/consultations-browser.test.mts`、一時テスト実行入口、
   `docs/private-consultations-migration.sql`、本ファイルです。
   上限はタイトル 120 文字、本文 10,000 文字、相談ごとに 200 メッセージ、
   一覧は 1 ページ 50 件です。
3. **本人だけであることの確認**: サーバーが署名済みセッションの数値 ID と
   `users` 行を確認し、全リソース操作を所有者条件に限定します。別の本人、
   同じ家庭のパートナー、別家庭、サポーター、管理者キーのみの要求は他人の
   相談を取得・変更できません。削除された利用者行を参照する古いセッションも
   拒否します。サポーター判定は変更可能な `users.role` だけに依存せず、
   `supporter_accounts` の紐付けも確認します。
4. **実行済み検証**:
   - safety テストは 20 件 PASS。
   - サニタイズされた型チェックは exit 0。
   - ネットワーク・listen を厳格に遮断した状態でビルドを確認し、
     `node --import tsx script/build.ts` は完了しました。
   - 最初の `npm run build` は `tsx` CLI が IPC を開こうとして遮断されました。
     ガードを弱めず、同じビルドスクリプトを loader entry で実行する形に
     切り替えています。
   - 既存 CommonJS における `import.meta` の警告 2 件、大きな bundle の警告、
     browserslist の警告は残っています。
   - 相談の保存・アクセス制御テスト 1 ファイル、ブラウザ 4 ケースが成功。
     同じセッションの利用者を切り替えた後の古い送信情報の拒否と、
     ページを再読み込みしない状態での相談・下書きの非表示も確認しました。
   - 関連する既存の認可テスト 6 ファイル、サポーター関連 3 ファイル、
     既存ブラウザ関連 2 ファイルが成功しました。
   - 最初の相談テスト 2 回は失敗しました。テスト用セッションの JSON
     更新方法を修正して解消し、併せてテスト用の画面操作・判定方法も
     見直しました。既存の権限や期待する拒否条件は弱めていません。
5. **一時環境・通常環境**: 新しいスキーマは既存 DB へ適用していません。
   通常アプリは再起動していません。Secrets の変更、AI 接続、外部送信、
   デプロイはしていません。将来の SQL 適用手順は
   `private-consultations-migration.sql` にありますが、**未実行**です。
   全実行回で一時環境の停止・削除が完了し、最後の確認で一時保存先と
   一時 DB・テストアプリの残存は 0 件でした。
   架空データの画面を `screenshots/consultations-list.png` と
   `screenshots/consultations-detail.png` に保存し、日本語の表示も確認済みです。
   この 2 画像、未ログイン画面の画像、および `dist/` は成果物として残しています。
6. **未解決・公開前作業**: 保存期間、同意文、バックアップ内の削除扱い、
   アカウント有効性の確実な状態管理、上記 OAuth/セッション強化を決める必要が
   あります。現在の `users` 表に active/停止列がないため、利用者の生存確認は
   行の存在までです。実際の LINE ログイン往復、本番起動、既存 DB への適用は
   今回の検証に含みません。同じログインアカウントを複数人で共用した場合に、
   人間の利用者を区別する保証もありません。

### 再検証する場合

既存環境を引き継がず、毎回新規作成する一時 DB だけで実行します。

```sh
env -i PATH="$PATH" LANG=C LC_ALL=C TZ=UTC \
  node --import tsx tests/run-ephemeral-tests.mjs consultation consultation-browser
```

関連する既存テストも含める場合は、最後の 2 引数を `all` にします。
この入口が接続前の安全確認、起動・終了の確認、テスト、後片付けを行います。
通常環境で機能を有効化したり、接続文字列を手動で渡したりしないでください。
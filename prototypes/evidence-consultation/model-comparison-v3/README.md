# 次回用の回答検査器（通信なし）

このディレクトリは **将来の比較専用**。凍結された旧検査器、要求、
回答原文、台帳、承認、採点、主解析、補足評価を変更・再採点しない。
旧検査器の `E03-C-RISK-OF-BIAS` 誤検知はそのまま再現可能に保つ。

送信する runner / CLI、承認作成、通常アプリ・DBとの接続はない。
既存 runner の import 先も変更していない。将来の使用には、別途明示承認、
新しい実行器への組み込みとコードの再凍結が必要。未使用の通信枠も使わない。
旧版の採点検査器 `validateReview` はここから公開しない。

## 検査

- `validateAnswerStructure`: フィールド、型、配列を検査。
- `validateAnswerCitations`: 説明の引用必須・送信要求ごとの引用所属を検査。
- `validateAnswerIdentity`: 秘密情報とモデル名を検査。
- `validateAnswer`: 上記を順に行う純粋関数。例外は固定コードのみ。
- `inspectAnswerText`: JSON・構造・引用・秘密情報・モデル名を別々に判定。
  `valid`, `answer`, `reasons`, `checks`, `validatorVersion` を返す。
- `inspectResponse`: v2の通信設定／完了状態／会計検査を維持し、回答検査だけを
  新版に置き換えた純粋関数。`answerValidation` に上記の本文を除く診断を返す。

公開IDの扱いは **当該要求に含まれる完全一致のIDのみ**。本文中の独立した
IDトークンも秘密情報検査から除外するが、部分一致・大小文字違い・接尾辞・
別要求のIDには適用しない。引用所属検査そのものは省略しない。
既知の鍵との完全一致検査およびモデル名検査は公開IDによって免除しない。
未知の形式の出典IDは文脈エラーとして拒否し、将来の形式追加は別途検証する。

秘密情報検査は保守的に `sk-` 接頭辞、APIキー表記、Bearer表記、
秘密鍵ヘッダーを拒否する。モデル／提供元名は従来の対象を維持し、
GPTの他の数字バージョンも拒否する。これは既知パターンの検査であり、
任意の秘密やモデル名を網羅的に検出する保証ではない。
実際の鍵は読み込まない。呼び出し側から渡された鍵のエコー検査をする場合も
例外や診断に値を含めない。テストは架空値のみ。

## 安全な診断の保存契約

保存先を持つ将来の呼び出し側は `inspectResponse` の返却値を保存する。
`answerValidation.reasons` / `caseReasons` は固定された理由コードのみで、
不明な例外を `answer_validation_internal_error` に限定する。
JSON例外メッセージ、不正ID、検出部分、任意キー名は診断へコピーしない。

主な区別：
`answer_json_invalid` / `answer_schema_invalid` /
`answer_citation_missing` / `answer_citation_unknown` /
`answer_source_context_invalid` / `answer_secret_leak` /
`answer_model_identity_leak`。
通信完了失敗の `not_completed` やA/B制御停止とは別に保持する。

不適格回答は `answer:null`, `outputText:""` とし、秘密らしい本文を保存しない。
`answerValidation.valid:true` でも通信設定・完了検査が失敗すれば不適格のまま。
構造の合格は意味の正確さ・医学的採用・公平な比較の保証ではない。
JSONや構造が不正でも秘密情報／モデル名検査は行う。

## オフライン回帰試験

プロジェクトルートから（環境の鍵・DB設定を継承しない）：

```sh
env -i PATH="$PATH" LANG=C LC_ALL=C TZ=UTC \
  node --import ./prototypes/evidence-consultation/model-comparison-v2/offline-lockdown.mjs \
  --test prototypes/evidence-consultation/model-comparison-v3/offline.test.mjs
```

旧版のネットワーク／プロセス／待受禁止ガードを再利用する。
凍結要求を読み取り専用で参照し、全公開出典IDを合成回答で検査する。
過去の回答本文の再評価・API送信・DB利用・アプリ起動は行わない。
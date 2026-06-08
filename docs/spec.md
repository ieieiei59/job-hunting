# 履歴書・職務経歴書 管理リポジトリ仕様（v0.1）

最終更新: 2026-06-08

## 1. 目的
- 履歴書・職務経歴書の情報を YAML で一元管理する。
- YAML から PDF を再現性高く生成できるようにする。
- コンテンツ（データ）と変換ロジック（ツール）を分離し、保守しやすくする。

## 2. スコープ
### 対象
- 履歴書・職務経歴書のデータ定義（YAML）
- YAML の妥当性検証
- YAML から PDF への変換
- ローカルでの生成手順の標準化

### 非対象
- `archived/` 配下の資産（旧資産として参照しない）
- 企業ごとの個別カスタム文面の自動生成（将来拡張）

## 3. ディレクトリ方針
トップレベルを以下の2系統で分離する。

- `contents/`: 履歴書・職務経歴書の YAML コンテンツ
- `tools/`: YAML 検証・PDF 生成ツール

想定構成:

```text
.
├── contents/
│   ├── schemas/
│   │   ├── resume.schema.yaml
│   │   └── work-history.schema.yaml
│   ├── profiles/
│   │   └── default/
│   │       ├── resume.yaml
│   │       └── work-history.yaml
│   └── assets/
│       └── images/
├── tools/
│   ├── converter/
│   │   ├── src/
│   │   └── tests/
│   ├── templates/
│   │   ├── resume/
│   │   └── work-history/
│   └── output/
├── docs/
│   └── spec.md
└── README.md
```

補足:
- 出力 PDF は `tools/output/` に生成する。
- `contents/assets/` は写真や図版などを格納する。

## 4. YAML 設計方針
- 文字コードは UTF-8。
- 日付は ISO 8601（`YYYY-MM` または `YYYY-MM-DD`）。
- `schema_version` を必須にし、スキーマ変更に備える。
- 表示順が意味を持つ配列（職務経歴など）は YAML 上の順序を尊重する。

### 4.1 履歴書 YAML（resume.yaml）
必須トップレベル項目:
- `schema_version`: 例 `1`
- `personal`: 氏名、生年月日、住所、連絡先など
- `education`: 学歴（配列）
- `employment_summary`: 職歴要約（配列）
- `licenses`: 免許・資格（配列、空配列可）
- `preferences`: 本人希望記入欄

推奨項目:
- `photo`: 証明写真パス
- `links`: ポートフォリオやGitHub等
- `motivation`: 志望動機・アピールポイント
- `personal.furigana`: ふりがな
- `personal.gender`: 性別
- `personal.postal_code`: 郵便番号（`NNN-NNNN`）
- `personal.contact_address`: 連絡先（現住所以外）
- `jis.commute_time`: 通勤時間
- `jis.dependents`: 扶養家族数（配偶者を除く）
- `jis.spouse`: 配偶者有無（`有` / `無`）
- `jis.spouse_support_obligation`: 配偶者の扶養義務（`有` / `無`）

日付入力ルール（履歴書）:
- 西暦: `YYYY-MM` または `YYYY-MM-DD`
- 和暦: `令和N年M月` / `令和N年M月D日`（平成・昭和も同様）

### 4.2 職務経歴書 YAML（work-history.yaml）
必須トップレベル項目:
- `schema_version`
- `profile_summary`: 職務要約
- `skills`: スキルセット（カテゴリ別）
- `experiences`: 職務経歴（配列）

`experiences` 各要素の必須項目:
- `period`: 開始・終了
- `company`: 会社名
- `role`: 役割
- `projects`: プロジェクト配列

`projects` 各要素の推奨項目:
- `name`
- `domain`
- `team_size`
- `responsibilities`
- `tech_stack`
- `achievements`

## 5. 変換ツール要件
- 入力: `contents/profiles/<profile>/resume.yaml`, `work-history.yaml`
- 出力: `tools/output/<profile>/resume.pdf`, `work-history.pdf`
- 実行例（CLI）:
  - `tools/converter` から単一コマンドで生成できること
  - profile 指定と出力先指定を受け取れること
- 実装言語: TypeScript
- レイアウト方式: HTML/CSS テンプレートを用いてスタイリングし、PDF に変換する

最低限の機能:
- YAML 読み込み
- スキーマ検証（必須項目、型、日付形式）
- HTML/CSS テンプレート適用
- PDF 出力
- エラー時に「どのファイルのどのキーが不正か」を表示
- 履歴書での補助機能:
  - 学歴・職歴、免許・資格の行数が不足する場合は空行を補完
  - `photo` が指定され、ファイルが存在する場合は証明写真欄へ画像を埋め込み

## 6. 運用ルール
- 仕様変更時は `schema_version` と `docs/spec.md` を更新する。
- YAML 変更時は PDF を再生成し、見た目崩れを確認する。
- profile を追加する場合は `contents/profiles/<name>/` を追加する。

## 7. 今後の実装タスク（初期）
1. `contents/` と `tools/` のディレクトリを作成
2. スキーマファイル（resume/work-history）を定義
3. サンプル YAML（default profile）を作成
4. 変換 CLI の雛形を作成
5. PDF 出力確認と README 手順化

## 8. 受け入れ基準（Definition of Done）
- `contents/profiles/default/` の YAML から2種類の PDF が生成できる。
- 必須項目欠落時に変換が失敗し、エラー理由が表示される。
- README の手順だけで、初回ユーザーが PDF 生成まで到達できる。

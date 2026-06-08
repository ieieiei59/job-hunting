# job-hunting

転職活動向けの履歴書・職務経歴書を管理するリポジトリです。

## 方針
- `archived/` は旧資産として扱い、現行運用では使用しません。
- 現行資産はトップレベルで `contents/`（YAMLコンテンツ）と `tools/`（変換ツール）に分離します。

## 仕様
- 仕様書: `docs/spec.md`

## ディレクトリ
- `contents/`: 履歴書・職務経歴書の YAML データ
- `tools/`: YAML 検証と PDF 生成ツール

## PDF 生成（初期実装）
```bash
cd tools/converter
npm install
npm run build
npm run generate -- --profile default
```

生成先:
- `tools/output/default/resume.pdf`
- `tools/output/default/work-history.pdf`

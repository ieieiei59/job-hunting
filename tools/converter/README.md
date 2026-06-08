# converter

YAML に記載した履歴書・職務経歴書データを、HTML/CSS でレイアウトして PDF に変換する TypeScript CLI です。

## セットアップ

```bash
npm install
```

## ビルド

```bash
npm run build
```

## 実行

```bash
npm run generate -- --profile default
```

`tools/output/default/` に以下を生成します。
- `resume.pdf`
- `work-history.pdf`

## 開発実行

```bash
npm run dev -- --profile default
```

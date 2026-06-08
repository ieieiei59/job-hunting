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

## 証明写真の埋め込み

`resume.yaml` に `photo` を追加すると、履歴書の証明写真欄へ画像を埋め込みます。

```yaml
photo: "../../assets/images/profile.jpg"
```

`photo` の解決順（相対パス指定時）:
1. `contents/profiles/<profile>/` からの相対
2. リポジトリルートからの相対
3. `contents/` からの相対
4. `contents/assets/images/` からの相対

対応形式: `jpg`, `jpeg`, `png`, `webp`, `gif`

# MCP Video Understanding

## 概要
このプロジェクトは、Geminiモデルを使用したビデオ理解システムのMCPサーバーです。

## 環境要件
- Node.js
- TypeScript
- Cloudflare Workers

## セットアップ手順
1. 依存関係のインストール
```bash
npm install
```

2. 環境変数の設定
`.dev.vars.example` をコピーして `.dev.vars` を作成し、必要な環境変数を設定してください。`wrangler dev` 実行時に自動で読み込まれます。
```bash
cp .dev.vars.example .dev.vars
```
`GOOGLE_API_KEY` と `SHARED_SECRET` を自分の値に置き換えてください。

## 開発
- ビルド: `npm run build`（`build/index.js` が生成され、Claude などのローカル MCP クライアントで `node build/index.js` を実行できます）
- テスト: `npm test`
- 開発サーバー: `npm run dev`
  - 初回に `workers-mcp docgen src/index.ts` が自動実行され、`dist/docs.json` が最新化されます。
  - `http://127.0.0.1:8787/` で Worker を確認できます。
  - SSE エンドポイントは `curl -H "Authorization: Bearer $SHARED_SECRET" http://127.0.0.1:8787/sse` などで確認できます。

## デプロイ
`npm run deploy`

## ライセンス
詳細は`LICENSE`ファイルを参照してください。

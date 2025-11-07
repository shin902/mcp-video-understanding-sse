# MCP Video Understanding

## Overview
This project is an MCP server for a video understanding system using the Gemini model.

**アーキテクチャ**: SSE (Server-Sent Events) トランスポートを使用した Cloudflare Workers ベースの MCP サーバー

## 主な特徴
- ✅ SSE トランスポートによるリアルタイム通信
- ✅ SHARED_SECRET による認証
- ✅ CORS 対応（許可オリジンのカスタマイズ可能）
- ✅ Gemini API を使用した動画分析
- ✅ YouTube やリモート動画 URL の分析サポート
- ✅ 型安全な TypeScript 実装

## 環境要件
- Node.js 18+
- TypeScript 5+
- Cloudflare Workers アカウント
- Google Gemini API キー

## Setup Instructions
1. Install dependencies
```bash
npm install
```

2. Configure environment variables
Copy `.dev.vars.example` to `.dev.vars` and set the required environment variables. They will be automatically loaded when running `wrangler dev`.
```bash
cp .dev.vars.example .dev.vars
```

### 必須環境変数
- `GOOGLE_API_KEY`: Google Gemini API キー
- `SHARED_SECRET`: SSE 認証用のシークレット（**64文字必須**）

### オプション環境変数
- `ALLOWED_ORIGINS`: CORS許可オリジンのカンマ区切りリスト（例: `https://app1.example.com,https://app2.example.com`）
- `PING_INTERVAL`: SSE ping 間隔（ミリ秒、デフォルト: 25000）

**SHARED_SECRET の生成**:
```bash
# Linux/macOS
openssl rand -hex 32

# または Node.js で
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Development
- Build: `npm run build` (generates `build/index.js`, which can be run with `node build/index.js` in local MCP clients like Claude)
- Test: `npm test`
- Development server: `npm run dev`
  - On first run, `workers-mcp docgen src/index.ts` is automatically executed to update `dist/docs.json`.
  - Access the Worker at `http://127.0.0.1:8787/`
  - Test the SSE endpoint with `curl -H "Authorization: Bearer $SHARED_SECRET" http://127.0.0.1:8787/sse`

## デプロイ

### 本番環境へのデプロイ

1. Cloudflare にシークレットを設定
```bash
wrangler secret put GOOGLE_API_KEY
wrangler secret put SHARED_SECRET
```

2. デプロイ
```bash
npm run deploy
```

### 本番環境でのセキュリティ設定

**⚠️ 重要**: 本番環境では必ずレート制限を設定してください

詳細は [docs/RATE_LIMITING.md](docs/RATE_LIMITING.md) を参照してください。

最低限、Cloudflare ダッシュボードで以下のレート制限を設定することを推奨：
- `/sse` エンドポイント: 10 接続/分/IP
- `/rpc` エンドポイント: 60 リクエスト/分/IP
- `analyzeRemoteVideo`: 10 リクエスト/時/IP

## ドキュメント

- [SSE サポート詳細](docs/sse-support.md) - SSE トランスポートの詳細な説明
- [レート制限ガイド](docs/RATE_LIMITING.md) - レート制限の設定方法（本番必須）

## API エンドポイント

### `/sse` - SSE 接続
Server-Sent Events エンドポイント。MCP クライアントとの双方向通信用。

**認証**: `Authorization: Bearer <SHARED_SECRET>` ヘッダーが必要

### `/rpc` - RPC 呼び出し
JSON-RPC 2.0 エンドポイント。MCP ツールの呼び出し用。

## 利用可能なツール

### `analyzeRemoteVideo`
リモート動画 URL（YouTube 等）を Gemini で分析します。

**パラメータ**:
- `videoUrl` (必須): 分析する動画の URL
- `prompt` (オプション): カスタムプロンプト
- `model` (オプション): 使用する Gemini モデル（デフォルト: gemini-2.5-flash）

## Claude Desktop との統合

`claude_desktop_config.json` に以下を追加：

```json
{
  "mcpServers": {
    "gemini-video": {
      "url": "http://127.0.0.1:8787/sse",
      "transport": {
        "type": "sse",
        "headers": {
          "Authorization": "Bearer your_64_character_secret_here"
        }
      }
    }
  }
}
```

## トラブルシューティング

### 401 Unauthorized エラー
- `SHARED_SECRET` が正確に 64 文字であることを確認
- Authorization ヘッダーが正しい形式であることを確認

### 接続が切れる
- `PING_INTERVAL` 設定を調整（デフォルト: 25秒）
- ネットワーク/ファイアウォール設定を確認

詳細は [docs/sse-support.md](docs/sse-support.md) のトラブルシューティングセクションを参照。

## License
See the `LICENSE` file for details.

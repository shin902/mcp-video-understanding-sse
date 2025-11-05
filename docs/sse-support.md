# SSE（Server-Sent Events）接続サポート

## 目次

1. [概要](#概要)
2. [クイックスタート](#クイックスタート)
3. [SSEトランスポートとは](#sseトランスポートとは)
4. [このプロジェクトのSSE実装](#このプロジェクトのsse実装)
5. [セットアップ](#セットアップ)
6. [クライアント接続](#クライアント接続)
7. [認証](#認証)
8. [エンドポイント詳細](#エンドポイント詳細)
9. [トラブルシューティング](#トラブルシューティング)
10. [技術仕様](#技術仕様)

---

## 概要

このMCPサーバーは、**Server-Sent Events (SSE)** トランスポートをサポートしています。SSEは、サーバーからクライアントへのリアルタイム通信を実現するHTTPベースのプロトコルで、長時間実行される接続を維持し、サーバーからクライアントへデータをプッシュすることができます。

### 重要な注意事項

> **⚠️ SSEトランスポートの将来性について**
>
> MCP仕様のバージョン2025-03-26において、SSEトランスポートは非推奨となり、**Streamable HTTP (HTTP Stream Transport)** が推奨されています。ただし、SSEは後方互換性のためにサポートが継続されており、既存のMCPクライアント（Claude Desktopなど）との統合には引き続き利用可能です。
>
> 新規プロジェクトでは、Streamable HTTPトランスポートの使用を検討することをお勧めします。
>
> **移行タイムライン**: SSEサポートの削除予定は現時点で発表されていませんが、新機能はStreamable HTTPを前提に開発されています。詳細は「Streamable HTTPへの移行ガイド」セクションを参照してください。

## クイックスタート

5分でSSE接続を試すための最小限の手順：

### 1. シークレットの生成

```bash
# 64文字のランダムシークレットを生成
SECRET=$(openssl rand -hex 32)
echo "SHARED_SECRET=$SECRET" > .dev.vars
echo "GOOGLE_API_KEY=your_api_key_here" >> .dev.vars
```

### 2. サーバーの起動

```bash
npm install
npm run dev
```

### 3. SSE接続のテスト

```bash
# .dev.varsからシークレットを読み込んで接続
SECRET=$(grep SHARED_SECRET .dev.vars | cut -d'=' -f2)
curl -N -H "Authorization: Bearer $SECRET" http://127.0.0.1:8787/sse
```

### 4. ツールのリスト取得

```bash
curl -X POST http://127.0.0.1:8787/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

### 5. 動画分析の実行

```bash
curl -X POST http://127.0.0.1:8787/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "analyzeRemoteVideo",
      "arguments": {
        "videoUrl": "https://example.com/video.mp4",
        "prompt": "この動画を要約してください"
      }
    },
    "id": 1
  }'
```

## SSEトランスポートとは

### Model Context Protocol (MCP) におけるトランスポート

MCPサーバーは、複数のトランスポート方式をサポートしており、それぞれ異なる用途に適しています：

| トランスポート | デプロイ形態 | クライアント数 | 通信方式 | 複雑性 | リアルタイム |
|--------------|------------|--------------|---------|-------|------------|
| **Stdio** | ローカル | 単一 | 双方向 | 低 | なし |
| **HTTP** | リモート | 複数 | リクエスト-レスポンス | 中 | なし |
| **SSE** | リモート | 複数 | サーバープッシュ | 中〜高 | あり |

### SSEトランスポートの特徴

**最適な用途**: リアルタイム更新、プッシュ通知、ストリーミングデータ

**特性**:
- サーバーからクライアントへの一方向ストリーミング（HTTP上）
- ポーリング不要でリアルタイム更新が可能
- 継続的なデータフローのための長時間接続
- 標準的なHTTPインフラストラクチャ上で動作

**使用すべき場面**:
- クライアントがリアルタイムデータ更新を必要とする場合
- プッシュ通知の実装
- ログやモニタリングデータのストリーミング
- 長時間実行される操作の進捗通知

## このプロジェクトのSSE実装

このMCPサーバー（Gemini Video Understanding）は、Cloudflare Workers上で動作し、`workers-mcp`パッケージを使用してSSE接続をサポートしています。

### 実装の特徴

1. **認証付きSSE接続**: `SHARED_SECRET`環境変数を使用したBearer token認証
2. **CORS対応**: クロスオリジンリクエストをサポート
3. **Keep-Alive機構**: 25秒ごとのpingイベントで接続を維持
4. **即座の接続確認**: `ready`イベントで接続開始を通知
5. **RPCエンドポイント**: MCPツール呼び出し用の`/rpc`エンドポイント

### アーキテクチャ

```
┌─────────────┐         SSE          ┌─────────────────────┐
│             │  (/sse endpoint)     │                     │
│  MCPクライアント  │◄─────────────────│  Cloudflare Worker  │
│             │                      │  (Gemini Video MCP) │
│             │         RPC          │                     │
│             │  (/rpc endpoint)     │                     │
│             │─────────────────────►│                     │
└─────────────┘                      └─────────────────────┘
                                              │
                                              │
                                              ▼
                                     ┌─────────────────┐
                                     │   Gemini API    │
                                     └─────────────────┘
```

### workers-mcpの役割

このプロジェクトでは、`workers-mcp`パッケージを使用してMCPサーバー機能を実装しています。

**workers-mcpとは**:
- Cloudflare Workers上でMCPサーバーを簡単に構築するためのライブラリ
- `WorkerEntrypoint`を拡張してMCPツールを公開
- SSE/HTTPトランスポートのハンドリングを簡素化
- `ProxyToSelf`を使用してRPCエンドポイントを自動的に処理

**主な機能**:
1. **自動ドキュメント生成**: `workers-mcp docgen`コマンドでツールのドキュメントを生成
2. **型安全性**: TypeScriptによる型チェック
3. **簡単なデプロイ**: Cloudflare Workersへのシームレスなデプロイ

**使用例（src/index.ts）**:
```typescript
import { WorkerEntrypoint } from 'cloudflare:workers'
import { ProxyToSelf } from 'workers-mcp'

export default class GeminiVideoWorker extends WorkerEntrypoint<Env> {
  // MCPツールをメソッドとして定義
  async analyzeRemoteVideo(videoUrl: string, prompt?: string) {
    // 実装...
  }

  async fetch(request: Request): Promise<Response> {
    // RPCエンドポイントはProxyToSelfが自動処理
    if (url.pathname === '/rpc') {
      return await new ProxyToSelf(this).fetch(request)
    }
    // SSEエンドポイントは手動で実装
  }
}
```

## セットアップ

### 1. 環境変数の設定

`.dev.vars`ファイルを作成し、必要な環境変数を設定します：

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars`に以下を設定：

```bash
GOOGLE_API_KEY=your_google_api_key_here
SHARED_SECRET=your_64_character_secret_here
```

**重要**: `SHARED_SECRET`は**64文字**である必要があります。以下のコマンドで生成できます：

```bash
# Linux/macOS
openssl rand -hex 32

# または Node.js で
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. 開発サーバーの起動

```bash
npm run dev
```

サーバーは `http://127.0.0.1:8787/` で起動します。

### 3. 接続確認

SSEエンドポイントが正しく動作しているか確認：

```bash
curl -H "Authorization: Bearer $SHARED_SECRET" http://127.0.0.1:8787/sse
```

正常に動作している場合、以下のようなイベントストリームが返されます：

```
event: ready
data: "ok"

event: ping
data: 1704067200000

: keep-alive
```

## クライアント接続

### SSE接続の確立

MCPクライアント（Claude Desktopなど）は、以下の手順でSSE接続を確立します：

1. **SSEエンドポイントへの接続**: `GET /sse`
2. **認証ヘッダーの送信**: `Authorization: Bearer <SHARED_SECRET>`
3. **イベントストリームの受信**: サーバーからのイベントをリッスン

### RPCエンドポイントの使用

ツールを呼び出す際は、`/rpc`エンドポイントにPOSTリクエストを送信します：

```bash
curl -X POST http://127.0.0.1:8787/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "analyzeRemoteVideo",
      "arguments": {
        "videoUrl": "https://example.com/video.mp4"
      }
    },
    "id": 1
  }'
```

### Claude Desktopでの設定例

`claude_desktop_config.json`に以下を追加：

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

### JavaScriptクライアントの実装例

ブラウザやNode.jsからEventSourceを使用して接続することもできます：

#### ブラウザでの実装

```javascript
// SSE接続の確立
const SECRET = 'your_64_character_secret_here';
const eventSource = new EventSource('http://127.0.0.1:8787/sse', {
  // 注意: EventSourceはカスタムヘッダーをサポートしていないため、
  // 認証が必要な場合はURLにトークンを含める方法を検討する必要があります
  // この実装では別途fetchでRPC呼び出しを行います
});

// イベントリスナーの設定
eventSource.addEventListener('ready', (event) => {
  console.log('SSE接続が確立されました:', event.data);
});

eventSource.addEventListener('ping', (event) => {
  console.log('Keep-alive ping受信:', event.data);
});

eventSource.onerror = (error) => {
  console.error('SSE接続エラー:', error);
};

// RPCリクエストの送信（別途fetch使用）
async function callTool(toolName, args) {
  const response = await fetch('http://127.0.0.1:8787/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      },
      id: Date.now()
    })
  });

  return await response.json();
}

// 使用例
callTool('analyzeRemoteVideo', {
  videoUrl: 'https://example.com/video.mp4',
  prompt: 'この動画を要約してください'
}).then(result => {
  console.log('結果:', result);
});
```

#### Node.jsでの実装

```javascript
import EventSource from 'eventsource';
import fetch from 'node-fetch';

const SECRET = 'your_64_character_secret_here';

// Node.js環境ではカスタムヘッダーをサポート
const eventSource = new EventSource('http://127.0.0.1:8787/sse', {
  headers: {
    'Authorization': `Bearer ${SECRET}`
  }
});

eventSource.addEventListener('ready', (event) => {
  console.log('接続確立:', event.data);
});

eventSource.addEventListener('ping', (event) => {
  console.log('Ping:', new Date(parseInt(event.data)));
});

eventSource.addEventListener('error', (error) => {
  console.error('エラー:', error);
});

// RPCリクエストの送信
async function listTools() {
  const response = await fetch('http://127.0.0.1:8787/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 1
    })
  });

  return await response.json();
}

// ツール一覧を取得
listTools().then(tools => {
  console.log('利用可能なツール:', tools);
});
```

### 完全な使用フロー例

以下は、SSE接続からツール呼び出しまでの完全なフローです：

```bash
#!/bin/bash
# complete-flow-example.sh

# 1. 環境変数の読み込み
SECRET=$(grep SHARED_SECRET .dev.vars | cut -d'=' -f2)

echo "=== Step 1: SSE接続のテスト ==="
# バックグラウンドでSSE接続を維持（5秒後に終了）
timeout 5s curl -N -H "Authorization: Bearer $SECRET" \
  http://127.0.0.1:8787/sse &

sleep 1

echo -e "\n=== Step 2: ツール一覧の取得 ==="
curl -s -X POST http://127.0.0.1:8787/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq .

sleep 1

echo -e "\n=== Step 3: analyzeRemoteVideoツールの呼び出し ==="
curl -s -X POST http://127.0.0.1:8787/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "analyzeRemoteVideo",
      "arguments": {
        "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "prompt": "この動画の内容を簡潔に要約してください"
      }
    },
    "id": 2
  }' | jq .

echo -e "\n=== 完了 ==="
```

実行方法：
```bash
chmod +x complete-flow-example.sh
./complete-flow-example.sh
```

## 認証

### SHARED_SECRET認証

このMCPサーバーは、SSEエンドポイントへのアクセスを保護するために`SHARED_SECRET`を使用します。

#### セキュリティ要件

1. **長さ**: 正確に64文字である必要があります
2. **形式**: Bearer token として送信: `Authorization: Bearer <secret>`
3. **検証**: サーバー側で完全一致を確認

#### 認証フロー

```
1. クライアント → サーバー: GET /sse
   Headers: Authorization: Bearer <SHARED_SECRET>

2. サーバー側検証:
   - SHARED_SECRETが設定されているか
   - 長さが64文字か
   - Authorizationヘッダーの値と一致するか

3. 成功: 200 OK + SSEストリーム
   失敗: 401 Unauthorized
```

## エンドポイント詳細

### `/sse` エンドポイント

**メソッド**: `GET`, `OPTIONS`

**目的**: SSE接続を確立し、サーバーからクライアントへのイベントストリームを提供

**ヘッダー**:
- `Authorization: Bearer <SHARED_SECRET>` (必須)
- `Origin: <your-origin>` (CORS用、オプション)

**レスポンスヘッダー**:
```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
Access-Control-Allow-Origin: <origin or *>
Access-Control-Allow-Headers: Authorization, Content-Type, Accept
```

**イベント**:
1. **ready**: 接続が確立されたことを通知
   ```
   event: ready
   data: "ok"
   ```

2. **ping**: 25秒ごとに送信される keep-alive イベント
   ```
   event: ping
   data: 1704067200000
   ```

3. **keep-alive コメント**: 接続を維持するための空コメント
   ```
   : keep-alive
   ```

### `/rpc` エンドポイント

**メソッド**: `POST`, `OPTIONS`

**目的**: MCPツールの呼び出しを処理（JSON-RPC 2.0プロトコル）

**ヘッダー**:
- `Content-Type: application/json`
- `Origin: <your-origin>` (CORS用、オプション)

**リクエストボディ例**:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "analyzeRemoteVideo",
    "arguments": {
      "videoUrl": "https://www.youtube.com/watch?v=example",
      "prompt": "この動画を要約してください"
    }
  },
  "id": 1
}
```

**レスポンス例**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "動画の要約結果..."
      }
    ]
  },
  "id": 1
}
```

### 利用可能なMCPメソッド

RPCエンドポイントでは、以下のJSON-RPC 2.0メソッドが利用可能です：

#### 1. `tools/list` - ツール一覧の取得

利用可能なツールのリストを取得します。

**リクエスト**:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}
```

**レスポンス**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "tools": [
      {
        "name": "analyzeRemoteVideo",
        "description": "リモート動画URLを Gemini で分析します。YouTube などの公開動画URLに対応しています。",
        "inputSchema": {
          "type": "object",
          "properties": {
            "videoUrl": {
              "type": "string",
              "description": "分析する動画のURL（YouTube等）"
            },
            "prompt": {
              "type": "string",
              "description": "オプションのカスタムプロンプト（デフォルト: 要約プロンプト）"
            },
            "model": {
              "type": "string",
              "description": "使用するGeminiモデル名（デフォルト: gemini-2.5-flash）"
            }
          },
          "required": ["videoUrl"]
        }
      }
    ]
  },
  "id": 1
}
```

#### 2. `tools/call` - ツールの呼び出し

指定したツールを実行します。

**リクエスト**:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "analyzeRemoteVideo",
    "arguments": {
      "videoUrl": "https://example.com/video.mp4",
      "prompt": "この動画を3行で要約してください",
      "model": "gemini-2.5-flash"
    }
  },
  "id": 2
}
```

**レスポンス（成功）**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "動画の要約結果がここに返されます..."
      }
    ]
  },
  "id": 2
}
```

**レスポンス（エラー）**:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": "Invalid video URL: https://example.com/video.mp4"
  },
  "id": 2
}
```

#### 3. `initialize` - サーバー初期化（オプション）

MCPクライアントがサーバーとの接続を初期化する際に使用します。

**リクエスト**:
```json
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "example-client",
      "version": "1.0.0"
    }
  },
  "id": 1
}
```

**レスポンス**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "gemini-video-mcp",
      "version": "1.0.0"
    }
  },
  "id": 1
}
```

## トラブルシューティング

### 401 Unauthorized エラー

**原因**:
- `SHARED_SECRET`が設定されていない
- `SHARED_SECRET`が64文字でない
- Authorizationヘッダーの値が一致しない
- Authorizationヘッダーの形式が正しくない

**解決方法**:
```bash
# 1. SHARED_SECRETが正しく設定されているか確認
echo $SHARED_SECRET | wc -c  # 65を返すべき（改行含む）

# 2. .dev.varsファイルを確認
cat .dev.vars

# 3. 新しいシークレットを生成
openssl rand -hex 32

# 4. 正しいヘッダー形式で接続
curl -H "Authorization: Bearer $(cat .dev.vars | grep SHARED_SECRET | cut -d'=' -f2)" \
     http://127.0.0.1:8787/sse
```

### 接続がすぐに切れる

**原因**:
- ネットワークの問題
- プロキシやファイアウォールがSSE接続をブロック
- クライアント側のタイムアウト設定

**解決方法**:
1. pingイベント（25秒ごと）が受信できているか確認
2. ネットワーク設定を確認
3. クライアント側のタイムアウト設定を延長

### CORSエラー

**原因**:
- クロスオリジンリクエストがブロックされている

**解決方法**:
このサーバーは自動的にCORSヘッダーを設定します。ブラウザベースのクライアントを使用している場合、正しい`Origin`ヘッダーが送信されていることを確認してください。

### RPCエンドポイントに接続できない

**原因**:
- POST以外のメソッドを使用している
- Content-Typeヘッダーが正しくない
- JSON形式が正しくない

**解決方法**:
```bash
# 正しいリクエスト形式
curl -X POST http://127.0.0.1:8787/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'
```

## デバッグとテスト

### デバッグ方法

#### 1. ブラウザの開発者ツールでSSEストリームを確認

1. ブラウザで開発者ツールを開く（F12）
2. Networkタブを選択
3. EventStreamまたはAllでフィルタリング
4. SSEエンドポイントへのリクエストを確認
5. Messagesタブでイベントストリームをリアルタイムで監視

#### 2. curlでのデバッグ

**詳細なデバッグ出力**:
```bash
SECRET=$(grep SHARED_SECRET .dev.vars | cut -d'=' -f2)

# -v オプションで詳細なログを出力
curl -v -N \
  -H "Authorization: Bearer $SECRET" \
  http://127.0.0.1:8787/sse
```

**タイムアウト設定**:
```bash
# 60秒でタイムアウト
curl -N --max-time 60 \
  -H "Authorization: Bearer $SECRET" \
  http://127.0.0.1:8787/sse
```

**特定のイベントのみを抽出**:
```bash
# pingイベントのみを表示
curl -N -H "Authorization: Bearer $SECRET" \
  http://127.0.0.1:8787/sse 2>/dev/null | \
  grep -A 1 "event: ping"
```

#### 3. Wranglerログの確認

開発サーバーのログをリアルタイムで確認：

```bash
# 別のターミナルで開発サーバーを起動
npm run dev

# ログが自動的にコンソールに出力される
# console.log/console.errorの出力を確認
```

本番環境のログ確認：

```bash
# Cloudflare Workersのログをストリーミング
wrangler tail

# 特定のイベントでフィルタリング
wrangler tail --format json | jq 'select(.event.request.url | contains("/sse"))'
```

#### 4. RPCエンドポイントのテスト

**基本的なテスト**:
```bash
# ツール一覧を取得
curl -X POST http://127.0.0.1:8787/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq .

# 結果をファイルに保存
curl -X POST http://127.0.0.1:8787/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' > tools.json
```

**エラーレスポンスのテスト**:
```bash
# 無効なメソッド
curl -X POST http://127.0.0.1:8787/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"invalid/method","id":1}' | jq .

# 無効なパラメータ
curl -X POST http://127.0.0.1:8787/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "analyzeRemoteVideo",
      "arguments": {
        "videoUrl": "invalid-url"
      }
    },
    "id": 1
  }' | jq .
```

#### 5. 接続状態の監視

**継続的な監視スクリプト**:
```bash
#!/bin/bash
# monitor-sse.sh

SECRET=$(grep SHARED_SECRET .dev.vars | cut -d'=' -f2)

while true; do
  echo "[$(date +%H:%M:%S)] SSE接続テスト..."

  # 5秒間SSE接続を維持してイベントを確認
  timeout 5s curl -N -H "Authorization: Bearer $SECRET" \
    http://127.0.0.1:8787/sse 2>/dev/null | \
    head -10

  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 124 ]; then
    echo "✅ 接続成功（タイムアウトで正常終了）"
  else
    echo "❌ 接続失敗（終了コード: $EXIT_CODE）"
  fi

  echo "---"
  sleep 10
done
```

実行：
```bash
chmod +x monitor-sse.sh
./monitor-sse.sh
```

### テストツール

#### Postmanでのテスト

1. **SSE接続のテスト**:
   - 新しいリクエストを作成
   - メソッド: GET
   - URL: `http://127.0.0.1:8787/sse`
   - Headers: `Authorization: Bearer <your_secret>`
   - Sendをクリックしてイベントストリームを確認

2. **RPCリクエストのテスト**:
   - 新しいリクエストを作成
   - メソッド: POST
   - URL: `http://127.0.0.1:8787/rpc`
   - Headers: `Content-Type: application/json`
   - Body (raw JSON):
     ```json
     {
       "jsonrpc": "2.0",
       "method": "tools/list",
       "id": 1
     }
     ```

#### Insomnia / HTTPieでのテスト

```bash
# HTTPieを使用
pip install httpie

# ツール一覧取得
http POST http://127.0.0.1:8787/rpc \
  Content-Type:application/json \
  jsonrpc=2.0 \
  method=tools/list \
  id:=1
```

## 技術仕様

### SSEプロトコル詳細

#### Server-Sent Eventsの基本

SSEは、HTTPを使用してサーバーからクライアントへ一方向のイベントストリームを送信するプロトコルです。

**プロトコルの特徴**:
- **Content-Type**: `text/event-stream`
- **エンコーディング**: UTF-8
- **改行**: `\n` (LF)
- **イベント終端**: 空行 (`\n\n`)

#### イベントフォーマット

SSEイベントは以下の形式で送信されます：

```
event: <イベント名>\n
data: <データ>\n
id: <イベントID (オプション)>\n
retry: <再接続間隔 (ミリ秒, オプション)>\n
\n
```

**フィールド説明**:
- `event`: イベントのタイプ（省略時は "message"）
- `data`: イベントのデータ（複数行可能）
- `id`: イベントのID（再接続時の Last-Event-ID ヘッダーで使用）
- `retry`: 接続が切れた場合の再接続間隔（ミリ秒）

**コメント**:
```
: これはコメントです\n
```

コメント行は`:` で始まり、keep-aliveとして使用されます。

#### このサーバーのイベント

**1. readyイベント**:
```
event: ready
data: "ok"

```

接続が確立されたことを通知します。

**2. pingイベント**:
```
event: ping
data: 1704067200000

```

25秒ごとに送信され、現在のタイムスタンプ（ミリ秒）を含みます。

**3. keep-aliveコメント**:
```
: keep-alive

```

接続を維持するための空コメント。

#### クライアント側の実装詳細

**EventSource API**:
```javascript
const eventSource = new EventSource(url);

// デフォルトの "message" イベント
eventSource.onmessage = (event) => {
  console.log('Message:', event.data);
};

// カスタムイベント
eventSource.addEventListener('ready', (event) => {
  console.log('Ready:', event.data);
});

// エラーハンドリング
eventSource.onerror = (error) => {
  console.error('Error:', error);
  // EventSourceは自動的に再接続を試みる
};

// 接続を閉じる
eventSource.close();
```

**自動再接続**:
EventSourceは接続が切れた場合、自動的に再接続を試みます：
1. 接続が切れた場合、`onerror`イベントが発火
2. デフォルトで3秒後に再接続を試みる
3. サーバーが`retry`フィールドで再接続間隔を指定可能
4. `Last-Event-ID`ヘッダーで最後に受信したイベントIDを送信

### SSEストリーム実装

サーバー側の実装（`src/index.ts`の抜粋）：

```typescript
const stream = new ReadableStream<Uint8Array>({
  start(controller) {
    // 即座にreadyイベントを送信
    controller.enqueue(encoder.encode('event: ready\n'))
    controller.enqueue(encoder.encode('data: "ok"\n\n'))

    // 25秒ごとにpingイベントを送信
    intervalHandle = setInterval(() => {
      controller.enqueue(encoder.encode('event: ping\n'))
      controller.enqueue(encoder.encode(`data: ${Date.now()}\n\n`))
    }, 25000)

    // keep-aliveコメント
    controller.enqueue(encoder.encode(': keep-alive\n\n'))
  },
  cancel() {
    if (intervalHandle) {
      clearInterval(intervalHandle)
    }
  },
})
```

### CORSヘッダー

```typescript
{
  'Access-Control-Allow-Origin': origin ?? '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin',
  'Access-Control-Allow-Credentials': 'true' // originが指定されている場合
}
```

### セキュリティ考慮事項

1. **認証**: 64文字のSHARED_SECRETによる認証
2. **CORS**: オリジンベースのアクセス制御
3. **タイムアウト**: 自動的な接続管理とクリーンアップ
4. **検証**: すべてのリクエストパラメータの検証

### パフォーマンス

#### Cloudflare Workersのプラン別制限

| プラン | CPU時間 | リクエスト時間 | 同時実行 | メモリ | 推奨用途 |
|--------|---------|---------------|---------|--------|----------|
| **Free** | 10ms | 30秒 | 無制限 | 128MB | 開発・テスト |
| **Paid** | 50ms | 15分 | 無制限 | 128MB | 本番環境・長時間接続 |
| **Business** | 50ms | 15分 | 無制限 | 128MB | エンタープライズ |

**実装への影響**:

1. **CPU時間制限**:
   - Gemini API呼び出しは非同期のため、CPU時間には含まれません
   - ビデオ分析の実行時間は主にGemini APIのレスポンス時間に依存
   - 無料プランでも問題なく動作します

2. **リクエスト時間制限**:
   - 無料プラン: 30秒（SSE接続は短時間で自動的に再接続推奨）
   - 有料プラン: 15分（長時間のSSE接続に対応）

3. **同時接続**:
   - 無制限の同時実行が可能
   - ただし、Gemini APIのレート制限に注意

#### Keep-Alive設定

現在の実装では、Keep-Aliveのping間隔は**25秒**に固定されています（`src/index.ts:110-113`）。

**設定可能にする方法**:

```typescript
// 環境変数から設定を読み込む
const PING_INTERVAL = parseInt(env.PING_INTERVAL || '25000', 10);

const stream = new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(encoder.encode('event: ready\n'))
    controller.enqueue(encoder.encode('data: "ok"\n\n'))

    intervalHandle = setInterval(() => {
      controller.enqueue(encoder.encode('event: ping\n'))
      controller.enqueue(encoder.encode(`data: ${Date.now()}\n\n`))
    }, PING_INTERVAL) // 設定可能な間隔

    controller.enqueue(encoder.encode(': keep-alive\n\n'))
  },
  // ...
})
```

**wrangler.toml設定例**:
```toml
[env.production]
vars = { PING_INTERVAL = "30000" } # 30秒

[env.development]
vars = { PING_INTERVAL = "10000" } # 10秒（テスト用）
```

**推奨設定**:
- **開発環境**: 10-15秒（デバッグしやすい）
- **本番環境**: 25-30秒（ネットワーク効率とタイムアウト回避のバランス）
- **企業プロキシ環境**: 15-20秒（プロキシのタイムアウトが短い場合）

#### Durable Objectsの使用タイミング

以下の場合は、Durable Objectsの使用を検討してください：

1. **長時間接続が必要**:
   - 15分以上の接続を維持したい
   - リアルタイムの双方向通信が必要
   - WebSocket接続を実装したい

2. **状態管理が必要**:
   - クライアントごとの状態を保持
   - セッション管理
   - 接続間でのデータ永続化

3. **複雑な協調処理**:
   - 複数クライアント間の調整
   - 分散ロック
   - トランザクション処理

**Durable Objectsの例**:
```typescript
export class MCPSession extends DurableObject {
  private clients: Set<WebSocket> = new Set();

  async fetch(request: Request): Promise<Response> {
    // 長時間接続の管理
    // 状態の永続化
    // 複数クライアントの調整
  }
}
```

#### パフォーマンスベンチマーク

**予想レイテンシ（参考値）**:

| 操作 | 平均 | 95パーセンタイル | 備考 |
|------|------|------------------|------|
| SSE接続確立 | 50-100ms | 200ms | ネットワーク依存 |
| tools/list | 10-30ms | 50ms | ローカル処理 |
| analyzeRemoteVideo（短い動画） | 5-15秒 | 30秒 | Gemini API依存 |
| analyzeRemoteVideo（長い動画） | 30-60秒 | 120秒 | Gemini API依存 |

**最適化のヒント**:

1. **高速なモデルを使用**:
   ```typescript
   // gemini-2.5-flash（高速）
   analyzeRemoteVideo(videoUrl, prompt, "gemini-2.5-flash")

   // gemini-2.5-pro（高精度だが低速）
   analyzeRemoteVideo(videoUrl, prompt, "gemini-2.5-pro")
   ```

2. **リクエストキューイング**:
   - Cloudflare Queuesを使用して非同期処理
   - 長時間のビデオ分析をバックグラウンドで実行

3. **キャッシュの活用**:
   - Cloudflare KVで分析結果をキャッシュ
   - 同じ動画の再分析を避ける

#### レート制限の設定

Cloudflare Workersでのレート制限実装：

**方法1: Cloudflare Rate Limiting（推奨）**

Cloudflareダッシュボードで設定：

```
ルール: Rate Limiting
- パターン: /sse または /rpc
- レート: 100リクエスト/分
- アクション: ブロック（429 Too Many Requests）
```

**方法2: Cloudflare Workers内で実装**

```typescript
import { RateLimiter } from '@cloudflare/workers-rate-limiter'

async function fetch(request: Request, env: Env): Promise<Response> {
  // IPアドレスベースのレート制限
  const limiter = new RateLimiter({
    keyGenerator: () => request.headers.get('CF-Connecting-IP') || 'anonymous',
    limit: 100, // 100リクエスト
    window: 60, // 60秒
  })

  const { success } = await limiter.limit()

  if (!success) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: {
        'Retry-After': '60',
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
      },
    })
  }

  // 通常の処理
}
```

**方法3: Cloudflare KVでカスタム実装**

```typescript
async function checkRateLimit(
  kv: KVNamespace,
  identifier: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const key = `rate_limit:${identifier}:${Math.floor(Date.now() / (windowSeconds * 1000))}`
  const count = await kv.get(key)

  if (count && parseInt(count) >= limit) {
    return false // レート制限超過
  }

  await kv.put(key, String((parseInt(count || '0') + 1)), {
    expirationTtl: windowSeconds,
  })

  return true // OK
}
```

**推奨設定**:

```typescript
// SSEエンドポイント: 緩い制限（接続維持のため）
SSE_RATE_LIMIT = 10接続/分/IP

// RPCエンドポイント: 厳しい制限（API呼び出しのため）
RPC_RATE_LIMIT = 60リクエスト/分/IP

// analyzeRemoteVideoツール: 非常に厳しい制限（Gemini API保護）
VIDEO_ANALYSIS_RATE_LIMIT = 10リクエスト/時/IP
```

### MCPにおけるSSEトランスポートの動作

MCPプロトコルでSSEトランスポートを使用する場合、以下の2つのエンドポイントが必要です：

#### 1. SSEエンドポイント（サーバー→クライアント）

**目的**: サーバーからクライアントへのメッセージ送信

**動作**:
- クライアントがSSEエンドポイントに接続
- サーバーはイベントストリームでメッセージを送信
- JSON-RPC 2.0メッセージを `data` フィールドで送信

**メッセージ例**:
```
event: message
data: {"jsonrpc":"2.0","method":"notifications/initialized","params":{}}

```

#### 2. POSTエンドポイント（クライアント→サーバー）

**目的**: クライアントからサーバーへのメッセージ送信

**動作**:
- クライアントがHTTP POSTでメッセージを送信
- サーバーは同期的にレスポンスを返す
- このプロジェクトでは `/rpc` エンドポイントが該当

**リクエスト例**:
```http
POST /rpc HTTP/1.1
Content-Type: application/json

{"jsonrpc":"2.0","method":"tools/list","id":1}
```

**レスポンス例**:
```http
HTTP/1.1 200 OK
Content-Type: application/json

{"jsonrpc":"2.0","result":{"tools":[...]},"id":1}
```

### JSON-RPC 2.0 over SSE

MCP over SSEでは、JSON-RPC 2.0メッセージをSSEイベントとして送信します：

**通知（Notification）**:
```
event: message
data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}

```

**リクエスト（Request）**:
```
event: message
data: {"jsonrpc":"2.0","method":"tools/list","id":1}

```

**レスポンス（Response）**:
```
event: message
data: {"jsonrpc":"2.0","result":{"tools":[...]},"id":1}

```

**エラーレスポンス**:
```
event: message
data: {"jsonrpc":"2.0","error":{"code":-32601,"message":"Method not found"},"id":1}

```

## ベストプラクティス

### 1. シークレット管理

- SHARED_SECRETは環境変数として管理
- バージョン管理システムにコミットしない
- 定期的にローテーション
- 本番環境では強力なランダム値を使用

### 2. エラーハンドリング

- 接続が切れた場合の自動再接続ロジックを実装
- 適切なタイムアウト設定
- エラーログの監視

### 3. 監視とデバッグ

- SSE接続の状態を監視
- pingイベントの受信を確認
- ネットワークタブでイベントストリームを確認

### 4. 本番デプロイ

#### 本番環境へのデプロイ手順

**ステップ1: シークレットの生成と管理**

```bash
# 1. 本番用の強力なシークレットを生成
PROD_SECRET=$(openssl rand -hex 32)
echo "生成されたシークレット: $PROD_SECRET"
# ⚠️ このシークレットを安全に保存してください（パスワードマネージャーなど）

# 2. Wranglerを使用してシークレットを設定
wrangler secret put GOOGLE_API_KEY
# プロンプトに従ってGoogle API Keyを入力

wrangler secret put SHARED_SECRET
# プロンプトに従って生成したシークレットを入力
```

**ステップ2: GitHub Secretsとの連携（CI/CD用）**

GitHub Actionsを使用する場合：

1. GitHubリポジトリの Settings > Secrets and variables > Actions に移動
2. 以下のシークレットを追加:
   - `CLOUDFLARE_API_TOKEN`: Cloudflare API トークン
   - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare アカウント ID
   - `GOOGLE_API_KEY`: Google API キー
   - `SHARED_SECRET`: 64文字のシークレット

**GitHub Actions ワークフロー例（`.github/workflows/deploy.yml`）**:

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    name: Deploy
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Set Cloudflare secrets
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          echo "${{ secrets.GOOGLE_API_KEY }}" | wrangler secret put GOOGLE_API_KEY
          echo "${{ secrets.SHARED_SECRET }}" | wrangler secret put SHARED_SECRET

      - name: Deploy to Cloudflare Workers
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: npm run deploy
```

**ステップ3: 環境別設定（wrangler.toml）**

```toml
name = "mcp-video-understanding"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# 本番環境
[env.production]
name = "mcp-video-production"
vars = {
  ALLOWED_ORIGINS = "https://app.example.com,https://admin.example.com",
  ENVIRONMENT = "production"
}

# ステージング環境
[env.staging]
name = "mcp-video-staging"
vars = {
  ALLOWED_ORIGINS = "https://staging.example.com",
  ENVIRONMENT = "staging"
}

# 開発環境
[env.development]
name = "mcp-video-dev"
vars = {
  ALLOWED_ORIGINS = "http://localhost:3000,http://127.0.0.1:8787",
  ENVIRONMENT = "development"
}
```

**環境別デプロイコマンド**:
```bash
# 本番環境
wrangler deploy --env production

# ステージング環境
wrangler deploy --env staging

# 開発環境
wrangler deploy --env development
```

**ステップ4: デプロイ実行**

```bash
# ビルドとデプロイ
npm run deploy

# または特定の環境へのデプロイ
wrangler deploy --env production
```

**ステップ5: 動作確認**

```bash
# SSE接続のテスト
curl -N -H "Authorization: Bearer $PROD_SECRET" \
     https://mcp-video-production.your-subdomain.workers.dev/sse

# ツールリストの取得
curl -X POST https://mcp-video-production.your-subdomain.workers.dev/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

**ステップ6: 監視とログ**

```bash
# リアルタイムログの監視
wrangler tail --env production

# 特定のフィルタを適用
wrangler tail --env production --format json | jq 'select(.outcome == "exception")'
```

#### シークレットのローテーション手順

本番環境のシークレットを定期的に更新することを推奨します：

```bash
# 1. 新しいシークレットを生成
NEW_SECRET=$(openssl rand -hex 32)

# 2. 新しいシークレットを記録（パスワードマネージャーなど）
echo "新しいシークレット: $NEW_SECRET"

# 3. Cloudflare Workersのシークレットを更新
echo "$NEW_SECRET" | wrangler secret put SHARED_SECRET --env production

# 4. クライアント側の設定を更新
# - Claude Desktop の設定
# - CI/CD の GitHub Secrets
# - その他のクライアント

# 5. 動作確認
curl -N -H "Authorization: Bearer $NEW_SECRET" \
     https://your-worker.your-subdomain.workers.dev/sse

# 6. 古いシークレットを無効化（更新後24時間程度の猶予期間を推奨）
```

#### ロールバック手順

問題が発生した場合のロールバック：

```bash
# 1. 以前のデプロイメントを確認
wrangler deployments list --env production

# 2. 特定のバージョンにロールバック
wrangler rollback [deployment-id] --env production

# 3. 動作確認
curl -X POST https://your-worker.your-subdomain.workers.dev/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

#### セキュリティチェックリスト

本番デプロイ前に以下を確認：

- [ ] SHARED_SECRETが64文字のランダム文字列
- [ ] 環境変数がハードコーディングされていない
- [ ] CORS設定が適切（ワイルドカードを使用していない）
- [ ] HTTPS接続のみを許可
- [ ] レート制限が設定されている（次セクション参照）
- [ ] ログ監視が設定されている
- [ ] エラー通知が設定されている（Sentry、Datadogなど）
- [ ] バックアップと復旧手順が文書化されている

## まとめ

このMCPサーバーのSSE実装は、以下の機能を提供します：

- ✅ 認証付きSSE接続
- ✅ CORS対応
- ✅ Keep-Alive機構
- ✅ RPCエンドポイント
- ✅ Cloudflare Workersでのデプロイ

SSEトランスポートを使用することで、リアルタイム通信が必要なMCPクライアントとの統合が可能になります。

---

## よくある質問（FAQ）

### Q1: ブラウザのEventSourceでは認証ヘッダーを送信できないのですが？

**A**: ブラウザの標準EventSource APIはカスタムヘッダーをサポートしていません。**推奨される方法**：

1. **polyfillを使用（推奨）**:
   ```javascript
   import EventSourcePolyfill from 'event-source-polyfill';
   const eventSource = new EventSourcePolyfill('/sse', {
     headers: {
       'Authorization': `Bearer ${SECRET}`
     }
   });
   ```

2. **Node.js環境を使用**: Node.jsの`eventsource`パッケージはカスタムヘッダーをサポート

3. **サーバー側で認証方式を変更**: Cookie認証など、ブラウザが自動送信する方式を使用

> **⚠️ セキュリティ警告**: URL内にトークンを含める方法は**絶対に使用しないでください**。詳細は「セキュリティ: 避けるべきアンチパターン」セクションを参照してください。

### Q2: SSEとWebSocketの違いは？

**A**:
- **SSE**: 一方向（サーバー→クライアント）、HTTPベース、自動再接続
- **WebSocket**: 双方向、専用プロトコル、手動再接続

MCPのSSEトランスポートは、SSE（サーバー→クライアント）とHTTP POST（クライアント→サーバー）を組み合わせて双方向通信を実現しています。

### Q3: Cloudflare Workersでの接続時間制限は？

**A**: Cloudflare Workersの無料プランでは、CPU時間は10ms、リクエスト全体では30秒の制限があります。有料プランではCPU時間50ms、リクエスト時間は最大15分まで延長可能です。

長時間接続が必要な場合は、定期的に再接続するか、Cloudflare Durable Objectsの使用を検討してください。

### Q4: 本番環境でのセキュリティ対策は？

**A**:
1. **HTTPS必須**: 本番環境では必ずHTTPSを使用
2. **強力なシークレット**: 64文字のランダムな値を使用
3. **レート制限**: Cloudflare Rate Limitingを設定
4. **CORS設定**: 必要なオリジンのみを許可
5. **ログ監視**: 異常なアクセスパターンを監視

### Q5: Claude Desktop以外のクライアントは？

**A**: MCP仕様に準拠したクライアントであれば使用可能です：
- Cursor
- Windsurf
- カスタムMCPクライアント（自作）

実装例は「JavaScriptクライアントの実装例」セクションを参照してください。

### Q6: ローカル開発時のSSE接続が不安定なのですが？

**A**: 以下を確認してください：
1. ファイアウォールやウイルス対策ソフトがブロックしていないか
2. プロキシ設定が干渉していないか
3. `wrangler dev`が正常に動作しているか
4. ブラウザの開発者ツールでネットワークエラーを確認

## Streamable HTTPへの移行ガイド

### Streamable HTTPとは

Streamable HTTP（HTTP Stream Transport）は、MCP仕様2025-03-26で導入された新しいトランスポート方式です。SSEの後継として設計され、より効率的で柔軟な双方向通信を提供します。

### SSEとStreamable HTTPの比較

| 特徴 | SSE | Streamable HTTP |
|------|-----|----------------|
| **プロトコル** | text/event-stream | application/json-seq |
| **双方向通信** | SSE + HTTP POST | 単一HTTPストリーム |
| **効率性** | 2つのエンドポイント必要 | 1つのエンドポイントで完結 |
| **仕様** | WHATWG標準 | MCP独自仕様 |
| **ブラウザサポート** | EventSource API | fetch + ReadableStream |
| **将来性** | 非推奨（後方互換性あり） | 推奨 |

### 移行のメリット

1. **シンプルな実装**: 1つのエンドポイントで双方向通信
2. **パフォーマンス向上**: オーバーヘッドの削減
3. **将来性**: 新機能のサポート
4. **標準化**: MCPエコシステムとの整合性

### 移行手順

#### ステップ1: Streamable HTTPエンドポイントの追加

現在のSSE実装に加えて、Streamable HTTPエンドポイントを追加：

```typescript
async fetch(request: Request): Promise<Response> {
  const url = new URL(request.url)

  // 既存のSSEエンドポイント（後方互換性）
  if (url.pathname === '/sse') {
    // 現在の実装を維持
  }

  // 新しいStreamable HTTPエンドポイント
  if (url.pathname === '/stream') {
    return this.handleStreamableHttp(request)
  }

  // 既存のRPCエンドポイント（引き続き使用可能）
  if (url.pathname === '/rpc') {
    // 現在の実装を維持
  }
}

private async handleStreamableHttp(request: Request): Promise<Response> {
  // Streamable HTTP実装
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // JSON Sequence形式でメッセージを送信
      const sendMessage = (message: any) => {
        const json = JSON.stringify(message)
        // RFC 7464 JSON Text Sequences形式
        controller.enqueue(encoder.encode('\x1E'))  // Record Separator
        controller.enqueue(encoder.encode(json))
        controller.enqueue(encoder.encode('\n'))
      }

      // 初期化メッセージ
      sendMessage({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      })

      // リクエストボディからクライアントメッセージを読み取り
      if (request.body) {
        const reader = request.body.getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            // クライアントからのメッセージを処理
            const text = decoder.decode(value)
            const messages = text.split('\x1E').filter(m => m.trim())

            for (const messageText of messages) {
              const message = JSON.parse(messageText)
              const response = await this.handleRpcMessage(message)
              sendMessage(response)
            }
          }
        } finally {
          reader.releaseLock()
        }
      }
    }
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/json-seq',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache, no-transform',
      ...this.buildCorsHeaders(request.headers.get('Origin')),
    }
  })
}
```

#### ステップ2: クライアント側の更新

Claude Desktop設定を更新：

```json
{
  "mcpServers": {
    "gemini-video": {
      "url": "http://127.0.0.1:8787/stream",
      "transport": {
        "type": "http-stream",  // "sse"から変更
        "headers": {
          "Authorization": "Bearer your_64_character_secret_here"
        }
      }
    }
  }
}
```

#### ステップ3: 段階的な移行

両方のエンドポイントを同時に提供し、段階的に移行：

```toml
# wrangler.toml
[env.production]
vars = {
  ENABLE_SSE = "true",           # 既存のクライアント用
  ENABLE_STREAMABLE_HTTP = "true", # 新しいクライアント用
  PREFERRED_TRANSPORT = "http-stream"
}
```

#### ステップ4: 監視と検証

移行中は両方のトランスポートを監視：

```bash
# SSEエンドポイントのアクセスログ
wrangler tail --format json | jq 'select(.request.url | contains("/sse"))'

# Streamable HTTPエンドポイントのアクセスログ
wrangler tail --format json | jq 'select(.request.url | contains("/stream"))'
```

#### ステップ5: SSEエンドポイントの非推奨化

全クライアントの移行完了後、SSEエンドポイントを非推奨化：

```typescript
if (url.pathname === '/sse') {
  console.warn('SSE endpoint is deprecated. Please migrate to /stream')

  // 非推奨警告ヘッダーを追加
  const response = await this.handleSSE(request)
  response.headers.set('Warning', '299 - "SSE transport is deprecated"')
  response.headers.set('X-Deprecated-Endpoint', 'true')
  response.headers.set('X-Migrate-To', '/stream')
  return response
}
```

### よくある質問：移行編

**Q: いつまでにStreamable HTTPに移行すべきですか？**

A: 現時点で強制的な移行期限は設定されていませんが、以下を推奨します：
- 新規プロジェクト: 初めからStreamable HTTPを使用
- 既存プロジェクト: 6ヶ月以内に移行計画を策定
- 本番環境: 1年以内に段階的移行を完了

**Q: 両方のトランスポートを同時にサポートできますか？**

A: はい、推奨される移行戦略です。両エンドポイントを同時に提供し、段階的にクライアントを移行させることで、ダウンタイムなしで移行できます。

**Q: Streamable HTTPのパフォーマンスはSSEより良いですか？**

A: はい、一般的に以下の理由でパフォーマンスが向上します：
- 単一の接続で双方向通信（オーバーヘッド削減）
- より効率的なメッセージフォーマット
- ブラウザAPIの制約がない

## セキュリティ: 避けるべきアンチパターン

### ❌ URL内にトークンを含める方法

以下のような実装は**絶対に使用しないでください**：

```javascript
// ❌ 危険: このコードを使用しないでください
const SECRET = 'your_secret_here';
const eventSource = new EventSource(`/sse?token=${SECRET}`);
```

#### この方法が危険な理由

1. **サーバーログに記録される**
   - ほとんどのWebサーバーはURLをログに記録します
   - アクセスログにシークレットが平文で保存されます
   - ログ分析ツールやモニタリングシステムにも露出します

2. **ブラウザ履歴に保存される**
   - ブラウザがURL履歴にシークレットを保存します
   - 共有PCでは他のユーザーがアクセス可能です
   - 履歴の自動同期でクラウドに保存される可能性があります

3. **プロキシログに記録される**
   - 企業プロキシやVPNがURLを記録します
   - HTTPSでもプロキシサーバーには平文で見えます
   - ネットワーク管理者がアクセス可能です

4. **Refererヘッダーで漏洩**
   - リンクをクリックすると、Refererヘッダーに含まれます
   - 外部サイトにシークレットが送信される可能性があります

5. **ブックマークやシェアで漏洩**
   - URLを共有するとシークレットも共有されます
   - SNSやチャットで意図せず公開される危険性があります

#### 正しい実装方法

**✅ Authorizationヘッダーを使用（推奨）**:
```javascript
// Node.js環境
import EventSource from 'eventsource';
const eventSource = new EventSource('http://127.0.0.1:8787/sse', {
  headers: {
    'Authorization': `Bearer ${SECRET}`
  }
});

// ブラウザ環境（polyfill使用）
import EventSourcePolyfill from 'event-source-polyfill';
const eventSource = new EventSourcePolyfill('http://127.0.0.1:8787/sse', {
  headers: {
    'Authorization': `Bearer ${SECRET}`
  }
});
```

**✅ Cookieベース認証（ブラウザ環境）**:
```javascript
// サーバー側でセッションCookieを設定
// ブラウザが自動的に送信
const eventSource = new EventSource('/sse', {
  withCredentials: true
});
```

### ❌ CORSワイルドカードの本番使用

以下のような設定は本番環境では**避けるべき**です：

```typescript
// ❌ 本番環境では危険
'Access-Control-Allow-Origin': '*'
```

#### 正しいCORS設定

**✅ 環境別のホワイトリスト**:
```typescript
// 環境変数から許可オリジンを取得
const ALLOWED_ORIGINS = (env.ALLOWED_ORIGINS || '').split(',');

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = origin && ALLOWED_ORIGINS.includes(origin);

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
```

**wrangler.toml設定例**:
```toml
[env.production]
name = "mcp-video-production"
vars = { ALLOWED_ORIGINS = "https://app.example.com,https://admin.example.com" }

[env.development]
name = "mcp-video-dev"
vars = { ALLOWED_ORIGINS = "http://localhost:3000,http://127.0.0.1:8787" }
```

### ❌ シークレットのハードコーディング

```typescript
// ❌ 危険: コードにシークレットを埋め込まない
const SHARED_SECRET = "abc123..."; // 絶対にやらないこと
```

**✅ 環境変数を使用**:
```typescript
const SHARED_SECRET = env.SHARED_SECRET;
if (!SHARED_SECRET || SHARED_SECRET.length !== 64) {
  throw new Error('Invalid SHARED_SECRET configuration');
}
```

## 参考資料

### 公式ドキュメント
- [Model Context Protocol 公式サイト](https://modelcontextprotocol.io/)
- [MCP 仕様（GitHub）](https://github.com/modelcontextprotocol/specification)
- [Server-Sent Events 仕様（WHATWG）](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [Cloudflare Workers ドキュメント](https://developers.cloudflare.com/workers/)
- [workers-mcp パッケージ](https://www.npmjs.com/package/workers-mcp)

### 関連リソース
- [JSON-RPC 2.0 仕様](https://www.jsonrpc.org/specification)
- [EventSource API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
- [Gemini API ドキュメント](https://ai.google.dev/docs)

### コミュニティ
- [MCP GitHub Discussions](https://github.com/modelcontextprotocol/specification/discussions)
- [Cloudflare Developers Discord](https://discord.cloudflare.com/)

---

**最終更新**: 2025年11月
**ドキュメントバージョン**: 1.1
**対象MCPバージョン**: 2024-11-05 以降

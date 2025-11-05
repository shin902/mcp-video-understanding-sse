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

- **Keep-Alive間隔**: 25秒
- **最大接続時間**: Cloudflare Workersの制限に依存（通常30秒〜数分）
- **同時接続**: Cloudflare Workersのプランに依存

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

```bash
# 1. 環境変数を本番環境に設定
wrangler secret put GOOGLE_API_KEY
wrangler secret put SHARED_SECRET

# 2. デプロイ
npm run deploy

# 3. 動作確認
curl -H "Authorization: Bearer $SHARED_SECRET" \
     https://your-worker.your-subdomain.workers.dev/sse
```

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

**A**: ブラウザの標準EventSource APIはカスタムヘッダーをサポートしていません。以下の方法があります：

1. **URL内にトークンを含める**（非推奨）:
   ```javascript
   const eventSource = new EventSource(`/sse?token=${SECRET}`);
   ```

2. **polyfillを使用**:
   ```javascript
   import EventSourcePolyfill from 'event-source-polyfill';
   const eventSource = new EventSourcePolyfill('/sse', {
     headers: {
       'Authorization': `Bearer ${SECRET}`
     }
   });
   ```

3. **Node.js環境を使用**: Node.jsの`eventsource`パッケージはカスタムヘッダーをサポート

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

**最終更新**: 2025年1月
**ドキュメントバージョン**: 1.0
**対象MCPバージョン**: 2024-11-05 以降

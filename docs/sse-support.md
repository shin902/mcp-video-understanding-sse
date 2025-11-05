# SSE（Server-Sent Events）接続サポート

## 目次

1. [概要](#概要)
2. [SSEトランスポートとは](#sseトランスポートとは)
3. [このプロジェクトのSSE実装](#このプロジェクトのsse実装)
4. [セットアップ](#セットアップ)
5. [クライアント接続](#クライアント接続)
6. [認証](#認証)
7. [エンドポイント詳細](#エンドポイント詳細)
8. [トラブルシューティング](#トラブルシューティング)
9. [技術仕様](#技術仕様)

---

## 概要

このMCPサーバーは、**Server-Sent Events (SSE)** トランスポートをサポートしています。SSEは、サーバーからクライアントへのリアルタイム通信を実現するHTTPベースのプロトコルで、長時間実行される接続を維持し、サーバーからクライアントへデータをプッシュすることができます。

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

## 技術仕様

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

## 参考資料

- [Model Context Protocol 公式ドキュメント](https://modelcontextprotocol.io/)
- [Server-Sent Events 仕様](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [Cloudflare Workers ドキュメント](https://developers.cloudflare.com/workers/)
- [workers-mcp パッケージ](https://www.npmjs.com/package/workers-mcp)

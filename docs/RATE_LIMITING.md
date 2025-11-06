# レート制限ガイド

## 概要

このドキュメントでは、MCP Video Understanding サーバーのレート制限の設定方法と推奨設定について説明します。

## なぜレート制限が必要か

レート制限は以下の理由で重要です：

1. **コスト管理**: Gemini API の過剰な使用を防ぎ、APIコストを抑制
2. **DoS攻撃対策**: 悪意のあるユーザーからのサービス拒否攻撃を防御
3. **リソース保護**: サーバーリソースの公平な配分を確保
4. **API クォータ管理**: Gemini API のレート制限に到達することを防ぐ

## 推奨レート制限設定

| エンドポイント | 推奨制限 | 理由 |
|--------------|---------|------|
| `/sse` | 10 接続/分/IP | SSE接続は長時間維持されるため、新規接続に制限をかける |
| `/rpc` | 60 リクエスト/分/IP | 一般的なRPC呼び出しの制限 |
| `analyzeRemoteVideo` | 10 リクエスト/時/IP | Gemini API の重い処理を制限し、コストを管理 |

## 実装方法

### 方法1: Cloudflare Rate Limiting（推奨 - 本番環境）

Cloudflare ダッシュボードでレート制限ルールを設定します。

#### 設定手順

1. **Cloudflare ダッシュボードにログイン**
2. **Security > WAF > Rate limiting rules** に移動
3. **Create rule** をクリック

#### SSE エンドポイント用ルール

```
名前: SSE Connection Rate Limit
URL パターン: example.com/sse
リクエスト数: 10 リクエスト
期間: 1 分
識別子: IP アドレス
アクション: Block
レスポンス: 429 Too Many Requests
```

#### RPC エンドポイント用ルール

```
名前: RPC Request Rate Limit
URL パターン: example.com/rpc
リクエスト数: 60 リクエスト
期間: 1 分
識別子: IP アドレス
アクション: Block
レスポンス: 429 Too Many Requests
```

#### Video Analysis 用ルール

```
名前: Video Analysis Rate Limit
URL パターン: example.com/rpc
リクエスト数: 10 リクエスト
期間: 1 時間
識別子: IP アドレス
条件: Body contains "analyzeRemoteVideo"
アクション: Block
レスポンス: 429 Too Many Requests
```

### 方法2: Cloudflare Workers 内での実装（カスタム制御）

より細かい制御が必要な場合は、Workers 内でレート制限を実装します。

#### Cloudflare KV を使用した実装

**1. KV Namespace の作成**

```bash
wrangler kv:namespace create "RATE_LIMIT"
```

**2. wrangler.toml に追加**

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "your-kv-namespace-id"
```

**3. レート制限コードの実装**

```typescript
interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

async function checkRateLimit(
  kv: KVNamespace,
  ip: string,
  endpoint: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Date.now()
  const windowStart = Math.floor(now / (windowSeconds * 1000))
  const key = `rate_limit:${ip}:${endpoint}:${windowStart}`

  const currentCount = await kv.get(key)
  const count = currentCount ? parseInt(currentCount) : 0

  if (count >= limit) {
    const resetAt = (windowStart + 1) * windowSeconds * 1000
    return {
      allowed: false,
      remaining: 0,
      resetAt,
    }
  }

  await kv.put(key, String(count + 1), {
    expirationTtl: windowSeconds + 60, // 少し余裕を持たせる
  })

  return {
    allowed: true,
    remaining: limit - count - 1,
    resetAt: (windowStart + 1) * windowSeconds * 1000,
  }
}

// fetch メソッド内での使用例
async fetch(request: Request): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const url = new URL(request.url)

  // SSE エンドポイントのレート制限
  if (url.pathname === '/sse') {
    const result = await checkRateLimit(
      this.env.RATE_LIMIT,
      ip,
      'sse',
      10, // 10 リクエスト
      60  // 1 分
    )

    if (!result.allowed) {
      return new Response('Too Many Requests', {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)),
          'X-RateLimit-Limit': '10',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(result.resetAt / 1000)),
        },
      })
    }
  }

  // 既存の処理...
}
```

### 方法3: Durable Objects を使用した実装（高度）

長時間接続やステートフルなレート制限が必要な場合は、Durable Objects を使用します。

**特徴**:
- リアルタイムでの状態管理
- 複数の Workers インスタンス間での一貫性
- より複雑なレート制限ロジックの実装が可能

**実装例**（概要）:

```typescript
export class RateLimitDO extends DurableObject {
  private requests: Map<string, number[]> = new Map()

  async checkLimit(ip: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now()
    const requests = this.requests.get(ip) || []

    // 古いリクエストを削除
    const recent = requests.filter(time => now - time < windowMs)

    if (recent.length >= limit) {
      return false
    }

    recent.push(now)
    this.requests.set(ip, recent)

    return true
  }
}
```

## レスポンスヘッダー

レート制限を実装する際は、以下のヘッダーを返すことを推奨します：

```
X-RateLimit-Limit: 60          # 制限値
X-RateLimit-Remaining: 45      # 残りのリクエスト数
X-RateLimit-Reset: 1704067200  # リセット時刻（Unix timestamp）
Retry-After: 60                # 再試行までの秒数（429の場合）
```

## モニタリング

レート制限の効果を監視するために、以下の指標を追跡します：

1. **制限に到達した回数**: 429 レスポンスの数
2. **制限に到達したIP**: 悪意のあるユーザーの特定
3. **エンドポイント別のリクエスト数**: ホットスポットの特定
4. **平均リクエスト間隔**: 正常なユーザーパターンの理解

### Cloudflare Analytics の活用

```bash
# レート制限の統計を取得
wrangler tail --format json | jq 'select(.outcome == "exception" and .response.status == 429)'
```

## テスト

レート制限が正しく動作することを確認するためのテストスクリプト：

```bash
#!/bin/bash
# test-rate-limit.sh

ENDPOINT="http://127.0.0.1:8787/rpc"
SECRET=$(grep SHARED_SECRET .dev.vars | cut -d'=' -f2)

echo "Testing rate limiting..."

# 60回のリクエストを送信
for i in {1..65}; do
  RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')

  HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d':' -f2)

  if [ "$HTTP_CODE" = "429" ]; then
    echo "Request $i: Rate limited (429) ✓"
    exit 0
  else
    echo "Request $i: Success ($HTTP_CODE)"
  fi

  sleep 0.5
done

echo "❌ Rate limit not triggered after 65 requests"
exit 1
```

## セキュリティ考慮事項

1. **IP ベースの制限の限界**:
   - NAT 環境では複数のユーザーが同じ IP を共有する可能性
   - VPN や Tor を使用した回避が可能

2. **推奨される追加対策**:
   - ユーザー認証ベースのレート制限
   - CAPTCHA の導入（疑わしい活動の場合）
   - IP レピュテーションサービスの利用

3. **ホワイトリスト**:
   信頼できる IP アドレスや API キーに対しては、より高い制限を設定できます。

## トラブルシューティング

### Q: 正常なユーザーがブロックされている

**A**: レート制限が厳しすぎる可能性があります。以下を確認してください：
- ユーザーの実際の使用パターン
- 制限値の調整（段階的に緩和）
- ホワイトリストの検討

### Q: レート制限が効いていない

**A**: 以下を確認してください：
- Cloudflare ダッシュボードでルールが有効化されているか
- KV Namespace が正しくバインドされているか
- IP アドレスが正しく取得できているか（`CF-Connecting-IP` ヘッダー）

### Q: コストが高い

**A**: レート制限が適切に機能していない可能性があります：
- より厳しい制限値に調整
- `analyzeRemoteVideo` に特別な制限を設定
- Cloudflare Analytics でトラフィックパターンを分析

## まとめ

レート制限は、本番環境でのデプロイに**必須**です。最低限、Cloudflare ダッシュボードでの設定を行ってください。

より細かい制御が必要な場合は、Cloudflare KV または Durable Objects を使用したカスタム実装を検討してください。

---

**参考資料**:
- [Cloudflare Rate Limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Cloudflare Workers KV](https://developers.cloudflare.com/workers/runtime-apis/kv/)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/workers/runtime-apis/durable-objects/)

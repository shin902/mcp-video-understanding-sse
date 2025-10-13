import { WorkerEntrypoint } from 'cloudflare:workers'
import { ProxyToSelf } from 'workers-mcp'
import { GoogleGenAI, createUserContent, createPartFromUri } from '@google/genai'
import type { Env } from './env'

const DEFAULT_PROMPT = "最初にこの記事全体を要約し全体像を掴んだ後、大きなセクションごとに細かく要約を行ってください。 その次に小さなセクションごとに更に詳細な要約を行ってください。"
const DEFAULT_MODEL = "gemini-2.5-flash"

export default class GeminiVideoWorker extends WorkerEntrypoint<Env> {
  /**
   * リモート動画URLを Gemini で分析します。YouTube などの公開動画URLに対応しています。
   * @param videoUrl {string} 分析する動画のURL（YouTube等）
   * @param prompt {string} オプションのカスタムプロンプト（デフォルト: 要約プロンプト）
   * @param model {string} 使用するGeminiモデル名（デフォルト: gemini-2.5-flash）
   * @return {string} Geminiによる動画分析結果
   */
  async analyzeRemoteVideo(
    videoUrl: string,
    prompt?: string,
    model?: string
  ): Promise<string> {
    const apiKey = this.env.GOOGLE_API_KEY
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY environment variable is not set')
    }

    const ai = new GoogleGenAI({ apiKey })
    const actualPrompt = prompt && prompt.trim() ? prompt.trim() : DEFAULT_PROMPT
    const actualModel = model && model.trim() ? model.trim() : DEFAULT_MODEL

    try {
      // URLのバリデーション
      let parsedUrl: URL
      try {
        parsedUrl = new URL(videoUrl)
      } catch (error) {
        throw new Error(`Invalid video URL: ${videoUrl}`)
      }

      // MIMEタイプの推測
      const mimeType = this.guessMimeType(parsedUrl.pathname) ?? 'application/octet-stream'

      // Gemini APIにリクエスト
      const response = await ai.models.generateContent({
        model: actualModel,
        contents: createUserContent([
          createPartFromUri(parsedUrl.toString(), mimeType),
          actualPrompt,
        ]),
      })

      // レスポンスからテキストを抽出
      return this.extractText(response)
    } catch (error) {
      // YouTubeの場合は特別なエラーメッセージ
      if (this.isYouTubeUrl(videoUrl) && this.isInternalError(error)) {
        throw new Error(
          'Gemini Developer API は YouTube のリモート動画解析を安定して扱えません。Vertex AI を利用するか、動画をダウンロードしてください。'
        )
      }

      // パーミッションエラーの場合
      if (this.isPermissionError(error)) {
        return `Gemini API でエラーが発生しました: ${error instanceof Error ? error.message : String(error)}\n\n考えられる原因:\n- 限定公開の動画の可能性があります。\n- 配信のアーカイブ動画の可能性があります。\n\n動画を公開設定にして再試行してください。`
      }

      throw error
    }
  }

  /**
   * @ignore
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    const origin = request.headers.get('Origin')
    const corsHeaders = this.buildCorsHeaders(origin)

    if (url.pathname === '/sse') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        })
      }

      const secret = this.env.SHARED_SECRET
      const authHeader = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''

      if (!secret || secret.length !== 64 || authHeader !== secret) {
        return new Response('Unauthorized', {
          status: 401,
          headers: {
            ...corsHeaders,
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
          },
        })
      }

      const encoder = new TextEncoder()
      let intervalHandle: ReturnType<typeof setInterval> | null = null

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // Immediately send a ready event so SSE clients know the stream is alive.
          controller.enqueue(encoder.encode('event: ready\n'))
          controller.enqueue(encoder.encode('data: "ok"\n\n'))

          intervalHandle = setInterval(() => {
            controller.enqueue(encoder.encode('event: ping\n'))
            controller.enqueue(encoder.encode(`data: ${Date.now()}\n\n`))
          }, 25000)

          controller.enqueue(encoder.encode(': keep-alive\n\n'))
        },
        cancel() {
          if (intervalHandle) {
            clearInterval(intervalHandle)
            intervalHandle = null
          }
        },
      })

      request.signal.addEventListener('abort', () => {
        if (intervalHandle) {
          clearInterval(intervalHandle)
          intervalHandle = null
        }
      })

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          ...corsHeaders,
        },
      })
    }

    if (url.pathname === '/rpc') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            ...corsHeaders,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
          },
        })
      }

      const response = await new ProxyToSelf(this).fetch(request)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(corsHeaders)) {
        headers.set(key, value)
      }
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    return new ProxyToSelf(this).fetch(request)
  }

  /**
   * @ignore
   */
  private guessMimeType(pathname: string): string | null {
    const ext = pathname.split('.').pop()?.toLowerCase()
    const mimeMap: Record<string, string> = {
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'webm': 'video/webm',
      'mkv': 'video/x-matroska',
      'm4v': 'video/x-m4v',
    }
    return ext ? mimeMap[ext] || null : null
  }

  /**
   * @ignore
   */
  private isYouTubeUrl(url: string): boolean {
    try {
      const parsed = new URL(url)
      const youtubeHosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']
      return youtubeHosts.includes(parsed.hostname)
    } catch {
      return false
    }
  }

  /**
   * @ignore
   */
  private buildCorsHeaders(origin: string | null): Record<string, string> {
    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': origin ?? '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    }
    if (origin && origin !== '*') {
      headers['Access-Control-Allow-Credentials'] = 'true'
    }
    return headers
  }

  /**
   * @ignore
   */
  private isInternalError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const candidate = error as { status?: unknown; code?: unknown }

    if (typeof candidate.status === 'number' && candidate.status === 500) return true
    if (typeof candidate.status === 'string') {
      const normalized = candidate.status.trim().toUpperCase()
      if (normalized === '500' || normalized === 'INTERNAL' || normalized === 'INTERNAL_ERROR') {
        return true
      }
    }
    if (typeof candidate.code === 'number' && (candidate.code === 500 || candidate.code === 13)) {
      return true
    }
    return false
  }

  /**
   * @ignore
   */
  private isPermissionError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const candidate = error as Error & { status?: string; code?: number }

    if (typeof candidate.status === 'string' && candidate.status.toUpperCase() === 'PERMISSION_DENIED') {
      return true
    }
    if (typeof candidate.code === 'number' && candidate.code === 403) {
      return true
    }
    const message = error.message.toLowerCase()
    return (
      message.includes('permission denied') ||
      message.includes('does not have permission') ||
      message.includes('403')
    )
  }

  /**
   * @ignore
   */
  private extractText(result: any): string {
    if (!result) return ''

    // 直接textプロパティをチェック
    if (typeof result.text === 'string' && result.text.length > 0) {
      return result.text
    }
    if (typeof result.text === 'function') {
      const maybeText = result.text()
      if (maybeText && maybeText.length > 0) return maybeText
    }

    // responseネストをチェック
    const nested = result.response
    if (nested) {
      if (typeof nested.text === 'string' && nested.text.length > 0) {
        return nested.text
      }
      if (typeof nested.text === 'function') {
        const maybeText = nested.text()
        if (maybeText && maybeText.length > 0) return maybeText
      }

      // candidatesをチェック
      const candidates = nested.candidates
      if (Array.isArray(candidates) && candidates.length > 0) {
        const parts = candidates[0]?.content?.parts
        if (Array.isArray(parts) && parts.length > 0) {
          const textParts = parts
            .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
            .filter((part: string) => part.length > 0)
          if (textParts.length > 0) {
            return textParts.join('\n')
          }
        }
      }
    }

    return ''
  }
}

import { Hono } from 'hono'
import { App } from 'astro/app'
import { middleware, pages } from 'astro/hono'
import api from '@/server/api/app'
import { handleHandoff } from '@/server/auth/handoff'
import { validateRuntimeEnv } from '@/server/env-check'

validateRuntimeEnv()

const app = new Hono()

app.use(middleware())
app.get('/auth/handoff', (c) => handleHandoff(c))
app.route('/api', api)
app.use(pages())

/**
 * カスタム fetch パイプラインでは Node アダプタが Set-Cookie を自動付与しない。
 * （dev サーバーは getSetCookiesFromResponse を呼ぶが、本番の writeResponse は呼ばない）
 * Astro.cookies.set() で積んだ Cookie をレスポンスヘッダへ明示的に書き出す。
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const response = await app.fetch(request)
    for (const setCookie of App.getSetCookieFromResponse(response)) {
      response.headers.append('Set-Cookie', setCookie)
    }
    return response
  }
}

import node from '@astrojs/node'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

export default defineConfig({
  // SSR type configuration
  output: 'server',
  adapter: node({
    mode: 'standalone'
  }),
  session: false,
  server: {
    port: 3000, // 使用したいポート番号に変更
    host: true // 外部からのアクセスを許可する場合
  },
  security: {
    checkOrigin: false
  },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()]
  }
})

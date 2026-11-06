import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@shared': resolve(process.cwd(), 'src/shared')
    }
  }
})

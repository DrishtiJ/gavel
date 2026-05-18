import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

const isTest = process.argv.some(
  (arg) => arg.includes('vitest') || arg.includes('test'),
)

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  lint: {
    ignorePatterns: ['.agents/**', '.claude/**'],
    options: { typeAware: true, typeCheck: true },
  },
  fmt: {
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 80,
    sortPackageJson: false,
    ignorePatterns: [
      '.nitro/',
      '.output/',
      '.prettierrc',
      '.tanstack/',
      '**/api',
      '**/build',
      '**/public',
      'convex/_generated/',
      'example/convex/_generated/',
      'convex/README.md',
      'pnpm-lock.yaml',
      'routeTree.gen.ts',
      '.agents/',
      '.agents/skills/',
      '.claude/',
      '.claude/skills/',
    ],
  },
  server: {
    port: 3000,
  },
  resolve: {
    tsconfigPaths: true,
    alias: [
      {
        find: 'use-sync-external-store/shim/index.js',
        replacement: 'react',
      },
    ],
  },
  plugins: [
    tailwindcss(),
    ...(isTest ? [] : [tanstackStart(), nitro()]),
    viteReact(),
  ],
})

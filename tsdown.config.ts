import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  deps: {
    neverBundle: ['vite'],
  },
  dts: {
    cjsReexport: true,
  },
  clean: true,
})

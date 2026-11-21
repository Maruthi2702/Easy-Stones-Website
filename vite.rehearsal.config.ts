import { mergeConfig } from 'vite'
import base from './vite.config.ts'
export default mergeConfig(base, { cacheDir: 'node_modules/.vite-rehearsal', server: { port: 5180, strictPort: true } })

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import devApiPlugin from './dev-api-plugin'

export default defineConfig({
  plugins: [react(), devApiPlugin()],
})

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const httpsKeyPath = env.VITE_HTTPS_KEY || '/tmp/vite-key.pem';
  const httpsCertPath = env.VITE_HTTPS_CERT || '/tmp/vite-cert.pem';
  const httpsConfig = fs.existsSync(httpsKeyPath) && fs.existsSync(httpsCertPath)
    ? {
        key: fs.readFileSync(httpsKeyPath),
        cert: fs.readFileSync(httpsCertPath),
      }
    : undefined;
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            'vendor-state': ['zustand'],
            'vendor-ui': ['lucide-react'],
          },
        },
      },
    },
    server: {
      https: httpsConfig,
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/state': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client' },
  server: {
    port: 5173,
    // Escuta em todos os endereços (= o antigo `vite --host` do dev:celular):
    // sem isto o Vite fica só no IPv6 do localhost ([::1]) e quem procura
    // 127.0.0.1 (extensões de visualização mobile do VS Code) não acha nada;
    // assim também abre no celular pela rede, no endereço "Network".
    host: true,
    proxy: {
      // changeOrigin: false preserva o Host que o navegador usou (o atalho
      // em string trocava por localhost:3001): a API precisa dele para saber
      // se o acesso é pelo próprio notebook (cookie de sessão, server/auth.ts).
      '/api': { target: `http://localhost:${process.env.API_PORT ?? 3001}`, changeOrigin: false },
    },
  },
});

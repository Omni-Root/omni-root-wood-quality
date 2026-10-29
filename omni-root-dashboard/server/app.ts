// Monta a aplicação Express: middlewares, as rotas da API (agrupadas por
// assunto em rotas/) e, em produção, o cliente já compilado.
import compression from 'compression';
import express from 'express';
import fs from 'node:fs';
import { cacheEconomico } from './economia.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rotasSessao } from './rotas/sessao.js';
import { rotasOAuth } from './rotas/oauth.js';
import { rotasPainel } from './rotas/painel.js';
import { rotasCamera } from './rotas/camera.js';
import { rotasExportacoes } from './rotas/exportacoes.js';
import { rotasFrota } from './rotas/frota.js';
import { rotasPlateia } from './rotas/plateia.js';
import { rotasUsuarios } from './rotas/usuarios.js';
import { rotasConfiguracoes } from './rotas/configuracoes.js';

export function criarApp(): express.Express {
  const app = express();

  app.use(express.json({ limit: '64kb' }));

  // gzip nas respostas (JSON, HTML, JS, CSS): pelo túnel, cada byte sai do
  // upload do notebook. Fora: o tempo real (SSE) e a câmera (MJPEG), que
  // precisam sair na hora, e imagens (JPEG/PNG já são comprimidas).
  app.use(
    compression({
      filter: (req, res) => {
        const tipo = String(res.getHeader('Content-Type') ?? '');
        if (/^(text\/event-stream|multipart\/|image\/(?!svg))/.test(tipo)) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // Celular pelo túnel: as rotas de leitura saem de um cache de poucos
  // segundos, igual para todos — o banco é consultado uma vez, não cem
  // (server/economia.ts). O notebook passa direto.
  app.use(
    ['/api/maquinas', '/api/summary', '/api/timeseries', '/api/heatmap', '/api/ultima', '/api/qualidade', '/api/mapa', '/api/tendencia', '/api/frota', '/api/camera/maquinas'],
    cacheEconomico,
  );

  app.use(rotasSessao);
  app.use(rotasOAuth); // login social (Google, Microsoft, GitHub)
  app.use(rotasUsuarios); // contas (tela "Usuários", só admin)
  app.use(rotasConfiguracoes); // regras da aplicação (tela "Configurações", só admin)
  app.use(rotasPainel);
  app.use(rotasCamera);
  app.use(rotasFrota); // posição das máquinas em tempo real + trajeto
  app.use(rotasExportacoes);
  app.use(rotasPlateia); // QR code: painel no celular da plateia, pelo túnel

  // Em produção (`npm run build && npm start`) o Express também serve o cliente.
  // No `npm run dev`, o túnel da plateia (scripts/tunel.mjs) aponta para cá,
  // não para o Vite: serve o cliente compilado em dist/client — poucos
  // arquivos minificados por visita, em vez das centenas de módulos do modo
  // dev (o plano grátis do ngrok conta requisições).
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const clientDir = [path.resolve(aqui, '../client'), path.resolve(aqui, '../dist/client')].find((d) =>
    fs.existsSync(path.join(d, 'index.html')),
  ) ?? path.resolve(aqui, '../client');
  app.use(express.static(clientDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'), (err) => {
      if (err) res.status(404).end(); // dev: cliente é servido pelo Vite, não por aqui
    });
  });

  return app;
}

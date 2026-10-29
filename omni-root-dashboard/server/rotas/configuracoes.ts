// Configurações da aplicação (tela "Configurações", só admin):
//
//   GET   /api/configuracoes          lista (definição, valor, quem mudou)
//   PATCH /api/configuracoes/:chave   muda  {valor}
//
// Tipo e faixa de cada chave são conferidos em server/configuracoes.ts.
import express from 'express';
import { mesmaOrigem, requireAdmin, requireAuth, type Sessao } from '../auth.js';
import { atualizarConfiguracao, listarConfiguracoes } from '../configuracoes.js';
import { route } from '../http.js';

export const rotasConfiguracoes = express.Router();

rotasConfiguracoes.use('/api/configuracoes', mesmaOrigem, requireAuth, requireAdmin);

rotasConfiguracoes.get('/api/configuracoes', route(() => listarConfiguracoes()));

rotasConfiguracoes.patch(
  '/api/configuracoes/:chave',
  route(async (req, res) => {
    const { valor } = (req.body ?? {}) as { valor?: unknown };
    await atualizarConfiguracao(req.params.chave, valor, (res.locals.sessao as Sessao).id);
    return listarConfiguracoes();
  }),
);

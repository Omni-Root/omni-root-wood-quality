// Gestão de contas (tela "Usuários", só admin):
//
//   GET    /api/usuarios       lista
//   POST   /api/usuarios       cria   {login, nome?, papel, senha?}
//   PATCH  /api/usuarios/:id   muda   {nome?, papel?, ativo?, senha?, semSenha?}
//   DELETE /api/usuarios/:id   remove
//
// O admin não mexe no próprio papel/ativo nem se remove (não se tranca para
// fora sem querer); a própria senha ele troca em /api/me/senha, como todo
// mundo. Nunca fica sem admin ativo (server/usuarios.ts).
import express from 'express';
import { esquecerSessao, mesmaOrigem, requireAdmin, requireAuth, type Sessao } from '../auth.js';
import { route } from '../http.js';
import { encerrarEventosDe } from '../live.js';
import {
  atualizarUsuario,
  criarUsuario,
  listarUsuarios,
  normalizarLogin,
  removerUsuario,
  validarId,
  validarNome,
  validarPapel,
  validarSenha,
  type Mudancas,
} from '../usuarios.js';
import { ValidationError } from '../validate.js';

export const rotasUsuarios = express.Router();

rotasUsuarios.use('/api/usuarios', mesmaOrigem, requireAuth, requireAdmin);

rotasUsuarios.get('/api/usuarios', route(() => listarUsuarios()));

rotasUsuarios.post(
  '/api/usuarios',
  route(async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const senha = b.senha === undefined || b.senha === '' || b.senha === null ? null : validarSenha(b.senha);
    return criarUsuario({
      login: normalizarLogin(b.login),
      nome: validarNome(b.nome),
      papel: validarPapel(b.papel),
      senha,
    });
  }),
);

rotasUsuarios.patch(
  '/api/usuarios/:id',
  route(async (req, res) => {
    const id = validarId(req.params.id);
    const eu = res.locals.sessao as Sessao;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const m: Mudancas = {};
    if (b.nome !== undefined) m.nome = validarNome(b.nome);
    if (b.papel !== undefined) m.papel = validarPapel(b.papel);
    if (b.ativo !== undefined) {
      if (typeof b.ativo !== 'boolean') throw new ValidationError('"ativo" deve ser verdadeiro ou falso');
      m.ativo = b.ativo;
    }
    if (b.semSenha === true) m.senha = null;
    else if (b.senha !== undefined && b.senha !== '') m.senha = validarSenha(b.senha);

    if (id === eu.id && (m.papel !== undefined || m.ativo !== undefined || m.senha !== undefined)) {
      throw new ValidationError('Para a sua própria conta, só o nome muda aqui (a senha, em "Minha senha")');
    }
    const conta = await atualizarUsuario(id, m);
    esquecerSessao(id);
    if (m.papel !== undefined || m.ativo !== undefined || m.senha !== undefined) encerrarEventosDe(id);
    return conta;
  }),
);

rotasUsuarios.delete(
  '/api/usuarios/:id',
  route(async (req, res) => {
    const id = validarId(req.params.id);
    if (id === (res.locals.sessao as Sessao).id) throw new ValidationError('Você não pode remover a própria conta');
    await removerUsuario(id);
    esquecerSessao(id);
    encerrarEventosDe(id);
    return { ok: true };
  }),
);

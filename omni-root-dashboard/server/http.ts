// Utilitários HTTP comuns a todas as rotas: leitura dos filtros da query
// string e os "envelopes" que transformam erro em resposta (400 para
// parâmetro inválido, 500 sem vazar detalhe para o resto).
import type express from 'express';
import { ConflictError, NotFoundError, parseDate, parseMaquinaId, ValidationError } from './validate.js';
import type { Filters } from './consultas/filtros.js';

export function filtersFrom(req: express.Request): Filters {
  return {
    from: parseDate(req.query.from, 'from'),
    to: parseDate(req.query.to, 'to'),
    maquinaId: parseMaquinaId(req.query.maquinaId),
  };
}

// Envolve cada handler JSON: erro de validação vira 400, regra 409, não
// encontrado 404; o resto vira 500 sem vazar detalhes.
export function route(
  handler: (req: express.Request, res: express.Response) => Promise<unknown>,
): express.RequestHandler {
  return async (req, res) => {
    try {
      res.json(await handler(req, res));
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
      } else if (err instanceof ConflictError) {
        res.status(409).json({ error: err.message });
      } else if (err instanceof NotFoundError) {
        res.status(404).json({ error: err.message });
      } else {
        console.error(err);
        res.status(500).json({ error: 'Erro ao consultar o banco de dados' });
      }
    }
  };
}

// Rotas de exportação: entregam arquivo (não JSON). Validam os filtros ANTES de
// começar a escrever a resposta, então um erro de parâmetro ainda vira 400 limpo.
export function exportRoute(
  stream: (f: Filters, res: express.Response) => Promise<void>,
): express.RequestHandler {
  return async (req, res) => {
    let filters: Filters;
    try {
      filters = filtersFrom(req);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }
    try {
      await stream(filters, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: 'Erro ao gerar a exportação' });
      else res.end();
    }
  };
}

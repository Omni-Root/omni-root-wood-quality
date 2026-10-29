// Ponto de entrada da API de leitura: carrega o .env, sobe o Express e liga o
// tempo real (LISTEN no Postgres -> SSE para os navegadores).
//
//   server/
//     app.ts         monta o Express (middlewares, rotas, cliente em produção)
//     http.ts        filtros da query string e envelopes de erro (400/500)
//     rotas/         sessao · painel · camera · exportacoes
//     consultas/     SQL por assunto: operacao · qualidade · mapa · tendencia · exportacao
//     exportacoes/   CSV · PDF (com mapa de ruas) · StanForD 2010 · tiles · zip
//     auth.ts · db.ts · live.ts · camera.ts · validate.ts   (infraestrutura)
//
// No `npm run dev` quem roda este arquivo é scripts/servidor.mjs: ele reinicia
// o servidor quando o código muda E quando o processo cai.
import 'dotenv/config';
import { criarApp } from './app.js';
import { iniciarConfiguracoes } from './configuracoes.js';
import { iniciarTempoReal } from './live.js';
import { conferirContasNoBoot } from './usuarios.js';

// Rede de segurança: um erro fora de um handler (promessa sem catch, evento
// 'error' sem ouvinte) nunca deve derrubar o servidor da demo. Loga e segue;
// as rotas tratam seus próprios erros e devolvem 500 quando o banco falha.
process.on('unhandledRejection', (reason) => {
  console.error('[server] promessa rejeitada sem tratamento:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] exceção não tratada (processo mantido vivo):', err);
});

const port = Number(process.env.API_PORT ?? 3001);

const servidor = criarApp().listen(port);

// Porta ocupada logo depois de um reinício (o processo anterior ainda
// fechando): tenta de novo por até 20 s. Outro erro ao abrir a porta, ou a
// porta ainda ocupada depois disso: sai — o supervisor sobe outro processo.
let tentativasPorta = 0;
servidor.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE' && tentativasPorta++ < 20) {
    console.warn(`[server] porta ${port} ainda ocupada — tentando de novo em 1 s`);
    setTimeout(() => servidor.listen(port), 1000);
    return;
  }
  console.error(`[server] não foi possível abrir a porta ${port}:`, err.message);
  process.exit(1);
});

let tempoRealLigado = false;
servidor.on('listening', () => {
  console.log(`API de leitura em http://localhost:${port}`);
  if (!tempoRealLigado) {
    tempoRealLigado = true;
    void iniciarTempoReal();
    iniciarConfiguracoes();
    void conferirContasNoBoot();
  }
});

// Vigia: a rede de segurança acima mantém o processo vivo — mas um processo
// vivo SEM a porta aberta é pior que um morto: o painel para e nada o traz de
// volta. Sem porta por mais de 30 s (fora as tentativas acima), sai; o
// supervisor (scripts/servidor.mjs) sobe um novo.
let semPortaDesde: number | null = null;
setInterval(() => {
  if (servidor.listening) {
    semPortaDesde = null;
    return;
  }
  semPortaDesde ??= Date.now();
  if (Date.now() - semPortaDesde > 30_000) {
    console.error(`[server] a porta ${port} fechou e não voltou — encerrando para o supervisor reiniciar`);
    process.exit(1);
  }
}, 5_000).unref();

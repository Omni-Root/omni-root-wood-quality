// Supervisor do servidor da API no `npm run dev` (substitui o `tsx watch`).
//
// O `tsx watch` só reinicia quando um arquivo muda: se o processo CAI, ele
// fica parado esperando uma edição, e o painel morre até alguém rodar o
// `npm run dev` de novo. Aqui:
//   - código de server/ (ou o .env) mudou -> reinicia, como antes;
//   - o processo caiu -> sobe de novo sozinho, em 1 s (2, 4… até 10 s se ele
//     cair seguidas vezes logo depois de subir, sem prender o notebook num
//     laço);
//   - toda queda fica registrada, com data e hora, em logs/servidor-erros.log
//     (o que o servidor escreveu em stderr), para saber o que aconteceu.
// O servidor roda num processo só (`node --import tsx`): encerrá-lo libera a
// porta na hora (com o `tsx watch` são dois processos, e o de dentro podia
// ficar segurando a porta).
//
//   uso: node scripts/servidor.mjs [entrada=server/index.ts] [pasta vigiada=server]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const entrada = process.argv[2] ?? 'server/index.ts';
const pasta = process.argv[3] ?? 'server';
const tsx = import.meta.resolve('tsx');
const arquivoLog = path.resolve('logs', 'servidor-erros.log');

let filho = null;
let reiniciando = false; // true = fomos nós que encerramos (código mudou)
let encerrando = false; // true = Ctrl+C no npm run dev
let iniciadoEm = 0;
let quedasSeguidas = 0;
let ultimasLinhas = [];

function registrar(texto) {
  try {
    fs.mkdirSync(path.dirname(arquivoLog), { recursive: true });
    fs.appendFileSync(arquivoLog, texto);
  } catch {
    /* log é ajuda, nunca motivo para o supervisor parar */
  }
}

function subir() {
  iniciadoEm = Date.now();
  ultimasLinhas = [];
  filho = spawn(process.execPath, ['--import', tsx, entrada], { stdio: ['inherit', 'inherit', 'pipe'] });
  // stderr segue para o terminal e as últimas linhas ficam guardadas para o log da queda.
  filho.stderr.on('data', (pedaco) => {
    process.stderr.write(pedaco);
    ultimasLinhas.push(...String(pedaco).split(/\r?\n/).filter(Boolean));
    if (ultimasLinhas.length > 60) ultimasLinhas = ultimasLinhas.slice(-60);
  });
  filho.on('exit', (codigo, sinal) => {
    filho = null;
    if (encerrando) return;
    if (reiniciando) {
      reiniciando = false;
      subir();
      return;
    }
    if (Date.now() - iniciadoEm > 30_000) quedasSeguidas = 0;
    quedasSeguidas++;
    const espera = Math.min(10_000, 1000 * 2 ** (quedasSeguidas - 1));
    const motivo = sinal ? `sinal ${sinal}` : `código ${codigo}`;
    console.error(`[servidor] o servidor caiu (${motivo}) — subindo de novo em ${espera / 1000} s`);
    registrar(`\n=== ${new Date().toLocaleString('pt-BR')} — caiu (${motivo}); reiniciado em ${espera / 1000} s ===\n${ultimasLinhas.join('\n')}\n`);
    setTimeout(subir, espera);
  });
}

function reiniciar(porque) {
  console.log(`[servidor] ${porque} — reiniciando`);
  if (!filho) return subir();
  reiniciando = true;
  filho.kill();
}

// Vigia o código e o .env (mudanças em rajada — salvar vários arquivos — viram um reinício).
let espera;
const aoMudar = (o) => () => {
  clearTimeout(espera);
  espera = setTimeout(() => reiniciar(o), 300);
};
fs.watch(pasta, { recursive: true }, aoMudar('código mudou'));
if (fs.existsSync('.env')) fs.watch('.env', aoMudar('.env mudou'));

const sair = () => {
  encerrando = true;
  filho?.kill();
  process.exit(0);
};
process.on('SIGINT', sair);
process.on('SIGTERM', sair);
process.on('exit', () => filho?.kill());

subir();

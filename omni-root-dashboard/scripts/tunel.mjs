// Túnel público da plateia (QR code no canto do painel): sobe junto com o
// `npm run dev`. Qual túnel: TUNEL no .env ("zrok", "tailscale" ou "ngrok";
// sem TUNEL e com NGROK_DOMAIN, ngrok). Sem nenhum, não faz nada — o painel
// do notebook funciona igual.
//
//   1. compila o cliente (vite build -> dist/client): é o que o Express serve
//      pelo túnel. Mudou o front? Reinicie o `npm run dev` para a plateia ver.
//   2. abre o túnel apontando para a API (API_PORT, 3001) — não para o Vite:
//      o modo dev do Vite manda centenas de arquivos por visita.
//
//   zrok       `zrok2 share public` com o nome reservado ZROK_NOME: endereço
//              fixo https://<nome>.shares.zrok.io. Precisa do zrok2.exe (em
//              %USERPROFILE%\bin, %LOCALAPPDATA%\zrok, no PATH ou em
//              ZROK_EXE), da conta ativada
//              (`zrok2 enable <token>`) e do nome criado uma vez
//              (`zrok2 create name <nome>`).
//   tailscale  `tailscale funnel <porta>` em primeiro plano: fecha junto com
//              o npm run dev. Endereço fixo: https://<notebook>.<rede>.ts.net.
//              Precisa do Tailscale instalado e logado, e do Funnel liberado
//              na rede (o próprio comando mostra o link para liberar).
//   ngrok      domínio fixo da conta (NGROK_DOMAIN); precisa do ngrok
//              instalado e do authtoken (NGROK_AUTHTOKEN no .env).
import 'dotenv/config';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dominioNgrok = (process.env.NGROK_DOMAIN ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
const nomeZrok = (process.env.ZROK_NOME ?? '').trim();
const dominioZrok = (process.env.ZROK_DOMINIO ?? '').trim() || 'shares.zrok.io';
const tunel = (process.env.TUNEL ?? '').trim().toLowerCase() || (dominioNgrok ? 'ngrok' : '');
const porta = process.env.API_PORT ?? '3001';

// Executáveis: terminal aberto antes da instalação não tem o programa no
// PATH, e o zrok não tem instalador — procura nos caminhos de costume.
function acharExe(candidatos, padrao) {
  return candidatos.find((c) => c && fs.existsSync(c)) ?? padrao;
}
const TAILSCALE = acharExe(['C:\\Program Files\\Tailscale\\tailscale.exe'], 'tailscale');
const ZROK = acharExe(
  [
    process.env.ZROK_EXE?.trim(),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'bin', 'zrok2.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'zrok', 'zrok2.exe'),
  ],
  'zrok2',
);

if (!tunel) {
  console.log('[tunel] desligado: defina TUNEL=zrok (ou tailscale/ngrok) no .env para o QR code da plateia funcionar.');
  process.exit(0);
}
if (!['zrok', 'tailscale', 'ngrok'].includes(tunel)) {
  console.error(`[tunel] TUNEL="${tunel}" não reconhecido: use "zrok", "tailscale" ou "ngrok".`);
  process.exit(1);
}
if (tunel === 'ngrok' && !dominioNgrok) {
  console.error('[tunel] TUNEL=ngrok precisa de NGROK_DOMAIN no .env.');
  process.exit(1);
}
if (tunel === 'zrok' && !nomeZrok) {
  console.error('[tunel] TUNEL=zrok precisa de ZROK_NOME no .env (o nome criado com `zrok2 create name <nome>`).');
  process.exit(1);
}

function rodar(cmd, args, opcoes = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opcoes });
    p.on('error', (err) => resolve({ codigo: null, err }));
    p.on('exit', (codigo) => resolve({ codigo }));
  });
}

console.log('[tunel] compilando o painel para a plateia (vite build)...');
const build = await rodar('npx vite build --logLevel warn', [], { shell: true });
if (build.codigo !== 0) {
  console.error('[tunel] o build falhou: o túnel não sobe (o painel do notebook segue normal).');
  process.exit(1);
}

function enderecoTailscale() {
  try {
    const st = JSON.parse(execFileSync(TAILSCALE, ['status', '--json'], { encoding: 'utf8', timeout: 5000, windowsHide: true }));
    const nome = st?.Self?.DNSName?.replace(/\.$/, '');
    return nome ? `https://${nome}` : '';
  } catch {
    return '';
  }
}

const config = {
  zrok: {
    exe: ZROK,
    args: ['share', 'public', `http://127.0.0.1:${porta}`, '-n', `public:${nomeZrok}`, '--headless'],
    destino: `https://${nomeZrok}.${dominioZrok}`,
    instalar: 'baixe o zrok2.exe em github.com/openziti/zrok/releases e coloque em %LOCALAPPDATA%\\zrok',
  },
  tailscale: {
    exe: TAILSCALE,
    args: ['funnel', porta],
    destino: tunel === 'tailscale' ? enderecoTailscale() || 'https://<notebook>.ts.net' : '',
    instalar: 'winget install tailscale.tailscale',
  },
  ngrok: {
    exe: 'ngrok',
    args: ['http', `--url=${dominioNgrok}`, porta, '--log=stdout', '--log-level=warn'],
    destino: `https://${dominioNgrok}`,
    instalar: 'winget install ngrok.ngrok',
  },
}[tunel];

console.log(`[tunel] abrindo ${config.destino} -> localhost:${porta} (${tunel})`);

// zrok: fechar o npm run dev mata o zrok2 sem ele avisar o servidor do zrok,
// e o compartilhamento morto continua segurando o nome — o próximo `share`
// é recusado ("name ... is in use by share ...") e a plateia vê Bad Gateway.
// Libera o nome antes de abrir (a reserva do nome continua). Atenção: se
// outro notebook estiver servindo o mesmo nome, ele cai.
if (tunel === 'zrok') {
  try {
    execFileSync(ZROK, ['delete', 'share', `public:${nomeZrok}`], { stdio: 'ignore', timeout: 15_000, windowsHide: true });
    console.log(`[tunel] compartilhamento antigo do nome "${nomeZrok}" liberado.`);
  } catch {
    /* nenhum compartilhamento segurando o nome: caminho normal */
  }
}

const filho = spawn(config.exe, config.args, { stdio: 'inherit' });
const encerrar = () => filho.kill();
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
process.on('exit', encerrar);

filho.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(`[tunel] ${tunel} não encontrado. Para instalar: ${config.instalar} (e abra um terminal novo).`);
  } else {
    console.error(`[tunel] não foi possível iniciar o ${tunel}:`, err.message);
  }
  process.exit(1);
});
filho.on('exit', (codigo) => {
  console.error(`[tunel] ${tunel} parou (código ${codigo}). O QR code fica fora do ar até reiniciar o npm run dev.`);
  process.exit(codigo ?? 1);
});

// Confirma que o endereço público chega até aqui: pela própria internet
// (/api/health), o mesmo caminho que o celular da plateia faz.
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  try {
    const res = await fetch(`${config.destino}/api/health`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
    if (res.ok && (await res.json())?.ok === true) {
      console.log(`[tunel] no ar: ${config.destino}  (QR code no canto do painel; tecla Q amplia)`);
      break;
    }
  } catch {
    /* túnel ainda subindo (ou o servidor da API ainda não abriu) */
  }
  if (i === 29) console.error(`[tunel] ${config.destino} ainda não responde depois de 1 minuto — veja a mensagem do ${tunel} acima.`);
}

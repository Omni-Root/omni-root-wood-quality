// Contas do dashboard pela linha de comando — o caminho para criar o
// PRIMEIRO admin (a tela "Usuários" exige um admin logado) e para resolver
// um admin trancado do lado de fora. Usa as mesmas regras da tela
// (server/usuarios.ts) e o mesmo .env (PG_* / PG_CONTAS_*).
//
//   npm run usuario -- criar <login> [--papel admin|leitor|convidado] [--nome "Nome"] [--sem-senha]
//   npm run usuario -- senha <login>
//   npm run usuario -- papel <login> <admin|leitor|convidado>
//   npm run usuario -- ativar <login>
//   npm run usuario -- desativar <login>
//   npm run usuario -- listar
//
// A senha é pedida no terminal, sem aparecer na tela; vinda por pipe
// (echo ... | npm run usuario -- senha x), é lida da entrada padrão.
// Mudanças valem para o servidor em até 5 s (cache da conferência de sessão).
import 'dotenv/config';
import readline from 'node:readline';
import { poolContas } from '../server/db.js';
import {
  atualizarUsuario,
  buscarPorLogin,
  criarUsuario,
  listarUsuarios,
  normalizarLogin,
  validarNome,
  validarPapel,
  validarSenha,
  type Papel,
} from '../server/usuarios.js';
import { ConflictError, NotFoundError, ValidationError } from '../server/validate.js';

const USO = `Uso:
  npm run usuario -- criar <login> [--papel admin|leitor|convidado] [--nome "Nome"] [--sem-senha]
  npm run usuario -- senha <login>
  npm run usuario -- papel <login> <admin|leitor|convidado>
  npm run usuario -- ativar <login>
  npm run usuario -- desativar <login>
  npm run usuario -- listar`;

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Lê uma linha sem eco no terminal (ou da entrada padrão, se não for terminal). */
function lerSenha(pergunta: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    if (process.stdin.isTTY) {
      process.stdout.write(pergunta);
      // Não ecoa o que é digitado (o readline escreve pelo _writeToOutput).
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => undefined;
    }
    rl.once('line', (linha) => {
      rl.close();
      if (process.stdin.isTTY) process.stdout.write('\n');
      resolve(linha);
    });
  });
}

async function pedirSenhaNova(): Promise<string> {
  const senha = validarSenha(await lerSenha('Senha: '));
  if (process.stdin.isTTY && (await lerSenha('Repita a senha: ')) !== senha) {
    throw new ValidationError('As senhas não conferem');
  }
  return senha;
}

async function contaOuErro(login: string) {
  const conta = await buscarPorLogin(normalizarLogin(login));
  if (!conta) throw new NotFoundError(`Não existe conta com o login "${login}"`);
  return conta;
}

async function main(args: string[]): Promise<void> {
  const [comando, alvo] = args;
  switch (comando) {
    case 'criar': {
      if (!alvo) throw new ValidationError(USO);
      const papel: Papel = validarPapel(opcao(args, '--papel') ?? 'leitor');
      const login = normalizarLogin(alvo);
      const nome = validarNome(opcao(args, '--nome'));
      const senha = args.includes('--sem-senha') ? null : await pedirSenhaNova();
      const conta = await criarUsuario({ login, nome, papel, senha });
      console.log(`✅ Conta criada: ${conta.login} (${conta.papel}${senha ? '' : ', sem senha'})`);
      return;
    }
    case 'senha': {
      if (!alvo) throw new ValidationError(USO);
      const conta = await contaOuErro(alvo);
      await atualizarUsuario(conta.id, { senha: await pedirSenhaNova() });
      console.log(`✅ Senha de ${conta.login} trocada — as sessões abertas dessa conta caíram.`);
      return;
    }
    case 'papel': {
      if (!alvo) throw new ValidationError(USO);
      const conta = await contaOuErro(alvo);
      const papel = validarPapel(args[2]);
      await atualizarUsuario(conta.id, { papel });
      console.log(`✅ ${conta.login} agora é ${papel}.`);
      return;
    }
    case 'ativar':
    case 'desativar': {
      if (!alvo) throw new ValidationError(USO);
      const conta = await contaOuErro(alvo);
      await atualizarUsuario(conta.id, { ativo: comando === 'ativar' });
      console.log(`✅ ${conta.login} ${comando === 'ativar' ? 'ativada' : 'desativada'}.`);
      return;
    }
    case 'listar': {
      const contas = await listarUsuarios();
      if (contas.length === 0) {
        console.log('Nenhuma conta. Crie o primeiro admin: npm run usuario -- criar voce@empresa.com --papel admin');
        return;
      }
      console.table(
        contas.map((c) => ({
          login: c.login,
          nome: c.nome ?? '',
          papel: c.papel,
          ativo: c.ativo ? 'sim' : 'não',
          senha: c.temSenha ? 'sim' : 'não',
          'último login': c.ultimoLogin ?? '—',
        })),
      );
      return;
    }
    default:
      throw new ValidationError(USO);
  }
}

main(process.argv.slice(2))
  .then(() => (process.exitCode = 0))
  .catch((err: unknown) => {
    if (err instanceof ValidationError || err instanceof ConflictError || err instanceof NotFoundError) {
      console.error(`❌ ${err.message}`);
    } else {
      console.error('❌ Falha ao falar com o banco:', err instanceof Error ? err.message : err);
    }
    process.exitCode = 1;
  })
  .finally(() => poolContas.end());

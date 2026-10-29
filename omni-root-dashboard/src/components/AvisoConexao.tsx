// Banner de erro de conexão com o banco central. Se já havia dados, eles
// FICAM na tela (celular no campo perde sinal o tempo todo) e o aviso só diz
// de quando são; sem dados, explica o que conferir.
export default function AvisoConexao({
  error,
  temDados,
  atualizadoEm,
  tentativas,
}: {
  error: string | null;
  temDados: boolean;
  atualizadoEm: Date | null;
  tentativas: number;
}) {
  if (!error) return null;
  if (temDados) {
    return (
      <div className="error-banner" role="status">
        <strong>Sem conexão com o banco central.</strong> Mostrando os últimos dados recebidos
        {atualizadoEm && ` (${atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`}.
        <span className="error-retry">
          {' '}
          Tentando de novo a cada 5 s{tentativas > 0 ? ` (${tentativas}× sem resposta)` : ''}.
        </span>
      </div>
    );
  }
  return (
    <div className="error-banner" role="status">
      <strong>Não foi possível carregar os dados.</strong> {error} — verifique a
      conexão com o PostgreSQL central (variáveis PG_* no .env).
      <span className="error-retry">
        {' '}
        Tentando de novo a cada 5 s{tentativas > 0 ? ` (${tentativas}× sem resposta)` : ''}… os
        painéis voltam sozinhos quando o banco responder.
      </span>
    </div>
  );
}

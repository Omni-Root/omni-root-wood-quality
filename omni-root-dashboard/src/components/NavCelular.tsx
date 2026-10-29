// Navegação do celular (só aparece em tela estreita, ver .nav-celular em
// estilos/celular.css): o supervisor no campo vai direto ao que interessa
// com o polegar.
export default function NavCelular() {
  return (
    <nav className="nav-celular" aria-label="Seções">
      <a href="#agora">Agora</a>
      <a href="#mapa">Onde agir</a>
      <a href="#qualidade">Qualidade</a>
      <a href="#resumo">Resumo</a>
    </nav>
  );
}

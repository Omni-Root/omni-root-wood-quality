import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { aplicarAcessibilidadeSalva } from './acessibilidade';
import { aplicarTemaSalvo } from './components/ThemeToggle';
import { aplicarEscalaSalva } from './tamanhoTexto';
// Fontes empacotadas no projeto (funcionam sem internet): Plus Jakarta Sans
// (o painel) e OpenDyslexic (modo dislexia — o navegador só baixa o arquivo
// quando o modo é ligado).
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/opendyslexic/400.css';
import '@fontsource/opendyslexic/700.css';
import './estilos/index.css';

// Aplica o tema, o tamanho do texto e os modos de acessibilidade escolhidos
// ANTES de renderizar, para a página não piscar (vale inclusive para a tela
// de login).
aplicarTemaSalvo();
aplicarEscalaSalva();
aplicarAcessibilidadeSalva();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Ícones de traço (24×24, cor = currentColor), desenhados aqui para não
// depender de biblioteca nem de internet. Decorativos: quem os usa já tem
// texto ao lado (aria-hidden).

const TRACOS: Record<string, string[]> = {
  camera: [
    'M5 7h1a2 2 0 0 0 2-2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2',
    'M9 13a3 3 0 1 0 6 0a3 3 0 0 0-6 0',
  ],
  resumo: ['M10 3.2a9 9 0 1 0 10.8 10.8a1 1 0 0 0-1-1h-6.8a2 2 0 0 1-2-2V4a.9.9 0 0 0-1-.8', 'M15 3.5a9 9 0 0 1 5.5 5.5h-4.5a1 1 0 0 1-1-1V3.5'],
  mapa: ['M9 11a3 3 0 1 0 6 0a3 3 0 0 0-6 0', 'M17.657 16.657l-4.243 4.243a2 2 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0z'],
  tabela: ['M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M3 10h18', 'M10 4v16'],
  barras: ['M3 20h18', 'M6 16v-5', 'M11 16V6', 'M16 16V9', 'M21 16v-3'],
  linha: ['M3 17l6-6l4 4l8-8', 'M14 7h7v7'],
  rosca: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0'],
  calor: [
    'M4 4h4v4H4z',
    'M10 4h4v4h-4z',
    'M16 4h4v4h-4z',
    'M4 10h4v4H4z',
    'M10 10h4v4h-4z',
    'M16 10h4v4h-4z',
    'M4 16h4v4H4z',
    'M10 16h4v4h-4z',
    'M16 16h4v4h-4z',
  ],
  tora: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M6.5 12a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0', 'M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0'],
  aprovado: ['M5 12l5 5l10-10'],
  contencao: [
    'M10.24 3.957l-8.422 14.06a1.989 1.989 0 0 0 1.7 2.983h16.845a1.989 1.989 0 0 0 1.7-2.983l-8.423-14.06a1.989 1.989 0 0 0-3.4 0z',
    'M12 9v4',
    'M12 17h.01',
  ],
  rejeitado: ['M18 6L6 18', 'M6 6l12 12'],
  teclado: ['M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z', 'M6 10h.01', 'M10 10h.01', 'M14 10h.01', 'M18 10h.01', 'M6 14h.01', 'M18 14h.01', 'M10 14h4'],
  sino: ['M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6', 'M9 17v1a3 3 0 0 0 6 0v-1'],
  folha: ['M5 21c.5-4.5 2.5-8 7-10', 'M9 18c6.218 0 10.5-3.288 11-12v-2h-4.014c-9 0-11.986 4-12 9c0 1 0 3 2 5h3z'],
  expandir: ['M4 8V6a2 2 0 0 1 2-2h2', 'M4 16v2a2 2 0 0 0 2 2h2', 'M16 4h2a2 2 0 0 1 2 2v2', 'M16 20h2a2 2 0 0 0 2-2v-2'],
  reduzir: ['M15 19v-2a2 2 0 0 1 2-2h2', 'M15 5v2a2 2 0 0 0 2 2h2', 'M5 15h2a2 2 0 0 1 2 2v2', 'M5 9h2a2 2 0 0 0 2-2V5'],
};

export type NomeIcone = keyof typeof TRACOS;

export default function Icone({ nome, tamanho = 20 }: { nome: NomeIcone; tamanho?: number }) {
  return (
    <svg
      className="icone"
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TRACOS[nome].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

// QR code para a plateia abrir o painel no celular (ver server/plateia.ts).
// Públicas: o QR só leva ao endereço público (a tela de login) e aparece
// também na própria tela de login, antes de alguém entrar.
//
//   GET /api/plateia          link público, se o túnel está no ar, qual túnel e se
//                             a conta de visitante está ativa (orientações da tela do QR)
//   GET /api/plateia/qr.svg   o QR code desse link
import express from 'express';
import QRCode from 'qrcode';
import { linkQr, TUNEL, tunelNoAr, urlPublica } from '../plateia.js';
import { contaVisitante } from '../usuarios.js';

export const rotasPlateia = express.Router();

rotasPlateia.get('/api/plateia', async (_req, res) => {
  const url = await urlPublica();
  res.json({
    configurado: Boolean(url),
    url,
    noAr: await tunelNoAr(),
    tunel: TUNEL || null,
    visitante: (await contaVisitante().catch(() => null)) !== null,
  });
});

rotasPlateia.get('/api/plateia/qr.svg', async (_req, res) => {
  const link = await linkQr();
  if (!link) return res.status(404).json({ error: 'Link público não configurado (TUNEL no .env)' });
  // Margem de 2 módulos e correção "M": lê bem projetado no telão e de longe.
  const svg = await QRCode.toString(link, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(svg);
});

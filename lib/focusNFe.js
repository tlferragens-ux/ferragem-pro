// lib/focusNFe.js
// Cliente HTTP para a API da Focus NFe

const AMBIENTE = process.env.FOCUS_NFE_AMBIENTE || 'homologacao';
const TOKEN = AMBIENTE === 'producao'
  ? process.env.FOCUS_NFE_TOKEN_PROD
  : process.env.FOCUS_NFE_TOKEN_HOMOLOG;

const BASE_URL = AMBIENTE === 'producao'
  ? 'https://api.focusnfe.com.br'
  : 'https://homologacao.focusnfe.com.br';

if (!TOKEN) {
  throw new Error(`FOCUS_NFE_TOKEN_${AMBIENTE.toUpperCase()} não configurado`);
}

// Auth: Basic com token + ":" (senha vazia)
const AUTH_HEADER = 'Basic ' + Buffer.from(TOKEN + ':').toString('base64');

export const focusNFe = {
  ambiente: AMBIENTE,

  async emitir(ref, payload) {
    const url = `${BASE_URL}/v2/nfe?ref=${encodeURIComponent(ref)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': AUTH_HEADER,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    return { status: res.status, data };
  },

  async consultar(ref) {
    const url = `${BASE_URL}/v2/nfe/${encodeURIComponent(ref)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': AUTH_HEADER }
    });
    const data = await res.json();
    return { status: res.status, data };
  },

  async cancelar(ref, justificativa) {
    const url = `${BASE_URL}/v2/nfe/${encodeURIComponent(ref)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': AUTH_HEADER,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ justificativa })
    });
    const data = await res.json();
    return { status: res.status, data };
  },

  async cartaCorrecao(ref, correcao) {
    const url = `${BASE_URL}/v2/nfe/${encodeURIComponent(ref)}/carta_correcao`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': AUTH_HEADER,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ correcao })
    });
    const data = await res.json();
    return { status: res.status, data };
  }
};

// api/nfe/carta-correcao.js
// Emite uma Carta de Correção Eletrônica (CCe) para uma NFe autorizada

import { supabaseAdmin } from '../../lib/supabaseAdmin.js';
import { focusNFe } from '../../lib/focusNFe.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { ref, correcao } = req.body || {};

    if (!ref) {
      return res.status(400).json({ error: 'ref é obrigatório' });
    }

    const correcaoTrim = String(correcao || '').trim();

    if (correcaoTrim.length < 15) {
      return res.status(400).json({
        error: 'Correção obrigatória (mínimo 15 caracteres)'
      });
    }

    if (correcaoTrim.length > 1000) {
      return res.status(400).json({
        error: 'Correção não pode passar de 1000 caracteres'
      });
    }

    // 1. Enviar CCe para Focus NFe
    const { status, data: respostaFocus } = await focusNFe.cartaCorrecao(ref, correcaoTrim);

    // 2. Buscar nota atual pra adicionar a CCe ao histórico
    const { data: notaAtual } = await supabaseAdmin
      .from('notas_fiscais')
      .select('cartas_correcao')
      .eq('ref_focus', ref)
      .single();

    const ccesExistentes = Array.isArray(notaAtual?.cartas_correcao)
      ? notaAtual.cartas_correcao
      : [];

    const novaCCe = {
      correcao: correcaoTrim,
      data: new Date().toISOString(),
      status: respostaFocus.status || 'enviada',
      sequencia: ccesExistentes.length + 1,
      protocolo: respostaFocus.protocolo || null,
      mensagem_sefaz: respostaFocus.mensagem_sefaz || null,
      caminho_xml: respostaFocus.caminho_xml_carta_correcao || null,
      caminho_pdf: respostaFocus.caminho_pdf_carta_correcao || null
    };

    const ccesAtualizadas = [...ccesExistentes, novaCCe];

    // 3. Atualizar registro local
    await supabaseAdmin
      .from('notas_fiscais')
      .update({
        cartas_correcao: ccesAtualizadas,
        payload_resposta: respostaFocus,
        atualizado_em: new Date().toISOString()
      })
      .eq('ref_focus', ref);

    return res.status(status).json({
      success: status >= 200 && status < 300,
      ref: ref,
      ambiente: focusNFe.ambiente,
      cce: novaCCe,
      focus: respostaFocus
    });

  } catch (err) {
    console.error('Erro ao emitir CCe:', err);
    return res.status(500).json({ error: 'Erro interno', detalhe: String(err.message || err) });
  }
}

// api/nfe/cancelar.js
// Cancela uma NFe autorizada

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
    const { ref, justificativa } = req.body || {};

    if (!ref) {
      return res.status(400).json({ error: 'ref é obrigatório' });
    }

    if (!justificativa || String(justificativa).trim().length < 15) {
      return res.status(400).json({
        error: 'Justificativa obrigatória (mínimo 15 caracteres)'
      });
    }

    if (String(justificativa).trim().length > 255) {
      return res.status(400).json({
        error: 'Justificativa não pode passar de 255 caracteres'
      });
    }

    // 1. Cancelar na Focus NFe
    const { status, data: respostaFocus } = await focusNFe.cancelar(ref, justificativa.trim());

    // 2. Atualizar registro local
    const updateFields = {
      payload_resposta: respostaFocus,
      atualizado_em: new Date().toISOString()
    };

    if (respostaFocus.status) updateFields.status = respostaFocus.status;
    if (respostaFocus.mensagem_sefaz) updateFields.mensagem_sefaz = respostaFocus.mensagem_sefaz;

    // Se cancelamento foi aceito, marca data e justificativa
    const cancelamentoOk = ['cancelado'].includes(respostaFocus.status);
    if (cancelamentoOk) {
      updateFields.cancelada_em = new Date().toISOString();
      updateFields.justificativa_cancelamento = justificativa.trim();
    }

    await supabaseAdmin
      .from('notas_fiscais')
      .update(updateFields)
      .eq('ref_focus', ref);

    return res.status(status).json({
      success: cancelamentoOk,
      ref: ref,
      ambiente: focusNFe.ambiente,
      focus: respostaFocus
    });

  } catch (err) {
    console.error('Erro ao cancelar NFe:', err);
    return res.status(500).json({ error: 'Erro interno', detalhe: String(err.message || err) });
  }
}

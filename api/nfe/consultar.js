// api/nfe/consultar.js
// Consulta o status de uma NFe pelo ref_focus

import { supabaseAdmin } from '../../lib/supabaseAdmin.js';
import { focusNFe } from '../../lib/focusNFe.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const ref = req.method === 'GET'
      ? req.query.ref
      : (req.body && req.body.ref);

    if (!ref) {
      return res.status(400).json({ error: 'ref é obrigatório' });
    }

    // 1. Consultar na Focus NFe
    const { status, data: respostaFocus } = await focusNFe.consultar(ref);

    // 2. Atualizar registro local com novo status (se a nota existir no banco)
    const updateFields = {
      payload_resposta: respostaFocus,
      atualizado_em: new Date().toISOString()
    };

    if (respostaFocus.status) updateFields.status = respostaFocus.status;
    if (respostaFocus.chave_nfe) updateFields.chave_acesso = respostaFocus.chave_nfe;
    if (respostaFocus.protocolo) updateFields.protocolo = respostaFocus.protocolo;
    if (respostaFocus.numero) updateFields.numero = Number(respostaFocus.numero);
    if (respostaFocus.caminho_xml_nota_fiscal) {
      updateFields.xml_url = respostaFocus.caminho_xml_nota_fiscal.startsWith('http')
        ? respostaFocus.caminho_xml_nota_fiscal
        : `https://${focusNFe.ambiente === 'producao' ? 'api' : 'homologacao'}.focusnfe.com.br${respostaFocus.caminho_xml_nota_fiscal}`;
    }
    if (respostaFocus.caminho_danfe) {
      updateFields.danfe_url = respostaFocus.caminho_danfe.startsWith('http')
        ? respostaFocus.caminho_danfe
        : `https://${focusNFe.ambiente === 'producao' ? 'api' : 'homologacao'}.focusnfe.com.br${respostaFocus.caminho_danfe}`;
    }
    if (respostaFocus.mensagem_sefaz) updateFields.mensagem_sefaz = respostaFocus.mensagem_sefaz;
    if (respostaFocus.motivo_status) updateFields.motivo_status = respostaFocus.motivo_status;

    await supabaseAdmin
      .from('notas_fiscais')
      .update(updateFields)
      .eq('ref_focus', ref);

    return res.status(status).json({
      success: status >= 200 && status < 300,
      ref: ref,
      ambiente: focusNFe.ambiente,
      focus: respostaFocus
    });

  } catch (err) {
    console.error('Erro ao consultar NFe:', err);
    return res.status(500).json({ error: 'Erro interno', detalhe: String(err.message || err) });
  }
}

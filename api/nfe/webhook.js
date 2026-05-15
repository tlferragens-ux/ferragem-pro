// api/nfe/webhook.js
// Recebe notificações da Focus NFe quando uma NFe muda de status (autorização, rejeição, cancelamento)
// Reutiliza a lógica do consultar.js
import { supabaseAdmin } from '../../lib/supabaseAdmin.js';
import { focusNFe } from '../../lib/focusNFe.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Focus NFe sempre envia POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    // A Focus NFe envia um body com a ref no campo "ref" ou "referencia"
    const body = req.body || {};
    const ref = body.ref || body.referencia;

    if (!ref) {
      console.error('Webhook sem ref:', JSON.stringify(body));
      return res.status(400).json({ error: 'ref é obrigatório no body' });
    }

    console.log(`[WEBHOOK] Notificação recebida para ref: ${ref}`);

    // Consulta a Focus NFe pra pegar o estado atual completo
    const { data: respostaFocus } = await focusNFe.consultar(ref);

    // Monta os campos a atualizar no banco
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

    // Atualiza no banco
    const { error } = await supabaseAdmin
      .from('notas_fiscais')
      .update(updateFields)
      .eq('ref_focus', ref);

    if (error) {
      console.error('Erro ao atualizar banco:', error);
      return res.status(500).json({ error: 'Erro ao atualizar banco', detalhe: error.message });
    }

    console.log(`[WEBHOOK] NFe ${ref} atualizada para status: ${respostaFocus.status}`);

    // Focus NFe espera resposta 200 OK pra não reenviar
    return res.status(200).json({ success: true, ref, status: respostaFocus.status });

  } catch (err) {
    console.error('[WEBHOOK] Erro:', err);
    return res.status(500).json({ error: 'Erro interno', detalhe: String(err.message || err) });
  }
}

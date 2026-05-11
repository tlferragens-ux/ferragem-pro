// api/nfe/emitir.js
// Emite uma NFe a partir de um orçamento
// v3 — corrige valor_total salvo no banco (usa orcamento.valor_total com desconto)

import { supabaseAdmin } from '../../lib/supabaseAdmin.js';
import { focusNFe } from '../../lib/focusNFe.js';
import { montarPayloadNFe, gerarRefFocus } from '../../lib/nfeBuilder.js';

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
    const { orcamento_id, natureza_operacao } = req.body || {};

    if (!orcamento_id) {
      return res.status(400).json({ error: 'orcamento_id é obrigatório' });
    }

    // 1. Buscar configuração fiscal
    const { data: config, error: errConfig } = await supabaseAdmin
      .from('configuracao_fiscal')
      .select('*')
      .limit(1)
      .single();

    if (errConfig || !config) {
      return res.status(500).json({ error: 'Configuração fiscal não encontrada', detalhe: errConfig });
    }

    // 2. Buscar orçamento
    const { data: orcamento, error: errOrc } = await supabaseAdmin
      .from('orcamentos')
      .select('*')
      .eq('id', orcamento_id)
      .single();

    if (errOrc || !orcamento) {
      return res.status(404).json({ error: 'Orçamento não encontrado', detalhe: errOrc });
    }

    if (!orcamento.cliente_id) {
      return res.status(400).json({ error: 'Orçamento sem cliente associado' });
    }

    // 3. Buscar cliente
    const { data: cliente, error: errCli } = await supabaseAdmin
      .from('clientes')
      .select('*')
      .eq('id', orcamento.cliente_id)
      .single();

    if (errCli || !cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado', detalhe: errCli });
    }

    if (!cliente.documento) {
      return res.status(400).json({ error: 'Cliente sem CPF/CNPJ cadastrado' });
    }

    // 4. Buscar itens do orçamento
    const { data: itens, error: errItens } = await supabaseAdmin
      .from('orcamento_itens')
      .select('*')
      .eq('orcamento_id', orcamento_id)
      .order('id', { ascending: true });

    if (errItens || !itens || itens.length === 0) {
      return res.status(400).json({ error: 'Orçamento sem itens', detalhe: errItens });
    }

    // 4b. Enriquecer itens com dados fiscais dos produtos cadastrados (quando produto_id existir)
    const idsProdutos = itens
      .map(i => i.produto_id)
      .filter(id => id != null);

    let produtosMap = {};
    if (idsProdutos.length > 0) {
      const { data: produtos } = await supabaseAdmin
        .from('produtos')
        .select('*')
        .in('id', idsProdutos);
      if (produtos) {
        produtosMap = produtos.reduce((acc, p) => { acc[p.id] = p; return acc; }, {});
      }
    }

    const itensEnriquecidos = itens.map(item => ({
      ...item,
      produto_data: item.produto_id ? produtosMap[item.produto_id] || null : null
    }));

    // 5. Determinar próximo número
    const ambiente = focusNFe.ambiente;
    const campoNumero = ambiente === 'producao' ? 'ultimo_numero_producao' : 'ultimo_numero_homologacao';
    const proximoNumero = (Number(config[campoNumero]) || 0) + 1;

    // 6. Gerar ref para Focus
    const ref = gerarRefFocus(orcamento_id, ambiente);

    // 7. Montar payload
    const payload = montarPayloadNFe({
      config,
      cliente,
      orcamento,
      itens: itensEnriquecidos,
      numero: proximoNumero,
      naturezaOperacao: natureza_operacao || 'Venda de mercadoria'
    });

    // 8. Inserir registro inicial em notas_fiscais (status: processando)
    // ⚠️ Usa orcamento.valor_total (com desconto aplicado) — NÃO somar itens (que dá subtotal sem desconto)
    const subtotalItens = itens.reduce((acc, i) => acc + Number(i.preco_total || 0), 0);
    const valorTotalReal = Number(orcamento.valor_total || subtotalItens);

    const { data: notaInicial, error: errNota } = await supabaseAdmin
      .from('notas_fiscais')
      .insert({
        orcamento_id: orcamento_id,
        ref_focus: ref,
        numero: proximoNumero,
        serie: 1,
        status: 'processando',
        ambiente: ambiente,
        cliente_id: cliente.id,
        cliente_nome: cliente.nome,
        cliente_documento: cliente.documento,
        valor_total: valorTotalReal,
        payload_envio: payload
      })
      .select()
      .single();

    if (errNota) {
      return res.status(500).json({ error: 'Erro ao registrar nota no banco', detalhe: errNota });
    }

    // 9. Enviar para Focus NFe
    const { status, data: respostaFocus } = await focusNFe.emitir(ref, payload);

    // 10. Atualizar registro com a resposta
    const updateFields = {
      payload_resposta: respostaFocus,
      atualizado_em: new Date().toISOString()
    };

    // Status da Focus: "processando_autorizacao" / "autorizado" / "cancelado" / "erro_autorizacao"
    if (respostaFocus.status) updateFields.status = respostaFocus.status;
    if (respostaFocus.chave_nfe) updateFields.chave_acesso = respostaFocus.chave_nfe;
    if (respostaFocus.protocolo) updateFields.protocolo = respostaFocus.protocolo;
    if (respostaFocus.numero) updateFields.numero = Number(respostaFocus.numero);
    if (respostaFocus.serie) updateFields.serie = Number(respostaFocus.serie);
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
      .eq('id', notaInicial.id);

    // 11. Se foi autorizada (ou está processando), incrementa o número no config
    const statusOk = ['autorizado', 'processando_autorizacao'].includes(respostaFocus.status);
    if (statusOk) {
      await supabaseAdmin
        .from('configuracao_fiscal')
        .update({
          [campoNumero]: proximoNumero,
          atualizado_em: new Date().toISOString()
        })
        .eq('id', config.id);
    }

    return res.status(status).json({
      success: status >= 200 && status < 300,
      nota_id: notaInicial.id,
      ref: ref,
      ambiente: ambiente,
      focus: respostaFocus
    });

  } catch (err) {
    console.error('Erro ao emitir NFe:', err);
    return res.status(500).json({ error: 'Erro interno', detalhe: String(err.message || err) });
  }
}

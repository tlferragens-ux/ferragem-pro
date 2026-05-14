// lib/nfeBuilder.js
// Monta o payload da NFe no formato Focus NFe a partir dos dados do banco
// v5 — respeita o valor total do orçamento (com desconto aplicado)
// v6 — deriva valor_unitario do valor_bruto pra garantir consistência matemática (SEFAZ 629)
// v7 — consumidor_final depende de ser PJ ou PF (SEFAZ 232)
// v8 — consumidor_final depende do indicador_ie (SEFAZ 696)
//      indicador 1 (contribuinte)  → consumidor_final 0 (revenda)
//      indicador 9 (nao contribuinte) → consumidor_final 1 (uso final)

/**
 * Monta o JSON de envio para a Focus NFe.
 * @param {object} args
 * @param {object} args.config - Registro de configuracao_fiscal
 * @param {object} args.cliente - Registro de clientes
 * @param {object} args.orcamento - Registro de orcamentos
 * @param {Array}  args.itens - Array de orcamento_itens (com produto_data opcional via JOIN)
 * @param {number} args.numero - Número sequencial da NFe
 * @param {string} args.naturezaOperacao - Ex: "Venda de mercadoria"
 * @returns {object} payload pronto pra Focus NFe
 */
export function montarPayloadNFe({ config, cliente, orcamento, itens, numero, naturezaOperacao }) {
  // Determina se operação é interna (MT) ou interestadual
  const ufEmitente = config.uf || 'MT';
  const ufDestinatario = cliente.uf || ufEmitente;
  const ehInterestadual = ufEmitente !== ufDestinatario;

  // Indicador de presença: 9 = Operação não presencial (default seguro)
  const indicadorPresenca = 9;

  // Finalidade: 1 = NFe normal
  const finalidade = 1;

  // Modalidade do frete: 9 = Sem ocorrência de transporte
  const modalidadeFrete = 9;

  // Data atual ISO
  const dataEmissao = new Date().toISOS
  // ---- ITENS ----
  // Cada item pode ter `produto_data` (registro da tabela produtos) anexado, ou não.
  // Se tiver, usa os campos fiscais do produto. Se não tiver, usa os padrões da config.
  // Desconto é rateado proporcionalmente entre os itens.
  const itensPayload = itens.map((item, idx) => {
    const prod = item.produto_data || {};

    const ncm = String(prod.ncm || NCM_PADRAO).replace(/\D/g, '').padStart(8, '0').slice(0, 8);
    const cfop = ehInterestadual
      ? String(prod.cfop_interestadual || CFOP_INTERESTADUAL)
      : String(prod.cfop_interno || CFOP_INTERNO);
    const csosn = String(prod.csosn || CSOSN_PADRAO);
    const origem = String(prod.origem ?? ORIGEM_PADRAO);

    const quantidade = Number(item.quantidade || 0);
    const precoTotalBanco = Number(item.preco_total || 0);
    const precoUnitarioBanco = Number(item.preco_unitario || 0);
    // v6: deriva valor_unitario do valor_bruto pra garantir qtd × unit = bruto
    const valorBruto = precoTotalBanco > 0 ? precoTotalBanco : (quantidade * precoUnitarioBanco);
    const valorUnitario = quantidade > 0 ? (valorBruto / quantidade) : precoUnitarioBanco;

    // Desconto rateado proporcionalmente ao valor do item
    let descontoItem = 0;
    if (temDesconto && subtotalItens > 0) {
      descontoItem = Number(((valorBruto / subtotalItens) * descontoTotal).toFixed(2));
    }

    const itemPayload = {
      numero_item: idx + 1,
      codigo_produto: String(item.produto_id || `ITEM${idx + 1}`),
      descricao: (item.produto_nome || 'Produto').slice(0, 120),
      cfop: cfop,
      unidade_comercial: (item.produto_unidade || 'qt').slice(0, 6),
      quantidade_comercial: quantidade.toFixed(4),
      valor_unitario_comercial: valorUnitario.toFixed(10),
      valor_bruto: valorBruto.toFixed(2),
      unidade_tributavel: (prod.unidade_tributavel || item.produto_unidade || 'qt').slice(0, 6),
      quantidade_tributavel: quantidade.toFixed(4),
      valor_unitario_tributavel: valorUnitario.toFixed(10),
      codigo_ncm: ncm,
      icms_origem: origem,
      icms_situacao_tributaria: csosn,
      pis_situacao_tributaria: '49',
      cofins_situacao_tributaria: '49',
      inclui_no_total: 1
    };

    if (descontoItem > 0) {
      itemPayload.valor_desconto = descontoItem.toFixed(2);
    }

    if (prod.cest) itemPayload.cest = String(prod.cest).replace(/\D/g, '');

    return itemPayload;
  });

  // ---- PAGAMENTO ----
  const formaPagamento = valorTotalOrcamento > 0 ? '99' : '90';

  // ---- PAYLOAD FINAL ----
  const payload = {
    natureza_operacao: naturezaOperacao || 'Venda de mercadoria',
    data_emissao: dataEmissao,
    tipo_documento: 1,
    finalidade_emissao: finalidade,
    presenca_comprador: indicadorPresenca,
    consumidor_final: consumidorFinal,
    modalidade_frete: modalidadeFrete,
    local_destino: ehInterestadual ? 2 : 1,
    numero: numero,
    serie: 1,
    cnpj_emitente: String(config.cnpj || '').replace(/\D/g, ''),
    nome_emitente: config.razao_social,
    nome_fantasia_emitente: config.nome_fantasia || config.razao_social,
    logradouro_emitente: config.logradouro,
    numero_emitente: config.numero || 'S/N',
    bairro_emitente: config.bairro,
    municipio_emitente: config.cidade,
    uf_emitente: ufEmitente,
    cep_emitente: String(config.cep || '').replace(/\D/g, ''),
    inscricao_estadual_emitente: config.inscricao_estadual,
    regime_tributario_emitente: config.crt || 1,
    ...Object.keys(destinatario).reduce((acc, k) => {
      acc[k + '_destinatario'] = destinatario[k];
      return acc;
    }, {}),
    items: itensPayload,
    formas_pagamento: [
      {
        forma_pagamento: formaPagamento,
        valor_pagamento: valorTotalOrcamento.toFixed(2)
      }
    ]
  };

  if (config.complemento) payload.complemento_emitente = config.complemento;
  if (config.codigo_ibge_municipio) payload.codigo_municipio_emitente = String(config.codigo_ibge_municipio);
  if (config.cnae_principal && Number(config.crt) !== 1) {
    payload.cnae_fiscal_emitente = String(config.cnae_principal).replace(/\D/g, '');
  }
  if (config.telefone) payload.telefone_emitente = String(config.telefone).replace(/\D/g, '');

  if (orcamento && orcamento.observacoes) {
    payload.informacoes_adicionais_contribuinte = String(orcamento.observacoes).slice(0, 5000);
  }

  return payload;
}

/**
 * Gera uma referência única pra Focus NFe (idempotência).
 */
export function gerarRefFocus(orcamentoId, ambiente) {
  const prefix = ambiente === 'producao' ? 'PROD' : 'HOMOL';
  return `${prefix}-ORC${orcamentoId}-${Date.now()}`;
}

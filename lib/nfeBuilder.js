// lib/nfeBuilder.js
// Monta o payload da NFe no formato Focus NFe a partir dos dados do banco

/**
 * Monta o JSON de envio para a Focus NFe.
 * @param {object} args
 * @param {object} args.config - Registro de configuracao_fiscal
 * @param {object} args.cliente - Registro de clientes
 * @param {object} args.orcamento - Registro de orcamentos
 * @param {Array} args.itens - Array de orcamento_itens
 * @param {number} args.numero - Número sequencial da NFe
 * @param {string} args.naturezaOperacao - Ex: "Venda de mercadoria"
 * @returns {object} payload pronto pra Focus NFe
 */
export function montarPayloadNFe({ config, cliente, orcamento, itens, numero, naturezaOperacao }) {
  // Determina se operação é interna (MT) ou interestadual
  const ufEmitente = config.uf || 'MT';
  const ufDestinatario = cliente.uf || ufEmitente;
  const ehInterestadual = ufEmitente !== ufDestinatario;

  // Indicador de presença: 9 = Operação não presencial, outros (default seguro)
  const indicadorPresenca = 9;

  // Finalidade: 1 = NFe normal
  const finalidade = 1;

  // Consumidor final: 1 = Sim, 0 = Não
  const consumidorFinal = cliente.consumidor_final ? 1 : 0;

  // Modalidade do frete: 9 = Sem ocorrência de transporte
  const modalidadeFrete = 9;

  // Data atual em formato YYYY-MM-DD
  const dataEmissao = new Date().toISOString();

  // ---- DESTINATÁRIO ----
  const documento = String(cliente.documento || '').replace(/\D/g, '');
  const ehPJ = documento.length === 14;

  const destinatario = {
    nome: cliente.nome,
    [ehPJ ? 'cnpj' : 'cpf']: documento,
    indicador_inscricao_estadual: cliente.indicador_ie || 9,
    logradouro: cliente.logradouro || '',
    numero: cliente.numero || 'S/N',
    bairro: cliente.bairro || '',
    municipio: cliente.cidade || '',
    uf: ufDestinatario,
    cep: String(cliente.cep || '').replace(/\D/g, '')
  };

  if (cliente.complemento) destinatario.complemento = cliente.complemento;
  if (cliente.codigo_ibge_municipio) destinatario.codigo_municipio = String(cliente.codigo_ibge_municipio);
  if (cliente.email) destinatario.email = cliente.email;
  if (cliente.telefone) destinatario.telefone = String(cliente.telefone).replace(/\D/g, '');
  if (cliente.inscricao_estadual && Number(cliente.indicador_ie) === 1) {
    destinatario.inscricao_estadual = cliente.inscricao_estadual;
  }

  // ---- ITENS ----
  const itensPayload = itens.map((item, idx) => {
    const cfop = ehInterestadual
      ? (item.cfop_interestadual || config.cfop_interestadual_padrao || '6101')
      : (item.cfop_interno || config.cfop_interno_padrao || '5101');

    const ncm = item.ncm || config.ncm_padrao || '73084000';
    const csosn = item.csosn || config.csosn_padrao || '102';
    const origem = item.origem !== undefined && item.origem !== null
      ? String(item.origem)
      : (config.origem_padrao || '0');

    const quantidade = Number(item.quantidade || 0);
    const valorUnitario = Number(item.preco_unitario || 0);
    const valorTotal = Number(item.preco_total || (quantidade * valorUnitario));

    const itemPayload = {
      numero_item: idx + 1,
      codigo_produto: String(item.produto_id || idx + 1),
      descricao: item.produto_nome || 'Produto',
      cfop: cfop,
      unidade_comercial: item.produto_unidade || 'qt',
      quantidade_comercial: quantidade.toFixed(4),
      valor_unitario_comercial: valorUnitario.toFixed(10),
      valor_bruto: valorTotal.toFixed(2),
      unidade_tributavel: item.unidade_tributavel || item.produto_unidade || 'qt',
      quantidade_tributavel: quantidade.toFixed(4),
      valor_unitario_tributavel: valorUnitario.toFixed(10),
      ncm: String(ncm).replace(/\D/g, ''),
      // ICMS Simples Nacional
      icms_origem: origem,
      icms_situacao_tributaria: csosn,
      // PIS/COFINS — fora do Simples (CST 49 = outras operações)
      pis_situacao_tributaria: '49',
      cofins_situacao_tributaria: '49',
      // Inclui no total da NFe
      inclui_no_total: 1
    };

    if (item.cest) itemPayload.cest = String(item.cest).replace(/\D/g, '');

    return itemPayload;
  });

  // ---- TOTAIS ----
  const valorTotalProdutos = itens.reduce((acc, i) => acc + Number(i.preco_total || 0), 0);

  // ---- PAGAMENTO ----
  // 90 = Sem pagamento (se valor 0); senão 99 = Outros
  const formaPagamento = valorTotalProdutos > 0 ? '99' : '90';

  // ---- PAYLOAD FINAL ----
  const payload = {
    natureza_operacao: naturezaOperacao || 'Venda de mercadoria',
    data_emissao: dataEmissao,
    tipo_documento: 1, // 1 = Saída
    finalidade_emissao: finalidade,
    presenca_comprador: indicadorPresenca,
    consumidor_final: consumidorFinal,
    modalidade_frete: modalidadeFrete,
    local_destino: ehInterestadual ? 2 : 1, // 1=interna, 2=interestadual, 3=exterior
    numero: numero,
    serie: 1,

    // Emitente
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
    regime_tributario_emitente: config.crt || 1, // 1 = Simples Nacional

    // Destinatário
    ...Object.keys(destinatario).reduce((acc, k) => {
      acc[k + '_destinatario'] = destinatario[k];
      return acc;
    }, {}),

    // Itens
    items: itensPayload,

    // Pagamento
    formas_pagamento: [
      {
        forma_pagamento: formaPagamento,
        valor_pagamento: valorTotalProdutos.toFixed(2)
      }
    ]
  };

  if (config.complemento) payload.complemento_emitente = config.complemento;
  if (config.codigo_ibge_municipio) payload.codigo_municipio_emitente = String(config.codigo_ibge_municipio);
  if (config.cnae_principal) payload.cnae_fiscal_emitente = String(config.cnae_principal).replace(/\D/g, '');
  if (config.telefone) payload.telefone_emitente = String(config.telefone).replace(/\D/g, '');

  // Observações
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

// lib/nfeBuilder.js
// Monta o payload da NFe no formato Focus NFe a partir dos dados do banco
// v5 — respeita o valor total do orçamento (com desconto aplicado)
// v6 — deriva valor_unitario do valor_bruto pra garantir consistência matemática (SEFAZ 629)
// v7 — consumidor_final depende de ser PJ ou PF (SEFAZ 232)
// v8 — consumidor_final depende do indicador_ie (SEFAZ 696)
//      indicador 1 (contribuinte)  → consumidor_final 0 (revenda)
//      indicador 9 (nao contribuinte) → consumidor_final 1 (uso final)
// v9 — descrição do item segue o tipo_produto (Viga/Sapata/Pilar/Espera/Bloco)
//      em vez de "Produto" genérico, e inclui medidas quando disponíveis
// v10 — corrige bug do bloco que mostrava [object Object] das direções

/**
 * Monta a descrição do item da NFe baseada no tipo de produto.
 * Segue o mesmo padrão do PDF do orçamento, mas respeita o limite de 120 caracteres da SEFAZ.
 * @param {object} item - Registro de orcamento_itens
 * @returns {string} Descrição pronta pra NFe (máx 120 chars)
 */
function montarDescricaoItem(item) {
  const tipo = item.tipo_produto || 'viga';
  let nome;

  if (tipo === 'produto') {
    // Produto cadastrado: usa o nome real
    nome = item.produto_nome || 'Produto';
  } else if (tipo === 'sapata') {
    const tam = item.sapata_tamanho_cm;
    const qtd = item.sapata_qtd_pecas;
    const bit = item.sapata_bitola;
    let detalhes = '';
    if (tam) detalhes += ` ${tam}x${tam}cm`;
    if (qtd && bit) detalhes += ` - ${qtd} ferros ${bit}mm`;
    else if (qtd) detalhes += ` - ${qtd} ferros`;
    nome = `Sapata${detalhes}`;
  } else if (tipo === 'bloco') {
    const bd = item.bloco_dados || {};
    const sub = (bd.subtipo === 'composto') ? 'Composto' : 'Simples';
    nome = `Bloco ${sub}`;
  } else if (tipo === 'pilar') {
    const tam = item.tamanho_metros;
    nome = tam ? `Pilar ${tam}m` : 'Pilar';
  } else if (tipo === 'espera') {
    const tam = item.tamanho_metros;
    nome = tam ? `Espera de Pilar ${tam}m` : 'Espera de Pilar';
  } else {
    // viga (default)
    const tam = item.tamanho_metros;
    nome = tam ? `Viga ${tam}m` : 'Viga';
  }

  // Garante limite de 120 caracteres da SEFAZ
  return String(nome).slice(0, 120);
}

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
  const dataEmissao = new Date().toISOString();

  // Padrões fiscais (vêm da configuracao_fiscal)
  const NCM_PADRAO = String(config.ncm_padrao || '73084000').replace(/\D/g, '').padStart(8, '0').slice(0, 8);
  const CFOP_INTERNO = String(config.cfop_interno_padrao || '5101');
  const CFOP_INTERESTADUAL = String(config.cfop_interestadual_padrao || '6101');
  const CSOSN_PADRAO = String(config.csosn_padrao || '102');
  const ORIGEM_PADRAO = String(config.origem_padrao || '0');

  // ---- DESCONTO E VALORES TOTAIS ----
  const subtotalItens = itens.reduce((acc, i) => acc + Number(i.preco_total || 0), 0);
  const valorTotalOrcamento = Number(orcamento.valor_total || subtotalItens);
  const descontoTotal = Math.max(0, Number((subtotalItens - valorTotalOrcamento).toFixed(2)));
  const temDesconto = descontoTotal > 0.001;

  // ---- DESTINATÁRIO ----
  const documento = String(cliente.documento || '').replace(/\D/g, '');
  const ehPJ = documento.length === 14;

  // Indicador de IE do destinatário (default 9 = não contribuinte)
  const indicadorIE = Number(cliente.indicador_ie) || 9;

  // v8: Consumidor final segue o indicador_ie (regra da SEFAZ)
  // indicador 1 (Contribuinte ICMS) → consumidor_final = 0 (revenda)
  // indicador 2 (Isento) ou 9 (Não Contribuinte) → consumidor_final = 1 (uso final)
  const consumidorFinal = indicadorIE === 1 ? 0 : 1;

  const destinatario = {
    nome: cliente.nome,
    [ehPJ ? 'cnpj' : 'cpf']: documento,
    indicador_inscricao_estadual: indicadorIE,
    logradouro: cliente.logradouro || cliente.endereco || 'Sem endereço',
    numero: cliente.numero || 'S/N',
    bairro: cliente.bairro || 'Centro',
    municipio: cliente.cidade || '',
    uf: ufDestinatario,
    cep: String(cliente.cep || '').replace(/\D/g, '')
  };

  if (cliente.complemento) destinatario.complemento = cliente.complemento;
  if (cliente.codigo_ibge_municipio) destinatario.codigo_municipio = String(cliente.codigo_ibge_municipio);
  if (cliente.email) destinatario.email = cliente.email;
  if (cliente.telefone) destinatario.telefone = String(cliente.telefone).replace(/\D/g, '');
  if (cliente.inscricao_estadual && indicadorIE === 1) {
    destinatario.inscricao_estadual = cliente.inscricao_estadual;
  }
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
      descricao: montarDescricaoItem(item),
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

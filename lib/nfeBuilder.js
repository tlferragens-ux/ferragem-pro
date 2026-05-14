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
  const dataEmissao = new Date().toISOString();

  // Padrões fiscais (vêm da configuracao_fiscal)
  const NCM_PADRAO = String(config.ncm_padrao || '73084000').replace(/\D/g, '').padStart(8, '0').slice(0, 8);
  const CFOP_INTERNO = String(config.cfop_interno_padrao || '5101');
  const CFOP_INTERESTADUAL = String(config.cfop_interestadual_padrao || '6101');
  const CSOSN_PADRAO = String(config.csosn_padrao || '102');
  const ORIGEM_PADRAO = String(config.origem_padrao || '0');

  // ---- DESCONTO E VALORES TOTAIS ----
  // Soma bruta dos itens (subtotal sem desconto)
  const subtotalItens = itens.reduce((acc, i) => acc + Number(i.preco_total || 0), 0);
  // Valor total do orçamento (já com desconto)
  const valorTotalOrcamento = Number(orcamento.valor_total || subtotalItens);
  // Desconto = subtotal - total
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
  // Isso resolve a rejeição 696 ("Operacao com nao contribuinte deve indicar
  // operacao com consumidor final") sem cair na 232 ("IE nao informada")
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
    const precoUnitarioBanco =

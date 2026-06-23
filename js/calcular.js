/* ================================================
   CÁLCULO AUTOMÁTICO — BASE e PEDIDO BENEFÍCIO
   Reproduz as fórmulas do Google Sheets:

   BASE col I (idx 8)  = DIAS × VT  (→ 'VT (2)' após resolverDuplicatas)
   BASE col J (idx 9)  = DIAS × VR  (→ 'VR (2)')
   BASE col K (idx 10) = PROCV(A em PEDIDO!B) → "Ok"/"Verificar"

   Novas colunas extras adicionadas pela plataforma na BASE:
   CPF, CNPJ, ALIMENTAÇÃO, REFEIÇÃO, PREMIAÇÃO NO CARTÃO
   ALIMENTAÇÃO TOTAL = DIAS × ALIMENTAÇÃO
   REFEIÇÃO TOTAL    = DIAS × REFEIÇÃO
   PREMIAÇÃO TOTAL   = DIAS × PREMIAÇÃO NO CARTÃO

   PEDIDO BENEFÍCIO — colunas exatas do xlsx (sem acento):
   CNPJ | NOME COMPLETO | CPF |
   MOBILIDADE (R$) | ALIMENTACAO (R$) | REFEICAO (R$) |
   PREMIACAO NO CARTAO (R$) | REFEICAO E ALIMENTACAO (R$)

   FLUXO (sem circularidade):
   1. recalcularBaseIJ()          → I, J + novos totais
   2. recalcularPedidoBeneficio() → gera/atualiza PEDIDO (skip se em edição)
   3. recalcularBaseK()           → K (PROCV no PEDIDO)
   ================================================ */

/* ---- Índices fixos das colunas ORIGINAIS da BASE (base 0) ---- */
const IDX_BASE_NOME  = 0;   // A — NOME FUNCIONÁRIO
const IDX_BASE_VT    = 4;   // E — VT (taxa por dia)
const IDX_BASE_VR    = 5;   // F — VR (taxa por dia)
const IDX_BASE_DIAS  = 7;   // H — DIAS trabalhados
const IDX_BASE_VT2   = 8;   // I — VT total calculado (= DIAS × VT → 'VT (2)')
const IDX_BASE_VR2   = 9;   // J — VR total calculado (= DIAS × VR → 'VR (2)')

/* ---- Colunas de identificação (extras da plataforma na BASE) ---- */
const COL_CPF   = 'CPF';
const COL_CNPJ  = 'CNPJ';

/* ---- ALIMENTAÇÃO — grupo de colunas extras (laranja) ---- */
const COL_ALIM_VAL  = 'ALIMENTAÇÃO VALOR';   // R$ por dia
const COL_ALIM_DIAS = 'ALIMENTAÇÃO DIAS';     // dias do benefício
const COL_ALIM_TOT  = 'ALIMENTAÇÃO TOTAL';   // calculado: VAL × DIAS

/* ---- REFEIÇÃO — grupo de colunas extras (verde) ---- */
const COL_REF_VAL   = 'REFEIÇÃO VALOR';
const COL_REF_DIAS  = 'REFEIÇÃO DIAS';
const COL_REF_TOT   = 'REFEIÇÃO TOTAL';

/* ---- PREMIAÇÃO NO CARTÃO — grupo de colunas extras (roxo) ---- */
const COL_PREM_VAL  = 'PREMIAÇÃO VALOR';
const COL_PREM_DIAS = 'PREMIAÇÃO DIAS';
const COL_PREM_TOT  = 'PREMIAÇÃO TOTAL';

/* ---- Colunas e ordem exata do PEDIDO (igual ao xlsx — sem acento) ---- */
const COLUNAS_PEDIDO = [
  'CNPJ',
  'NOME COMPLETO',
  'CPF',
  'MOBILIDADE (R$)',
  'ALIMENTACAO (R$)',
  'REFEICAO (R$)',
  'PREMIACAO NO CARTAO (R$)',
  'REFEICAO E ALIMENTACAO (R$)',
];

/* ---- Colunas extras que a plataforma sempre garante na BASE ---- */
const COLUNAS_EXTRAS_BASE = [
  COL_CPF,
  COL_CNPJ,
  COL_ALIM_VAL,  COL_ALIM_DIAS,  COL_ALIM_TOT,
  COL_REF_VAL,   COL_REF_DIAS,   COL_REF_TOT,
  COL_PREM_VAL,  COL_PREM_DIAS,  COL_PREM_TOT,
];

/* ---- Entrada única: recalcula tudo na ordem certa ---- */
function recalcularTudo() {
  recalcularBaseIJ();
  recalcularPedidoBeneficio();
}

/* ================================================
   STEP 1 — BASE: colunas calculadas
   I  = DIAS × VT   (→ colunaBase[8] = 'VT (2)')
   J  = DIAS × VR   (→ colunaBase[9] = 'VR (2)')
   + ALIMENTAÇÃO TOTAL = DIAS × ALIMENTAÇÃO
   + REFEIÇÃO TOTAL    = DIAS × REFEIÇÃO
   + PREMIAÇÃO TOTAL   = DIAS × PREMIAÇÃO NO CARTÃO
   ================================================ */
function recalcularBaseIJ() {
  if (!Estado.dadosBase || !Estado.dadosBase.length) return;

  const cols = Estado.colunasBase;

  // Busca por nome primeiro (resiliente a ordem de colunas diferente do xlsx)
  const cVT2  = cols.find(c => c === 'VT (2)') ?? cols[IDX_BASE_VT2];
  const cVR2  = cols.find(c => c === 'VR (2)') ?? cols[IDX_BASE_VR2];
  const cDias = cols.find(c => /^DIAS$/i.test(c)) ?? cols[IDX_BASE_DIAS];
  // VT e VR são a primeira ocorrência antes do '(2)'
  const cVT   = cols.find(c => c === 'VT') ?? cols[IDX_BASE_VT];
  const cVR   = cols.find(c => c === 'VR') ?? cols[IDX_BASE_VR];

  if (!cDias || !cVT2 || !cVR2) return;

  // Cada benefício tem VALOR, DIAS próprios e TOTAL calculado
  const hasAlim  = cols.includes(COL_ALIM_VAL) && cols.includes(COL_ALIM_DIAS) && cols.includes(COL_ALIM_TOT);
  const hasRef   = cols.includes(COL_REF_VAL)  && cols.includes(COL_REF_DIAS)  && cols.includes(COL_REF_TOT);
  const hasPrem  = cols.includes(COL_PREM_VAL) && cols.includes(COL_PREM_DIAS) && cols.includes(COL_PREM_TOT);

  Estado.dadosBase.forEach(linha => {
    const diasBase = _num(linha[cDias]);

    // VT e VR usam os DIAS da coluna H (como antes)
    linha[cVT2] = _moeda(diasBase * _num(linha[cVT]));
    linha[cVR2] = _moeda(diasBase * _num(linha[cVR]));

    // Cada benefício extra usa seus próprios DIAS
    if (hasAlim) linha[COL_ALIM_TOT] = _moeda(_num(linha[COL_ALIM_VAL]) * _num(linha[COL_ALIM_DIAS]));
    if (hasRef)  linha[COL_REF_TOT]  = _moeda(_num(linha[COL_REF_VAL])  * _num(linha[COL_REF_DIAS]));
    if (hasPrem) linha[COL_PREM_TOT] = _moeda(_num(linha[COL_PREM_VAL]) * _num(linha[COL_PREM_DIAS]));
  });
}

/* ================================================
   STEP 2 — PEDIDO BENEFÍCIO (preview gerado da BASE)
   Agrega por nome normalizado (SOMASES).
   CNPJ/CPF vêm das novas colunas da BASE.
   Pula se o PEDIDO está em modo de edição manual.
   ================================================ */
function recalcularPedidoBeneficio() {
  // Não regenera se o usuário está editando o PEDIDO manualmente
  if (typeof pedidoEmEdicao !== 'undefined' && pedidoEmEdicao) return;

  Estado.colunasPedido = COLUNAS_PEDIDO;

  if (!Estado.dadosBase || !Estado.dadosBase.length) {
    Estado.dadosPedido = [];
    return;
  }

  const cols  = Estado.colunasBase;
  const cNome = cols[IDX_BASE_NOME];
  const cVT2  = cols.find(c => c === 'VT (2)') ?? cols[IDX_BASE_VT2];
  const cVR2  = cols.find(c => c === 'VR (2)') ?? cols[IDX_BASE_VR2];

  // Agrega por nome normalizado (SOMASES)
  const mapa = new Map();

  Estado.dadosBase.forEach(l => {
    const nome  = String(l[cNome] || '').trim();
    const nNorm = _norm(nome);
    if (!nNorm) return;

    if (!mapa.has(nNorm)) {
      mapa.set(nNorm, {
        nome,
        cnpj: '', cpf: '',
        vt2: 0, vr2: 0, alim: 0, ref: 0, prem: 0,
      });
    }

    const t = mapa.get(nNorm);
    t.vt2  += _num(l[cVT2]);
    t.vr2  += _num(l[cVR2]);
    t.alim += _num(l[COL_ALIM_TOT]);
    t.ref  += _num(l[COL_REF_TOT]);
    t.prem += _num(l[COL_PREM_TOT]);

    // Usa o primeiro CNPJ/CPF não-vazio encontrado para este nome
    if (!t.cnpj && l[COL_CNPJ]) t.cnpj = String(l[COL_CNPJ]).trim();
    if (!t.cpf  && l[COL_CPF])  t.cpf  = String(l[COL_CPF]).trim();
  });

  // Constrói dadosPedido, preservando edições manuais de CNPJ/CPF se existirem
  Estado.dadosPedido = [...mapa.values()].map((t, idx) => {
    // Procura linha já existente no PEDIDO (preserva edições manuais de CNPJ/CPF)
    const existente = (Estado.dadosPedido || []).find(
      l => _norm(l['NOME COMPLETO']) === _norm(t.nome)
    );

    return {
      _id: idx + 1,
      'CNPJ':                        existente?.['CNPJ']  ?? t.cnpj,
      'NOME COMPLETO':                t.nome,
      'CPF':                          existente?.['CPF']   ?? t.cpf,
      'MOBILIDADE (R$)':              _moeda(t.vt2),
      'ALIMENTACAO (R$)':             _moeda(t.alim),
      'REFEICAO (R$)':                _moeda(t.ref),
      'PREMIACAO NO CARTAO (R$)':     _moeda(t.prem),
      'REFEICAO E ALIMENTACAO (R$)':  _moeda(t.vr2),
    };
  });
}

/* ================================================
   Gera PEDIDO do zero a partir da BASE
   (usado na inicialização quando não há dados salvos)
   ================================================ */
function gerarPedidoDaBase() {
  Estado.dadosPedido = [];
  recalcularPedidoBeneficio();
}

/* ================================================
   UTILITÁRIOS INTERNOS
   ================================================ */

function _norm(texto) {
  if (!texto) return '';
  return String(texto).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

function _num(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return isNaN(valor) ? 0 : valor;

  const s = String(valor).trim()
    .replace(/R\$\s*/gi, '')
    .replace(/\s/g, '');
  if (!s) return 0;

  // Detecta o separador decimal pelo contexto:
  // Se tem AMBOS ponto e vírgula → o último é o decimal.
  // "1.234,56" → pt-BR (vírgula = decimal)  → 1234.56
  // "1,234.56" → en-US (ponto = decimal)    → 1234.56
  // Se só vírgula → "18,76" → decimal pt-BR → 18.76
  // Se só ponto  → "18.76" → decimal padrão → 18.76
  const hasDot   = s.includes('.');
  const hasComma = s.includes(',');

  let normalized;
  if (hasDot && hasComma) {
    normalized = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')   // pt-BR: vírgula é decimal
      : s.replace(/,/g, '');                      // en-US: ponto é decimal
  } else if (hasComma) {
    normalized = s.replace(',', '.');             // só vírgula → decimal
  } else {
    normalized = s;                               // só ponto ou inteiro → ok
  }

  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}

function _moeda(valor) {
  const n = typeof valor === 'number' ? valor : _num(valor);
  return 'R$ ' + n.toFixed(2).replace('.', ',');
}

// Aliases públicos
function parseMoeda(v)  { return _num(v); }
function fmtMoedaBR(v)  { return _moeda(v); }
function normNome(v)    { return _norm(v); }

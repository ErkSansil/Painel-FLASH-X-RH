/* ================================================
   IMPORTAÇÃO DE PLANILHA .XLSX
   Fluxo:
   1. Lê aba BASE → Estado.dadosBase
   2. Garante colunas extras (CPF, CNPJ, ALIMENTAÇÃO…)
   3. Lê aba PEDIDO BENEFICIO → extrai CNPJ/CPF por pessoa → injeta na BASE
   4. recalcularTudo() — I,J, totais, PEDIDO preview, K
   5. Renderiza e vai para aba BASE
   ================================================ */

let pastaImportadaTemp = null;
let abaSelecionadaTemp  = null;

// -----------------------------------------------
// Disparado ao selecionar o arquivo
// -----------------------------------------------
function importarPlanilha(evento) {
  const arquivo = evento.target.files[0];
  if (!arquivo) return;

  const nome = arquivo.name.toLowerCase();
  if (!nome.endsWith('.xlsx') && !nome.endsWith('.xls') && !nome.endsWith('.csv')) {
    mostrarNotificacao('Formato inválido. Use .xlsx, .xls ou .csv', 'erro');
    evento.target.value = '';
    return;
  }

  const leitor = new FileReader();
  leitor.onload = function (e) {
    try {
      const pasta = XLSX.read(e.target.result, {
        type: 'binary',
        cellDates: true,
        raw: true,
      });
      pastaImportadaTemp = pasta;

      // Preenche select de abas (exclui aba PEDIDO e "PARA ENVIAR")
      const abasBase = pasta.SheetNames.filter(n =>
        !n.toUpperCase().includes('PEDIDO') &&
        !n.toUpperCase().includes('BENEFICIO') &&
        !n.toUpperCase().includes('ENVIAR')
      );
      const todasAbas = pasta.SheetNames;

      const sel = document.getElementById('select-aba-importacao');
      sel.innerHTML = todasAbas.map(n =>
        `<option value="${escaparHtml(n)}">${escaparHtml(n)}</option>`
      ).join('');

      // Pré-seleciona aba que parece ser a BASE
      const abaBase = abasBase[0] || todasAbas[0];
      if (abaBase) sel.value = abaBase;

      sel.onchange = () => atualizarPreviewImportacao();
      document.getElementById('nome-arquivo-importacao').textContent = arquivo.name;
      atualizarPreviewImportacao();
      abrirModal('modal-importacao');

    } catch (err) {
      console.error(err);
      mostrarNotificacao('Erro ao ler o arquivo. Verifique se é um .xlsx válido.', 'erro');
    }
  };
  leitor.onerror = () => mostrarNotificacao('Não foi possível ler o arquivo.', 'erro');
  leitor.readAsBinaryString(arquivo);
  evento.target.value = '';
}

// -----------------------------------------------
// Atualiza o painel de informações da aba selecionada
// -----------------------------------------------
function atualizarPreviewImportacao() {
  if (!pastaImportadaTemp) return;
  const nomeAba = document.getElementById('select-aba-importacao').value;
  const linhas  = _lerComoArrays(nomeAba);
  if (!linhas.length) return;

  const cabecalho   = (linhas[0] || []).filter(c => c !== '' && c !== null);
  const totalLinhas = linhas.slice(1).filter(l =>
    l.some(c => c !== '' && c !== null && c !== undefined)
  ).length;

  const abasPedido = pastaImportadaTemp.SheetNames.filter(n =>
    n.toUpperCase().includes('PEDIDO') || n.toUpperCase().includes('BENEFICIO')
  );
  const infoPedido = abasPedido.length > 0
    ? `<br><span style="color:var(--cor-sucesso)">✅ Aba <strong>"${escaparHtml(abasPedido[0])}"</strong> encontrada — CNPJ e CPF serão importados automaticamente para a BASE.</span>`
    : `<br><span style="color:var(--cor-aviso)">⚠️ Aba PEDIDO não encontrada — preencha CNPJ e CPF manualmente na BASE.</span>`;

  document.getElementById('info-importacao').innerHTML =
    `Aba: <strong>${escaparHtml(nomeAba)}</strong> &nbsp;|&nbsp;
     Linhas: <strong>${totalLinhas}</strong> &nbsp;|&nbsp;
     Colunas: <strong>${cabecalho.length}</strong>${infoPedido}`;

  abaSelecionadaTemp = nomeAba;
}

// -----------------------------------------------
// Confirma importação e executa o pipeline completo
// -----------------------------------------------
function confirmarImportacao() {
  if (!pastaImportadaTemp || !abaSelecionadaTemp) return;
  const modo = document.querySelector('input[name="modo-importacao"]:checked')?.value || 'sobrescrever';

  /* PASSO 1 — Importa aba BASE */
  if (!_importarAbaBase(abaSelecionadaTemp, modo)) return;

  /* PASSO 2 — Garante que colunas extras existam na BASE */
  _garantirColunasExtras();

  /* PASSO 3 — Extrai CNPJ/CPF da aba PEDIDO e injeta na BASE */
  const abasPedido = pastaImportadaTemp.SheetNames.filter(n =>
    n.toUpperCase().includes('PEDIDO') || n.toUpperCase().includes('BENEFICIO')
  );
  if (abasPedido.length > 0) {
    _injetarCnpjCpfDoPedido(abasPedido[0]);
  }

  /* PASSO 4 — Recalcula tudo:
     - BASE I, J e novos totais (ALIM, REF, PREM)
     - Gera PEDIDO como preview da BASE
     - BASE K (PROCV) */
  recalcularTudo();

  fecharModalImportacao();
  pastaImportadaTemp = null;
  abaSelecionadaTemp  = null;

  Estado.marcarAlterado();

  renderizarTabelaBase();
  preencherFiltros();
  trocarAba('base');

  mostrarNotificacao(
    `✅ ${Estado.dadosBase.length} colaboradores carregados.`,
    'sucesso'
  );
}

// -----------------------------------------------
// Importa aba BASE → Estado.dadosBase
// -----------------------------------------------
function _importarAbaBase(nomeAba, modo) {
  let linhas = _lerComoArrays(nomeAba);
  if (linhas.length < 2) {
    mostrarNotificacao('Planilha vazia ou sem dados.', 'aviso');
    return false;
  }

  // Pula linha ##META do sincronismo (presente quando o xlsx veio do Google Sheets)
  if (String(linhas[0][0] || '').trim() === '##META') {
    linhas = linhas.slice(1);
  }

  if (linhas.length < 2) {
    mostrarNotificacao('Planilha vazia ou sem dados.', 'aviso');
    return false;
  }

  const cabecalho = _resolverDuplicatas(
    linhas[0].map(c => String(c ?? '').trim())
  );

  const dados = linhas.slice(1)
    .filter(l => l.some(c => c !== '' && c !== null && c !== undefined))
    .map((l, idx) => {
      const obj = { _id: idx + 1 };
      cabecalho.forEach((col, i) => { obj[col] = _celula(l[i], col); });
      return obj;
    });

  Estado.salvarHistorico();

  if (modo === 'sobrescrever') {
    Estado.colunasBase = cabecalho;
    Estado.dadosBase   = dados;
  } else {
    const chave = cabecalho[0];
    cabecalho.forEach(c => { if (!Estado.colunasBase.includes(c)) Estado.colunasBase.push(c); });
    dados.forEach(novo => {
      const n   = _normStr(novo[chave]);
      const idx = Estado.dadosBase.findIndex(l => _normStr(l[chave]) === n);
      if (idx !== -1) {
        Estado.dadosBase[idx] = { ...Estado.dadosBase[idx], ...novo, _id: Estado.dadosBase[idx]._id };
      } else {
        novo._id = Estado.dadosBase.length + 1;
        Estado.dadosBase.push(novo);
      }
    });
  }
  return true;
}

// -----------------------------------------------
// Lê aba PEDIDO BENEFICIO e injeta CNPJ/CPF na BASE
// (por correspondência de nome normalizado)
// -----------------------------------------------
function _injetarCnpjCpfDoPedido(nomeAba) {
  const linhas = _lerComoArrays(nomeAba);
  if (linhas.length < 2) return;

  const cabecalho = linhas[0].map(c => String(c ?? '').trim());
  const iNome = cabecalho.findIndex(c => /nome/i.test(c));
  const iCPF  = cabecalho.findIndex(c => /cpf/i.test(c));
  const iCNPJ = cabecalho.findIndex(c => /cnpj/i.test(c));

  if (iNome < 0) return;

  // Mapa nome normalizado → {cnpj, cpf}
  const mapa = {};
  linhas.slice(1).forEach(l => {
    const nome = String(l[iNome] || '').trim();
    if (!nome) return;
    const nNorm = _normStr(nome);

    let cnpj = '';
    if (iCNPJ >= 0) {
      const v = l[iCNPJ];
      // CNPJ vem como número no xlsx (ex: 58520730000101) → string com zeros à esquerda
      cnpj = typeof v === 'number'
        ? Math.round(v).toString().padStart(14, '0')
        : String(v || '').trim();
    }

    let cpf = '';
    if (iCPF >= 0) {
      cpf = _celula(l[iCPF], 'CPF');
    }

    mapa[nNorm] = { cnpj, cpf };
  });

  // Injeta nas linhas da BASE correspondentes
  const cNomeBase = Estado.colunasBase[IDX_BASE_NOME];
  Estado.dadosBase.forEach(linha => {
    const nNorm = _normStr(String(linha[cNomeBase] || ''));
    if (mapa[nNorm]) {
      // Sobrescreve apenas se a célula está vazia
      if (!linha[COL_CNPJ]) linha[COL_CNPJ] = mapa[nNorm].cnpj;
      if (!linha[COL_CPF])  linha[COL_CPF]  = mapa[nNorm].cpf;
    }
  });
}

// -----------------------------------------------
// Garante que todas as colunas extras existem na BASE
// (adiciona ao final se ainda não estiverem)
// -----------------------------------------------
function _garantirColunasExtras() {
  COLUNAS_EXTRAS_BASE.forEach(col => {
    if (!Estado.colunasBase.includes(col)) {
      Estado.colunasBase.push(col);
    }
  });
  // Inicializa células das novas colunas como string vazia
  Estado.dadosBase.forEach(linha => {
    COLUNAS_EXTRAS_BASE.forEach(col => {
      if (linha[col] === undefined) linha[col] = '';
    });
  });
}

// -----------------------------------------------
// Resolve nomes duplicados de colunas:
// ['VT','VR','VT','VR'] → ['VT','VR','VT (2)','VR (2)']
// -----------------------------------------------
function _resolverDuplicatas(nomes) {
  const cont = {};
  return nomes.map(nome => {
    const n = nome || 'Coluna';
    if (cont[n] === undefined) { cont[n] = 1; return n; }
    cont[n]++;
    return `${n} (${cont[n]})`;
  });
}

// Alias público
function resolverDuplicatas(nomes) { return _resolverDuplicatas(nomes); }

// -----------------------------------------------
// Lê aba do arquivo como array de arrays (raw)
// -----------------------------------------------
function _lerComoArrays(nomeAba) {
  const planilha = pastaImportadaTemp?.Sheets[nomeAba];
  if (!planilha) return [];
  return XLSX.utils.sheet_to_json(planilha, {
    header: 1, defval: '', raw: true, blankrows: false,
  });
}

// -----------------------------------------------
// Formata valor de célula para exibição
// CNPJ/CPF → string pura | número → string formatada
// -----------------------------------------------
function _celula(valor, coluna) {
  if (valor === null || valor === undefined) return '';

  if (coluna && /cnpj/i.test(coluna)) {
    if (typeof valor === 'number') return Math.round(valor).toString().padStart(14, '0');
    return String(valor).trim();
  }

  if (coluna && /cpf/i.test(coluna)) {
    const s = typeof valor === 'number'
      ? Math.round(valor).toString().padStart(11, '0')
      : String(valor).replace(/\D/g, '').padStart(11, '0');
    if (s.length === 11 && /^\d+$/.test(s)) {
      return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }
    return String(valor).trim();
  }

  // Colunas de taxa diária VT/VR → formata como moeda
  if (coluna && /^(VT|VR)$/.test(coluna)) {
    const n = typeof valor === 'number' ? valor : parseFloat(String(valor).replace(',', '.'));
    return isNaN(n) || n === 0 ? '' : 'R$ ' + n.toFixed(2).replace('.', ',');
  }

  if (valor instanceof Date) return valor.toLocaleDateString('pt-BR');

  if (typeof valor === 'number') {
    if (Number.isInteger(valor)) return String(valor);
    return valor.toFixed(2).replace('.', ',');
  }

  return String(valor).trim();
}

// Normalização simples para mesclagem
function _normStr(v) {
  return String(v || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// -----------------------------------------------
// Fecha o modal de importação
// -----------------------------------------------
function fecharModalImportacao() {
  pastaImportadaTemp = null;
  abaSelecionadaTemp  = null;
  fecharModal('modal-importacao');
}

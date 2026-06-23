/* ================================================
   RENDERIZAÇÃO E EDIÇÃO DAS TABELAS
   BASE (sempre editável) e
   PEDIDO BENEFÍCIO (modo visualização / edição)
   ================================================ */

// Controla se o PEDIDO BENEFÍCIO está em modo de edição
let pedidoEmEdicao = false;

// Grupos de benefícios extras — visibilidade controlada pelos toggles da toolbar
const gruposVisiveis = { alimentacao: false, refeicao: false, premiacao: false };

// IDs das linhas selecionadas (multi-seleção)
const linhasSelecionadas = new Set();

// -----------------------------------------------
// Helpers de formatação de valor e CPF
// -----------------------------------------------

// Retorna true se a coluna deve ser formatada como moeda
function _eColunaMoeda(col) {
  return /VALOR|TOTAL|\(R\$\)/.test(col) || /^(VT|VR)$/.test(col);
}

// Formata valor como moeda BR (R$ 0,00)
function _formatarMoeda(v) {
  const n = _num(v);
  return n === 0 && String(v).trim() === '' ? '' : _moeda(n);
}

// Formata CPF como XXX.XXX.XXX-XX
function _formatarCPF(v) {
  const s = String(v).replace(/\D/g, '');
  if (s.length !== 11) return String(v).trim();
  return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

// Mapeia coluna → grupo (para filtragem e coloração)
function _grupoDaColuna(col) {
  if ([COL_ALIM_VAL, COL_ALIM_DIAS, COL_ALIM_TOT].includes(col)) return 'alimentacao';
  if ([COL_REF_VAL,  COL_REF_DIAS,  COL_REF_TOT ].includes(col)) return 'refeicao';
  if ([COL_PREM_VAL, COL_PREM_DIAS, COL_PREM_TOT].includes(col)) return 'premiacao';
  return null;
}

// Colunas calculadas automaticamente (readonly — input desabilitado na tabela)
const COLUNAS_READONLY = new Set([
  'VT (2)', 'VR (2)',
  COL_ALIM_TOT, COL_REF_TOT, COL_PREM_TOT,
]);

// Colunas que existem nos dados mas não devem ser exibidas na tabela
const COLUNAS_OCULTAS = new Set(['VALIDAÇÃO']);

// -----------------------------------------------
// Alterna visibilidade de um grupo de benefícios
// -----------------------------------------------
function toggleGrupoBeneficio(grupo) {
  gruposVisiveis[grupo] = !gruposVisiveis[grupo];
  const btn = document.getElementById(`toggle-${grupo}`);
  btn?.classList.toggle('toggle-grupo-ativo', gruposVisiveis[grupo]);
  renderizarTabelaBase();
}

// -----------------------------------------------
// Renderiza a tabela BASE
// -----------------------------------------------
function renderizarTabelaBase() {
  const cabecalho = document.getElementById('cabecalho-base');
  const corpo     = document.getElementById('corpo-base');
  const semDados  = document.getElementById('sem-dados');

  aplicarFiltros();
  const dados = Estado.dadosFiltrados;

  if (!dados || dados.length === 0) {
    corpo.innerHTML     = '';
    cabecalho.innerHTML = '';
    semDados.style.display = 'block';
    atualizarContador(0);
    return;
  }

  semDados.style.display = 'none';

  // Filtra colunas pelo grupo visível e remove colunas ocultas (ex: VALIDAÇÃO)
  const colunas = Estado.colunasBase.filter(col => {
    if (COLUNAS_OCULTAS.has(col)) return false;
    const g = _grupoDaColuna(col);
    return g === null || gruposVisiveis[g];
  });

  // Cabeçalho — cor diferente por grupo, sem ordenação em colunas de grupo
  const todaSelecionada = dados.length > 0 && dados.every(l => linhasSelecionadas.has(l._id));
  cabecalho.innerHTML = `
    <th class="th-check ocultar-visualizador">
      <input type="checkbox" class="check-linha" title="Selecionar todas"
             ${todaSelecionada ? 'checked' : ''}
             onchange="toggleSelecionarTudo(this.checked)" />
    </th>
    <th class="td-numero">#</th>
    ${colunas.map(col => {
      const g     = _grupoDaColuna(col);
      const cor   = g ? `class="th-grupo-${g}"` : '';
      const click = g
        ? ''
        : `onclick="if(!_resizeAtivo) ordenarPor('${escaparHtml(col)}')" style="cursor:pointer"`;
      return `<th ${cor} ${click} title="${escaparHtml(col)}">${escaparHtml(col)}</th>`;
    }).join('')}
    <th class="th-acoes">Ações</th>
  `;

  // Linhas editáveis
  corpo.innerHTML = dados.map(linha => {
    const idxReal  = Estado.dadosBase.findIndex(d => d._id === linha._id);
    const selecionada = linhasSelecionadas.has(linha._id);

    const celulas = colunas.map(col => {
      let valor   = linha[col] ?? '';
      const readonly = COLUNAS_READONLY.has(col);
      const g        = _grupoDaColuna(col);
      const tdClass  = g ? `class="td-grupo-${g}"` : '';

      // Formata CPF e colunas de moeda para exibição
      if (/^CPF$/i.test(col) && valor) valor = _formatarCPF(valor);
      else if (_eColunaMoeda(col) && valor) valor = _formatarMoeda(valor);

      const isMoeda = !readonly && _eColunaMoeda(col);
      const isCPF   = !readonly && /^CPF$/i.test(col);

      return `<td ${tdClass}>
        <input
          class="celula-editavel${readonly ? ' celula-calculada' : ''}${isMoeda ? ' celula-moeda' : ''}"
          type="text"
          autocomplete="off"
          value="${escaparHtml(String(valor))}"
          data-linha="${idxReal}"
          data-coluna="${escaparHtml(col)}"
          ${readonly
            ? 'readonly tabindex="-1"'
            : `onchange="editarCelula(this,${idxReal},'${escaparHtml(col)}')"
               onkeydown="navegarCelula(event,this)"`}
          title="${escaparHtml(String(valor))}"
        />
      </td>`;
    }).join('');

    return `<tr id="linha-${linha._id}" data-id="${linha._id}" class="${selecionada ? 'linha-selecionada' : ''}">
      <td class="td-check ocultar-visualizador">
        <input type="checkbox" class="check-linha"
               ${selecionada ? 'checked' : ''}
               onchange="toggleSelecionarLinha(${linha._id}, this.checked)" />
      </td>
      <td class="td-numero">${idxReal + 1}</td>
      ${celulas}
      <td class="td-acoes">
        <button class="btn-remover ocultar-visualizador" onclick="removerLinha(${idxReal})" title="Remover linha">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </td>
    </tr>`;
  }).join('');

  atualizarContador(dados.length);
  Estado.atualizarBotoesHistorico();
  _iniciarResizeColunas('tabela-base');
  verificarDuplicatas();
}

// -----------------------------------------------
// Renderiza a tabela PEDIDO BENEFÍCIO
// Muda o layout conforme o modo (visualização ou edição)
// -----------------------------------------------
function renderizarTabelaPedido() {
  const cabecalho = document.getElementById('cabecalho-pedido');
  const corpo     = document.getElementById('corpo-pedido');
  const semDados  = document.getElementById('sem-dados-pedido');
  const dados     = Estado.dadosPedido;
  const colunas   = Estado.colunasPedido;

  if (!dados || dados.length === 0) {
    corpo.innerHTML     = '';
    cabecalho.innerHTML = '';
    semDados.style.display = 'block';
    return;
  }

  semDados.style.display = 'none';

  // Cabeçalho (sem ordenação, pois segue layout fixo)
  cabecalho.innerHTML = `
    <th>#</th>
    ${colunas.map(col => `<th>${escaparHtml(col)}</th>`).join('')}
    ${pedidoEmEdicao ? '<th style="width:60px;text-align:center;cursor:default;">Ações</th>' : ''}
  `;

  corpo.innerHTML = dados.map((linha, idx) => {
    const celulas = colunas.map(col => {
      const valor = linha[col] ?? '';

      if (pedidoEmEdicao) {
        // Modo edição: campos de input
        return `<td>
          <input
            class="celula-editavel"
            type="text"
            autocomplete="off"
            value="${escaparHtml(String(valor))}"
            data-idx="${idx}"
            data-col="${escaparHtml(col)}"
            onchange="editarCelulaPedido(this, ${idx}, '${escaparHtml(col)}')"
            onkeydown="navegarCelula(event, this)"
            title="${escaparHtml(String(valor))}"
          />
        </td>`;
      }

      // Modo visualização: texto simples
      return `<td>${escaparHtml(String(valor))}</td>`;
    }).join('');

    const colAcoes = pedidoEmEdicao
      ? `<td><div class="celula-acoes">
           <button class="btn-linha" onclick="removerLinhaPedido(${idx})" title="Remover">🗑</button>
         </div></td>`
      : '';

    return `<tr>${`<td>${idx + 1}</td>`}${celulas}${colAcoes}</tr>`;
  }).join('');

  // Atualiza botões de undo/redo para o contexto do pedido
  if (pedidoEmEdicao) Estado.atualizarBotoesHistorico();

  // Adiciona handles de resize nas colunas do PEDIDO
  _iniciarResizeColunas('tabela-pedido');
}

// -----------------------------------------------
// Clique em "Editar PEDIDO BENEFÍCIO"
// Abre modal de confirmação antes de entrar em edição
// -----------------------------------------------
function solicitarEdicaoPedido() {
  abrirModal('modal-confirmar-edicao');
}

// -----------------------------------------------
// Confirmado pelo usuário: entra no modo edição
// Salva snapshot para possível cancelamento
// -----------------------------------------------
function ativarEdicaoPedido() {
  fecharModal('modal-confirmar-edicao');

  // Guarda cópia profunda dos dados atuais para rollback
  Estado.snapshotPedidoAntesDaEdicao = JSON.parse(JSON.stringify(Estado.dadosPedido));

  pedidoEmEdicao = true;

  document.getElementById('toolbar-pedido-visualizacao').classList.add('oculto');
  document.getElementById('toolbar-pedido-edicao').classList.remove('oculto');
  document.getElementById('info-pedido').classList.add('oculto');
  document.getElementById('tabela-pedido').classList.remove('tabela-readonly');

  renderizarTabelaPedido();
  mostrarNotificacao('Modo de edição ativado. Faça as alterações e clique em Salvar Edição.', 'info');
}

// -----------------------------------------------
// Cancela a edição e reverte para o snapshot anterior
// -----------------------------------------------
async function cancelarEdicaoPedido() {
  if (!await confirmar('Deseja cancelar a edição? Todas as alterações feitas serão descartadas.', { icone: '↩️', ok: 'Descartar', cancelar: 'Continuar editando' })) return;

  // Restaura o estado exato de antes de entrar em edição
  if (Estado.snapshotPedidoAntesDaEdicao !== null) {
    Estado.dadosPedido = JSON.parse(JSON.stringify(Estado.snapshotPedidoAntesDaEdicao));
    Estado.snapshotPedidoAntesDaEdicao = null;
  }

  // Limpa histórico de undo/redo do pedido (as ações foram descartadas)
  Estado.historicoPedido       = [];
  Estado.historicoFuturoPedido = [];
  Estado.atualizarBotoesHistoricoPedido();

  _sairDoModoEdicaoPedido();
  // Regenera o preview limpo da BASE após cancelar
  recalcularPedidoBeneficio();
  renderizarTabelaPedido();
  mostrarNotificacao('Edição cancelada. Preview restaurado da BASE.', 'aviso');
}

// -----------------------------------------------
// Salva as edições do PEDIDO e registra timestamp + log
// -----------------------------------------------
function salvarEdicaoPedido() {
  // Gera o registro de log com tudo que foi alterado nesta sessão de edição
  const agora = new Date();
  const sessaoLog = {
    dataHora: agora.toISOString(),
    dataHoraFormatada: agora.toLocaleString('pt-BR'),
    alteracoes: [...(Estado._alteracoesAtuaisPedido || [])],
  };

  if (sessaoLog.alteracoes.length > 0) {
    Estado.logEdicoesPedido.push(sessaoLog);
  }

  Estado.ultimaEdicaoPedido = agora.toISOString();
  Estado._alteracoesAtuaisPedido = [];
  Estado.snapshotPedidoAntesDaEdicao = null;

  // Persiste no localStorage
  Estado.salvarLocal();

  _sairDoModoEdicaoPedido();
  renderizarTabelaPedido();
  atualizarBadgeUltimaEdicao();
  mostrarNotificacao(`✅ Edição salva em ${agora.toLocaleString('pt-BR')}.`, 'sucesso');
}

// -----------------------------------------------
// Sai do modo edição (helper interno)
// -----------------------------------------------
function _sairDoModoEdicaoPedido() {
  pedidoEmEdicao = false;

  document.getElementById('toolbar-pedido-edicao').classList.add('oculto');
  document.getElementById('toolbar-pedido-visualizacao').classList.remove('oculto');
  document.getElementById('info-pedido').classList.remove('oculto');
  document.getElementById('tabela-pedido').classList.add('tabela-readonly');
}

// -----------------------------------------------
// Atualiza o badge "Última edição" na toolbar
// -----------------------------------------------
function atualizarBadgeUltimaEdicao() {
  const badge = document.getElementById('badge-ultima-edicao');
  if (!badge) return;

  if (Estado.ultimaEdicaoPedido) {
    const dt = new Date(Estado.ultimaEdicaoPedido).toLocaleString('pt-BR');
    badge.textContent = `🕐 Última edição: ${dt}`;
    badge.classList.remove('oculto');
  } else {
    badge.classList.add('oculto');
  }
}

// -----------------------------------------------
// Edita célula da BASE e dispara recálculo completo:
// I=H×E, J=H×F, PEDIDO D/H (SOMASES), BASE K (PROCV)
// -----------------------------------------------
function editarCelula(input, idxLinha, coluna) {
  const valorAntigo = Estado.dadosBase[idxLinha][coluna] ?? '';
  const valorNovo   = input.value;

  if (valorAntigo === valorNovo) return;

  Estado.salvarHistorico();

  // Descobre o nome do colaborador para o log
  const colNome = Estado.colunasBase[0] || '';
  const nomeColaborador = Estado.dadosBase[idxLinha][colNome] || `Linha ${idxLinha + 1}`;

  // Auto-formata colunas de moeda e CPF
  let valorFormatado = valorNovo;
  if (_eColunaMoeda(coluna) && valorNovo.trim() !== '') {
    valorFormatado = _formatarMoeda(valorNovo);
    input.value = valorFormatado;
  } else if (/^CPF$/i.test(coluna) && valorNovo.trim() !== '') {
    valorFormatado = _formatarCPF(valorNovo);
    input.value = valorFormatado;
  }

  Estado.dadosBase[idxLinha][coluna] = valorFormatado;

  // Registra no buffer de alterações da sessão atual
  if (!Estado._alteracoesAtuaisBase) Estado._alteracoesAtuaisBase = [];
  Estado._alteracoesAtuaisBase.push({
    linha:       idxLinha + 1,
    colaborador: nomeColaborador,
    coluna:      coluna,
    valorAntigo: valorAntigo,
    valorNovo:   valorFormatado,
    hora:        new Date().toLocaleTimeString('pt-BR'),
  });

  const tr = input.closest('tr');
  if (tr) tr.classList.add('linha-modificada');

  Estado.marcarAlterado();

  // Pipeline completo de recálculo (sem re-renderizar — só atualiza dados)
  recalcularTudo();

  // Se as colunas calculadas (I, J, K) estão visíveis, atualiza seus inputs
  _atualizarCelulaCalculada(idxLinha);
}

// -----------------------------------------------
// Edita célula do PEDIDO BENEFÍCIO
// Registra a alteração no log (valor antigo → novo)
// -----------------------------------------------
function editarCelulaPedido(input, idx, coluna) {
  const valorAntigo = Estado.dadosPedido[idx][coluna] ?? '';
  const valorNovo   = input.value;

  if (valorAntigo === valorNovo) return; // sem mudança real

  Estado.salvarHistoricoPedido();
  Estado.dadosPedido[idx][coluna] = valorNovo;

  // Descobre o nome do colaborador nesta linha para o log
  const colNome    = Estado.colunasPedido[1] || Estado.colunasPedido[0] || '';
  const nomeColaborador = Estado.dadosPedido[idx][colNome] || `Linha ${idx + 1}`;

  // Registra no log temporário desta sessão de edição
  if (!Estado._alteracoesAtuaisPedido) Estado._alteracoesAtuaisPedido = [];
  Estado._alteracoesAtuaisPedido.push({
    linha:        idx + 1,
    colaborador:  nomeColaborador,
    coluna:       coluna,
    valorAntigo:  valorAntigo,
    valorNovo:    valorNovo,
    hora:         new Date().toLocaleTimeString('pt-BR'),
  });

  const tr = input.closest('tr');
  if (tr) tr.classList.add('linha-modificada');

  Estado.marcarAlterado();
}

// -----------------------------------------------
// Navega entre células com teclado (Enter, setas)
// -----------------------------------------------
function navegarCelula(event, input) {
  if (event.key === 'Enter') {
    event.preventDefault();
    // Tenta avançar para a mesma coluna na próxima linha
    const linha  = parseInt(input.dataset.linha ?? input.dataset.idx ?? 0);
    const col    = input.dataset.coluna || input.dataset.col;
    const proximo = document.querySelector(
      `input[data-linha="${linha + 1}"][data-coluna="${col}"],
       input[data-idx="${linha + 1}"][data-col="${col}"]`
    );
    if (proximo) proximo.focus();
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    const linha  = parseInt(input.dataset.linha ?? input.dataset.idx ?? 1) - 1;
    const col    = input.dataset.coluna || input.dataset.col;
    const dest   = document.querySelector(
      `input[data-linha="${linha}"][data-coluna="${col}"],
       input[data-idx="${linha}"][data-col="${col}"]`
    );
    if (dest) dest.focus();
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    const linha  = parseInt(input.dataset.linha ?? input.dataset.idx ?? 0) + 1;
    const col    = input.dataset.coluna || input.dataset.col;
    const dest   = document.querySelector(
      `input[data-linha="${linha}"][data-coluna="${col}"],
       input[data-idx="${linha}"][data-col="${col}"]`
    );
    if (dest) dest.focus();
    return;
  }
}

// -----------------------------------------------
// Remove linha da BASE
// -----------------------------------------------
async function removerLinha(idxLinha) {
  if (!await confirmar('Deseja remover esta linha?', { perigo: true, icone: '🗑️', ok: 'Remover' })) return;

  Estado.salvarHistorico();
  Estado.dadosBase.splice(idxLinha, 1);
  Estado.dadosBase.forEach((d, i) => { d._id = i + 1; });

  Estado.marcarAlterado();
  renderizarTabelaBase();
  mostrarNotificacao('Linha removida.', 'aviso');
}

// -----------------------------------------------
// Remove linha do PEDIDO BENEFÍCIO
// -----------------------------------------------
async function removerLinhaPedido(idx) {
  if (!await confirmar('Deseja remover esta linha?', { perigo: true, icone: '🗑️', ok: 'Remover' })) return;

  Estado.salvarHistoricoPedido();
  Estado.dadosPedido.splice(idx, 1);
  Estado.dadosPedido.forEach((d, i) => { d._id = i + 1; });

  Estado.marcarAlterado();
  renderizarTabelaPedido();
}

// -----------------------------------------------
// Adiciona linha vazia na BASE
// -----------------------------------------------
function adicionarLinha() {
  if (Estado.colunasBase.length === 0) {
    mostrarNotificacao('Carregue os dados antes de adicionar linhas.', 'aviso');
    return;
  }

  Estado.salvarHistorico();

  // Garante que colunas extras existam antes de criar a linha
  if (typeof _garantirColunasExtras === 'function') _garantirColunasExtras();

  const novaLinha = { _id: Estado.dadosBase.length + 1 };
  Estado.colunasBase.forEach(col => { novaLinha[col] = ''; });

  Estado.dadosBase.push(novaLinha);
  Estado.marcarAlterado();
  renderizarTabelaBase();

  setTimeout(() => {
    const inputs = document.querySelectorAll('#corpo-base .celula-editavel');
    if (inputs.length > 0) inputs[inputs.length - 1].focus();
  }, 50);
}

// -----------------------------------------------
// Adiciona linha vazia ao PEDIDO BENEFÍCIO
// -----------------------------------------------
function adicionarLinhaPedido() {
  if (Estado.colunasPedido.length === 0) {
    mostrarNotificacao('Carregue os dados antes de adicionar linhas.', 'aviso');
    return;
  }

  Estado.salvarHistoricoPedido();

  const novaLinha = { _id: Estado.dadosPedido.length + 1 };
  Estado.colunasPedido.forEach(col => { novaLinha[col] = ''; });

  Estado.dadosPedido.push(novaLinha);
  Estado.marcarAlterado();
  renderizarTabelaPedido();
}

// -----------------------------------------------
// Filtros e busca (BASE)
// -----------------------------------------------
function aplicarFiltros() {
  const termo  = Estado.termoBusca.toLowerCase();
  const gestor = Estado.filtroGestor.toLowerCase();
  const dept   = Estado.filtroDept.toLowerCase();

  Estado.dadosFiltrados = Estado.dadosBase.filter(linha => {
    const buscaOk  = !termo  || Object.values(linha).some(v => String(v).toLowerCase().includes(termo));
    const gestorOk = !gestor || String(linha['GESTOR'] || '').toLowerCase() === gestor;
    const deptOk   = !dept   || String(linha['DEPARTAMENTO'] || '').toLowerCase() === dept;
    return buscaOk && gestorOk && deptOk;
  });
}

function filtrarTabela() {
  Estado.termoBusca   = document.getElementById('campo-busca')?.value || '';
  Estado.filtroGestor = document.getElementById('filtro-gestor')?.value || '';
  Estado.filtroDept   = document.getElementById('filtro-dept')?.value || '';
  renderizarTabelaBase();
}

function preencherFiltros() {
  const seletorGestor = document.getElementById('filtro-gestor');
  const seletorDept   = document.getElementById('filtro-dept');
  if (!seletorGestor || !seletorDept) return;

  const gestores = [...new Set(Estado.dadosBase.map(d => d['GESTOR'] || '').filter(Boolean))].sort();
  seletorGestor.innerHTML = '<option value="">Todos os gestores</option>' +
    gestores.map(g => `<option value="${escaparHtml(g)}">${escaparHtml(g)}</option>`).join('');

  const depts = [...new Set(Estado.dadosBase.map(d => d['DEPARTAMENTO'] || '').filter(Boolean))].sort();
  seletorDept.innerHTML = '<option value="">Todos os departamentos</option>' +
    depts.map(d => `<option value="${escaparHtml(d)}">${escaparHtml(d)}</option>`).join('');
}

// -----------------------------------------------
// Ordenação por coluna (BASE)
// -----------------------------------------------
let ultimaOrdem = { coluna: null, crescente: true };

function ordenarPor(coluna) {
  const crescente = ultimaOrdem.coluna === coluna ? !ultimaOrdem.crescente : true;
  ultimaOrdem = { coluna, crescente };

  Estado.dadosBase.sort((a, b) => {
    const va = String(a[coluna] || '').toLowerCase();
    const vb = String(b[coluna] || '').toLowerCase();
    if (va < vb) return crescente ? -1 : 1;
    if (va > vb) return crescente ?  1 : -1;
    return 0;
  });

  renderizarTabelaBase();
}

// -----------------------------------------------
// Contador de linhas
// -----------------------------------------------
function atualizarContador(qtd) {
  const contador = document.getElementById('contador-linhas');
  if (!contador) return;
  const total = Estado.dadosBase.length;
  contador.textContent = qtd === total
    ? `${total} colaborador${total !== 1 ? 'es' : ''}`
    : `${qtd} de ${total} colaboradores`;
}

// -----------------------------------------------
// Atualiza os inputs das colunas CALCULADAS (I, J, K)
// na linha editada sem re-renderizar a tabela inteira
// -----------------------------------------------
function _atualizarCelulaCalculada(idxLinha) {
  const linha  = Estado.dadosBase[idxLinha];
  if (!linha) return;
  const colunas = Estado.colunasBase;

  // Colunas calculadas por índice fixo (VT total, VR total)
  [IDX_BASE_VT2, IDX_BASE_VR2].forEach(idx => {
    const col = colunas[idx];
    if (!col) return;
    const input = document.querySelector(`input[data-linha="${idxLinha}"][data-coluna="${col}"]`);
    if (input) input.value = linha[col] ?? '';
  });

  // Totais calculados dos grupos de benefício
  [COL_ALIM_TOT, COL_REF_TOT, COL_PREM_TOT].forEach(col => {
    if (!colunas.includes(col)) return;
    const input = document.querySelector(`input[data-linha="${idxLinha}"][data-coluna="${col}"]`);
    if (input) input.value = linha[col] ?? '';
  });
}

// -----------------------------------------------
// Alias público de _norm (definido em calcular.js)
// -----------------------------------------------
function normalizarNome(texto) {
  return typeof normNome === 'function' ? normNome(texto) : String(texto || '').toLowerCase().trim();
}

// -----------------------------------------------
// REDIMENSIONAMENTO DE COLUNAS
// Adiciona handles de drag em todos os <th> da tabela
// -----------------------------------------------
let _resizeAtivo = false;

function _iniciarResizeColunas(idTabela) {
  const tabela = document.getElementById(idTabela);
  if (!tabela) return;

  const ths = tabela.querySelectorAll('thead th');

  ths.forEach((th, i) => {
    // Remove handle antigo se houver
    th.querySelector('.col-resize-handle')?.remove();

    // Não coloca handle na coluna # (índice 0) e na coluna Ações (última)
    if (i === 0 || i === ths.length - 1) return;

    const handle = document.createElement('span');
    handle.className = 'col-resize-handle';
    handle.title = 'Arraste para redimensionar';

    let startX = 0;
    let startW = 0;

    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation(); // impede disparo de ordenação
      _resizeAtivo = true;
      startX = e.pageX;
      startW = th.offsetWidth;
      handle.classList.add('ativo');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(ev) {
        if (!_resizeAtivo) return;
        const novaLargura = Math.max(60, startW + (ev.pageX - startX));
        th.style.minWidth = novaLargura + 'px';
        th.style.width    = novaLargura + 'px';
      }

      function onUp() {
        handle.classList.remove('ativo');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // Mantém flag ativo por 150ms para bloquear o click que dispara após mouseup
        setTimeout(() => { _resizeAtivo = false; }, 150);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    th.appendChild(handle);
  });
}

// -----------------------------------------------
// DETECÇÃO DE DUPLICATAS (nomes e CPFs na BASE)
// -----------------------------------------------
function verificarDuplicatas() {
  const aviso = document.getElementById('aviso-duplicatas');
  if (!aviso) return;

  const dados = Estado.dadosBase;
  if (!dados || dados.length === 0) {
    aviso.classList.add('oculto');
    return;
  }

  const colNome = Estado.colunasBase[IDX_BASE_NOME] || '';

  // Conta nomes repetidos (ignora vazio)
  const nomes = dados.map(l => String(l[colNome] || '').trim().toLowerCase()).filter(Boolean);
  const nomesSet = new Set();
  const nomesDup = new Set();
  nomes.forEach(n => { if (nomesSet.has(n)) nomesDup.add(n); else nomesSet.add(n); });

  // Conta CPFs repetidos (ignora vazio)
  const cpfs = dados.map(l => String(l[COL_CPF] || '').trim()).filter(Boolean);
  const cpfsSet = new Set();
  const cpfsDup = new Set();
  cpfs.forEach(c => { if (cpfsSet.has(c)) cpfsDup.add(c); else cpfsSet.add(c); });

  const qtdNomes = nomesDup.size;
  const qtdCpfs  = cpfsDup.size;

  if (qtdNomes === 0 && qtdCpfs === 0) {
    aviso.classList.add('oculto');
    aviso._detalhesDup = null;
    return;
  }

  const partes = [];
  if (qtdNomes > 0) partes.push(`${qtdNomes} nome${qtdNomes > 1 ? 's' : ''} repetido${qtdNomes > 1 ? 's' : ''}`);
  if (qtdCpfs  > 0) partes.push(`${qtdCpfs} CPF${qtdCpfs  > 1 ? 's' : ''} repetido${qtdCpfs  > 1 ? 's' : ''}`);

  aviso.textContent = '⚠ ' + partes.join(' · ');
  aviso.classList.remove('oculto');

  // Guarda detalhes para exibição no modal
  aviso._detalhesDup = { nomesDup: [...nomesDup], cpfsDup: [...cpfsDup], dados, colNome };
}

// -----------------------------------------------
// Abre modal simples com detalhes das duplicatas
// -----------------------------------------------
function abrirDetalhesDuplicatas() {
  const aviso = document.getElementById('aviso-duplicatas');
  const det   = aviso?._detalhesDup;
  if (!det) return;

  const { nomesDup, cpfsDup, dados, colNome } = det;

  let html = '<div style="padding:20px; max-height:60vh; overflow-y:auto;">';

  if (nomesDup.length > 0) {
    html += `<h3 style="margin-bottom:8px;color:var(--cor-aviso)">👤 Nomes repetidos (${nomesDup.length})</h3>`;
    html += '<ul style="list-style:none;margin-bottom:16px;">';
    nomesDup.forEach(n => {
      const linhas = dados
        .map((l, i) => String(l[colNome] || '').trim().toLowerCase() === n ? i + 1 : null)
        .filter(Boolean);
      html += `<li style="padding:4px 0;border-bottom:1px solid var(--cinza-100)">
        <strong>${escaparHtml(n)}</strong>
        <span style="color:var(--cinza-500);font-size:12px"> — linhas ${linhas.join(', ')}</span>
      </li>`;
    });
    html += '</ul>';
  }

  if (cpfsDup.length > 0) {
    html += `<h3 style="margin-bottom:8px;color:var(--cor-aviso)">🪪 CPFs repetidos (${cpfsDup.length})</h3>`;
    html += '<ul style="list-style:none;">';
    cpfsDup.forEach(c => {
      const linhas = dados
        .map((l, i) => String(l[COL_CPF] || '').trim() === c ? i + 1 : null)
        .filter(Boolean);
      html += `<li style="padding:4px 0;border-bottom:1px solid var(--cinza-100)">
        <strong>${escaparHtml(c)}</strong>
        <span style="color:var(--cinza-500);font-size:12px"> — linhas ${linhas.join(', ')}</span>
      </li>`;
    });
    html += '</ul>';
  }

  html += '</div>';

  // Reutiliza a estrutura de modal genérico
  const modalId = 'modal-duplicatas';
  let modal = document.getElementById(modalId);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-caixa modal-media">
        <div class="modal-cabecalho">
          <h2>⚠ Duplicatas encontradas na BASE</h2>
          <button class="btn-fechar" onclick="fecharModal('${modalId}')">✕</button>
        </div>
        <div class="modal-corpo" id="corpo-modal-duplicatas" style="padding:0;"></div>
      </div>`;
    document.body.appendChild(modal);
  }

  document.getElementById('corpo-modal-duplicatas').innerHTML = html;
  abrirModal(modalId);
}

// ===============================================
// MULTI-SELEÇÃO DE LINHAS
// ===============================================

function toggleSelecionarLinha(id, selecionado) {
  if (selecionado) linhasSelecionadas.add(id);
  else             linhasSelecionadas.delete(id);
  _atualizarBarraSelecionadas();
  // Atualiza visual da linha sem re-renderizar toda a tabela
  const tr = document.getElementById(`linha-${id}`);
  if (tr) tr.classList.toggle('linha-selecionada', selecionado);
  // Atualiza checkbox "selecionar tudo"
  const dados  = Estado.dadosFiltrados || [];
  const todas  = dados.length > 0 && dados.every(l => linhasSelecionadas.has(l._id));
  const header = document.querySelector('#cabecalho-base .th-check input');
  if (header) header.checked = todas;
}

function toggleSelecionarTudo(selecionado) {
  const dados = Estado.dadosFiltrados || [];
  dados.forEach(l => {
    if (selecionado) linhasSelecionadas.add(l._id);
    else             linhasSelecionadas.delete(l._id);
    const tr = document.getElementById(`linha-${l._id}`);
    if (tr) tr.classList.toggle('linha-selecionada', selecionado);
    const cb = tr?.querySelector('.check-linha');
    if (cb) cb.checked = selecionado;
  });
  _atualizarBarraSelecionadas();
}

function _atualizarBarraSelecionadas() {
  const barra  = document.getElementById('barra-selecao');
  const contEl = document.getElementById('selecao-contagem');
  if (!barra || !contEl) return;
  const qtd = linhasSelecionadas.size;
  if (qtd === 0) {
    barra.classList.add('oculto');
  } else {
    contEl.textContent = `${qtd} linha${qtd !== 1 ? 's' : ''} selecionada${qtd !== 1 ? 's' : ''}`;
    barra.classList.remove('oculto');
  }
}

function limparSelecao() {
  linhasSelecionadas.clear();
  _atualizarBarraSelecionadas();
  renderizarTabelaBase();
}

// Exclui todas as linhas selecionadas
async function excluirLinhasSelecionadas() {
  const qtd = linhasSelecionadas.size;
  if (qtd === 0) return;
  if (!await confirmar(`Excluir ${qtd} linha${qtd !== 1 ? 's' : ''} selecionada${qtd !== 1 ? 's' : ''}?`, { perigo: true, icone: '🗑️', ok: `Excluir ${qtd}` })) return;

  Estado.salvarHistorico();
  Estado.dadosBase = Estado.dadosBase.filter(l => !linhasSelecionadas.has(l._id));
  linhasSelecionadas.clear();
  Estado.marcarAlterado();
  recalcularTudo();
  renderizarTabelaBase();
  preencherFiltros();
  _atualizarBarraSelecionadas();
  mostrarNotificacao(`${qtd} linha${qtd !== 1 ? 's' : ''} removida${qtd !== 1 ? 's' : ''}.`, 'sucesso');
}

// Abre o modal para aplicar um valor em todas as linhas selecionadas
function abrirAplicarValorSelecionadas() {
  const colunas = Estado.colunasBase.filter(c =>
    !COLUNAS_READONLY.has(c) && !COLUNAS_OCULTAS.has(c)
  );
  const sel = document.getElementById('aplicar-coluna-sel');
  if (sel) {
    sel.innerHTML = colunas.map(c =>
      `<option value="${escaparHtml(c)}">${escaparHtml(c)}</option>`
    ).join('');
    // Pré-seleciona coluna DIAS se existir
    const dias = colunas.find(c => /^DIAS$/i.test(c));
    if (dias) sel.value = dias;
  }
  const input = document.getElementById('aplicar-valor-input');
  if (input) input.value = '';
  abrirModal('modal-aplicar-valor');
}

// Confirma a aplicação do valor em todas as selecionadas
function confirmarAplicarValor() {
  const coluna = document.getElementById('aplicar-coluna-sel')?.value;
  const valor  = document.getElementById('aplicar-valor-input')?.value?.trim();
  if (!coluna || valor === '') {
    mostrarNotificacao('Preencha a coluna e o valor.', 'aviso');
    return;
  }

  Estado.salvarHistorico();
  let valorFmt = valor;
  if (_eColunaMoeda(coluna)) valorFmt = _formatarMoeda(valor);
  else if (/^CPF$/i.test(coluna)) valorFmt = _formatarCPF(valor);

  if (!Estado._alteracoesAtuaisBase) Estado._alteracoesAtuaisBase = [];
  const nomeColBase = Estado.colunasBase[IDX_BASE_NOME] || Estado.colunasBase[0];
  const hora = new Date().toLocaleTimeString('pt-BR');

  linhasSelecionadas.forEach(id => {
    const idx = Estado.dadosBase.findIndex(l => l._id === id);
    if (idx < 0) return;
    const valorAntigo = Estado.dadosBase[idx][coluna] ?? '';
    Estado.dadosBase[idx][coluna] = valorFmt;
    Estado._alteracoesAtuaisBase.push({
      linha:       idx + 1,
      colaborador: Estado.dadosBase[idx][nomeColBase] || `Linha ${idx + 1}`,
      coluna,
      valorAntigo,
      valorNovo:   valorFmt,
      hora,
    });
  });

  Estado.marcarAlterado();
  recalcularTudo();
  fecharModal('modal-aplicar-valor');
  renderizarTabelaBase();
  mostrarNotificacao(`"${coluna}" = "${valorFmt}" aplicado em ${linhasSelecionadas.size} linha(s).`, 'sucesso');
}

// -----------------------------------------------
// Sanitização contra XSS
// -----------------------------------------------
function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

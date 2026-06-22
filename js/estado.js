/* ================================================
   ESTADO GLOBAL DA APLICAÇÃO
   Dados, histórico de undo/redo para BASE e
   PEDIDO BENEFÍCIO, e persistência em localStorage
   ================================================ */

const Estado = {

  /* --- Dados das abas --- */
  dadosBase:   [],
  dadosPedido: [],

  /* --- Colunas --- */
  colunasBase:   [],
  colunasPedido: [],

  /* --- Log de edições BASE --- */
  logEdicoesBase: [],       // histórico completo de alterações na BASE
  _alteracoesAtuaisBase: [], // buffer da sessão atual (acumulado até o próximo save)

  /* --- Edição do PEDIDO BENEFÍCIO --- */
  snapshotPedidoAntesDaEdicao: null,
  logEdicoesPedido: [],
  _alteracoesAtuaisPedido: [],
  ultimaEdicaoPedido: null,

  /* --- Filtros --- */
  dadosFiltrados: [],
  termoBusca:  '',
  filtroGestor: '',
  filtroDept:  '',

  /* --- Histórico BASE (undo/redo) --- */
  historico:       [],
  historicoFuturo: [],

  /* --- Histórico PEDIDO BENEFÍCIO (undo/redo separado) --- */
  historicoPedido:       [],
  historicoFuturoPedido: [],

  MAX_HISTORICO: 50,

  /* --- Flag de alterações não salvas --- */
  temAlteracoes: false,

  /* --- Configurações de conexão Google Sheets --- */
  config: {
    clientId: '',
    spreadsheetId: '1z01MAGSbdpenI55avlL9t0_OLL6jZlCd9ewdZsy_bXQ',
    abaBase:   'BASE',
    abaPedido: 'PEDIDO BENEFICIO',
  },

  /* --- Estado de conexão Google --- */
  conectado: false,
  token: null,

  // -----------------------------------------------
  // Salva snapshot da BASE antes de alteração (undo)
  // -----------------------------------------------
  salvarHistorico() {
    const snap = {
      dadosBase:   JSON.parse(JSON.stringify(this.dadosBase)),
      colunasBase: [...this.colunasBase],
    };
    this.historico.push(snap);
    if (this.historico.length > this.MAX_HISTORICO) this.historico.shift();
    this.historicoFuturo = [];
    this.atualizarBotoesHistorico();
  },

  // -----------------------------------------------
  // Desfaz última alteração da BASE
  // -----------------------------------------------
  desfazer() {
    if (this.historico.length === 0) return false;

    const atual = {
      dadosBase:   JSON.parse(JSON.stringify(this.dadosBase)),
      colunasBase: [...this.colunasBase],
    };
    this.historicoFuturo.push(atual);

    const ant = this.historico.pop();
    this.dadosBase   = ant.dadosBase;
    this.colunasBase = ant.colunasBase;
    this.temAlteracoes = true;

    this.atualizarBotoesHistorico();
    return true;
  },

  // -----------------------------------------------
  // Refaz última ação desfeita da BASE
  // -----------------------------------------------
  refazer() {
    if (this.historicoFuturo.length === 0) return false;

    const atual = {
      dadosBase:   JSON.parse(JSON.stringify(this.dadosBase)),
      colunasBase: [...this.colunasBase],
    };
    this.historico.push(atual);

    const prox = this.historicoFuturo.pop();
    this.dadosBase   = prox.dadosBase;
    this.colunasBase = prox.colunasBase;
    this.temAlteracoes = true;

    this.atualizarBotoesHistorico();
    return true;
  },

  // -----------------------------------------------
  // Salva snapshot do PEDIDO BENEFÍCIO (undo separado)
  // -----------------------------------------------
  salvarHistoricoPedido() {
    const snap = {
      dadosPedido:   JSON.parse(JSON.stringify(this.dadosPedido)),
      colunasPedido: [...this.colunasPedido],
    };
    this.historicoPedido.push(snap);
    if (this.historicoPedido.length > this.MAX_HISTORICO) this.historicoPedido.shift();
    this.historicoFuturoPedido = [];
    this.atualizarBotoesHistoricoPedido();
  },

  // -----------------------------------------------
  // Desfaz alteração do PEDIDO BENEFÍCIO
  // -----------------------------------------------
  desfazerPedido() {
    if (this.historicoPedido.length === 0) return false;

    const atual = {
      dadosPedido:   JSON.parse(JSON.stringify(this.dadosPedido)),
      colunasPedido: [...this.colunasPedido],
    };
    this.historicoFuturoPedido.push(atual);

    const ant = this.historicoPedido.pop();
    this.dadosPedido   = ant.dadosPedido;
    this.colunasPedido = ant.colunasPedido;
    this.temAlteracoes = true;

    this.atualizarBotoesHistoricoPedido();
    return true;
  },

  // -----------------------------------------------
  // Refaz alteração do PEDIDO BENEFÍCIO
  // -----------------------------------------------
  refazerPedido() {
    if (this.historicoFuturoPedido.length === 0) return false;

    const atual = {
      dadosPedido:   JSON.parse(JSON.stringify(this.dadosPedido)),
      colunasPedido: [...this.colunasPedido],
    };
    this.historicoPedido.push(atual);

    const prox = this.historicoFuturoPedido.pop();
    this.dadosPedido   = prox.dadosPedido;
    this.colunasPedido = prox.colunasPedido;
    this.temAlteracoes = true;

    this.atualizarBotoesHistoricoPedido();
    return true;
  },

  // -----------------------------------------------
  // Atualiza botões undo/redo da BASE
  // -----------------------------------------------
  atualizarBotoesHistorico() {
    const d = document.getElementById('btn-desfazer');
    const r = document.getElementById('btn-refazer');
    if (d) d.disabled = this.historico.length === 0;
    if (r) r.disabled = this.historicoFuturo.length === 0;
  },

  // -----------------------------------------------
  // Atualiza botões undo/redo do PEDIDO BENEFÍCIO
  // -----------------------------------------------
  atualizarBotoesHistoricoPedido() {
    const d = document.getElementById('btn-desfazer-pedido');
    const r = document.getElementById('btn-refazer-pedido');
    if (d) d.disabled = this.historicoPedido.length === 0;
    if (r) r.disabled = this.historicoFuturoPedido.length === 0;
  },

  // -----------------------------------------------
  // Salva toda a sessão no localStorage
  // (BASE + PEDIDO + colunas + config)
  // -----------------------------------------------
  salvarLocal() {
    try {
      const payload = {
        dadosBase:          this.dadosBase,
        colunasBase:        this.colunasBase,
        dadosPedido:        this.dadosPedido,
        colunasPedido:      this.colunasPedido,
        logEdicoesBase:     this.logEdicoesBase,
        logEdicoesPedido:   this.logEdicoesPedido,
        ultimaEdicaoPedido: this.ultimaEdicaoPedido,
        salvadoEm:          new Date().toISOString(),
      };
      localStorage.setItem('flashrh_dados', JSON.stringify(payload));
      this.limparAlteracoes();
      return true;
    } catch (e) {
      console.error('Erro ao salvar localmente:', e);
      return false;
    }
  },

  // -----------------------------------------------
  // Carrega dados do localStorage (se houver)
  // -----------------------------------------------
  carregarLocal() {
    try {
      const raw = localStorage.getItem('flashrh_dados');
      if (!raw) return false;

      const payload = JSON.parse(raw);
      if (payload.dadosBase)          this.dadosBase          = payload.dadosBase;
      if (payload.colunasBase)        this.colunasBase        = payload.colunasBase;
      if (payload.dadosPedido)        this.dadosPedido        = payload.dadosPedido;
      if (payload.colunasPedido)      this.colunasPedido      = payload.colunasPedido;
      if (payload.logEdicoesBase)     this.logEdicoesBase     = payload.logEdicoesBase;
      if (payload.logEdicoesPedido)   this.logEdicoesPedido   = payload.logEdicoesPedido;
      if (payload.ultimaEdicaoPedido) this.ultimaEdicaoPedido = payload.ultimaEdicaoPedido;
      // Timestamp da última sincronização com o Google Sheets
      this._isoUltimoSync = localStorage.getItem('flashrh_sync_iso') || '';
      return payload.salvadoEm || true;
    } catch (e) {
      console.error('Erro ao carregar dados locais:', e);
      return false;
    }
  },

  // -----------------------------------------------
  // Configurações (localStorage separado para config)
  // -----------------------------------------------
  carregarConfig() {
    try {
      const raw = localStorage.getItem('flashrh_config');
      if (raw) this.config = { ...this.config, ...JSON.parse(raw) };
    } catch (e) { /* ignora */ }
  },

  salvarConfig() {
    localStorage.setItem('flashrh_config', JSON.stringify(this.config));
  },

  // -----------------------------------------------
  // Marca que há alterações e atualiza a UI
  // -----------------------------------------------
  marcarAlterado() {
    this.temAlteracoes = true;
    document.getElementById('indicador-alteracoes')?.classList.remove('oculto');
    const btn = document.getElementById('btn-salvar');
    if (btn) btn.disabled = false;
  },

  limparAlteracoes() {
    this.temAlteracoes = false;
    document.getElementById('indicador-alteracoes')?.classList.add('oculto');
    const btn = document.getElementById('btn-salvar');
    if (btn) btn.disabled = true;
  },
};

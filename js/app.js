/* ================================================
   PONTO DE ENTRADA DA APLICAÇÃO
   - Inicialização e restauração de dados
   - Troca de abas e toolbars
   - Auto-save a cada 30 segundos
   - Indicador de último salvamento
   - Modais, notificações, atalhos de teclado
   ================================================ */

let abaAtiva = 'base';
let _timerAutoSave = null;

// -----------------------------------------------
// Inicialização ao carregar a página
// -----------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
  // Autenticação controla quando _iniciarApp() é chamado (via _abrirApp em auth.js)
  inicializarAuth();
});

// Separado para poder ser chamado após o login também
async function _iniciarApp() {
  Estado.carregarConfig();

  const salvadoEm = Estado.carregarLocal();
  if (salvadoEm) {
    if (Estado.dadosBase.length > 0) _garantirColunasExtras();
    recalcularTudo();
    renderizarTabelaBase();
    preencherFiltros();
    atualizarBadgeUltimaEdicao();
    _atualizarIndicadorSalvo();

    const dt = typeof salvadoEm === 'string'
      ? new Date(salvadoEm).toLocaleString('pt-BR') : '';
    mostrarNotificacao(`Dados restaurados da última sessão${dt ? ' (' + dt + ')' : ''}.`, 'info');
  } else {
    mostrarNotificacao('Bem-vindo! Importe uma planilha .xlsx para começar.', 'info');
  }

  Estado.atualizarBotoesHistorico();
  Estado.atualizarBotoesHistoricoPedido();
  _timerAutoSave = setInterval(_autoSave, 30_000);
  document.addEventListener('keydown', _atalhos);
  window.addEventListener('beforeunload', e => {
    if (Estado.temAlteracoes) {
      e.preventDefault();
      e.returnValue = 'Você tem alterações não salvas. Deseja sair?';
    }
  });

  // Sincroniza BASE com Google Sheets (em background, não bloqueia a UI)
  if (Api.configurado) _sincronizarBaseNaAbertura();
}

// -----------------------------------------------
// SYNC — verifica se o Sheets tem uma versão mais nova
// e carrega automaticamente sem precisar de botão
// -----------------------------------------------
async function _sincronizarBaseNaAbertura() {
  _atualizarIndicadorSync('verificando');

  let remoto = null;
  try {
    remoto = await Api.carregarBase();
  } catch { /* rede indisponível */ }

  // null = API inacessível (erro de rede / CORS / script não implantado)
  if (remoto === null) {
    _atualizarIndicadorSync('offline');
    return;
  }

  // API respondeu mas aba PAINEL BASE ainda sem dados (primeira vez)
  if (!remoto.iso || !remoto.dadosBase || remoto.dadosBase === '[]') {
    _atualizarIndicadorSync('ok', 'Aguardando primeiro sync', '');
    return;
  }

  const isoLocal  = Estado._isoUltimoSync || '';
  const isoRemoto = remoto.iso;

  if (!isoLocal || new Date(isoRemoto) > new Date(isoLocal)) {
    _carregarBaseDoSheets(remoto);
  } else {
    _atualizarIndicadorSync('ok', remoto.timestamp, remoto.usuario);
  }
}

// Aplica os dados vindos do Sheets na tabela
function _carregarBaseDoSheets(remoto) {
  try {
    const colunas = JSON.parse(remoto.colunasBase);
    const dados   = JSON.parse(remoto.dadosBase);

    if (!Array.isArray(colunas) || !Array.isArray(dados)) throw new Error('Formato inválido');

    Estado.colunasBase = colunas;
    Estado.dadosBase   = dados;
    Estado._isoUltimoSync = remoto.iso;
    _garantirColunasExtras();
    recalcularTudo();
    renderizarTabelaBase();
    preencherFiltros();
    atualizarBadgeUltimaEdicao();

    // Salva localmente para fallback offline
    Estado.salvarLocal();
    localStorage.setItem('flashrh_sync_iso', remoto.iso);

    _atualizarIndicadorSync('ok', remoto.timestamp, remoto.usuario);
    _animarTabelaSync();
    mostrarNotificacao(`☁️ Tabela atualizada — salva por ${remoto.usuario} em ${remoto.timestamp}`, 'sucesso');
  } catch (err) {
    _atualizarIndicadorSync('offline');
  }
}

// Anima a tabela com um flash suave ao receber dados novos
function _animarTabelaSync() {
  const tabela = document.getElementById('tabela-base');
  if (!tabela) return;
  tabela.classList.add('tabela-sync-flash');
  setTimeout(() => tabela.classList.remove('tabela-sync-flash'), 1200);
}

// Atualiza o indicador visual de sincronização no cabeçalho
function _atualizarIndicadorSync(estado, timestamp, usuario) {
  const el = document.getElementById('indicador-sync');
  if (!el) return;

  el.classList.remove('oculto');
  switch (estado) {
    case 'verificando':
      el.innerHTML = `<span class="sync-icone sync-girando">⟳</span> Verificando...`;
      el.className = 'indicador-sync sync-verificando';
      break;
    case 'ok':
      el.innerHTML = `<span class="sync-icone">☁️</span> Sync ${timestamp || ''}${usuario ? ' · ' + usuario : ''}`;
      el.className = 'indicador-sync sync-ok';
      break;
    case 'salvando':
      el.innerHTML = `<span class="sync-icone sync-girando">⟳</span> Enviando para Sheets...`;
      el.className = 'indicador-sync sync-verificando';
      break;
    case 'offline':
      el.innerHTML = `<span class="sync-icone">⚠️</span> Sheets offline`;
      el.className = 'indicador-sync sync-offline';
      break;
  }
}

// -----------------------------------------------
// AUTO-SAVE — dispara a cada 30s se houver mudanças
// -----------------------------------------------
function _autoSave() {
  if (!Estado.temAlteracoes) return;

  const indicador = document.getElementById('indicador-salvando');
  if (indicador) {
    indicador.textContent = '⟳ Salvando...';
    indicador.classList.remove('oculto');
    indicador.classList.add('salvando');
  }

  _commitarLogBase();
  const ok = Estado.salvarLocal();

  if (ok) {
    document.querySelectorAll('.linha-modificada').forEach(tr =>
      tr.classList.remove('linha-modificada')
    );
    _atualizarIndicadorSalvo();
    mostrarNotificacao('💾 Auto-salvo com sucesso.', 'sucesso');
  } else if (indicador) {
    indicador.textContent = '⚠ Erro ao salvar';
    indicador.classList.remove('salvando');
  }
}

// -----------------------------------------------
// Atualiza o indicador de último salvamento no cabeçalho
// -----------------------------------------------
function _atualizarIndicadorSalvo() {
  const indicador = document.getElementById('indicador-salvando');
  if (!indicador) return;

  const raw = localStorage.getItem('flashrh_dados');
  if (!raw) {
    indicador.classList.add('oculto');
    return;
  }

  try {
    const payload = JSON.parse(raw);
    const dt = payload.salvadoEm
      ? new Date(payload.salvadoEm).toLocaleString('pt-BR')
      : null;

    indicador.classList.remove('salvando', 'oculto');
    indicador.textContent = dt ? `✅ Salvo às ${dt}` : '✅ Salvo';
  } catch (_) {
    indicador.classList.add('oculto');
  }
}

// -----------------------------------------------
// Atalhos de teclado globais
// -----------------------------------------------
function _atalhos(e) {
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); desfazer(); return; }
  if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); refazer(); return; }
  if (ctrl && e.key === 's') { e.preventDefault(); salvarDados(); return; }
  if (e.key === 'Escape') fecharTodosModais();
}

// -----------------------------------------------
// Troca de aba e exibe toolbar correta
// -----------------------------------------------
function trocarAba(qual) {
  abaAtiva = qual;

  document.getElementById('painel-base').classList.toggle('painel-ativo',   qual === 'base');
  document.getElementById('painel-pedido').classList.toggle('painel-ativo', qual === 'pedido');
  document.getElementById('aba-base').classList.toggle('aba-ativa',   qual === 'base');
  document.getElementById('aba-pedido').classList.toggle('aba-ativa', qual === 'pedido');

  const tbBase   = document.getElementById('toolbar-base');
  const tbPedViz = document.getElementById('toolbar-pedido-visualizacao');
  const tbPedEd  = document.getElementById('toolbar-pedido-edicao'); // pode não existir

  if (qual === 'base') {
    tbBase.classList.remove('oculto');
    tbPedViz.classList.add('oculto');
    if (tbPedEd) tbPedEd.classList.add('oculto');
  } else {
    tbBase.classList.add('oculto');

    const emEdicao = typeof pedidoEmEdicao !== 'undefined' && pedidoEmEdicao;

    if (emEdicao) {
      // Mantém o toolbar de edição e não regenera dados
      if (tbPedViz) tbPedViz.classList.add('oculto');
      if (tbPedEd)  tbPedEd.classList.remove('oculto');
    } else {
      // Preview: recalcula PEDIDO a partir da BASE e exibe
      if (tbPedViz) tbPedViz.classList.remove('oculto');
      if (tbPedEd)  tbPedEd.classList.add('oculto');

      // Garante que o painel PEDIDO está visível (remove oculto se necessário)
      document.getElementById('painel-pedido')?.classList.remove('oculto');

      recalcularPedidoBeneficio();
      renderizarTabelaPedido();
      atualizarBadgeUltimaEdicao();
    }
  }
}

// -----------------------------------------------
// Desfazer / Refazer (age na aba ativa)
// -----------------------------------------------
function desfazer() {
  if (abaAtiva === 'base') {
    if (Estado.desfazer()) {
      recalcularTudo();
      renderizarTabelaBase();
      preencherFiltros();
      mostrarNotificacao('Ação desfeita (BASE).', 'info');
    }
  } else {
    if (Estado.desfazerPedido()) {
      renderizarTabelaPedido();
      mostrarNotificacao('Ação desfeita (PEDIDO BENEFÍCIO).', 'info');
    }
  }
}

function refazer() {
  if (abaAtiva === 'base') {
    if (Estado.refazer()) {
      recalcularTudo();
      renderizarTabelaBase();
      preencherFiltros();
      mostrarNotificacao('Ação refeita (BASE).', 'info');
    }
  } else {
    if (Estado.refazerPedido()) {
      renderizarTabelaPedido();
      mostrarNotificacao('Ação refeita (PEDIDO BENEFÍCIO).', 'info');
    }
  }
}

// -----------------------------------------------
// Wrappers para undo/redo do PEDIDO (chamados pelos botões)
// -----------------------------------------------
function desfazerPedido() {
  if (Estado.desfazerPedido()) {
    renderizarTabelaPedido();
    mostrarNotificacao('Ação desfeita (PEDIDO BENEFÍCIO).', 'info');
  }
}
function refazerPedido() {
  if (Estado.refazerPedido()) {
    renderizarTabelaPedido();
    mostrarNotificacao('Ação refeita (PEDIDO BENEFÍCIO).', 'info');
  }
}

// -----------------------------------------------
// Registra sessão de edições BASE no log e limpa buffer
// Se API configurada, cada alteração também vai para o Google Sheets
// -----------------------------------------------
function _commitarLogBase() {
  if (!Estado._alteracoesAtuaisBase || Estado._alteracoesAtuaisBase.length === 0) return;

  const agora = new Date();
  Estado.logEdicoesBase.push({
    dataHora:          agora.toISOString(),
    dataHoraFormatada: agora.toLocaleString('pt-BR'),
    alteracoes:        [...Estado._alteracoesAtuaisBase],
  });

  // Envia cada alteração para o Google Sheets (log compartilhado)
  if (Api.configurado) {
    const usuario = Auth.sessao?.nome || Auth.sessao?.login || 'Desconhecido';
    Estado._alteracoesAtuaisBase.forEach(a => {
      Api.addLog({
        usuario,
        colaborador: a.colaborador || '',
        coluna:      a.coluna      || '',
        valorAntigo: a.valorAntigo ?? '',
        valorNovo:   a.valorNovo   ?? '',
      });
    });
  }

  Estado._alteracoesAtuaisBase = [];
}

// -----------------------------------------------
// EXCLUIR BASE — apaga todos os dados importados
// -----------------------------------------------
async function excluirBase() {
  if (!Estado.dadosBase || Estado.dadosBase.length === 0) {
    mostrarNotificacao('Nenhum dado para excluir.', 'info');
    return;
  }
  if (!await confirmar('Tem certeza que deseja excluir toda a BASE? Esta ação não pode ser desfeita após salvar.', { perigo: true, icone: '🗑️', ok: 'Excluir tudo' })) return;

  Estado.salvarHistorico();
  Estado.dadosBase   = [];
  Estado.colunasBase = [];
  Estado.dadosPedido = [];
  Estado.colunasPedido = [];
  Estado.dadosFiltrados = [];
  Estado.marcarAlterado();

  renderizarTabelaBase();
  preencherFiltros();
  mostrarNotificacao('BASE excluída. Importe uma nova planilha para começar.', 'info');
}

// -----------------------------------------------
// SALVAR — imediato (manual ou Ctrl+S)
// -----------------------------------------------
async function salvarDados() {
  _commitarLogBase();

  const ok = Estado.salvarLocal();
  if (ok) {
    document.querySelectorAll('.linha-modificada').forEach(tr =>
      tr.classList.remove('linha-modificada')
    );
    _atualizarIndicadorSalvo();
    mostrarNotificacao('✅ Dados salvos com sucesso!', 'sucesso');

    // Envia para o Google Sheets se configurado
    if (Api.configurado && Estado.dadosBase.length > 0) {
      _atualizarIndicadorSync('salvando');
      const usuario  = Auth.sessao?.nome || Auth.sessao?.login || 'Usuário';
      const isoAgora = new Date().toISOString();
      const subiu    = await Api.salvarBase(Estado.colunasBase, Estado.dadosBase, usuario);
      if (subiu) {
        Estado._isoUltimoSync = isoAgora;
        localStorage.setItem('flashrh_sync_iso', isoAgora);
        const ts = new Date().toLocaleString('pt-BR');
        _atualizarIndicadorSync('ok', ts, usuario);
      } else {
        _atualizarIndicadorSync('offline');
        mostrarNotificacao('⚠️ Salvo localmente, mas falhou ao enviar ao Sheets.', 'aviso');
      }
    }

    if (Estado.conectado && Estado.token) salvarNoSheets();
  } else {
    mostrarNotificacao('Erro ao salvar. Armazenamento pode estar cheio.', 'erro');
  }
}

// -----------------------------------------------
// Log de edições do PEDIDO
// -----------------------------------------------
function abrirLogEdicoes() {
  const container = document.getElementById('conteudo-log');
  const logs = Estado.logEdicoesPedido || [];

  if (logs.length === 0) {
    container.innerHTML = `
      <div class="log-vazio">
        <div class="log-vazio-icone">📋</div>
        <p>Nenhuma edição registrada ainda.</p>
        <p>As edições do PEDIDO BENEFÍCIO aparecerão aqui.</p>
      </div>`;
  } else {
    const sessoes = [...logs].reverse();
    container.innerHTML = sessoes.map((sessao, idx) => {
      const id  = `sessao-${idx}`;
      const qtd = sessao.alteracoes.length;
      const itens = sessao.alteracoes.map(a => `
        <div class="log-item">
          <span class="log-item-hora">${a.hora}</span>
          <span class="log-item-colaborador" title="${escaparHtml(a.colaborador)}">${escaparHtml(a.colaborador)}</span>
          <span class="log-item-coluna">${escaparHtml(a.coluna)}</span>
          <span class="log-item-valores">
            <span class="log-valor-antigo">${escaparHtml(String(a.valorAntigo || '—'))}</span>
            <span class="log-seta-valor">→</span>
            <span class="log-valor-novo">${escaparHtml(String(a.valorNovo || '—'))}</span>
          </span>
        </div>`).join('');

      return `
        <div class="log-sessao">
          <div class="log-sessao-cabecalho" onclick="toggleSessaoLog('${id}')">
            <div class="log-sessao-titulo">
              📝 ${sessao.dataHoraFormatada}
              <span class="log-sessao-badge">${qtd} alteraç${qtd !== 1 ? 'ões' : 'ão'}</span>
            </div>
            <span class="log-sessao-seta" id="seta-${id}">▼</span>
          </div>
          <div class="log-alteracoes" id="${id}">
            <div class="log-cabecalho-colunas">
              <span>Hora</span><span>Colaborador</span><span>Campo</span><span>Alteração</span>
            </div>
            ${itens}
          </div>
        </div>`;
    }).join('');

    toggleSessaoLog('sessao-0');
  }

  abrirModal('modal-log-edicoes');
}

// -----------------------------------------------
// Log de alterações da BASE
// -----------------------------------------------
function abrirLogBase() {
  const container = document.getElementById('conteudo-log-base');
  const logs = Estado.logEdicoesBase || [];

  if (logs.length === 0) {
    container.innerHTML = `
      <div class="log-vazio">
        <div class="log-vazio-icone">📋</div>
        <p>Nenhuma alteração registrada ainda.</p>
        <p>Edite células da BASE e salve para ver o histórico aqui.</p>
      </div>`;
  } else {
    const sessoes = [...logs].reverse();
    container.innerHTML = sessoes.map((sessao, idx) => {
      const id  = `sessao-base-${idx}`;
      const qtd = sessao.alteracoes.length;
      const itens = sessao.alteracoes.map(a => `
        <div class="log-item">
          <span class="log-item-hora">${a.hora}</span>
          <span class="log-item-colaborador" title="${escaparHtml(a.colaborador)}">${escaparHtml(a.colaborador)}</span>
          <span class="log-item-coluna">${escaparHtml(a.coluna)}</span>
          <span class="log-item-valores">
            <span class="log-valor-antigo">${escaparHtml(String(a.valorAntigo || '—'))}</span>
            <span class="log-seta-valor">→</span>
            <span class="log-valor-novo">${escaparHtml(String(a.valorNovo || '—'))}</span>
          </span>
        </div>`).join('');

      return `
        <div class="log-sessao">
          <div class="log-sessao-cabecalho" onclick="toggleSessaoLog('${id}')">
            <div class="log-sessao-titulo">
              📝 ${sessao.dataHoraFormatada}
              <span class="log-sessao-badge">${qtd} alteraç${qtd !== 1 ? 'ões' : 'ão'}</span>
            </div>
            <span class="log-sessao-seta" id="seta-${id}">▼</span>
          </div>
          <div class="log-alteracoes" id="${id}">
            <div class="log-cabecalho-colunas">
              <span>Hora</span><span>Colaborador</span><span>Campo</span><span>Alteração</span>
            </div>
            ${itens}
          </div>
        </div>`;
    }).join('');

    toggleSessaoLog('sessao-base-0');
  }

  abrirModal('modal-log-base');
}

function toggleSessaoLog(id) {
  const p = document.getElementById(id);
  const s = document.getElementById(`seta-${id}`);
  if (!p || !s) return;
  const aberto = p.classList.toggle('aberto');
  s.classList.toggle('aberto', aberto);
}

// -----------------------------------------------
// MODAIS
// -----------------------------------------------
function abrirModal(id) {
  document.getElementById(id)?.classList.remove('oculto');
  document.getElementById('overlay')?.classList.remove('oculto');
  document.body.style.overflow = 'hidden';
}

function fecharModal(id) {
  document.getElementById(id || 'modal-config')?.classList.add('oculto');
  if (!document.querySelector('.modal:not(.oculto)')) {
    document.getElementById('overlay')?.classList.add('oculto');
    document.body.style.overflow = '';
  }
}

function fecharTodosModais() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('oculto'));
  document.getElementById('overlay')?.classList.add('oculto');
  document.body.style.overflow = '';
}

// -----------------------------------------------
// NOTIFICAÇÕES
// -----------------------------------------------
// CONFIRMAÇÃO CUSTOMIZADA — substitui o confirm() nativo
// Uso: await confirmar('Mensagem', { perigo: true, icone: '🗑️', ok: 'Excluir' })
// -----------------------------------------------
function confirmar(msg, { perigo = false, icone = '⚠️', ok = 'Confirmar', cancelar = 'Cancelar' } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-confirmar');
    const caixa   = overlay?.querySelector('.modal-confirmar-caixa');
    const elMsg   = document.getElementById('modal-confirmar-msg');
    const elIcone = document.getElementById('modal-confirmar-icone');
    const btnOk   = document.getElementById('modal-confirmar-ok');
    const btnCan  = document.getElementById('modal-confirmar-cancelar');
    if (!overlay) { resolve(window.confirm(msg)); return; } // fallback

    elMsg.textContent   = msg;
    elIcone.textContent = icone;
    btnOk.textContent   = ok;
    btnCan.textContent  = cancelar;
    caixa.classList.toggle('confirmar-perigo', perigo);
    overlay.classList.remove('oculto');

    const concluir = (resultado) => {
      overlay.classList.add('oculto');
      btnOk.removeEventListener('click', aoOk);
      btnCan.removeEventListener('click', aoCancelar);
      overlay.removeEventListener('click', aoFundo);
      resolve(resultado);
    };

    const aoOk       = () => concluir(true);
    const aoCancelar = () => concluir(false);
    const aoFundo    = (e) => { if (e.target === overlay) concluir(false); };

    btnOk.addEventListener('click', aoOk);
    btnCan.addEventListener('click', aoCancelar);
    overlay.addEventListener('click', aoFundo);
    btnOk.focus();
  });
}

// -----------------------------------------------
let _timerNotif = null;
function mostrarNotificacao(msg, tipo = 'info') {
  const area = document.getElementById('area-notificacao');
  const box  = document.getElementById('notificacao');
  if (!area || !box) return;

  box.className   = `notificacao notificacao-${tipo}`;
  box.textContent = msg;
  area.classList.remove('oculto');

  if (_timerNotif) clearTimeout(_timerNotif);
  _timerNotif = setTimeout(() => area.classList.add('oculto'), 4500);
}

// -----------------------------------------------
// INTEGRAÇÃO GOOGLE SHEETS — configuração da API
// -----------------------------------------------
function salvarApiUrl() {
  const url = document.getElementById('input-api-url')?.value.trim();
  if (!url) { mostrarNotificacao('Cole a URL do Web App primeiro.', 'aviso'); return; }
  Api.configurarUrl(url);
  document.getElementById('painel-url-api')?.classList.add('oculto');
  _atualizarPainelConexao();
  mostrarNotificacao('✅ URL salva! Faça logout e entre novamente para ativar o Google Sheets.', 'sucesso');
}

async function limparApiUrl() {
  if (!await confirmar('Desconectar do Google Sheets? O login voltará a usar usuários locais.', { icone: '🔌', ok: 'Desconectar' })) return;
  Api.configurarUrl('');
  _atualizarPainelConexao();
  mostrarNotificacao('Desconectado do Google Sheets.', 'info');
}

// -----------------------------------------------
// LOG COMPARTILHADO — busca do Google Sheets e exibe
// -----------------------------------------------
async function abrirLogSheets() {
  if (!Api.configurado) {
    mostrarNotificacao('Configure a URL do Google Sheets primeiro.', 'aviso');
    return;
  }

  const container = document.getElementById('conteudo-log-sheets');
  if (container) container.innerHTML = '<p style="text-align:center;padding:20px;color:var(--cinza-400);">Carregando...</p>';
  abrirModal('modal-log-sheets');

  const linhas = await Api.getLog(300);

  if (!container) return;

  if (!linhas.length) {
    container.innerHTML = '<p style="text-align:center;padding:20px;color:var(--cinza-400);">Nenhuma entrada no log ainda.</p>';
    return;
  }

  container.innerHTML = `
    <table style="width:100%; border-collapse:collapse; font-size:12px;">
      <thead>
        <tr style="background:var(--bg-elevado); position:sticky; top:0;">
          <th style="padding:8px; text-align:left; color:var(--cinza-600); border-bottom:1px solid var(--cinza-200);">Data/Hora</th>
          <th style="padding:8px; text-align:left; color:var(--cinza-600); border-bottom:1px solid var(--cinza-200);">Usuário</th>
          <th style="padding:8px; text-align:left; color:var(--cinza-600); border-bottom:1px solid var(--cinza-200);">Colaborador</th>
          <th style="padding:8px; text-align:left; color:var(--cinza-600); border-bottom:1px solid var(--cinza-200);">Campo</th>
          <th style="padding:8px; text-align:left; color:var(--cinza-600); border-bottom:1px solid var(--cinza-200);">De</th>
          <th style="padding:8px; text-align:left; color:var(--cinza-600); border-bottom:1px solid var(--cinza-200);">Para</th>
        </tr>
      </thead>
      <tbody>
        ${linhas.map((l, i) => `
          <tr style="background:${i % 2 === 0 ? 'transparent' : 'var(--bg-elevado)'}">
            <td style="padding:6px 8px; color:var(--cinza-500); white-space:nowrap;">${escaparHtml(String(l['DATA_HORA'] || ''))}</td>
            <td style="padding:6px 8px; font-weight:600; color:var(--cor-primaria);">${escaparHtml(String(l['USUARIO'] || ''))}</td>
            <td style="padding:6px 8px;">${escaparHtml(String(l['COLABORADOR'] || ''))}</td>
            <td style="padding:6px 8px; color:var(--cinza-600);">${escaparHtml(String(l['COLUNA'] || ''))}</td>
            <td style="padding:6px 8px; color:var(--cor-erro); text-decoration:line-through;">${escaparHtml(String(l['VALOR_ANTIGO'] || '—'))}</td>
            <td style="padding:6px 8px; color:var(--cor-sucesso); font-weight:600;">${escaparHtml(String(l['VALOR_NOVO'] || '—'))}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// -----------------------------------------------
// SINCRONIZAÇÃO MANUAL com Google Sheets
// -----------------------------------------------
async function sincronizarManual() {
  if (!Api.configurado) {
    mostrarNotificacao('Google Sheets não configurado. Configure em ⚙️ Configurações.', 'aviso');
    return;
  }
  if (!Estado.dadosBase.length) {
    mostrarNotificacao('Nenhum dado na BASE para sincronizar.', 'aviso');
    return;
  }

  const btn = document.getElementById('btn-sincronizar');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Sincronizando...'; }

  _commitarLogBase();
  Estado.salvarLocal();

  const usuario = Auth.sessao?.nome || Auth.sessao?.login || 'Usuário';
  _atualizarIndicadorSync('salvando');

  const ok = await Api.salvarBase(Estado.colunasBase, Estado.dadosBase, usuario);

  if (btn) { btn.disabled = false; btn.textContent = '☁️ Sincronizar'; }

  if (ok) {
    const ts = new Date().toLocaleString('pt-BR');
    Estado._isoUltimoSync = new Date().toISOString();
    localStorage.setItem('flashrh_sync_iso', Estado._isoUltimoSync);
    _atualizarIndicadorSync('ok', ts, usuario);
    mostrarNotificacao('☁️ BASE sincronizada com o Google Sheets!', 'sucesso');
  } else {
    _atualizarIndicadorSync('offline');
    mostrarNotificacao('Falha ao sincronizar. Verifique a conexão com o Sheets.', 'erro');
  }
}

// -----------------------------------------------
// TOGGLE DARK / LIGHT MODE
// -----------------------------------------------
function toggleTema() {
  // Bloqueia transitions para evitar lentidão ao redesenhar 100+ linhas
  document.body.classList.add('tema-trocando');

  const claro = document.body.classList.toggle('tema-claro');
  localStorage.setItem('flashrh_tema', claro ? 'claro' : 'escuro');
  _sincronizarIconeTema();

  // Remove o bloqueio depois que o browser aplicou as novas cores
  requestAnimationFrame(() => {
    requestAnimationFrame(() => document.body.classList.remove('tema-trocando'));
  });
}

function _sincronizarIconeTema() {
  const btn   = document.getElementById('btn-toggle-tema');
  const claro = document.body.classList.contains('tema-claro');
  // Em modo claro → mostra lua (para voltar ao escuro)
  // Em modo escuro → mostra sol (para ir ao claro)
  if (btn) btn.textContent = claro ? '🌙' : '☀️';
}

function _aplicarTema() {
  const salvo = localStorage.getItem('flashrh_tema');
  if (salvo === 'claro') document.body.classList.add('tema-claro');
  _sincronizarIconeTema();
}

// Aplica tema salvo assim que o DOM carrega
document.addEventListener('DOMContentLoaded', _aplicarTema);

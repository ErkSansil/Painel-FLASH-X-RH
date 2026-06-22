/* ================================================
   INTEGRAÇÃO COM GOOGLE SHEETS API
   Autenticação OAuth2, leitura e escrita de dados
   ================================================ */

// Escopos necessários: leitura e escrita em planilhas
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

// Instância do cliente de token OAuth
let clienteOAuth = null;

// -----------------------------------------------
// Abre o modal de configuração ao clicar "Conectar"
// -----------------------------------------------
function conectarGoogle() {
  // Preenche os campos com o que já está salvo
  document.getElementById('input-client-id').value     = Estado.config.clientId;
  document.getElementById('input-spreadsheet-id').value = Estado.config.spreadsheetId;
  document.getElementById('input-aba-base').value       = Estado.config.abaBase;
  document.getElementById('input-aba-pedido').value     = Estado.config.abaPedido;

  abrirModal('modal-config');
}

// -----------------------------------------------
// Salva as configurações e inicia a autenticação
// -----------------------------------------------
function salvarConfigEConectar() {
  const clientId       = document.getElementById('input-client-id').value.trim();
  const spreadsheetId  = document.getElementById('input-spreadsheet-id').value.trim();
  const abaBase        = document.getElementById('input-aba-base').value.trim();
  const abaPedido      = document.getElementById('input-aba-pedido').value.trim();

  if (!clientId) {
    mostrarNotificacao('Informe o Client ID do Google.', 'erro');
    return;
  }
  if (!spreadsheetId) {
    mostrarNotificacao('Informe o ID da planilha.', 'erro');
    return;
  }

  // Atualiza e persiste as configurações
  Estado.config = { clientId, spreadsheetId, abaBase, abaPedido };
  Estado.salvarConfig();

  fecharModal();
  iniciarAutenticacao(clientId);
}

// -----------------------------------------------
// Inicializa o cliente OAuth2 do Google (GSI)
// -----------------------------------------------
function iniciarAutenticacao(clientId) {
  atualizarStatusConexao('carregando', 'Autenticando...');

  // Inicializa o token client com OAuth2 popup
  clienteOAuth = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: aoReceberToken,
  });

  // Solicita o token de acesso
  clienteOAuth.requestAccessToken();
}

// -----------------------------------------------
// Callback após autenticação bem-sucedida
// -----------------------------------------------
function aoReceberToken(resposta) {
  if (resposta.error) {
    console.error('Erro de autenticação:', resposta.error);
    atualizarStatusConexao('desconectado', 'Desconectado');
    mostrarNotificacao('Falha na autenticação com o Google. Verifique o Client ID.', 'erro');
    return;
  }

  // Guarda o token no estado
  Estado.token    = resposta.access_token;
  Estado.conectado = true;

  atualizarStatusConexao('conectado', 'Conectado');
  mostrarNotificacao('Conectado ao Google Sheets!', 'sucesso');

  // Habilita o botão salvar (se houver alterações)
  if (Estado.temAlteracoes) {
    document.getElementById('btn-salvar').disabled = false;
  }

  // Carrega os dados da planilha automaticamente
  carregarDadosSheets();
}

// -----------------------------------------------
// Lê a aba BASE e a aba PEDIDO BENEFÍCIO da planilha
// -----------------------------------------------
async function carregarDadosSheets() {
  if (!Estado.conectado || !Estado.token) return;

  atualizarStatusConexao('carregando', 'Carregando dados...');

  try {
    const { spreadsheetId, abaBase, abaPedido } = Estado.config;

    // Busca as duas abas em paralelo para maior performance
    const [respostaBase, respostaPedido] = await Promise.all([
      buscarAba(spreadsheetId, abaBase),
      buscarAba(spreadsheetId, abaPedido),
    ]);

    // Processa aba BASE
    if (respostaBase && respostaBase.length > 0) {
      processarDadosBase(respostaBase);
    }

    // Processa aba PEDIDO BENEFÍCIO
    if (respostaPedido && respostaPedido.length > 0) {
      processarDadosPedido(respostaPedido);
    }

    atualizarStatusConexao('conectado', 'Conectado');
    mostrarNotificacao(`Dados carregados: ${Estado.dadosBase.length} colaboradores.`, 'sucesso');

  } catch (erro) {
    console.error('Erro ao carregar dados:', erro);
    atualizarStatusConexao('conectado', 'Conectado');
    mostrarNotificacao('Erro ao carregar os dados da planilha. Verifique as permissões.', 'erro');
  }
}

// -----------------------------------------------
// Faz requisição REST para ler uma aba do Sheets
// -----------------------------------------------
async function buscarAba(spreadsheetId, nomeAba) {
  const intervalo = encodeURIComponent(`${nomeAba}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${intervalo}`;

  const resposta = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${Estado.token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!resposta.ok) {
    const erro = await resposta.json();
    throw new Error(erro.error?.message || `HTTP ${resposta.status}`);
  }

  const dados = await resposta.json();
  return dados.values || [];
}

// -----------------------------------------------
// Converte os dados da aba BASE (array de arrays)
// para array de objetos usando a primeira linha como cabeçalho
// -----------------------------------------------
function processarDadosBase(valores) {
  if (valores.length < 2) {
    Estado.colunasBase = valores[0] || [];
    Estado.dadosBase   = [];
    renderizarTabelaBase();
    return;
  }

  const cabecalho = valores[0];
  Estado.colunasBase = cabecalho;

  Estado.dadosBase = valores.slice(1).map((linha, idx) => {
    const obj = { _id: idx + 1 };  // ID interno para rastrear a linha
    cabecalho.forEach((col, i) => {
      obj[col] = linha[i] !== undefined ? linha[i] : '';
    });
    return obj;
  });

  Estado.limparAlteracoes();
  renderizarTabelaBase();
  preencherFiltros();
}

// -----------------------------------------------
// Converte os dados do PEDIDO BENEFÍCIO
// -----------------------------------------------
function processarDadosPedido(valores) {
  if (valores.length < 2) {
    Estado.colunasPedido = valores[0] || [];
    Estado.dadosPedido   = [];
    renderizarTabelaPedido();
    return;
  }

  const cabecalho = valores[0];
  Estado.colunasPedido = cabecalho;

  Estado.dadosPedido = valores.slice(1).map((linha, idx) => {
    const obj = { _id: idx + 1 };
    cabecalho.forEach((col, i) => {
      obj[col] = linha[i] !== undefined ? linha[i] : '';
    });
    return obj;
  });

  renderizarTabelaPedido();
}

// -----------------------------------------------
// Salva os dados da aba BASE de volta no Sheets
// Envia tudo como valores puros (sobrescreve o intervalo)
// -----------------------------------------------
async function salvarNoSheets() {
  if (!Estado.conectado || !Estado.token) {
    mostrarNotificacao('Você não está conectado ao Google Sheets.', 'erro');
    return;
  }

  const btnSalvar = document.getElementById('btn-salvar');
  const textoOriginal = btnSalvar.innerHTML;
  btnSalvar.innerHTML = '⏳ Salvando...';
  btnSalvar.disabled = true;

  try {
    const { spreadsheetId, abaBase } = Estado.config;

    // Monta array de arrays (primeira linha = cabeçalho)
    const linhas = [Estado.colunasBase];
    Estado.dadosBase.forEach(linha => {
      linhas.push(Estado.colunasBase.map(col => linha[col] ?? ''));
    });

    const intervalo = encodeURIComponent(abaBase);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${intervalo}?valueInputOption=RAW`;

    const resposta = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${Estado.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: abaBase,
        majorDimension: 'ROWS',
        values: linhas,
      }),
    });

    if (!resposta.ok) {
      const erro = await resposta.json();
      throw new Error(erro.error?.message || `HTTP ${resposta.status}`);
    }

    // Marca linhas como salvas e remove highlight de modificadas
    document.querySelectorAll('.linha-modificada').forEach(tr => {
      tr.classList.remove('linha-modificada');
    });

    Estado.limparAlteracoes();
    mostrarNotificacao(`✅ ${Estado.dadosBase.length} linhas salvas no Google Sheets!`, 'sucesso');

  } catch (erro) {
    console.error('Erro ao salvar:', erro);
    mostrarNotificacao('Erro ao salvar. Verifique as permissões e tente novamente.', 'erro');
    btnSalvar.disabled = false;
  } finally {
    btnSalvar.innerHTML = textoOriginal;
  }
}

// -----------------------------------------------
// Atualiza o badge de status de conexão no cabeçalho
// -----------------------------------------------
function atualizarStatusConexao(estado, texto) {
  const badge = document.getElementById('status-conexao');
  if (!badge) return;

  badge.className = 'badge';

  if (estado === 'conectado') {
    badge.classList.add('badge-conectado');
  } else if (estado === 'carregando') {
    badge.classList.add('badge-carregando');
  } else {
    badge.classList.add('badge-desconectado');
  }

  badge.innerHTML = `<span class="ponto-status"></span>${texto}`;
}

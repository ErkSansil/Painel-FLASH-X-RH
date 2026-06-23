/* ================================================
   AUTENTICAÇÃO E CONTROLE DE ACESSO
   Prioridade: Google Sheets via Api.url (api.js)
   Fallback:   Usuários locais no localStorage
   Níveis: Admin (acesso total) | Visualizador (somente leitura)
   ================================================ */

const Auth = {
  usuarios: [],
  sessao:   null,

  // Carrega dados do localStorage
  carregar() {
    try {
      this.usuarios = JSON.parse(localStorage.getItem('flashrh_usuarios') || '[]');
      this.sessao   = JSON.parse(localStorage.getItem('flashrh_sessao')  || 'null');
    } catch {
      this.usuarios = [];
      this.sessao   = null;
    }
  },

  // Persiste lista de usuários
  salvar() {
    localStorage.setItem('flashrh_usuarios', JSON.stringify(this.usuarios));
  },

  // FNV-1a hash — simples e síncrono (suficiente para uso interno)
  _hash(senha) {
    let h = 0x811c9dc5;
    for (let i = 0; i < senha.length; i++) {
      h ^= senha.charCodeAt(i);
      h  = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  },

  temUsuarios() { return this.usuarios.length > 0; },

  // Dev > Admin > Visualizador
  // Quando API configurada: exige sessão real — sem bypass de "modo configuração"
  isLogado() {
    if (typeof Api !== 'undefined' && Api.configurado) return this.sessao !== null;
    return !this.temUsuarios() || this.sessao !== null;
  },
  isAdmin()  { return !this.temUsuarios() || ['Admin','Dev'].includes(this.sessao?.nivel); },
  isDev()    { return !this.temUsuarios() || this.sessao?.nivel === 'Dev'; },

  // Tenta fazer login — retorna true/false
  login(login, senha) {
    const hash = this._hash(senha.trim());
    const u = this.usuarios.find(
      u => u.login.trim().toLowerCase() === login.trim().toLowerCase() && u.senha === hash
    );
    if (!u) return false;
    this.sessao = { login: u.login, nome: u.nome, nivel: u.nivel };
    localStorage.setItem('flashrh_sessao', JSON.stringify(this.sessao));
    return true;
  },

  logout() {
    this.sessao = null;
    localStorage.removeItem('flashrh_sessao');
  },

  // Adiciona usuário (retorna false se login já existe)
  adicionar(nome, login, senha, nivel) {
    if (!nome || !login || !senha) return false;
    const loginNorm = login.trim().toLowerCase();
    if (this.usuarios.find(u => u.login.toLowerCase() === loginNorm)) return false;
    this.usuarios.push({ nome: nome.trim(), login: login.trim(), senha: this._hash(senha.trim()), nivel });
    this.salvar();
    return true;
  },

  // Remove usuário pelo login
  remover(login) {
    const loginNorm = login.trim().toLowerCase();
    // Não pode remover a si mesmo se for o único admin
    const admins = this.usuarios.filter(u => u.nivel === 'Admin');
    const esteEAdmin = this.usuarios.find(u => u.login.toLowerCase() === loginNorm)?.nivel === 'Admin';
    if (esteEAdmin && admins.length === 1) return false;
    this.usuarios = this.usuarios.filter(u => u.login.toLowerCase() !== loginNorm);
    this.salvar();
    return true;
  },

  // Importa usuários de linhas do xlsx (array de objetos com NOME, LOGIN, SENHA, NIVEL)
  importarLinhas(linhas) {
    let adicionados = 0;
    let atualizados = 0;
    linhas.forEach(r => {
      const nome   = String(r['NOME']  || r['Nome']  || '').trim();
      const login  = String(r['LOGIN'] || r['Login'] || '').trim();
      const senha  = String(r['SENHA'] || r['Senha'] || '').trim();
      const nivel  = String(r['NIVEL'] || r['Nivel'] || r['NÍVEL'] || 'Visualizador').trim();
      if (!nome || !login || !senha) return;
      const nivel2 = ['Dev','Admin'].includes(nivel) ? nivel : 'Visualizador';
      const idx = this.usuarios.findIndex(u => u.login.toLowerCase() === login.toLowerCase());
      const obj = { nome, login, senha: this._hash(senha), nivel: nivel2 };
      if (idx >= 0) { this.usuarios[idx] = obj; atualizados++; }
      else          { this.usuarios.push(obj);   adicionados++; }
    });
    this.salvar();
    return { adicionados, atualizados };
  },
};

// -----------------------------------------------
// Inicializa auth na carga da página
// -----------------------------------------------
function inicializarAuth() {
  Auth.carregar();

  if (Api.configurado) {
    // Com API ativa: sessão só vale dentro da mesma aba (sessionStorage).
    // Nova aba ou F5 = tela de login sempre, independente do localStorage.
    const validadaNestaAba = sessionStorage.getItem('flashrh_autenticado') === '1';

    if (!validadaNestaAba) {
      // Limpa sessão antiga do localStorage para não bypassar o login
      Auth.sessao = null;
      localStorage.removeItem('flashrh_sessao');
    }

    if (Auth.sessao !== null) {
      _abrirApp();
    } else {
      _mostrarTelaLogin();
    }
    return;
  }

  // Sem API: modo local
  if (!Auth.temUsuarios()) {
    _mostrarTelaLogin();
    return;
  }

  if (Auth.isLogado()) {
    _abrirApp();
  } else {
    _mostrarTelaLogin();
  }
}


// -----------------------------------------------
// Tenta fazer login (chamado pelo formulário)
// Se API configurada → valida no Google Sheets
// Fallback → localStorage
// -----------------------------------------------
async function tentarLogin(evento) {
  evento?.preventDefault();
  const login = document.getElementById('login-input')?.value.trim() || '';
  const senha = document.getElementById('senha-input')?.value.trim() || '';
  const erro  = document.getElementById('login-erro');
  const btn   = document.getElementById('btn-entrar');

  if (!login || !senha) return;

  // Indicador de carregamento
  if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }

  let sucesso = false;

  if (Api.configurado) {
    // Tenta via Google Sheets — senha em texto puro (banco de dados na planilha)
    const res = await Api.login(login, senha);

    if (res && res.ok) {
      // Salva sessão localmente com dados vindos da API
      // _senhaAtual fica só em memória (nunca gravado em disco)
      Auth._senhaAtual = senha;
      Auth.sessao = { login: res.login, nome: res.nome, nivel: res.nivel };
      localStorage.setItem('flashrh_sessao', JSON.stringify(Auth.sessao));
      sucesso = true;
    } else if (res === null) {
      // API offline → tenta fallback local
      sucesso = Auth.login(login, senha);
      if (sucesso) mostrarNotificacao('⚠️ API offline — login local usado.', 'aviso');
    }
  } else {
    sucesso = Auth.login(login, senha);
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }

  if (sucesso) {
    sessionStorage.setItem('flashrh_autenticado', '1'); // válido só nesta aba
    erro?.classList.add('oculto');
    _abrirApp();
  } else {
    erro?.classList.remove('oculto');
    document.getElementById('senha-input').value = '';
    document.getElementById('senha-input').focus();
  }
}

// -----------------------------------------------
// Olho de senha — formulário de novo usuário
// -----------------------------------------------
function toggleNuSenha(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const visivel = input.type === 'text';
  input.type = visivel ? 'password' : 'text';
  btn.classList.toggle('nu-olho-ativo', !visivel);
}

// -----------------------------------------------
// Olho de senha — alterna visibilidade
// -----------------------------------------------
function toggleSenhaVisivel() {
  const input  = document.getElementById('senha-input');
  const aberto = document.getElementById('olho-aberto');
  const fechado = document.getElementById('olho-fechado');
  if (!input) return;
  const visivel = input.type === 'text';
  input.type = visivel ? 'password' : 'text';
  if (aberto)  aberto.style.display  = visivel ? '' : 'none';
  if (fechado) fechado.style.display = visivel ? 'none' : '';
}

// -----------------------------------------------
// Faz logout e volta para a tela de login
// -----------------------------------------------
async function fazerLogout() {
  if (!await confirmar('Deseja sair da sua conta?', { icone: '👋', ok: 'Sair', cancelar: 'Ficar' })) return;
  Auth.logout();
  sessionStorage.removeItem('flashrh_autenticado');
  location.reload();
}

// -----------------------------------------------
// Exibe o app principal (esconde tela de login)
// -----------------------------------------------
function _abrirApp() {
  // Remove do DOM (não só oculta) para impedir que o Chrome faça autofill
  // nos campos do app usando as credenciais salvas da tela de login
  const telaLogin = document.getElementById('tela-login');
  if (telaLogin) telaLogin.remove();
  document.getElementById('app-principal')?.classList.remove('oculto');
  _atualizarInfoUsuario();
  _aplicarPermissoes();
  // Inicia o app apenas se ainda não foi iniciado (evita double-init)
  if (typeof _iniciarApp === 'function' && !window._appIniciado) {
    window._appIniciado = true;
    _iniciarApp();
  }
}

// -----------------------------------------------
// Exibe a tela de login (esconde o app)
// -----------------------------------------------
function _mostrarTelaLogin() {
  document.getElementById('tela-login')?.classList.remove('oculto');
  document.getElementById('app-principal')?.classList.add('oculto');
  document.getElementById('login-input')?.focus();
}

// -----------------------------------------------
// Banner no topo indicando "modo configuração"
// -----------------------------------------------
function _mostrarBannerConfig() {
  const b = document.getElementById('banner-modo-config');
  if (b) b.classList.remove('oculto');
}

// -----------------------------------------------
// Atualiza nome do usuário no cabeçalho
// -----------------------------------------------
function _atualizarInfoUsuario() {
  const span = document.getElementById('info-usuario');
  const nome = document.getElementById('nome-usuario');
  if (!span) return;

  if (Auth.sessao) {
    const nivel = Auth.sessao.nivel;
    if (nome) {
      const nivelCls = nivel === 'Dev' ? 'chip-dev' : nivel === 'Admin' ? 'chip-admin' : 'chip-viz';
      nome.className   = 'nome-usuario';
      nome.style.cssText = '';
      nome.innerHTML = `
        <span class="cabecalho-chip ${nivelCls}">${escaparHtml(Auth.sessao.nome)} · ${escaparHtml(nivel)}</span>
      `;
    }
    span.classList.remove('oculto');
  } else {
    span.classList.add('oculto');
  }

  // Botão "Gerenciar Usuários" só para Admin
  const btnGerenciar = document.getElementById('btn-gerenciar-usuarios');
  if (btnGerenciar) {
    btnGerenciar.classList.toggle('oculto', !Auth.isAdmin());
  }
}

// -----------------------------------------------
// Aplica permissões de acordo com o nível do usuário
// Adiciona/remove classe no body para CSS controlar
// -----------------------------------------------
function _aplicarPermissoes() {
  const nivel = Auth.sessao?.nivel || (Auth.isAdmin() ? 'Admin' : 'Visualizador');
  document.body.classList.toggle('perfil-visualizador', !Auth.isAdmin());
  document.body.classList.toggle('perfil-admin',         Auth.isAdmin());
  document.body.classList.toggle('perfil-dev',           Auth.isDev());
}

// -----------------------------------------------
// MODAL DE CONFIGURAÇÕES — abre e carrega tudo
// -----------------------------------------------
async function abrirGerenciarUsuarios() {
  abrirModal('modal-usuarios');
  _atualizarPainelConexao();

  // Mostra o form de novo usuário só para Admin/Dev
  const formNovo = document.getElementById('form-novo-usuario');
  if (formNovo) formNovo.classList.toggle('oculto', !Auth.isAdmin());

  // Dev pode criar outro Dev; Admin só até Admin
  const selectNivel = document.getElementById('nu-nivel');
  if (selectNivel && !Auth.isDev()) {
    const optDev = selectNivel.querySelector('option[value="Dev"]');
    if (optDev) optDev.remove();
  }

  await _renderizarListaUsuarios();
}

// Atualiza o painel de status da conexão no topo do modal
function _atualizarPainelConexao() {
  const titulo    = document.getElementById('conexao-titulo');
  const subtitulo = document.getElementById('conexao-subtitulo');
  const icone     = document.getElementById('conexao-icone');
  const btnDescon = document.getElementById('btn-desconectar');

  if (!titulo) return;

  const isDev = Auth.isDev();

  // Botões de configuração só aparecem para Dev
  document.getElementById('btn-reconectar')?.classList.toggle('oculto', !isDev);
  btnDescon?.classList.toggle('oculto', !isDev || !Api.configurado);

  if (Api.configurado) {
    icone.textContent     = '☁️';
    titulo.textContent    = 'Google Sheets conectado';
    subtitulo.textContent = 'Autenticação e dados centralizados na planilha BD. FLASH X RH';
    subtitulo.style.color = 'var(--cor-sucesso)';
  } else {
    icone.textContent     = isDev ? '🔌' : '☁️';
    titulo.textContent    = isDev ? 'Google Sheets não configurado' : 'Google Sheets';
    subtitulo.textContent = isDev ? 'Clique em Configurar para conectar à planilha' : 'Conexão gerenciada pelo administrador';
    subtitulo.style.color = 'var(--cinza-500)';
  }
}

// Mostra/oculta o campo de URL da API (só Dev)
function abrirPainelConexao() {
  if (!Auth.isDev()) return;
  const painel = document.getElementById('painel-url-api');
  const inp    = document.getElementById('input-api-url');
  if (!painel) return;
  const aberto = painel.classList.toggle('oculto');
  if (!aberto && inp) inp.value = Api.url;
}

// Troca entre tabs do modal (Usuários / Log)
function trocarModalTab(qual, btn) {
  document.querySelectorAll('.modal-tab').forEach(b => b.classList.remove('modal-tab-ativa'));
  document.querySelectorAll('.modal-tab-painel').forEach(p => p.classList.add('oculto'));
  btn.classList.add('modal-tab-ativa');
  document.getElementById(`modal-tab-${qual}`)?.classList.remove('oculto');
}

// Renderiza lista de usuários — busca do Sheets se conectado
async function _renderizarListaUsuarios() {
  const lista = document.getElementById('lista-usuarios');
  if (!lista) return;

  lista.innerHTML = `<p style="color:var(--cinza-400); font-size:13px; grid-column:1/-1;">Carregando usuários...</p>`;

  let usuarios = [];

  if (Api.configurado && Auth.sessao && Auth._senhaAtual) {
    const res = await Api.getUsuarios(Auth.sessao.login, Auth._senhaAtual);
    if (res && res.ok && res.usuarios) {
      usuarios = res.usuarios;
    }
  }

  // Fallback: localStorage
  if (!usuarios.length) usuarios = Auth.usuarios;

  if (!usuarios.length) {
    lista.innerHTML = `<p style="color:var(--cinza-400); font-size:13px; grid-column:1/-1; text-align:center; padding:20px;">
      Nenhum usuário encontrado. Adicione usuários na aba <strong>USUÁRIOS</strong> da planilha.</p>`;
    return;
  }

  lista.innerHTML = usuarios.map(u => {
    const nome  = u.NOME  || u.nome  || '';
    const login = u.LOGIN || u.login || '';
    const nivel = u.NIVEL || u.nivel || 'Visualizador';
    const ini   = (nome || login).charAt(0).toUpperCase();
    const avatarCls = nivel === 'Dev' ? 'avatar-dev' : nivel === 'Admin' ? 'avatar-admin' : 'avatar-viz';
    const euMesmo   = login === Auth.sessao?.login;

    const podeRemover = Auth.isAdmin() && !euMesmo && !(nivel === 'Dev' && !Auth.isDev());

    return `
      <div class="usuario-card">
        <div class="usuario-avatar ${avatarCls}">${ini}</div>
        <div class="usuario-dados">
          <div class="usuario-nome">${escaparHtml(nome)}</div>
          <div class="usuario-login">@${escaparHtml(login)}${euMesmo ? ' · <strong>você</strong>' : ''}</div>
        </div>
        <span class="usuario-nivel nivel-${nivel.toLowerCase()}">${escaparHtml(nivel)}</span>
        ${podeRemover ? `<button class="btn-remover-usuario" onclick="removerUsuario('${escaparHtml(login)}')" title="Remover usuário">✕</button>` : ''}
      </div>`;
  }).join('');
}

// -----------------------------------------------
// Cria novo usuário — chamado pelo botão no modal
// -----------------------------------------------
async function criarNovoUsuario() {
  const nome   = document.getElementById('nu-nome')?.value.trim();
  const login  = document.getElementById('nu-login')?.value.trim();
  const senha  = document.getElementById('nu-senha')?.value.trim();
  const nivel  = document.getElementById('nu-nivel')?.value;
  const erro   = document.getElementById('nu-erro');
  const btn    = document.querySelector('#form-novo-usuario .btn');

  const mostrarErro = (msg) => {
    if (!erro) return;
    erro.textContent = msg;
    erro.classList.remove('oculto');
  };

  erro?.classList.add('oculto');

  const confirma = document.getElementById('nu-confirma')?.value.trim();

  if (!nome || !login || !senha) { mostrarErro('Preencha todos os campos.'); return; }
  if (senha !== confirma) { mostrarErro('As senhas não coincidem.'); return; }
  if (senha.length < 4)  { mostrarErro('A senha deve ter pelo menos 4 caracteres.'); return; }

  btn.disabled = true;
  btn.textContent = 'Criando...';

  const res = await Api.adicionarUsuario(Auth.sessao.login, Auth._senhaAtual || '', {
    nome, novoLogin: login, novaSenha: senha, novoNivel: nivel,
  });

  btn.disabled = false;
  btn.textContent = 'Criar';

  if (res && res.ok) {
    document.getElementById('nu-nome').value    = '';
    document.getElementById('nu-login').value   = '';
    document.getElementById('nu-senha').value   = '';
    document.getElementById('nu-confirma').value = '';
    mostrarNotificacao(`Usuário ${login} criado com sucesso!`, 'sucesso');
    await _renderizarListaUsuarios();
  } else {
    mostrarErro(res?.erro || 'Erro ao criar usuário. Tente novamente.');
  }
}

// -----------------------------------------------
// Altera senha da própria conta
// -----------------------------------------------
async function alterarSenhaConta() {
  const senhaAtual  = document.getElementById('mc-senha-atual')?.value.trim();
  const novaSenha   = document.getElementById('mc-senha-nova')?.value.trim();
  const confirma    = document.getElementById('mc-senha-confirma')?.value.trim();
  const erro        = document.getElementById('mc-erro');
  const btn         = document.querySelector('#modal-tab-conta .btn');

  const mostrarErro = (msg) => { if (erro) { erro.textContent = msg; erro.classList.remove('oculto'); } };
  erro?.classList.add('oculto');

  if (!senhaAtual || !novaSenha || !confirma) { mostrarErro('Preencha todos os campos.'); return; }
  if (novaSenha !== confirma)                 { mostrarErro('As senhas não coincidem.'); return; }
  if (novaSenha.length < 4)                  { mostrarErro('A nova senha deve ter pelo menos 4 caracteres.'); return; }
  if (novaSenha === senhaAtual)               { mostrarErro('A nova senha deve ser diferente da atual.'); return; }

  btn.disabled = true;
  btn.textContent = 'Salvando...';

  const res = await Api.alterarSenha(Auth.sessao.login, senhaAtual, novaSenha);

  btn.disabled = false;
  btn.textContent = 'Salvar nova senha';

  if (res && res.ok) {
    Auth._senhaAtual = novaSenha;
    document.getElementById('mc-senha-atual').value    = '';
    document.getElementById('mc-senha-nova').value     = '';
    document.getElementById('mc-senha-confirma').value = '';
    mostrarNotificacao('✅ Senha alterada com sucesso!', 'sucesso');
  } else {
    mostrarErro(res?.erro || 'Erro ao alterar senha. Verifique a senha atual.');
  }
}

// Remove usuário — chamado pelos cards
async function removerUsuario(loginAlvo) {
  if (!await confirmar(`Remover o usuário "${loginAlvo}"? Esta ação não pode ser desfeita.`, { perigo: true, icone: '🗑️', ok: 'Remover' })) return;

  const res = await Api.removerUsuario(Auth.sessao.login, Auth._senhaAtual || '', loginAlvo);
  if (res && res.ok) {
    mostrarNotificacao(`Usuário ${loginAlvo} removido.`, 'aviso');
    await _renderizarListaUsuarios();
  } else {
    mostrarNotificacao(res?.erro || 'Erro ao remover usuário.', 'erro');
  }
}

// Atualiza o log inline na tab Log
async function atualizarLogInline() {
  const el = document.getElementById('conteudo-log-sheets-inline');
  if (!el) return;
  if (!Api.configurado) {
    el.innerHTML = `<p style="text-align:center; color:var(--cinza-400); padding:20px;">Google Sheets não configurado.</p>`;
    return;
  }
  el.innerHTML = `<p style="text-align:center; color:var(--cinza-400); padding:20px;">Carregando...</p>`;
  const linhas = await Api.getLog(200);
  if (!linhas.length) {
    el.innerHTML = `<p style="text-align:center; color:var(--cinza-400); padding:20px;">Nenhuma entrada no log ainda.</p>`;
    return;
  }
  el.innerHTML = `
    <table style="width:100%; border-collapse:collapse; font-size:12px;">
      <thead><tr style="background:var(--bg-elevado); position:sticky; top:0;">
        <th style="padding:8px; text-align:left; color:var(--cinza-500); border-bottom:1px solid var(--cinza-200);">Data/Hora</th>
        <th style="padding:8px; text-align:left; color:var(--cinza-500); border-bottom:1px solid var(--cinza-200);">Usuário</th>
        <th style="padding:8px; text-align:left; color:var(--cinza-500); border-bottom:1px solid var(--cinza-200);">Colaborador</th>
        <th style="padding:8px; text-align:left; color:var(--cinza-500); border-bottom:1px solid var(--cinza-200);">Campo</th>
        <th style="padding:8px; text-align:left; color:var(--cinza-500); border-bottom:1px solid var(--cinza-200);">De</th>
        <th style="padding:8px; text-align:left; color:var(--cinza-500); border-bottom:1px solid var(--cinza-200);">Para</th>
      </tr></thead>
      <tbody>
        ${linhas.map((l, i) => `
          <tr style="background:${i % 2 ? 'var(--bg-elevado)' : 'transparent'}">
            <td style="padding:6px 8px; color:var(--cinza-500); white-space:nowrap;">${escaparHtml(String(l['DATA_HORA']||''))}</td>
            <td style="padding:6px 8px; font-weight:600; color:var(--cor-primaria);">${escaparHtml(String(l['USUARIO']||''))}</td>
            <td style="padding:6px 8px;">${escaparHtml(String(l['COLABORADOR']||''))}</td>
            <td style="padding:6px 8px; color:var(--cinza-600);">${escaparHtml(String(l['COLUNA']||''))}</td>
            <td style="padding:6px 8px; color:var(--cor-perigo); text-decoration:line-through;">${escaparHtml(String(l['VALOR_ANTIGO']||'—'))}</td>
            <td style="padding:6px 8px; color:var(--cor-sucesso); font-weight:600;">${escaparHtml(String(l['VALOR_NOVO']||'—'))}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

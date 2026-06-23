/* ================================================
   API — Integração com Google Apps Script
   Backend: planilha "BD. FLASH X RH" no Google Sheets
   Abas: USUÁRIOS (autenticação) | log (histórico compartilhado)

   Como configurar:
   1. Cole o Code.gs na planilha via Extensões > Apps Script
   2. Implante como Web App (Execute como: Eu | Acesso: Qualquer pessoa)
   3. Cole a URL gerada no campo de configuração dentro do app
   ================================================ */

const Api = {

  // URL padrão — usada se nenhuma outra estiver no localStorage
  _urlPadrao: 'https://script.google.com/macros/s/AKfycbw33Y9PqLrpOct1TAy8sf-KCQs5ftAanqCNnbHCeS6j6uBRawLFOSeh0uL5r7vggdCH/exec',

  // URL da Web App — localStorage tem prioridade, fallback para padrão
  get url() { return localStorage.getItem('flashrh_api_url') || this._urlPadrao; },

  configurarUrl(url) {
    const limpa = url.trim();
    if (limpa) localStorage.setItem('flashrh_api_url', limpa);
    else       localStorage.removeItem('flashrh_api_url');
  },

  get configurado() { return !!this.url; },

  // -----------------------------------------------
  // LOGIN — valida credenciais no Google Sheets
  // Senha em texto puro (comparada no Apps Script)
  // Retorna { ok, nome, login, nivel } ou null (se API offline)
  // -----------------------------------------------
  async login(login, senha) {
    if (!this.url) return null;
    try {
      const params = new URLSearchParams({ acao: 'login', login, senha });
      const res    = await fetch(`${this.url}?${params}`, { redirect: 'follow' });
      return await res.json();
    } catch {
      return null; // API offline → auth.js usa fallback localStorage
    }
  },

  // -----------------------------------------------
  // LOG — grava uma entrada na aba "log" (fire-and-forget)
  // Content-Type: text/plain evita preflight CORS
  // -----------------------------------------------
  addLog(entrada) {
    if (!this.url) return;
    fetch(this.url, {
      method:  'POST',
      mode:    'no-cors',        // não precisa ler a resposta
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify({ acao: 'addLog', ...entrada }),
    }).catch(() => {});
  },

  // -----------------------------------------------
  // LOG — busca as últimas N entradas (para exibir no modal)
  // -----------------------------------------------
  async getLog(limite = 300) {
    if (!this.url) return [];
    try {
      const params = new URLSearchParams({ acao: 'getLog', limite });
      const res    = await fetch(`${this.url}?${params}`, { redirect: 'follow' });
      const data   = await res.json();
      return data.ok ? data.linhas : [];
    } catch {
      return [];
    }
  },

  // -----------------------------------------------
  // BASE SYNC — carrega a BASE do Google Sheets
  // Retorna { ok, timestamp, iso, usuario, colunasBase, dadosBase } ou null
  // -----------------------------------------------
  async carregarBase() {
    if (!this.url) return null;
    try {
      const res  = await fetch(`${this.url}?acao=carregarBase`, { redirect: 'follow' });
      const data = await res.json();
      if (!data.ok) return null;
      // Aba vazia → retorna objeto vazio mas não null (não é offline)
      return data;
    } catch {
      return null; // null = offline de verdade
    }
  },

  // -----------------------------------------------
  // BASE SYNC — envia a BASE completa para o Google Sheets
  // Apps Script redireciona POST → usamos no-cors + verificação posterior
  // -----------------------------------------------
  async salvarBase(colunasBase, dadosBase, usuario) {
    if (!this.url) return false;
    try {
      const iso = new Date().toISOString();

      // Envia via no-cors (Apps Script recebe mesmo com redirect)
      await fetch(this.url, {
        method:  'POST',
        mode:    'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          acao:         'salvarBase',
          usuario,
          isoTimestamp: iso,
          colunasBase:  JSON.stringify(colunasBase),
          dadosBase:    JSON.stringify(dadosBase),
        }),
      });

      // Verifica a gravação com até 4 tentativas de 3s (total ≤ 12s).
      // Apps Script pode levar tempo variável dependendo do tamanho da planilha.
      // Retorna true assim que o ISO gravado no Sheets bater com o enviado.
      for (let i = 0; i < 4; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const check = await this.carregarBase();
        if (check && check.iso && check.iso.trim() === iso.trim()) return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  // -----------------------------------------------
  // USUÁRIOS — lista completa (só Admin/Dev)
  // -----------------------------------------------
  async getUsuarios(loginAdmin, senhaAdmin) {
    if (!this.url) return null;
    try {
      const params = new URLSearchParams({ acao: 'getUsuarios', login: loginAdmin, senha: senhaAdmin });
      const res    = await fetch(`${this.url}?${params}`, { redirect: 'follow' });
      return await res.json();
    } catch {
      return null;
    }
  },

  // -----------------------------------------------
  // USUÁRIOS — altera senha do próprio usuário
  // -----------------------------------------------
  async alterarSenha(login, senhaAtual, novaSenha) {
    if (!this.url) return null;
    try {
      await fetch(this.url, {
        method:  'POST',
        mode:    'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ acao: 'alterarSenha', login, senhaAtual, novaSenha }),
      });
      await new Promise(r => setTimeout(r, 2000));
      // Verifica se a nova senha funciona
      const check = await this.login(login, novaSenha);
      return check && check.ok ? { ok: true } : { ok: false, erro: 'Senha atual incorreta' };
    } catch {
      return null;
    }
  },

  // -----------------------------------------------
  // USUÁRIOS — adiciona novo usuário (Admin/Dev)
  // -----------------------------------------------
  async adicionarUsuario(loginAdmin, senhaAdmin, { nome, novoLogin, novaSenha, novoNivel }) {
    if (!this.url) return null;
    try {
      const params = new URLSearchParams({ acao: 'adicionarUsuario', login: loginAdmin, senha: senhaAdmin, nome, novoLogin, novaSenha, novoNivel });
      const res = await fetch(`${this.url}?${params}`, { redirect: 'follow' });
      return await res.json();
    } catch {
      return null;
    }
  },

  // -----------------------------------------------
  // USUÁRIOS — remove usuário (Admin/Dev)
  // -----------------------------------------------
  async removerUsuario(loginAdmin, senhaAdmin, alvo) {
    if (!this.url) return null;
    try {
      const params = new URLSearchParams({ acao: 'removerUsuario', login: loginAdmin, senha: senhaAdmin, alvo });
      const res    = await fetch(`${this.url}?${params}`, { redirect: 'follow' });
      return await res.json();
    } catch {
      return null;
    }
  },
};

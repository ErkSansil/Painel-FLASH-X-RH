// ================================================
// FLASH RH — Backend Google Apps Script
// Planilha: BD. FLASH X RH
// Abas necessárias: USUÁRIOS | log
//
// COMO IMPLANTAR:
// 1. Abra a planilha BD. FLASH X RH
// 2. Menu: Extensões > Apps Script
// 3. Apague tudo e cole este arquivo inteiro
// 4. Salve (Ctrl+S)
// 5. Clique em "Implantar" > "Nova implantação"
// 6. Tipo: Aplicativo da Web
// 7. Executar como: Eu
// 8. Quem tem acesso: Qualquer pessoa
// 9. Clique em "Implantar" e autorize
// 10. Copie a URL gerada e cole no Flash RH > Usuários > Google Sheets
//
// FORMATO DA ABA USUÁRIOS:
// NOME | LOGIN | SENHA | NIVEL
// (SENHA = senha em texto puro — a planilha é o banco de dados)
// NIVEL = Dev ou Admin ou Visualizador
//
// FORMATO DA ABA log:
// DATA_HORA | USUARIO | COLABORADOR | COLUNA | VALOR_ANTIGO | VALOR_NOVO
// (criada automaticamente na primeira gravação)
// ================================================

const ID_PLANILHA  = '1vjgdhqZgZbU_HHgevYnj6drSqPGAuapdli2t7xukWOE';
const ABA_USUARIOS = 'USUÁRIOS';
const ABA_LOG      = 'log';
const ABA_SYNC     = 'PAINEL BASE'; // aba criada na planilha para sincronizar a BASE

// -----------------------------------------------
// GET — login, leitura de log e usuários
// -----------------------------------------------
function doGet(e) {
  const p = e.parameter || {};
  let resultado;

  try {
    switch (p.acao) {
      case 'login':
        resultado = _autenticar(p.login, p.senha);
        break;
      case 'getLog':
        resultado = _obterLog(Number(p.limite) || 300);
        break;
      case 'carregarBase':
        resultado = _carregarBase();
        break;
      case 'getUsuarios':
        resultado = _obterUsuarios(p.login, p.senha);
        break;
      case 'removerUsuario':
        resultado = _removerUsuario(p.login, p.senha, p.alvo);
        break;
      default:
        resultado = { ok: false, erro: 'Ação inválida' };
    }
  } catch (err) {
    resultado = { ok: false, erro: err.message };
  }

  return _json(resultado);
}

// -----------------------------------------------
// POST — gravar log (fire-and-forget do frontend)
// Content-Type: text/plain evita preflight CORS
// -----------------------------------------------
function doPost(e) {
  let resultado;

  try {
    const d = JSON.parse(e.postData.contents);
    switch (d.acao) {
      case 'addLog':
        resultado = _adicionarLog(d);
        break;
      case 'salvarBase':
        resultado = _salvarBase(d);
        break;
      case 'adicionarUsuario':
        resultado = _adicionarUsuario(d);
        break;
      case 'alterarSenha':
        resultado = _alterarSenha(d);
        break;
      default:
        resultado = { ok: false, erro: 'Ação inválida' };
    }
  } catch (err) {
    resultado = { ok: false, erro: err.message };
  }

  return _json(resultado);
}

// -----------------------------------------------
// Valida login — compara senha em texto puro com a planilha
// A planilha USUÁRIOS é o banco de dados
// -----------------------------------------------
function _autenticar(login, senha) {
  if (!login || !senha) return { ok: false, erro: 'Dados incompletos' };

  const sheet = _aba(ABA_USUARIOS);
  const dados = sheet.getDataRange().getValues();
  if (dados.length < 2) return { ok: false, erro: 'Nenhum usuário cadastrado' };

  const cab    = dados[0].map(c => String(c).trim().toUpperCase());
  const iLogin = cab.indexOf('LOGIN');
  const iSenha = cab.indexOf('SENHA');
  const iNome  = cab.indexOf('NOME');
  const iNivel = cab.indexOf('NIVEL');

  for (let i = 1; i < dados.length; i++) {
    const row = dados[i];
    if (!row[iLogin]) continue;

    if (String(row[iLogin]).trim().toLowerCase() === String(login).toLowerCase()) {
      const senhaSheet = String(row[iSenha] || '').trim();
      if (senhaSheet === String(senha).trim()) {
        return {
          ok:    true,
          nome:  String(row[iNome]  || '').trim(),
          login: String(row[iLogin] || '').trim(),
          nivel: String(row[iNivel] || 'Visualizador').trim(),
        };
      }
      return { ok: false, erro: 'Senha incorreta' };
    }
  }

  return { ok: false, erro: 'Usuário não encontrado' };
}

// -----------------------------------------------
// Lê as últimas N linhas da aba log (ordem decrescente)
// -----------------------------------------------
function _obterLog(limite) {
  const sheet = _aba(ABA_LOG);
  const total = sheet.getLastRow();
  if (total <= 1) return { ok: true, linhas: [] };

  const dados  = sheet.getDataRange().getValues();
  const cab    = dados[0].map(c => String(c).trim());
  // Linhas mais recentes primeiro
  const linhas = dados.slice(1).reverse().slice(0, limite).map(row =>
    Object.fromEntries(cab.map((c, i) => [c, row[i]]))
  );

  return { ok: true, linhas };
}

// -----------------------------------------------
// Adiciona uma linha na aba log
// Cria o cabeçalho se a aba estiver vazia
// -----------------------------------------------
function _adicionarLog(d) {
  const sheet  = _aba(ABA_LOG);
  const ultima = sheet.getLastRow();

  if (ultima === 0) {
    sheet.appendRow(['DATA_HORA', 'USUARIO', 'COLABORADOR', 'COLUNA', 'VALOR_ANTIGO', 'VALOR_NOVO']);
  }

  const agora = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'
  );

  sheet.appendRow([
    agora,
    String(d.usuario      || ''),
    String(d.colaborador  || ''),
    String(d.coluna       || ''),
    String(d.valorAntigo  ?? ''),
    String(d.valorNovo    ?? ''),
  ]);

  return { ok: true };
}

// -----------------------------------------------
// Retorna lista de usuários (exige Admin ou Dev)
// -----------------------------------------------
function _obterUsuarios(login, senha) {
  const auth = _autenticar(login, senha);
  if (!auth.ok) return { ok: false, erro: 'Não autenticado' };
  if (!['Admin','Dev'].includes(auth.nivel)) return { ok: false, erro: 'Sem permissão' };

  const sheet = _aba(ABA_USUARIOS);
  const dados = sheet.getDataRange().getValues();
  if (dados.length < 2) return { ok: true, usuarios: [] };

  const cab      = dados[0].map(c => String(c).trim());
  const usuarios = dados.slice(1)
    .filter(r => r.some(c => String(c).trim() !== ''))
    .map(r => Object.fromEntries(cab.map((c, i) => [c, r[i]])));

  return { ok: true, usuarios };
}

// -----------------------------------------------
// Altera senha do próprio usuário autenticado
// -----------------------------------------------
function _alterarSenha(d) {
  const auth = _autenticar(d.login, d.senhaAtual);
  if (!auth.ok) return { ok: false, erro: 'Senha atual incorreta' };

  const sheet = _aba(ABA_USUARIOS);
  const dados = sheet.getDataRange().getValues();
  const cab   = dados[0].map(c => String(c).trim().toUpperCase());
  const iLogin = cab.indexOf('LOGIN');
  const iSenha = cab.indexOf('SENHA');

  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][iLogin] || '').trim().toLowerCase() === String(d.login).trim().toLowerCase()) {
      sheet.getRange(i + 1, iSenha + 1).setValue(d.novaSenha.trim());
      return { ok: true };
    }
  }
  return { ok: false, erro: 'Usuário não encontrado' };
}

// -----------------------------------------------
// Adiciona usuário à aba USUÁRIOS (exige Admin ou Dev)
// -----------------------------------------------
function _adicionarUsuario(d) {
  const auth = _autenticar(d.login, d.senha);
  if (!auth.ok) return { ok: false, erro: 'Não autenticado' };
  if (!['Admin','Dev'].includes(auth.nivel)) return { ok: false, erro: 'Sem permissão' };

  const { nome, novoLogin, novaSenha, novoNivel } = d;
  if (!nome || !novoLogin || !novaSenha) return { ok: false, erro: 'Preencha todos os campos' };
  const nivelValido = ['Dev','Admin','Visualizador'].includes(novoNivel) ? novoNivel : 'Visualizador';

  const sheet = _aba(ABA_USUARIOS);
  const dados = sheet.getDataRange().getValues();

  // Garante cabeçalho
  if (dados.length === 0) {
    sheet.appendRow(['NOME','LOGIN','SENHA','NIVEL']);
  }

  // Verifica duplicata
  const cab = (dados[0] || []).map(c => String(c).trim().toUpperCase());
  const iLogin = cab.indexOf('LOGIN');
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][iLogin] || '').trim().toLowerCase() === novoLogin.trim().toLowerCase()) {
      return { ok: false, erro: 'Login já existe' };
    }
  }

  sheet.appendRow([nome.trim(), novoLogin.trim(), novaSenha.trim(), nivelValido]);
  return { ok: true };
}

// -----------------------------------------------
// Remove usuário da aba USUÁRIOS (exige Admin ou Dev)
// -----------------------------------------------
function _removerUsuario(login, senha, alvo) {
  const auth = _autenticar(login, senha);
  if (!auth.ok) return { ok: false, erro: 'Não autenticado' };
  if (!['Admin','Dev'].includes(auth.nivel)) return { ok: false, erro: 'Sem permissão' };

  const sheet = _aba(ABA_USUARIOS);
  const dados = sheet.getDataRange().getValues();
  const cab   = dados[0].map(c => String(c).trim().toUpperCase());
  const iLogin = cab.indexOf('LOGIN');

  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][iLogin] || '').trim().toLowerCase() === String(alvo).trim().toLowerCase()) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, erro: 'Usuário não encontrado' };
}

// -----------------------------------------------
// BASE SYNC — salva toda a BASE como JSON na aba BASE_SYNC
// Linha 1: timestamp | usuario | colunasBase (JSON) | dadosBase (JSON)
// -----------------------------------------------
function _salvarBase(d) {
  if (!d.dados) return { ok: false, erro: 'Sem dados' };

  const sheet = _aba(ABA_SYNC);
  sheet.clearContents();

  const agora = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'
  );

  // Cabeçalho de metadados na linha 1
  sheet.getRange(1, 1).setValue('TIMESTAMP');
  sheet.getRange(1, 2).setValue('USUARIO');
  sheet.getRange(1, 3).setValue('ISO');
  sheet.getRange(1, 4).setValue('COLUNAS_JSON');
  sheet.getRange(1, 5).setValue('DADOS_JSON');

  // Dados na linha 2
  sheet.getRange(2, 1).setValue(agora);
  sheet.getRange(2, 2).setValue(d.usuario || '');
  sheet.getRange(2, 3).setValue(d.isoTimestamp || new Date().toISOString());
  sheet.getRange(2, 4).setValue(d.colunasBase || '[]');
  sheet.getRange(2, 5).setValue(d.dadosBase   || '[]');

  return { ok: true, timestamp: agora, iso: d.isoTimestamp };
}

// -----------------------------------------------
// BASE SYNC — carrega a BASE do Sheets
// Retorna null em dados se a aba estiver vazia
// -----------------------------------------------
function _carregarBase() {
  const sheet = _aba(ABA_SYNC);
  if (sheet.getLastRow() < 2) return { ok: true, dados: null };

  const row = sheet.getRange(2, 1, 1, 5).getValues()[0];
  return {
    ok:          true,
    timestamp:   String(row[0] || ''),
    usuario:     String(row[1] || ''),
    iso:         String(row[2] || ''),
    colunasBase: String(row[3] || '[]'),
    dadosBase:   String(row[4] || '[]'),
  };
}

// -----------------------------------------------
// Helpers
// -----------------------------------------------
function _aba(nome) {
  const ss    = SpreadsheetApp.openById(ID_PLANILHA);
  const sheet = ss.getSheetByName(nome);
  if (sheet) return sheet;
  // Cria a aba se não existir
  return ss.insertSheet(nome);
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ================================================
   EXPORTAÇÃO — PEDIDO BENEFÍCIO e BACKUP DA BASE
   Usa xlsx-js-style para estilos (bordas, cores, negrito).

   Tipos de célula:
     'cabecalho' → fundo azul, texto branco, negrito
     'texto'     → string pura (CNPJ, CPF, textos gerais)
     'numero'    → número decimal (VT, VR e similares) — re-importável
     'moeda'     → número com formato "#,##0.00" (PEDIDO BENEFÍCIO)
   ================================================ */

// Colunas monetárias do PEDIDO (nomes exatos do xlsx, sem acento)
const COLUNAS_MOEDA_RE = /MOBILIDADE|ALIMENTACAO|REFEICAO|PREMIACAO|ALIMENTA[CÇ]|REFEI[CÇ]|PREMIA[CÇ]/i;

// -----------------------------------------------
// Exporta o PEDIDO BENEFÍCIO como .xlsx
// Reproduz o layout da planilha original:
// - CNPJ/CPF como texto (evita notação científica)
// - Monetários como número com 2 casas decimais
// - Todas as células centralizadas
// -----------------------------------------------
function exportarPedidoBeneficio() {
  const dados   = Estado.dadosPedido;
  const colunas = Estado.colunasPedido;

  if (!dados || dados.length === 0) {
    mostrarNotificacao('Não há dados do PEDIDO BENEFÍCIO para exportar.', 'aviso');
    return;
  }

  try {
    const pasta = XLSX.utils.book_new();

    // Monta as linhas: primeira é o cabeçalho
    const linhas = [];

    // --- Linha de cabeçalho ---
    linhas.push(colunas.map(col => _celulaEstilizada(col, 'cabecalho', col)));

    // --- Linhas de dados ---
    dados.forEach(linha => {
      const row = colunas.map(col => {
        const valor = linha[col] ?? '';
        return _celulaEstilizada(valor, _tipoColuna(col), col);
      });
      linhas.push(row);
    });

    // Converte para planilha SheetJS (com objetos de célula)
    const planilha = XLSX.utils.aoa_to_sheet(linhas);

    // Define larguras de coluna automáticas
    planilha['!cols'] = _calcularLarguras(linhas);

    // Fixa a primeira linha (cabeçalho) ao rolar
    planilha['!freeze'] = { xSplit: 0, ySplit: 1 };

    XLSX.utils.book_append_sheet(pasta, planilha, 'PEDIDO BENEFICIO');

    const dataHoje    = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    const nomeArquivo = `PEDIDO_BENEFICIO_${dataHoje}.xlsx`;

    XLSX.writeFile(pasta, nomeArquivo);
    mostrarNotificacao(`✅ Arquivo "${nomeArquivo}" gerado com sucesso!`, 'sucesso');

  } catch (erro) {
    console.error('Erro ao exportar:', erro);
    mostrarNotificacao('Erro ao gerar o arquivo. Tente novamente.', 'erro');
  }
}

// -----------------------------------------------
// Exporta a aba BASE como .xlsx (backup)
// -----------------------------------------------
function exportarBase() {
  const dados   = Estado.dadosBase;
  const colunas = Estado.colunasBase;

  if (!dados || dados.length === 0) {
    mostrarNotificacao('Não há dados para exportar.', 'aviso');
    return;
  }

  try {
    const pasta  = XLSX.utils.book_new();
    const linhas = [];

    linhas.push(colunas.map(col => _celulaEstilizada(col, 'cabecalho', col)));

    dados.forEach(linha => {
      linhas.push(colunas.map(col => {
        const valor = linha[col] ?? '';
        return _celulaEstilizada(valor, _tipoColuna(col), col);
      }));
    });

    const planilha = XLSX.utils.aoa_to_sheet(linhas);
    planilha['!cols'] = _calcularLarguras(linhas);

    XLSX.utils.book_append_sheet(pasta, planilha, 'BASE - Colaboradores');

    const dataHoje    = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
    const nomeArquivo = `BASE_COLABORADORES_${dataHoje}.xlsx`;

    XLSX.writeFile(pasta, nomeArquivo);
    mostrarNotificacao(`✅ Base exportada: "${nomeArquivo}"`, 'sucesso');

  } catch (erro) {
    console.error('Erro ao exportar base:', erro);
    mostrarNotificacao('Erro ao exportar. Tente novamente.', 'erro');
  }
}

// -----------------------------------------------
// Exporta modelo em branco de usuários (.xlsx)
// -----------------------------------------------
function exportarModeloUsuarios() {
  try {
    const pasta  = XLSX.utils.book_new();
    const cabec  = ['NOME', 'LOGIN', 'SENHA', 'NIVEL'];
    const linhas = [
      cabec.map(col => _celulaEstilizada(col, 'cabecalho', col)),
      ['Maria Silva', 'maria.silva', 'senha123', 'Admin'].map((v, i) =>
        _celulaEstilizada(v, 'texto', cabec[i])
      ),
      ['João Costa', 'joao.costa', 'senha456', 'Visualizador'].map((v, i) =>
        _celulaEstilizada(v, 'texto', cabec[i])
      ),
    ];

    const planilha = XLSX.utils.aoa_to_sheet(linhas);
    planilha['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 15 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(pasta, planilha, 'USUÁRIOS');
    XLSX.writeFile(pasta, 'MODELO_USUARIOS.xlsx');
    mostrarNotificacao('✅ Modelo de usuários baixado.', 'sucesso');
  } catch (e) {
    mostrarNotificacao('Erro ao gerar modelo.', 'erro');
  }
}

// -----------------------------------------------
// Cria um objeto de célula xlsx-js-style com
// valor correto e estilo (alinhamento + fonte)
// -----------------------------------------------
function _celulaEstilizada(valor, tipo, nomeColuna) {
  // Estilos base de alinhamento (todas centralizadas)
  const estiloBase = {
    alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
    font: { name: 'Calibri', sz: 11 },
    border: {
      top:    { style: 'thin', color: { rgb: 'D1D5DB' } },
      bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
      left:   { style: 'thin', color: { rgb: 'D1D5DB' } },
      right:  { style: 'thin', color: { rgb: 'D1D5DB' } },
    },
  };

  // Estilo do cabeçalho: fundo azul escuro, texto branco, negrito
  if (tipo === 'cabecalho') {
    return {
      v: String(valor),
      t: 's',
      s: {
        ...estiloBase,
        font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '1A56DB' } },
        alignment: { horizontal: 'center', vertical: 'center' },
      },
    };
  }

  // Colunas CNPJ e CPF: sempre texto puro para evitar notação científica
  if (tipo === 'texto') {
    const str = String(valor).trim();
    return {
      v: str,
      t: 's',  // type: string
      s: estiloBase,
    };
  }

  // VT/VR e similares: número puro sem símbolo (re-importável sem perda de dados)
  if (tipo === 'numero') {
    const num = parseMoeda(valor); // suporta "18.76", "R$ 18,76" e number
    return {
      v: isNaN(num) ? 0 : num,
      t: 'n',
      z: '0.00',
      s: estiloBase,
    };
  }

  // Colunas monetárias do PEDIDO: número com formato contábil brasileiro
  if (tipo === 'moeda') {
    const num = parseMoeda(valor);
    return {
      v: isNaN(num) ? 0 : num,
      t: 'n',
      z: '#,##0.00',
      s: estiloBase,
    };
  }

  // Célula genérica: exporta como texto puro
  const str = String(valor ?? '');
  return {
    v: str,
    t: 's',
    s: estiloBase,
  };
}

// -----------------------------------------------
// Determina o tipo de célula para formatação/exportação:
//   'texto'  → string pura (CPF, CNPJ, nomes, status)
//   'numero' → decimal sem símbolo (VT, VR — re-importável)
//   'moeda'  → decimal com formato contábil (valores do PEDIDO)
// -----------------------------------------------
function _tipoColuna(nomeColuna) {
  if (!nomeColuna) return 'texto';
  if (/cnpj|cpf/i.test(nomeColuna)) return 'texto';
  if (COLUNAS_MOEDA_RE.test(nomeColuna)) return 'moeda';
  // VT e VR são taxas diárias numéricas — exporta como número puro para permitir re-import
  if (/^(VT|VR)$/i.test(nomeColuna)) return 'numero';
  return 'texto';
}

// -----------------------------------------------
// Calcula larguras de coluna baseadas no conteúdo
// -----------------------------------------------
function _calcularLarguras(linhas) {
  if (!linhas || linhas.length === 0) return [];

  const numCols = linhas[0].length;
  const largs   = new Array(numCols).fill(10);

  linhas.forEach(linha => {
    linha.forEach((cel, i) => {
      // Extrai o valor textual da célula (pode ser objeto ou primitivo)
      const texto = cel && typeof cel === 'object' ? String(cel.v ?? '') : String(cel ?? '');
      const comp  = texto.length;
      if (comp > largs[i]) largs[i] = Math.min(comp + 2, 55);
    });
  });

  return largs.map(w => ({ wch: w }));
}

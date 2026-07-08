"use strict";

let DATA = null;

const el = (id) => document.getElementById(id);

function normalize(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/* Busca por palavras: todas as palavras digitadas devem aparecer, em qualquer ordem */
function matchesQuery(searchText, query) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  return tokens.every((t) => searchText.includes(t));
}

function formatURF(n) {
  return (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatBRL(n) {
  return "R$ " + (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function urfToReais(urf) {
  return urf * DATA.meta.urf_ac.valor_reais;
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

/* ---------------- Copiar para a área de transferência ---------------- */

function attachCopyButton(btnId, buildText) {
  const btn = el(btnId);
  if (!btn) return;
  btn.addEventListener("click", () => {
    const text = buildText();
    const done = () => {
      const original = btn.textContent;
      btn.classList.add("copied");
      btn.textContent = "Copiado!";
      setTimeout(() => {
        btn.classList.remove("copied");
        btn.textContent = original;
      }, 1600);
    };
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { /* sem clipboard */ }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
  });
}

/* ---------------- Navegação ---------------- */

const VIEW_TITLES = {
  "view-home": "CIDAF",
  "view-multas": "Calculadora de Multas",
  "view-taxas": "Taxas e Emolumentos",
  "view-gta": "GTA - Guia de Trânsito Animal",
  "view-busca": "Buscar Infração",
};

function showView(id) {
  document.querySelectorAll(".view").forEach((v) => { v.hidden = true; });
  el(id).hidden = false;
  el("header-title").textContent = VIEW_TITLES[id] || "CIDAF";
  el("header-subtitle").hidden = id !== "view-home";
  el("btn-home").hidden = id === "view-home";
  window.scrollTo(0, 0);
}

const VIEW_RESETTERS = {
  "view-multas": () => resetMultaState(),
  "view-taxas": () => resetTaxaState(),
  "view-gta": () => resetGtaState(),
  "view-busca": () => resetBuscaState(),
};

function setupNav() {
  document.querySelectorAll(".home-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      const reset = VIEW_RESETTERS[view];
      if (reset) reset();
      showView(view);
    });
  });
  el("btn-home").addEventListener("click", () => showView("view-home"));
}

/* ---------------- Rodapé ---------------- */

function renderFooter() {
  const urf = DATA.meta.urf_ac;
  el("footer-urf").textContent = `URF/AC ${urf.exercicio}: ${formatBRL(urf.valor_reais)}`;
}

/* ---------------- Identificação institucional (home) ---------------- */

function renderOrgaoInfo() {
  const meta = DATA.meta;
  const orgao = meta.orgao;
  el("home-orgao-nome").textContent = `${orgao.nome} — ${orgao.sigla}`;
  el("home-orgao-completo").textContent = `${orgao.nome} (${orgao.sigla})`;
  el("home-escopo-nota").textContent = orgao.escopo_nota;
  el("home-base-legal").textContent = `Base legal: ${meta.decreto_base}, com as alterações do ${meta.decreto_alterador} (texto vigente).`;
}

/* ---------------- Regras transversais (multas) ---------------- */

function applyRegrasTransversais(rawTotal, reincidencia) {
  const regras = DATA.meta.regras_transversais;
  let total = rawTotal;
  if (reincidencia) total *= regras.reincidencia.multiplicador;
  const piso = regras.piso_multa_urf.valor;
  let pisoAplicado = false;
  if (total > 0 && total < piso) {
    total = piso;
    pisoAplicado = true;
  }
  return { total, pisoAplicado };
}

function getAdvertenciaWarning(total) {
  const adv = DATA.meta.regras_transversais.advertencia;
  if (total <= 0 || total >= adv.limite_urf) return null;
  return `Multa inferior a ${adv.limite_urf} URF. Pode ser elegível à conversão em Auto de Advertência (${adv.base_legal}), se o infrator for primário (não autuado nos últimos 2 anos) e não houver dolo ou má-fé. Avaliação do servidor.`;
}

function renderResultTotal(totalUrf) {
  return `<div class="result-total">
    <div class="urf">${formatURF(totalUrf)} URF/AC</div>
    <div class="reais">${formatBRL(urfToReais(totalUrf))}</div>
  </div>`;
}

/* Informações do auto de infração (parcelamento, prazo de recurso) */
function renderAutoInfoBox() {
  const regras = DATA.meta.regras_transversais;
  const p = regras.parcelamento;
  return `<div class="auto-info"><strong>Informações do auto de infração:</strong>
    <ul>
      <li>Prazo de defesa/recurso: ${regras.prazo_recurso_dias} dias.</li>
      <li>Parcelamento: até ${p.max_parcelas} parcelas, parcela mínima de ${formatURF(p.parcela_minima_urf)} URF, ${p.juros} (${p.base_legal}).</li>
      <li>Reincidência: multa em dobro na mesma infração; reabilitação em ${regras.reincidencia.reabilitacao_anos} anos (${regras.reincidencia.base_legal}).</li>
    </ul>
  </div>`;
}

/* =========================================================
   MÓDULO 1: MULTAS
   ========================================================= */

const multaState = {
  tipo: "por_cabeca",
  busca: "",
  infracao: null,
  rows: [],
  vfQuantidade: 1,
  reincidencia: false,
  nextRowId: 1,
  lastCalc: null, // {total, breakdown, pisoAplicado} para o texto do auto
};

function getEspecieItem(nome) {
  return DATA.tabela_especies_anexo_ii.itens.find((i) => i.especie === nome);
}

function multaListaItens() {
  if (multaState.tipo === "por_cabeca") {
    return DATA.infracoes_por_cabeca.itens.map((it) => ({
      titulo: it.descricao,
      meta: `${it.previsao_legal} - multiplicador ${it.multiplicador}x - por ${it.por}`,
      searchText: normalize(it.descricao + " " + it.previsao_legal),
      raw: it,
    }));
  }
  if (multaState.tipo === "declaracao_rebanho") {
    const info = DATA.infracoes_declaracao_rebanho;
    return [{
      titulo: "Declaração de rebanho fora do prazo",
      meta: info.base_legal,
      searchText: normalize(info.descricao + " " + info.base_legal + " declaracao rebanho fora do prazo"),
      raw: info,
    }];
  }
  // valor_fixo
  const out = [];
  DATA.infracoes_valor_fixo.grupos.forEach((grupo) => {
    grupo.itens.forEach((it) => {
      out.push({
        titulo: it.descricao,
        meta: `${it.previsao_legal} - ${formatURF(grupo.valor_urf)} URF por ${it.por}`,
        searchText: normalize(it.descricao + " " + it.previsao_legal),
        raw: Object.assign({ valor_urf: grupo.valor_urf }, it),
      });
    });
  });
  return out;
}

function renderMultaLista() {
  const container = el("multa-lista-infracoes");
  const itens = multaListaItens().filter((it) => matchesQuery(it.searchText, multaState.busca));
  if (itens.length === 0) {
    container.innerHTML = '<p class="option-empty">Nenhuma infração encontrada.</p>';
    return;
  }
  container.innerHTML = itens.map((it, idx) => `
    <button type="button" class="option-item" data-idx="${idx}">
      <span class="option-title">${it.titulo}</span>
      <span class="option-meta">${it.meta}</span>
    </button>
  `).join("");
  container.querySelectorAll(".option-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectMultaInfracao(itens[Number(btn.dataset.idx)].raw);
    });
  });
}

function showMultaLista() {
  el("multa-detalhe").hidden = true;
  el("multa-lista-infracoes").hidden = false;
}

function selectMultaInfracao(raw) {
  multaState.infracao = raw;
  multaState.rows = [];
  multaState.vfQuantidade = 1;
  multaState.nextRowId = 1;

  if (multaState.tipo === "por_cabeca" || multaState.tipo === "declaracao_rebanho") {
    addMultaRow();
  }

  el("multa-lista-infracoes").hidden = true;
  el("multa-detalhe").hidden = false;
  multaState.reincidencia = false;
  el("multa-reincidencia").checked = false;

  renderMultaInfracaoTexto();
  el("multa-add-linha").hidden = multaState.tipo === "valor_fixo";
  renderMultaLinhas();
  recomputeMulta();
  el("multa-detalhe").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderMultaInfracaoTexto() {
  const box = el("multa-infracao-texto");
  const raw = multaState.infracao;
  if (multaState.tipo === "declaracao_rebanho") {
    box.innerHTML = `<div>${raw.descricao}</div><div class="previsao">${raw.base_legal} &middot; ${raw.medida_adicional}</div>`;
  } else {
    box.innerHTML = `<div>${raw.descricao}</div><div class="previsao">${raw.previsao_legal}</div>`;
  }
}

function addMultaRow() {
  if (multaState.tipo === "por_cabeca") {
    const primeiraEspecie = DATA.tabela_especies_anexo_ii.itens[0].especie;
    multaState.rows.push({ id: multaState.nextRowId++, especie: primeiraEspecie, quantidade: 1, manualUrf: null });
  } else if (multaState.tipo === "declaracao_rebanho") {
    const primeiroGrupo = DATA.infracoes_declaracao_rebanho.itens[0].id;
    multaState.rows.push({ id: multaState.nextRowId++, grupoId: primeiroGrupo, quantidade: 1 });
  }
  renderMultaLinhas();
  recomputeMulta();
}

function removeMultaRow(rowId) {
  multaState.rows = multaState.rows.filter((r) => r.id !== rowId);
  renderMultaLinhas();
  recomputeMulta();
}

function renderMultaLinhas() {
  const container = el("multa-linhas-container");

  if (multaState.tipo === "valor_fixo") {
    const raw = multaState.infracao;
    container.innerHTML = `
      <div class="field-group">
        <label for="vf-quantidade">Quantidade (${raw.por})</label>
        <input type="number" id="vf-quantidade" min="1" step="1" value="${multaState.vfQuantidade}">
      </div>
    `;
    el("vf-quantidade").addEventListener("input", (e) => {
      multaState.vfQuantidade = Math.max(0, Number(e.target.value) || 0);
      recomputeMulta();
    });
    return;
  }

  if (multaState.tipo === "por_cabeca") {
    container.innerHTML = multaState.rows.map((row) => renderSpeciesRowHtml(row)).join("");
  } else if (multaState.tipo === "declaracao_rebanho") {
    container.innerHTML = multaState.rows.map((row) => renderGrupoRowHtml(row)).join("");
  }

  container.querySelectorAll("[data-role='especie-select']").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const rowId = Number(e.target.dataset.rowid);
      const row = multaState.rows.find((r) => r.id === rowId);
      row.especie = e.target.value;
      row.quantidade = 1;
      row.manualUrf = null;
      renderMultaLinhas();
      recomputeMulta();
    });
  });
  container.querySelectorAll("[data-role='grupo-select']").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const rowId = Number(e.target.dataset.rowid);
      const row = multaState.rows.find((r) => r.id === rowId);
      row.grupoId = e.target.value;
      recomputeMulta();
    });
  });
  container.querySelectorAll("[data-role='qty']").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const rowId = Number(e.target.dataset.rowid);
      const row = multaState.rows.find((r) => r.id === rowId);
      row.quantidade = Math.max(0, Number(e.target.value) || 0);
      recomputeMulta();
    });
  });
  container.querySelectorAll("[data-role='manual-urf']").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const rowId = Number(e.target.dataset.rowid);
      const row = multaState.rows.find((r) => r.id === rowId);
      row.manualUrf = Number(e.target.value) || 0;
      recomputeMulta();
    });
  });
  container.querySelectorAll("[data-role='remove-row']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      removeMultaRow(Number(e.target.dataset.rowid));
    });
  });
}

function renderSpeciesRowHtml(row) {
  const especieItem = getEspecieItem(row.especie);
  const options = DATA.tabela_especies_anexo_ii.itens.map((it) =>
    `<option value="${it.especie}" ${it.especie === row.especie ? "selected" : ""}>${it.especie}</option>`
  ).join("");

  let extraField = "";
  if (especieItem.urf === undefined && especieItem.urf_variavel === undefined && especieItem.urf_min !== undefined) {
    extraField = `
      <div class="field-group">
        <label>Valor URF definido (entre ${formatURF(especieItem.urf_min)} e ${formatURF(especieItem.urf_max)})</label>
        <input type="number" step="0.001" min="${especieItem.urf_min}" max="${especieItem.urf_max}"
          data-role="manual-urf" data-rowid="${row.id}" value="${row.manualUrf ?? ""}">
        <div class="field-error" id="manual-err-${row.id}" hidden></div>
      </div>`;
  }

  const qtyLabel = `Quantidade (${especieItem.forma})`;
  const showQty = especieItem.urf_min === undefined || especieItem.urf_variavel !== undefined || especieItem.urf !== undefined;

  return `
    <div class="linha-item">
      <div class="field-group">
        <label>Espécie</label>
        <select data-role="especie-select" data-rowid="${row.id}">${options}</select>
      </div>
      ${showQty ? `
      <div class="field-group">
        <label>${qtyLabel}</label>
        <input type="number" min="0" step="1" data-role="qty" data-rowid="${row.id}" value="${row.quantidade}">
      </div>` : ""}
      <button type="button" class="btn-remove" data-role="remove-row" data-rowid="${row.id}">Remover</button>
      ${extraField}
      ${especieItem.nota ? `<div class="subtotal">${especieItem.nota}</div>` : ""}
      <div class="subtotal" id="subtotal-row-${row.id}"></div>
    </div>
  `;
}

function renderGrupoRowHtml(row) {
  const options = DATA.infracoes_declaracao_rebanho.itens.map((it) =>
    `<option value="${it.id}" ${it.id === row.grupoId ? "selected" : ""}>${it.grupo}</option>`
  ).join("");
  return `
    <div class="linha-item">
      <div class="field-group">
        <label>Grupo</label>
        <select data-role="grupo-select" data-rowid="${row.id}">${options}</select>
      </div>
      <div class="field-group">
        <label>Quantidade (cabeça)</label>
        <input type="number" min="0" step="1" data-role="qty" data-rowid="${row.id}" value="${row.quantidade}">
      </div>
      <button type="button" class="btn-remove" data-role="remove-row" data-rowid="${row.id}">Remover</button>
      <div class="subtotal" id="subtotal-row-${row.id}"></div>
    </div>
  `;
}

function computeSpeciesRowSubtotal(row, multiplicador) {
  const item = getEspecieItem(row.especie);
  let base;
  if (item.urf !== undefined) {
    base = row.quantidade * item.urf;
  } else if (item.urf_variavel !== undefined) {
    base = row.quantidade * item.urf_variavel + item.urf_fixo_por_auto;
  } else {
    // URF manual: usa o valor limitado à faixa permitida
    const raw = row.manualUrf || 0;
    base = raw > 0 ? clamp(raw, item.urf_min, item.urf_max) : 0;
    const err = el(`manual-err-${row.id}`);
    if (err) {
      const fora = raw > 0 && (raw < item.urf_min || raw > item.urf_max);
      err.hidden = !fora;
      if (fora) err.textContent = `Valor fora da faixa permitida (${formatURF(item.urf_min)} a ${formatURF(item.urf_max)} URF). O cálculo usa o limite mais próximo.`;
    }
  }
  return base * multiplicador;
}

function recomputeMulta() {
  if (!multaState.infracao) return;
  let rawTotal = 0;
  const breakdown = [];

  if (multaState.tipo === "por_cabeca") {
    const mult = multaState.infracao.multiplicador;
    multaState.rows.forEach((row) => {
      const subtotal = computeSpeciesRowSubtotal(row, mult);
      rawTotal += subtotal;
      const span = el(`subtotal-row-${row.id}`);
      if (span) span.textContent = `Subtotal: ${formatURF(subtotal)} URF`;
      breakdown.push({ label: row.especie, qtd: row.quantidade, subtotal });
    });
  } else if (multaState.tipo === "declaracao_rebanho") {
    multaState.rows.forEach((row) => {
      const grupoItem = DATA.infracoes_declaracao_rebanho.itens.find((i) => i.id === row.grupoId);
      const subtotal = row.quantidade * grupoItem.urf;
      rawTotal += subtotal;
      const span = el(`subtotal-row-${row.id}`);
      if (span) span.textContent = `Subtotal: ${formatURF(subtotal)} URF`;
      breakdown.push({ label: grupoItem.grupo, qtd: row.quantidade, subtotal });
    });
  } else {
    const raw = multaState.infracao;
    rawTotal = raw.valor_urf * multaState.vfQuantidade;
    breakdown.push({ label: raw.descricao, qtd: multaState.vfQuantidade, subtotal: rawTotal });
  }

  const { total, pisoAplicado } = applyRegrasTransversais(rawTotal, multaState.reincidencia);
  multaState.lastCalc = { total, breakdown, pisoAplicado };
  renderMultaResultado(total, breakdown, pisoAplicado);
}

function buildMultaAutoTexto() {
  const calc = multaState.lastCalc;
  const raw = multaState.infracao;
  const regras = DATA.meta.regras_transversais;
  const urf = DATA.meta.urf_ac;
  const previsao = multaState.tipo === "declaracao_rebanho" ? raw.base_legal : raw.previsao_legal;

  const lines = [];
  lines.push(`INFRAÇÃO: ${raw.descricao}`);
  lines.push(`Previsão legal: ${previsao} do ${DATA.meta.decreto_base}.`);
  lines.push("");
  lines.push("Memória de cálculo:");
  calc.breakdown.forEach((b) => {
    lines.push(`- ${b.label}: ${b.qtd} — subtotal ${formatURF(b.subtotal)} URF`);
  });
  if (multaState.reincidencia) {
    lines.push(`- Reincidência: valor aplicado em dobro (${regras.reincidencia.base_legal}).`);
  }
  if (calc.pisoAplicado) {
    lines.push(`- Aplicado o piso mínimo de ${formatURF(regras.piso_multa_urf.valor)} URF (${regras.piso_multa_urf.base_legal}).`);
  }
  lines.push("");
  lines.push(`VALOR DA MULTA: ${formatURF(calc.total)} URF/AC = ${formatBRL(urfToReais(calc.total))}`);
  lines.push(`(URF/AC ${urf.exercicio} = ${formatBRL(urf.valor_reais)} — ${urf.fonte})`);
  lines.push("");
  lines.push(`Prazo de defesa/recurso: ${regras.prazo_recurso_dias} dias. Parcelamento: até ${regras.parcelamento.max_parcelas} parcelas, parcela mínima de ${formatURF(regras.parcelamento.parcela_minima_urf)} URF, ${regras.parcelamento.juros} (${regras.parcelamento.base_legal}).`);
  if (multaState.tipo === "declaracao_rebanho") {
    lines.push(raw.medida_adicional);
  }
  return lines.join("\n");
}

function renderMultaResultado(total, breakdown, pisoAplicado) {
  const box = el("multa-resultado");
  const warning = getAdvertenciaWarning(total);

  let html = renderResultTotal(total);

  if (breakdown.length > 1 || multaState.tipo !== "valor_fixo") {
    html += `<table class="result-table"><thead><tr><th>Item</th><th>Qtd.</th><th>Subtotal (URF)</th></tr></thead><tbody>`;
    breakdown.forEach((b) => {
      html += `<tr><td>${b.label}</td><td>${b.qtd}</td><td>${formatURF(b.subtotal)}</td></tr>`;
    });
    html += `</tbody></table>`;
  }

  if (multaState.reincidencia) {
    html += `<div class="alert-box info">Reincidência aplicada: valor multiplicado por ${DATA.meta.regras_transversais.reincidencia.multiplicador}.</div>`;
  }
  if (pisoAplicado) {
    html += `<div class="alert-box info">Aplicado o piso mínimo de ${formatURF(DATA.meta.regras_transversais.piso_multa_urf.valor)} URF (${DATA.meta.regras_transversais.piso_multa_urf.base_legal}).</div>`;
  }
  if (warning) {
    html += `<div class="alert-box warning">${warning}</div>`;
  }

  html += renderAutoInfoBox();
  html += `<button type="button" class="btn-copy" id="multa-copiar">Copiar texto para o auto</button>`;

  box.innerHTML = html;
  attachCopyButton("multa-copiar", buildMultaAutoTexto);
}

function resetMultaState() {
  multaState.tipo = "por_cabeca";
  multaState.busca = "";
  multaState.infracao = null;
  multaState.rows = [];
  multaState.vfQuantidade = 1;
  multaState.reincidencia = false;
  multaState.nextRowId = 1;
  multaState.lastCalc = null;
  el("multa-tipo").value = "por_cabeca";
  el("multa-busca").value = "";
  el("multa-detalhe").hidden = true;
  el("multa-lista-infracoes").hidden = false;
  renderMultaLista();
}

function setupMultas() {
  el("multa-tipo").addEventListener("change", (e) => {
    multaState.tipo = e.target.value;
    multaState.infracao = null;
    multaState.rows = [];
    renderMultaLista();
    showMultaLista();
  });
  el("multa-busca").addEventListener("input", (e) => {
    multaState.busca = e.target.value;
    renderMultaLista();
    showMultaLista();
  });
  el("multa-add-linha").addEventListener("click", () => addMultaRow());
  el("multa-reincidencia").addEventListener("change", (e) => {
    multaState.reincidencia = e.target.checked;
    recomputeMulta();
  });
  el("multa-trocar").addEventListener("click", () => showMultaLista());
  renderMultaLista();
}

/* =========================================================
   MÓDULO 2: TAXAS E EMOLUMENTOS
   ========================================================= */

const taxaState = {
  busca: "",
  selecionado: null, // {kind:'taxa'|'lab-group'|'lab-item', data}
  quantidade: 1,
  folhas: 1,
  manualUrf: null,
  lastTotal: null,
};

const LAB_GROUP_TITULO = "Diagnóstico laboratorial";

function taxaListaItens() {
  const labPrevisaoLegal = DATA.taxas_emolumentos.diagnostico_laboratorial.previsao_legal;
  const itens = DATA.taxas_emolumentos.itens.map((it) => ({
    titulo: it.descricao,
    meta: `${it.previsao_legal} - ${it.remete_para ? "ver aba GTA" : formatURF(it.urf) + " URF (" + it.unidade + ")"}`,
    searchText: normalize(it.descricao + " " + it.previsao_legal),
    raw: { kind: "taxa", data: it },
  }));
  itens.push({
    titulo: LAB_GROUP_TITULO,
    meta: `${labPrevisaoLegal} - escolha o exame`,
    searchText: normalize("diagnostico laboratorial exame amostra " + labPrevisaoLegal),
    raw: { kind: "lab-group", data: { descricao: LAB_GROUP_TITULO, previsao_legal: labPrevisaoLegal } },
  });
  return itens;
}

function renderTaxaLista() {
  const container = el("taxa-lista");
  const itens = taxaListaItens().filter((it) => matchesQuery(it.searchText, taxaState.busca));
  if (itens.length === 0) {
    container.innerHTML = '<p class="option-empty">Nenhuma taxa encontrada.</p>';
    return;
  }
  container.innerHTML = itens.map((it, idx) => `
    <button type="button" class="option-item" data-idx="${idx}">
      <span class="option-title">${it.titulo}</span>
      <span class="option-meta">${it.meta}</span>
    </button>
  `).join("");
  container.querySelectorAll(".option-item").forEach((btn) => {
    btn.addEventListener("click", () => selectTaxa(itens[Number(btn.dataset.idx)].raw));
  });
}

function showTaxaLista() {
  el("taxa-detalhe").hidden = true;
  el("taxa-lista").hidden = false;
}

function selectTaxa(sel) {
  taxaState.selecionado = sel;
  taxaState.quantidade = 1;
  taxaState.folhas = 1;
  taxaState.manualUrf = null;
  el("taxa-lista").hidden = true;
  el("taxa-detalhe").hidden = false;
  renderTaxaDetalhe();
  el("taxa-detalhe").scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildTaxaCopiaTexto() {
  const sel = taxaState.selecionado;
  const it = sel.data;
  const urf = DATA.meta.urf_ac;
  const previsao = sel.kind === "lab-item" ? DATA.taxas_emolumentos.diagnostico_laboratorial.previsao_legal : it.previsao_legal;
  const lines = [];
  lines.push(`TAXA: ${it.descricao}`);
  lines.push(`Previsão legal: ${previsao} do ${DATA.meta.decreto_base}.`);
  if (sel.kind === "taxa" && it.id === "tx_IX") {
    lines.push(`Folhas: ${taxaState.folhas}`);
  } else {
    lines.push(`Quantidade: ${taxaState.quantidade} (${it.unidade})`);
  }
  lines.push(`VALOR: ${formatURF(taxaState.lastTotal)} URF/AC = ${formatBRL(urfToReais(taxaState.lastTotal))}`);
  lines.push(`(URF/AC ${urf.exercicio} = ${formatBRL(urf.valor_reais)} — ${urf.fonte})`);
  return lines.join("\n");
}

function renderTaxaDetalhe() {
  const sel = taxaState.selecionado;
  const texto = el("taxa-infracao-texto");
  const campos = el("taxa-campos");
  const resultado = el("taxa-resultado");

  if (sel.kind === "taxa") {
    const it = sel.data;
    texto.innerHTML = `<div>${it.descricao}</div><div class="previsao">${it.previsao_legal}</div>`;

    if (it.remete_para) {
      campos.innerHTML = "";
      resultado.innerHTML = `<div class="alert-box info">Esta taxa é calculada na aba GTA.</div>
        <button type="button" class="btn-primary" id="taxa-ir-gta">Ir para GTA</button>`;
      el("taxa-ir-gta").addEventListener("click", () => showView("view-gta"));
      return;
    }

    if (it.id === "tx_IX") {
      campos.innerHTML = `
        <div class="field-group">
          <label for="taxa-folhas">Número de folhas</label>
          <input type="number" id="taxa-folhas" min="1" step="1" value="${taxaState.folhas}">
        </div>`;
      el("taxa-folhas").addEventListener("input", (e) => {
        taxaState.folhas = Math.max(1, Number(e.target.value) || 1);
        recomputeTaxa();
      });
      recomputeTaxa();
      return;
    }

    campos.innerHTML = `
      <div class="field-group">
        <label for="taxa-quantidade">Quantidade (${it.unidade})</label>
        <input type="number" id="taxa-quantidade" min="0" step="1" value="${taxaState.quantidade}">
      </div>`;
    el("taxa-quantidade").addEventListener("input", (e) => {
      taxaState.quantidade = Math.max(0, Number(e.target.value) || 0);
      recomputeTaxa();
    });
    recomputeTaxa();
    return;
  }

  if (sel.kind === "lab-group") {
    texto.innerHTML = `<div>${sel.data.descricao}</div><div class="previsao">${sel.data.previsao_legal}</div>`;
    const labItens = DATA.taxas_emolumentos.diagnostico_laboratorial.itens;
    campos.innerHTML = `<div class="option-list" id="taxa-lab-lista"></div>`;
    const listaEl = el("taxa-lab-lista");
    listaEl.innerHTML = labItens.map((it, idx) => `
      <button type="button" class="option-item" data-idx="${idx}">
        <span class="option-title">${it.descricao}</span>
        <span class="option-meta">${it.unidade} ${it.urf !== undefined ? "- " + formatURF(it.urf) + " URF" : ""}</span>
      </button>
    `).join("");
    listaEl.querySelectorAll(".option-item").forEach((btn) => {
      btn.addEventListener("click", () => selectTaxa({ kind: "lab-item", data: labItens[Number(btn.dataset.idx)] }));
    });
    resultado.innerHTML = "";
    return;
  }

  if (sel.kind === "lab-item") {
    const it = sel.data;
    texto.innerHTML = `<div>${it.descricao}</div><div class="previsao">${DATA.taxas_emolumentos.diagnostico_laboratorial.previsao_legal}</div>`;

    if (it.urf === 0) {
      campos.innerHTML = "";
      resultado.innerHTML = `<div class="alert-box gratuito">Exame gratuito (0 URF).</div>`;
      return;
    }

    if (it.urf_min !== undefined) {
      campos.innerHTML = `
        <div class="field-group">
          <label>Valor URF definido (entre ${formatURF(it.urf_min)} e ${formatURF(it.urf_max)})</label>
          <input type="number" id="taxa-manual-urf" step="0.01" min="${it.urf_min}" max="${it.urf_max}" value="${taxaState.manualUrf ?? it.urf_min}">
          <div class="field-error" id="taxa-manual-err" hidden></div>
        </div>
        <div class="field-group">
          <label for="taxa-quantidade">Quantidade (${it.unidade})</label>
          <input type="number" id="taxa-quantidade" min="0" step="1" value="${taxaState.quantidade}">
        </div>`;
      el("taxa-manual-urf").addEventListener("input", (e) => {
        taxaState.manualUrf = Number(e.target.value) || 0;
        recomputeTaxa();
      });
      el("taxa-quantidade").addEventListener("input", (e) => {
        taxaState.quantidade = Math.max(0, Number(e.target.value) || 0);
        recomputeTaxa();
      });
      taxaState.manualUrf = it.urf_min;
      recomputeTaxa();
      return;
    }

    campos.innerHTML = `
      <div class="field-group">
        <label for="taxa-quantidade">Quantidade (${it.unidade})</label>
        <input type="number" id="taxa-quantidade" min="0" step="1" value="${taxaState.quantidade}">
      </div>`;
    el("taxa-quantidade").addEventListener("input", (e) => {
      taxaState.quantidade = Math.max(0, Number(e.target.value) || 0);
      recomputeTaxa();
    });
    recomputeTaxa();
  }
}

function recomputeTaxa() {
  const sel = taxaState.selecionado;
  let total = 0;

  if (sel.kind === "taxa") {
    const it = sel.data;
    if (it.id === "tx_IX") {
      total = it.urf + Math.max(0, taxaState.folhas - 1) * it.urf_folha_adicional;
    } else {
      total = it.urf * taxaState.quantidade;
    }
  } else if (sel.kind === "lab-item") {
    const it = sel.data;
    let taxa;
    if (it.urf_min !== undefined) {
      const raw = taxaState.manualUrf || 0;
      taxa = raw > 0 ? clamp(raw, it.urf_min, it.urf_max) : 0;
      const err = el("taxa-manual-err");
      if (err) {
        const fora = raw > 0 && (raw < it.urf_min || raw > it.urf_max);
        err.hidden = !fora;
        if (fora) err.textContent = `Valor fora da faixa permitida (${formatURF(it.urf_min)} a ${formatURF(it.urf_max)} URF). O cálculo usa o limite mais próximo.`;
      }
    } else {
      taxa = it.urf;
    }
    total = taxa * taxaState.quantidade;
  } else {
    return;
  }

  taxaState.lastTotal = total;
  el("taxa-resultado").innerHTML = renderResultTotal(total) +
    `<button type="button" class="btn-copy" id="taxa-copiar">Copiar resultado</button>`;
  attachCopyButton("taxa-copiar", buildTaxaCopiaTexto);
}

function resetTaxaState() {
  taxaState.busca = "";
  taxaState.selecionado = null;
  taxaState.quantidade = 1;
  taxaState.folhas = 1;
  taxaState.manualUrf = null;
  taxaState.lastTotal = null;
  el("taxa-busca").value = "";
  el("taxa-detalhe").hidden = true;
  el("taxa-lista").hidden = false;
  renderTaxaLista();
}

function setupTaxas() {
  el("taxa-busca").addEventListener("input", (e) => {
    taxaState.busca = e.target.value;
    renderTaxaLista();
    showTaxaLista();
  });
  el("taxa-trocar").addEventListener("click", () => showTaxaLista());
  renderTaxaLista();
}

/* =========================================================
   MÓDULO 3: GTA
   ========================================================= */

const gtaState = {
  busca: "",
  selecionado: null,
  quantidade: 1,
  lastTotal: null,
  lastDetalhe: "",
};

/* Regra de faixa dos alevinos (vem do JSON: regra_faixa) */
function getAlevinosFaixa(item) {
  const base = item.regra_faixa.find((f) => f.ate_milheiros !== undefined);
  const adicional = item.regra_faixa.find((f) => f.acima_milheiros !== undefined);
  return { base, adicional };
}

function renderGtaLista() {
  const container = el("gta-lista");
  const itens = DATA.tabela_gta_anexo_iii.itens.filter((it) =>
    matchesQuery(normalize(it.grupo + " " + it.unidade), gtaState.busca)
  );
  if (itens.length === 0) {
    container.innerHTML = '<p class="option-empty">Nenhum item encontrado.</p>';
    return;
  }
  container.innerHTML = itens.map((it, idx) => `
    <button type="button" class="option-item" data-idx="${idx}">
      <span class="option-title">${it.grupo}</span>
      <span class="option-meta">${it.unidade}</span>
    </button>
  `).join("");
  container.querySelectorAll(".option-item").forEach((btn) => {
    btn.addEventListener("click", () => selectGta(itens[Number(btn.dataset.idx)]));
  });
}

function showGtaLista() {
  el("gta-detalhe").hidden = true;
  el("gta-lista").hidden = false;
}

function selectGta(item) {
  gtaState.selecionado = item;
  gtaState.quantidade = 1;
  el("gta-lista").hidden = true;
  el("gta-detalhe").hidden = false;
  el("gta-infracao-texto").innerHTML = `<div>GTA: ${item.grupo}</div><div class="previsao">${DATA.tabela_gta_anexo_iii.base_legal}</div>`;

  const campos = el("gta-campos");
  let label = "Quantidade";
  if (item.id === "gta_peixes_alevinos") label = "Quantidade de alevinos";
  else if (item.id === "gta_peixes_pescado") label = "Toneladas";
  else if (item.tamanho_grupo) label = `Quantidade (${item.grupo.toLowerCase()})`;
  else if (item.unidade.includes("documento")) label = "Número de documentos (GTA)";
  else label = "Quantidade de animais";

  campos.innerHTML = `
    <div class="field-group">
      <label for="gta-quantidade">${label}</label>
      <input type="number" id="gta-quantidade" min="0" step="${item.id === "gta_peixes_pescado" ? "0.01" : "1"}" value="${gtaState.quantidade}">
    </div>`;
  el("gta-quantidade").addEventListener("input", (e) => {
    gtaState.quantidade = Math.max(0, Number(e.target.value) || 0);
    recomputeGta();
  });
  recomputeGta();
  el("gta-detalhe").scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildGtaCopiaTexto() {
  const item = gtaState.selecionado;
  const urf = DATA.meta.urf_ac;
  const lines = [];
  lines.push(`GTA: ${item.grupo}`);
  lines.push(`Previsão legal: ${DATA.tabela_gta_anexo_iii.base_legal} do ${DATA.meta.decreto_base}.`);
  lines.push(`Quantidade informada: ${gtaState.quantidade}${gtaState.lastDetalhe ? " (" + gtaState.lastDetalhe + ")" : ""}`);
  lines.push(`VALOR: ${formatURF(gtaState.lastTotal)} URF/AC = ${formatBRL(urfToReais(gtaState.lastTotal))}`);
  lines.push(`(URF/AC ${urf.exercicio} = ${formatBRL(urf.valor_reais)} — ${urf.fonte})`);
  return lines.join("\n");
}

function recomputeGta() {
  const item = gtaState.selecionado;
  const qtd = gtaState.quantidade;
  let total = 0;
  let detalhe = "";

  if (item.id === "gta_peixes_alevinos") {
    if (qtd > 0) {
      const { base, adicional } = getAlevinosFaixa(item);
      const milheiros = Math.ceil(qtd / 1000);
      if (milheiros <= base.ate_milheiros) {
        total = base.urf;
      } else {
        total = base.urf + (milheiros - base.ate_milheiros) * adicional.urf_por_milheiro_ou_fracao_adicional;
      }
      detalhe = `${milheiros} milheiro(s) ou fração`;
    }
  } else if (item.id === "gta_peixes_pescado") {
    const toneladas = Math.ceil(qtd);
    total = toneladas * item.urf;
    detalhe = `${toneladas} tonelada(s) ou fração`;
  } else if (item.tamanho_grupo) {
    const grupos = Math.ceil(qtd / item.tamanho_grupo);
    total = grupos * item.urf;
    detalhe = `${grupos} grupo(s) de até ${item.tamanho_grupo}`;
  } else {
    total = qtd * item.urf;
  }

  gtaState.lastTotal = total;
  gtaState.lastDetalhe = detalhe;
  el("gta-resultado").innerHTML = renderResultTotal(total) +
    (detalhe ? `<p class="text-muted">${detalhe}</p>` : "") +
    `<button type="button" class="btn-copy" id="gta-copiar">Copiar resultado</button>`;
  attachCopyButton("gta-copiar", buildGtaCopiaTexto);
}

function resetGtaState() {
  gtaState.busca = "";
  gtaState.selecionado = null;
  gtaState.quantidade = 1;
  gtaState.lastTotal = null;
  gtaState.lastDetalhe = "";
  el("gta-busca").value = "";
  el("gta-detalhe").hidden = true;
  el("gta-lista").hidden = false;
  renderGtaLista();
}

function setupGta() {
  el("gta-busca").addEventListener("input", (e) => {
    gtaState.busca = e.target.value;
    renderGtaLista();
    showGtaLista();
  });
  el("gta-trocar").addEventListener("click", () => showGtaLista());
  renderGtaLista();
}

/* =========================================================
   MÓDULO 4: BUSCA GERAL
   ========================================================= */

let searchIndex = [];

function buildSearchIndex() {
  const idx = [];

  DATA.infracoes_por_cabeca.itens.forEach((it) => {
    idx.push({
      descricao: it.descricao,
      previsao_legal: it.previsao_legal,
      refValor: `${it.multiplicador}x URF da espécie (Anexo II), por ${it.por}`,
    });
  });

  DATA.infracoes_declaracao_rebanho.itens.forEach((it) => {
    idx.push({
      descricao: `Declarar rebanho fora do prazo: ${it.grupo}`,
      previsao_legal: it.previsao_legal,
      refValor: `${formatURF(it.urf)} URF por ${it.por}`,
    });
  });

  DATA.infracoes_valor_fixo.grupos.forEach((grupo) => {
    grupo.itens.forEach((it) => {
      idx.push({
        descricao: it.descricao,
        previsao_legal: it.previsao_legal,
        refValor: `${formatURF(grupo.valor_urf)} URF por ${it.por}`,
      });
    });
  });

  DATA.taxas_emolumentos.itens.forEach((it) => {
    idx.push({
      descricao: it.descricao,
      previsao_legal: it.previsao_legal,
      refValor: it.remete_para ? "Ver aba GTA" : `${formatURF(it.urf)} URF (${it.unidade})`,
    });
  });

  DATA.taxas_emolumentos.diagnostico_laboratorial.itens.forEach((it) => {
    let ref;
    if (it.urf === 0) ref = "Gratuito";
    else if (it.urf_min !== undefined) ref = `${formatURF(it.urf_min)} a ${formatURF(it.urf_max)} URF (${it.unidade})`;
    else ref = `${formatURF(it.urf)} URF (${it.unidade})`;
    idx.push({
      descricao: it.descricao,
      previsao_legal: DATA.taxas_emolumentos.diagnostico_laboratorial.previsao_legal,
      refValor: ref,
    });
  });

  DATA.tabela_gta_anexo_iii.itens.forEach((it) => {
    let ref;
    if (it.regra_faixa) {
      const base = it.regra_faixa.find((f) => f.ate_milheiros !== undefined);
      const adicional = it.regra_faixa.find((f) => f.acima_milheiros !== undefined);
      ref = `Até ${base.ate_milheiros} milheiros: ${formatURF(base.urf)} URF; acima, +${formatURF(adicional.urf_por_milheiro_ou_fracao_adicional)} URF por milheiro ou fração`;
    } else if (it.tamanho_grupo) {
      ref = `${formatURF(it.urf)} URF a cada grupo de ${it.tamanho_grupo}`;
    } else {
      ref = `${formatURF(it.urf)} URF ${it.unidade}`;
    }
    idx.push({
      descricao: `GTA: ${it.grupo}`,
      previsao_legal: DATA.tabela_gta_anexo_iii.base_legal,
      refValor: ref,
    });
  });

  idx.forEach((it) => {
    it.searchText = normalize(it.descricao + " " + it.previsao_legal);
  });

  searchIndex = idx;
}

function renderBuscaGeral() {
  const container = el("busca-geral-resultados");
  const q = el("busca-geral").value;
  const itens = searchIndex.filter((it) => matchesQuery(it.searchText, q));
  if (itens.length === 0) {
    container.innerHTML = '<p class="option-empty">Nenhum resultado encontrado.</p>';
    return;
  }
  container.innerHTML = itens.map((it) => `
    <div class="detail-box">
      <div class="infracao-texto">
        <div>${it.descricao}</div>
        <div class="previsao">${it.previsao_legal}</div>
      </div>
      <p><strong>Valor de referência:</strong> ${it.refValor}</p>
    </div>
  `).join("");
}

function resetBuscaState() {
  el("busca-geral").value = "";
  renderBuscaGeral();
}

function setupBusca() {
  el("busca-geral").addEventListener("input", () => renderBuscaGeral());
  renderBuscaGeral();
}

/* ---------------- Inicialização ---------------- */

async function init() {
  try {
    const res = await fetch("data/idaf_infracoes.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (e) {
    el("app").innerHTML = `<div class="alert-box warning" style="margin:16px">
      Não foi possível carregar a base de dados do aplicativo. Verifique sua
      conexão com a internet (necessária no primeiro acesso) e tente novamente.
    </div>`;
    el("footer-urf").textContent = "Erro ao carregar dados";
    return;
  }

  renderFooter();
  renderOrgaoInfo();
  setupNav();
  setupMultas();
  setupTaxas();
  setupGta();
  buildSearchIndex();
  setupBusca();

  const isLocalDev = ["localhost", "127.0.0.1"].includes(location.hostname);
  if ("serviceWorker" in navigator) {
    if (isLocalDev) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.unregister());
      });
    } else {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  }
}

init();

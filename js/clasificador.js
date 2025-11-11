// =================== RUTAS ===================
const RULES_URL_DEFAULT = "data/reglas_asociacion.json";

// =================== ESTADO ===================
let RULES = null;
let EXPANSION_SPEC = null;
let chart = null;

// =================== DOM (App) ===================
const $fields = document.getElementById("dynamic-fields");
const $form   = document.getElementById("form-clasificador");
const $res    = document.getElementById("resultado");
const $exp    = document.getElementById("explicacion");
const $ver    = document.getElementById("version");
const $chipV  = document.getElementById("chip-version");

const $btnLimpiar = document.getElementById("btn-limpiar");
const $btnDemo = document.getElementById("btn-demo");
const $fileJson = document.getElementById("file-json");
const $spinSubmit = document.getElementById("spin-submit");

const $dash = {
  features: document.getElementById("dash-features"),
  dim: document.getElementById("dash-dim"),
  centroids: document.getElementById("dash-centroids"),
  last: document.getElementById("dash-last"),
};

// =================== UTILIDADES ===================
const el = (tag, attrs = {}, inner = "") => {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") n.className = v;
    else if (k === "for") n.htmlFor = v;
    else if (v === true) n.setAttribute(k, "");
    else if (v === false || v == null) { /* ignore */ }
    else n.setAttribute(k, v);
  });
  if (inner) n.innerHTML = inner;
  return n;
};

const euclidean = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
};

const withSpinner = async (fn) => {
  if ($spinSubmit) $spinSubmit.classList.remove("d-none");
  try { return await fn(); } finally { if ($spinSubmit) $spinSubmit.classList.add("d-none"); }
};

// =================== RENDER ===================
function renderFields(features) {
  $fields.innerHTML = "";
  features.forEach((f, idx) => {
    const col = el("div", { class: "col-md-6" });
    const id = `fld_${idx}`;
    const group = el("div", { class: "form-floating" });

    if (f.type === "num") {
      const input = el("input", {
        type: "number", id, name: f.name, class: "form-control",
        min: f.min, max: f.max, step: "any", required: true, placeholder: f.label
      });
      if (typeof f.default === "number") input.value = f.default;
      const label = el("label", { for: id }, f.label);
      group.appendChild(input); group.appendChild(label);
      const help = el("div", { class: "form-text" }, `Límites: ${f.min} – ${f.max}`);
      col.appendChild(group); col.appendChild(help);
    }

    if (f.type === "ord" || f.type === "nom") {
      const opts = f.type === "ord" ? f.order : f.values;
      const select = el("select", { id, name: f.name, class: "form-select", required: true });
      select.appendChild(el("option", { value: "" }, "Selecciona..."));
      opts.forEach(v => {
        const o = el("option", { value: v }, v);
        if (f.default === v) o.selected = true;
        select.appendChild(o);
      });
      const label = el("label", { for: id }, f.label);
      group.appendChild(select); group.appendChild(label);
      const help = el("div", { class: "form-text" }, `Opciones: ${opts.join(" · ")}`);
      col.appendChild(group); col.appendChild(help);
    }

    $fields.appendChild(col);
  });
}

function buildExpansionSpec(features) {
  const spec = []; let cursor = 0;
  features.forEach(f => {
    if (f.type === "num") {
      spec.push({ name: f.name, type: "num", startIndex: cursor, length: 1, meta: { mean: f.mean, std: f.std } });
      cursor += 1;
    } else if (f.type === "ord") {
      spec.push({ name: f.name, type: "ord", startIndex: cursor, length: 1, meta: { order: f.order } });
      cursor += 1;
    } else if (f.type === "nom") {
      spec.push({ name: f.name, type: "nom", startIndex: cursor, length: f.values.length, meta: { values: f.values } });
      cursor += f.values.length;
    }
  });
  return { spec, vectorLength: cursor };
}

function encodeFormToVector(features, spec) {
  const { vectorLength } = spec; const v = new Array(vectorLength).fill(0);
  features.forEach(f => {
    const s = spec.spec.find(x => x.name === f.name); if (!s) return;
    const elInput = document.querySelector(`[name="${f.name}"]`);
    const raw = elInput?.value;

    if (f.type === "num") {
      if (raw === "" || raw == null) throw new Error(`Campo requerido: ${f.label ?? f.name}`);
      const x = Number(raw); const mu = Number(s.meta.mean ?? 0); const sd = Number(s.meta.std ?? 1);
      v[s.startIndex] = sd ? (x - mu) / sd : x;
    }
    if (f.type === "ord") {
      const order = s.meta.order || []; if (raw === "") throw new Error(`Selecciona un valor en ${f.label ?? f.name}`);
      const idx = order.indexOf(raw); if (idx === -1) throw new Error(`Valor no permitido en ${f.label ?? f.name}`);
      v[s.startIndex] = idx;
    }
    if (f.type === "nom") {
      const values = s.meta.values || []; if (raw === "") throw new Error(`Selecciona un valor en ${f.label ?? f.name}`);
      const pos = values.indexOf(raw); if (pos === -1) throw new Error(`Valor no permitido en ${f.label ?? f.name}`);
      for (let i = 0; i < values.length; i++) v[s.startIndex + i] = (i === pos) ? 1 : 0;
    }
  });
  return v;
}

function predictCluster(vec, centroids) {
  const dists = centroids.map(c => ({ cluster: c.cluster, dist: euclidean(vec, c.vector) }));
  dists.sort((a, b) => a.dist - b.dist);
  return { best: dists[0], ranking: dists };
}

function renderResultado(pred, vec) {
  const { best, ranking } = pred;

  $res.innerHTML = `
    <div class="display-6 mb-2">Cluster <span class="badge text-bg-info">#${best.cluster}</span></div>
    <div class="text-muted">Distancia al centroide: <strong>${best.dist.toFixed(4)}</strong></div>
    <div class="mt-2 small text-muted">Vector (z/índice/one-hot): <code>${vec.map(x => Number(x).toFixed(3)).join(", ")}</code></div>
  `;
  $exp.innerHTML = `Asignación por <em>centroide más cercano</em> en el espacio transformado: <code>num → z-score</code>, <code>ord → índice</code>, <code>nom → one-hot</code>. Verifica <code>mean/std</code> y el orden del JSON.`;

  const $tbody = document.getElementById("tabla-ranking");
  if ($tbody) $tbody.innerHTML = ranking.map(r => `<tr><td>Cluster ${r.cluster}</td><td>${r.dist.toFixed(4)}</td></tr>`).join("");

  if ($dash.last) $dash.last.textContent = `#${best.cluster}`;

  renderChart(ranking);
}

function renderChart(ranking) {
  const canvas = document.getElementById("chart-dists");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const labels = ranking.map(r => `C${r.cluster}`);
  const data = ranking.map(r => r.dist);
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Distancia al centroide", data }] },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.raw.toFixed(4)}` } }
      },
      scales: {
        x: { grid: { color: "rgba(127,127,127,.15)" } },
        y: { beginAtZero: true, grid: { color: "rgba(127,127,127,.15)" } }
      }
    }
  });
}

function clearForm() {
  if ($form) $form.reset();
  $res.innerHTML = `<p class="text-muted mb-0">Aún no hay resultado. Completa el formulario y presiona <strong>Clasificar</strong>.</p>`;
  $exp.innerHTML = "";
  const $tbody = document.getElementById("tabla-ranking");
  if ($tbody) $tbody.innerHTML = `<tr><td colspan="2" class="text-muted">—</td></tr>`;
  if (chart) { chart.destroy(); chart = null; }
  if ($dash.last) $dash.last.textContent = "–";
}

// =================== INIT ===================
async function loadRulesFromUrl(url) {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function updateDashboardMeta() {
  if (!RULES || !EXPANSION_SPEC) return;
  $ver.textContent = `reglas v${RULES.version ?? "–"}`;
  if ($chipV) $chipV.textContent = `v${RULES.version ?? "–"}`;
  $dash.features.textContent = RULES.feature_space?.length ?? 0;
  $dash.dim.textContent = EXPANSION_SPEC.vectorLength ?? 0;
  $dash.centroids.textContent = RULES.centroids?.length ?? 0;
}

async function init(rules) {
  RULES = rules;
  renderFields(RULES.feature_space);
  EXPANSION_SPEC = buildExpansionSpec(RULES.feature_space);
  updateDashboardMeta();

  // Restaurar última entrada si existía
  try {
    const last = JSON.parse(localStorage.getItem("clasif:lastValues") || "null");
    if (last) Object.entries(last).forEach(([name, val]) => {
      const el = document.querySelector(`[name="${name}"]`); if (el) el.value = val;
    });
  } catch {}
}

// =================== EVENTOS ===================
document.addEventListener("keydown", (e) => { if (e.key === "Escape") clearForm(); });

$form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!$form.checkValidity()) { $form.classList.add("was-validated"); return; }

  await withSpinner(async () => {
    try {
      const vec = encodeFormToVector(RULES.feature_space, EXPANSION_SPEC);
      RULES.centroids.forEach(c => {
        if (c.vector.length !== EXPANSION_SPEC.vectorLength) {
          throw new Error(`Dimensión del centroide ${c.cluster} (${c.vector.length}) ≠ espacio (${EXPANSION_SPEC.vectorLength}).`);
        }
      });
      const pred = predictCluster(vec, RULES.centroids);
      renderResultado(pred, vec);

      const values = {};
      RULES.feature_space.forEach(f => { const el = document.querySelector(`[name="${f.name}"]`); values[f.name] = el?.value ?? null; });
      localStorage.setItem("clasif:lastValues", JSON.stringify(values));
    } catch (err) {
      $res.innerHTML = `<div class="alert alert-danger">⚠️ ${err.message}</div>`;
      $exp.innerHTML = "";
    }
  });
});

document.getElementById("btn-limpiar")?.addEventListener("click", clearForm);

$fileJson?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    await init(json);
    $ver.textContent = `${$ver.textContent} (local)`;
    if ($chipV) $chipV.textContent = `${$chipV.textContent} (local)`;
  } catch (err) {
    alert("No se pudo leer el JSON: " + err.message);
  }
});

$btnDemo?.addEventListener("click", () => {
  if (!RULES) return;
  RULES.feature_space.forEach(f => {
    const el = document.querySelector(`[name="${f.name}"]`);
    if (!el) return;
    if (f.type === "num") {
      const mid = (Number(f.min ?? 0) + Number(f.max ?? 0)) / 2;
      el.value = (f.default ?? mid).toString();
    }
    if (f.type === "ord") el.value = f.default ?? f.order?.[0] ?? "";
    if (f.type === "nom") el.value = f.default ?? f.values?.[0] ?? "";
  });
});

// Cargar reglas por defecto
(async () => {
  try {
    const rules = await loadRulesFromUrl(RULES_URL_DEFAULT);
    await init(rules);
  } catch (err) {
    $res.innerHTML = `<div class="alert alert-warning">
      No se pudieron cargar las reglas (<code>${RULES_URL_DEFAULT}</code>): ${err.message}.<br>
      Usa el botón <strong>Cargar JSON</strong> de la barra lateral.
    </div>`;
  }
})();


// Mapeo de explicación por cluster (no toca tu lógica actual)
const CLUSTER_EXPLAIN = {
  0: {
    etiqueta: "Cliente C",
    color: "warning",
    titulo: "Cluster #0 — Clientes Potenciales C",
    resumen: "Segmento de menor potencial: ingresos y gasto bajos, perfil conservador.",
    bullets: [
      "Ingreso y monto de dinero por debajo del promedio.",
      "Mayor proporción de casados, menor casa propia.",
      "Historial relativamente estable, bajo riesgo pero menor valor.",
    ],
    nota: "Estrategia: ofertas básicas, educación financiera, cross-sell gradual.",
  },
  1: {
    etiqueta: "Cliente B",
    color: "info",
    titulo: "Cluster #1 — Clientes Potenciales B",
    resumen: "Segmento medio: jóvenes/activos, propietarios, gasto moderado-alto.",
    bullets: [
      "Ingreso medio/alto y consumo moderado-alto.",
      "Más propietarios y mayor propensión a comprar catálogos.",
      "Historial medio: requiere seguimiento y fidelización.",
    ],
    nota: "Estrategia: bundles, programas de puntos, upgrade de productos.",
  },
  2: {
    etiqueta: "Cliente A",
    color: "success",
    titulo: "Cluster #2 — Clientes Potenciales A",
    resumen: "Alto valor: ingresos y gasto elevados, mayoría propietarios.",
    bullets: [
      "Ingreso ≫ promedio y alto monto de dinero.",
      "Perfil joven con fuerte capacidad de compra.",
      "Historial más exigente: cuidar experiencia y límites.",
    ],
    nota: "Estrategia: premium/upsell, atención prioritaria, beneficios exclusivos.",
  },
  3: {
    etiqueta: "Cliente AA",
    color: "primary",
    titulo: "Cluster #3 — Clientes Potenciales AA",
    resumen: "Top del portafolio: muy alto potencial y fidelidad.",
    bullets: [
      "Comportamiento estable y valor sostenido.",
      "Excelente respuesta a campañas de valor agregado.",
      "Alta probabilidad de recompra.",
    ],
    nota: "Estrategia: VIP, early-access, pricing relacional, retención proactiva.",
  },
};

// Función que pinta la explicación en el card nuevo
function renderExplicacionCluster(clusterId) {
  const box = document.getElementById("explicacion-cliente");
  if (!box) return;

  const cfg = CLUSTER_EXPLAIN[clusterId];
  if (!cfg) {
    box.innerHTML = `
      <p class="text-muted mb-0">No hay explicación disponible para este cluster.</p>
    `;
    return;
  }

  box.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-2">
      <span class="badge bg-${cfg.color}" style="font-size:0.9rem;">${cfg.etiqueta}</span>
      <span class="text-muted small">clasificación comercial</span>
    </div>

    <h5 class="mb-1">${cfg.titulo}</h5>
    <p class="mb-3">${cfg.resumen}</p>

    <ul class="mb-3">
      ${cfg.bullets.map(b => `<li>${b}</li>`).join("")}
    </ul>

    <div class="alert alert-${cfg.color} mb-0" role="alert">
      <i class="bi bi-stars me-1"></i> <strong>Recomendación:</strong> ${cfg.nota}
    </div>
  `;
}

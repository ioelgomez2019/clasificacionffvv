// js/clasificador.js
const RULES_URL = "data/reglas_asociacion.json";

const $fields = document.getElementById("dynamic-fields");
const $form   = document.getElementById("form-clasificador");
const $res    = document.getElementById("resultado");
const $exp    = document.getElementById("explicacion");
const $ver    = document.getElementById("version");
const $btnLimpiar = document.getElementById("btn-limpiar");

let RULES = null;     // reglas cargadas
let EXPANSION_SPEC = []; // describe cómo expandir a vector numérico

// ---------- utilidades ----------
const el = (tag, attrs = {}, inner = "") => {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") n.className = v;
    else if (k === "for") n.htmlFor = v;
    else n.setAttribute(k, v);
  });
  if (inner) n.innerHTML = inner;
  return n;
};

function euclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// Construir inputs dinámicamente según feature_space
function renderFields(features) {
  $fields.innerHTML = "";
  features.forEach((f, idx) => {
    const col = el("div", { class: "col-md-6" });
    const id = `fld_${idx}`;

    const formGroup = el("div", { class: "form-floating" });

    if (f.type === "num") {
      const input = el("input", {
        type: "number",
        id,
        name: f.name,
        class: "form-control",
        min: f.min,
        max: f.max,
        step: "any",
        required: "true",
        placeholder: f.label
      });
      const label = el("label", { for: id }, `${f.label}`);
      formGroup.appendChild(input);
      formGroup.appendChild(label);

      const help = el(
        "div",
        { class: "form-text" },
        `Límites: ${f.min} – ${f.max}`
      );

      col.appendChild(formGroup);
      col.appendChild(help);
    }

    if (f.type === "ord" || f.type === "nom") {
      const opts = f.type === "ord" ? f.order : f.values;
      const select = el("select", {
        id, name: f.name, class: "form-select", required: "true"
      });
      select.appendChild(el("option", { value: "" }, "Selecciona..."));
      opts.forEach(v => {
        select.appendChild(el("option", { value: v }, v));
      });
      const label = el("label", { for: id }, `${f.label}`);
      formGroup.appendChild(select);
      formGroup.appendChild(label);

      const help = el(
        "div",
        { class: "form-text" },
        `Opciones: ${opts.join(" · ")}`
      );

      col.appendChild(formGroup);
      col.appendChild(help);
    }

    $fields.appendChild(col);
  });
}

// Genera especificación de expansión para codificación -> vector numérico
function buildExpansionSpec(features) {
  // Cada item: { name, type, startIndex, length, meta }
  const spec = [];
  let cursor = 0;

  features.forEach(f => {
    if (f.type === "num") {
      spec.push({
        name: f.name,
        type: "num",
        startIndex: cursor,
        length: 1,
        meta: { mean: f.mean, std: f.std }
      });
      cursor += 1;
    } else if (f.type === "ord") {
      spec.push({
        name: f.name,
        type: "ord",
        startIndex: cursor,
        length: 1,
        meta: { order: f.order } // índice ordinal 0..n-1
      });
      cursor += 1;
    } else if (f.type === "nom") {
      spec.push({
        name: f.name,
        type: "nom",
        startIndex: cursor,
        length: f.values.length,
        meta: { values: f.values } // one-hot en este orden
      });
      cursor += f.values.length;
    }
  });

  return { spec, vectorLength: cursor };
}

// Toma valores del form y los transforma al vector del espacio modelo
function encodeFormToVector(features, spec) {
  const { vectorLength } = spec;
  const v = new Array(vectorLength).fill(0);

  features.forEach(f => {
    const s = spec.spec.find(x => x.name === f.name);
    if (!s) return;

    const elInput = document.querySelector(`[name="${f.name}"]`);
    const raw = elInput?.value;

    if (f.type === "num") {
      if (raw === "" || raw == null) throw new Error(`Campo requerido: ${f.name}`);
      const x = Number(raw);
      const mu = s.meta.mean || 0;
      const sd = s.meta.std || 1;
      v[s.startIndex] = sd ? (x - mu) / sd : x;
    }

    if (f.type === "ord") {
      const order = s.meta.order || [];
      const idx = order.indexOf(raw);
      if (idx === -1) throw new Error(`Valor no permitido en ${f.name}`);
      v[s.startIndex] = idx; // ordinal puro como en el entrenamiento
    }

    if (f.type === "nom") {
      const values = s.meta.values || [];
      const pos = values.indexOf(raw);
      if (pos === -1) throw new Error(`Valor no permitido en ${f.name}`);
      // one-hot
      for (let i = 0; i < values.length; i++) {
        v[s.startIndex + i] = (i === pos) ? 1 : 0;
      }
    }
  });

  return v;
}

// Clasificar por centroide más cercano
function predictCluster(vec, centroids) {
  const dists = centroids.map(c => ({
    cluster: c.cluster,
    dist: euclidean(vec, c.vector)
  }));
  dists.sort((a, b) => a.dist - b.dist);
  return { best: dists[0], ranking: dists };
}

// Mostrar resultado
function renderResultado(pred, vec) {
  const { best, ranking } = pred;

  $res.innerHTML = `
    <div class="display-6 mb-2">Cluster <span class="badge bg-primary">${best.cluster}</span></div>
    <div class="text-muted">Distancia al centroide: <strong>${best.dist.toFixed(3)}</strong></div>
    <div class="mt-3">
      <details>
        <summary>Ver ranking de distancias</summary>
        <ul class="mt-2 mb-0">
          ${ranking.map(r => `<li>Cluster ${r.cluster}: ${r.dist.toFixed(3)}</li>`).join("")}
        </ul>
      </details>
    </div>
  `;

  $exp.innerHTML = `
    La asignación se realiza por <em>vecino centroide más cercano</em> en el espacio transformado:
    <code>num → z-score</code>, <code>ordinal → índice</code>, <code>nominal → one-hot</code>.<br>
    Asegúrate de que las medias/desvíos y el orden de categorías del JSON coincidan con el modelo con el que calculaste los centroides.
  `;
}

// Limpiar formulario
function clearForm() {
  $form.reset();
  $res.innerHTML = `<p class="text-muted mb-0">Aún no hay resultado. Completa el formulario y presiona <strong>Clasificar</strong>.</p>`;
  $exp.innerHTML = "";
}

// ---------- init ----------
async function init() {
  const resp = await fetch(RULES_URL);
  RULES = await resp.json();
  $ver.textContent = `reglas v${RULES.version}`;

  renderFields(RULES.feature_space);
  const built = buildExpansionSpec(RULES.feature_space);
  EXPANSION_SPEC = built;

  // Validación básica HTML5 + clasificación
  $form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!$form.checkValidity()) {
      $form.classList.add("was-validated");
      return;
    }
    try {
      const vec = encodeFormToVector(RULES.feature_space, EXPANSION_SPEC);
      // seguridad: chequear que centroides matchean dimensionalidad
      RULES.centroids.forEach(c => {
        if (c.vector.length !== EXPANSION_SPEC.vectorLength) {
          throw new Error(`Dimensión del centroide ${c.cluster} (${c.vector.length}) no coincide con el espacio (${EXPANSION_SPEC.vectorLength}).`);
        }
      });

      const pred = predictCluster(vec, RULES.centroids);
      renderResultado(pred, vec);
    } catch (err) {
      $res.innerHTML = `<div class="alert alert-danger">⚠️ ${err.message}</div>`;
      $exp.innerHTML = "";
    }
  });

  $btnLimpiar.addEventListener("click", clearForm);

  clearForm();
}

init().catch(err => {
  $res.innerHTML = `<div class="alert alert-danger">
    No se pudieron cargar las reglas: ${err.message}. ¿Estás sirviendo el sitio desde un servidor local?
  </div>`;
});

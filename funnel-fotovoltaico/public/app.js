(() => {
  const STEPS = [
    { key: "immobile", q: "Che tipo di immobile vuoi alimentare?", cols: true, options: [
      { v: "casa", ico: "🏠", t: "Casa indipendente" },
      { v: "condominio", ico: "🏢", t: "Appartamento / condominio" },
      { v: "azienda", ico: "🏭", t: "Azienda o capannone" },
      { v: "altro", ico: "📍", t: "Altro" } ] },
    { key: "tetto", q: "Com'è il tetto o la superficie disponibile?", cols: true, options: [
      { v: "inclinato", ico: "⛰️", t: "Tetto a falde (inclinato)" },
      { v: "piano", ico: "▭", t: "Tetto piano / terrazzo" },
      { v: "non so", ico: "❔", t: "Non lo so" } ] },
    { key: "bolletta", q: "Quanto spendi di luce al mese?", hint: "Una stima va benissimo.", cols: true, options: [
      { v: "sotto 60", t: "Meno di 60 €" },
      { v: "60-120", t: "Tra 60 e 120 €" },
      { v: "120-200", t: "Tra 120 e 200 €" },
      { v: "oltre 200", t: "Più di 200 €" },
      { v: "non so", t: "Non lo so" } ] },
    { key: "accumulo", q: "Ti interessa una batteria di accumulo?", hint: "Permette di usare di sera l'energia prodotta di giorno.", options: [
      { v: "si", t: "Sì, voglio l'accumulo" },
      { v: "no", t: "No, solo i pannelli" },
      { v: "da valutare", t: "Da valutare con il tecnico" } ] },
    { key: "tempistica", q: "Quando vorresti installare l'impianto?", options: [
      { v: "subito", t: "Il prima possibile" },
      { v: "3 mesi", t: "Entro 3 mesi" },
      { v: "6 mesi", t: "Entro 6 mesi" },
      { v: "solo info", t: "Sto solo valutando" } ] },
    { key: "localita", q: "Dove si trova l'immobile?", hint: "Serve a scegliere il tecnico più vicino a te.", fields: "localita" },
    { key: "contatti", q: "Dove ti inviamo il preventivo?", hint: "Ti ricontatteremo per confermare i dettagli.", fields: "contatti" },
  ];

  const $ = (s) => document.querySelector(s);
  const stage = $("#stage"), bar = $("#bar"), count = $("#stepCount");
  const btnNext = $("#next"), btnBack = $("#back"), errBox = $("#error");
  const answers = {};
  let i = 0;

  // Origine traffico (UTM, gclid): utile per capire quali campagne portano richieste
  const params = new URLSearchParams(location.search);
  const track = {};
  ["utm_source", "utm_medium", "utm_campaign", "utm_term", "gclid"].forEach((k) => {
    let v = params.get(k);
    try {
      if (v) sessionStorage.setItem(k, v); else v = sessionStorage.getItem(k);
    } catch (_) {}
    if (v) track[k] = v;
  });

  fetch("/api/config").then((r) => r.json()).then((c) => {
    document.title = `Preventivo fotovoltaico gratuito | ${c.azienda}`;
    $("#brand").textContent = c.azienda;
    $("#footBrand").textContent = c.azienda;
    if (c.telefono) {
      const a = $("#telLink");
      a.textContent = c.telefono;
      a.href = "tel:" + c.telefono.replace(/[^\d+]/g, "");
      a.hidden = false;
    }
  }).catch(() => {});

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    kids.flat().forEach((c) => n.append(c));
    return n;
  };

  function showError(msg) { errBox.textContent = msg; errBox.hidden = !msg; }

  function field(id, label, type, extra = {}) {
    const input = el("input", { type, id, name: id, ...extra });
    input.value = answers[id] || "";
    input.addEventListener("input", () => { answers[id] = input.value; input.classList.remove("bad"); });
    return el("div", {}, el("label", { for: id }, label), input);
  }

  function render() {
    const s = STEPS[i];
    showError("");
    stage.replaceChildren();
    bar.style.width = `${(i / STEPS.length) * 100}%`;
    count.textContent = `Passaggio ${i + 1} di ${STEPS.length}`;
    btnBack.hidden = i === 0;
    btnNext.textContent = i === STEPS.length - 1 ? "Richiedi il preventivo" : "Continua";
    btnNext.hidden = !!s.options; // le domande a scelta avanzano da sole

    stage.append(el("h2", { class: "q" }, s.q));
    if (s.hint) stage.append(el("p", { class: "hint" }, s.hint));

    if (s.options) {
      const box = el("div", { class: "options" + (s.cols ? " cols" : ""), role: "radiogroup" });
      s.options.forEach((o) => {
        const b = el("button", {
          type: "button", class: "opt" + (answers[s.key] === o.v ? " sel" : ""), role: "radio",
          "aria-checked": String(answers[s.key] === o.v),
          onclick: () => { answers[s.key] = o.v; next(); },
        }, o.ico ? el("span", { class: "ico" }, o.ico) : "", el("span", {}, o.t));
        box.append(b);
      });
      stage.append(box);
    } else if (s.fields === "localita") {
      stage.append(el("div", { class: "fields" },
        field("cap", "CAP", "text", { inputmode: "numeric", maxlength: "5", autocomplete: "postal-code", placeholder: "es. 80100" }),
        field("comune", "Comune (facoltativo)", "text", { autocomplete: "address-level2" })));
    } else if (s.fields === "contatti") {
      const consent = el("input", { type: "checkbox", id: "consenso" });
      consent.checked = !!answers.consenso;
      consent.addEventListener("change", () => { answers.consenso = consent.checked; });
      stage.append(el("div", { class: "fields" },
        el("div", { class: "row2" },
          field("nome", "Nome", "text", { autocomplete: "given-name" }),
          field("cognome", "Cognome", "text", { autocomplete: "family-name" })),
        el("div", { class: "row2" },
          field("telefono", "Telefono", "tel", { autocomplete: "tel", inputmode: "tel" }),
          field("email", "Email", "email", { autocomplete: "email" })),
        el("label", { class: "consent", for: "consenso" }, consent,
          el("span", {}, "Ho letto l'",
            el("a", { href: "privacy.html", target: "_blank", rel: "noopener" }, "informativa privacy"),
            " e acconsento a essere ricontattato per il preventivo."))));
    }
    const first = stage.querySelector("input");
    if (first && window.matchMedia("(min-width: 560px)").matches) first.focus();
  }

  function validate() {
    const s = STEPS[i];
    const bad = [];
    if (s.fields === "localita") {
      if (!/^\d{5}$/.test((answers.cap || "").trim())) bad.push(["cap", "Inserisci un CAP di 5 cifre."]);
    }
    if (s.fields === "contatti") {
      if ((answers.nome || "").trim().length < 2) bad.push(["nome", "Inserisci il tuo nome."]);
      else if ((answers.cognome || "").trim().length < 2) bad.push(["cognome", "Inserisci il tuo cognome."]);
      else if (!/^[+\d][\d\s().-]{6,}$/.test((answers.telefono || "").trim())) bad.push(["telefono", "Inserisci un numero di telefono valido."]);
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((answers.email || "").trim())) bad.push(["email", "Inserisci un indirizzo email valido."]);
      else if (!answers.consenso) bad.push(["consenso", "Per procedere serve il consenso al trattamento dei dati."]);
    }
    if (bad.length) {
      showError(bad[0][1]);
      const f = document.getElementById(bad[0][0]);
      if (f && f.type !== "checkbox") { f.classList.add("bad"); f.focus(); }
      return false;
    }
    return true;
  }

  async function invia() {
    btnNext.disabled = true;
    btnNext.textContent = "Invio in corso…";
    try {
      const body = { ...answers, ...track, sito_web: document.querySelector(".hp").value };
      const r = await fetch("/api/leads", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.errore || "Invio non riuscito. Riprova.");
      $("#form").hidden = true;
      $("#done").hidden = false;
      $("#doneName").textContent = (answers.nome || "").trim();
      bar.style.width = "100%";
      count.textContent = "Completato";
      if (window.gtag) window.gtag("event", "generate_lead");
      if (window.fbq) window.fbq("track", "Lead");
    } catch (e) {
      showError(e.message || "Errore di rete. Riprova.");
      btnNext.disabled = false;
      btnNext.textContent = "Richiedi il preventivo";
    }
  }

  function next() {
    if (STEPS[i].options && !answers[STEPS[i].key]) { showError("Seleziona una risposta per continuare."); return; }
    if (!validate()) return;
    if (i === STEPS.length - 1) return invia();
    i++; render();
  }

  btnNext.addEventListener("click", next);
  btnBack.addEventListener("click", () => { if (i > 0) { i--; render(); } });
  $("#form").addEventListener("submit", (e) => { e.preventDefault(); next(); });
  render();
})();

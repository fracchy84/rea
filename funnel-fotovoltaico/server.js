import express from "express";
import nodemailer from "nodemailer";
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Configurazione (variabili d'ambiente) ----------
const PORT = Number(process.env.PORT || 3000);
const AZIENDA_NOME = process.env.AZIENDA_NOME || "La tua azienda";
const AZIENDA_TELEFONO = process.env.AZIENDA_TELEFONO || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "leads.db");

if (!ADMIN_PASSWORD) {
  console.warn(
    "ATTENZIONE: ADMIN_PASSWORD non impostata. Il pannello /admin è disattivato."
  );
}

// ---------- Database ----------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    nome TEXT NOT NULL,
    cognome TEXT NOT NULL,
    telefono TEXT NOT NULL,
    email TEXT NOT NULL,
    cap TEXT NOT NULL,
    comune TEXT,
    immobile TEXT,
    tetto TEXT,
    bolletta TEXT,
    accumulo TEXT,
    tempistica TEXT,
    note_cliente TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_term TEXT,
    gclid TEXT,
    stato TEXT NOT NULL DEFAULT 'nuova',
    assegnata_a TEXT,
    note_interne TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_leads_stato ON leads(stato);
  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
`);

const STATI = [
  "nuova",
  "contattata",
  "sopralluogo",
  "preventivo inviato",
  "venduta",
  "girata a installatore",
  "persa",
];

// Valori ammessi per le risposte del funnel (stesse chiavi usate nel front-end)
const OPZIONI = {
  immobile: ["casa", "condominio", "azienda", "altro"],
  tetto: ["inclinato", "piano", "non so"],
  bolletta: ["sotto 60", "60-120", "120-200", "oltre 200", "non so"],
  accumulo: ["si", "no", "da valutare"],
  tempistica: ["subito", "3 mesi", "6 mesi", "solo info"],
};

// ---------- Email ----------
let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

async function notificaLead(lead) {
  const righe = [
    ["Nome", `${lead.nome} ${lead.cognome}`],
    ["Telefono", lead.telefono],
    ["Email", lead.email],
    ["CAP / Comune", `${lead.cap} ${lead.comune || ""}`.trim()],
    ["Immobile", lead.immobile],
    ["Tetto", lead.tetto],
    ["Bolletta mensile", lead.bolletta],
    ["Accumulo", lead.accumulo],
    ["Tempistica", lead.tempistica],
    ["Note", lead.note_cliente],
    ["Origine", [lead.utm_source, lead.utm_medium, lead.utm_campaign].filter(Boolean).join(" / ")],
  ].filter(([, v]) => v);

  const subject = `Nuova richiesta preventivo: ${lead.nome} ${lead.cognome} (${lead.cap})`;
  const text = righe.map(([k, v]) => `${k}: ${v}`).join("\n");
  const html = `<h2>Nuova richiesta di preventivo</h2><table cellpadding="6">${righe
    .map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`)
    .join("")}</table>`;

  if (!transporter || !NOTIFY_EMAIL) {
    console.log("[email non configurata] " + subject + "\n" + text);
    return;
  }
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER || NOTIFY_EMAIL,
    to: NOTIFY_EMAIL,
    replyTo: lead.email,
    subject,
    text,
    html,
  });
}

// ---------- Sessione admin (cookie firmato, senza dipendenze) ----------
const COOKIE = "admin_session";
const SESSION_MS = 12 * 60 * 60 * 1000;

const sign = (value) =>
  crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");

function creaSessione() {
  const exp = String(Date.now() + SESSION_MS);
  return `${exp}.${sign(exp)}`;
}

function sessioneValida(token) {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig) return false;
  const atteso = sign(exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(atteso);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(exp) > Date.now();
}

function leggiCookie(req, nome) {
  const raw = req.headers.cookie || "";
  for (const parte of raw.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nome) return decodeURIComponent(v.join("="));
  }
  return null;
}

function richiediAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ errore: "Pannello disattivato" });
  if (!sessioneValida(leggiCookie(req, COOKIE))) {
    return res.status(401).json({ errore: "Non autorizzato" });
  }
  next();
}

// ---------- Rate limit semplice in memoria ----------
const finestre = new Map();
function limita(chiave, max, ms) {
  const ora = Date.now();
  const lista = (finestre.get(chiave) || []).filter((t) => ora - t < ms);
  if (lista.length >= max) {
    finestre.set(chiave, lista);
    return false;
  }
  lista.push(ora);
  finestre.set(chiave, lista);
  return true;
}
setInterval(() => finestre.clear(), 60 * 60 * 1000).unref();

// ---------- App ----------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.get("/api/config", (req, res) => {
  res.json({ azienda: AZIENDA_NOME, telefono: AZIENDA_TELEFONO });
});

const pulisci = (v, max = 200) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

app.post("/api/leads", async (req, res) => {
  const b = req.body || {};

  // Honeypot: i bot compilano il campo nascosto, le persone no
  if (b.sito_web) return res.json({ ok: true });

  if (!limita("lead:" + req.ip, 5, 60 * 60 * 1000)) {
    return res.status(429).json({ errore: "Troppe richieste. Riprova più tardi." });
  }

  const lead = {
    nome: pulisci(b.nome, 60),
    cognome: pulisci(b.cognome, 60),
    telefono: pulisci(b.telefono, 25),
    email: pulisci(b.email, 120).toLowerCase(),
    cap: pulisci(b.cap, 5),
    comune: pulisci(b.comune, 80),
    immobile: pulisci(b.immobile, 30),
    tetto: pulisci(b.tetto, 30),
    bolletta: pulisci(b.bolletta, 30),
    accumulo: pulisci(b.accumulo, 30),
    tempistica: pulisci(b.tempistica, 30),
    note_cliente: pulisci(b.note_cliente, 500),
    utm_source: pulisci(b.utm_source, 100),
    utm_medium: pulisci(b.utm_medium, 100),
    utm_campaign: pulisci(b.utm_campaign, 150),
    utm_term: pulisci(b.utm_term, 150),
    gclid: pulisci(b.gclid, 200),
  };

  const errori = [];
  if (lead.nome.length < 2) errori.push("nome");
  if (lead.cognome.length < 2) errori.push("cognome");
  if (!/^[+\d][\d\s().-]{6,}$/.test(lead.telefono)) errori.push("telefono");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) errori.push("email");
  if (!/^\d{5}$/.test(lead.cap)) errori.push("cap");
  if (b.consenso !== true) errori.push("consenso");
  for (const [campo, valori] of Object.entries(OPZIONI)) {
    if (!valori.includes(lead[campo])) errori.push(campo);
  }
  if (errori.length) {
    return res.status(400).json({ errore: "Dati non validi", campi: errori });
  }

  const cols = Object.keys(lead);
  const stmt = db.prepare(
    `INSERT INTO leads (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
  );
  const r = stmt.run(...cols.map((c) => lead[c]));

  res.json({ ok: true, id: Number(r.lastInsertRowid) });

  // Email in background: un errore SMTP non deve far perdere la richiesta
  notificaLead(lead).catch((e) => console.error("Invio email fallito:", e.message));
});

// ----- Admin -----
app.post("/api/admin/login", (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ errore: "Pannello disattivato" });
  if (!limita("login:" + req.ip, 8, 15 * 60 * 1000)) {
    return res.status(429).json({ errore: "Troppi tentativi. Riprova tra qualche minuto." });
  }
  const dato = Buffer.from(String(req.body?.password ?? ""));
  const vero = Buffer.from(ADMIN_PASSWORD);
  const ok = dato.length === vero.length && crypto.timingSafeEqual(dato, vero);
  if (!ok) return res.status(401).json({ errore: "Password errata" });

  const secure = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(creaSessione())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`
  );
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get("/api/admin/me", richiediAdmin, (req, res) => res.json({ ok: true, stati: STATI }));

app.get("/api/admin/leads", richiediAdmin, (req, res) => {
  const stato = pulisci(req.query.stato, 40);
  const q = pulisci(req.query.q, 80);
  const where = [];
  const args = [];
  if (stato && STATI.includes(stato)) {
    where.push("stato = ?");
    args.push(stato);
  }
  if (q) {
    where.push("(nome LIKE ? OR cognome LIKE ? OR email LIKE ? OR telefono LIKE ? OR cap LIKE ? OR comune LIKE ?)");
    for (let i = 0; i < 6; i++) args.push(`%${q}%`);
  }
  const sql = `SELECT * FROM leads ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT 500`;
  const leads = db.prepare(sql).all(...args);
  const conteggi = Object.fromEntries(
    db.prepare("SELECT stato, COUNT(*) AS n FROM leads GROUP BY stato").all().map((r) => [r.stato, r.n])
  );
  res.json({ leads, conteggi, stati: STATI });
});

app.patch("/api/admin/leads/:id", richiediAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ errore: "ID non valido" });
  const b = req.body || {};
  const campi = [];
  const args = [];
  if (b.stato !== undefined) {
    if (!STATI.includes(b.stato)) return res.status(400).json({ errore: "Stato non valido" });
    campi.push("stato = ?");
    args.push(b.stato);
  }
  if (b.assegnata_a !== undefined) {
    campi.push("assegnata_a = ?");
    args.push(pulisci(b.assegnata_a, 120));
  }
  if (b.note_interne !== undefined) {
    campi.push("note_interne = ?");
    args.push(pulisci(b.note_interne, 2000));
  }
  if (!campi.length) return res.status(400).json({ errore: "Niente da aggiornare" });
  const r = db.prepare(`UPDATE leads SET ${campi.join(", ")} WHERE id = ?`).run(...args, id);
  if (!r.changes) return res.status(404).json({ errore: "Richiesta non trovata" });
  res.json({ ok: true });
});

app.get("/api/admin/export.csv", richiediAdmin, (req, res) => {
  const righe = db.prepare("SELECT * FROM leads ORDER BY id DESC").all();
  const colonne = righe.length ? Object.keys(righe[0]) : ["id"];
  // Neutralizza le formule (=, +, -, @) per evitare injection aprendo il CSV in Excel
  const cella = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [colonne.join(";"), ...righe.map((r) => colonne.map((c) => cella(r[c])).join(";"))].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="richieste-preventivo.csv"');
  res.send("﻿" + csv);
});

// ----- Pagine statiche -----
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.listen(PORT, () => {
  console.log(`Funnel attivo su http://localhost:${PORT}  (pannello: /admin)`);
});

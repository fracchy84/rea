# Funnel preventivi fotovoltaico

Webapp per raccogliere richieste di preventivo fotovoltaico: form a passaggi per il cliente,
salvataggio delle richieste, email di notifica e pannello `/admin` per gestirle
(stato, installatore a cui è girata, note, esportazione CSV).

Testi, grafica e logica sono originali: l'app è ispirata a un funnel di preventivi, non è una copia di un sito esistente.

## Avvio

Serve Node.js 22.13 o superiore.

```bash
cd funnel-fotovoltaico
npm install
cp .env.example .env   # poi compila i valori
node --env-file=.env server.js
```

- Funnel: http://localhost:3000
- Pannello: http://localhost:3000/admin (password = `ADMIN_PASSWORD`)

## Configurazione (`.env`)

| Variabile | A cosa serve |
|---|---|
| `AZIENDA_NOME`, `AZIENDA_TELEFONO` | Compaiono in testata e nel footer |
| `ADMIN_PASSWORD` | Password del pannello (obbligatoria, scegline una lunga) |
| `NOTIFY_EMAIL` + `SMTP_*` | Email a ogni nuova richiesta. Senza SMTP le richieste si salvano comunque |
| `DB_PATH` | Percorso del database SQLite (default `data/leads.db`) |

## Prima di pubblicarlo

- Sostituisci `public/privacy.html` con l'informativa GDPR della tua azienda. Se giri i contatti
  a installatori terzi, indicalo nell'informativa e nel testo del consenso.
- Pubblicalo su un hosting con **disco persistente** (il database è un file) e con HTTPS.
- Per le campagne Google Ads il funnel salva `utm_*` e `gclid`. Per tracciare le conversioni
  aggiungi il tuo tag Google nell'`<head>` di `public/index.html`: a invio riuscito parte `gtag('event','generate_lead')`.

## Struttura

- `server.js`: API, database SQLite, email, login admin
- `public/index.html`, `app.js`, `style.css`: funnel
- `public/admin.html`: pannello richieste

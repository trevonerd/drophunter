# 🚀 Installazione Rapida - Twitch Drops Manager

## 📦 Installazione in 5 minuti

### 1️⃣ **Scarica l'estensione**

L'estensione è già compilata nella cartella `dist/` del progetto.

Se non vedi la cartella `dist/`, esegui:

```bash
npm install
npm run build
```

### 2️⃣ **Apri Chrome**

Apri il browser Google Chrome

### 3️⃣ **Vai alle Estensioni**

- Digita nella barra degli indirizzi: `chrome://extensions/`
- Oppure: Menu (⋮) → Altri strumenti → Estensioni

### 4️⃣ **Attiva Modalità Sviluppatore**

In alto a destra, attiva il toggle **"Modalità sviluppatore"**

### 5️⃣ **Carica l'estensione**

- Clicca **"Carica estensione non pacchettizzata"**
- Seleziona la cartella **`dist`** dentro il progetto twitch-extension
- Clicca "Seleziona cartella"

### ✅ **Fatto!**

L'icona dell'estensione apparirà nella toolbar di Chrome!

---

## 🎮 Come Usare

### Primo Utilizzo

1. **Vai su Twitch Drops**
   - Apri https://www.twitch.tv/drops/campaigns
   - Assicurati di essere loggato

2. **Apri l'estensione**
   - Clicca l'icona dell'estensione nella toolbar
   - Vedrai una finestra popup viola in tema Twitch

3. **Seleziona un gioco**
   - Nel menu dropdown, scegli un gioco con drop attivi
   - Se non vedi giochi, ricarica la pagina Twitch drops e riapri l'estensione

4. **Avvia il farming**
   - Clicca il pulsante **"Avvia" ▶️**
   - L'estensione aprirà una tab con uno streamer (mutata)

5. **Monitora i progressi**
   - Apri il popup per vedere:
     - ✅ Streamer attivo
     - 📊 Progress bar del drop corrente
     - ✅ Lista drop completati

### Controlli

- **⏸️ Pausa**: Ferma temporaneamente il farming (mantiene la tab aperta)
- **▶️ Riprendi**: Continua il farming
- **⏹️ Stop**: Ferma completamente e chiude la tab

---

## ⚠️ Risoluzione Problemi

### L'estensione non si carica

**Errore:** "Impossibile caricare l'estensione"

**Soluzione:**
```bash
cd /percorso/al/progetto/twitch-extension
npm install
npm run build
```

Poi ricarica la cartella `dist/` in Chrome

### Non vedo i giochi nel dropdown

**Problema:** Il dropdown è vuoto

**Soluzione:**
1. Vai su https://www.twitch.tv/drops/campaigns
2. Attendi che la pagina carichi completamente
3. Ricarica la pagina (F5)
4. Riapri il popup dell'estensione
5. I giochi dovrebbero apparire dopo 2-3 secondi

### Il progresso non si aggiorna

**Problema:** La progress bar è ferma

**Nota:** Attualmente l'estensione usa dati simulati per il demo. Il progresso aumenta automaticamente ogni 30 secondi.

Per implementazione reale con dati Twitch:
- Serve integrazione API Twitch OAuth
- O scraping più avanzato della pagina

### Errore "manifest.json non trovato"

**Soluzione:**
```bash
npm run build
```

Verifica che in `dist/` ci sia `manifest.json`

### Le icone non si vedono

**Soluzione:**
```bash
# Genera nuove icone
python3 scripts/create-icons-simple.py

# Rebuilda
npm run build
```

---

## 🔧 Build da Sviluppatore

### Requisiti

- Node.js 18+ e npm
- Python 3 (per generare icone)

### Installazione dipendenze

```bash
npm install
```

### Genera icone

```bash
python3 scripts/create-icons-simple.py
```

### Build production

```bash
npm run build
```

### Build development

```bash
npm run dev
```

---

## 📝 Note Tecniche

### Compatibilità

- ✅ Google Chrome 88+
- ✅ Microsoft Edge 88+
- ✅ Brave Browser
- ❌ Firefox (usa Manifest V2)
- ❌ Safari

### Permessi Richiesti

L'estensione richiede:
- `storage`: Per salvare lo stato
- `tabs`: Per aprire/chiudere tab
- `scripting`: Per interagire con pagine Twitch
- Host: `twitch.tv/*`

### Dati Salvati

Salvati localmente nel browser:
- Gioco selezionato
- Stato running/paused
- Drop completati
- ID tab attiva

**Nessun dato viene inviato a server esterni.**

---

## 🆘 Supporto

Hai problemi? Controlla:

1. Console Chrome: `chrome://extensions/` → Dettagli → Ispeziona visualizzazioni: Service worker
2. Console pagina: F12 sulla pagina Twitch
3. Verifica versione Chrome: `chrome://version/`

---

**Buon farming! 🎮✨**

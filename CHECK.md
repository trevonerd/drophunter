# ✅ Checklist Verifica Estensione

## 📋 Verifica Pre-Installazione

Prima di caricare in Chrome, assicurati che:

### File Essenziali nella cartella `dist/`

- [ ] `manifest.json` presente
- [ ] `popup.html` presente
- [ ] `background.js` presente
- [ ] `content.js` presente
- [ ] Cartella `assets/` presente con file CSS e JS
- [ ] Cartella `icons/` presente con 4 icone PNG (16, 32, 48, 128)

### Verifica Rapida

```bash
# Controlla che tutti i file siano presenti
ls -la dist/

# Dovrebbe mostrare:
# - manifest.json
# - popup.html
# - background.js
# - content.js
# - icons/ (con icon16.png, icon32.png, icon48.png, icon128.png)
# - assets/ (con file CSS e JS)
```

## 🔍 Test di Base

### 1. Caricamento Estensione

- [ ] L'estensione si carica senza errori in `chrome://extensions/`
- [ ] L'icona appare nella toolbar
- [ ] Non ci sono errori rossi nella pagina delle estensioni

### 2. Popup Funzionante

- [ ] Cliccando l'icona si apre il popup
- [ ] Il popup ha colori viola/tema Twitch
- [ ] Non ci sono errori nella console (F12)

### 3. Interazione con Twitch

- [ ] Vai su https://www.twitch.tv/drops/campaigns
- [ ] Apri il popup dell'estensione
- [ ] I giochi dovrebbero apparire nel dropdown dopo 2-3 secondi

### 4. Funzionalità Base

- [ ] Puoi selezionare un gioco dal dropdown
- [ ] Il pulsante "Avvia" diventa cliccabile dopo la selezione
- [ ] Cliccando "Avvia" si apre una nuova tab

## 🐛 Errori Comuni e Soluzioni

### Errore: "manifest.json not found"

```bash
npm run build
```

### Errore: "Cannot load extension"

```bash
npm run setup
```

### Il popup non si apre

1. Vai su `chrome://extensions/`
2. Trova "Twitch Drops Manager"
3. Clicca "Ricarica"

### Nessun gioco nel dropdown

1. Vai su https://www.twitch.tv/drops/campaigns
2. Ricarica la pagina (F5)
3. Attendi 2-3 secondi
4. Riapri il popup

### Errori nella console

1. Apri `chrome://extensions/`
2. Trova l'estensione
3. Clicca "ispeziona visualizzazioni: service worker"
4. Controlla gli errori

## ✨ Test Completo Passato!

Se tutto funziona:
- ✅ Estensione caricata correttamente
- ✅ Popup si apre e ha grafica corretta
- ✅ Giochi appaiono nel dropdown
- ✅ Pulsanti funzionano

**L'estensione è pronta all'uso! 🎉**

---

## 📞 Hai Problemi?

Vedi il file [INSTALLAZIONE.md](INSTALLAZIONE.md) per troubleshooting dettagliato.

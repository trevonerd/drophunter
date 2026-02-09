# 🎮 Twitch Drops Manager - Chrome Extension

Un'estensione Chrome moderna e accattivante per gestire automaticamente i drop di Twitch. Monitora, colleziona e traccia i tuoi drop preferiti in modo intelligente!

## ✨ Caratteristiche

- 🎯 **Selezione Giochi**: Seleziona facilmente i giochi con drop attivi
- ▶️ **Controlli Play/Pause**: Gestisci il farming dei drop quando vuoi
- 📊 **Tracking Progressi**: Monitora in tempo reale la percentuale di completamento
- ✅ **Lista Drop Completati**: Visualizza tutti i drop già ottenuti
- 🎨 **UI Moderna**: Interfaccia accattivante con tema Twitch
- 🔇 **Tab Mutate**: Apre streamer in tab mutate automaticamente
- 💾 **Persistenza Stato**: Salva automaticamente lo stato anche dopo il riavvio

## 🛠️ Tecnologie

- **React 18** - UI moderna e reattiva
- **TypeScript** - Type safety completo
- **Vite** - Build velocissimo
- **Tailwind CSS** - Styling professionale
- **Chrome Extension API V3** - Ultima versione delle API

## 📦 Installazione Semplicissima

### ⚡ Metodo Veloce (CONSIGLIATO)

La cartella `dist/` contiene già l'estensione compilata!

1. Apri Chrome → `chrome://extensions/`
2. Attiva **"Modalità sviluppatore"** (toggle in alto a destra)
3. Clicca **"Carica estensione non pacchettizzata"**
4. Seleziona la cartella **`dist/`**
5. ✅ **Pronto!** L'estensione è installata!

### 🔨 Build da Zero (opzionale)

Solo se vuoi ricompilare:

```bash
npm install
npm run build
```

**Fatto!** Le icone sono già incluse, nessun setup complicato necessario.

---

## 🚀 Come Usare

1. **Apri la pagina Drops di Twitch**:
   - Vai su https://www.twitch.tv/drops/campaigns
   - L'estensione rileverà automaticamente i giochi disponibili

2. **Apri il Popup**:
   - Clicca sull'icona dell'estensione nella toolbar

3. **Seleziona un Gioco**:
   - Scegli un gioco dalla select dropdown

4. **Avvia il Farming**:
   - Clicca il pulsante "Avvia" ▶️
   - L'estensione aprirà uno streamer con drop attivi (mutato)

5. **Monitora i Progressi**:
   - Vedi in tempo reale il progresso dei drop
   - Usa "Pausa" ⏸️ per fermare temporaneamente
   - Usa "Stop" ⏹️ per terminare completamente

6. **Drop Completati**:
   - L'estensione continuerà automaticamente fino al completamento di tutti i drop
   - I drop completati appariranno nella lista dedicata

## 📁 Struttura del Progetto

```
twitch-extension/
├── public/
│   ├── icons/              # Icone dell'estensione
│   └── manifest.json       # Manifest Chrome Extension
├── src/
│   ├── popup/              # UI React del popup
│   │   ├── App.tsx         # Componente principale
│   │   ├── main.tsx        # Entry point
│   │   └── index.css       # Stili con Tailwind
│   ├── content/            # Content script per Twitch
│   │   └── content-script.ts
│   ├── background/         # Service worker background
│   │   └── service-worker.ts
│   └── types/              # TypeScript types
│       └── index.ts
├── scripts/                # Script di utility
│   ├── generate-icons.html
│   └── generate-icons.js
├── popup.html              # HTML del popup
├── vite.config.ts          # Configurazione Vite
├── tailwind.config.js      # Configurazione Tailwind
└── package.json
```

## 🎨 Personalizzazione

### Colori Twitch

I colori del tema Twitch sono configurabili in `tailwind.config.js`:

```javascript
colors: {
  twitch: {
    purple: '#9146FF',
    'purple-dark': '#772CE8',
    dark: '#18181B',
    // ...
  }
}
```

### Intervallo Monitoring

Modifica l'intervallo di controllo in `src/background/service-worker.ts`:

```typescript
// Controlla ogni 30 secondi (default)
monitoringInterval = setInterval(checkDropProgress, 30000);
```

## 🔧 Development

### Comandi Disponibili

```bash
# Build production
npm run build

# Dev mode con hot reload
npm run dev

# Preview
npm run preview
```

### Workflow Development

1. Modifica il codice in `src/`
2. Esegui `npm run build`
3. Vai su `chrome://extensions/` → clicca "↻ Ricarica" sull'estensione
4. Testa le modifiche

**Tip:** Le icone sono già incluse in `public/icons/`, non serve rigenerarle!

## ⚠️ Note Importanti

- **Limitazioni API**: L'estensione attualmente usa scraping della pagina. Per funzionalità avanzate, considera l'uso delle API ufficiali di Twitch.

- **Selettori DOM**: I selettori CSS per estrarre dati da Twitch potrebbero cambiare. Se l'estensione smette di funzionare, potrebbero essere necessari aggiornamenti ai selettori in `content-script.ts`.

- **Rate Limiting**: Twitch ha limiti di rate. L'estensione usa intervalli conservativi per evitare problemi.

- **Account Twitch**: Devi essere loggato su Twitch per che i drop vengano tracciati correttamente.

## 🐛 Troubleshooting

### I giochi non appaiono nella select

1. Assicurati di essere sulla pagina https://www.twitch.tv/drops/campaigns
2. Ricarica la pagina
3. Riapri il popup dell'estensione

### Il progresso non si aggiorna

1. Verifica che la tab di Twitch sia ancora aperta
2. Controlla che tu sia loggato su Twitch
3. Prova a riavviare il farming

### L'estensione non si carica

1. Verifica di aver fatto il build: `npm run build`
2. Controlla che la cartella `dist/` esista
3. Verifica che tutte le icone siano presenti in `public/icons/`
4. Controlla la console di Chrome per errori: `chrome://extensions/` > Dettagli > Errori

## 🤝 Contribuire

Contributi, issues e feature requests sono benvenuti!

## 📝 License

Questo progetto è solo a scopo educativo. Twitch e il logo Twitch sono marchi registrati di Twitch Interactive, Inc.

## 🎯 Roadmap

- [ ] Integrazione API ufficiali Twitch
- [ ] Notifiche desktop per drop completati
- [ ] Statistiche e grafici progresso
- [ ] Gestione multi-account
- [ ] Export/Import configurazione
- [ ] Dark/Light mode toggle
- [ ] Supporto lingue multiple

## 💡 Suggerimenti

Hai idee per migliorare l'estensione? Apri una issue!

---

**Fatto con ❤️ per la community Twitch**

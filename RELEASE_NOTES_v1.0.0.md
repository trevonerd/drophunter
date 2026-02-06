# 🎮 Twitch Drops Manager - Release v1.0.0

Prima release ufficiale dell'estensione Chrome per gestire automaticamente i drop di Twitch!

## ✨ Caratteristiche

- 🎯 **Selezione Giochi**: Seleziona facilmente i giochi con drop attivi dalla pagina Twitch
- ▶️ **Controlli Play/Pause/Stop**: Gestisci il farming dei drop quando vuoi
- 📊 **Tracking Progressi**: Monitora in tempo reale la percentuale di completamento
- ✅ **Lista Drop Completati**: Visualizza tutti i drop già ottenuti
- 🎨 **UI Moderna**: Interfaccia accattivante con tema Twitch (viola #9146FF)
- 🔇 **Tab Mutate**: Apre streamer in tab mutate automaticamente per farming passivo
- 💾 **Persistenza Stato**: Salva automaticamente lo stato anche dopo il riavvio del browser

## 🛠️ Tecnologie

- React 18 con TypeScript
- Vite per build ultra-veloci
- Tailwind CSS per styling professionale
- Chrome Extension Manifest V3 (ultima versione)

## 📦 Installazione

1. Scarica il file `twitch-drops-manager-v1.0.0.zip` dalla release
2. Estrai il contenuto in una cartella
3. Apri Chrome e vai su `chrome://extensions/`
4. Attiva "Modalità sviluppatore" (toggle in alto a destra)
5. Clicca "Carica estensione non pacchettizzata"
6. Seleziona la cartella estratta
7. L'estensione è installata! 🎉

## 🚀 Come usare

1. Vai su https://www.twitch.tv/drops/campaigns
2. Clicca l'icona dell'estensione nella toolbar di Chrome
3. Seleziona un gioco con drop attivi dal menu dropdown
4. Clicca "Avvia" ▶️
5. L'estensione aprirà automaticamente uno streamer (mutato) e inizierà il farming
6. Monitora i progressi direttamente nel popup
7. Usa "Pausa" ⏸️ per fermare temporaneamente o "Stop" ⏹️ per terminare

## ⚠️ Note

- Devi essere loggato su Twitch per tracciare correttamente i drop
- L'estensione monitora i progressi ogni 30 secondi
- Attualmente usa web scraping (i selettori potrebbero richiedere aggiornamenti se Twitch cambia la UI)

## 📝 Prossimi sviluppi

- Integrazione con Twitch API ufficiali
- Notifiche desktop per drop completati
- Auto-claim dei drop
- Statistiche e grafici
- Supporto multi-account

---

**Fatto con ❤️ per la community Twitch**

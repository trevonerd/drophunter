import { AppState, TwitchGame, Message } from '../types';

// Stato globale dell'applicazione
let appState: AppState = {
  selectedGame: null,
  isRunning: false,
  isPaused: false,
  activeStreamer: null,
  currentDrop: null,
  completedDrops: [],
  availableGames: [],
  tabId: null,
};

// Intervallo per il monitoring
let monitoringInterval: number | null = null;

// Carica lo stato salvato quando il service worker si avvia
chrome.runtime.onStartup.addListener(async () => {
  await loadState();
});

chrome.runtime.onInstalled.addListener(async () => {
  console.log('Twitch Drops Extension installed');
  await loadState();
});

// Funzione per caricare lo stato
async function loadState() {
  try {
    const result = await chrome.storage.local.get(['appState']);
    if (result.appState) {
      appState = result.appState;
      // Se l'app era in esecuzione, riavvia il monitoring
      if (appState.isRunning && !appState.isPaused) {
        startMonitoring();
      }
    }
  } catch (error) {
    console.error('Error loading state:', error);
  }
}

// Funzione per salvare lo stato
async function saveState() {
  try {
    await chrome.storage.local.set({ appState });
    // Notifica il popup dell'aggiornamento
    broadcastStateUpdate();
  } catch (error) {
    console.error('Error saving state:', error);
  }
}

// Funzione per inviare aggiornamenti di stato a tutti i popup aperti
function broadcastStateUpdate() {
  chrome.runtime.sendMessage({
    type: 'UPDATE_STATE',
    payload: appState,
  }).catch(() => {
    // Il popup potrebbe non essere aperto, ignora l'errore
  });
}

// Funzione per trovare un canale live con drop per il gioco selezionato
async function findLiveChannelWithDrops(_gameId: string): Promise<any> {
  try {
    // In un'implementazione reale, dovremmo:
    // 1. Usare l'API di Twitch per trovare canali live per il gioco
    // 2. Filtrare solo quelli con drop attivi
    // 3. Ordinare per numero di spettatori

    // Per ora, apriamo la pagina del gioco su Twitch con filtro drop
    // L'utente dovrà selezionare manualmente un canale la prima volta

    // Cerca nelle tab aperte se c'è già un canale in watch
    const tabs = await chrome.tabs.query({
      url: ['https://www.twitch.tv/*', 'https://twitch.tv/*'],
    });

    // Filtra le tab che sono canali (non drops, directory, etc)
    const channelTabs = tabs.filter(tab =>
      tab.url &&
      !tab.url.includes('/drops') &&
      !tab.url.includes('/directory') &&
      !tab.url.includes('/settings') &&
      tab.url.match(/twitch\.tv\/[a-zA-Z0-9_]+$/)
    );

    if (channelTabs.length > 0 && channelTabs[0].id) {
      return {
        tabId: channelTabs[0].id,
        url: channelTabs[0].url,
      };
    }

    // Se non ci sono tab aperte, cerca streamer dalla pagina drops
    // o apri la directory del gioco
    return null;
  } catch (error) {
    console.error('Error finding live channel:', error);
    return null;
  }
}

// Funzione per aprire un canale Twitch mutato
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function openMutedChannel(channelName: string) {
  try {
    const tab = await chrome.tabs.create({
      url: `https://www.twitch.tv/${channelName}`,
      active: false, // Non mettere in primo piano
    });

    if (tab.id) {
      appState.tabId = tab.id;

      // Attendi che la pagina si carichi e poi muta l'audio
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          // Muta la tab
          chrome.tabs.update(tabId, { muted: true });
          chrome.tabs.onUpdated.removeListener(listener);
        }
      });

      await saveState();
      return tab;
    }
  } catch (error) {
    console.error('Error opening channel:', error);
  }
  return null;
}

// Funzione per monitorare i progressi dei drop
async function checkDropProgress() {
  if (!appState.isRunning || appState.isPaused) {
    return;
  }

  try {
    // Verifica se la tab è ancora aperta
    if (appState.tabId) {
      const tab = await chrome.tabs.get(appState.tabId).catch(() => null);
      if (!tab) {
        console.log('Tab closed, stopping monitoring');
        appState.isRunning = false;
        appState.tabId = null;
        await saveState();
        stopMonitoring();
        return;
      }
    }

    // Qui dovremmo:
    // 1. Controllare il progresso del drop corrente
    // 2. Se il drop è completato, aggiungerlo ai completedDrops
    // 3. Passare al prossimo drop disponibile
    // 4. Se tutti i drop sono completati, fermare il farming

    // Per ora simuliamo un aggiornamento di progresso
    if (appState.currentDrop && appState.currentDrop.progress < 100) {
      // Incrementa il progresso (in realtà dovremmo leggerlo dalla pagina)
      appState.currentDrop.progress = Math.min(
        appState.currentDrop.progress + 1,
        100
      );

      // Se completato, spostalo nei completati
      if (appState.currentDrop.progress === 100) {
        appState.currentDrop.claimed = true;
        appState.completedDrops.push({ ...appState.currentDrop });
        appState.currentDrop = null;

        // Cerca il prossimo drop
        // In un'implementazione reale, dovremmo interrogare la pagina drops
      }

      await saveState();
    }
  } catch (error) {
    console.error('Error checking drop progress:', error);
  }
}

// Funzione per avviare il monitoring
function startMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }

  // Controlla ogni 30 secondi
  monitoringInterval = setInterval(checkDropProgress, 30000);

  // Controlla immediatamente
  checkDropProgress();
}

// Funzione per fermare il monitoring
function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

// Listener per messaggi
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  console.log('Background received message:', message);

  switch (message.type) {
    case 'START_FARMING':
      handleStartFarming(message.payload).then(result => {
        sendResponse(result);
      });
      return true; // Indica risposta asincrona

    case 'PAUSE_FARMING':
      appState.isPaused = true;
      stopMonitoring();
      saveState();
      sendResponse({ success: true });
      break;

    case 'RESUME_FARMING':
      appState.isPaused = false;
      startMonitoring();
      saveState();
      sendResponse({ success: true });
      break;

    case 'STOP_FARMING':
      handleStopFarming().then(result => {
        sendResponse(result);
      });
      return true;

    case 'UPDATE_GAMES':
      // Aggiorna la lista dei giochi disponibili
      appState.availableGames = message.payload;
      saveState();
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  return true;
});

// Handler per avviare il farming
async function handleStartFarming(payload: { game: TwitchGame }) {
  try {
    appState.selectedGame = payload.game;
    appState.isRunning = true;
    appState.isPaused = false;

    // Cerca un canale live con drop
    const channel = await findLiveChannelWithDrops(payload.game.id);

    if (channel) {
      appState.tabId = channel.tabId;
    } else {
      // Apri la pagina del gioco su Twitch per far scegliere un canale
      // In alternativa, potremmo implementare la ricerca automatica
      const gamesTab = await chrome.tabs.create({
        url: `https://www.twitch.tv/directory/category/${payload.game.name}?tl=c2542d6d-cd10-4532-919b-3d19f30a768b`,
        active: true,
      });

      if (gamesTab.id) {
        appState.tabId = gamesTab.id;
      }
    }

    // Inizializza un drop corrente fittizio per demo
    // In produzione, questo verrebbe dalla pagina drops
    appState.currentDrop = {
      id: 'demo-drop-1',
      name: 'Demo Drop for ' + payload.game.name,
      gameId: payload.game.id,
      gameName: payload.game.name,
      imageUrl: payload.game.imageUrl,
      progress: 0,
      claimed: false,
    };

    await saveState();
    startMonitoring();

    return { success: true };
  } catch (error) {
    console.error('Error starting farming:', error);
    return { success: false, error: String(error) };
  }
}

// Handler per fermare il farming
async function handleStopFarming() {
  try {
    stopMonitoring();

    // Chiudi la tab se aperta
    if (appState.tabId) {
      await chrome.tabs.remove(appState.tabId).catch(() => {
        // Tab potrebbe essere già stata chiusa
      });
    }

    appState.isRunning = false;
    appState.isPaused = false;
    appState.activeStreamer = null;
    appState.tabId = null;

    await saveState();

    return { success: true };
  } catch (error) {
    console.error('Error stopping farming:', error);
    return { success: false, error: String(error) };
  }
}

console.log('Twitch Drops Extension background service worker loaded');

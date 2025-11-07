import { TwitchGame, TwitchDrop, Message } from '../types';

// Funzione per estrarre i giochi con drop dalla pagina
function extractDropsGames(): TwitchGame[] {
  const games: TwitchGame[] = [];

  try {
    // Cerca i container dei giochi nella pagina drops
    // Nota: questi selettori potrebbero cambiare, sono basati sulla struttura attuale di Twitch
    const gameCards = document.querySelectorAll('[data-test-selector="campaign-card"]');

    gameCards.forEach((card, index) => {
      const titleElement = card.querySelector('h3, h4, [class*="CoreText"]');
      const imageElement = card.querySelector('img');

      if (titleElement) {
        const gameName = titleElement.textContent?.trim() || `Game ${index + 1}`;
        const imageUrl = imageElement?.src || '';

        games.push({
          id: `game-${index}-${gameName.replace(/\s+/g, '-')}`,
          name: gameName,
          imageUrl: imageUrl,
        });
      }
    });

    // Se non troviamo giochi con i selettori sopra, proviamo un altro approccio
    if (games.length === 0) {
      // Cerca i link alle campagne
      const campaignLinks = document.querySelectorAll('a[href*="/drops/campaigns/"]');
      const uniqueGames = new Set<string>();

      campaignLinks.forEach((link) => {
        const textContent = link.textContent?.trim();
        if (textContent && !uniqueGames.has(textContent)) {
          uniqueGames.add(textContent);
          const img = link.querySelector('img');
          games.push({
            id: `game-${games.length}-${textContent.replace(/\s+/g, '-')}`,
            name: textContent,
            imageUrl: img?.src || '',
          });
        }
      });
    }
  } catch (error) {
    console.error('Error extracting games:', error);
  }

  return games;
}

// Funzione per estrarre informazioni sui drop dalla pagina
function extractDropsInfo(): TwitchDrop[] {
  const drops: TwitchDrop[] = [];

  try {
    // Cerca i drop nella pagina
    const dropElements = document.querySelectorAll('[data-test-selector="drops-list-item"], [class*="drop-campaign"]');

    dropElements.forEach((element, index) => {
      const nameElement = element.querySelector('[class*="CoreText"], h3, h4');
      const progressElement = element.querySelector('[class*="progress"], [role="progressbar"]');
      const imageElement = element.querySelector('img');

      const name = nameElement?.textContent?.trim() || `Drop ${index + 1}`;
      const imageUrl = imageElement?.src || '';

      // Cerca la percentuale di progresso
      let progress = 0;
      if (progressElement) {
        const ariaValueNow = progressElement.getAttribute('aria-valuenow');
        if (ariaValueNow) {
          progress = parseInt(ariaValueNow);
        } else {
          const progressText = progressElement.textContent?.match(/(\d+)%/);
          if (progressText) {
            progress = parseInt(progressText[1]);
          }
        }
      }

      // Verifica se il drop è già stato rivendicato
      const claimed = element.textContent?.toLowerCase().includes('claimed') ||
                      element.textContent?.toLowerCase().includes('rivendicato') ||
                      progress === 100;

      drops.push({
        id: `drop-${index}`,
        name,
        gameId: '',
        gameName: '',
        imageUrl,
        progress,
        claimed,
      });
    });
  } catch (error) {
    console.error('Error extracting drops:', error);
  }

  return drops;
}

// Funzione per trovare streamer con drop attivi per un gioco
async function findStreamersWithDrops(_gameId: string): Promise<any[]> {
  try {
    // Questa funzione dovrebbe cercare nella pagina di Twitch i canali live
    // che hanno drop attivi per il gioco specificato

    // Per ora ritorniamo un array vuoto, l'implementazione completa richiederebbe
    // l'accesso all'API di Twitch o scraping più avanzato
    return [];
  } catch (error) {
    console.error('Error finding streamers:', error);
    return [];
  }
}

// Listener per messaggi dall'estensione
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  console.log('Content script received message:', message);

  switch (message.type) {
    case 'FETCH_GAMES':
      const games = extractDropsGames();
      console.log('Found games:', games);

      // Invia i giochi al background script
      chrome.runtime.sendMessage({
        type: 'UPDATE_GAMES',
        payload: games,
      });

      sendResponse({ success: true, games });
      break;

    case 'GET_DROPS_DATA':
      const drops = extractDropsInfo();
      sendResponse({ success: true, drops });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  return true; // Indica che la risposta sarà inviata in modo asincrono
});

// Observer per monitorare i cambiamenti nella pagina
const observer = new MutationObserver((_mutations) => {
  // Quando la pagina cambia, potremmo voler aggiornare i dati
  // Per ora lo lasciamo commentato per non sovraccaricare
  // chrome.runtime.sendMessage({ type: 'PAGE_UPDATED' });
});

// Avvia l'observer quando siamo sulla pagina drops
if (window.location.href.includes('twitch.tv/drops')) {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log('Twitch Drops Extension content script loaded');

  // Estrai automaticamente i giochi quando il DOM è pronto
  if (document.readyState === 'complete') {
    setTimeout(() => {
      const games = extractDropsGames();
      if (games.length > 0) {
        chrome.runtime.sendMessage({
          type: 'UPDATE_GAMES',
          payload: games,
        });
      }
    }, 2000);
  } else {
    window.addEventListener('load', () => {
      setTimeout(() => {
        const games = extractDropsGames();
        if (games.length > 0) {
          chrome.runtime.sendMessage({
            type: 'UPDATE_GAMES',
            payload: games,
          });
        }
      }, 2000);
    });
  }
}

// Esporta le funzioni per uso futuro
export { extractDropsGames, extractDropsInfo, findStreamersWithDrops };

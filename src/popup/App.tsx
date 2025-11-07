import { useState, useEffect } from 'react'
import { AppState, TwitchGame } from '../types'

function App() {
  const [state, setState] = useState<AppState>({
    selectedGame: null,
    isRunning: false,
    isPaused: false,
    activeStreamer: null,
    currentDrop: null,
    completedDrops: [],
    availableGames: [],
    tabId: null,
  })

  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Carica lo stato dall'estensione
    loadState()

    // Listener per aggiornamenti dallo sfondo
    const listener = (message: any) => {
      if (message.type === 'UPDATE_STATE') {
        setState(message.payload)
      }
    }
    chrome.runtime.onMessage.addListener(listener)

    return () => {
      chrome.runtime.onMessage.removeListener(listener)
    }
  }, [])

  const loadState = async () => {
    try {
      const result = await chrome.storage.local.get(['appState'])
      if (result.appState) {
        setState(result.appState)
      }
      // Chiedi anche alla pagina drops di Twitch i giochi disponibili
      await fetchAvailableGames()
    } catch (error) {
      console.error('Error loading state:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchAvailableGames = async () => {
    try {
      const tabs = await chrome.tabs.query({ url: 'https://www.twitch.tv/drops/campaigns*' })
      if (tabs.length > 0 && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'FETCH_GAMES' })
      }
    } catch (error) {
      console.error('Error fetching games:', error)
    }
  }

  const handleGameSelect = (game: TwitchGame) => {
    setState(prev => ({ ...prev, selectedGame: game }))
  }

  const handleStart = async () => {
    if (!state.selectedGame) return

    try {
      await chrome.runtime.sendMessage({
        type: 'START_FARMING',
        payload: { game: state.selectedGame },
      })
      setState(prev => ({ ...prev, isRunning: true, isPaused: false }))
    } catch (error) {
      console.error('Error starting farming:', error)
    }
  }

  const handlePause = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'PAUSE_FARMING' })
      setState(prev => ({ ...prev, isPaused: true }))
    } catch (error) {
      console.error('Error pausing farming:', error)
    }
  }

  const handleResume = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'RESUME_FARMING' })
      setState(prev => ({ ...prev, isPaused: false }))
    } catch (error) {
      console.error('Error resuming farming:', error)
    }
  }

  const handleStop = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'STOP_FARMING' })
      setState(prev => ({
        ...prev,
        isRunning: false,
        isPaused: false,
        activeStreamer: null,
        currentDrop: null,
      }))
    } catch (error) {
      console.error('Error stopping farming:', error)
    }
  }

  const openDropsPage = () => {
    chrome.tabs.create({ url: 'https://www.twitch.tv/drops/campaigns' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[500px] bg-gradient-to-br from-twitch-dark to-twitch-dark-light">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-twitch-purple"></div>
          <p className="mt-4 text-gray-400">Caricamento...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-twitch-dark to-twitch-dark-light text-white min-h-[500px]">
      {/* Header */}
      <div className="bg-twitch-purple p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
            </svg>
            <div>
              <h1 className="font-bold text-lg">Drops Manager</h1>
              <p className="text-xs text-purple-200">by Twitch Extension</p>
            </div>
          </div>
          <button
            onClick={openDropsPage}
            className="p-2 hover:bg-twitch-purple-dark rounded-lg transition-colors"
            title="Apri pagina drops"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Game Selector */}
        <div>
          <label className="block text-sm font-semibold mb-2 text-gray-300">
            Seleziona Gioco
          </label>
          <select
            value={state.selectedGame?.id || ''}
            onChange={(e) => {
              const game = state.availableGames.find(g => g.id === e.target.value)
              if (game) handleGameSelect(game)
            }}
            className="w-full bg-twitch-dark-lighter border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-twitch-purple transition-all"
            disabled={state.isRunning}
          >
            <option value="">Scegli un gioco con drops attivi...</option>
            {state.availableGames.map(game => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </div>

        {/* Control Buttons */}
        <div className="flex gap-2">
          {!state.isRunning ? (
            <button
              onClick={handleStart}
              disabled={!state.selectedGame}
              className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 transform hover:scale-105 disabled:hover:scale-100 shadow-lg flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
              Avvia
            </button>
          ) : (
            <>
              {state.isPaused ? (
                <button
                  onClick={handleResume}
                  className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 transform hover:scale-105 shadow-lg flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  Riprendi
                </button>
              ) : (
                <button
                  onClick={handlePause}
                  className="flex-1 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 transform hover:scale-105 shadow-lg flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                  </svg>
                  Pausa
                </button>
              )}
              <button
                onClick={handleStop}
                className="flex-1 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 transform hover:scale-105 shadow-lg flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 6h12v12H6z"/>
                </svg>
                Stop
              </button>
            </>
          )}
        </div>

        {/* Status */}
        {state.isRunning && (
          <div className="bg-twitch-dark-lighter rounded-lg p-4 border border-gray-700">
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-3 h-3 rounded-full ${state.isPaused ? 'bg-yellow-500' : 'bg-green-500 animate-pulse-purple'}`}></div>
              <span className="font-semibold text-sm">
                {state.isPaused ? 'In Pausa' : 'Farming Attivo'}
              </span>
            </div>

            {state.activeStreamer && (
              <div className="space-y-2">
                <div className="text-sm text-gray-400">
                  <span className="font-semibold text-white">Streamer:</span> {state.activeStreamer.displayName}
                </div>
                {state.activeStreamer.viewerCount && (
                  <div className="text-xs text-gray-500">
                    👁️ {state.activeStreamer.viewerCount.toLocaleString()} spettatori
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Current Drop Progress */}
        {state.currentDrop && (
          <div className="bg-gradient-to-br from-twitch-dark-lighter to-twitch-dark-light rounded-lg p-4 border border-twitch-purple shadow-lg">
            <h3 className="font-semibold mb-3 text-sm text-gray-300">Drop in Corso</h3>
            <div className="flex gap-3">
              {state.currentDrop.imageUrl && (
                <img
                  src={state.currentDrop.imageUrl}
                  alt={state.currentDrop.name}
                  className="w-16 h-16 rounded-lg object-cover border-2 border-twitch-purple"
                />
              )}
              <div className="flex-1">
                <p className="font-semibold text-sm mb-2">{state.currentDrop.name}</p>
                <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-twitch-purple to-purple-400 h-3 rounded-full transition-all duration-500 animate-shimmer"
                    style={{ width: `${state.currentDrop.progress}%` }}
                  ></div>
                </div>
                <p className="text-xs text-gray-400 mt-1">{state.currentDrop.progress}%</p>
              </div>
            </div>
          </div>
        )}

        {/* Completed Drops */}
        {state.completedDrops.length > 0 && (
          <div className="bg-twitch-dark-lighter rounded-lg p-4 border border-gray-700">
            <h3 className="font-semibold mb-3 text-sm text-gray-300 flex items-center gap-2">
              <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
              Drop Completati ({state.completedDrops.length})
            </h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {state.completedDrops.map(drop => (
                <div key={drop.id} className="flex items-center gap-3 bg-twitch-dark p-2 rounded-lg">
                  {drop.imageUrl && (
                    <img
                      src={drop.imageUrl}
                      alt={drop.name}
                      className="w-10 h-10 rounded object-cover"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{drop.name}</p>
                    <p className="text-xs text-gray-500 truncate">{drop.gameName}</p>
                  </div>
                  <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info Message */}
        {!state.isRunning && state.availableGames.length === 0 && (
          <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-blue-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              <div className="text-sm">
                <p className="font-semibold text-blue-300 mb-1">Come iniziare</p>
                <p className="text-gray-400">
                  Visita la pagina <button onClick={openDropsPage} className="text-twitch-purple hover:underline font-semibold">Drops di Twitch</button> per vedere i giochi disponibili, poi torna qui per avviare il farming automatico!
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App

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
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    loadState()

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
      await fetchAvailableGames()
    } catch (error) {
      console.error('Error loading state:', error)
    } finally {
      setTimeout(() => setLoading(false), 300)
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
    if (!state.selectedGame || actionLoading) return

    setActionLoading(true)
    try {
      await chrome.runtime.sendMessage({
        type: 'START_FARMING',
        payload: { game: state.selectedGame },
      })
      setState(prev => ({ ...prev, isRunning: true, isPaused: false }))
    } catch (error) {
      console.error('Error starting farming:', error)
    } finally {
      setTimeout(() => setActionLoading(false), 500)
    }
  }

  const handlePause = async () => {
    if (actionLoading) return

    setActionLoading(true)
    try {
      await chrome.runtime.sendMessage({ type: 'PAUSE_FARMING' })
      setState(prev => ({ ...prev, isPaused: true }))
    } catch (error) {
      console.error('Error pausing farming:', error)
    } finally {
      setTimeout(() => setActionLoading(false), 300)
    }
  }

  const handleResume = async () => {
    if (actionLoading) return

    setActionLoading(true)
    try {
      await chrome.runtime.sendMessage({ type: 'RESUME_FARMING' })
      setState(prev => ({ ...prev, isPaused: false }))
    } catch (error) {
      console.error('Error resuming farming:', error)
    } finally {
      setTimeout(() => setActionLoading(false), 300)
    }
  }

  const handleStop = async () => {
    if (actionLoading) return

    setActionLoading(true)
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
    } finally {
      setTimeout(() => setActionLoading(false), 300)
    }
  }

  const openDropsPage = () => {
    chrome.tabs.create({ url: 'https://www.twitch.tv/drops/campaigns' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[500px] bg-gradient-to-br from-twitch-dark via-twitch-dark-light to-twitch-dark">
        <div className="text-center animate-fadeIn">
          <div className="inline-block spinner rounded-full h-14 w-14 border-4 border-twitch-purple border-t-transparent"></div>
          <p className="mt-6 text-gray-300 font-medium animate-pulse">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[500px] bg-gradient-to-br from-[#0E0E10] via-twitch-dark to-twitch-dark-light text-white">
      {/* Header con effetto glass */}
      <div className="relative bg-gradient-to-r from-twitch-purple via-twitch-purple-dark to-twitch-purple-darker p-5 shadow-2xl overflow-hidden">
        <div className="absolute inset-0 bg-black opacity-10"></div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-twitch-purple-dark rounded-full filter blur-3xl opacity-20 animate-pulse-glow"></div>

        <div className="relative flex items-center justify-between">
          <div className="flex items-center space-x-3 animate-slideIn">
            <div className="relative">
              <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
              </svg>
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-twitch-purple animate-pulse-glow"></div>
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight gradient-text">DropHunter</h1>
              <p className="text-xs text-purple-200 font-medium">Auto Farming Tool</p>
            </div>
          </div>
          <button
            onClick={openDropsPage}
            className="p-2.5 hover:bg-white/10 rounded-xl transition-all duration-300 glass group"
            title="Open drops page"
          >
            <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-5 space-y-4">
        {/* Game Selector con glassmorphism */}
        <div className="animate-slideIn" style={{ animationDelay: '0.1s' }}>
          <label className="block text-sm font-bold mb-2.5 text-gray-200 tracking-wide">
            🎮 Select Game
          </label>
          <div className="relative">
            <select
              value={state.selectedGame?.id || ''}
              onChange={(e) => {
                const game = state.availableGames.find(g => g.id === e.target.value)
                if (game) handleGameSelect(game)
              }}
              className="w-full glass-dark rounded-xl px-4 py-3.5 text-white font-medium focus:outline-none focus:ring-2 focus:ring-twitch-purple focus:border-transparent transition-all duration-300 cursor-pointer hover:bg-white/5 appearance-none"
              disabled={state.isRunning}
              style={{ backgroundImage: 'none' }}
            >
              <option value="" className="bg-twitch-dark-lighter">Choose a game with drops...</option>
              {state.availableGames.map(game => (
                <option key={game.id} value={game.id} className="bg-twitch-dark-lighter">
                  {game.name}
                </option>
              ))}
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg className="w-5 h-5 text-twitch-purple" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex gap-3 animate-slideIn" style={{ animationDelay: '0.2s' }}>
          {!state.isRunning ? (
            <button
              onClick={handleStart}
              disabled={!state.selectedGame || actionLoading}
              className="flex-1 btn-hover-effect neon-button bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 disabled:from-gray-700 disabled:to-gray-800 disabled:cursor-not-allowed disabled:opacity-50 text-white font-bold py-4 px-6 rounded-xl transition-all duration-300 shadow-lg flex items-center justify-center gap-3 group relative overflow-hidden"
            >
              {actionLoading ? (
                <div className="spinner w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
              ) : (
                <>
                  <svg className="w-6 h-6 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  <span className="text-lg">Start Farming</span>
                </>
              )}
            </button>
          ) : (
            <>
              {state.isPaused ? (
                <button
                  onClick={handleResume}
                  disabled={actionLoading}
                  className="flex-1 btn-hover-effect neon-button bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-4 px-4 rounded-xl transition-all duration-300 shadow-lg flex items-center justify-center gap-2 group"
                >
                  {actionLoading ? (
                    <div className="spinner w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                  ) : (
                    <>
                      <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                      <span>Resume</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handlePause}
                  disabled={actionLoading}
                  className="flex-1 btn-hover-effect bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-white font-bold py-4 px-4 rounded-xl transition-all duration-300 shadow-lg flex items-center justify-center gap-2 group"
                >
                  {actionLoading ? (
                    <div className="spinner w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                  ) : (
                    <>
                      <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                      </svg>
                      <span>Pause</span>
                    </>
                  )}
                </button>
              )}
              <button
                onClick={handleStop}
                disabled={actionLoading}
                className="flex-1 btn-hover-effect bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold py-4 px-4 rounded-xl transition-all duration-300 shadow-lg flex items-center justify-center gap-2 group"
              >
                {actionLoading ? (
                  <div className="spinner w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                ) : (
                  <>
                    <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 6h12v12H6z"/>
                    </svg>
                    <span>Stop</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>

        {/* Status con glassmorphism */}
        {state.isRunning && (
          <div className="glass rounded-xl p-5 border border-white/10 animate-scaleIn card-hover">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-3 h-3 rounded-full ${state.isPaused ? 'bg-yellow-500' : 'bg-green-500 animate-pulse-glow'}`}></div>
              <span className="font-bold text-base tracking-wide">
                {state.isPaused ? '⏸️ Paused' : '✨ Farming Active'}
              </span>
            </div>

            {state.activeStreamer && (
              <div className="space-y-2 animate-fadeIn">
                <div className="text-sm text-gray-300">
                  <span className="font-semibold text-twitch-purple">Streamer:</span>{' '}
                  <span className="text-white font-medium">{state.activeStreamer.displayName}</span>
                </div>
                {state.activeStreamer.viewerCount && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                      <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
                    </svg>
                    {state.activeStreamer.viewerCount.toLocaleString()} viewers
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Current Drop con progress bar animata */}
        {state.currentDrop && (
          <div className="glass-dark rounded-xl p-5 border-2 border-twitch-purple/30 shadow-2xl animate-scaleIn card-hover">
            <h3 className="font-bold mb-4 text-sm text-gray-300 flex items-center gap-2">
              <span className="text-twitch-purple text-lg">🎁</span>
              Current Drop
            </h3>
            <div className="flex gap-4">
              {state.currentDrop.imageUrl && (
                <img
                  src={state.currentDrop.imageUrl}
                  alt={state.currentDrop.name}
                  className="w-20 h-20 rounded-xl object-cover border-2 border-twitch-purple shadow-lg"
                />
              )}
              <div className="flex-1">
                <p className="font-bold text-base mb-3 text-white">{state.currentDrop.name}</p>
                <div className="relative w-full bg-gray-800 rounded-full h-4 overflow-hidden shadow-inner">
                  <div
                    className="progress-bar-glow absolute top-0 left-0 h-full bg-gradient-to-r from-twitch-purple via-purple-500 to-pink-500 rounded-full transition-all duration-500 animate-shimmer"
                    style={{ width: `${state.currentDrop.progress}%` }}
                  ></div>
                </div>
                <p className="text-sm text-gray-400 mt-2 font-semibold">{state.currentDrop.progress}% complete</p>
              </div>
            </div>
          </div>
        )}

        {/* Completed Drops */}
        {state.completedDrops.length > 0 && (
          <div className="glass-dark rounded-xl p-5 border border-green-500/20 animate-scaleIn">
            <h3 className="font-bold mb-4 text-sm text-gray-300 flex items-center gap-2">
              <svg className="w-6 h-6 text-green-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
              Completed Drops ({state.completedDrops.length})
            </h3>
            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
              {state.completedDrops.map((drop, index) => (
                <div
                  key={drop.id}
                  className="flex items-center gap-3 glass p-3 rounded-lg card-hover animate-slideIn"
                  style={{ animationDelay: `${index * 0.05}s` }}
                >
                  {drop.imageUrl && (
                    <img
                      src={drop.imageUrl}
                      alt={drop.name}
                      className="w-12 h-12 rounded-lg object-cover"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate text-white">{drop.name}</p>
                    <p className="text-xs text-gray-400 truncate">{drop.gameName}</p>
                  </div>
                  <svg className="w-6 h-6 text-green-500 flex-shrink-0 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info Message */}
        {!state.isRunning && state.availableGames.length === 0 && (
          <div className="glass border border-blue-500/30 rounded-xl p-5 animate-scaleIn">
            <div className="flex items-start gap-4">
              <svg className="w-7 h-7 text-blue-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              <div className="text-sm">
                <p className="font-bold text-blue-300 mb-2 text-base">👋 Welcome!</p>
                <p className="text-gray-300 leading-relaxed">
                  Visit the{' '}
                  <button
                    onClick={openDropsPage}
                    className="text-twitch-purple hover:text-purple-400 underline font-bold transition-colors"
                  >
                    Twitch Drops page
                  </button>
                  {' '}to see available games, then come back here to start automatic farming!
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

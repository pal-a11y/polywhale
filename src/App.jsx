import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import LiveFeed from './components/LiveFeed'
import HotMarkets from './components/HotMarkets'
import Watchlist from './components/Watchlist'
import CryptoMarkets from './components/CryptoMarkets'
import Settings from './components/Settings'
import ScreenerTab from './ScreenerTab'
import {
  fetchRecentTrades,
  fetchTradesSince,
  fetchMarketByConditionId,
  fetchWalletStats,
} from './api'
import {
  DEFAULT_THRESHOLD,
  isSports,
  calculateInsiderScore,
  computeHotMarkets,
  sendDiscordAlert,
  formatAmount,
} from './utils'

const POLL_INTERVAL = 15_000
const MARKET_BATCH = 8 // max parallel market lookups per cycle

function loadLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
function saveLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

export default function App() {
  const [activeTab, setActiveTab] = useState('live')
  const [trades, setTrades] = useState([])
  const [hotMarkets, setHotMarkets] = useState([])
  const [watchlist, setWatchlist] = useState(() => loadLS('pw_watchlist', []))
  const [settings, setSettings] = useState(() => loadLS('pw_settings', {
    discordWebhook: '',
    threshold: DEFAULT_THRESHOLD,
    notifyWatchlist: true,
    notifyWhales: false,
    showSports: false,
  }))
  const [stats, setStats] = useState({ todayVolume: 0, whaleCount: 0, activeMarkets: 0 })
  const [loading, setLoading] = useState(true)
  const [histLoading, setHistLoading] = useState(false)
  const [error, setError] = useState(null)
  const [countdown, setCountdown] = useState(POLL_INTERVAL / 1000)
  const [toasts, setToasts] = useState([])
  const fetchedPeriods = useRef(new Set())
  const [walletStatsMap, setWalletStatsMap] = useState({})

  // Auto-discover whales from live feed
  const discoveredWhales = useMemo(() => {
    const map = new Map()
    for (const t of trades) {
      const addr = t.owner
      if (!addr) continue
      if (!map.has(addr)) {
        map.set(addr, { address: addr, totalVolume: 0, tradeCount: 0, totalScore: 0, trades: [], lastTrade: null })
      }
      const w = map.get(addr)
      w.totalVolume += parseFloat(t.size || 0)
      w.tradeCount++
      w.totalScore += t._insiderScore || 0
      w.trades.push(t)
      if (!w.lastTrade || new Date(t.match_time) > new Date(w.lastTrade.match_time)) {
        w.lastTrade = t
      }
    }
    return [...map.values()]
      .map(w => ({
        ...w,
        avgInsiderScore: Math.round(w.totalScore / w.tradeCount),
        walletStats: walletStatsMap[w.address.toLowerCase()] || null,
      }))
      .sort((a, b) => b.totalVolume - a.totalVolume)
      .slice(0, 50)
  }, [trades, walletStatsMap])

  const seenIds = useRef(new Set())
  const pollTimer = useRef(null)
  const countdownTimer = useRef(null)
  const alertedTrades = useRef(new Set())

  const addToast = useCallback((msg, type = 'info') => {
    const id = Date.now()
    setToasts(prev => [...prev.slice(-4), { id, msg, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  const saveSettings = useCallback((next) => {
    // Reset history cache if threshold changed so new threshold applies to historical fetch
    if (next.threshold !== settings.threshold) {
      fetchedPeriods.current.clear()
      setTrades([])
      seenIds.current.clear()
    }
    setSettings(next)
    saveLS('pw_settings', next)
  }, [settings.threshold])

  const addToWatchlist = useCallback((address, label = '') => {
    setWatchlist(prev => {
      if (prev.find(w => w.address.toLowerCase() === address.toLowerCase())) return prev
      const next = [...prev, { address, label: label || address.slice(0, 8), addedAt: Date.now() }]
      saveLS('pw_watchlist', next)
      return next
    })
    addToast(`Watching ${address.slice(0, 8)}…`, 'success')
  }, [addToast])

  const removeFromWatchlist = useCallback((address) => {
    setWatchlist(prev => {
      const next = prev.filter(w => w.address.toLowerCase() !== address.toLowerCase())
      saveLS('pw_watchlist', next)
      return next
    })
    addToast('Removed from watchlist', 'info')
  }, [addToast])

  const isWatched = useCallback((address) =>
    watchlist.some(w => w.address.toLowerCase() === address?.toLowerCase()),
    [watchlist])

  // Fetch historical trades when user selects a longer period.
  // Results are merged into `trades` so the same enrichment logic applies.
  const fetchHistorical = useCallback(async (periodKey, sinceMs) => {
    if (fetchedPeriods.current.has(periodKey)) return
    setHistLoading(true)
    try {
      const threshold = settings.threshold || DEFAULT_THRESHOLD
      // More pages for longer windows: 7d needs ~20+ pages of 500
      const maxPages = periodKey === '7d' ? 30 : periodKey === '24h' ? 12 : periodKey === '6h' ? 6 : 4
      const raw = await fetchTradesSince(sinceMs, maxPages)
      const whales = raw.filter(t => parseFloat(t.size || 0) >= threshold)

      // Batch enrich without re-fetching already known trades
      const toEnrich = whales.filter(t => !seenIds.current.has(t.id))

      if (toEnrich.length === 0) {
        // Nothing new — still mark done so we don't spam the API
        fetchedPeriods.current.add(periodKey)
        return
      }

      const uniqueMarkets = [...new Set(toEnrich.map(t => t.market))]
      const marketMap = new Map()
      for (let i = 0; i < uniqueMarkets.length; i += MARKET_BATCH) {
        const batch = uniqueMarkets.slice(i, i + MARKET_BATCH)
        const results = await Promise.allSettled(batch.map(id => fetchMarketByConditionId(id)))
        results.forEach((r, idx) => {
          if (r.status === 'fulfilled' && r.value) marketMap.set(batch[idx], r.value)
        })
      }

      const enriched = toEnrich.map(trade => {
        seenIds.current.add(trade.id)
        const market = marketMap.get(trade.market) || null
        if (!settings.showSports && market && isSports(market)) return null
        return { ...trade, _market: market, _insiderScore: calculateInsiderScore(trade, market, null), _isNew: false }
      }).filter(Boolean)

      if (enriched.length > 0) {
        setTrades(prev => {
          const merged = [...prev, ...enriched]
            .sort((a, b) => new Date(b.match_time) - new Date(a.match_time))
            .slice(0, 5000)
          setHotMarkets(computeHotMarkets(merged))
          return merged
        })
        // Only cache the period as done after a successful non-empty fetch
        fetchedPeriods.current.add(periodKey)
      }
      // If enriched.length === 0 (all filtered as sports), still mark done
      else {
        fetchedPeriods.current.add(periodKey)
      }
    } catch (err) {
      console.error('Historical fetch error:', err)
      // Do NOT add to fetchedPeriods on error — allow retry on next click
    } finally {
      setHistLoading(false)
    }
  }, [settings])

  const fetchAndUpdate = useCallback(async () => {
    try {
      setError(null)
      const raw = await fetchRecentTrades(150)
      if (!Array.isArray(raw)) return

      const threshold = settings.threshold || DEFAULT_THRESHOLD
      const newTrades = []

      // Filter to whale-sized, unseen trades
      const candidates = raw.filter(t => {
        if (seenIds.current.has(t.id)) return false
        const size = parseFloat(t.size || 0)
        return size >= threshold
      })

      // Batch-fetch market info (avoid flooding API)
      const uniqueMarkets = [...new Set(candidates.map(t => t.market))]
      const marketMap = new Map()

      for (let i = 0; i < uniqueMarkets.length; i += MARKET_BATCH) {
        const batch = uniqueMarkets.slice(i, i + MARKET_BATCH)
        const results = await Promise.allSettled(batch.map(id => fetchMarketByConditionId(id)))
        results.forEach((r, idx) => {
          if (r.status === 'fulfilled' && r.value) {
            marketMap.set(batch[idx], r.value)
          }
        })
      }

      for (const trade of candidates) {
        const market = marketMap.get(trade.market) || null
        if (!settings.showSports && market && isSports(market)) continue

        // Enrich trade
        const walletStats = await fetchWalletStats(trade.owner).catch(() => null)
        if (walletStats) {
          setWalletStatsMap(prev => ({ ...prev, [trade.owner.toLowerCase()]: walletStats }))
        }
        const insiderScore = calculateInsiderScore(trade, market, walletStats)
        const enriched = { ...trade, _market: market, _insiderScore: insiderScore, _isNew: true }

        seenIds.current.add(trade.id)
        newTrades.push(enriched)

        // Discord alert for new whale trade
        if (settings.discordWebhook && settings.notifyWhales && !alertedTrades.current.has(trade.id)) {
          alertedTrades.current.add(trade.id)
          sendDiscordAlert(settings.discordWebhook, trade, market, insiderScore)
        }

        // Watchlist match notification
        const isOnWatchlist = watchlist.some(w => w.address.toLowerCase() === trade.owner?.toLowerCase())
        if (isOnWatchlist && settings.discordWebhook && settings.notifyWatchlist && !alertedTrades.current.has(trade.id + '_wl')) {
          alertedTrades.current.add(trade.id + '_wl')
          sendDiscordAlert(settings.discordWebhook, trade, market, insiderScore)
          addToast(`Watched wallet traded: ${trade.owner?.slice(0, 8)}… ${formatAmount(trade.size)}`, 'alert')
        }
      }

      if (newTrades.length > 0) {
        setTrades(prev => {
          const merged = [...newTrades, ...prev].slice(0, 5000)
          setHotMarkets(computeHotMarkets(merged))
          return merged
        })

        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
        setStats(prev => ({
          todayVolume: prev.todayVolume + newTrades.reduce((s, t) => s + parseFloat(t.size || 0), 0),
          whaleCount: prev.whaleCount + newTrades.length,
          activeMarkets: new Set([...Array.from(seenIds.current)]).size,
        }))
      }

      setLoading(false)
    } catch (err) {
      console.error('Poll error:', err)
      setError(err.message)
      setLoading(false)
    }
  }, [settings, watchlist, addToast])

  // Initial load + polling
  useEffect(() => {
    fetchAndUpdate()
    pollTimer.current = setInterval(fetchAndUpdate, POLL_INTERVAL)
    return () => clearInterval(pollTimer.current)
  }, [fetchAndUpdate])

  // Countdown timer
  useEffect(() => {
    setCountdown(POLL_INTERVAL / 1000)
    countdownTimer.current = setInterval(() => {
      setCountdown(prev => prev <= 1 ? POLL_INTERVAL / 1000 : prev - 1)
    }, 1000)
    return () => clearInterval(countdownTimer.current)
  }, [trades])

  const TABS = [
    { id: 'live', label: 'Live Feed', icon: '🔴' },
    { id: 'hot', label: 'Hot Markets', icon: '🔥' },
    { id: 'watchlist', label: 'Watchlist', icon: '👁️', badge: watchlist.length || null },
    { id: 'crypto', label: 'Crypto Markets', icon: '💰' },
    { id: 'screener', label: 'Screener', icon: '🔬' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ]

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-bg-secondary sticky top-0 z-40">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🐋</span>
            <div>
              <h1 className="text-base font-bold text-white leading-none">PolyWhale</h1>
              <p className="text-xs text-slate-500 mt-0.5">Polymarket Whale Intelligence</p>
            </div>
            <div className="flex items-center gap-1.5 ml-2 px-2 py-1 rounded-md bg-emerald-500/10">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold text-emerald-400">LIVE</span>
            </div>
          </div>

          {/* Stats */}
          <div className="hidden md:flex items-center gap-6">
            <Stat label="Today Volume" value={formatAmount(stats.todayVolume)} color="text-emerald-400" />
            <Stat label="Whale Trades" value={stats.whaleCount.toLocaleString()} color="text-blue-400" />
            <Stat label="Next update" value={`${countdown}s`} color="text-slate-400" />
          </div>

          <div className="flex items-center gap-2">
            {error && (
              <span className="text-xs text-red-400 px-2 py-1 rounded bg-red-500/10 border border-red-500/20">
                API Error
              </span>
            )}
            <button
              onClick={() => setActiveTab('settings')}
              className="p-2 rounded-lg hover:bg-bg-hover text-slate-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <nav className="flex gap-1 px-5 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.badge != null && (
                <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-accent-blue/20 text-accent-blue font-semibold">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
      </header>

      {/* Main */}
      <main className="flex-1 p-5 max-w-screen-2xl mx-auto w-full">
        {activeTab === 'live' && (
          <LiveFeed
            trades={trades}
            loading={loading}
            histLoading={histLoading}
            countdown={countdown}
            watchlist={watchlist}
            onAddWatch={addToWatchlist}
            onRemoveWatch={removeFromWatchlist}
            isWatched={isWatched}
            threshold={settings.threshold}
            onRequestHistory={fetchHistorical}
          />
        )}
        {activeTab === 'hot' && (
          <HotMarkets
            hotMarkets={hotMarkets}
            loading={loading}
            onAddWatch={addToWatchlist}
          />
        )}
        {activeTab === 'watchlist' && (
          <Watchlist
            watchlist={watchlist}
            trades={trades}
            discoveredWhales={discoveredWhales}
            walletStatsMap={walletStatsMap}
            onAdd={addToWatchlist}
            onRemove={removeFromWatchlist}
            isWatched={isWatched}
            addToast={addToast}
          />
        )}
        {activeTab === 'crypto' && (
          <CryptoMarkets
            trades={trades}
            loading={loading}
            isWatched={isWatched}
            onAddWatch={addToWatchlist}
          />
        )}
        {activeTab === 'screener' && (
          <ScreenerTab
            onAddWatch={addToWatchlist}
            isWatched={isWatched}
          />
        )}
        {activeTab === 'settings' && (
          <Settings
            settings={settings}
            onSave={saveSettings}
            addToast={addToast}
          />
        )}
      </main>

      {/* Toast notifications */}
      <div className="fixed top-20 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <Toast key={toast.id} toast={toast} />
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div className="text-center">
      <div className={`text-sm font-semibold mono ${color}`}>{value}</div>
      <div className="text-xs text-slate-600">{label}</div>
    </div>
  )
}

function Toast({ toast }) {
  const colors = {
    success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    alert: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
    error: 'border-red-500/40 bg-red-500/10 text-red-300',
    info: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  }
  return (
    <div className={`pointer-events-auto animate-slide-in px-4 py-2.5 rounded-lg border text-sm font-medium max-w-xs shadow-xl ${colors[toast.type] || colors.info}`}>
      {toast.msg}
    </div>
  )
}

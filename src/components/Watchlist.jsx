import { useState, useMemo } from 'react'
import { formatAmount, formatAddress, formatTimeAgo, truncateQuestion, getInsiderLevel } from '../utils'

export default function Watchlist({ watchlist, trades, discoveredWhales, onAdd, onRemove, isWatched, addToast }) {
  const [newAddr, setNewAddr] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [sortBy, setSortBy] = useState('volume') // volume | score | trades
  const [activeSection, setActiveSection] = useState('discovered') // discovered | watched

  const handleAdd = (addr, label = '') => {
    const clean = addr.trim()
    if (!clean.match(/^0x[0-9a-fA-F]{40}$/)) {
      addToast('Invalid wallet address (must be 0x…)', 'error')
      return
    }
    onAdd(clean, label)
  }

  const handleManualAdd = () => {
    handleAdd(newAddr, newLabel)
    setNewAddr('')
    setNewLabel('')
  }

  const sortedDiscovered = useMemo(() => {
    const list = [...discoveredWhales]
    if (sortBy === 'score') return list.sort((a, b) => b.avgInsiderScore - a.avgInsiderScore)
    if (sortBy === 'trades') return list.sort((a, b) => b.tradeCount - a.tradeCount)
    return list // already sorted by volume
  }, [discoveredWhales, sortBy])

  const walletTrades = useMemo(() => {
    const map = new Map()
    for (const w of watchlist) {
      map.set(w.address.toLowerCase(), trades.filter(t =>
        t.owner?.toLowerCase() === w.address.toLowerCase()))
    }
    return map
  }, [watchlist, trades])

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-white">Whale Wallets</h2>
        <p className="text-sm text-slate-500">
          Auto-discovered from live trades · {discoveredWhales.length} whales detected
        </p>
      </div>

      {/* Section toggle */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setActiveSection('discovered')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeSection === 'discovered'
              ? 'bg-accent-blue text-white'
              : 'bg-bg-card border border-border text-slate-400 hover:text-white'
          }`}
        >
          🐋 Discovered Whales
          <span className="ml-2 px-1.5 py-0.5 rounded-full bg-white/10 text-xs">{discoveredWhales.length}</span>
        </button>
        <button
          onClick={() => setActiveSection('watched')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeSection === 'watched'
              ? 'bg-accent-blue text-white'
              : 'bg-bg-card border border-border text-slate-400 hover:text-white'
          }`}
        >
          ⭐ My Watchlist
          <span className="ml-2 px-1.5 py-0.5 rounded-full bg-white/10 text-xs">{watchlist.length}</span>
        </button>
      </div>

      {/* Discovered Whales section */}
      {activeSection === 'discovered' && (
        <div>
          {discoveredWhales.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
              <div className="text-5xl animate-pulse">🐋</div>
              <div className="text-lg font-medium text-slate-400">Scanning for whale wallets…</div>
              <div className="text-sm">Wallets will appear as whale trades are detected</div>
            </div>
          ) : (
            <>
              {/* Sort controls */}
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs text-slate-500">Sort by:</span>
                {[
                  { key: 'volume', label: '💰 Volume' },
                  { key: 'score', label: '🔴 Insider Score' },
                  { key: 'trades', label: '📊 Trade Count' },
                ].map(s => (
                  <button
                    key={s.key}
                    onClick={() => setSortBy(s.key)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                      sortBy === s.key
                        ? 'bg-accent-blue text-white'
                        : 'bg-bg-card border border-border text-slate-400 hover:text-white'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Whale table */}
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-bg-secondary">
                        <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">#</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Wallet</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Total Volume</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Trades</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Avg Score</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Last Trade</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Watch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedDiscovered.map((whale, i) => (
                        <WhaleRow
                          key={whale.address}
                          whale={whale}
                          rank={i + 1}
                          watched={isWatched(whale.address)}
                          onAdd={() => handleAdd(whale.address)}
                          onRemove={() => onRemove(whale.address)}
                          addToast={addToast}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* My Watchlist section */}
      {activeSection === 'watched' && (
        <div>
          {/* Add manually */}
          <div className="card p-4 mb-5">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Add Wallet Manually</h3>
            <div className="flex gap-2 flex-wrap">
              <input
                value={newAddr}
                onChange={e => setNewAddr(e.target.value)}
                placeholder="0x wallet address…"
                className="flex-1 min-w-48 bg-bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-blue mono"
              />
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="Label (optional)"
                className="w-36 bg-bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-blue"
              />
              <button onClick={handleManualAdd} className="btn-primary whitespace-nowrap">
                + Add
              </button>
            </div>
          </div>

          {watchlist.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
              <div className="text-4xl">⭐</div>
              <div className="text-slate-400 font-medium">No wallets in watchlist</div>
              <div className="text-sm">Click the ⭐ on any wallet in Discovered Whales to add it</div>
            </div>
          ) : (
            <div className="grid gap-4">
              {watchlist.map(wallet => (
                <WatchedWalletCard
                  key={wallet.address}
                  wallet={wallet}
                  trades={walletTrades.get(wallet.address.toLowerCase()) || []}
                  onRemove={onRemove}
                  addToast={addToast}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WhaleRow({ whale, rank, watched, onAdd, onRemove, addToast }) {
  const level = getInsiderLevel(whale.avgInsiderScore)
  const lastMarket = whale.lastTrade?._market
  const copyAddr = () => {
    navigator.clipboard.writeText(whale.address)
    addToast('Copied!', 'success')
  }

  const medals = ['🥇', '🥈', '🥉']

  return (
    <tr className="border-b border-border/50 hover:bg-bg-hover transition-colors">
      {/* Rank */}
      <td className="px-4 py-3 text-slate-500 text-xs mono">
        {rank <= 3 ? medals[rank - 1] : `#${rank}`}
      </td>

      {/* Wallet */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="mono text-sm text-slate-300 hover:text-white cursor-pointer transition-colors"
            onClick={copyAddr}
            title={whale.address}
          >
            {formatAddress(whale.address)}
          </span>
          <button onClick={copyAddr} className="text-slate-600 hover:text-slate-400 transition-colors">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
          <a
            href={`https://polymarket.com/profile/${whale.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:text-blue-400"
          >
            ↗
          </a>
        </div>
        {lastMarket?.question && (
          <div className="text-xs text-slate-600 mt-0.5 truncate max-w-xs">
            {truncateQuestion(lastMarket.question, 45)}
          </div>
        )}
      </td>

      {/* Volume */}
      <td className="px-4 py-3 text-right">
        <span className="mono font-semibold text-emerald-400">{formatAmount(whale.totalVolume)}</span>
      </td>

      {/* Trade count */}
      <td className="px-4 py-3 text-center">
        <span className="mono text-blue-400 font-semibold">{whale.tradeCount}</span>
      </td>

      {/* Avg insider score */}
      <td className="px-4 py-3 text-center">
        <div
          className="inline-block px-2 py-0.5 rounded text-xs mono font-bold"
          style={{ color: level.color, background: level.bg }}
        >
          {whale.avgInsiderScore}
        </div>
      </td>

      {/* Last trade */}
      <td className="px-4 py-3 text-xs text-slate-500">
        {whale.lastTrade ? formatTimeAgo(whale.lastTrade.match_time) : '—'}
      </td>

      {/* Watch button */}
      <td className="px-4 py-3 text-center">
        <button
          onClick={watched ? onRemove : onAdd}
          title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
          className={`p-1.5 rounded-lg transition-colors ${
            watched
              ? 'text-yellow-400 bg-yellow-400/10 hover:bg-yellow-400/20'
              : 'text-slate-600 hover:text-yellow-400 hover:bg-yellow-400/10'
          }`}
        >
          <svg className="w-4 h-4" fill={watched ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </button>
      </td>
    </tr>
  )
}

function WatchedWalletCard({ wallet, trades, onRemove, addToast }) {
  const totalVolume = trades.reduce((s, t) => s + parseFloat(t.size || 0), 0)
  const buyCount = trades.filter(t => t.side === 'BUY').length

  const copyAddr = () => {
    navigator.clipboard.writeText(wallet.address)
    addToast('Copied to clipboard', 'success')
  }

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white">
              {wallet.label !== wallet.address.slice(0, 8) ? wallet.label : formatAddress(wallet.address)}
            </span>
            {trades.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-slow" />
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="mono text-xs text-slate-500 cursor-pointer hover:text-slate-300" onClick={copyAddr}>
              {wallet.address}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <a
            href={`https://polymarket.com/profile/${wallet.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:underline"
          >
            View Profile ↗
          </a>
          <button
            onClick={() => onRemove(wallet.address)}
            className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-400/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-4">
        <StatCell label="Trades" value={trades.length} color="text-blue-400" />
        <StatCell label="Volume" value={formatAmount(totalVolume)} color="text-emerald-400" />
        <StatCell label="Buys" value={buyCount} color="text-emerald-400" />
        <StatCell label="Sells" value={trades.length - buyCount} color="text-red-400" />
      </div>

      {trades.length > 0 ? (
        <div className="space-y-1.5">
          {trades.slice(0, 5).map((trade, i) => {
            const isBuy = trade.side === 'BUY'
            const score = trade._insiderScore || 0
            const level = getInsiderLevel(score)
            return (
              <div key={trade.id || i} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-bg-secondary">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className={`badge shrink-0 ${isBuy ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                    {isBuy ? '▲' : '▼'} {trade.side}
                  </span>
                  <span className="text-xs text-slate-400 truncate">
                    {truncateQuestion(trade._market?.question, 45)}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-2">
                  <span className={`mono text-xs font-semibold ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatAmount(trade.size)}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-xs mono font-bold" style={{ color: level.color, background: level.bg }}>
                    {score}
                  </span>
                  <span className="text-xs text-slate-600">{formatTimeAgo(trade.match_time)}</span>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-4 text-slate-600 text-sm">No whale trades detected yet</div>
      )}
    </div>
  )
}

function StatCell({ label, value, color }) {
  return (
    <div className="bg-bg-secondary rounded-lg p-2 text-center">
      <div className={`text-sm font-bold mono ${color}`}>{value}</div>
      <div className="text-xs text-slate-600 mt-0.5 leading-tight">{label}</div>
    </div>
  )
}

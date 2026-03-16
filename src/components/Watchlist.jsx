import { useState, useMemo } from 'react'
import { fetchWalletStats } from '../api'
import { formatAmount, formatAddress, formatTimeAgo, truncateQuestion, getInsiderLevel } from '../utils'

export default function Watchlist({ watchlist, trades, onAdd, onRemove, addToast }) {
  const [newAddr, setNewAddr] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const handleAdd = () => {
    const addr = newAddr.trim()
    if (!addr.match(/^0x[0-9a-fA-F]{40}$/)) {
      addToast('Invalid wallet address (must be 0x…)', 'error')
      return
    }
    onAdd(addr, newLabel.trim())
    setNewAddr('')
    setNewLabel('')
  }

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
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-white">Watchlist</h2>
        <p className="text-sm text-slate-500">Track specific wallets and get notified when they trade</p>
      </div>

      {/* Add wallet */}
      <div className="card p-4 mb-6">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">Add Wallet</h3>
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
          <button
            onClick={handleAdd}
            className="btn-primary whitespace-nowrap"
          >
            + Add
          </button>
        </div>
      </div>

      {watchlist.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
          <div className="text-5xl">👁️</div>
          <div className="text-lg font-medium text-slate-400">No wallets watched</div>
          <div className="text-sm">Add wallet addresses above to track their activity</div>
        </div>
      ) : (
        <div className="grid gap-4">
          {watchlist.map(wallet => (
            <WalletCard
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
  )
}

function WalletCard({ wallet, trades, onRemove, addToast }) {
  const totalVolume = trades.reduce((s, t) => s + parseFloat(t.size || 0), 0)
  const latestTrade = trades[0]
  const buyCount = trades.filter(t => t.side === 'BUY').length
  const sellCount = trades.length - buyCount

  const copyAddr = () => {
    navigator.clipboard.writeText(wallet.address)
    addToast('Copied to clipboard', 'success')
  }

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-white">
              {wallet.label !== wallet.address.slice(0, 8) ? wallet.label : formatAddress(wallet.address)}
            </span>
            {trades.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-slow" title="Active" />
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="mono text-xs text-slate-500 cursor-pointer hover:text-slate-300 transition-colors"
              onClick={copyAddr}
            >
              {wallet.address}
            </span>
            <button onClick={copyAddr} className="text-slate-600 hover:text-slate-300">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
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

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <StatCell label="Whale Trades" value={trades.length} color="text-blue-400" />
        <StatCell label="Volume" value={formatAmount(totalVolume)} color="text-emerald-400" />
        <StatCell label="Buys" value={buyCount} color="text-emerald-400" />
        <StatCell label="Sells" value={sellCount} color="text-red-400" />
      </div>

      {/* Recent trades */}
      {trades.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Recent Trades</div>
          <div className="space-y-1.5">
            {trades.slice(0, 5).map((trade, i) => (
              <WalletTradeRow key={trade.id || i} trade={trade} />
            ))}
          </div>
        </div>
      )}

      {trades.length === 0 && (
        <div className="text-center py-6 text-slate-600 text-sm">
          No whale trades detected yet for this wallet
        </div>
      )}
    </div>
  )
}

function WalletTradeRow({ trade }) {
  const isBuy = trade.side === 'BUY'
  const score = trade._insiderScore || 0
  const level = getInsiderLevel(score)
  const question = truncateQuestion(trade._market?.question, 50)

  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-bg-secondary hover:bg-bg-hover transition-colors">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <span className={`badge shrink-0 ${isBuy ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
          {isBuy ? '▲' : '▼'} {trade.side}
        </span>
        <span className="text-xs text-slate-400 truncate">{question}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-2">
        <span className={`mono text-xs font-semibold ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
          {formatAmount(trade.size)}
        </span>
        <span
          className="px-1.5 py-0.5 rounded text-xs mono font-bold"
          style={{ color: level.color, background: level.bg }}
        >
          {score}
        </span>
        <span className="text-xs text-slate-600">{formatTimeAgo(trade.match_time)}</span>
      </div>
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

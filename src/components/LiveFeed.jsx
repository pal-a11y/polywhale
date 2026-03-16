import { useState, useMemo, useEffect } from 'react'
import {
  formatAmount, formatAddress, formatTimeAgo, formatOddsPct,
  truncateQuestion, getInsiderLevel,
} from '../utils'

const POLYMARKET_BASE = 'https://polymarket.com/event/'

const PERIODS = [
  { key: '5m',  label: '5 Min',    ms: 5  * 60 * 1000 },
  { key: '15m', label: '15 Min',   ms: 15 * 60 * 1000 },
  { key: '1h',  label: '1 Hour',   ms: 60 * 60 * 1000 },
  { key: '6h',  label: '6 Hours',  ms: 6  * 60 * 60 * 1000 },
  { key: '24h', label: '24 Hours', ms: 24 * 60 * 60 * 1000 },
  { key: '7d',  label: '7 Days',   ms: 7  * 24 * 60 * 60 * 1000 },
]

export default function LiveFeed({
  trades, loading, histLoading, countdown,
  watchlist, onAddWatch, onRemoveWatch, isWatched,
  threshold, onRequestHistory,
}) {
  const [period, setPeriod]   = useState('1h')
  const [filter, setFilter]   = useState('all')   // all | extreme | high | watchlist
  const [sortKey, setSortKey] = useState('time')  // time | size | score
  const [copiedAddr, setCopiedAddr] = useState(null)

  // When period changes, request historical data for anything >= 1h
  // (5m and 15m are fully covered by the live polling buffer)
  useEffect(() => {
    const p = PERIODS.find(x => x.key === period)
    if (!p) return
    const sinceMs = Date.now() - p.ms
    if (p.ms >= 60 * 60 * 1000) {
      onRequestHistory?.(period, sinceMs)
    }
  }, [period]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filter trades by selected time period
  const periodTrades = useMemo(() => {
    const p = PERIODS.find(x => x.key === period)
    if (!p) return trades
    const cutoff = Date.now() - p.ms
    return trades.filter(t => new Date(t.match_time).getTime() >= cutoff)
  }, [trades, period])

  // Apply type filter + sort
  const filtered = useMemo(() => {
    let result = periodTrades
    if (filter === 'extreme') result = result.filter(t => t._insiderScore >= 75)
    else if (filter === 'high') result = result.filter(t => t._insiderScore >= 55)
    else if (filter === 'watchlist') result = result.filter(t =>
      watchlist.some(w => w.address.toLowerCase() === t.owner?.toLowerCase()))

    if (sortKey === 'size')  result = [...result].sort((a, b) => parseFloat(b.size) - parseFloat(a.size))
    else if (sortKey === 'score') result = [...result].sort((a, b) => b._insiderScore - a._insiderScore)
    return result
  }, [periodTrades, filter, sortKey, watchlist])

  // Period-level stats
  const periodStats = useMemo(() => {
    const vol    = periodTrades.reduce((s, t) => s + parseFloat(t.size || 0), 0)
    const wallets = new Set(periodTrades.map(t => t.owner).filter(Boolean))
    const avgScore = periodTrades.length
      ? Math.round(periodTrades.reduce((s, t) => s + (t._insiderScore || 0), 0) / periodTrades.length)
      : 0
    return { vol, wallets: wallets.size, count: periodTrades.length, avgScore }
  }, [periodTrades])

  const copyAddr = (addr) => {
    navigator.clipboard.writeText(addr).then(() => {
      setCopiedAddr(addr)
      setTimeout(() => setCopiedAddr(null), 1500)
    })
  }

  if (loading && trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-500">
        <div className="text-5xl animate-bounce">🐋</div>
        <div className="text-lg font-medium">Scanning Polymarket for whale activity…</div>
        <div className="text-sm">Fetching trades ≥ {formatAmount(threshold)}</div>
      </div>
    )
  }

  return (
    <div>
      {/* ── Time-period selector ── */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-1">Period</span>
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              period === p.key
                ? 'bg-accent-blue text-white shadow'
                : 'bg-bg-card border border-border text-slate-400 hover:text-white hover:border-accent-blue/40'
            }`}
          >
            {p.label}
          </button>
        ))}
        {histLoading && (
          <span className="flex items-center gap-1.5 text-xs text-blue-400 ml-1">
            <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            Loading history…
          </span>
        )}
      </div>

      {/* ── Period stats bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Whale Trades',  value: periodStats.count.toLocaleString(),  color: 'text-white' },
          { label: 'Volume',        value: formatAmount(periodStats.vol),         color: 'text-emerald-400' },
          { label: 'Unique Wallets',value: periodStats.wallets.toLocaleString(), color: 'text-blue-400' },
          { label: 'Avg Insider',   value: `${periodStats.avgScore}/100`,         color: periodStats.avgScore >= 55 ? 'text-yellow-400' : 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className="card px-4 py-3">
            <div className={`text-lg font-bold mono ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Section header + filters ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Live Whale Trades</h2>
          <p className="text-sm text-slate-500">
            Non-sports ≥ {formatAmount(threshold)} · {filtered.length} shown
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {[
            { key: 'all',       label: 'All' },
            { key: 'extreme',   label: '🔴 Extreme' },
            { key: 'high',      label: '🟡 High' },
            { key: 'watchlist', label: `👁️ Watchlist (${watchlist.length})` },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f.key
                  ? 'bg-accent-blue text-white'
                  : 'bg-bg-card border border-border text-slate-400 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}

          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs bg-bg-card border border-border text-slate-300 focus:outline-none"
          >
            <option value="time">Sort: Latest</option>
            <option value="size">Sort: Largest</option>
            <option value="score">Sort: Insider Score</option>
          </select>

          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs font-mono text-blue-400">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            {countdown}s
          </div>
        </div>
      </div>

      {/* ── Trades table ── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-secondary">
                {['Time', 'Market', 'Side', 'Amount', 'Odds', 'Wallet', 'Insider Score', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16 text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <div className="text-3xl">{histLoading ? '⏳' : '🔍'}</div>
                      <div>{histLoading ? 'Loading historical trades…' : `No whale trades in last ${PERIODS.find(p => p.key === period)?.label}`}</div>
                      <div className="text-xs">Watching for trades ≥ {formatAmount(threshold)}</div>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((trade, i) => (
                  <TradeRow
                    key={trade.id || i}
                    trade={trade}
                    isWatched={isWatched(trade.owner)}
                    onAddWatch={onAddWatch}
                    onRemoveWatch={onRemoveWatch}
                    copiedAddr={copiedAddr}
                    onCopy={copyAddr}
                    isNew={trade._isNew && i < 5}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function TradeRow({ trade, isWatched, onAddWatch, onRemoveWatch, copiedAddr, onCopy, isNew }) {
  const market = trade._market
  const score  = trade._insiderScore || 0
  const level  = getInsiderLevel(score)
  const isBuy  = trade.side === 'BUY'
  // API already returns title + slug inline — use as instant fallback before gamma lookup
  const question = truncateQuestion(market?.question || trade.title, 55)
  const slug     = market?.slug || trade.slug || trade.eventSlug || trade.market

  return (
    <tr className={`border-b border-border/50 transition-colors hover:bg-bg-hover ${isNew ? 'animate-new-row' : ''}`}>
      {/* Time */}
      <td className="px-4 py-3 text-slate-400 mono text-xs whitespace-nowrap">
        {formatTimeAgo(trade.match_time)}
      </td>

      {/* Market */}
      <td className="px-4 py-3 max-w-xs">
        <a
          href={`${POLYMARKET_BASE}${slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-200 hover:text-white text-xs leading-snug block hover:underline"
          title={market?.question || trade.title}
        >
          {question}
        </a>
        {market?.tags?.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {market.tags.slice(0, 3).map(tag => (
              <span key={tag} className="px-1.5 py-0.5 rounded text-xs bg-bg-secondary text-slate-500">
                {tag}
              </span>
            ))}
          </div>
        )}
      </td>

      {/* Side */}
      <td className="px-4 py-3">
        <span className={`badge ${isBuy ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
          {isBuy ? '▲ BUY' : '▼ SELL'}
        </span>
        <div className="text-xs text-slate-500 mt-0.5">{trade.outcome}</div>
      </td>

      {/* Amount */}
      <td className="px-4 py-3 text-right">
        <span className={`mono font-semibold text-sm ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
          {formatAmount(trade.size)}
        </span>
      </td>

      {/* Odds */}
      <td className="px-4 py-3 text-right">
        <OddsBar price={trade.price} />
      </td>

      {/* Wallet */}
      <td className="px-4 py-3">
        {trade.pseudonym && (
          <div className="text-xs text-blue-400 font-medium mb-0.5">{trade.pseudonym}</div>
        )}
        <div className="flex items-center gap-1.5">
          <span
            className="mono text-xs text-slate-300 cursor-pointer hover:text-white"
            onClick={() => onCopy(trade.owner)}
            title={trade.owner}
          >
            {formatAddress(trade.owner)}
          </span>
          {copiedAddr === trade.owner ? (
            <span className="text-xs text-emerald-400">✓</span>
          ) : (
            <button onClick={() => onCopy(trade.owner)} className="text-slate-600 hover:text-slate-300 transition-colors">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          )}
        </div>
        {(trade.transaction_hash || trade.transactionHash) && (
          <a
            href={`https://polygonscan.com/tx/${trade.transaction_hash || trade.transactionHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-600 hover:text-blue-400 transition-colors"
          >
            View tx ↗
          </a>
        )}
      </td>

      {/* Insider Score */}
      <td className="px-4 py-3 text-center">
        <InsiderBadge score={score} level={level} />
      </td>

      {/* Watch button */}
      <td className="px-4 py-3 text-center">
        <button
          onClick={() => isWatched ? onRemoveWatch(trade.owner) : onAddWatch(trade.owner)}
          title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
          className={`p-1.5 rounded-lg transition-colors ${
            isWatched
              ? 'text-yellow-400 bg-yellow-400/10 hover:bg-yellow-400/20'
              : 'text-slate-600 hover:text-yellow-400 hover:bg-yellow-400/10'
          }`}
        >
          <svg className="w-4 h-4" fill={isWatched ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </button>
      </td>
    </tr>
  )
}

function OddsBar({ price }) {
  const pct   = Math.round(parseFloat(price || 0.5) * 100)
  const color = pct > 70 ? 'bg-emerald-400' : pct < 30 ? 'bg-red-400' : 'bg-blue-400'
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="mono text-xs font-semibold text-slate-200">{pct}¢</span>
      <div className="w-16 h-1 bg-bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function InsiderBadge({ score, level }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="px-2 py-0.5 rounded font-semibold text-xs mono"
        style={{ color: level.color, background: level.bg }}
      >
        {score}
      </div>
      <div className="text-xs font-medium" style={{ color: level.color }}>
        {level.label}
      </div>
    </div>
  )
}

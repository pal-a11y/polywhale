import { useMemo } from 'react'
import { formatAmount, formatOddsPct, truncateQuestion, getInsiderLevel } from '../utils'

const POLYMARKET_BASE = 'https://polymarket.com/event/'

export default function HotMarkets({ hotMarkets, loading }) {
  const sorted = useMemo(() =>
    [...hotMarkets].sort((a, b) => b.trades.length - a.trades.length),
    [hotMarkets])

  if (loading && hotMarkets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-500">
        <div className="text-5xl">🔥</div>
        <div>Aggregating whale activity…</div>
      </div>
    )
  }

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-500">
        <div className="text-5xl">📊</div>
        <div className="text-lg font-medium">No whale activity yet</div>
        <div className="text-sm">Markets will appear as whale trades are detected</div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-white">Hot Markets</h2>
        <p className="text-sm text-slate-500">Markets with the most concentrated whale activity · sorted by # of whale trades</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sorted.map((m, i) => (
          <MarketCard key={m.conditionId} data={m} rank={i + 1} />
        ))}
      </div>
    </div>
  )
}

function MarketCard({ data, rank }) {
  const market = data.market
  const question = truncateQuestion(market?.question, 70)
  const slug = market?.slug || data.conditionId
  const level = getInsiderLevel(data.avgInsiderScore)

  const buyPct = data.trades.length > 0
    ? Math.round((data.sides.buy / data.trades.length) * 100)
    : 50

  const topPrices = data.trades.map(t => parseFloat(t.price || 0.5))
  const avgPrice = topPrices.length ? topPrices.reduce((a, b) => a + b, 0) / topPrices.length : 0.5

  const latestTrade = data.trades[0]

  return (
    <a
      href={`${POLYMARKET_BASE}${slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="card p-4 hover:border-border-light transition-all hover:bg-bg-hover block group"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-600 mono">#{rank}</span>
          {rank <= 3 && <span>{['🥇', '🥈', '🥉'][rank - 1]}</span>}
        </div>
        <div
          className="px-2 py-0.5 rounded text-xs font-bold"
          style={{ color: level.color, background: level.bg }}
        >
          {data.avgInsiderScore} / 100
        </div>
      </div>

      {/* Question */}
      <h3 className="text-sm font-medium text-slate-200 group-hover:text-white leading-snug mb-3">
        {question}
      </h3>

      {/* Tags */}
      {market?.tags?.length > 0 && (
        <div className="flex gap-1 mb-3 flex-wrap">
          {market.tags.slice(0, 3).map(tag => (
            <span key={tag} className="px-1.5 py-0.5 rounded text-xs bg-bg-secondary text-slate-500">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <StatCell label="Whale Trades" value={data.trades.length} color="text-blue-400" />
        <StatCell label="Volume" value={formatAmount(data.totalVolume)} color="text-emerald-400" />
        <StatCell label="Avg Odds" value={formatOddsPct(avgPrice)} color="text-slate-300" />
      </div>

      {/* Buy/Sell bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>🟢 BUY {buyPct}%</span>
          <span>{100 - buyPct}% SELL 🔴</span>
        </div>
        <div className="h-1.5 bg-bg-secondary rounded-full overflow-hidden flex">
          <div className="h-full bg-emerald-400 rounded-l-full transition-all" style={{ width: `${buyPct}%` }} />
          <div className="h-full bg-red-400 rounded-r-full transition-all" style={{ width: `${100 - buyPct}%` }} />
        </div>
      </div>

      {/* Insider score bar */}
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-slate-500">Avg Insider Score</span>
          <span style={{ color: level.color }}>{level.label}</span>
        </div>
        <div className="h-1.5 bg-bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${data.avgInsiderScore}%`, background: level.color }}
          />
        </div>
      </div>

      {/* Latest trade snippet */}
      {latestTrade && (
        <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between text-xs">
          <span className="text-slate-500">Latest whale</span>
          <span className={`mono font-semibold ${latestTrade.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
            {latestTrade.side === 'BUY' ? '▲' : '▼'} {formatAmount(latestTrade.size)}
          </span>
        </div>
      )}
    </a>
  )
}

function StatCell({ label, value, color }) {
  return (
    <div className="bg-bg-secondary rounded-lg p-2 text-center">
      <div className={`text-sm font-bold mono ${color}`}>{value}</div>
      <div className="text-xs text-slate-600 mt-0.5">{label}</div>
    </div>
  )
}

import { useState, useMemo, useEffect } from 'react'
import { fetchMarkets } from '../api'
import { isCrypto, formatAmount, formatOddsPct, truncateQuestion, formatTimeAgo, getInsiderLevel } from '../utils'

const POLYMARKET_BASE = 'https://polymarket.com/event/'

export default function CryptoMarkets({ trades, loading, isWatched, onAddWatch }) {
  const [liveMarkets, setLiveMarkets] = useState([])
  const [loadingMarkets, setLoadingMarkets] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchMarkets({ limit: 200, active: true })
      .then(data => {
        const crypto = (data || []).filter(m => isCrypto(m))
        setLiveMarkets(crypto)
      })
      .catch(console.error)
      .finally(() => setLoadingMarkets(false))
  }, [])

  // Enrich with whale activity from our live feed
  const enriched = useMemo(() => {
    const tradesByMarket = new Map()
    for (const t of trades) {
      if (!isCrypto(t._market)) continue
      if (!tradesByMarket.has(t.market)) tradesByMarket.set(t.market, [])
      tradesByMarket.get(t.market).push(t)
    }

    return liveMarkets
      .map(m => ({
        ...m,
        _whaleTrades: tradesByMarket.get(m.conditionId) || [],
        _whaleVolume: (tradesByMarket.get(m.conditionId) || []).reduce((s, t) => s + parseFloat(t.size || 0), 0),
        _avgScore: (() => {
          const t = tradesByMarket.get(m.conditionId) || []
          return t.length ? Math.round(t.reduce((s, x) => s + (x._insiderScore || 0), 0) / t.length) : 0
        })(),
      }))
      .filter(m => !search || m.question?.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => b._whaleTrades.length - a._whaleTrades.length || parseFloat(b.volume || 0) - parseFloat(a.volume || 0))
  }, [liveMarkets, trades, search])

  const activeWhaleMarkets = enriched.filter(m => m._whaleTrades.length > 0)
  const otherMarkets = enriched.filter(m => m._whaleTrades.length === 0)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Crypto Price Markets</h2>
          <p className="text-sm text-slate-500">
            Experimental · {enriched.length} active crypto prediction markets
            {activeWhaleMarkets.length > 0 && (
              <span className="ml-2 text-yellow-400">· {activeWhaleMarkets.length} with whale activity 🐋</span>
            )}
          </p>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search markets…"
          className="bg-bg-card border border-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-blue w-56"
        />
      </div>

      {loadingMarkets ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-500">
          <div className="text-5xl animate-spin">💰</div>
          <div>Loading crypto markets…</div>
        </div>
      ) : enriched.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
          <div className="text-5xl">🔍</div>
          <div className="text-lg">No crypto markets found</div>
          {search && <div className="text-sm">Try a different search term</div>}
        </div>
      ) : (
        <>
          {activeWhaleMarkets.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-semibold text-yellow-400">🐋 Active Whale Markets</span>
                <span className="text-xs text-slate-600">({activeWhaleMarkets.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {activeWhaleMarkets.map(m => (
                  <CryptoMarketCard key={m.id || m.conditionId} market={m} highlighted />
                ))}
              </div>
            </div>
          )}

          {otherMarkets.length > 0 && (
            <div>
              {activeWhaleMarkets.length > 0 && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-semibold text-slate-400">Other Crypto Markets</span>
                  <span className="text-xs text-slate-600">({otherMarkets.length})</span>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {otherMarkets.slice(0, 30).map(m => (
                  <CryptoMarketCard key={m.id || m.conditionId} market={m} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function CryptoMarketCard({ market, highlighted }) {
  const slug = market.slug || market.conditionId
  const question = truncateQuestion(market.question, 65)
  const volume = parseFloat(market.volume || 0)
  const liquidity = parseFloat(market.liquidity || 0)

  // Parse current Yes price from outcomePrices or tokens
  let yesPrice = 0.5
  try {
    if (market.outcomePrices) {
      const prices = typeof market.outcomePrices === 'string'
        ? JSON.parse(market.outcomePrices)
        : market.outcomePrices
      yesPrice = parseFloat(prices[0]) || 0.5
    }
  } catch {}

  const level = market._avgScore > 0 ? getInsiderLevel(market._avgScore) : null
  const latestTrade = market._whaleTrades?.[0]

  return (
    <a
      href={`${POLYMARKET_BASE}${slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`card p-4 block hover:border-border-light transition-all hover:bg-bg-hover group ${
        highlighted ? 'border-yellow-500/30 bg-yellow-500/5' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex gap-1.5 flex-wrap">
          {market.tags?.slice(0, 2).map(tag => (
            <span key={tag} className="px-1.5 py-0.5 rounded text-xs bg-bg-secondary text-slate-500">
              {tag}
            </span>
          ))}
        </div>
        {level && (
          <div
            className="px-2 py-0.5 rounded text-xs font-bold shrink-0"
            style={{ color: level.color, background: level.bg }}
          >
            Score {market._avgScore}
          </div>
        )}
      </div>

      {/* Question */}
      <h3 className="text-sm font-medium text-slate-200 group-hover:text-white leading-snug mb-3">
        {question}
      </h3>

      {/* Odds display */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>YES</span>
            <span>NO</span>
          </div>
          <div className="h-2 bg-bg-secondary rounded-full overflow-hidden flex">
            <div className="h-full bg-emerald-400 rounded-l-full" style={{ width: `${yesPrice * 100}%` }} />
            <div className="h-full bg-red-400 rounded-r-full" style={{ width: `${(1 - yesPrice) * 100}%` }} />
          </div>
          <div className="flex justify-between text-xs font-mono font-semibold mt-1">
            <span className="text-emerald-400">{formatOddsPct(yesPrice)}</span>
            <span className="text-red-400">{formatOddsPct(1 - yesPrice)}</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <MiniStat label="Volume" value={formatAmount(volume)} />
        <MiniStat label="Liquidity" value={formatAmount(liquidity)} />
        <MiniStat
          label="Whale Trades"
          value={market._whaleTrades?.length || 0}
          color={market._whaleTrades?.length > 0 ? 'text-yellow-400' : 'text-slate-500'}
        />
      </div>

      {/* Latest whale */}
      {latestTrade && (
        <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between text-xs">
          <span className="text-slate-500">Latest whale</span>
          <div className="flex items-center gap-2">
            <span className={`mono font-semibold ${latestTrade.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
              {latestTrade.side === 'BUY' ? '▲' : '▼'} {formatAmount(latestTrade.size)}
            </span>
            <span className="text-slate-600">{formatTimeAgo(latestTrade.match_time)}</span>
          </div>
        </div>
      )}

      {market.endDate && (
        <div className="mt-2 text-xs text-slate-600">
          Ends: {new Date(market.endDate).toLocaleDateString()}
        </div>
      )}
    </a>
  )
}

function MiniStat({ label, value, color = 'text-slate-300' }) {
  return (
    <div className="bg-bg-secondary rounded-lg p-1.5">
      <div className={`text-xs font-semibold mono ${color}`}>{value}</div>
      <div className="text-xs text-slate-600">{label}</div>
    </div>
  )
}

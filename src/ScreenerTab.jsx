import { useState, useMemo } from 'react'
import {
  runScreenerScan,
  abortScan,
  getCachedResults,
  isCacheValid,
  cacheAgeMinutes,
} from './screener'
import { formatAmount, formatAddress } from './utils'

// ---------------------------------------------------------------------------
// ScreenerTab — manual scan, no auto-fetch on mount (per CLAUDE.md)
// ---------------------------------------------------------------------------
export default function ScreenerTab({ onAddWatch, isWatched }) {
  const [scanState, setScanState] = useState('idle') // idle | scanning | done | error
  const [progress, setProgress] = useState({ current: 0, total: 0, wallet: '' })
  const [results, setResults] = useState(() => {
    // Restore cached results on first render
    const cached = getCachedResults()
    return cached ? cached.results : []
  })
  const [cacheAge, setCacheAge] = useState(() => cacheAgeMinutes())
  const [errorMsg, setErrorMsg] = useState(null)

  // Filter / sort controls
  const [minScore, setMinScore] = useState(0)
  const [minTrades, setMinTrades] = useState(10)
  const [minWinRate, setMinWinRate] = useState(0)
  const [sortKey, setSortKey] = useState('composite')

  const startScan = async () => {
    setScanState('scanning')
    setErrorMsg(null)
    setProgress({ current: 0, total: 0, wallet: '' })

    try {
      const res = await runScreenerScan(({ current, total, wallet }) => {
        setProgress({ current, total, wallet })
      })
      setResults(res)
      setCacheAge(0)
      setScanState('done')
    } catch (err) {
      setErrorMsg(err.message)
      setScanState('error')
    }
  }

  const handleAbort = () => {
    abortScan()
    setScanState('idle')
  }

  // Apply filters + sort
  const filtered = useMemo(() => {
    return results
      .filter(r => !r.skipped)
      .filter(r => r.composite >= minScore)
      .filter(r => r.totalTrades >= minTrades)
      .filter(r => {
        if (minWinRate === 0) return true
        const wr = r.consistency?.winRate ?? 0
        return wr >= minWinRate / 100
      })
      .sort((a, b) => {
        if (sortKey === 'roi')         return b.roi.score - a.roi.score
        if (sortKey === 'consistency') return b.consistency.score - a.consistency.score
        if (sortKey === 'sharpness')   return b.sharpness.score - a.sharpness.score
        return b.composite - a.composite
      })
  }, [results, minScore, minTrades, minWinRate, sortKey])

  const skippedCount = results.filter(r => r.skipped).length
  const scoredCount  = results.filter(r => !r.skipped).length

  // ── Idle / pre-scan state ──────────────────────────────────────────────
  if (scanState === 'idle' && results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-28 gap-5">
        <div className="text-6xl">🔬</div>
        <div className="text-center">
          <h2 className="text-xl font-semibold text-white mb-1">Wallet Screener</h2>
          <p className="text-slate-500 text-sm max-w-md">
            Scores top leaderboard wallets on ROI, Consistency, and Sharpness.
            Scan takes 2–4 minutes — progress is shown live.
          </p>
        </div>
        <ScoreWeightsLegend />
        <button onClick={startScan} className="btn-primary px-8 py-3 text-base">
          Start Scan
        </button>
      </div>
    )
  }

  // ── Scanning ──────────────────────────────────────────────────────────
  if (scanState === 'scanning') {
    const pct = progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6">
        <div className="text-5xl">🔬</div>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-white mb-1">Scanning wallets…</h2>
          <p className="text-slate-400 mono text-sm">
            {progress.current}/{progress.total} — {formatAddress(progress.wallet || '0x…')}
          </p>
        </div>
        {/* Progress bar */}
        <div className="w-80">
          <div className="h-2 bg-bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-blue rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-slate-600 mt-1">
            <span>{pct}%</span>
            <span>{progress.total - progress.current} remaining</span>
          </div>
        </div>
        <button
          onClick={handleAbort}
          className="px-4 py-2 rounded-lg bg-bg-card border border-border text-sm text-slate-400 hover:text-red-400 hover:border-red-500/30 transition-colors"
        >
          Cancel
        </button>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────
  if (scanState === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="text-5xl">⚠️</div>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-white mb-1">Scan failed</h2>
          <p className="text-red-400 text-sm font-mono max-w-lg">{errorMsg}</p>
        </div>
        <button onClick={startScan} className="btn-primary px-6">
          Retry
        </button>
      </div>
    )
  }

  // ── Results ───────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-lg font-semibold text-white">Wallet Screener</h2>
          <p className="text-sm text-slate-500">
            {scoredCount} wallets scored · {skippedCount} skipped (insufficient data)
            {cacheAge !== null && (
              <span className="ml-2 text-slate-600">· Last scanned {cacheAge}m ago</span>
            )}
          </p>
        </div>
        <button
          onClick={startScan}
          disabled={scanState === 'scanning'}
          className="btn-primary px-5 disabled:opacity-50"
        >
          Re-scan
        </button>
      </div>

      {/* Score weight legend */}
      <ScoreWeightsLegend />

      {/* Filters */}
      <div className="card p-4 mb-5 mt-4">
        <div className="flex flex-wrap items-center gap-5">
          <FilterControl
            label="Min Score"
            value={minScore}
            onChange={setMinScore}
            presets={[0, 30, 50, 70]}
            suffix="/100"
          />
          <FilterControl
            label="Min Trades"
            value={minTrades}
            onChange={setMinTrades}
            presets={[10, 25, 50, 100]}
            suffix=""
          />
          <FilterControl
            label="Min Win Rate"
            value={minWinRate}
            onChange={setMinWinRate}
            presets={[0, 50, 60, 70]}
            suffix="%"
          />

          <div>
            <div className="text-xs text-slate-500 mb-1.5">Sort by</div>
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs bg-bg-secondary border border-border text-slate-300 focus:outline-none"
            >
              <option value="composite">Composite Score</option>
              <option value="roi">ROI Score</option>
              <option value="consistency">Consistency Score</option>
              <option value="sharpness">Sharpness Score</option>
            </select>
          </div>
        </div>
        <div className="text-xs text-slate-600 mt-3">
          Showing {filtered.length} of {scoredCount} wallets
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
          <div className="text-3xl">🔍</div>
          <div>No wallets match current filters</div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg-secondary">
                  {[
                    '#', 'Wallet', 'Composite', 'ROI (40%)',
                    'Consistency (35%)', 'Sharpness (25%)', 'Trades', 'Watch'
                  ].map(h => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((wallet, i) => (
                  <ScreenerRow
                    key={wallet.address}
                    wallet={wallet}
                    rank={i + 1}
                    isWatched={isWatched?.(wallet.address)}
                    onAddWatch={onAddWatch}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ScreenerRow
// ---------------------------------------------------------------------------
function ScreenerRow({ wallet, rank, isWatched, onAddWatch }) {
  const composite = wallet.composite ?? 0
  const roiScore  = wallet.roi?.score ?? 0
  const conScore  = wallet.consistency?.score ?? 0
  const shrScore  = wallet.sharpness?.score ?? 0

  const winRate   = wallet.consistency?.winRate
  const roi       = wallet.roi?.roi

  return (
    <tr className="border-b border-border/50 hover:bg-bg-hover transition-colors">
      {/* Rank */}
      <td className="px-4 py-3 text-slate-500 text-xs mono">
        {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : `#${rank}`}
      </td>

      {/* Wallet */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="mono text-sm text-slate-300 hover:text-white cursor-pointer transition-colors"
            onClick={() => navigator.clipboard.writeText(wallet.address)}
            title={wallet.address}
          >
            {formatAddress(wallet.address)}
          </span>
          <a
            href={`https://polymarket.com/profile/${wallet.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:text-blue-400"
          >
            ↗
          </a>
        </div>
        {wallet.name && (
          <div className="text-xs text-slate-600 mt-0.5">{wallet.name}</div>
        )}
        {wallet.leaderboardPnl !== undefined && wallet.leaderboardPnl !== 0 && (
          <div className={`text-xs mono mt-0.5 ${wallet.leaderboardPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            {wallet.leaderboardPnl >= 0 ? '+' : ''}{formatAmount(wallet.leaderboardPnl)} P&L
          </div>
        )}
      </td>

      {/* Composite */}
      <td className="px-4 py-3">
        <CompositeBar score={composite} />
      </td>

      {/* ROI */}
      <td className="px-4 py-3">
        <ScorePill score={roiScore} />
        {roi !== null && roi !== undefined && (
          <div className={`text-xs mono mt-0.5 ${roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {roi >= 0 ? '+' : ''}{(roi * 100).toFixed(1)}%
          </div>
        )}
        <div className="text-xs text-slate-600">{wallet.roi?.resolvedCount ?? 0} resolved</div>
      </td>

      {/* Consistency */}
      <td className="px-4 py-3">
        <ScorePill score={conScore} />
        {winRate !== null && winRate !== undefined && (
          <div className="text-xs text-slate-400 mt-0.5">
            {Math.round(winRate * 100)}% WR
          </div>
        )}
        <div className="text-xs text-slate-600">{wallet.consistency?.resolvedMarkets ?? 0} markets</div>
      </td>

      {/* Sharpness */}
      <td className="px-4 py-3">
        <ScorePill score={shrScore} />
        {wallet.sharpness?.sharpRate !== undefined && (
          <div className="text-xs text-slate-400 mt-0.5">
            {Math.round(wallet.sharpness.sharpRate * 100)}% sharp
          </div>
        )}
      </td>

      {/* Total trades */}
      <td className="px-4 py-3">
        <span className="mono text-blue-400 font-semibold">{wallet.totalTrades}</span>
      </td>

      {/* Watch button */}
      <td className="px-4 py-3 text-center">
        <button
          onClick={() => onAddWatch?.(wallet.address)}
          disabled={isWatched}
          title={isWatched ? 'Already in watchlist' : 'Add to watchlist'}
          className={`p-1.5 rounded-lg transition-colors ${
            isWatched
              ? 'text-yellow-400 bg-yellow-400/10 cursor-default'
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CompositeBar({ score }) {
  const color = score >= 70 ? '#10b981'
    : score >= 50 ? '#3b82f6'
    : score >= 30 ? '#f59e0b'
    : '#64748b'
  return (
    <div className="flex items-center gap-2">
      <span className="mono font-bold text-sm" style={{ color }}>{score}</span>
      <div className="w-20 h-1.5 bg-bg-secondary rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
    </div>
  )
}

function ScorePill({ score }) {
  const color = score >= 70 ? '#10b981'
    : score >= 50 ? '#3b82f6'
    : score >= 30 ? '#f59e0b'
    : '#64748b'
  const bg = score >= 70 ? 'rgba(16,185,129,0.12)'
    : score >= 50 ? 'rgba(59,130,246,0.12)'
    : score >= 30 ? 'rgba(245,158,11,0.12)'
    : 'rgba(100,116,139,0.10)'
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs mono font-bold"
      style={{ color, background: bg }}
    >
      {score}
    </span>
  )
}

function FilterControl({ label, value, onChange, presets, suffix }) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1.5">{label}</div>
      <div className="flex items-center gap-1">
        {presets.map(p => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              value === p
                ? 'bg-accent-blue text-white'
                : 'bg-bg-secondary border border-border text-slate-400 hover:text-white'
            }`}
          >
            {p}{suffix}
          </button>
        ))}
      </div>
    </div>
  )
}

function ScoreWeightsLegend() {
  return (
    <div className="flex flex-wrap gap-3">
      {[
        { label: 'ROI', weight: '40%', color: 'text-emerald-400', bg: 'bg-emerald-500/10', desc: 'Profit / wagered, 90d weighted' },
        { label: 'Consistency', weight: '35%', color: 'text-blue-400', bg: 'bg-blue-500/10', desc: 'Win rate + breadth + diversity' },
        { label: 'Sharpness', weight: '25%', color: 'text-yellow-400', bg: 'bg-yellow-500/10', desc: 'Entry price vs resolution' },
      ].map(s => (
        <div key={s.label} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${s.bg} border border-border`}>
          <span className={`text-xs font-bold mono ${s.color}`}>{s.weight}</span>
          <div>
            <div className={`text-xs font-semibold ${s.color}`}>{s.label}</div>
            <div className="text-xs text-slate-600">{s.desc}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

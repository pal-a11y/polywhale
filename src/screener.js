/**
 * screener.js — Polymarket Screener: per-wallet scoring
 *
 * Account list comes from App.jsx's discoveredWhales (top 50 by volume from
 * live trades) — no leaderboard endpoint needed, avoids CORS issues entirely.
 *
 * Follows the same patterns as api.js:
 *  - Module-level cache with manual TTL
 *  - 250ms rate-limited queue between wallet fetches
 *  - Per-wallet try/catch — one failure never stops the scan
 */

const DATA_API = 'https://data-api.polymarket.com'

const SCREENER_TTL = 30 * 60 * 1000 // 30 min — same as wallet stats cache in api.js

// Module-level cache (same pattern as marketCache / walletCache in api.js)
let screenerCache = null       // { results: [...], scannedAt: timestamp }
let scanAbortFlag = false      // set to true to cancel an in-progress scan

// ---------------------------------------------------------------------------
// Rate-limited queue — 250ms between calls, never fire in parallel
// ---------------------------------------------------------------------------
function delay(ms) {
  return new Promise(res => setTimeout(res, ms))
}

// ---------------------------------------------------------------------------
// Wallet pool — top 50 active wallets by volume from recent trades
// ---------------------------------------------------------------------------
export async function fetchRecentActiveWallets() {
  const res = await fetch(`${DATA_API}/trades?limit=500`)
  if (!res.ok) throw new Error(`Trades API ${res.status}`)
  const data = await res.json()
  const arr = Array.isArray(data) ? data : (data.data || data.trades || [])

  const map = new Map()
  for (const t of arr) {
    const addr = (t.proxyWallet || '').toLowerCase()
    if (!addr || !addr.startsWith('0x')) continue
    const usdcValue = parseFloat(t.size || 0) * parseFloat(t.price || 0)
    if (!map.has(addr)) map.set(addr, { address: addr, totalVolume: 0, tradeCount: 0 })
    const w = map.get(addr)
    w.totalVolume += usdcValue
    w.tradeCount++
  }

  return [...map.values()]
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .slice(0, 50)
}

// ---------------------------------------------------------------------------
// Trade history per wallet (paginated, same style as fetchTradesSince in api.js)
// ---------------------------------------------------------------------------
async function fetchWalletHistory(address, maxPages = 10) {
  const PAGE = 100
  const all = []
  const seen = new Set()

  for (let page = 0; page < maxPages; page++) {
    const url = `${DATA_API}/trades?user=${address}&limit=${PAGE}&offset=${page * PAGE}`
    let data
    try {
      await delay(250)
      const res = await fetch(url)
      if (!res.ok) break
      data = await res.json()
    } catch {
      break
    }
    const arr = Array.isArray(data) ? data : (data.data || data.trades || [])
    if (!arr.length) break

    for (const t of arr) {
      // Normalize to same internal shape as the rest of the app
      const id = `${t.transactionHash || ''}_${t.asset || ''}_${t.timestamp || ''}`
      if (seen.has(id)) continue
      seen.add(id)
      const usdcValue = parseFloat(t.size || 0) * parseFloat(t.price || 0)
      all.push({
        ...t,
        id,
        owner: t.proxyWallet || t.owner,
        market: t.conditionId || t.market,
        match_time: new Date((t.timestamp || 0) * 1000).toISOString(),
        size: usdcValue,           // USDC dollar value, consistent with api.js normalizeTrade
        _shareCount: parseFloat(t.size || 0),
      })
    }

    if (arr.length < PAGE) break
  }
  return all
}

// ---------------------------------------------------------------------------
// Scoring — implemented exactly as CLAUDE.md specifies
// ---------------------------------------------------------------------------

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

/**
 * ROI Score (0–100)
 * profit / wagered, weight last-90d 2x, min 5 resolved trades
 * +30% ROI → 100pts, −30% ROI → 0pts (linear, clamped)
 */
function scoreROI(trades) {
  const now = Date.now()
  const cutoff90 = now - NINETY_DAYS_MS

  // Group by market to determine resolved positions
  const markets = new Map()
  for (const t of trades) {
    const mId = t.market
    if (!markets.has(mId)) markets.set(mId, [])
    markets.get(mId).push(t)
  }

  let weightedProfit = 0
  let weightedWagered = 0
  let resolvedCount = 0

  for (const [, mTrades] of markets) {
    const sorted = [...mTrades].sort((a, b) => new Date(a.match_time) - new Date(b.match_time))
    // Use first trade's side as the position direction
    const firstTrade = sorted[0]
    const lastTrade = sorted[sorted.length - 1]
    const entryPrice = parseFloat(firstTrade?.price || 0.5)
    const exitPrice = parseFloat(lastTrade?.price || entryPrice)
    const side = firstTrade?.side
    const positionUSDC = mTrades.reduce((s, t) => s + parseFloat(t.size || 0), 0)

    // Only count if price moved meaningfully (proxy for resolution)
    const priceShift = Math.abs(exitPrice - entryPrice)
    if (priceShift < 0.05 && exitPrice !== 0 && exitPrice !== 1) continue

    // P&L estimate: for BUY, profit if price went up; for SELL, profit if went down
    const pnl = side === 'BUY'
      ? positionUSDC * (exitPrice - entryPrice) / entryPrice
      : positionUSDC * (entryPrice - exitPrice) / entryPrice

    // 2x weight for last-90-day trades
    const tradeTime = new Date(firstTrade.match_time).getTime()
    const weight = tradeTime >= cutoff90 ? 2 : 1

    weightedProfit += pnl * weight
    weightedWagered += positionUSDC * weight
    resolvedCount++
  }

  if (resolvedCount < 5) return { score: 0, roi: null, resolvedCount }

  const roi = weightedWagered > 0 ? weightedProfit / weightedWagered : 0
  // Linear: −30% = 0pts, +30% = 100pts
  const score = Math.max(0, Math.min(100, ((roi + 0.30) / 0.60) * 100))
  return { score: Math.round(score), roi, resolvedCount }
}

/**
 * Consistency Score (0–100)
 * winRate x 0.7 + breadthBonus x 0.2 + diversityBonus x 0.1
 * min 3 resolved markets
 */
function scoreConsistency(trades) {
  const markets = new Map()
  const categories = new Set()

  for (const t of trades) {
    const mId = t.market
    if (!markets.has(mId)) markets.set(mId, { trades: [], category: t._category || null })
    markets.get(mId).trades.push(t)
    if (t._category) categories.add(t._category)
  }

  let wins = 0
  let resolved = 0

  for (const [, m] of markets) {
    const sorted = [...m.trades].sort((a, b) => new Date(a.match_time) - new Date(b.match_time))
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const entryPrice = parseFloat(first?.price || 0.5)
    const exitPrice = parseFloat(last?.price || entryPrice)
    const side = first?.side

    const priceShift = Math.abs(exitPrice - entryPrice)
    if (priceShift < 0.05 && exitPrice !== 0 && exitPrice !== 1) continue

    resolved++
    const won = side === 'BUY' ? exitPrice > entryPrice : exitPrice < entryPrice
    if (won) wins++
  }

  if (resolved < 3) return { score: 0, winRate: null, resolvedMarkets: resolved }

  const winRate = wins / resolved

  // Breadth bonus (0–1): 10+ distinct resolved markets = full bonus
  const breadthBonus = Math.min(1, resolved / 10)

  // Diversity bonus (0–1): 3+ distinct categories = full bonus
  const diversityBonus = Math.min(1, categories.size / 3)

  const raw = winRate * 0.7 + breadthBonus * 0.2 + diversityBonus * 0.1
  const score = Math.round(Math.min(100, raw * 100))
  return { score, winRate, resolvedMarkets: resolved, categories: categories.size }
}

/**
 * Sharpness Score (0–100)
 * avgEdge x 0.6 + sharpRate x 0.4
 * "Sharp" = price moved 5%+ in their favor after entry
 * Cap at 30 most recent BUY trades
 */
function scoreSharpness(trades) {
  const buyTrades = trades
    .filter(t => t.side === 'BUY')
    .sort((a, b) => new Date(b.match_time) - new Date(a.match_time))
    .slice(0, 30)

  if (buyTrades.length === 0) return { score: 0, avgEdge: 0, sharpRate: 0 }

  // Group by market to get entry vs latest price
  const markets = new Map()
  for (const t of buyTrades) {
    const mId = t.market
    if (!markets.has(mId)) markets.set(mId, [])
    markets.get(mId).push(t)
  }

  let totalEdge = 0
  let sharpCount = 0
  let measured = 0

  for (const [, mTrades] of markets) {
    const sorted = [...mTrades].sort((a, b) => new Date(a.match_time) - new Date(b.match_time))
    const entryPrice = parseFloat(sorted[0]?.price || 0.5)
    const latestPrice = parseFloat(sorted[sorted.length - 1]?.price || entryPrice)

    if (entryPrice <= 0.01 || entryPrice >= 0.99) continue

    const edge = (latestPrice - entryPrice) / entryPrice
    totalEdge += edge
    measured++
    if (edge >= 0.05) sharpCount++
  }

  if (measured === 0) return { score: 0, avgEdge: 0, sharpRate: 0 }

  const avgEdge = totalEdge / measured
  const sharpRate = sharpCount / measured

  // Normalize: avgEdge of +50% → 1.0; sharpRate 0→1 already normalized
  const normalizedEdge = Math.max(0, Math.min(1, (avgEdge + 0.5) / 1.0))
  const raw = normalizedEdge * 0.6 + sharpRate * 0.4
  const score = Math.round(Math.min(100, raw * 100))
  return { score, avgEdge, sharpRate, measured }
}

// ---------------------------------------------------------------------------
// Full scan — runs through leaderboard accounts, scores each one
// ---------------------------------------------------------------------------

/**
 * @param {Array}    accounts     wallet list from discoveredWhales — { address, totalVolume, ... }
 * @param {Function} onProgress   called with ({ current, total, wallet }) each step
 * @returns {Promise<Array>}      array of scored wallet objects
 */
export async function runScreenerScan(accounts, onProgress) {
  scanAbortFlag = false

  const total = accounts.length
  const results = []

  // Score each account
  for (let i = 0; i < accounts.length; i++) {
    if (scanAbortFlag) break

    const account = accounts[i]
    onProgress?.({ current: i + 1, total, wallet: account.address })

    try {
      const trades = await fetchWalletHistory(account.address)

      if (trades.length < 10) {
        // Skip — CLAUDE.md: exclude accounts with < 10 total trades
        results.push({ ...account, skipped: true, reason: `Only ${trades.length} trades` })
        continue
      }

      const roiResult = scoreROI(trades)
      const consistencyResult = scoreConsistency(trades)
      const sharpnessResult = scoreSharpness(trades)

      const composite = Math.round(
        roiResult.score * 0.40 +
        consistencyResult.score * 0.35 +
        sharpnessResult.score * 0.25
      )

      const result = {
        ...account,
        skipped: false,
        totalTrades: trades.length,
        composite,
        roi: roiResult,
        consistency: consistencyResult,
        sharpness: sharpnessResult,
      }

      results.push(result)
      onProgress?.({ current: i + 1, total, wallet: account.address })

    } catch (err) {
      console.warn(`[screener] wallet ${account.address} failed:`, err.message)
      results.push({ ...account, skipped: true, reason: err.message })
    }
  }

  // Cache results
  screenerCache = { results, scannedAt: Date.now() }
  return results
}

export function abortScan() {
  scanAbortFlag = true
}

export function getCachedResults() {
  return screenerCache
}

export function isCacheValid() {
  return screenerCache && (Date.now() - screenerCache.scannedAt) < SCREENER_TTL
}

export function cacheAgeMinutes() {
  if (!screenerCache) return null
  return Math.floor((Date.now() - screenerCache.scannedAt) / 60_000)
}

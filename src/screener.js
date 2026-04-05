/**
 * screener.js — Polymarket Screener: leaderboard fetch + per-wallet scoring
 *
 * Follows the same patterns as api.js:
 *  - Module-level Map caches with manual TTL
 *  - normalizeTrade() already handles field mapping (imported via api.js re-export)
 *  - 250ms rate-limited queue between wallet fetches
 *  - Per-wallet try/catch — one failure never stops the scan
 */

const DATA_API = 'https://data-api.polymarket.com'
const GAMMA_API = 'https://gamma-api.polymarket.com'

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

async function rateLimitedFetch(url) {
  await delay(250)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`)
  return res.json()
}

// ---------------------------------------------------------------------------
// Leaderboard: try 3 endpoint shapes, log which one works
// ---------------------------------------------------------------------------
const LEADERBOARD_URLS = [
  `${GAMMA_API}/profiles?limit=50&sortBy=profitAndLoss&window=alltime`,
  `${GAMMA_API}/leaderboard?limit=50&window=alltime`,
  `${DATA_API}/profiles?limit=50&sortBy=profitAndLoss`,
]

export async function fetchLeaderboard() {
  for (const url of LEADERBOARD_URLS) {
    try {
      const res = await fetch(url)
      if (!res.ok) {
        console.warn(`[screener] leaderboard: ${res.status} — ${url}`)
        continue
      }
      const data = await res.json()
      const arr = Array.isArray(data) ? data : (data.data || data.profiles || data.results || [])
      if (arr.length > 0) {
        console.info(`[screener] leaderboard OK via: ${url}`, arr[0])
        return arr
      }
      console.warn(`[screener] leaderboard: empty array — ${url}`)
    } catch (err) {
      console.warn(`[screener] leaderboard error — ${url}`, err.message)
    }
  }
  throw new Error('All leaderboard endpoints failed or returned empty data')
}

// Page-2 of leaderboard (get accounts 51–100) — uses same URL that worked for page 1
export async function fetchLeaderboardPage2(workingBase) {
  try {
    const url = workingBase.includes('offset=')
      ? workingBase.replace(/offset=\d+/, 'offset=50')
      : workingBase + (workingBase.includes('?') ? '&offset=50' : '?offset=50')
    await delay(250)
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    const arr = Array.isArray(data) ? data : (data.data || data.profiles || data.results || [])
    return arr
  } catch {
    return []
  }
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
 * @param {Function} onProgress  called with ({ current, total, wallet, result }) each step
 * @returns {Promise<Array>}     array of scored wallet objects
 */
export async function runScreenerScan(onProgress) {
  scanAbortFlag = false

  // 1. Fetch leaderboard (up to 100 accounts)
  const page1 = await fetchLeaderboard()
  const workingUrl = LEADERBOARD_URLS.find(async u => {
    try { const r = await fetch(u); return r.ok } catch { return false }
  }) || LEADERBOARD_URLS[0]

  await delay(300)
  const page2 = await fetchLeaderboardPage2(
    LEADERBOARD_URLS[0].replace('limit=50', 'limit=50') // offset added inside fn
  ).catch(() => [])

  const raw = [...page1, ...page2].slice(0, 100)

  // Extract wallet address — field name varies across endpoints
  const accounts = raw.map(entry => ({
    address: (
      entry.proxyWalletAddress ||
      entry.address ||
      entry.proxyWallet ||
      entry.walletAddress ||
      entry.user ||
      ''
    ).toLowerCase(),
    name: entry.name || entry.pseudonym || entry.username || null,
    leaderboardVolume: parseFloat(entry.volume || entry.totalVolume || 0),
    leaderboardPnl: parseFloat(entry.profitAndLoss || entry.pnl || entry.profit || 0),
  })).filter(a => a.address && a.address.startsWith('0x'))

  const total = accounts.length
  const results = []

  // 2. Score each account
  for (let i = 0; i < accounts.length; i++) {
    if (scanAbortFlag) break

    const account = accounts[i]
    onProgress?.({ current: i + 1, total, wallet: account.address, result: null })

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
      onProgress?.({ current: i + 1, total, wallet: account.address, result })

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

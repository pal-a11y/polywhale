const DATA_API = 'https://data-api.polymarket.com'
const GAMMA_API = 'https://gamma-api.polymarket.com'

const marketCache = new Map()
const walletCache = new Map()
const walletCacheTime = new Map()
const WALLET_TTL = 30 * 60 * 1000 // 30 min

/**
 * Normalize raw Polymarket API trade to internal format.
 *
 * The API returns:
 *   proxyWallet  → owner
 *   conditionId  → market
 *   timestamp    → match_time (unix epoch → ISO string)
 *   transactionHash → transaction_hash
 *   size (shares) × price (USDC/share) → size (USDC dollar value)
 *
 * The title, slug, outcome, side, price, pseudonym fields are already correct.
 */
function normalizeTrade(t) {
  const usdcValue = parseFloat(t.size || 0) * parseFloat(t.price || 0)
  return {
    ...t,
    // Stable unique ID from tx hash + token + timestamp
    id: `${t.transactionHash || ''}_${t.asset || ''}_${t.timestamp || Date.now()}`,
    // Normalised field names
    owner: t.proxyWallet,
    market: t.conditionId,
    match_time: new Date((t.timestamp || 0) * 1000).toISOString(),
    transaction_hash: t.transactionHash,
    // Convert share count → USDC dollar value so all threshold comparisons
    // and formatAmount() calls work correctly without touching other files.
    size: usdcValue,
    _shareCount: parseFloat(t.size || 0),
  }
}

export async function fetchRecentTrades(limit = 200) {
  const res = await fetch(`${DATA_API}/trades?limit=${limit}`)
  if (!res.ok) throw new Error(`Trades API ${res.status}`)
  const data = await res.json()
  const arr = Array.isArray(data) ? data : (data.data || data.trades || [])
  return arr.map(normalizeTrade)
}

export async function fetchWalletTrades(address, limit = 500) {
  const res = await fetch(`${DATA_API}/trades?user=${address}&limit=${limit}`)
  if (!res.ok) throw new Error(`Wallet API ${res.status}`)
  const data = await res.json()
  const arr = Array.isArray(data) ? data : (data.data || data.trades || [])
  return arr.map(normalizeTrade)
}

export async function fetchMarkets(params = {}) {
  const query = new URLSearchParams({ limit: 200, active: true, ...params })
  const res = await fetch(`${GAMMA_API}/markets?${query}`)
  if (!res.ok) throw new Error(`Markets API ${res.status}`)
  return res.json()
}

export async function fetchMarketByConditionId(conditionId) {
  if (marketCache.has(conditionId)) return marketCache.get(conditionId)
  try {
    const res = await fetch(`${GAMMA_API}/markets?conditionIds=${conditionId}`)
    if (!res.ok) return null
    const data = await res.json()
    const market = Array.isArray(data) ? data[0] : null
    if (market) marketCache.set(conditionId, market)
    return market
  } catch {
    return null
  }
}

export async function fetchWalletStats(address) {
  const now = Date.now()
  const cached = walletCache.get(address)
  const cachedAt = walletCacheTime.get(address)
  if (cached && cachedAt && (now - cachedAt) < WALLET_TTL) return cached

  try {
    const trades = await fetchWalletTrades(address, 500)
    if (!trades?.length) return null

    // size is already in USDC after normalization
    const totalVolume = trades.reduce((s, t) => s + parseFloat(t.size || 0), 0)
    const markets = new Map()

    for (const t of trades) {
      if (!markets.has(t.market)) markets.set(t.market, { trades: [] })
      markets.get(t.market).trades.push(t)
    }

    // Per-market performance: did price move in their favor?
    let weightedWins = 0
    let weightedTotal = 0
    let totalEdge = 0
    let wins = 0
    let resolved = 0

    for (const [, m] of markets) {
      const sorted = [...m.trades].sort((a, b) => new Date(a.match_time) - new Date(b.match_time))
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      const entryPrice = parseFloat(first?.price || 0.5)
      const latestPrice = parseFloat(last?.price || 0.5)
      const side = first?.side
      const posSize = m.trades.reduce((s, t) => s + parseFloat(t.size || 0), 0)

      const priceImproved =
        (side === 'BUY' && latestPrice > entryPrice) ||
        (side === 'SELL' && latestPrice < entryPrice)

      weightedTotal += posSize
      if (priceImproved) {
        weightedWins += posSize
        wins++
      }
      resolved++

      // Edge = relative price movement in their favor
      if (entryPrice > 0.01 && entryPrice < 0.99) {
        const edge = side === 'BUY'
          ? (latestPrice - entryPrice) / entryPrice
          : (entryPrice - latestPrice) / entryPrice
        totalEdge += edge * posSize
      }
    }

    const winRate = resolved > 0 ? wins / resolved : 0.5
    const weightedWinRate = weightedTotal > 0 ? weightedWins / weightedTotal : 0.5
    const avgEdge = weightedTotal > 0 ? totalEdge / weightedTotal : 0

    // Composite edge score 0–100
    // Requires ≥3 markets to get a meaningful score
    let edgeScore = 0
    if (resolved >= 3) {
      if (weightedWinRate >= 0.80) edgeScore = 85 + Math.min(15, (resolved - 3) * 1.5)
      else if (weightedWinRate >= 0.70) edgeScore = 65 + (weightedWinRate - 0.70) * 200
      else if (weightedWinRate >= 0.60) edgeScore = 45 + (weightedWinRate - 0.60) * 200
      else if (weightedWinRate >= 0.50) edgeScore = 25 + (weightedWinRate - 0.50) * 200
      else edgeScore = Math.max(0, weightedWinRate * 50)

      // Edge multiplier bonus
      if (avgEdge > 0.5) edgeScore = Math.min(100, edgeScore + 15)
      else if (avgEdge > 0.25) edgeScore = Math.min(100, edgeScore + 8)
      else if (avgEdge < -0.1) edgeScore = Math.max(0, edgeScore - 10)
    }
    edgeScore = Math.min(100, Math.round(edgeScore))

    const stats = {
      totalTrades: trades.length,
      totalVolume,
      uniqueMarkets: markets.size,
      avgTradeSize: totalVolume / trades.length,
      winRate,
      weightedWinRate,
      avgEdge,
      edgeScore,
      largestTrade: Math.max(...trades.map(t => parseFloat(t.size || 0))),
    }

    walletCache.set(address, stats)
    walletCacheTime.set(address, now)
    return stats
  } catch {
    return null
  }
}

/**
 * Paginate backwards through the trades API using cursor-based pagination
 * (before= timestamp) until we have all trades newer than sinceTimestamp.
 */
export async function fetchTradesSince(sinceTimestamp, maxPages = 20) {
  const PAGE = 500
  const all = []
  const seenIds = new Set()
  const sinceTs = Math.floor(sinceTimestamp / 1000) // convert ms → seconds

  let beforeTs = null // Unix seconds cursor

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ limit: PAGE })
    if (beforeTs !== null) params.set('before', beforeTs)

    let res
    try {
      res = await fetch(`${DATA_API}/trades?${params}`)
      if (!res.ok) break
    } catch {
      break
    }

    const data = await res.json()
    const arr = Array.isArray(data) ? data : (data.data || data.trades || [])
    if (!arr.length) break

    const normalized = arr.map(normalizeTrade)
    let addedThisPage = 0

    for (const t of normalized) {
      const ts = t.timestamp || Math.floor(new Date(t.match_time).getTime() / 1000)
      if (ts >= sinceTs && !seenIds.has(t.id)) {
        seenIds.add(t.id)
        all.push(t)
        addedThisPage++
      }
    }

    const oldest = normalized[normalized.length - 1]
    const oldestTs = oldest.timestamp || Math.floor(new Date(oldest.match_time).getTime() / 1000)

    // Stop if we've gone past our window or no more pages
    if (oldestTs < sinceTs || arr.length < PAGE) break

    // Advance cursor — subtract 1s to avoid re-fetching same-second trades
    beforeTs = oldestTs - 1

    // Safety: if nothing new was added and cursor didn't move, stop
    if (addedThisPage === 0) break
  }

  return all
}

export function clearMarketCache() {
  marketCache.clear()
}

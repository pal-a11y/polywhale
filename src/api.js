const DATA_API = 'https://data-api.polymarket.com'
const GAMMA_API = 'https://gamma-api.polymarket.com'

const marketCache = new Map()
const walletCache = new Map()

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

export async function fetchWalletTrades(address, limit = 300) {
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
  if (walletCache.has(address)) return walletCache.get(address)
  try {
    const trades = await fetchWalletTrades(address, 300)
    if (!trades?.length) return null

    // size is already in USDC after normalization
    const totalVolume = trades.reduce((s, t) => s + parseFloat(t.size || 0), 0)
    const markets = new Map()

    for (const t of trades) {
      if (!markets.has(t.market)) {
        markets.set(t.market, { trades: [] })
      }
      markets.get(t.market).trades.push(t)
    }

    // Heuristic win rate: % of markets where last trade price improved
    let wins = 0
    let resolved = 0
    for (const [, m] of markets) {
      const sorted = [...m.trades].sort((a, b) => new Date(a.match_time) - new Date(b.match_time))
      const first = parseFloat(sorted[0]?.price || 0.5)
      const last = parseFloat(sorted[sorted.length - 1]?.price || 0.5)
      const side = sorted[0]?.side
      if (side === 'BUY' && last > first) wins++
      else if (side === 'SELL' && last < first) wins++
      resolved++
    }

    const stats = {
      totalTrades: trades.length,
      totalVolume,
      uniqueMarkets: markets.size,
      avgTradeSize: totalVolume / trades.length,
      winRate: resolved > 0 ? wins / resolved : 0.5,
      largestTrade: Math.max(...trades.map(t => parseFloat(t.size || 0))),
    }

    walletCache.set(address, stats)
    return stats
  } catch {
    return null
  }
}

/**
 * Paginate backwards through the trades API until we have all trades
 * newer than `sinceTimestamp` (ms) or we hit `maxPages`.
 * Each page = 500 trades, newest-first.
 */
export async function fetchTradesSince(sinceTimestamp, maxPages = 10) {
  const PAGE = 500
  const all = []

  for (let page = 0; page < maxPages; page++) {
    const offset = page * PAGE
    let res
    try {
      res = await fetch(`${DATA_API}/trades?limit=${PAGE}&offset=${offset}`)
      if (!res.ok) break
    } catch {
      break
    }
    const data = await res.json()
    const arr = Array.isArray(data) ? data : (data.data || data.trades || [])
    if (!arr.length) break

    const normalized = arr.map(normalizeTrade)

    for (const t of normalized) {
      if (new Date(t.match_time).getTime() >= sinceTimestamp) all.push(t)
    }

    // Stop once the oldest trade in this page is before our window
    const oldest = normalized[normalized.length - 1]
    if (new Date(oldest.match_time).getTime() < sinceTimestamp) break
    if (arr.length < PAGE) break
  }

  return all
}

export function clearMarketCache() {
  marketCache.clear()
}

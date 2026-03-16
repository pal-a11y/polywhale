const DATA_API = 'https://data-api.polymarket.com'
const GAMMA_API = 'https://gamma-api.polymarket.com'

const marketCache = new Map()
const walletCache = new Map()

export async function fetchRecentTrades(limit = 150) {
  const res = await fetch(`${DATA_API}/trades?limit=${limit}`)
  if (!res.ok) throw new Error(`Trades API ${res.status}`)
  return res.json()
}

export async function fetchWalletTrades(address, limit = 300) {
  const res = await fetch(`${DATA_API}/trades?user=${address}&limit=${limit}`)
  if (!res.ok) throw new Error(`Wallet API ${res.status}`)
  return res.json()
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

export function clearMarketCache() {
  marketCache.clear()
}

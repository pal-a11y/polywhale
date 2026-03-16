export const DEFAULT_THRESHOLD = 10000

export const SPORTS_TAGS = new Set([
  'sports', 'nba', 'nfl', 'mlb', 'nhl', 'ncaa', 'soccer', 'football',
  'basketball', 'baseball', 'tennis', 'golf', 'boxing', 'mma', 'ufc',
  'cricket', 'rugby', 'formula-1', 'f1', 'motorsports', 'esports',
  'olympics', 'super-bowl', 'world-cup', 'champions-league', 'premier-league',
])

export const CRYPTO_TAGS = new Set([
  'crypto', 'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'defi',
  'web3', 'blockchain', 'altcoin', 'nft', 'bnb', 'xrp', 'cardano', 'ada',
  'dogecoin', 'doge', 'shiba', 'avax', 'matic', 'polygon', 'sui', 'aptos',
  'price-prediction', 'cryptocurrency',
])

export function isSports(market) {
  if (!market?.tags?.length) {
    // Fallback: check category field
    return market?.category?.toLowerCase() === 'sports'
  }
  return market.tags.some(t => SPORTS_TAGS.has(t.toLowerCase()))
}

export function isCrypto(market) {
  if (!market?.tags?.length) {
    return market?.category?.toLowerCase() === 'crypto'
  }
  return market.tags.some(t => CRYPTO_TAGS.has(t.toLowerCase()))
}

export function formatAmount(size) {
  const n = parseFloat(size)
  if (isNaN(n)) return '$0'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

export function formatAddress(addr) {
  if (!addr || addr.length < 10) return addr || '???'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function formatTimeAgo(timestamp) {
  const now = Date.now()
  const time = new Date(timestamp).getTime()
  const diff = Math.floor((now - time) / 1000)
  if (diff < 5) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function formatOdds(price) {
  const n = parseFloat(price)
  if (isNaN(n)) return '?'
  return `${(n * 100).toFixed(0)}¢`
}

export function formatOddsPct(price) {
  const n = parseFloat(price)
  if (isNaN(n)) return '?%'
  return `${(n * 100).toFixed(1)}%`
}

export function truncateQuestion(q, maxLen = 60) {
  if (!q) return 'Unknown Market'
  return q.length > maxLen ? q.slice(0, maxLen - 1) + '…' : q
}

/**
 * Calculate an "insider score" 0–100 suggesting potential information advantage.
 * Higher = more suspicious / more likely someone knows something.
 */
export function calculateInsiderScore(trade, market, walletStats) {
  let score = 0
  const size = parseFloat(trade.size || 0)
  const price = parseFloat(trade.price || 0.5)
  const isYes = trade.outcome === 'Yes'

  // --- Trade Size Factor (0–35 pts) ---
  if (size >= 500_000) score += 35
  else if (size >= 100_000) score += 28
  else if (size >= 50_000) score += 22
  else if (size >= 25_000) score += 16
  else if (size >= 10_000) score += 10

  // --- Conviction Factor (0–20 pts) ---
  // Buying an outcome that's priced very low = high conviction = suspicious
  if (isYes && price < 0.15) score += 20       // cheap YES, big buy
  else if (!isYes && price < 0.15) score += 20 // cheap NO, big buy
  else if (isYes && price < 0.25) score += 12
  else if (!isYes && price < 0.25) score += 12
  else if (price > 0.90) score += 8            // buying near certainty (aggressive)
  else if (price < 0.10) score += 15

  // --- Market Type Factor (0–15 pts) ---
  if (market?.tags?.length) {
    const tags = market.tags.map(t => t.toLowerCase())
    if (tags.some(t => ['politics', 'elections', 'us-elections', 'president', 'senate'].includes(t)))
      score += 15
    else if (tags.some(t => ['geopolitics', 'international', 'war', 'conflict'].includes(t)))
      score += 12
    else if (tags.some(t => ['crypto', 'bitcoin', 'ethereum'].includes(t)))
      score += 8
    else if (tags.some(t => ['business', 'economics', 'finance', 'fed', 'rates'].includes(t)))
      score += 6
  } else if (market?.category) {
    const cat = market.category.toLowerCase()
    if (['politics', 'elections'].includes(cat)) score += 15
    else if (['crypto'].includes(cat)) score += 8
  }

  // --- Wallet History Factor (0–20 pts) ---
  if (walletStats) {
    const { winRate, totalTrades, avgTradeSize } = walletStats
    if (winRate > 0.75 && totalTrades > 20) score += 20
    else if (winRate > 0.65 && totalTrades > 10) score += 14
    else if (winRate > 0.55 && totalTrades > 5) score += 8
    else if (winRate > 0.5) score += 4

    // Bonus: big average trade size = whale behavior pattern
    if (avgTradeSize > 50_000) score += 5
    else if (avgTradeSize > 20_000) score += 3
  }

  // --- Timing bonus: if this is a very recent trade in a market already active ---
  // (Handled by hot market concentration score in the UI)

  return Math.min(100, Math.round(score))
}

export function getInsiderLevel(score) {
  if (score >= 75) return { label: 'EXTREME', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', ring: 'ring-red-500/30' }
  if (score >= 55) return { label: 'HIGH', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', ring: 'ring-yellow-500/30' }
  if (score >= 35) return { label: 'MEDIUM', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', ring: 'ring-blue-500/30' }
  return { label: 'LOW', color: '#64748b', bg: 'rgba(100,116,139,0.10)', ring: '' }
}

export async function sendDiscordAlert(webhookUrl, trade, market, score) {
  if (!webhookUrl) return
  const level = getInsiderLevel(score)
  const question = truncateQuestion(market?.question || 'Unknown Market', 80)
  const side = trade.side === 'BUY' ? '🟢 BUY' : '🔴 SELL'
  const embed = {
    embeds: [
      {
        title: `🐋 Whale Alert — Insider Score: ${score}/100 [${level.label}]`,
        description: `**${question}**`,
        color: score >= 75 ? 0xef4444 : score >= 55 ? 0xf59e0b : 0x3b82f6,
        fields: [
          { name: 'Side', value: side, inline: true },
          { name: 'Amount', value: formatAmount(trade.size), inline: true },
          { name: 'Odds', value: formatOddsPct(trade.price), inline: true },
          { name: 'Outcome', value: trade.outcome || '?', inline: true },
          { name: 'Wallet', value: `\`${trade.owner}\``, inline: true },
          { name: 'Tx', value: trade.transaction_hash ? `[View](https://polygonscan.com/tx/${trade.transaction_hash})` : 'N/A', inline: true },
        ],
        footer: { text: 'PolyWhale Tracker • polymarket.com' },
        timestamp: trade.match_time || new Date().toISOString(),
      },
    ],
  }
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(embed),
    })
  } catch (err) {
    console.warn('Discord alert failed:', err)
  }
}

export function computeHotMarkets(trades) {
  const map = new Map()
  for (const t of trades) {
    const id = t.market
    if (!map.has(id)) {
      map.set(id, {
        conditionId: id,
        market: t._market || null,
        trades: [],
        totalVolume: 0,
        avgInsiderScore: 0,
        sides: { buy: 0, sell: 0 },
        latestTime: null,
      })
    }
    const m = map.get(id)
    m.trades.push(t)
    m.totalVolume += parseFloat(t.size || 0)
    if (t.side === 'BUY') m.sides.buy++
    else m.sides.sell++
    if (!m.latestTime || new Date(t.match_time) > new Date(m.latestTime))
      m.latestTime = t.match_time
    if (t._market) m.market = t._market
  }

  for (const [, m] of map) {
    const scores = m.trades.map(t => t._insiderScore || 0)
    m.avgInsiderScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
  }

  return [...map.values()]
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .slice(0, 24)
}

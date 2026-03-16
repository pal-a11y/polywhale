import { useState } from 'react'
import { DEFAULT_THRESHOLD, sendDiscordAlert } from '../utils'

export default function Settings({ settings, onSave, addToast }) {
  const [form, setForm] = useState(settings)
  const [testing, setTesting] = useState(false)

  const update = (key, val) => setForm(prev => ({ ...prev, [key]: val }))

  const save = () => {
    onSave(form)
    addToast('Settings saved', 'success')
  }

  const testDiscord = async () => {
    if (!form.discordWebhook) {
      addToast('Enter a Discord webhook URL first', 'error')
      return
    }
    setTesting(true)
    try {
      await sendDiscordAlert(form.discordWebhook, {
        side: 'BUY',
        size: '99999',
        price: '0.65',
        outcome: 'Yes',
        owner: '0xTestWallet1234567890abcdef',
        match_time: new Date().toISOString(),
        transaction_hash: null,
      }, { question: '🔔 Test alert from PolyWhale — setup is working!' }, 88)
      addToast('Test alert sent to Discord!', 'success')
    } catch {
      addToast('Failed to send — check your webhook URL', 'error')
    }
    setTesting(false)
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white">Settings</h2>
        <p className="text-sm text-slate-500">Configure alerts, thresholds, and display options</p>
      </div>

      <div className="space-y-4">
        {/* Discord Webhook */}
        <Section title="Discord Alerts" icon="🔔">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Webhook URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={form.discordWebhook || ''}
                  onChange={e => update('discordWebhook', e.target.value)}
                  placeholder="https://discord.com/api/webhooks/…"
                  className="flex-1 bg-bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-blue mono"
                />
                <button
                  onClick={testDiscord}
                  disabled={testing}
                  className="px-3 py-2 rounded-lg bg-bg-secondary border border-border text-sm text-slate-300 hover:text-white hover:border-border-light transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  {testing ? 'Sending…' : 'Test'}
                </button>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Create a webhook in Discord: Channel Settings → Integrations → Webhooks
              </p>
            </div>

            <div className="space-y-2">
              <Toggle
                label="Alert on all whale trades"
                description="Get a Discord ping for every trade ≥ threshold"
                checked={form.notifyWhales || false}
                onChange={v => update('notifyWhales', v)}
              />
              <Toggle
                label="Alert on watchlist trades"
                description="Get instantly notified when a watched wallet makes a move"
                checked={form.notifyWatchlist !== false}
                onChange={v => update('notifyWatchlist', v)}
              />
            </div>
          </div>
        </Section>

        {/* Thresholds */}
        <Section title="Trade Threshold" icon="💰">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Minimum trade size (USDC)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1000}
                max={1000000}
                step={1000}
                value={form.threshold || DEFAULT_THRESHOLD}
                onChange={e => update('threshold', parseInt(e.target.value) || DEFAULT_THRESHOLD)}
                className="w-36 bg-bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-accent-blue mono"
              />
              <span className="text-sm text-slate-400">
                = ${(form.threshold || DEFAULT_THRESHOLD).toLocaleString()}
              </span>
            </div>
            <div className="flex gap-2 mt-2">
              {[10000, 25000, 50000, 100000].map(v => (
                <button
                  key={v}
                  onClick={() => update('threshold', v)}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    form.threshold === v
                      ? 'bg-accent-blue text-white'
                      : 'bg-bg-secondary border border-border text-slate-400 hover:text-white'
                  }`}
                >
                  ${(v / 1000).toFixed(0)}K
                </button>
              ))}
            </div>
          </div>
        </Section>

        {/* Display */}
        <Section title="Display Options" icon="🎨">
          <Toggle
            label="Show sports markets"
            description="Include sports prediction markets in the feed (filtered out by default)"
            checked={form.showSports || false}
            onChange={v => update('showSports', v)}
          />
        </Section>

        {/* About */}
        <Section title="About" icon="ℹ️">
          <div className="text-sm text-slate-400 space-y-2">
            <p>
              PolyWhale tracks large trades on <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Polymarket</a> using their public data API.
            </p>
            <p>
              The <strong className="text-slate-300">Insider Score</strong> (0–100) is a heuristic combining trade size, price extremity, market type, and wallet history. A high score does not confirm illegal activity — it simply flags unusual patterns worth investigating.
            </p>
            <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
              <ScoreLegend color="text-red-400" bg="bg-red-500/10" label="75–100 Extreme" desc="Very large, suspicious pattern" />
              <ScoreLegend color="text-yellow-400" bg="bg-yellow-500/10" label="55–74 High" desc="Notable conviction or size" />
              <ScoreLegend color="text-blue-400" bg="bg-blue-500/10" label="35–54 Medium" desc="Above-average whale trade" />
              <ScoreLegend color="text-slate-400" bg="bg-slate-500/10" label="0–34 Low" desc="Standard whale activity" />
            </div>
            <p className="text-xs text-slate-600 mt-3">
              Data sourced from Polymarket's public APIs. Refreshes every 15 seconds. All data is on-chain and publicly verifiable.
            </p>
          </div>
        </Section>
      </div>

      {/* Save button */}
      <div className="mt-6 flex gap-3">
        <button onClick={save} className="btn-primary px-6">
          Save Settings
        </button>
        <button
          onClick={() => { setForm(settings); addToast('Changes discarded', 'info') }}
          className="px-6 py-2 rounded-lg bg-bg-card border border-border text-sm text-slate-400 hover:text-white transition-colors"
        >
          Discard
        </button>
      </div>
    </div>
  )
}

function Section({ title, icon, children }) {
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
        <span>{icon}</span>
        {title}
      </h3>
      {children}
    </div>
  )
}

function Toggle({ label, description, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <div className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="sr-only"
        />
        <div
          onClick={() => onChange(!checked)}
          className={`w-10 h-5 rounded-full transition-colors ${checked ? 'bg-accent-blue' : 'bg-bg-secondary border border-border'}`}
        >
          <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
        </div>
      </div>
      <div>
        <div className="text-sm text-slate-300 group-hover:text-white transition-colors">{label}</div>
        {description && <div className="text-xs text-slate-600 mt-0.5">{description}</div>}
      </div>
    </label>
  )
}

function ScoreLegend({ color, bg, label, desc }) {
  return (
    <div className={`rounded-lg p-2.5 ${bg}`}>
      <div className={`font-semibold text-xs ${color}`}>{label}</div>
      <div className="text-slate-600 text-xs mt-0.5">{desc}</div>
    </div>
  )
}

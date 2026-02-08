export interface Config {
  level: string[]
  items: string[]
  events: string[]
  killfeed: boolean
  ppTimer: boolean
  delay: number
  showNicknames: boolean
  showTournament: boolean
  autoTargetFrameCover: boolean
  scoreboard: {
    active: boolean
    score: boolean
    tags: boolean
    standings: boolean
    barons: boolean
    heralds: boolean
    tower: boolean
  }
  spectator?: {
    riotId: string
    region: string
    autoPolling: boolean
    pollingIntervalMs: number
  }
}

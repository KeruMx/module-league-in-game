/**
 * Spectator Bootstrap Types
 * These types define the data structures for the Riot API bootstrap flow
 */

/**
 * Supported Riot regions for the Summoner and Spectator APIs
 * Maps user-friendly region codes to API platform routing values
 */
export const RIOT_REGIONS = {
  // Americas
  NA: { platform: 'na1', regional: 'americas' },
  BR: { platform: 'br1', regional: 'americas' },
  LAN: { platform: 'la1', regional: 'americas' },
  LAS: { platform: 'la2', regional: 'americas' },
  // Europe
  EUW: { platform: 'euw1', regional: 'europe' },
  EUNE: { platform: 'eun1', regional: 'europe' },
  TR: { platform: 'tr1', regional: 'europe' },
  RU: { platform: 'ru', regional: 'europe' },
  // Asia
  KR: { platform: 'kr', regional: 'asia' },
  JP: { platform: 'jp1', regional: 'asia' },
  // SEA
  OCE: { platform: 'oc1', regional: 'sea' },
  PH: { platform: 'ph2', regional: 'sea' },
  SG: { platform: 'sg2', regional: 'sea' },
  TH: { platform: 'th2', regional: 'sea' },
  TW: { platform: 'tw2', regional: 'sea' },
  VN: { platform: 'vn2', regional: 'sea' }
} as const

export type RegionCode = keyof typeof RIOT_REGIONS

/**
 * Parsed Riot ID from user input
 */
export interface ParsedRiotId {
  gameName: string
  tagLine: string
}

/**
 * Configuration for spectator bootstrap
 */
export interface SpectatorConfig {
  riotId: string // Format: gameName#tagLine
  region: RegionCode
}

/**
 * Account data from Riot Account API
 */
export interface RiotAccountData {
  puuid: string
  gameName: string
  tagLine: string
}

/**
 * Summoner data from Riot Summoner API
 */
export interface SummonerData {
  id: string // encryptedSummonerId
  accountId: string
  puuid: string
  profileIconId: number
  revisionDate: number
  summonerLevel: number
}

/**
 * Observer data from Spectator API
 */
export interface ObserverData {
  encryptionKey: string
}

/**
 * Participant in a spectator game
 */
export interface SpectatorParticipant {
  puuid: string
  teamId: number
  spell1Id: number
  spell2Id: number
  championId: number
  profileIconId: number
  riotId: string
  bot: boolean
  summonerId: string
  gameCustomizationObjects: unknown[]
  perks: {
    perkIds: number[]
    perkStyle: number
    perkSubStyle: number
  }
}

/**
 * Active game data from Spectator-V5 API
 */
export interface ActiveGameData {
  gameId: number
  mapId: number
  gameMode: string
  gameType: string
  gameQueueConfigId: number
  participants: SpectatorParticipant[]
  observers: ObserverData
  platformId: string
  bannedChampions: unknown[]
  gameStartTime: number
  gameLength: number
}

/**
 * Final spectator bootstrap output
 * This is the structured object consumed by the low-level Spectator parser
 */
export interface SpectatorBootstrap {
  gameId: number
  platformId: string
  encryptionKey: string
  region: string
  spectatorReady: boolean
}

/**
 * Internal state for tracking the bootstrap flow
 */
export interface SpectatorBootstrapState {
  config: SpectatorConfig | null
  puuid: string | null
  encryptedSummonerId: string | null
  activeGame: ActiveGameData | null
  bootstrap: SpectatorBootstrap | null
  lastError: string | null
  isPolling: boolean
}

/**
 * Cache entry for PUUID lookups
 */
export interface PuuidCacheEntry {
  puuid: string
  gameName: string
  tagLine: string
  region: RegionCode
  cachedAt: number
}

/**
 * Rate limit error from Riot API
 */
export interface RateLimitError {
  retryAfter: number
}

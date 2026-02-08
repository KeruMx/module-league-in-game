import type { PluginContext } from '@rcv-prod-toolkit/types'
import {
  RIOT_REGIONS,
  RegionCode,
  ParsedRiotId,
  RiotAccountData,
  SummonerData,
  ActiveGameData,
  PuuidCacheEntry
} from '../types/SpectatorTypes'

/**
 * Service for interacting with Riot APIs to bootstrap Spectator access
 * Handles PUUID resolution, Summoner lookup, and active game detection
 */
export class RiotApiService {
  private puuidCache: Map<string, PuuidCacheEntry> = new Map()
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
  private readonly MAX_RETRIES = 3
  private readonly BASE_RETRY_DELAY_MS = 1000

  constructor(
    private ctx: PluginContext,
    private apiKey: string
  ) {}

  /**
   * Validates and parses a Riot ID string in the format gameName#tagLine
   */
  parseRiotId(riotId: string): ParsedRiotId | null {
    if (!riotId || typeof riotId !== 'string') {
      return null
    }

    const trimmed = riotId.trim()
    const hashIndex = trimmed.lastIndexOf('#')

    if (hashIndex === -1 || hashIndex === 0 || hashIndex === trimmed.length - 1) {
      return null
    }

    const gameName = trimmed.substring(0, hashIndex).trim()
    const tagLine = trimmed.substring(hashIndex + 1).trim()

    // Validate gameName (3-16 characters)
    if (gameName.length < 3 || gameName.length > 16) {
      return null
    }

    // Validate tagLine (3-5 characters)
    if (tagLine.length < 3 || tagLine.length > 5) {
      return null
    }

    return { gameName, tagLine }
  }

  /**
   * Validates that a region code is supported
   */
  isValidRegion(region: string): region is RegionCode {
    return region in RIOT_REGIONS
  }

  /**
   * Gets the regional routing value for a given region code
   */
  getRegionalRouting(region: RegionCode): string {
    return RIOT_REGIONS[region].regional
  }

  /**
   * Gets the platform routing value for a given region code
   */
  getPlatformRouting(region: RegionCode): string {
    return RIOT_REGIONS[region].platform
  }

  /**
   * Generates a cache key for PUUID lookups
   */
  private getCacheKey(gameName: string, tagLine: string, region: RegionCode): string {
    return `${gameName.toLowerCase()}#${tagLine.toLowerCase()}@${region}`
  }

  /**
   * Checks if a cached PUUID entry is still valid
   */
  private isCacheValid(entry: PuuidCacheEntry): boolean {
    return Date.now() - entry.cachedAt < this.CACHE_TTL_MS
  }

  /**
   * Gets a cached PUUID if available and valid
   */
  getCachedPuuid(gameName: string, tagLine: string, region: RegionCode): string | null {
    const key = this.getCacheKey(gameName, tagLine, region)
    const entry = this.puuidCache.get(key)

    if (entry && this.isCacheValid(entry)) {
      return entry.puuid
    }

    // Remove expired entry
    if (entry) {
      this.puuidCache.delete(key)
    }

    return null
  }

  /**
   * Caches a PUUID for future lookups
   */
  private cachePuuid(data: RiotAccountData, region: RegionCode): void {
    const key = this.getCacheKey(data.gameName, data.tagLine, region)
    this.puuidCache.set(key, {
      puuid: data.puuid,
      gameName: data.gameName,
      tagLine: data.tagLine,
      region,
      cachedAt: Date.now()
    })
  }

  /**
   * Makes an HTTP request to the Riot API with retry logic
   */
  private async fetchWithRetry<T>(
    url: string,
    retryCount = 0
  ): Promise<{ data: T | null; error: string | null; statusCode: number }> {
    try {
      const response = await fetch(url, {
        headers: {
          'X-Riot-Token': this.apiKey
        }
      })

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '1', 10)
        
        if (retryCount < this.MAX_RETRIES) {
          const delay = retryAfter * 1000
          this.ctx.log.warn(`Rate limited, retrying after ${retryAfter}s (attempt ${retryCount + 1}/${this.MAX_RETRIES})`)
          await this.sleep(delay)
          return this.fetchWithRetry<T>(url, retryCount + 1)
        }
        
        return { data: null, error: 'Rate limit exceeded', statusCode: 429 }
      }

      // Handle not found
      if (response.status === 404) {
        return { data: null, error: 'Not found', statusCode: 404 }
      }

      // Handle other errors
      if (!response.ok) {
        // Retry on server errors with exponential backoff
        if (response.status >= 500 && retryCount < this.MAX_RETRIES) {
          const delay = this.BASE_RETRY_DELAY_MS * Math.pow(2, retryCount)
          this.ctx.log.warn(`Server error ${response.status}, retrying after ${delay}ms (attempt ${retryCount + 1}/${this.MAX_RETRIES})`)
          await this.sleep(delay)
          return this.fetchWithRetry<T>(url, retryCount + 1)
        }
        
        return { data: null, error: `API error: ${response.status}`, statusCode: response.status }
      }

      const data = await response.json() as T
      return { data, error: null, statusCode: response.status }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      
      // Retry on network errors with exponential backoff
      if (retryCount < this.MAX_RETRIES) {
        const delay = this.BASE_RETRY_DELAY_MS * Math.pow(2, retryCount)
        this.ctx.log.warn(`Network error: ${errorMessage}, retrying after ${delay}ms (attempt ${retryCount + 1}/${this.MAX_RETRIES})`)
        await this.sleep(delay)
        return this.fetchWithRetry<T>(url, retryCount + 1)
      }
      
      return { data: null, error: `Network error: ${errorMessage}`, statusCode: 0 }
    }
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Resolves a Riot ID to a PUUID using the Riot Account API
   * Endpoint: /riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}
   */
  async resolvePuuid(
    gameName: string,
    tagLine: string,
    region: RegionCode
  ): Promise<{ puuid: string | null; error: string | null }> {
    // Check cache first
    const cached = this.getCachedPuuid(gameName, tagLine, region)
    if (cached) {
      this.ctx.log.info(`Using cached PUUID for ${gameName}#${tagLine}`)
      return { puuid: cached, error: null }
    }

    const regional = this.getRegionalRouting(region)
    const encodedGameName = encodeURIComponent(gameName)
    const encodedTagLine = encodeURIComponent(tagLine)
    const url = `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodedGameName}/${encodedTagLine}`

    this.ctx.log.info(`Resolving PUUID for ${gameName}#${tagLine} in region ${region}`)

    const result = await this.fetchWithRetry<RiotAccountData>(url)

    if (result.data) {
      // Cache the result
      this.cachePuuid(result.data, region)
      return { puuid: result.data.puuid, error: null }
    }

    if (result.statusCode === 404) {
      return { puuid: null, error: `Riot ID not found: ${gameName}#${tagLine}` }
    }

    return { puuid: null, error: result.error }
  }

  /**
   * Resolves a PUUID to an encrypted Summoner ID using the Summoner API
   * Endpoint: /lol/summoner/v4/summoners/by-puuid/{puuid}
   */
  async resolveSummonerId(
    puuid: string,
    region: RegionCode
  ): Promise<{ summonerId: string | null; error: string | null }> {
    const platform = this.getPlatformRouting(region)
    const url = `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`

    this.ctx.log.info(`Resolving Summoner ID for PUUID ${puuid.substring(0, 8)}...`)

    const result = await this.fetchWithRetry<SummonerData>(url)

    if (result.data) {
      return { summonerId: result.data.id, error: null }
    }

    if (result.statusCode === 404) {
      return { summonerId: null, error: 'Summoner not found for this PUUID' }
    }

    return { summonerId: null, error: result.error }
  }

  /**
   * Fetches active game data using the Spectator-V5 API
   * Endpoint: /lol/spectator/v5/active-games/by-summoner/{encryptedSummonerId}
   */
  async getActiveGame(
    encryptedSummonerId: string,
    region: RegionCode
  ): Promise<{ game: ActiveGameData | null; error: string | null; notInGame: boolean }> {
    const platform = this.getPlatformRouting(region)
    const url = `https://${platform}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${encryptedSummonerId}`

    this.ctx.log.info(`Checking for active game for summoner ${encryptedSummonerId.substring(0, 8)}...`)

    const result = await this.fetchWithRetry<ActiveGameData>(url)

    if (result.data) {
      return { game: result.data, error: null, notInGame: false }
    }

    if (result.statusCode === 404) {
      return { game: null, error: null, notInGame: true }
    }

    return { game: null, error: result.error, notInGame: false }
  }

  /**
   * Clears the PUUID cache
   */
  clearCache(): void {
    this.puuidCache.clear()
    this.ctx.log.info('PUUID cache cleared')
  }
}

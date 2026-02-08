import type { PluginContext } from '@rcv-prod-toolkit/types'
import { RiotApiService } from './RiotApiService'
import {
  SpectatorBootstrap,
  SpectatorBootstrapState,
  SpectatorConfig,
  RegionCode,
  RIOT_REGIONS
} from '../types/SpectatorTypes'

/**
 * Controller for orchestrating the Spectator bootstrap flow
 * Automatically resolves PUUID, Summoner ID, and detects active games
 */
export class SpectatorBootstrapController {
  private state: SpectatorBootstrapState = {
    config: null,
    puuid: null,
    encryptedSummonerId: null,
    activeGame: null,
    bootstrap: null,
    lastError: null,
    isPolling: false
  }

  private pollingInterval: ReturnType<typeof setInterval> | null = null
  private readonly POLLING_INTERVAL_MS = 30000 // 30 seconds
  private readonly MIN_POLLING_INTERVAL_MS = 10000 // 10 seconds minimum

  constructor(
    private namespace: string,
    private ctx: PluginContext,
    private riotApiService: RiotApiService
  ) {}

  /**
   * Gets the current spectator bootstrap state
   */
  getState(): SpectatorBootstrapState {
    return { ...this.state }
  }

  /**
   * Gets the spectator bootstrap output if ready
   */
  getBootstrap(): SpectatorBootstrap | null {
    return this.state.bootstrap
  }

  /**
   * Checks if spectator is ready
   */
  isSpectatorReady(): boolean {
    return this.state.bootstrap?.spectatorReady ?? false
  }

  /**
   * Gets available regions
   */
  getAvailableRegions(): string[] {
    return Object.keys(RIOT_REGIONS)
  }

  /**
   * Configures and starts the spectator bootstrap flow
   */
  async configure(riotId: string, region: string): Promise<{ success: boolean; error: string | null }> {
    // Validate region
    if (!this.riotApiService.isValidRegion(region)) {
      const error = `Invalid region: ${region}. Valid regions: ${this.getAvailableRegions().join(', ')}`
      this.state.lastError = error
      return { success: false, error }
    }

    // Parse and validate Riot ID
    const parsed = this.riotApiService.parseRiotId(riotId)
    if (!parsed) {
      const error = 'Invalid Riot ID format. Expected: gameName#tagLine (gameName: 3-16 characters, tagLine: 3-5 alphanumeric characters)'
      this.state.lastError = error
      return { success: false, error }
    }

    // Store configuration
    this.state.config = {
      riotId,
      region: region as RegionCode
    }

    this.ctx.log.info(`Configured spectator bootstrap for ${riotId} in region ${region}`)

    // Start the bootstrap flow
    return this.runBootstrapFlow()
  }

  /**
   * Runs the full bootstrap flow
   */
  private async runBootstrapFlow(): Promise<{ success: boolean; error: string | null }> {
    if (!this.state.config) {
      return { success: false, error: 'No configuration set' }
    }

    const { riotId, region } = this.state.config
    const parsed = this.riotApiService.parseRiotId(riotId)

    if (!parsed) {
      return { success: false, error: 'Invalid Riot ID' }
    }

    // Step 1: Resolve PUUID
    const puuidResult = await this.riotApiService.resolvePuuid(
      parsed.gameName,
      parsed.tagLine,
      region
    )

    if (puuidResult.error || !puuidResult.puuid) {
      this.state.lastError = puuidResult.error ?? 'Failed to resolve PUUID'
      this.emitStateUpdate()
      return { success: false, error: this.state.lastError }
    }

    this.state.puuid = puuidResult.puuid
    this.ctx.log.info(`Resolved PUUID: ${puuidResult.puuid.substring(0, 8)}...`)

    // Step 2: Resolve Summoner ID
    const summonerResult = await this.riotApiService.resolveSummonerId(
      puuidResult.puuid,
      region
    )

    if (summonerResult.error || !summonerResult.summonerId) {
      this.state.lastError = summonerResult.error ?? 'Failed to resolve Summoner ID'
      this.emitStateUpdate()
      return { success: false, error: this.state.lastError }
    }

    this.state.encryptedSummonerId = summonerResult.summonerId
    this.ctx.log.info(`Resolved Summoner ID: ${summonerResult.summonerId.substring(0, 8)}...`)

    // Step 3: Check for active game
    await this.checkActiveGame()

    this.state.lastError = null
    return { success: true, error: null }
  }

  /**
   * Checks if the player is in an active game
   */
  private async checkActiveGame(): Promise<void> {
    if (!this.state.config || !this.state.encryptedSummonerId) {
      return
    }

    const { region } = this.state.config

    const gameResult = await this.riotApiService.getActiveGame(
      this.state.encryptedSummonerId,
      region
    )

    if (gameResult.error) {
      this.ctx.log.warn(`Failed to check active game: ${gameResult.error}`)
      this.state.lastError = gameResult.error
      this.state.bootstrap = null
      this.emitStateUpdate()
      return
    }

    if (gameResult.notInGame) {
      this.ctx.log.info('Player is not currently in a game')
      this.state.activeGame = null
      this.state.bootstrap = {
        gameId: 0,
        platformId: '',
        encryptionKey: '',
        region: region,
        spectatorReady: false
      }
      this.emitStateUpdate()
      return
    }

    if (gameResult.game) {
      this.state.activeGame = gameResult.game
      this.state.bootstrap = {
        gameId: gameResult.game.gameId,
        platformId: gameResult.game.platformId,
        encryptionKey: gameResult.game.observers.encryptionKey,
        region: region,
        spectatorReady: true
      }

      this.ctx.log.info(`Active game detected! Game ID: ${gameResult.game.gameId}, Platform: ${gameResult.game.platformId}`)
      this.emitStateUpdate()
    }
  }

  /**
   * Starts polling for active game status
   */
  startPolling(intervalMs?: number): void {
    if (this.state.isPolling) {
      this.ctx.log.warn('Polling is already active')
      return
    }

    if (!this.state.config || !this.state.encryptedSummonerId) {
      this.ctx.log.warn('Cannot start polling: bootstrap not configured')
      return
    }

    const interval = Math.max(intervalMs ?? this.POLLING_INTERVAL_MS, this.MIN_POLLING_INTERVAL_MS)
    
    this.state.isPolling = true
    this.ctx.log.info(`Starting active game polling every ${interval / 1000}s`)

    this.pollingInterval = setInterval(async () => {
      await this.checkActiveGame()
    }, interval)
  }

  /**
   * Stops polling for active game status
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }
    this.state.isPolling = false
    this.ctx.log.info('Stopped active game polling')
  }

  /**
   * Manually refreshes the active game status
   */
  async refresh(): Promise<{ success: boolean; error: string | null }> {
    if (!this.state.config || !this.state.encryptedSummonerId) {
      return { success: false, error: 'Bootstrap not configured' }
    }

    await this.checkActiveGame()
    return { success: true, error: this.state.lastError }
  }

  /**
   * Resets the bootstrap state
   */
  reset(): void {
    this.stopPolling()
    this.state = {
      config: null,
      puuid: null,
      encryptedSummonerId: null,
      activeGame: null,
      bootstrap: null,
      lastError: null,
      isPolling: false
    }
    this.ctx.log.info('Spectator bootstrap state reset')
    this.emitStateUpdate()
  }

  /**
   * Emits state update event
   */
  private emitStateUpdate(): void {
    this.ctx.LPTE.emit({
      meta: {
        type: 'spectator-state-update',
        namespace: this.namespace,
        version: 1
      },
      state: this.getState(),
      bootstrap: this.getBootstrap()
    })
  }
}

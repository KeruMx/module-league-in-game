import type { PluginContext } from '@rcv-prod-toolkit/types'
import { InGameState } from './controller/InGameState'
import { RiotApiService } from './controller/RiotApiService'
import { SpectatorBootstrapController } from './controller/SpectatorBootstrapController'
import type { AllGameData } from './types/AllGameData'
import type { Config } from './types/Config'
import { FarsightData } from './types/FarsightData'
import { RIOT_REGIONS } from './types/SpectatorTypes'

module.exports = async (ctx: PluginContext) => {
  const namespace = ctx.plugin.module.getName()

  // Get Riot API key from environment variable
  const riotApiKey = process.env.RIOT_API_KEY || ''
  if (!riotApiKey) {
    ctx.log.warn('RIOT_API_KEY environment variable not set. Spectator bootstrap features will be disabled.')
  }

  const configRes = await ctx.LPTE.request({
    meta: {
      type: 'request',
      namespace: 'plugin-config',
      version: 1
    }
  })
  if (configRes === undefined) {
    ctx.log.warn('config could not be loaded')
  }
  let config: Config = Object.assign(
    {
      items: [],
      level: [],
      events: [],
      killfeed: false,
      ppTimer: false,
      showNicknames: false,
      showTournament: true,
      delay: 0,
      autoTargetFrameCover: false,
      scoreboard: {
        active: true,
        barons: true,
        heralds: true,
        score: true,
        standings: true,
        tags: true,
        tower: true
      },
      spectator: {
        riotId: '',
        region: 'NA',
        autoPolling: false,
        pollingIntervalMs: 30000
      }
    } as Config,
    configRes?.config
  )

  // Initialize Riot API service and Spectator Bootstrap controller
  let riotApiService: RiotApiService | null = null
  let spectatorBootstrap: SpectatorBootstrapController | null = null

  if (riotApiKey) {
    riotApiService = new RiotApiService(ctx, riotApiKey)
    spectatorBootstrap = new SpectatorBootstrapController(namespace, ctx, riotApiService)
  }

  ctx.LPTE.on(namespace, 'set-settings', (e) => {
    config.items = e.items
    config.level = e.level
    config.events = e.events
    config.killfeed = e.killfeed
    config.ppTimer = e.ppTimer
    config.delay = e.delay
    config.autoTargetFrameCover = e.autoTargetFrameCover
    config.showNicknames = e.showNicknames
    config.showTournament = e.showTournament
    config.scoreboard = e.scoreboard

    ctx.LPTE.emit({
      meta: {
        type: 'set',
        namespace: 'plugin-config',
        version: 1
      },
      config
    })

    if (inGameState !== undefined) {
      inGameState.config = config
    }
  })

  ctx.LPTE.on(namespace, 'get-settings', (e) => {
    ctx.LPTE.emit({
      meta: {
        type: e.meta.reply!,
        namespace: 'reply',
        version: 1
      },
      ...config
    })
  })

  ctx.LPTE.emit({
    meta: {
      type: 'add-pages',
      namespace: 'ui',
      version: 1
    },
    pages: [
      {
        name: 'LoL: In-Game',
        frontend: 'frontend',
        id: `op-${namespace}`
      }
    ]
  })

  let inGameState: InGameState

  ctx.LPTE.on('module-league-static', 'static-loaded', async (e) => {
    const statics = e.constants

    const stateRes = await ctx.LPTE.request({
      meta: {
        type: 'request',
        namespace: 'module-league-state',
        version: 1
      }
    })
    const state = stateRes?.state

    ctx.LPTE.on('lcu', 'lcu-champ-select-create', () => {
      inGameState = new InGameState(namespace, ctx, config, state, statics)
    })

    ctx.LPTE.on(namespace, 'reset-game', () => {
      ctx.log.info('Resetting in game data')
      inGameState = new InGameState(namespace, ctx, config, state, statics)
    })

    ctx.LPTE.on(namespace, 'allgamedata', (e) => {
      if (inGameState === undefined) {
        inGameState = new InGameState(namespace, ctx, config, state, statics)
      }

      const data = e.data as AllGameData
      inGameState.handelData(data)
    })

    ctx.LPTE.on(namespace, 'farsight-data', (e) => {
      if (inGameState === undefined) {
        inGameState = new InGameState(namespace, ctx, config, state, statics)
      }

      const data = e.data as FarsightData
      inGameState.handelFarsightData(data)
    })

    ctx.LPTE.on(namespace, 'live-events', (e) => {
      if (inGameState === undefined) {
        inGameState = new InGameState(namespace, ctx, config, state, statics)
      }

      e.data.forEach((event: any) => {
        inGameState.handelEvent(event)
      })
    })

    ctx.LPTE.on('module-league-replay', 'set-playback', (e) => {
      if (inGameState === undefined) {
        inGameState = new InGameState(namespace, ctx, config, state, statics)
      }

      const data = e.data as any
      inGameState.handelReplayData(data)
    })

    ctx.LPTE.on(namespace, 'request', (e) => {
      if (inGameState === undefined) {
        inGameState = new InGameState(namespace, ctx, config, state, statics)
      }

      ctx.LPTE.emit({
        meta: {
          type: e.meta.reply as string,
          namespace: 'reply',
          version: 1
        },
        state: inGameState.gameState
      })
    })
  })

  ctx.LPTE.on(namespace, 'show-inhibs', (e) => {
    if (inGameState === undefined) return
    const side = parseInt(e.side) as any
    inGameState.gameState.showInhibitors = side
  })
  ctx.LPTE.on(namespace, 'show-leader-board', (e) => {
    if (inGameState === undefined) return
    const leaderboard = e.leaderboard
    inGameState.gameState.showLeaderBoard = leaderboard
  })
  ctx.LPTE.on(namespace, 'show-platings', (e) => {
    if (inGameState === undefined) return
    inGameState.gameState.platings.showPlatings = true
  })

  ctx.LPTE.on(namespace, 'hide-inhibs', (e) => {
    if (inGameState === undefined) return
    inGameState.gameState.showInhibitors = null
  })
  ctx.LPTE.on(namespace, 'hide-platings', (e) => {
    if (inGameState === undefined) return
    inGameState.gameState.platings.showPlatings = false
  })
  ctx.LPTE.on(namespace, 'hide-leader-board', (e) => {
    if (inGameState === undefined) return
    inGameState.gameState.showLeaderBoard = false
  })

  // Spectator Bootstrap event handlers
  ctx.LPTE.on(namespace, 'spectator-configure', async (e) => {
    if (!spectatorBootstrap) {
      ctx.LPTE.emit({
        meta: {
          type: e.meta.reply as string,
          namespace: 'reply',
          version: 1
        },
        success: false,
        error: 'Spectator bootstrap not available. Set RIOT_API_KEY environment variable.'
      })
      return
    }

    const result = await spectatorBootstrap.configure(e.riotId, e.region)

    // Update config with new spectator settings
    if (result.success && e.riotId && e.region) {
      config.spectator = {
        riotId: e.riotId,
        region: e.region,
        autoPolling: e.autoPolling ?? false,
        pollingIntervalMs: e.pollingIntervalMs ?? 30000
      }

      // Start polling if requested
      if (e.autoPolling) {
        spectatorBootstrap.startPolling(e.pollingIntervalMs)
      }

      // Save config
      ctx.LPTE.emit({
        meta: {
          type: 'set',
          namespace: 'plugin-config',
          version: 1
        },
        config
      })
    }

    ctx.LPTE.emit({
      meta: {
        type: e.meta.reply as string,
        namespace: 'reply',
        version: 1
      },
      ...result,
      bootstrap: spectatorBootstrap.getBootstrap()
    })
  })

  ctx.LPTE.on(namespace, 'spectator-refresh', async (e) => {
    if (!spectatorBootstrap) {
      ctx.LPTE.emit({
        meta: {
          type: e.meta.reply as string,
          namespace: 'reply',
          version: 1
        },
        success: false,
        error: 'Spectator bootstrap not available'
      })
      return
    }

    const result = await spectatorBootstrap.refresh()

    ctx.LPTE.emit({
      meta: {
        type: e.meta.reply as string,
        namespace: 'reply',
        version: 1
      },
      ...result,
      bootstrap: spectatorBootstrap.getBootstrap()
    })
  })

  ctx.LPTE.on(namespace, 'spectator-start-polling', (e) => {
    if (!spectatorBootstrap) return
    spectatorBootstrap.startPolling(e.intervalMs)
  })

  ctx.LPTE.on(namespace, 'spectator-stop-polling', () => {
    if (!spectatorBootstrap) return
    spectatorBootstrap.stopPolling()
  })

  ctx.LPTE.on(namespace, 'spectator-reset', () => {
    if (!spectatorBootstrap) return
    spectatorBootstrap.reset()
  })

  ctx.LPTE.on(namespace, 'spectator-get-state', (e) => {
    ctx.LPTE.emit({
      meta: {
        type: e.meta.reply as string,
        namespace: 'reply',
        version: 1
      },
      available: !!spectatorBootstrap,
      state: spectatorBootstrap?.getState() ?? null,
      bootstrap: spectatorBootstrap?.getBootstrap() ?? null,
      regions: Object.keys(RIOT_REGIONS)
    })
  })

  ctx.LPTE.on(namespace, 'spectator-get-bootstrap', (e) => {
    ctx.LPTE.emit({
      meta: {
        type: e.meta.reply as string,
        namespace: 'reply',
        version: 1
      },
      bootstrap: spectatorBootstrap?.getBootstrap() ?? null
    })
  })

  // Emit event that we're ready to operate
  ctx.LPTE.emit({
    meta: {
      type: 'plugin-status-change',
      namespace: 'lpt',
      version: 1
    },
    status: 'RUNNING'
  })
}

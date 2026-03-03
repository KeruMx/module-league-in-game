import type { PluginContext } from '@rcv-prod-toolkit/types'
import { AllGameData, Player, Event } from '../types/AllGameData'
import { Config } from '../types/Config'
import { ItemEpicness } from '../types/Items'
import { InGameState as InGameStateType } from '../types/InGameState'
import { EventType, InGameEvent, MobType, TeamType } from '../types/InGameEvent'
import { randomUUID } from 'crypto'
import { FarsightData } from '../types/FarsightData'
import { Player as PlayerClass } from './Player'

export class InGameState {
  public gameState: InGameStateType
  public gameData: AllGameData[] = []
  public farsightDataArray: FarsightData[] = []
  public itemEpicness: number[]

  public firstBloodOccurred: boolean = false
  public actions: Map<string, (allGameData: AllGameData, id: string) => void> =
    new Map()

  // Map dragon types from Live Client API format to internal MobType
  private static readonly dragonTypeMap: { [key: string]: MobType } = {
    'Hextech': MobType.HextechDragon,
    'Chemtech': MobType.ChemtechDragon,
    'Air': MobType.CloudDragon,
    'Cloud': MobType.CloudDragon,
    'Elder': MobType.ElderDragon,
    'Fire': MobType.InfernalDragon,
    'Infernal': MobType.InfernalDragon,
    'Water': MobType.OceanDragon,
    'Ocean': MobType.OceanDragon,
    'Earth': MobType.MountainDragon,
    'Mountain': MobType.MountainDragon
  }

  constructor(
    private namespace: string,
    private ctx: PluginContext,
    public config: Config,
    private state: any,
    private statics: any
  ) {
    this.itemEpicness = this.config.items?.map((i) => ItemEpicness[i])

    this.gameState = {
      gameTime: 0,
      currentPlayer: '',
      showLeaderBoard: false,
      scoreboard: true,
      targetFrameCover: false,
      towers: {
        100: {
          L2: {},
          L1: {},
          L0: {}
        },
        200: {
          L2: {},
          L1: {},
          L0: {}
        }
      },
      platings: {
        showPlatings: false,
        100: {
          L2: 0,
          L1: 0,
          L0: 0
        },
        200: {
          L2: 0,
          L1: 0,
          L0: 0
        }
      },
      showInhibitors: null,
      inhibitors: {
        100: {
          L2: {
            alive: true,
            respawnAt: 0,
            respawnIn: 0,
            percent: 0,
            time: 0
          },
          L1: {
            alive: true,
            respawnAt: 0,
            respawnIn: 0,
            percent: 0,
            time: 0
          },
          L0: {
            alive: true,
            respawnAt: 0,
            respawnIn: 0,
            percent: 0,
            time: 0
          }
        },
        200: {
          L2: {
            alive: true,
            respawnAt: 0,
            respawnIn: 0,
            percent: 0,
            time: 0
          },
          L1: {
            alive: true,
            respawnAt: 0,
            respawnIn: 0,
            percent: 0,
            time: 0
          },
          L0: {
            alive: true,
            respawnAt: 0,
            respawnIn: 0,
            percent: 0,
            time: 0
          }
        }
      },
      player: [],
      gold: {
        100: 0,
        200: 0
      },
      kills: {
        100: 0,
        200: 0
      },
      goldGraph: {},
      objectives: {
        100: [],
        200: []
      }
    }

    this.ctx.LPTE.emit({
      meta: {
        namespace: this.namespace,
        type: 'update',
        version: 1
      },
      state: this.convertGameState()
    })

    this.ctx.LPTE.emit({
      meta: {
        namespace: this.namespace,
        type: 'pp-update',
        version: 1
      },
      type: 'Baron',
      ongoing: false,
      percent: 0,
      respawnIn: 0
    })

    this.ctx.LPTE.emit({
      meta: {
        namespace: this.namespace,
        type: 'pp-update',
        version: 1
      },
      type: 'Dragon',
      ongoing: false,
      percent: 0,
      respawnIn: 0
    })

    this.updateState()
  }

  public convertGameState() {
    return {
      ...this.gameState,
      gameTime: this.gameState.gameTime + (this.config.delay / 1000),
      player: Object.values(this.gameState.player).map((p) => {
        return {
          ...p,
          items: [...p.items.values()]
        }
      })
    }
  }

  public updateState() {
    this.ctx.LPTE.emit({
      meta: {
        namespace: 'module-league-state',
        type: 'save-live-game-stats',
        version: 1
      },
      gameState: this.convertGameState()
    })
  }

  // Gold estimation constants
  private static readonly STARTING_GOLD = 500
  private static readonly PASSIVE_GOLD_START = 110 // 1:50 in seconds
  private static readonly PASSIVE_GOLD_RATE = 2.04 // gold per second after 1:50
  private static readonly GOLD_PER_CS = 14 // ~14g average (melee ~21g, caster ~14g, jungle varies)
  private static readonly GOLD_PER_KILL = 300 // average gold per kill
  private static readonly GOLD_PER_ASSIST = 100 // average gold per assist
  // Objective gold per team (shared across 5 players)
  private static readonly GOLD_PER_DRAGON = 125 // ~25g per player
  private static readonly GOLD_PER_BARON = 1500 // ~300g per player
  private static readonly GOLD_PER_HERALD = 100 // local gold for killer
  private static readonly GOLD_PER_PLATE = 175 // per tower plate destroyed

  /**
   * Estimates gold for each player and team based on items, CS, kills,
   * assists, passive gold income, and objective gold. Used because the
   * Live Client API does not provide totalGold in spectator mode.
   */
  private estimateGoldFromGameData(allGameData: AllGameData): void {
    if (allGameData.allPlayers.length === 0) return

    const gameTime = allGameData.gameData.gameTime

    let gold100 = 0
    let gold200 = 0

    for (const player of allGameData.allPlayers) {
      // Sum item prices (gold spent on current items - known minimum)
      const itemsGold = player.items.reduce((sum, item) => sum + (item.price * item.count), 0)

      // Passive gold income (starts at 1:50)
      const passiveGold = Math.max(0, gameTime - InGameState.PASSIVE_GOLD_START) * InGameState.PASSIVE_GOLD_RATE

      // Estimate from CS, kills, assists
      const csGold = player.scores.creepScore * InGameState.GOLD_PER_CS
      const killGold = player.scores.kills * InGameState.GOLD_PER_KILL
      const assistGold = player.scores.assists * InGameState.GOLD_PER_ASSIST

      // Total estimated gold = starting + passive + cs + kills + assists
      const formulaGold = InGameState.STARTING_GOLD + passiveGold + csGold + killGold + assistGold

      // Use the higher of: formula estimate or items cost (items is a known minimum)
      const estimatedGold = Math.max(formulaGold, itemsGold)

      // Update individual player gold
      const statePlayer = this.gameState.player.find(
        p => p.riotIdGameName === player.riotIdGameName
      )
      if (statePlayer) {
        statePlayer.totalGold = Math.round(estimatedGold)
      }

      // Aggregate team gold
      if (player.team === 'ORDER') {
        gold100 += estimatedGold
      } else if (player.team === 'CHAOS') {
        gold200 += estimatedGold
      }
    }

    // Add objective gold (dragons, barons, heralds)
    for (const obj of this.gameState.objectives[100]) {
      if (obj.type === EventType.DragonKill) gold100 += InGameState.GOLD_PER_DRAGON
      else if (obj.type === EventType.BaronKill) gold100 += InGameState.GOLD_PER_BARON
      else if (obj.type === EventType.HeraldKill) gold100 += InGameState.GOLD_PER_HERALD
    }
    for (const obj of this.gameState.objectives[200]) {
      if (obj.type === EventType.DragonKill) gold200 += InGameState.GOLD_PER_DRAGON
      else if (obj.type === EventType.BaronKill) gold200 += InGameState.GOLD_PER_BARON
      else if (obj.type === EventType.HeraldKill) gold200 += InGameState.GOLD_PER_HERALD
    }

    // Add tower plate gold (plates are destroyed from enemy towers, gold goes to attacking team)
    // platings[100] = plates destroyed on blue side → gold for red team (200)
    // platings[200] = plates destroyed on red side → gold for blue team (100)
    const p200 = this.gameState.platings[200]
    const bluePlates = p200.L2 + p200.L1 + p200.L0
    const p100 = this.gameState.platings[100]
    const redPlates = p100.L2 + p100.L1 + p100.L0
    gold100 += bluePlates * InGameState.GOLD_PER_PLATE
    gold200 += redPlates * InGameState.GOLD_PER_PLATE

    // Update team gold
    this.gameState.gold[100] = Math.round(gold100)
    this.gameState.gold[200] = Math.round(gold200)

    // Update gold graph (gold difference over time)
    this.gameState.goldGraph[Math.round(gameTime)] = Math.round(gold100 - gold200)
  }

  public handelData(allGameData: AllGameData): void {
    if (this.gameData.length > 0) {
      let previousGameData = this.gameData[this.gameData.length - 1]

      if (allGameData.gameData.gameTime < previousGameData.gameData.gameTime) {
        this.gameData = this.gameData.filter(
          (gd) => gd.gameData.gameTime < allGameData.gameData.gameTime
        )

        if (this.gameData.length <= 0) return
        previousGameData = this.gameData[this.gameData.length - 1]
      }

      this.gameState.gameTime = allGameData.gameData.gameTime

      allGameData.allPlayers.forEach((p, i) => {
        if (this.gameState.player.find(pl => pl.riotIdGameName === p.riotIdGameName) !== undefined) return

        const champ = this.statics.champions.find((c: any) => c.name === p.championName)
        this.gameState.player.splice(i, 0, new PlayerClass(
          p.riotIdGameName,
          p.team,
          p.championName,
          champ.id,
          champ.key
        ));
      })

      // Estimate gold from available game data (items, CS, kills, assists, passive income)
      this.estimateGoldFromGameData(allGameData)

      setTimeout(() => {
        this.checkPlayerUpdate(allGameData)
        this.checkEventUpdate(allGameData, previousGameData)

        for (const [id, func] of this.actions.entries()) {
          func(allGameData, id)
        }

        this.ctx.LPTE.emit({
          meta: {
            namespace: this.namespace,
            type: 'update',
            version: 1
          },
          state: this.convertGameState()
        })
      }, this.config.delay / 2)
    }

    this.gameData.push(allGameData)
  }

  public handelReplayData(replayData: any): void {
    if (replayData.selectionName === '' || replayData.selectionName === undefined) {
      if (this.config.autoTargetFrameCover && !this.gameState.targetFrameCover) {
        this.gameState.targetFrameCover = true

        this.ctx.LPTE.emit({
          meta: {
            namespace: this.namespace,
            type: 'show-target-frame-cover',
            version: 1
          }
        })
      }
    }

    if (replayData.interfaceScoreboard !== this.gameState.scoreboard) {
      this.gameState.scoreboard = replayData.interfaceScoreboard
      this.ctx.LPTE.emit({
        meta: {
          namespace: this.namespace,
          type: 'player-cams-lol',
          version: 1
        },
        visibilty: replayData.interfaceScoreboard
      })
    }

    setTimeout(() => {
      if (replayData.selectionName === this.gameState.currentPlayer && this.gameState.currentPlayer !== '') {
        if (this.config.autoTargetFrameCover && this.gameState.targetFrameCover) {
          this.gameState.targetFrameCover = false

          this.ctx.LPTE.emit({
            meta: {
              namespace: this.namespace,
              type: 'hide-target-frame-cover',
              version: 1
            }
          })
        }
        return
      }

      this.gameState.currentPlayer = replayData.selectionName

      const playerIndex = this.gameState.player.findIndex(p => p.riotIdGameName === replayData.selectionName)

      if (playerIndex === -1 || this.gameState.player[playerIndex].isDead) {
        return
      }

      if (this.config.autoTargetFrameCover && this.gameState.targetFrameCover) {
        this.gameState.targetFrameCover = false

        this.ctx.LPTE.emit({
          meta: {
            namespace: this.namespace,
            type: 'hide-target-frame-cover',
            version: 1
          }
        })
      }

      const firstPlayerIndex = playerIndex < 5 ? playerIndex : playerIndex - 5
      const secondPlayerIndex = firstPlayerIndex + 5

      this.ctx.LPTE.emit({
        meta: {
          namespace: this.namespace,
          type: 'player-change-lol',
          version: 1
        },
        player1: this.gameState.player[firstPlayerIndex]?.riotIdGameName ?? '',
        player2: this.gameState.player[secondPlayerIndex]?.riotIdGameName ?? '',
      })

    }, this.config.delay / 2)
  }

  public handelFarsightData(farsightData: FarsightData): void {
    if (farsightData.champions === undefined || !Array.isArray(farsightData.champions) || farsightData.champions.length <= 0) return

    if (this.farsightDataArray.length > 0) {
      let previousFarsightData = this.farsightDataArray[this.farsightDataArray.length - 1]

      if (farsightData.gameTime < previousFarsightData?.gameTime) {
        this.farsightDataArray = this.farsightDataArray.filter(
          (gd) => gd.gameTime < farsightData.gameTime
        )

        if (this.farsightDataArray.length <= 0) return
        previousFarsightData = this.farsightDataArray[this.farsightDataArray.length - 1]
      }
    }

    this.farsightDataArray.push(farsightData)

    let gold100 = 0
    let gold200 = 0

    const champions = farsightData.champions.filter((c, i, a) => {
      return a.findIndex(ci => ci.displayName === c.displayName) === i
    })

    for (const champion of champions) {
      for (const player in this.gameState.player) {
        if (this.gameState.player[player].riotIdGameName !== champion.displayName && this.gameState.player[player].championName !== champion.name && this.gameState.player[player].championId !== champion.name) continue

        this.gameState.player[player].experience = champion.experience
        this.gameState.player[player].currentGold = champion.currentGold
        this.gameState.player[player].totalGold = champion.totalGold
      }

      if (champion.team === 100) {
        gold100 += champion.totalGold
      } else if (champion.team === 200) {
        gold200 += champion.totalGold
      }
    }

    this.gameState.goldGraph[Math.round(farsightData.gameTime)] = gold100 - gold200
    this.gameState.gold[100] = gold100
    this.gameState.gold[200] = gold200
    this.gameState.gameTime = farsightData.gameTime

    const state = this.convertGameState()

    setTimeout(() => {
      this.ctx.LPTE.emit({
        meta: {
          namespace: this.namespace,
          type: 'update',
          version: 1
        },
        state
      })
    }, this.config.delay / 2)
  }

  public handelEvent(event: InGameEvent): void {
    if (!Object.values(EventType).includes(event.eventname)) return
    if (event.eventname === EventType.StructureKill) return

    setTimeout(() => {
      const team = event.sourceTeam === TeamType.Order ? 100 : 200
      const time =
        this.gameData[this.gameData.length - 1]?.gameData.gameTime ?? 0

      if (event.eventname === EventType.TurretPlateDestroyed) {
        const split = event.other.split('_') as string[]
        const lane = split[2] as 'L2' | 'L1' | 'L0'
        this.gameState.platings[team][lane] += 1

        this.ctx.LPTE.emit({
          meta: {
            namespace: this.namespace,
            type: 'platings-update',
            version: 1
          },
          platings: this.gameState.platings
        })
        return
      }

      this.gameState.objectives[team].push({
        type: event.eventname,
        mob: event.other as MobType,
        time
      })

      this.updateState()

      if (
        event.eventname === EventType.DragonKill &&
        this.config.events?.includes('Dragons')
      ) {
        if (event.other === MobType.ElderDragon) {
          this.elderKill(event)
        }

        this.ctx.LPTE.emit({
          meta: {
            namespace: this.namespace,
            type: 'event',
            version: 1
          },
          name: 'Dragon',
          type: this.convertDragon(event.other),
          team,
          time
        })
      } else if (
        event.eventname === EventType.BaronKill &&
        this.config.events?.includes('Barons')
      ) {
        this.baronKill(event)
      } else if (
        event.eventname === EventType.HeraldKill &&
        this.config.events?.includes('Heralds')
      ) {
        this.ctx.LPTE.emit({
          meta: {
            namespace: this.namespace,
            type: 'event',
            version: 1
          },
          name: 'Herald',
          type: 'Herald',
          team,
          time
        })
      }
    }, this.config.delay)
  }

  private convertDragon(dragon: MobType): string {
    switch (dragon) {
      case MobType.HextechDragon:
        return 'Hextech'
      case MobType.ChemtechDragon:
        return 'Chemtech'
      case MobType.CloudDragon:
        return 'Cloud'
      case MobType.ElderDragon:
        return 'Elder'
      case MobType.InfernalDragon:
        return 'Infernal'
      case MobType.MountainDragon:
        return 'Mountain'
      case MobType.OceanDragon:
        return 'Ocean'
      default:
        return 'Air'
    }
  }

  private baronKill(event: InGameEvent): void {
    const cAllGameData = this.gameData[this.gameData.length - 1]

    const team = event.sourceTeam === TeamType.Order ? 100 : 200
    const time = Math.round(cAllGameData?.gameData?.gameTime || 0)
    const type = 'Baron'

    this.ctx.LPTE.emit({
      meta: {
        namespace: this.namespace,
        type: 'event',
        version: 1
      },
      name: 'Baron',
      type,
      team,
      time
    })

    if (!this.config.ppTimer) return

    const respawnAt = time + 60 * 3

    const data = {
      time,
      ongoing: true,
      goldDiff: 1500,
      goldBaseBlue: this.gameState.gold[100],
      goldBaseRed: this.gameState.gold[200],
      alive: cAllGameData.allPlayers
        .filter(
          (p) =>
            !p.isDead &&
            (team === 100 ? p.team === 'ORDER' : p.team === 'CHAOS')
        )
        .map((p) => p.riotIdGameName),
      dead: cAllGameData.allPlayers
        .filter(
          (p) =>
            p.isDead && (team === 100 ? p.team === 'ORDER' : p.team === 'CHAOS')
        )
        .map((p) => p.riotIdGameName),
      team,
      respawnAt: respawnAt,
      respawnIn: 60 * 3,
      percent: 100
    }

    this.ctx.LPTE.emit({
      meta: {
        namespace: this.namespace,
        type: 'pp-update',
        version: 1
      },
      type,
      team,
      goldDiff: data.goldDiff,
      ongoing: data.ongoing,
      percent: data.percent,
      respawnIn: data.respawnIn,
      respawnAt: data.respawnAt
    })

    this.actions.set(type + '-' + randomUUID(), (allGameData, i) => {
      const gameState = allGameData.gameData
      const diff = respawnAt - Math.round(gameState.gameTime)
      const percent = Math.round((diff * 100) / (60 * 3))

      const goldDifBlue = this.gameState.gold[100] - data.goldBaseBlue
      const goldDifRed = this.gameState.gold[200] - data.goldBaseRed

      const goldDiff = team === 100 ? 1500 + goldDifBlue - goldDifRed : 1500 + goldDifRed - goldDifBlue

      data.alive = allGameData.allPlayers
        .filter(
          (p) =>
            !p.isDead &&
            (team === 100 ? p.team === 'ORDER' : p.team === 'CHAOS') &&
            !data.dead.includes(p.riotIdGameName)
        )
        .map((p) => p.riotIdGameName)
      data.dead = [
        ...data.dead,
        ...allGameData.allPlayers
          .filter(
            (p) =>
              p.isDead &&
              (team === 100 ? p.team === 'ORDER' : p.team === 'CHAOS')
          )
          .map((p) => p.riotIdGameName)
      ]

      this.ctx.LPTE.emit({
        meta: {
          namespace: this.namespace,
          type: 'pp-update',
          version: 1
        },
        type: 'Baron',
        team,
        goldDiff,
        ongoing: data.ongoing,
        percent,
        respawnIn: diff
      })

      if (
        diff <= 0 ||
        data.alive.length <= 0 ||
        time > gameState.gameTime + this.config.delay / 1000
      ) {
        data.ongoing = false
        this.ctx.LPTE.emit({
          meta: {
            namespace: this.namespace,
            type: 'pp-update',
            version: 1
          },
          type: 'Baron',
          team,
          goldDiff,
          ongoing: data.ongoing,
          percent: 100,
          respawnIn: 60 * 3
        })

        this.actions.delete(i)
      }
    })
  }

  private elderKill(event: InGameEvent): void {
    const cAllGameData = this.gameData[this.gameData.length - 1]

    const team = event.sourceTeam === TeamType.Order ? 100 : 200
    const time = Math.round(cAllGameData?.gameData?.gameTime || 0)
    const type = 'Dragon'

    this.ctx.LPTE.emit({
      meta: {
        namespace: this.namespace,
        type: 'event',
        version: 1
      },
      name: 'Elder',
      type,
      team,
      time
    })

    if (!this.config.ppTimer) return

    const respawnAt = time + 60 * 3

    const data = {
      time,
      ongoing: true,
      goldDiff: 1500,
      goldBaseBlue: this.gameState.gold[100],
      goldBaseRed: this.gameState.gold[200],
      alive: cAllGameData.allPlayers
        .filter(
          (p) =>
            !p.isDead &&
            (team === 100 ? p.team === 'ORDER' : p.team === 'CHAOS')
        )
        .map((p) => p.riotIdGameName),
      dead: cAllGameData.allPlayers
        .filter(
          (p) =>
            p.isDead && (team === 100 ? p.team === 'ORDER' : p.team === 'CHAOS')
        )
        .map((p) => p.riotIdGameName),
      team,
      respawnAt: respawnAt,
      respawnIn: 60 * 3,
      percent: 100
    }

    this.ctx.LPTE.emit({
      meta: {
        namespace: this.namespace,
        type: 'pp-update',
        version: 1
      },
      type,
      team,
      goldDiff: data.goldDiff,
      ongoing: data.ongoing,
      percent: data.percent,
      respawnIn: data.respawnIn,
      respawnAt: data.respawnAt
    })

    this.actions.set(type + '-' + randomUUID(), (allGameData, i) => {
      const gameState = allGameData.gameData
      const diff = respawnAt - Math.round(gameState.gameTime)
      const percent = Math.round((diff * 100) / (60 * 3))

      const goldDifBlue = this.gameState.gold[100] - data.goldBaseBlue
      const goldDifRed = this.gameState.gold[200] - data.goldBaseRed

      const goldDiff = team === 100 ? 1500 + goldDifBlue - goldDifRed : 1500 + goldDifRed - goldDifBlue

      data.alive = allGameData.allPlayers
        .filter(
          (p) =>
            !p.isDead &&
            (team === 100 ? p.team === 'ORDER' : p.team === 'CHAOS') &&
            !data.dead.includes(p.riotIdGameName)
        )
        .map((p) => p.riotIdGameName)
      data.dead = [
        ...data.dead,
        ...allGameData.allPlayers
          .filter(
            (p) =>
              p.isDead &&
              (team === 100 ? p.team === 'ORDER' : p.team === 'CHAOS')
          )
          .map((p) => p.riotIdGameName)
      ]

      this.ctx.LPTE.emit({
        meta: {
          namespace: this.namespace,
          type: 'pp-update',
          version: 1
        },
        type: 'Dragon',
        team,
        goldDiff,
        ongoing: data.ongoing,
        percent,
        respawnIn: diff
      })

      if (
        diff <= 0 ||
        data.alive.length <= 0 ||
        time > gameState.gameTime + this.config.delay / 1000
      ) {
        data.ongoing = false
        this.ctx.LPTE.emit({
          meta: {
            namespace: this.namespace,
            type: 'pp-update',
            version: 1
          },
          type: 'Dragon',
          team,
          goldDiff,
          ongoing: data.ongoing,
          percent: 100,
          respawnIn: 60 * 3
        })

        this.actions.delete(i)
      }
    })
  }

  private checkPlayerUpdate(allGameData: AllGameData) {
    if (allGameData.allPlayers.length === 0) return

    this.gameState.kills[100] = allGameData.allPlayers.filter(p => p.team === "ORDER").reduce((v, c) => v + c.scores.kills, 0)
    this.gameState.kills[200] = allGameData.allPlayers.filter(p => p.team === "CHAOS").reduce((v, c) => v + c.scores.kills, 0)

    allGameData.allPlayers.forEach((player, i) => {
      this.checkNameUpdate(player, i)
      this.checkLevelUpdate(player, i)
      this.checkItemUpdate(player, i)
      this.checkAliveUpdate(player, i)
    })
  }

  private checkNameUpdate(currentPlayerState: Player, id: number) {
    if (
      this.gameState.player[id] === undefined || this.gameState.player[id]?.riotIdGameName === currentPlayerState.riotIdGameName
    )
      return

    this.gameState.player[id].riotIdGameName = currentPlayerState.riotIdGameName
    const member = this.state.lcu.lobby?.members?.find(
      (m: any) => m.riotIdGameName === currentPlayerState.riotIdGameName
    )
    this.gameState.player[id].nickname =
      member?.nickname ?? currentPlayerState.riotIdGameName
    this.updateState()

    this.ctx.LPTE.emit({
      meta: {
        type: 'name-update',
        namespace: this.namespace,
        version: 1
      },
      team: currentPlayerState.team === 'ORDER' ? 100 : 200,
      player: id,
      nickname: this.gameState.player[id].nickname
    })
  }

  private checkLevelUpdate(currentPlayerState: Player, id: number) {
    if (this.gameState.player[id] === undefined || currentPlayerState.isDead === this.gameState.player[id]?.isDead) return

    this.gameState.player[id].isDead = currentPlayerState.isDead
    this.updateState()

    this.ctx.LPTE.emit({
      meta: {
        type: 'is-dead-update',
        namespace: this.namespace,
        version: 1
      },
      team: currentPlayerState.team === 'ORDER' ? 100 : 200,
      player: id,
      isDead: currentPlayerState.isDead
    })
  }

  private checkAliveUpdate(currentPlayerState: Player, id: number) {
    if (this.gameState.player[id] === undefined || currentPlayerState.level <= this.gameState.player[id]?.level) return

    this.gameState.player[id].level = currentPlayerState.level
    this.updateState()

    if (!this.config.level.includes(currentPlayerState.level.toString())) return

    this.ctx.LPTE.emit({
      meta: {
        type: 'level-update',
        namespace: this.namespace,
        version: 1
      },
      team: currentPlayerState.team === 'ORDER' ? 100 : 200,
      player: id,
      level: currentPlayerState.level
    })
  }

  private checkItemUpdate(currentPlayerState: Player, id: number) {
    if (this.gameState.player[id] === undefined) return

    const previousItems = this.gameState.player[id].items

    if (previousItems.has(3513)) {
      if (!currentPlayerState.items.find((i) => i.itemID === 3513)) {
        previousItems.delete(3513)
      }
    }

    for (const item of currentPlayerState.items) {
      const itemID = item.itemID
      if (previousItems.has(itemID)) continue

      const itemBinFind = this.statics.itemBin.find(
        (i: any) => i.itemID === itemID
      )
      if (itemBinFind === undefined) continue

      if (itemID === 3513) {
        this.handelEvent({
          eventname: EventType.HeraldKill,
          other: MobType.Herald,
          otherTeam: TeamType.Neutral,
          source: currentPlayerState.riotIdGameName,
          sourceID: id,
          sourceTeam:
            currentPlayerState.team === 'CHAOS'
              ? TeamType.Chaos
              : TeamType.Order
        })
        this.gameState.player[id].items.add(itemID)
        return
      }

      if (!this.itemEpicness.includes(itemBinFind.epicness)) continue
      if (itemBinFind.epicness !== 7 && item.consumable) continue

      this.gameState.player[id].items.add(itemID)
      this.updateState()

      this.ctx.LPTE.emit({
        meta: {
          type: 'item-update',
          namespace: this.namespace,
          version: 1
        },
        team: currentPlayerState.team === 'ORDER' ? 100 : 200,
        player: id,
        item: itemID
      })
    }
  }

  private checkEventUpdate(
    allGameData: AllGameData,
    previousGameData: AllGameData
  ) {
    if (allGameData.events.Events.length === 0) return

    const newEvents = allGameData.events.Events.slice(
      previousGameData.events.Events.length || 0
    )

    newEvents.forEach((event) => {
      if (event.EventName === 'InhibKilled') {
        this.handleInhibEvent(event, allGameData)
      } else if (event.EventName === 'TurretKilled') {
        this.handleTowerEvent(event, allGameData)
      } else if (event.EventName === 'ChampionKill') {
        this.handleKillEvent(event, allGameData)
        this.handleFirstBloodEvent(event, allGameData)
      } else if (event.EventName === 'DragonKill') {
        this.handleDragonEvent(event, allGameData)
      } else if (event.EventName === 'BaronKill') {
        this.handleBaronEvent(event, allGameData)
      } else if (event.EventName === 'HeraldKill') {
        this.handleHeraldEvent(event, allGameData)
      }
    })
  }

  private handleInhibEvent(event: Event, allGameData: AllGameData) {
    const split = event.InhibKilled.split('_') as string[]
    const team = split[1] === 'TOrder' ? 100 : 200
    const lane = split[2] as 'L2' | 'L1' | 'L0'
    const respawnAt = Math.round(event.EventTime) + 60 * 5
    const time = event.EventTime

    if (!this.gameState.inhibitors[team][lane].alive) return

    this.gameState.inhibitors[team][lane] = {
      alive: false,
      respawnAt: respawnAt,
      respawnIn: 60 * 5,
      percent: 100,
      time
    }
    this.updateState()

    this.actions.set(event.InhibKilled, (allGameData, i) => {
      const gameState = allGameData.gameData
      const diff = respawnAt - Math.round(gameState.gameTime)
      const percent = Math.round((diff * 100) / (60 * 5))

      this.gameState.inhibitors[team][lane] = {
        alive: false,
        respawnAt: respawnAt,
        respawnIn: diff,
        percent: 100,
        time: this.gameState.inhibitors[team][lane].time
      }

      this.ctx.LPTE.emit({
        meta: {
          namespace: this.namespace,
          type: 'inhib-update',
          version: 1
        },
        team,
        lane,
        percent,
        respawnIn: diff
      })

      if (diff <= 0 || time > gameState.gameTime) {
        this.gameState.inhibitors[team][lane] = {
          alive: true,
          respawnAt: 0,
          respawnIn: 0,
          percent: 0,
          time: 0
        }

        this.updateState()
        this.actions.delete(i)
      }
    })

    if (this.config.killfeed) {
      this.ctx.LPTE.emit({
        meta: {
          namespace: this.namespace,
          type: 'kill-update',
          version: 1
        },
        assists: event.Assisters.map((a: string) => {
          return allGameData.allPlayers
            .find((p) => {
              return p.riotIdGameName === a
            })
            ?.rawChampionName.split('_')[3]
        }),
        other: 'Inhib',
        source: event.KillerName.startsWith('Minion')
          ? 'Minion'
          : event.KillerName.startsWith('SRU_Herald')
            ? 'Herald'
            : // TODO Thats for all other creeps for now until we have some better icons for them
            event.KillerName.startsWith('SRU')
              ? 'Minion'
              : allGameData.allPlayers
                .find((p) => {
                  return p.riotIdGameName === event.KillerName
                })
                ?.rawChampionName.split('_')[3],
        team: team === 100 ? 200 : 100
      })
    }
  }

  private handleTowerEvent(event: Event, allGameData: AllGameData) {
    if (event.TurretKilled === 'Obelisk') return

    const split = event.TurretKilled.split('_') as string[]
    const team = split[1] === 'TOrder' ? 100 : 200
    const lane = split[2] as 'L2' | 'L1' | 'L0'
    const turret = split[3]

    if (this.config.killfeed) {
      this.ctx.LPTE.emit({
        meta: {
          namespace: this.namespace,
          type: 'kill-update',
          version: 1
        },
        assists: event.Assisters.map((a: string) => {
          return allGameData.allPlayers
            .find((p) => {
              return p.riotIdGameName === a
            })
            ?.rawChampionName.split('_')[3]
        }),
        other: 'Turret',
        source: event.KillerName.startsWith('Minion')
          ? 'Minion'
          : event.KillerName.startsWith('SRU_Herald')
            ? 'Herald'
            : // TODO Thats for all other creeps for now until we have some better icons for them
            event.KillerName.startsWith('SRU')
              ? 'Minion'
              : allGameData.allPlayers
                .find((p) => {
                  return p.riotIdGameName === event.KillerName
                })
                ?.rawChampionName.split('_')[3],
        team: team === 100 ? 200 : 100
      })
    }

    if (this.gameState.towers[team][lane][turret] === false) return

    this.gameState.towers[team][lane][turret] = false
    this.updateState()

    this.ctx.LPTE.emit({
      meta: {
        namespace: this.namespace,
        type: 'tower-update',
        version: 1
      },
      team,
      lane,
      turret
    })
  }

  private handleKillEvent(event: Event, allGameData: AllGameData) {
    if (!this.config.killfeed) return

    this.ctx.LPTE.emit({
      meta: {
        namespace: this.namespace,
        type: 'kill-update',
        version: 1
      },
      assists: event.Assisters.map((a: string) => {
        return allGameData.allPlayers
          .find((p) => {
            return p.riotIdGameName === a
          })
          ?.rawChampionName.split('_')[3]
      }),
      other: allGameData.allPlayers
        .find((p) => {
          return p.riotIdGameName === event.VictimName
        })
        ?.rawChampionName.split('_')[3],
      source: event.KillerName.startsWith('Minion')
        ? 'Minion'
        : event.KillerName.startsWith('Turret')
          ? 'Turret'
          : event.KillerName.startsWith('SRU_Baron')
            ? 'Baron'
            : event.KillerName.startsWith('SRU_Herald')
              ? 'Herald'
              : event.KillerName.startsWith('SRU_Dragon')
                ? 'Dragon'
                : // TODO Thats for all other creeps for now until we have some better icons for them
                event.KillerName.startsWith('SRU')
                  ? 'Minion'
                  : allGameData.allPlayers
                    .find((p) => {
                      return p.riotIdGameName === event.KillerName
                    })
                    ?.rawChampionName.split('_')[3],
      team:
        allGameData.allPlayers.find((p) => {
          return p.riotIdGameName === event.VictimName
        })?.team === 'CHAOS'
          ? 100
          : 200
    })
  }

  private handleDragonEvent(event: Event, allGameData: AllGameData) {
    // Get the team from the KillerName
    const killer = allGameData.allPlayers.find((p) => p.riotIdGameName === event.KillerName)
    if (!killer) {
      this.ctx.log.warn(`Could not find killer '${event.KillerName}' for dragon event`)
      return
    }
    const team = killer.team === 'ORDER' ? 100 : 200
    const time = Math.round(event.EventTime)

    // Convert DragonType from Live Client API format to MobType
    const mob = InGameState.dragonTypeMap[event.DragonType]
    if (!mob) {
      this.ctx.log.warn(`Unknown dragon type: ${event.DragonType}`)
      return
    }

    // Add to objectives
    this.gameState.objectives[team].push({
      type: EventType.DragonKill,
      mob,
      time
    })

    this.updateState()

    if (this.config.events?.includes('Dragons')) {
      if (event.DragonType === 'Elder') {
        // Create a compatible event object for elderKill
        const elderEvent: InGameEvent = {
          eventname: EventType.DragonKill,
          other: MobType.ElderDragon,
          otherTeam: TeamType.Neutral,
          source: event.KillerName,
          sourceID: 0,
          sourceTeam: team === 100 ? TeamType.Order : TeamType.Chaos
        }
        this.elderKill(elderEvent)
      }

      this.ctx.LPTE.emit({
        meta: {
          namespace: this.namespace,
          type: 'event',
          version: 1
        },
        name: 'Dragon',
        type: this.convertDragon(mob),
        team,
        time
      })
    }
  }

  private handleBaronEvent(event: Event, allGameData: AllGameData) {
    // Get the team from the KillerName
    const killer = allGameData.allPlayers.find((p) => p.riotIdGameName === event.KillerName)
    if (!killer) {
      this.ctx.log.warn(`Could not find killer '${event.KillerName}' for baron event`)
      return
    }
    const team = killer.team === 'ORDER' ? 100 : 200
    const time = Math.round(event.EventTime)

    // Add to objectives
    this.gameState.objectives[team].push({
      type: EventType.BaronKill,
      mob: MobType.Baron,
      time
    })

    this.updateState()

    if (this.config.events?.includes('Barons')) {
      // Create a compatible event object for baronKill
      const baronEvent: InGameEvent = {
        eventname: EventType.BaronKill,
        other: MobType.Baron,
        otherTeam: TeamType.Neutral,
        source: event.KillerName,
        sourceID: 0,
        sourceTeam: team === 100 ? TeamType.Order : TeamType.Chaos
      }
      this.baronKill(baronEvent)
    }
  }

  public addTestObjective(team: 100 | 200, eventName: string): void {
    const time = Math.round(this.gameState.gameTime)

    const dragonType = InGameState.dragonTypeMap[eventName]

    if (dragonType) {
      this.gameState.objectives[team].push({
        type: EventType.DragonKill,
        mob: dragonType,
        time
      })

      this.ctx.LPTE.emit({
        meta: {
          namespace: this.namespace,
          type: 'event',
          version: 1
        },
        name: 'Dragon',
        type: eventName,
        team,
        time
      })
    } else if (eventName === 'Baron') {
      this.gameState.objectives[team].push({
        type: EventType.BaronKill,
        mob: MobType.Baron,
        time
      })

      this.ctx.LPTE.emit({
        meta: {
          namespace: this.namespace,
          type: 'event',
          version: 1
        },
        name: 'Baron',
        type: 'Baron',
        team,
        time
      })
    } else if (eventName === 'Herald') {
      this.gameState.objectives[team].push({
        type: EventType.HeraldKill,
        mob: MobType.Herald,
        time
      })

      this.ctx.LPTE.emit({
        meta: {
          namespace: this.namespace,
          type: 'event',
          version: 1
        },
        name: 'Herald',
        type: 'Herald',
        team,
        time
      })
    }

    this.updateState()

    this.ctx.LPTE.emit({
      meta: {
        namespace: this.namespace,
        type: 'update',
        version: 1
      },
      state: this.convertGameState()
    })
  }

  public removeObjective(team: 100 | 200, objectiveType: 'dragon' | 'baron'): void {
    const eventType = objectiveType === 'dragon' ? EventType.DragonKill : EventType.BaronKill

    let lastIndex = -1
    for (let i = this.gameState.objectives[team].length - 1; i >= 0; i--) {
      if (this.gameState.objectives[team][i].type === eventType) {
        lastIndex = i
        break
      }
    }

    if (lastIndex !== -1) {
      this.gameState.objectives[team].splice(lastIndex, 1)
      this.updateState()

      this.ctx.LPTE.emit({
        meta: {
          namespace: this.namespace,
          type: 'update',
          version: 1
        },
        state: this.convertGameState()
      })
    }
  }

  private handleFirstBloodEvent(event: Event, allGameData: AllGameData) {
    if (this.firstBloodOccurred) return
    this.firstBloodOccurred = true

    if (!this.config.events?.includes('First Blood')) return

    const killer = allGameData.allPlayers.find((p) => p.riotIdGameName === event.KillerName)
    if (!killer) return

    const team = killer.team === 'ORDER' ? 100 : 200
    const time = Math.round(event.EventTime)

    this.ctx.LPTE.emit({
      meta: {
        namespace: this.namespace,
        type: 'first-blood',
        version: 1
      },
      team,
      time
    })
  }

  private handleHeraldEvent(event: Event, allGameData: AllGameData) {
    // Get the team from the KillerName
    const killer = allGameData.allPlayers.find((p) => p.riotIdGameName === event.KillerName)
    if (!killer) {
      this.ctx.log.warn(`Could not find killer '${event.KillerName}' for herald event`)
      return
    }
    const team = killer.team === 'ORDER' ? 100 : 200
    const time = Math.round(event.EventTime)

    // Add to objectives
    this.gameState.objectives[team].push({
      type: EventType.HeraldKill,
      mob: MobType.Herald,
      time
    })

    this.updateState()

    if (this.config.events?.includes('Heralds')) {
      this.ctx.LPTE.emit({
        meta: {
          namespace: this.namespace,
          type: 'event',
          version: 1
        },
        name: 'Herald',
        type: 'Herald',
        team,
        time
      })
    }
  }
}

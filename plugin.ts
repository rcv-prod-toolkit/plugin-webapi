import { PluginContext } from '@rcv-prod-toolkit/types'
import { Config } from './types/Config'
import { LolApi } from 'twisted'
import { Regions, RegionGroups } from 'twisted/dist/constants'
import { ApiResponseDTO, CurrentGameInfoDTO, MatchV5DTOs, MatchV5TimelineDTOs, SpectatorNotAvailableDTO, SummonerV4DTO } from 'twisted/dist/models-dto'

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function getRegionByServer(server: string): Regions {
  switch (server) {
    case 'PBE1':
      return Regions.PBE
    case 'OC1':
    case 'PH2':
    case 'SG2':
    case 'TH2':
    case 'TW2':
    case 'VN2':
      return Regions.OCEANIA
    case 'NA1':
      return Regions.AMERICA_NORTH
    case 'LA1':
      return Regions.LAT_NORTH
    case 'LA2':
      return Regions.LAT_SOUTH
    case 'BR1':
      return Regions.BRAZIL
    case 'KR':
      return Regions.KOREA
    case 'JP1':
      return Regions.JAPAN
    case 'EUW1':
      return Regions.EU_EAST
    case 'EUN1':
      return Regions.EU_WEST
    case 'TR1':
      return Regions.TURKEY
    case 'RU':
      return Regions.RUSSIA
    case 'TR1':
      return Regions.TURKEY
    default:
      return Regions.EU_EAST
  }
}

function getRegionGroupByServer(server: string): RegionGroups {
  switch (server) {
    case 'OC1':
    case 'PH2':
    case 'SG2':
    case 'TH2':
    case 'TW2':
    case 'VN2':
      return RegionGroups.SEA
    case 'NA1':
    case 'BR1':
    case 'LA1':
    case 'LA2':
      return RegionGroups.AMERICAS
    case 'KR':
    case 'JP1':
      return RegionGroups.ASIA
    case 'EUN1':
    case 'EUW1':
    case 'TR1':
    case 'RU':
      return RegionGroups.EUROPE
    default:
      return RegionGroups.EUROPE
  }
}

module.exports = async (ctx: PluginContext) => {
  const namespace = ctx.plugin.module.getName()

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
      apiKey: 'RGAPI-SECRETKEY',
      server: 'EUW1'
    },
    configRes?.config
  )

  const key = config.apiKey
  const server = (config.server || 'EUW1')
  const region = getRegionByServer(server)
  const regionGroup = getRegionGroupByServer(server)

  const api = new LolApi({
    /**
    * If api response is 429 (rate limits) try reattempt after needed time (default true)
    */
    rateLimitRetry: true,
    /**
     * Number of time to retry after rate limit response (default 1)
     */
    rateLimitRetryAttempts: 1,
    /**
     * Concurrency calls to riot (default infinity)
     * Concurrency per method (example: summoner api, match api, etc)
     */
    concurrency: undefined,
    /**
     * Riot games api key
     */
    key
  })


  ctx.LPTE.on(namespace, 'fetch-livegame', async (e) => {
    ctx.log.info(`Fetching livegame data for summoner=${e.summonerName}`)

    let retries = 0
    const desiredRetries = e.retries !== undefined ? e.retries : 3

    const replyMeta = {
      type: e.meta.reply as string,
      namespace: 'reply',
      version: 1
    }

    let summonerInfo: ApiResponseDTO<SummonerV4DTO>
    try {
      summonerInfo = await api.Summoner.getByName(e.summonerName, region)
    } catch (error) {
      ctx.log.error(
        `Failed to get information for summoner=${e.summonerName}. Maybe this summoner does not exist? error=${error}`
      )
      ctx.LPTE.emit({
        meta: replyMeta,
        failed: true
      })
      return
    }

    let gameInfo: SpectatorNotAvailableDTO | ApiResponseDTO<CurrentGameInfoDTO> | undefined

    while (retries <= desiredRetries) {
      retries++
      try {
        gameInfo = await api.Spectator.activeGame(summonerInfo.response.id, region)
      } catch (error) {
        ctx.log.warn(
          `Failed to get spectator game information for summoner=${e.summonerName}, encryptedId=${summonerInfo.response.id}. Maybe this summoner is not ingame currently? Retrying. error=${error}`
        )
        await sleep(2000)
      }
    }


    if (gameInfo === undefined || 'message' in gameInfo) {
      ctx.log.error(
        `Failed to get spectator game information for summoner=${e.summonerName}, encryptedId=${summonerInfo.response.id}, after retries.`
      )
      ctx.LPTE.emit({
        meta: replyMeta,
        failed: true
      })
      return
    }

    ctx.log.info(
      `Fetched livegame for summoner=${e.summonerName}, gameId=${gameInfo.response.gameId}`
    )
    ctx.LPTE.emit({
      meta: replyMeta,
      game: gameInfo,
      failed: false
    })
  })

  ctx.LPTE.on(namespace, 'fetch-match', async (e) => {
    ctx.log.info(`Fetching match data for matchid=${e.matchId}`)

    const replyMeta = {
      type: e.meta.reply as string,
      namespace: 'reply',
      version: 1
    }

    let gameData: ApiResponseDTO<MatchV5DTOs.MatchDto>
    try {
      // gameData = await riotApi.Match.gettingById(e.matchId);
      gameData = await api.MatchV5.get(e.matchId, regionGroup)
    } catch (error) {
      ctx.log.error(
        `Failed to get match information for matchId=${e.matchId}. Maybe the match is not over yet? error=${error}`
      )
      ctx.LPTE.emit({
        meta: replyMeta,
        failed: true
      })
      return
    }

    let timelineData: ApiResponseDTO<MatchV5TimelineDTOs.MatchTimelineDto>
    try {
      timelineData = await api.MatchV5.timeline(e.matchId, regionGroup)
    } catch (error) {
      ctx.log.warn(
        `Failed to get match timeline for matchId=${e.matchId}. Maybe the match is not over yet? Since this is optional, it will be skipped. error=${error}`
      )
      return
    }

    ctx.log.info(
      `Fetched match for matchId=${e.matchId}, gameId=${gameData.response.info.gameId}`
    )
    ctx.LPTE.emit({
      meta: replyMeta,
      match: gameData,
      timeline: timelineData,
      failed: false
    })
  })

  ctx.LPTE.on(namespace, 'fetch-league', async (e) => {
    ctx.log.info(
      `Fetching League information for summonerName=${e.summonerName}`
    )

    const replyMeta = {
      type: e.meta.reply as string,
      namespace: 'reply',
      version: 1
    }

    let summoner
    try {
      summoner = await api.Summoner.getByName(e.summonerName, region)
    } catch (error) {
      ctx.log.error(
        `Failed to get summoner information for summonerName=${e.summonerName}. error=${error}`
      )
      ctx.LPTE.emit({
        meta: replyMeta,
        failed: true
      })
      return
    }

    let data
    try {
      data = await api.League.bySummoner(summoner.response.id, region)
    } catch (error) {
      ctx.log.warn(
        `Failed to get league information for summoner=${summoner.response.id}. Maybe the summoner is not ranked yet? error=${error}`
      )
      ctx.LPTE.emit({
        meta: replyMeta,
        failed: true
      })
      return
    }

    ctx.log.info(
      `Fetched League information for summonerName=${e.summonerName}, summonerID=${summoner.response.id}`
    )
    ctx.LPTE.emit({
      meta: replyMeta,
      data,
      server,
      failed: false
    })
  })

  ctx.LPTE.on(namespace, 'fetch-location', async (e) => {
    ctx.LPTE.emit({
      meta: {
        type: e.meta.reply as string,
        namespace: 'reply',
        version: 1
      },
      server,
      region,
      regionGroup
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

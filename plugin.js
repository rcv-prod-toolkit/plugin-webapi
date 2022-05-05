const LeagueJS = require('leaguejs');
const axios = require('axios');

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function getRegionByServer (server) {
  switch ((server).toUpperCase()) {
    case 'NA1':
    case 'BR1':
    case 'LA1':
    case 'LA2':
    case 'OC1':
      return 'AMERICAS'
    case 'KR':
    case 'JP1':
      return 'ASIA'
    case 'EUN1':
    case 'EUW1':
    case 'TR1':
    case 'RU':
      return 'EUROPE'
    default:
      return 'EUROPE'
  } 
}

let apiKey = ''
let region = ''
let server = ''

const getMatchV5ById = async matchId => {
  const response = await axios.get(`https://${region}.api.riotgames.com/lol/match/v5/matches/${server.toUpperCase()}_${matchId}`, {
    headers: {
      'X-Riot-Token': apiKey
    }
  })

  return response.data
}

const getMatchV5TimelineById = async matchId => {
  const response = await axios.get(`https://${region}.api.riotgames.com/lol/match/v5/matches/${server.toUpperCase()}_${matchId}/timeline`, {
    headers: {
      'X-Riot-Token': apiKey
    }
  })

  return response.data
}

module.exports = async (ctx) => {
  const namespace = ctx.plugin.module.getName()

  let config = {};
  let riotApi

  /* const lolRequest = async (realm, api, path) => {
    return new Promise((resolve, reject) => {
      riotApi.request(realm, api, path, (err, data) => {
        if (err) {
          return reject(err);
        }
  
        return resolve(data);
      });
    });
  } */

  ctx.LPTE.on(namespace, 'fetch-livegame', async e => {
    ctx.log.info(`Fetching livegame data for summoner=${e.summonerName}`);

    let retries = 0
    const desiredRetries = e.retries !== undefined ? e.retries : 3

    const replyMeta = {
      type: e.meta.reply,
      namespace: 'reply',
      version: 1
    };

    let summonerInfo;
    try {
      summonerInfo = await riotApi.Summoner.gettingByName(e.summonerName);
    } catch (error) {
      ctx.log.error(`Failed to get information for summoner=${e.summonerName}. Maybe this summoner does not exist? error=${error}`);
      ctx.LPTE.emit({
        meta: replyMeta,
        failed: true
      });
      return;
    }

    let gameInfo;

    while (retries <= desiredRetries) {
      retries++
      try {
        gameInfo = await riotApi.Spectator.gettingActiveGame(summonerInfo.id)
      } catch (error) {
        ctx.log.warn(`Failed to get spectator game information for summoner=${e.summonerName}, encryptedId=${summonerInfo.id}. Maybe this summoner is not ingame currently? Retrying. error=${error}`)
        await sleep(2000)
      }
    }

    if (gameInfo === undefined) {
      ctx.log.error(`Failed to get spectator game information for summoner=${e.summonerName}, encryptedId=${summonerInfo.id}, after retries.`)
      ctx.LPTE.emit({
        meta: replyMeta,
        failed: true
      })
      return
    }

    ctx.log.info(`Fetched livegame for summoner=${e.summonerName}, gameId=${gameInfo.gameId}`)
    ctx.LPTE.emit({
      meta: replyMeta,
      game: gameInfo,
      failed: false
    })
  })

  ctx.LPTE.on(namespace, 'fetch-match', async e => {
    ctx.log.info(`Fetching match data for matchid=${e.matchId}`);

    const replyMeta = {
      type: e.meta.reply,
      namespace: 'reply',
      version: 1
    };

    let gameData;
    try {
      // gameData = await riotApi.Match.gettingById(e.matchId);
      gameData = await getMatchV5ById(e.matchId)
    } catch (error) {
      ctx.log.error(`Failed to get match information for matchId=${e.matchId}. Maybe the match is not over yet? error=${error}`);
      ctx.LPTE.emit({
        meta: replyMeta,
        failed: true
      });
      return;
    }

    let timelineData;
    try {
      // timelineData = await riotApi.Match.gettingTimelineById(e.matchId);
      timelineData = await getMatchV5TimelineById(e.matchId)
    } catch (error) {
      ctx.log.warn(`Failed to get match timeline for matchId=${e.matchId}. Maybe the match is not over yet? Since this is optional, it will be skipped. error=${error}`);
      return;
    }

    ctx.log.info(`Fetched match for matchId=${e.matchId}, gameId=${gameData.info.gameId}`);
    ctx.LPTE.emit({
      meta: replyMeta,
      match: gameData,
      timeline: timelineData,
      failed: false
    });
  });

  ctx.LPTE.on(namespace, 'fetch-league', async e => {
    ctx.log.info(`Fetching League information for summonerName=${e.summonerName}`);

    const replyMeta = {
      type: e.meta.reply,
      namespace: 'reply',
      version: 1
    };

    let summoner;
    try {
      summoner = await riotApi.Summoner.gettingByName(e.summonerName)
    } catch (error) {
      ctx.log.error(`Failed to get summoner information for summonerName=${e.summonerName}. error=${error}`);
      ctx.LPTE.emit({
        meta: replyMeta,
        failed: true
      });
      return;
    }

    let data;
    try {
      data = await riotApi.League.gettingEntriesForSummonerId(summoner.id)
    } catch (error) {
      ctx.log.warn(`Failed to get league information for summoner=${summoner.id}. Maybe the summoner is not ranked yet? error=${error}`);
      ctx.LPTE.emit({
        meta: replyMeta,
        failed: true
      });
      return;
    }

    ctx.log.info(`Fetched League information for summonerName=${e.summonerName}, summonerID=${summoner.id}`);
    ctx.LPTE.emit({
      meta: replyMeta,
      data,
      failed: false
    });
  });

  // Emit event that we're ready to operate
  ctx.LPTE.emit({
    meta: {
      type: 'plugin-status-change',
      namespace: 'lpt',
      version: 1
    },
    status: 'RUNNING'
  });

  const response = await ctx.LPTE.request({
    meta: {
      type: 'request',
      namespace: 'plugin-config',
      version: 1
    }
  });
  config = response.config;

  riotApi = new LeagueJS(config.apiKey, {
    PLATFORM_ID: config.server || 'euw1'
  });

  apiKey = config.apiKey
  server = (config.server || 'euw1').toLowerCase()
  region = getRegionByServer(server).toLowerCase()
}

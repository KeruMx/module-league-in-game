# Spectator Bootstrap Setup Guide

This document explains how to configure and use the Spectator Bootstrap feature in the `module-league-in-game` module.

## Overview

The Spectator Bootstrap feature allows the module to automatically prepare for spectating a live League of Legends game by:

1. Resolving a Riot ID to a PUUID
2. Fetching the encrypted Summoner ID
3. Detecting if the player is in an active game
4. Extracting the Spectator encryption key and game metadata

This information can then be consumed by a low-level Spectator parser (not included in this module).

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `RIOT_API_KEY` | Your Riot Games API key. Obtain one from the [Riot Developer Portal](https://developer.riotgames.com/). |

### Example

```bash
export RIOT_API_KEY=RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**Important:** Never commit your API key to source control. Use environment variables or a secure secrets manager.

## Supported Regions

The following regions are supported:

| Code | Platform | Regional Routing |
|------|----------|------------------|
| NA | na1 | americas |
| BR | br1 | americas |
| LAN | la1 | americas |
| LAS | la2 | americas |
| EUW | euw1 | europe |
| EUNE | eun1 | europe |
| TR | tr1 | europe |
| RU | ru | europe |
| KR | kr | asia |
| JP | jp1 | asia |
| OCE | oc1 | sea |
| PH | ph2 | sea |
| SG | sg2 | sea |
| TH | th2 | sea |
| TW | tw2 | sea |
| VN | vn2 | sea |

## Riot API Flow

The Spectator Bootstrap uses three Riot API endpoints in sequence:

### 1. Account API - Resolve PUUID

**Endpoint:** `GET /riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}`

This endpoint resolves a Riot ID (e.g., `PlayerName#TAG`) to a PUUID (Player Universally Unique Identifier).

- The PUUID is a persistent identifier that doesn't change when a player changes their Riot ID
- Results are cached locally for 24 hours to minimize API calls

### 2. Summoner API - Resolve Encrypted Summoner ID

**Endpoint:** `GET /lol/summoner/v4/summoners/by-puuid/{puuid}`

This endpoint fetches summoner data including the `encryptedSummonerId`, which is required for the Spectator API.

### 3. Spectator-V5 API - Get Active Game

**Endpoint:** `GET /lol/spectator/v5/active-games/by-summoner/{encryptedSummonerId}`

This endpoint checks if the player is currently in a live game and returns:

- `gameId` - Unique identifier for the game
- `platformId` - The platform where the game is being played
- `observers.encryptionKey` - The encryption key needed to connect to the Spectator server

## What is the Encryption Key?

The `encryptionKey` is a base64-encoded string provided by the Spectator API. It is used to:

1. Authenticate connections to the Spectator server
2. Decrypt the game data stream
3. Access real-time game information (gold, objectives, player positions, etc.)

**Important:** The encryption key is only valid for the duration of the current game. Once the game ends, a new key must be obtained for any future game.

## Spectator Bootstrap Output

When an active game is detected, the module exposes a structured output:

```typescript
interface SpectatorBootstrap {
  gameId: number;        // Unique game identifier
  platformId: string;    // Platform ID (e.g., "NA1", "EUW1")
  encryptionKey: string; // Base64 encryption key for Spectator data
  region: string;        // Region code (e.g., "NA", "EUW")
  spectatorReady: boolean; // True when ready to spectate
}
```

## Usage

### Configure Spectator Bootstrap

Send an event to configure and start the bootstrap process:

```javascript
LPTE.emit({
  meta: {
    namespace: 'module-league-in-game',
    type: 'spectator-configure',
    version: 1
  },
  riotId: 'PlayerName#TAG',  // Riot ID in gameName#tagLine format
  region: 'NA',               // Region code
  autoPolling: true,          // Optional: automatically poll for game status
  pollingIntervalMs: 30000    // Optional: polling interval (default: 30s, min: 10s)
})
```

### Get Current State

Request the current spectator bootstrap state:

```javascript
const response = await LPTE.request({
  meta: {
    namespace: 'module-league-in-game',
    type: 'spectator-get-state',
    version: 1
  }
})

// Response:
// {
//   available: boolean,
//   state: SpectatorBootstrapState,
//   bootstrap: SpectatorBootstrap | null,
//   regions: string[]
// }
```

### Get Bootstrap Data

Get just the bootstrap output:

```javascript
const response = await LPTE.request({
  meta: {
    namespace: 'module-league-in-game',
    type: 'spectator-get-bootstrap',
    version: 1
  }
})

// Response:
// {
//   bootstrap: SpectatorBootstrap | null
// }
```

### Manual Refresh

Manually refresh the active game status:

```javascript
const response = await LPTE.request({
  meta: {
    namespace: 'module-league-in-game',
    type: 'spectator-refresh',
    version: 1
  }
})
```

### Control Polling

Start or stop automatic polling:

```javascript
// Start polling
LPTE.emit({
  meta: {
    namespace: 'module-league-in-game',
    type: 'spectator-start-polling',
    version: 1
  },
  intervalMs: 30000  // Optional: custom interval
})

// Stop polling
LPTE.emit({
  meta: {
    namespace: 'module-league-in-game',
    type: 'spectator-stop-polling',
    version: 1
  }
})
```

### Reset State

Reset the spectator bootstrap to its initial state:

```javascript
LPTE.emit({
  meta: {
    namespace: 'module-league-in-game',
    type: 'spectator-reset',
    version: 1
  }
})
```

### Listen for State Updates

Subscribe to state update events:

```javascript
LPTE.on('module-league-in-game', 'spectator-state-update', (e) => {
  console.log('Spectator state updated:', e.state)
  console.log('Bootstrap data:', e.bootstrap)
  
  if (e.bootstrap?.spectatorReady) {
    console.log('Ready to spectate!')
    console.log('Game ID:', e.bootstrap.gameId)
    console.log('Encryption Key:', e.bootstrap.encryptionKey)
  }
})
```

## Error Handling

The module handles various error scenarios:

| Error | Description | Recovery |
|-------|-------------|----------|
| Invalid Riot ID | Format must be `gameName#tagLine` | Check input format |
| Invalid Region | Region code not supported | Use a valid region code |
| Riot ID Not Found | Player doesn't exist | Verify the Riot ID |
| Rate Limited | Too many API calls | Automatic retry with backoff |
| Player Not in Game | No active game found | Polling will detect when game starts |
| Network Error | Connection issues | Automatic retry with exponential backoff |

## Known Limitations

1. **Rate Limits:** The Riot API has rate limits. The module implements automatic retry with exponential backoff, but excessive requests may still be limited.

2. **Game Detection Delay:** There may be a brief delay (typically 1-2 minutes) after a game starts before it appears in the Spectator API.

3. **Private/Custom Games:** Some private or tournament realm games may not be available through the public Spectator API.

4. **TFT Games:** The Spectator-V5 API is for League of Legends only. TFT games require a different API.

5. **Spectator Delay:** The Spectator feed has a built-in 3-minute delay for competitive integrity. This cannot be bypassed.

6. **Regional Restrictions:** API keys may have regional restrictions. Ensure your key has access to the regions you need.

## Explicit Non-Goals

This module does NOT:

- Parse Spectator chunks or binary data
- Decrypt the game data stream
- Reverse engineer Spectator protocols
- Simulate or reconstruct game state
- Render replays or game footage

The module's purpose is strictly API bootstrap and data preparation. Actual Spectator data processing should be handled by a separate component.

## Troubleshooting

### "Spectator bootstrap not available"

Ensure the `RIOT_API_KEY` environment variable is set before starting the module.

### "Riot ID not found"

1. Verify the Riot ID format: `gameName#tagLine`
2. Check for typos in the game name or tag
3. Ensure the player exists on the specified region

### "Player is not currently in a game"

The player must be in an active game for spectator data to be available. Use polling to automatically detect when a game starts.

### Rate limit errors

If you're hitting rate limits frequently:

1. Reduce polling frequency
2. Implement caching at a higher level
3. Consider upgrading your API key tier

## API Key Requirements

To use the Spectator Bootstrap feature, your Riot API key needs access to:

1. `riot-account-v1` - For PUUID resolution
2. `summoner-v4` - For encrypted Summoner ID
3. `spectator-v5` - For active game detection

Development API keys typically have access to all these endpoints but with lower rate limits. Production applications should apply for a production API key.

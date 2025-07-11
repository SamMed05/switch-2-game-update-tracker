const https = require('https');

exports.handler = async (event, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { gameTitle } = JSON.parse(event.body);
    
    if (!gameTitle) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Game title is required' }),
      };
    }

    console.log('Searching IGDB for:', gameTitle);
    const clientId = process.env.IGDB_CLIENT_ID || '8yfuwtkgx1bg2tu5lrf8inria6dl1f';
    const clientSecret = process.env.IGDB_CLIENT_SECRET;

    if (!clientSecret) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'IGDB_CLIENT_SECRET environment variable not set' }),
      };
    }

    // Step 1: Get OAuth token from Twitch
    console.log('Getting OAuth token...');
    const tokenData = await makeRequest('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    });

    const parsedTokenData = JSON.parse(tokenData);
    const accessToken = parsedTokenData.access_token;

    if (!accessToken) {
      console.error('Failed to get access token:', parsedTokenData);
      throw new Error('Failed to get access token');
    }

    console.log('Got access token, searching for game...');

    // Step 2: Search for the game on IGDB
    const searchQuery = `search "${gameTitle}"; fields name, cover.url, platforms.name, url; where platforms.name ~ "Nintendo Switch"; limit 1;`;
    
    const gameData = await makeRequest('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'text/plain',
      },
      body: searchQuery,
    });

    const games = JSON.parse(gameData);
    console.log('IGDB search results:', games);
    
    if (!games || games.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Game not found', gameTitle }),
      };
    }

    const game = games[0];
    
    // Format cover image URL to get higher resolution
    let imageUrl = null;
    if (game.cover && game.cover.url) {
      imageUrl = game.cover.url.replace('t_thumb', 't_cover_big').replace('//', 'https://');
    }

    console.log('Successfully found game:', game.name, 'with image:', imageUrl);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        title: game.name,
        imageUrl: imageUrl,
        nsuid: null,
        url: game.url || null,
      }),
    };

  } catch (error) {
    console.error('IGDB API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }),
    };
  }
};

// Helper function to make HTTP requests
function makeRequest(url, options) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = https.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}


const http = require('http');

function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/json',
    };
    
    let bodyString = null;
    if (body) {
      bodyString = JSON.stringify(body);
      headers['Content-Length'] = Buffer.byteLength(bodyString);
    }

    const options = {
      hostname: 'localhost',
      port: 5001,
      path: path,
      method: method,
      headers: headers,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          console.log('Response not JSON:', data);
          resolve(data);
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    if (bodyString) {
      req.write(bodyString);
    }
    req.end();
  });
}

async function test() {
  try {
    console.log('--- Testing Backward Compatibility (Voice Default) ---');
    const voiceForecasts = await makeRequest('/api/forecasts');
    console.log('Voice Forecasts Count:', Array.isArray(voiceForecasts) ? voiceForecasts.length : voiceForecasts);

    console.log('--- Testing Chat Channel ---');
    // Create a chat forecast
    const chatForecast = {
      year_label: '2027-Chat',
      forecast_method: 'Prophet',
      monthly_volumes: [],
      total_volume: 1000,
      peak_volume: 100,
      channel: 'chat'
    };
    
    console.log('Creating chat forecast...');
    const createRes = await makeRequest('/api/forecasts', 'POST', chatForecast);
    console.log('Create Chat Forecast Result:', createRes);

    const chatForecasts = await makeRequest('/api/forecasts?channel=chat');
    console.log('Chat Forecasts Count:', Array.isArray(chatForecasts) ? chatForecasts.length : chatForecasts);
    
    if (Array.isArray(chatForecasts)) {
        const found = chatForecasts.find(f => f.year_label === '2027-Chat' && f.channel === 'chat');
        console.log('Found created chat forecast:', !!found);
    }

    console.log('--- Testing Isolation ---');
    const voiceForecastsAgain = await makeRequest('/api/forecasts?channel=voice');
    if (Array.isArray(voiceForecastsAgain)) {
        const foundInVoice = voiceForecastsAgain.find(f => f.year_label === '2027-Chat');
        console.log('Chat forecast NOT in voice:', !foundInVoice);
    }

  } catch (err) {
    console.error('Test Failed:', err);
  }
}

test();

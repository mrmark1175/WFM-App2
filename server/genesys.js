const platformClient = require('purecloud-platform-client-v2');
const client = platformClient.ApiClient.instance;

// 1. Setup Genesys Credentials
const clientId = 'YOUR_GENESYS_CLIENT_ID';
const clientSecret = 'YOUR_GENESYS_CLIENT_SECRET';
client.setEnvironment(platformClient.PureCloudRegionHosts.us_east_1); // Change to your region

async function syncGenesysData(queueId, interval) {
    try {
        // Authenticate
        await client.loginClientCredentialsGrant(clientId, clientSecret);
        const apiInstance = new platformClient.AnalyticsApi();

        // Query Body for Volume/AHT
        const query = {
            interval: interval, // e.g., "2026-03-01T00:00:00/2026-03-13T00:00:00"
            groupBy: ['queueId'],
            metrics: ['nOffered', 'tHandle']
        };

        const data = await apiInstance.postAnalyticsQueuesObservationsQuery(query);
        return data;
    } catch (err) {
        console.error('Genesys Sync Error:', err);
    }
}
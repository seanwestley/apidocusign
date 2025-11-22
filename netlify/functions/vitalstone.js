const docusign = require('docusign-esign');

// Simple in-memory cache for authentication (resets on cold start)
let authCache = {
  token: null,
  expiry: null,
  accountInfo: null
};

// Cache for envelope results (resets on cold start)
let envelopeCache = new Map();

// Vitalstone Configuration
const VITALSTONE_CONFIG = {
  subFirm: 'Vitalstone',
  searchTerm: 'vitalstone',
  color: '#687A8C', // Gray-Blue 500 from palette
  daysBack: 90
};

async function getAuthenticatedClient() {
  // Check if we have a valid cached token
  if (authCache.token && authCache.expiry && Date.now() < authCache.expiry) {
    return {
      dsApi: authCache.dsApi,
      accountId: authCache.accountInfo.accountId,
      basePath: authCache.accountInfo.basePath,
      accessToken: authCache.token
    };
  }

  try {
    const integratorKey = process.env.DS_CLIENT_ID;
    const userId = process.env.DS_USER_ID;
    const authServer = 'account.docusign.com';
    const privateKey = process.env.DS_PRIVATE_KEY.replace(/\\n/g, '\n');

    const dsApi = new docusign.ApiClient();
    dsApi.setOAuthBasePath(authServer);

    // Auth
    const results = await dsApi.requestJWTUserToken(
      integratorKey,
      userId,
      ['signature', 'impersonation'],
      privateKey,
      3600
    );
    const accessToken = results.body.access_token;

    const userInfo = await dsApi.getUserInfo(accessToken);
    const accountId = userInfo.accounts[0].accountId;
    const basePath = userInfo.accounts[0].baseUri + '/restapi';
    dsApi.setBasePath(basePath);
    dsApi.addDefaultHeader('Authorization', 'Bearer ' + accessToken);

    // Cache the authentication info
    authCache = {
      token: accessToken,
      expiry: Date.now() + 3500 * 1000, // Cache for 58 minutes (slightly less than 1 hour)
      dsApi: dsApi,
      accountInfo: { accountId, basePath }
    };

    return { dsApi, accountId, basePath, accessToken };
  } catch (err) {
    console.error('Authentication error:', err.message);
    throw err;
  }
}

exports.handler = async function (event, context) {
  try {
    const cacheKey = `vitalstone_${VITALSTONE_CONFIG.subFirm.toLowerCase()}`;
    
    // Check cache first
    const cachedResult = envelopeCache.get(cacheKey);
    if (cachedResult && Date.now() < cachedResult.expiry) {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({
          subFirm: VITALSTONE_CONFIG.subFirm,
          color: VITALSTONE_CONFIG.color,
          found: cachedResult.data.length > 0,
          envelopes: cachedResult.data,
          cached: true
        })
      };
    }

    const { dsApi, accountId } = await getAuthenticatedClient();
    const envelopesApi = new docusign.EnvelopesApi(dsApi);

    // Search for envelopes with "Vitalstone" in subject
    const response = await envelopesApi.listStatusChanges(accountId, {
      fromDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * VITALSTONE_CONFIG.daysBack).toISOString(),
      searchText: VITALSTONE_CONFIG.searchTerm // Search for "vitalstone" in subject line
    });

    // Process envelopes - exclude test envelopes
    const envelopes = (response.envelopes || []).filter(env => {
      const subj = (env.emailSubject || '').toLowerCase();
      return !(subj.includes('test') || subj.includes('dummy') || subj.includes('sandbox'));
    });

    // Filter to only envelopes that have "vitalstone" in subject (case insensitive)
    const matchingEnvelopes = envelopes.filter(env => {
      const subject = (env.emailSubject || '').toLowerCase();
      return subject.includes(VITALSTONE_CONFIG.searchTerm);
    }).map(env => ({
      envelopeId: env.envelopeId,
      emailSubject: env.emailSubject,
      status: env.status,
      createdDateTime: env.createdDateTime,
      completedDateTime: env.completedDateTime,
      statusChangedDateTime: env.statusChangedDateTime,
      subFirm: VITALSTONE_CONFIG.subFirm
    }));

    // Cache the result for 5 minutes
    envelopeCache.set(cacheKey, {
      data: matchingEnvelopes,
      expiry: Date.now() + 5 * 60 * 1000
    });
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({
        subFirm: VITALSTONE_CONFIG.subFirm,
        color: VITALSTONE_CONFIG.color,
        found: matchingEnvelopes.length > 0,
        envelopes: matchingEnvelopes
      })
    };
  } catch (err) {
    console.error('❌ Error:', err.message);
    return { 
      statusCode: 500, 
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ error: err.message }) 
    };
  }
};

const docusign = require('docusign-esign');

// Simple in-memory cache for authentication (resets on cold start)
let authCache = {
  token: null,
  expiry: null,
  accountInfo: null
};

// Cache for envelope results (resets on cold start)
let envelopeCache = new Map();

// RSD specific configuration
const RSD_CONFIG = {
  subFirm: 'Rising Star Distributors',
  ccEmail: 'jknowlton@risingstardistributors.com',
  color: '#7c3aed' // Purple
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
    const cacheKey = `rsd_${RSD_CONFIG.subFirm.toLowerCase().replace(/\s+/g, '_')}`;
    
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
          subFirm: RSD_CONFIG.subFirm,
          color: RSD_CONFIG.color,
          advisors: [RSD_CONFIG.ccEmail],
          found: cachedResult.data.length > 0,
          envelopes: cachedResult.data,
          cached: true
        })
      };
    }

    const { dsApi, accountId } = await getAuthenticatedClient();
    const envelopesApi = new docusign.EnvelopesApi(dsApi);

    // Search for all envelopes (not just completed)
    const response = await envelopesApi.listStatusChanges(accountId, {
      fromDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString(), // 90 days instead of 30
      // Remove status filter to get all statuses, not just completed
    });

    // Process envelopes in parallel with a limit to avoid overwhelming the API
    const envelopes = response.envelopes || [];
    const batchSize = 5; // Process 5 envelopes at a time
    const matchingEnvelopes = [];
    
    for (let i = 0; i < envelopes.length; i += batchSize) {
      const batch = envelopes.slice(i, i + batchSize);
      const batchPromises = batch.map(env => 
        checkEnvelopeForRSD(envelopesApi, accountId, env)
      );
      
      const results = await Promise.all(batchPromises);
      const validResults = results.filter(result => result !== null);
      matchingEnvelopes.push(...validResults);
    }

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
        subFirm: RSD_CONFIG.subFirm,
        color: RSD_CONFIG.color,
        advisors: [RSD_CONFIG.ccEmail],
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

async function checkEnvelopeForRSD(envelopesApi, accountId, env) {
  try {
    // Get envelope details to check CC recipients
    const envelopeDetails = await envelopesApi.getEnvelope(accountId, env.envelopeId);
    
    // Check if Jon Knowlton is CC'd
    const ccRecipients = envelopeDetails.ccRecipients || [];
    const hasJonKnowltonCC = ccRecipients.some(cc => 
      cc.email?.toLowerCase().includes(RSD_CONFIG.ccEmail.toLowerCase())
    );

    if (hasJonKnowltonCC) {
      return {
        envelopeId: env.envelopeId,
        emailSubject: env.emailSubject,
        status: env.status,
        createdDateTime: env.createdDateTime,
        completedDateTime: env.completedDateTime,
        statusChangedDateTime: env.statusChangedDateTime,
        associatedAdvisors: [RSD_CONFIG.ccEmail],
        subFirm: RSD_CONFIG.subFirm,
        ccRecipients: ccRecipients.map(cc => cc.email).filter(Boolean)
      };
    }
  } catch (err) {
    console.error(`Error checking envelope ${env.envelopeId} for RSD CC`, err.message);
  }
  return null;
}

const docusign = require('docusign-esign');

// Simple in-memory cache for authentication (resets on cold start)
let authCache = {
  token: null,
  expiry: null,
  accountInfo: null
};

// Cache for envelope results (resets on cold start)
let envelopeCache = new Map();

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

exports.handler = async function () {
  try {
    const targetEmail = 'bruce.maginn@corecapinv.com';
    const cacheKey = `bruce_${targetEmail}`;
    
    // Check cache first
    const cachedResult = envelopeCache.get(cacheKey);
    if (cachedResult && Date.now() < cachedResult.expiry) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          found: !!cachedResult.data,
          envelope: cachedResult.data,
          cached: true
        })
      };
    }

    const { dsApi, accountId } = await getAuthenticatedClient();
    const envelopesApi = new docusign.EnvelopesApi(dsApi);

    // More specific search to reduce the number of envelopes to process
    const response = await envelopesApi.listStatusChanges(accountId, {
      fromDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(), // Reduce to 30 days
      status: "completed", // Only search completed envelopes
      searchText: 'corecap' // Use searchText instead of filtering manually
    });

    // Process envelopes in parallel with a limit to avoid overwhelming the API
    const envelopes = response.envelopes || [];
    const batchSize = 5; // Process 5 envelopes at a time
    
    for (let i = 0; i < envelopes.length; i += batchSize) {
      const batch = envelopes.slice(i, i + batchSize);
      const batchPromises = batch.map(env => 
        checkEnvelopeForEmail(envelopesApi, accountId, env, targetEmail)
      );
      
      const results = await Promise.all(batchPromises);
      const match = results.find(result => result !== null);
      
      if (match) {
        // Cache the result for 5 minutes
        envelopeCache.set(cacheKey, {
          data: match,
          expiry: Date.now() + 5 * 60 * 1000
        });
        
        return {
          statusCode: 200,
          body: JSON.stringify({
            found: true,
            envelope: match
          })
        };
      }
    }

    // Cache the "not found" result for 1 minute to avoid repeated searches
    envelopeCache.set(cacheKey, {
      data: null,
      expiry: Date.now() + 60 * 1000
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        found: false,
        envelope: null
      })
    };
  } catch (err) {
    console.error('❌ Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function checkEnvelopeForEmail(envelopesApi, accountId, env, targetEmail) {
  try {
    const formResponse = await envelopesApi.getFormData(accountId, env.envelopeId);
    const formData = {};
    (formResponse?.formData || []).forEach(f => {
      formData[f.name] = f.value;
    });

    const hasEmail = Object.values(formData)
      .some(v => v && v.toLowerCase().includes(targetEmail.toLowerCase()));

    if (hasEmail) {
      return {
        envelopeId: env.envelopeId,
        emailSubject: env.emailSubject,
        status: env.status,
        createdDateTime: env.createdDateTime,
        completedDateTime: env.completedDateTime,
        formData
      };
    }
  } catch (err) {
    console.error(`FormData failed for ${env.envelopeId}`, err.message);
  }
  return null;
}

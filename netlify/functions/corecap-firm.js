const docusign = require('docusign-esign');

// Simple in-memory cache for authentication (resets on cold start)
let authCache = {
  token: null,
  expiry: null,
  accountInfo: null
};

// Cache for envelope results (resets on cold start)
let envelopeCache = new Map();

// Sub-firm mapping based on client requirements
const SUB_FIRM_MAPPING = {
  'CoreCap': [
    'Erin.Hoestje@corecapinv.com',
    'shannon.ryan@corecapinv.com',
    'kim.ricketts@corecapinv.com',
    'david.muncie@corecapinv.com',
    'craig.rumler@corecapinv.com'
  ],
  'RJP Estate Planning': [
    'ccohan@rjpaz.com',
    'rtallou@rjpaz.com'
  ],
  'Romain Financial': [
    'rob@romainfinancial.com'
  ],
  'Stivers Wealth': [
    'bstivers@stiversfinancial.com'
  ],
  'Wealth Trac Financial LLC': [
    'kurt.fillmore@corecapinv.com'
  ],
  'Solomon Financial': [
    'brad.clark@corecapinv.com',
    'John.rafferty@corecapinv.com',
    'Bruce.maginn@corecapinv.com'
  ]
};

// Color coding for sub-firms
const SUB_FIRM_COLORS = {
  'CoreCap': '#dc2626', // Red
  'RJP Estate Planning': '#ea580c', // Orange
  'Romain Financial': '#16a34a', // Green
  'Stivers Wealth': '#9333ea', // Purple
  'Wealth Trac Financial LLC': '#374151', // Gray
  'Solomon Financial': '#1e40af' // Blue
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
    const subFirmName = 'CoreCap';
    const subFirmEmails = SUB_FIRM_MAPPING[subFirmName];
    const cacheKey = `corecap_firm_${subFirmName.toLowerCase().replace(/\s+/g, '_')}`;
    
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
          subFirm: subFirmName,
          color: SUB_FIRM_COLORS[subFirmName],
          advisors: subFirmEmails,
          found: cachedResult.data.length > 0,
          envelopes: cachedResult.data,
          cached: true
        })
      };
    }

    const { dsApi, accountId } = await getAuthenticatedClient();
    const envelopesApi = new docusign.EnvelopesApi(dsApi);

    // CoreCap firm-wide access: search for "corecap" in subject line
    const response = await envelopesApi.listStatusChanges(accountId, {
      fromDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(), // 30 days
      status: "completed", // Only search completed envelopes
      searchText: 'corecap' // Firm-wide access via subject line
    });

    // Process envelopes in parallel with a limit to avoid overwhelming the API
    const envelopes = response.envelopes || [];
    const batchSize = 5; // Process 5 envelopes at a time
    const matchingEnvelopes = [];
    
    for (let i = 0; i < envelopes.length; i += batchSize) {
      const batch = envelopes.slice(i, i + batchSize);
      const batchPromises = batch.map(env => 
        checkEnvelopeForCoreCap(envelopesApi, accountId, env, subFirmEmails, subFirmName)
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
        subFirm: subFirmName,
        color: SUB_FIRM_COLORS[subFirmName],
        advisors: subFirmEmails,
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

async function checkEnvelopeForCoreCap(envelopesApi, accountId, env, subFirmEmails, subFirmName) {
  try {
    // For CoreCap, we primarily use subject line filtering (firm-wide access)
    const hasCoreCapInSubject = env.emailSubject?.toLowerCase().includes('corecap');
    
    if (hasCoreCapInSubject) {
      // Try to identify which advisor is associated by checking form data
      let associatedAdvisors = [];
      try {
        const formResponse = await envelopesApi.getFormData(accountId, env.envelopeId);
        const formData = {};
        (formResponse?.formData || []).forEach(f => {
          formData[f.name] = f.value;
        });

        // Check if any CoreCap advisor emails appear in the form data
        associatedAdvisors = subFirmEmails.filter(email => 
          Object.values(formData).some(v => v && v.toLowerCase().includes(email.toLowerCase()))
        );
      } catch (formErr) {
        console.log(`Form data check failed for ${env.envelopeId}, using subject line only`);
      }

      return {
        envelopeId: env.envelopeId,
        emailSubject: env.emailSubject,
        status: env.status,
        createdDateTime: env.createdDateTime,
        completedDateTime: env.completedDateTime,
        statusChangedDateTime: env.statusChangedDateTime,
        associatedAdvisors: associatedAdvisors.length > 0 ? associatedAdvisors : ['CoreCap Firm-Wide'],
        subFirm: subFirmName
      };
    }
  } catch (err) {
    console.error(`Error processing envelope ${env.envelopeId}`, err.message);
  }
  return null;
}

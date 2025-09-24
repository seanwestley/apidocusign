// netlify/functions/corecap.js
const docusign = require('docusign-esign');

exports.handler = async function (event) {
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

    const envelopesApi = new docusign.EnvelopesApi(dsApi);

    // Params
    const { limit, days } = event.queryStringParameters || {};
    const maxResults = parseInt(limit) || 10; // default 10
    const daysBack = parseInt(days) || 30; // default 30 days

    // Fetch envelopes
    const response = await envelopesApi.listStatusChanges(accountId, {
      fromDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * daysBack).toISOString(),
      status: "any"
    });

    const corecapEnvelopes = (response.envelopes || [])
      .filter(env => env.emailSubject?.toLowerCase().includes('corecap'))
      .slice(0, maxResults);

    // Enrich with form data
    const enriched = await Promise.all(
      corecapEnvelopes.map(async (env) => {
        try {
          const formResponse = await envelopesApi.getFormData(accountId, env.envelopeId);
          const formData = {};
          (formResponse?.formData || []).forEach(f => {
            formData[f.name] = f.value;
          });

          // Shortcut fields
          const investorName = formData['Full Name'] || formData['Name'] || null;
          const investorEmail = formData['Email'] || null;

          return {
            envelopeId: env.envelopeId,
            emailSubject: env.emailSubject,
            status: env.status,
            createdDateTime: env.createdDateTime,
            completedDateTime: env.completedDateTime,
            sender: env.sender,
            investorName,
            investorEmail,
            formData
          };
        } catch (err) {
          console.error(`Form data fetch failed for ${env.envelopeId}`, err.message);
          return {
            ...env,
            investorName: null,
            investorEmail: null,
            formData: {},
            fieldError: err.message
          };
        }
      })
    );

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({
        total: enriched.length,
        envelopes: enriched
      }),
    };
  } catch (error) {
    console.error('❌ Corecap fetch failed:', error.message);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ message: error.message, stack: error.stack }),
    };
  }
};

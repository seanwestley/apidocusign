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

    // Authenticate
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

    // Query params
    const { limit, days } = event.queryStringParameters || {};
    const maxResults = parseInt(limit) || 20; // default 20
    const daysBack = parseInt(days) || 30; // default 30 days

    // Fetch envelopes
    const response = await envelopesApi.listStatusChanges(accountId, {
      fromDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * daysBack).toISOString(),
      status: "any"
    });

    const corecapEnvelopes = (response.envelopes || [])
      .filter(env => env.emailSubject?.toLowerCase().includes('corecap'))
      .slice(0, maxResults);

    // Enrich each envelope with custom fields + form data in parallel
    const enriched = await Promise.all(
      corecapEnvelopes.map(async (env) => {
        try {
          const [fieldsResponse, formResponse] = await Promise.all([
            envelopesApi.listCustomFields(accountId, env.envelopeId),
            envelopesApi.getFormData(accountId, env.envelopeId)
          ]);

          // Envelope-level custom fields
          const customFields = {};
          (fieldsResponse?.textCustomFields || []).forEach(f => {
            customFields[f.name] = f.value;
          });

          // Signer form data
          const formData = {};
          (formResponse?.formData || []).forEach(f => {
            formData[f.name] = f.value;
          });

          return {
            envelopeId: env.envelopeId,
            emailSubject: env.emailSubject,
            status: env.status,
            createdDateTime: env.createdDateTime,
            completedDateTime: env.completedDateTime,
            sender: env.sender,
            customFields,
            formData
          };
        } catch (err) {
          console.error(`❌ Envelope ${env.envelopeId} failed:`, err.message);
          return {
            ...env,
            customFields: {},
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

// netlify/functions/corecap-email.js
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
    const { email, days } = event.queryStringParameters || {};
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: "email param required" }) };
    }
    const filterEmail = email.toLowerCase();
    const daysBack = parseInt(days) || 90; // default 90 days back

    // Function to loop through all pages
    async function fetchAllEnvelopes(uri = null, collected = []) {
      let response;
      if (uri) {
        response = await dsApi.callApi(uri, 'GET', {}, null, { 'Authorization': 'Bearer ' + accessToken }, null);
        response = response.body;
      } else {
        response = await envelopesApi.listStatusChanges(accountId, {
          fromDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * daysBack).toISOString(),
          status: "any"
        });
      }

      collected = collected.concat(response.envelopes || []);
      if (response.nextUri) {
        return fetchAllEnvelopes(response.nextUri, collected);
      } else {
        return collected;
      }
    }

    // Get all envelopes
    const allEnvelopes = await fetchAllEnvelopes();

    // Filter Corecap + enrich
    const corecapEnvelopes = allEnvelopes.filter(env =>
      env.emailSubject?.toLowerCase().includes('corecap')
    );

    const enriched = await Promise.all(
      corecapEnvelopes.map(async (env) => {
        try {
          const formResponse = await envelopesApi.getFormData(accountId, env.envelopeId);
          const formData = {};
          (formResponse?.formData || []).forEach(f => {
            formData[f.name] = f.value;
          });

          const investorEmail = formData['Email'] ? formData['Email'].toLowerCase() : null;
          if (investorEmail !== filterEmail) return null;

          return {
            envelopeId: env.envelopeId,
            emailSubject: env.emailSubject,
            status: env.status,
            createdDateTime: env.createdDateTime,
            completedDateTime: env.completedDateTime,
            investorName: formData['Full Name'] || formData['Name'] || null,
            investorEmail,
            formData
          };
        } catch (err) {
          console.error(`FormData failed for ${env.envelopeId}`, err.message);
          return null;
        }
      })
    );

    const filtered = enriched.filter(Boolean);

    return {
      statusCode: 200,
      body: JSON.stringify({ total: filtered.length, envelopes: filtered })
    };
  } catch (err) {
    console.error('❌ Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

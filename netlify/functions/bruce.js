// netlify/functions/adwance.js
const docusign = require('docusign-esign');

exports.handler = async function () {
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

    // Hardcoded target email
    const targetEmail = 'bruce.maginn@corecapinv.com';

    // Helper: process one page and return if match found
    async function processPage(response) {
      const envelopes = (response.envelopes || [])
        .filter(env => env.emailSubject?.toLowerCase().includes('corecap'));

      for (const env of envelopes) {
        try {
          const formResponse = await envelopesApi.getFormData(accountId, env.envelopeId);
          const formData = {};
          (formResponse?.formData || []).forEach(f => {
            formData[f.name] = f.value;
          });

          const hasEmail = Object.values(formData)
            .map(v => v && v.toLowerCase())
            .includes(targetEmail.toLowerCase());

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
      }

      return null;
    }

    // Iterate through all pages until match is found
    async function findEnvelope() {
      let response = await envelopesApi.listStatusChanges(accountId, {
        fromDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 180).toISOString(), // last 180 days
        status: "any"
      });

      let match = await processPage(response);
      if (match) return match;

      while (response.nextUri) {
        const next = await dsApi.callApi(
          response.nextUri,
          'GET',
          {},
          null,
          { 'Authorization': 'Bearer ' + accessToken },
          null
        );
        response = next.body;
        match = await processPage(response);
        if (match) return match;
      }

      return null;
    }

    const result = await findEnvelope();

    return {
      statusCode: 200,
      body: JSON.stringify({
        found: !!result,
        envelope: result
      })
    };
  } catch (err) {
    console.error('❌ Error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

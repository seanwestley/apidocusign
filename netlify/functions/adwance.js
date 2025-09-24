// netlify/functions/corecap.js
const docusign = require('docusign-esign');

exports.handler = async function (event, context) {
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

    // Get envelopes from last ~100 days containing "corecap"
    const response = await envelopesApi.listStatusChanges(accountId, {
      fromDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 100).toISOString(),
    });

    const corecapEnvelopes = (response.envelopes || []).filter(env =>
      env.emailSubject?.toLowerCase().includes('corecap')
    );

    // Enrich with both custom fields + form data
    const enriched = [];
    for (const env of corecapEnvelopes) {
      try {
        // Envelope-level custom fields
        const fieldsResponse = await envelopesApi.listCustomFields(accountId, env.envelopeId);
        const textFields = fieldsResponse?.textCustomFields || [];
        const customFields = {};
        textFields.forEach(f => {
          customFields[f.name] = f.value;
        });

        // Signer-entered form data
        let formData = {};
        try {
          const formResponse = await envelopesApi.getFormData(accountId, env.envelopeId);
          if (formResponse?.formData) {
            formData = formResponse.formData.reduce((acc, f) => {
              acc[f.name] = f.value;
              return acc;
            }, {});
          }
        } catch (formErr) {
          console.warn(`No form data for envelope ${env.envelopeId}:`, formErr.message);
        }

        enriched.push({
          envelopeId: env.envelopeId,
          emailSubject: env.emailSubject,
          status: env.status,
          createdDateTime: env.createdDateTime,
          completedDateTime: env.completedDateTime,
          sender: env.sender,
          customFields,
          formData, // signer-entered fields
        });
      } catch (innerErr) {
        console.error(`Failed to fetch fields for ${env.envelopeId}`, innerErr.message);
        enriched.push({
          ...env,
          customFields: {},
          formData: {},
          fieldError: innerErr.message,
        });
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify(enriched),
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

// netlify/functions/fetchfields.js
const docusign = require('docusign-esign');

exports.handler = async function (event, context) {
  try {
    const envelopeId = event.queryStringParameters?.id;

    if (!envelopeId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Envelope ID is required as query parameter "id".' }),
      };
    }

    const integratorKey = process.env.DS_CLIENT_ID;
    const userId = process.env.DS_USER_ID;
    const authServer = 'account.docusign.com';
    const privateKey = process.env.DS_PRIVATE_KEY.replace(/\\n/g, '\n');

    const dsApi = new docusign.ApiClient();
    dsApi.setOAuthBasePath(authServer);

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

    // Step 1: Get recipient info
    const recipientResults = await envelopesApi.listRecipients(accountId, envelopeId);
    const recipient = recipientResults.signers?.[0];

    if (!recipient) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: 'No signers found for envelope.' }),
      };
    }

    // Step 2: Get the tabs (fields) for that recipient
    const tabs = await envelopesApi.listTabs(accountId, envelopeId, recipient.recipientId);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify(tabs),
    };
  } catch (error) {
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

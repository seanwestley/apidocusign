
# 📝 Netlify DocuSign eSignature Functions

A collection of Netlify Functions that interact with the **DocuSign eSignature API** using JWT authentication. This project enables secure, serverless endpoints for fetching envelope details, audit trails, recipient info, and more — all deployable with a single click via Netlify.

---

## 🌟 Features

- 🔐 Secure JWT-based OAuth authentication
- 📩 Fetch envelope metadata and statuses
- 👥 Get recipients involved in signing
- 📄 Retrieve audit events for compliance
- 👁️ View envelope details
- 🧑‍💼 Retrieve authenticated user info

---

## 📁 Folder Structure

```bash
/netlify/functions/
├── getEnvelopes.js     # Lists envelope status changes (last 30 days)
├── getRecipients.js    # Fetches recipients for a given envelope
├── audit.js            # Fetches audit events for an envelope
├── viewEnvelope.js     # Returns envelope details by ID
└── getUserInfo.js      # Gets authenticated user info from DocuSign
.env                    # DocuSign API credentials
```

---

## 🔧 Setup & Configuration

### 1. Clone This Repo

```bash
git clone https://github.com/seanwestley/apidocusign.git
cd apidocusign
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create a `.env` File

Create a `.env` file in the root directory and paste in your DocuSign credentials:

```env
DS_CLIENT_ID=your_docusign_client_id
DS_USER_ID=your_docusign_user_guid
DS_REDIRECT_URI=https://your-site.netlify.app/callback
DS_ACCOUNT_ID=your_docusign_account_id
DS_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
YOUR_PRIVATE_KEY_CONTENT_HERE
-----END RSA PRIVATE KEY-----"
```

> ⚠️ Never commit your `.env` file to version control.

### 4. Run Locally (Optional)

Use [Netlify CLI](https://docs.netlify.com/cli/get-started/) to test functions locally:

```bash
npm install -g netlify-cli
netlify dev
```

---

## 🚀 Deployment on Netlify

1. Push the repo to GitHub.
2. Go to [Netlify](https://app.netlify.com/) and create a new site from Git.
3. Add your environment variables under **Site Settings → Environment Variables**.
4. Deploy! 🎉

Your functions will be accessible at:

```
https://your-site.netlify.app/.netlify/functions/<function-name>
```

---

## 📘 API Endpoints

| Function Name      | Path                                       | Description                                  |
|-------------------|--------------------------------------------|----------------------------------------------|
| `getEnvelopes`     | `/getEnvelopes`                            | Lists envelopes from the last 30 days        |
| `getRecipients`    | `/getRecipients?id=<envelopeId>`           | Returns recipient info for given envelope    |
| `audit`            | `/audit?id=<envelopeId>`                   | Returns audit events for an envelope         |
| `viewEnvelope`     | `/viewEnvelope?id=<envelopeId>`            | Retrieves envelope metadata by ID            |
| `getUserInfo`      | `/getUserInfo`                             | Returns info of the authenticated user       |

---

## 🧠 Notes

- Requires a [DocuSign developer account](https://developers.docusign.com/) with JWT app setup.
- All endpoints are CORS-enabled for frontend usage.
- Functionality can be extended with embedded signing, template creation, webhook handling, etc.

---

## 📄 License

MIT © [Sean Westley](https://github.com/seanwestley)

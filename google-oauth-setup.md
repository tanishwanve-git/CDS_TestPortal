# Google OAuth 2.0 Setup Guide

To allow students to sign in with their Google accounts on the CDS Test Portal, you need to create OAuth 2.0 credentials in the Google Cloud Console. Follow these steps:

## Step 1: Create a Google Cloud Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Sign in with your Google account.
3. Click the **Project Dropdown** at the top left (next to the Google Cloud logo).
4. Click **New Project**.
5. Give your project a name (e.g., `cds-test-portal`) and click **Create**.
6. Wait a moment, then make sure your new project is selected in the project dropdown.

## Step 2: Configure the OAuth Consent Screen
1. In the left sidebar, navigate to **APIs & Services** > **OAuth consent screen**.
   *(You can also use the top search bar to find "OAuth consent screen")*
2. Choose **External** (unless you have a Google Workspace and only want users from your specific organization to log in).
3. Click **Create**.
4. Fill out the required App information:
   - **App name:** CDS Test Portal
   - **User support email:** Your email address
   - **Developer contact information:** Your email address
   - You can skip adding an app logo or domain for now (unless you have them ready).
5. Click **Save and Continue**.
6. On the **Scopes** page, you don't need to add any special scopes since we only need the user's basic profile (email and name). Just click **Save and Continue**.
7. On the **Test users** page, click **Add Users** and add your own Google email address (and any friends/colleagues who will help you test the login before you publish the app).
8. Click **Save and Continue**, then click **Back to Dashboard**.

## Step 3: Create Credentials (Client ID & Secret)
1. In the left sidebar, go to **Credentials**.
2. Click **+ Create Credentials** at the top and select **OAuth client ID**.
3. Under **Application type**, select **Web application**.
4. Name it something like `CDS Portal Web Client`.
5. Under **Authorized JavaScript origins**, click **+ Add URI** and enter:
   - `http://localhost:5000` (for your local development)
   - *Later, when you deploy to production, you will add your actual domain name here (e.g., `https://yourdomain.com`).*
6. Under **Authorized redirect URIs**, click **+ Add URI** and enter:
   - `http://localhost:5000/api/auth/google/callback` (We will set up this specific route in your Express backend later).
7. Click **Create**.

## Step 4: Get Your Keys
A modal will pop up displaying your **Client ID** and **Client Secret**.

Copy both of these values and add them to your project's `.env` file (which we will create together later) like this:

```env
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
```

**Keep your Client Secret private! Never commit it to GitHub or share it publicly.**

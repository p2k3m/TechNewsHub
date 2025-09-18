import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import axios from 'axios';

interface AuthPayload {
  authorizationCode?: string;
  redirectUri?: string;
  sessionId?: string;
  preferredName?: string;
}

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
}

interface GoogleProfileResponse {
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
}

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});

const secretArn = process.env.API_SECRET_ARN ?? '';
const userProfilesTableName = process.env.USER_PROFILES_TABLE_NAME ?? '';

let cachedSecrets: { googleClientId?: string; googleClientSecret?: string } | null = null;

async function getGoogleSecrets() {
  if (cachedSecrets) {
    return cachedSecrets;
  }
  if (!secretArn) {
    cachedSecrets = {};
    return cachedSecrets;
  }
  const secret = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
  cachedSecrets = secret.SecretString
    ? (JSON.parse(secret.SecretString) as { googleClientId?: string; googleClientSecret?: string })
    : {};
  return cachedSecrets;
}

async function exchangeCodeForTokens(payload: AuthPayload) {
  const secrets = await getGoogleSecrets();
  if (!payload.authorizationCode || !secrets.googleClientId || !secrets.googleClientSecret) {
    return null;
  }
  try {
    const tokenResponse = await axios.post<GoogleTokenResponse>(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: payload.authorizationCode,
        redirect_uri: payload.redirectUri ?? 'https://example.com/auth/callback',
        client_id: secrets.googleClientId,
        client_secret: secrets.googleClientSecret,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    return tokenResponse.data;
  } catch (error) {
    console.error('Failed to exchange authorization code', error);
    return null;
  }
}

async function fetchGoogleProfile(accessToken: string) {
  try {
    const profileResponse = await axios.get<GoogleProfileResponse>(
      'https://people.googleapis.com/v1/people/me',
      {
        params: { personFields: 'names,emailAddresses' },
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    return profileResponse.data;
  } catch (error) {
    console.error('Failed to fetch Google profile', error);
    return null;
  }
}

function parsePayload(event: APIGatewayProxyEventV2): AuthPayload {
  if (!event.body) {
    return {};
  }
  try {
    return JSON.parse(event.body);
  } catch (error) {
    console.error('Unable to parse auth payload', error);
    return {};
  }
}

async function persistUserProfile(email: string, displayName: string | undefined) {
  if (!userProfilesTableName) {
    return;
  }
  await docClient.send(
    new PutCommand({
      TableName: userProfilesTableName,
      Item: {
        email,
        displayName: displayName ?? email.split('@')[0],
        updatedAt: new Date().toISOString(),
      },
    }),
  );
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const payload = parsePayload(event);
  const tokenSet = await exchangeCodeForTokens(payload);

  let email: string | undefined;
  let displayName: string | undefined = payload.preferredName;

  if (tokenSet?.access_token) {
    const profile = await fetchGoogleProfile(tokenSet.access_token);
    email = profile?.emailAddresses?.[0]?.value ?? undefined;
    displayName = displayName ?? profile?.names?.[0]?.displayName;
  }

  if (!email) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Unable to resolve Google profile information' }),
    };
  }

  await persistUserProfile(email, displayName);

  const cookieValue = Buffer.from(JSON.stringify({ email, displayName })).toString('base64url');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Set-Cookie': `tnh_session=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`,
    },
    body: JSON.stringify({ email, displayName }),
  };
};

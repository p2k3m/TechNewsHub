import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const tableName = process.env.USER_PROFILES_TABLE_NAME ?? '';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface SessionCookie {
  email?: string;
  displayName?: string;
}

function parseSession(event: APIGatewayProxyEventV2): SessionCookie | null {
  const cookieHeader = event.headers?.cookie ?? event.headers?.Cookie;
  if (!cookieHeader) {
    return null;
  }
  const parts = cookieHeader.split(';').map((part) => part.trim());
  const session = parts.find((part) => part.startsWith('tnh_session='));
  if (!session) {
    return null;
  }
  try {
    const value = session.replace('tnh_session=', '');
    const decoded = Buffer.from(value, 'base64url').toString('utf-8');
    return JSON.parse(decoded) as SessionCookie;
  } catch (error) {
    console.warn('Failed to decode session cookie', error);
    return null;
  }
}

function resolveEmail(event: APIGatewayProxyEventV2, session: SessionCookie | null): string | undefined {
  const jwtClaims =
    (event.requestContext as any)?.authorizer?.jwt?.claims ||
    (event.requestContext as any)?.authorizer?.claims;
  return (
    session?.email ||
    jwtClaims?.email ||
    jwtClaims?.['custom:email'] ||
    jwtClaims?.['cognito:username']
  );
}

async function loadProfile(email: string): Promise<{ email: string; displayName: string }> {
  if (!tableName) {
    return { email, displayName: email.split('@')[0] };
  }
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { email },
    }),
  );
  const displayName =
    (result.Item?.displayName as string | undefined) ||
    (result.Item?.preferredName as string | undefined) ||
    email.split('@')[0];
  return { email, displayName };
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const session = parseSession(event);
  const email = resolveEmail(event, session);

  if (!email) {
    return {
      statusCode: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({ message: 'Not authenticated' }),
    };
  }

  const profile = await loadProfile(email);
  const body = {
    email: profile.email,
    displayName: session?.displayName ?? profile.displayName,
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
};

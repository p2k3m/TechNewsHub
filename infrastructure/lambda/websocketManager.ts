import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const tableName = process.env.WEBSOCKET_SESSIONS_TABLE_NAME ?? '';
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function handleConnect(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  if (!tableName) {
    return { statusCode: 200, body: 'connected' };
  }
  const connectionId = (event.requestContext as any).connectionId ?? randomUUID();
  const sessionId = event.queryStringParameters?.sessionId ?? randomUUID();
  const ttl = Math.floor(Date.now() / 1000) + 60 * 60 * 24;

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        connectionId,
        sessionId,
        ttl,
        connectedAt: new Date().toISOString(),
      },
    }),
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ connectionId, sessionId }),
  };
}

async function handleDisconnect(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  if (!tableName) {
    return { statusCode: 200, body: 'disconnected' };
  }
  const connectionId = (event.requestContext as any).connectionId;
  if (connectionId) {
    await docClient.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { connectionId },
      }),
    );
  }
  return { statusCode: 200, body: 'disconnected' };
}

async function handleMessage(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  if (!tableName) {
    return { statusCode: 200, body: 'noop' };
  }
  const connectionId = (event.requestContext as any).connectionId;
  if (connectionId) {
    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { connectionId },
        UpdateExpression: 'SET lastSeen = :now, ttl = :ttl',
        ExpressionAttributeValues: {
          ':now': new Date().toISOString(),
          ':ttl': Math.floor(Date.now() / 1000) + 60 * 60 * 24,
        },
      }),
    );
  }
  return {
    statusCode: 200,
    body: event.body ?? 'ack',
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const eventType = (event.requestContext as any).eventType;
  switch (eventType) {
    case 'CONNECT':
      return handleConnect(event);
    case 'DISCONNECT':
      return handleDisconnect(event);
    case 'MESSAGE':
    default:
      return handleMessage(event);
  }
};

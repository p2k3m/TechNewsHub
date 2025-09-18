import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

interface RefreshEventDetail {
  sections?: string[];
  timePeriods?: string[];
  connections?: string[];
}

const stateMachineArn = process.env.STATE_MACHINE_ARN ?? '';
const websocketEndpoint = process.env.WEBSOCKET_ENDPOINT ?? '';

const stepFunctionsClient = new SFNClient({});
const websocketClient = websocketEndpoint
  ? new ApiGatewayManagementApiClient({ endpoint: websocketEndpoint })
  : undefined;

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const websocketTableName = process.env.WEBSOCKET_SESSIONS_TABLE_NAME ?? '';

async function listActiveConnections(): Promise<string[]> {
  if (!websocketTableName) {
    return [];
  }
  const result = await docClient.send(
    new ScanCommand({
      TableName: websocketTableName,
      ProjectionExpression: 'connectionId',
    }),
  );
  return (result.Items ?? []).map((item) => item.connectionId as string).filter(Boolean);
}

export const handler = async (event: { detail?: RefreshEventDetail }) => {
  const detail = event?.detail ?? {};
  const sections = detail.sections ?? ['ml', 'ai', 'iot', 'quantum'];
  const timePeriods = detail.timePeriods ?? ['daily', 'weekly', 'monthly', 'yearly'];

  if (!stateMachineArn) {
    console.error('STATE_MACHINE_ARN is not configured');
    return { statusCode: 500, body: 'Missing state machine configuration' };
  }

  await stepFunctionsClient.send(
    new StartExecutionCommand({
      stateMachineArn,
      input: JSON.stringify({
        sections,
        timePeriods,
        triggeredAt: new Date().toISOString(),
      }),
    }),
  );

  const connections = Array.isArray(detail.connections)
    ? detail.connections
    : await listActiveConnections();

  if (websocketClient && connections.length > 0) {
    const payload = JSON.stringify({
      type: 'refresh',
      message: 'TechNewsHub content refresh triggered',
      sections,
      timePeriods,
    });

    await Promise.allSettled(
      connections.map((connectionId) =>
        websocketClient.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: Buffer.from(payload),
          }),
        ),
      ),
    );
  }

  return { statusCode: 202, body: 'Refresh started' };
};

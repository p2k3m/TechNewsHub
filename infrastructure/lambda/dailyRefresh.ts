import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

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

  if (websocketClient && Array.isArray(detail.connections)) {
    const payload = JSON.stringify({
      type: 'refresh',
      message: 'TechNewsHub content refresh triggered',
      sections,
      timePeriods,
    });

    await Promise.allSettled(
      detail.connections.map((connectionId) =>
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

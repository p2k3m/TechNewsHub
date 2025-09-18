import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

interface RecommendationRequest {
  sessionId?: string;
  email?: string;
  limit?: number;
}

interface RecommendationItem {
  section: string;
  reason: string;
  score: number;
}

interface RecommendationResponse {
  recommendations: RecommendationItem[];
  generatedAt: string;
}

const tableName = process.env.ACCESS_LOGS_TABLE_NAME ?? '';
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function parseRequest(event: APIGatewayProxyEventV2): RecommendationRequest {
  if (!event.body) {
    return { limit: 3 };
  }
  try {
    const body = JSON.parse(event.body);
    return {
      sessionId: body.sessionId,
      email: body.email,
      limit: body.limit ?? 3,
    };
  } catch (error) {
    console.warn('Unable to parse recommendation payload', error);
    return { limit: 3 };
  }
}

async function fetchAccessHistory(sessionId?: string): Promise<Array<Record<string, any>>> {
  if (!tableName || !sessionId) {
    return [];
  }
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: {
        ':sessionId': sessionId,
      },
      Limit: 100,
      ScanIndexForward: false,
    }),
  );
  return result.Items ?? [];
}

function inferScores(history: Array<Record<string, any>>): RecommendationItem[] {
  const baseSections = ['ai', 'ml', 'iot', 'quantum'];
  const interest: Record<string, number> = Object.fromEntries(baseSections.map((section) => [section, 0]));

  history.forEach((item) => {
    const path: string = item.path ?? '';
    baseSections.forEach((section) => {
      if (path.toLowerCase().includes(section)) {
        interest[section] += 2;
      }
    });
    if (typeof item.geo === 'string' && item.geo.toLowerCase().includes('research')) {
      interest.quantum += 1.5;
    }
  });

  const scored = baseSections
    .map((section) => ({
      section,
      score: interest[section] || 0.5,
    }))
    .sort((a, b) => b.score - a.score);

  return scored.map((entry) => ({
    section: entry.section,
    score: Math.round(entry.score * 10) / 10,
    reason:
      entry.score > 1
        ? `You recently explored ${entry.section.toUpperCase()} stories, so we surfaced more insights.`
        : `Discover curated ${entry.section.toUpperCase()} highlights tailored for emerging trends.`,
  }));
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const request = parseRequest(event);
  const history = await fetchAccessHistory(request.sessionId);
  const recommendations = inferScores(history).slice(0, request.limit ?? 3);

  const response: RecommendationResponse = {
    recommendations,
    generatedAt: new Date().toISOString(),
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(response),
  };
};

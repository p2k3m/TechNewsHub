import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuid } from 'uuid';

const tableName = process.env.CONTENT_CACHE_TABLE_NAME ?? '';
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface RelatedContentRequest {
  section: string;
  period: string;
  itemId: string;
  depth?: number;
}

interface RelatedItem {
  id: string;
  title: string;
  summary: string;
  sourceUrl?: string;
  verificationScore: number;
  related?: RelatedItem[];
}

interface RelatedContentResponse {
  section: string;
  period: string;
  item: RelatedItem;
  generatedAt: string;
}

function parseRequest(event: APIGatewayProxyEventV2): RelatedContentRequest {
  const section = event.pathParameters?.section ?? 'ai';
  const period = event.pathParameters?.period ?? 'daily';
  const itemId = event.pathParameters?.itemId ?? 'unknown';
  const depth = event.queryStringParameters?.depth
    ? Number.parseInt(event.queryStringParameters.depth, 10)
    : undefined;
  return { section, period, itemId, depth };
}

function buildPlaceholder(section: string, period: string, itemId: string): RelatedItem {
  return {
    id: itemId,
    title: `Deep dive for ${section.toUpperCase()} (${period})`,
    summary: 'Configure aggregation providers to unlock hierarchical related content.',
    verificationScore: 60,
    related: Array.from({ length: 2 }).map((_, index) => ({
      id: uuid(),
      title: `${section.toUpperCase()} contextual insight ${index + 1}`,
      summary: 'Placeholder context pending real AI enrichment.',
      verificationScore: 55,
    })),
  };
}

async function fetchCached(section: string, period: string): Promise<any> {
  if (!tableName) {
    return null;
  }
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { sectionPeriod: `${section}#${period}` },
    }),
  );
  return result.Item ?? null;
}

function expandRelated(item: any, depth = 1): RelatedItem {
  const relatedItems: RelatedItem[] = Array.isArray(item.related)
    ? item.related.slice(0, 3).map((child: any) => expandRelated(child, depth - 1))
    : [];
  return {
    id: item.id ?? uuid(),
    title: item.title ?? 'Related technology development',
    summary:
      item.summary ??
      item.content ??
      'AI generated related insight awaiting full orchestration.',
    sourceUrl: item.sourceUrl ?? item.source?.url ?? item.url,
    verificationScore: Number.isFinite(item.verificationScore)
      ? Math.round(item.verificationScore)
      : 60,
    related: depth > 1 ? relatedItems : undefined,
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const request = parseRequest(event);
  const cached = await fetchCached(request.section, request.period);
  const candidates: any[] = Array.isArray(cached?.newsArray) ? cached?.newsArray : [];
  const fallback = buildPlaceholder(request.section, request.period, request.itemId);

  const target =
    candidates.find((item) => item.id === request.itemId) ??
    candidates.find((item) => item.title?.toLowerCase().includes(request.itemId.toLowerCase())) ??
    fallback;

  const item = expandRelated(target, Math.min(request.depth ?? 3, 5));

  const response: RelatedContentResponse = {
    section: request.section,
    period: request.period,
    item,
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

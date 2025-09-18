import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import axios from 'axios';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { v4 as uuid } from 'uuid';

interface PatentRequest {
  section: string;
  timePeriod: string;
  mode?: string;
}

interface PatentSummary {
  id: string;
  title: string;
  abstract: string;
  filingDate?: string;
  inventors?: string[];
  impactScore: number;
  sourceUrl?: string;
}

interface PatentResponse {
  section: string;
  timePeriod: string;
  patents: PatentSummary[];
  generatedAt: string;
}

interface SecretBundle {
  perplexityApiKey?: string;
  geminiApiKey?: string;
  chatGptApiKey?: string;
  xBearerToken?: string;
}

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});
const tableName = process.env.CONTENT_CACHE_TABLE_NAME ?? '';
const secretArn = process.env.API_SECRET_ARN ?? '';
let cachedSecrets: SecretBundle | null = null;

async function loadSecrets(): Promise<SecretBundle> {
  if (cachedSecrets) {
    return cachedSecrets;
  }
  if (!secretArn) {
    cachedSecrets = {};
    return cachedSecrets;
  }
  const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
  cachedSecrets = result.SecretString ? (JSON.parse(result.SecretString) as SecretBundle) : {};
  return cachedSecrets;
}

function isApiGatewayEvent(event: any): event is APIGatewayProxyEventV2 {
  return event && typeof event === 'object' && 'requestContext' in event;
}

function normalizeRequest(event: any): PatentRequest {
  if (isApiGatewayEvent(event)) {
    const body = event.body ? JSON.parse(event.body) : {};
    return {
      section: body.section ?? event.queryStringParameters?.section ?? 'ai',
      timePeriod: body.timePeriod ?? event.queryStringParameters?.timePeriod ?? 'monthly',
      mode: 'api',
    };
  }
  return {
    section: event.section ?? 'ai',
    timePeriod: event.timePeriod ?? 'monthly',
    mode: event.mode,
  };
}

async function generatePatentSummaries(request: PatentRequest): Promise<PatentSummary[]> {
  const secrets = await loadSecrets();
  const query = `Summarize the most impactful patents related to ${request.section} filed within ${request.timePeriod}`;
  const items: PatentSummary[] = [];

  if (secrets.perplexityApiKey) {
    try {
      const response = await axios.post(
        'https://api.perplexity.ai/search',
        { query, max_results: 10 },
        { headers: { Authorization: `Bearer ${secrets.perplexityApiKey}` } },
      );
      for (const patent of response.data?.results ?? []) {
        items.push({
          id: patent.id ?? uuid(),
          title: patent.title ?? `Patent insight for ${request.section}`,
          abstract:
            patent.summary ??
            patent.abstract ??
            `Placeholder summary for a ${request.section} patent during ${request.timePeriod}.`,
          filingDate: patent.published_at ?? patent.filingDate,
          inventors: patent.inventors ?? [],
          impactScore: Math.round((patent.confidence ?? 0.6) * 100),
          sourceUrl: patent.source?.url ?? patent.url,
        });
      }
    } catch (error) {
      console.warn('Perplexity patent lookup failed, falling back to ChatGPT');
    }
  }

  if (items.length === 0 && secrets.chatGptApiKey) {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Generate concise patent summaries for technology news readers.' },
          { role: 'user', content: query },
        ],
      },
      { headers: { Authorization: `Bearer ${secrets.chatGptApiKey}` } },
    );
    const text = response.data?.choices?.[0]?.message?.content ?? '';
    if (text) {
      const placeholder = text.split('\n').filter(Boolean).slice(0, 5);
      placeholder.forEach((line: string, index: number) => {
        items.push({
          id: uuid(),
          title: line.split(':')[0] ?? `Patent ${index + 1}`,
          abstract: line,
          impactScore: 60,
        });
      });
    }
  }

  if (items.length === 0) {
    return Array.from({ length: 3 }).map((_, index) => ({
      id: uuid(),
      title: `${request.section.toUpperCase()} patent highlight ${index + 1}`,
      abstract: `Placeholder patent highlight for ${request.section} (${request.timePeriod}). Configure API keys to replace this data.`,
      impactScore: 55,
    }));
  }

  return items.slice(0, 10);
}

async function upsertCache(request: PatentRequest, patents: PatentSummary[]): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { sectionPeriod: `${request.section}#${request.timePeriod}` },
      UpdateExpression:
        'SET patentsArray = :patents, verifiedAt = :verifiedAt, expiresAt = :ttl, patentImpactAverage = :impact',
      ExpressionAttributeValues: {
        ':patents': patents,
        ':verifiedAt': new Date().toISOString(),
        ':ttl': Math.floor(Date.now() / 1000) + 60 * 60 * 24,
        ':impact': Math.round(
          patents.reduce((acc, item) => acc + (item.impactScore ?? 0), 0) /
            Math.max(1, patents.length),
        ),
      },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
}

async function handleApi(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const request = normalizeRequest(event);
    const patents = await generatePatentSummaries(request);
    await upsertCache(request, patents);
    const response: PatentResponse = {
      section: request.section,
      timePeriod: request.timePeriod,
      patents,
      generatedAt: new Date().toISOString(),
    };
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Failed to aggregate patents', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Unable to aggregate patent insights' }),
    };
  }
}

export const handler = async (
  event: APIGatewayProxyEventV2 | PatentRequest,
): Promise<APIGatewayProxyResultV2 | PatentResponse> => {
  if (isApiGatewayEvent(event)) {
    return handleApi(event);
  }
  const request = normalizeRequest(event);
  const patents = await generatePatentSummaries(request);
  await upsertCache(request, patents);
  return {
    section: request.section,
    timePeriod: request.timePeriod,
    patents,
    generatedAt: new Date().toISOString(),
  };
};

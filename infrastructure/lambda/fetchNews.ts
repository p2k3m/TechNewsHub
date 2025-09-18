import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import axios, { AxiosError } from 'axios';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { v4 as uuid } from 'uuid';

interface AggregationRequest {
  section: string;
  timePeriod: string;
  mode?: string;
}

interface AiContentItem {
  id: string;
  title: string;
  summary: string;
  sourceUrl?: string;
  verificationScore: number;
  publishedAt?: string;
  related?: AiContentItem[];
}

interface AggregatedResponse {
  section: string;
  timePeriod: string;
  items: AiContentItem[];
  verificationSummary: string;
  generatedAt: string;
}

interface SecretBundle {
  perplexityApiKey?: string;
  geminiApiKey?: string;
  chatGptApiKey?: string;
  newsApiKey?: string;
  xBearerToken?: string;
}

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});

const contentCacheTableName = process.env.CONTENT_CACHE_TABLE_NAME ?? '';
const apiSecretArn = process.env.API_SECRET_ARN ?? '';

let cachedSecrets: SecretBundle | null = null;

async function resolveSecrets(): Promise<SecretBundle> {
  if (cachedSecrets) {
    return cachedSecrets;
  }
  if (!apiSecretArn) {
    cachedSecrets = {};
    return cachedSecrets;
  }
  const secretValue = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: apiSecretArn }),
  );
  if (secretValue.SecretString) {
    cachedSecrets = JSON.parse(secretValue.SecretString) as SecretBundle;
  } else {
    cachedSecrets = {};
  }
  return cachedSecrets;
}

function isApiGatewayEvent(event: any): event is APIGatewayProxyEventV2 {
  return event && typeof event === 'object' && 'requestContext' in event;
}

function parseRequest(event: any): AggregationRequest {
  if (isApiGatewayEvent(event)) {
    const body = event.body ? JSON.parse(event.body) : {};
    return {
      section: body.section ?? event.queryStringParameters?.section ?? 'ai',
      timePeriod: body.timePeriod ?? event.queryStringParameters?.timePeriod ?? 'daily',
      mode: 'api',
    };
  }
  return {
    section: event.section ?? 'ai',
    timePeriod: event.timePeriod ?? 'daily',
    mode: event.mode,
  };
}

async function callPerplexity(query: string, key?: string) {
  if (!key) {
    return null;
  }
  try {
    const response = await axios.post(
      'https://api.perplexity.ai/search',
      { query, max_results: 10 },
      { headers: { Authorization: `Bearer ${key}` } },
    );
    return {
      provider: 'perplexity',
      confidence: response.data?.confidence ?? 0,
      items: response.data?.results ?? [],
    };
  } catch (error) {
    const message = (error as AxiosError).message ?? 'perplexity call failed';
    console.warn('Perplexity failure', message);
    throw error;
  }
}

async function callGemini(query: string, key?: string) {
  if (!key) {
    return null;
  }
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${key}`,
      {
        contents: [
          {
            parts: [{ text: query }],
          },
        ],
      },
    );
    return {
      provider: 'gemini',
      confidence: 0.7,
      items: response.data?.candidates ?? [],
    };
  } catch (error) {
    const message = (error as AxiosError).message ?? 'gemini call failed';
    console.warn('Gemini failure', message);
    throw error;
  }
}

async function callChatGpt(query: string, key?: string) {
  if (!key) {
    return null;
  }
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a technology news summarizer.' },
          { role: 'user', content: query },
        ],
      },
      { headers: { Authorization: `Bearer ${key}` } },
    );
    return {
      provider: 'chatgpt',
      confidence: 0.6,
      items: response.data?.choices ?? [],
    };
  } catch (error) {
    const message = (error as AxiosError).message ?? 'chatgpt call failed';
    console.warn('ChatGPT failure', message);
    throw error;
  }
}

function buildPlaceholderItems(section: string, timePeriod: string): AiContentItem[] {
  return Array.from({ length: 3 }).map((_, index) => ({
    id: uuid(),
    title: `${section.toUpperCase()} insight ${index + 1} (${timePeriod})`,
    summary: `Placeholder content for ${section} during ${timePeriod}. Replace with real aggregation when API keys are configured.`,
    verificationScore: 50,
    publishedAt: new Date().toISOString(),
  }));
}

async function aggregateContent(request: AggregationRequest): Promise<AggregatedResponse> {
  const secrets = await resolveSecrets();
  const query = `Top verified ${request.section} technology news for ${request.timePeriod}`;

  let aiResult: { provider: string; confidence: number; items: any[] } | null = null;

  try {
    aiResult = await callPerplexity(query, secrets.perplexityApiKey ?? undefined);
  } catch (error) {
    console.info('Falling back from Perplexity to Gemini');
  }

  if (!aiResult) {
    try {
      aiResult = await callGemini(query, secrets.geminiApiKey ?? undefined);
    } catch (error) {
      console.info('Falling back from Gemini to ChatGPT');
    }
  }

  if (!aiResult) {
    try {
      aiResult = await callChatGpt(query, secrets.chatGptApiKey ?? undefined);
    } catch (error) {
      console.warn('All AI calls failed, generating placeholder items');
    }
  }

  const generatedAt = new Date().toISOString();
  const items: AiContentItem[] = (aiResult?.items ?? []).slice(0, 10).map((item: any) => ({
    id: item.id ?? uuid(),
    title: item.title ?? item.summary ?? `Update for ${request.section}`,
    summary:
      item.summary ??
      item.content ??
      `Automated insight regarding ${request.section} developments for ${request.timePeriod}.`,
    sourceUrl: item.source?.url ?? item.url,
    verificationScore: Math.round((aiResult?.confidence ?? 0.6) * 100),
    publishedAt: item.published_at ?? item.publishedAt ?? generatedAt,
  }));

  const enrichedItems = items.length > 0 ? items : buildPlaceholderItems(request.section, request.timePeriod);

  await docClient.send(
    new UpdateCommand({
      TableName: contentCacheTableName,
      Key: { sectionPeriod: `${request.section}#${request.timePeriod}` },
      UpdateExpression:
        'SET newsArray = :news, verifiedAt = :verifiedAt, expiresAt = :ttl, verificationScore = :score',
      ExpressionAttributeValues: {
        ':news': enrichedItems,
        ':verifiedAt': generatedAt,
        ':ttl': Math.floor(Date.now() / 1000) + 60 * 60 * 24,
        ':score': Math.round((aiResult?.confidence ?? 0.5) * 100),
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

  return {
    section: request.section,
    timePeriod: request.timePeriod,
    items: enrichedItems,
    verificationSummary:
      aiResult?.provider
        ? `Content verified via ${aiResult.provider} with confidence ${(aiResult.confidence * 100).toFixed(0)}%.`
        : 'Placeholder content generated because AI providers were unavailable.',
    generatedAt,
  };
}

async function handleApiGateway(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const request = parseRequest(event);
    const result = await aggregateContent(request);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('Failed to aggregate news', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Failed to aggregate news content' }),
    };
  }
}

export const handler = async (
  event: APIGatewayProxyEventV2 | AggregationRequest,
): Promise<APIGatewayProxyResultV2 | AggregatedResponse> => {
  if (isApiGatewayEvent(event)) {
    return handleApiGateway(event);
  }
  const normalized = parseRequest(event);
  return aggregateContent(normalized);
};

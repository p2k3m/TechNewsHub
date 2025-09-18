import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import axios, { AxiosError } from 'axios';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { v4 as uuid } from 'uuid';

interface SearchRequest {
  query: string;
  section?: string;
  limit?: number;
}

interface SearchResultItem {
  id: string;
  headline: string;
  summary: string;
  source?: string;
  url?: string;
  verificationScore: number;
}

interface SearchResponse {
  query: string;
  section?: string;
  results: SearchResultItem[];
  generatedAt: string;
  provider?: string;
}

interface SecretBundle {
  perplexityApiKey?: string;
  geminiApiKey?: string;
  chatGptApiKey?: string;
}

const secretsClient = new SecretsManagerClient({});
const apiSecretArn = process.env.API_SECRET_ARN ?? '';

let cachedSecrets: SecretBundle | null = null;

async function loadSecrets(): Promise<SecretBundle> {
  if (cachedSecrets) {
    return cachedSecrets;
  }
  if (!apiSecretArn) {
    cachedSecrets = {};
    return cachedSecrets;
  }
  const secret = await secretsClient.send(new GetSecretValueCommand({ SecretId: apiSecretArn }));
  cachedSecrets = secret.SecretString ? (JSON.parse(secret.SecretString) as SecretBundle) : {};
  return cachedSecrets;
}

function parseRequest(event: APIGatewayProxyEventV2): SearchRequest {
  if (!event.body) {
    return { query: 'latest ai breakthroughs', limit: 10 };
  }
  try {
    const body = JSON.parse(event.body);
    return {
      query: body.query ?? 'latest ai breakthroughs',
      section: body.section,
      limit: body.limit ?? 10,
    };
  } catch (error) {
    console.warn('Unable to parse search payload', error);
    return { query: 'technology news', limit: 10 };
  }
}

async function callPerplexity(query: string, apiKey?: string) {
  if (!apiKey) {
    return null;
  }
  try {
    const response = await axios.post(
      'https://api.perplexity.ai/search',
      { query, max_results: 10 },
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    return { provider: 'perplexity', confidence: response.data?.confidence ?? 0.7, items: response.data?.results ?? [] };
  } catch (error) {
    const message = (error as AxiosError).message ?? 'perplexity search error';
    console.error('Perplexity search failure', message);
    return null;
  }
}

async function callGemini(query: string, apiKey?: string) {
  if (!apiKey) {
    return null;
  }
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            parts: [{ text: query }],
          },
        ],
      },
    );
    return { provider: 'gemini', confidence: 0.6, items: response.data?.candidates ?? [] };
  } catch (error) {
    const message = (error as AxiosError).message ?? 'gemini search error';
    console.error('Gemini search failure', message);
    return null;
  }
}

async function callChatGpt(query: string, apiKey?: string) {
  if (!apiKey) {
    return null;
  }
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Provide concise, factual answers to technology news search queries.' },
          { role: 'user', content: query },
        ],
      },
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    return { provider: 'chatgpt', confidence: 0.55, items: response.data?.choices ?? [] };
  } catch (error) {
    const message = (error as AxiosError).message ?? 'chatgpt search error';
    console.error('ChatGPT search failure', message);
    return null;
  }
}

function formatResults(raw: any[], confidence: number, limit: number): SearchResultItem[] {
  return raw.slice(0, limit).map((item: any) => ({
    id: item.id ?? uuid(),
    headline: item.title ?? item.summary ?? item.text ?? 'Technology insight',
    summary:
      item.summary ??
      item.content ??
      item.text ??
      'AI generated placeholder summary pending integration with upstream providers.',
    source: item.source?.name ?? item.source ?? 'aggregated',
    url: item.source?.url ?? item.url,
    verificationScore: Math.round((confidence || 0.5) * 100),
  }));
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const request = parseRequest(event);
  const secrets = await loadSecrets();

  const enrichedQuery = `${request.query} ${request.section ? `focused on ${request.section}` : ''}`.trim();

  const providers = [
    await callPerplexity(enrichedQuery, secrets.perplexityApiKey),
    await callGemini(enrichedQuery, secrets.geminiApiKey),
    await callChatGpt(enrichedQuery, secrets.chatGptApiKey),
  ].filter((result) => result !== null) as Array<{ provider: string; confidence: number; items: any[] }>;

  const selected = providers.find((provider) => provider.items.length > 0) ?? providers[0] ?? null;

  const results = selected
    ? formatResults(selected.items, selected.confidence, request.limit ?? 10)
    : formatResults([], 0.5, request.limit ?? 10);

  if (results.length === 0) {
    results.push(
      ...formatResults(
        [
          {
            title: 'Stay tuned for curated technology insights',
            summary: 'Configure API keys to enable live semantic search results for TechNewsHub.',
          },
        ],
        0.5,
        1,
      ),
    );
  }

  const response: SearchResponse = {
    query: request.query,
    section: request.section,
    results,
    generatedAt: new Date().toISOString(),
    provider: selected?.provider,
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

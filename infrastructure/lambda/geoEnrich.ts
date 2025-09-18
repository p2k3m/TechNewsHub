import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import axios from 'axios';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { UAParser } from 'ua-parser-js';
import { createHash } from 'crypto';

interface GeoPayload {
  lat?: number;
  lng?: number;
  sessionId?: string;
  userAgent?: string;
}

interface GeoResponse {
  date: string;
  day: string;
  location: string;
  weather: string;
  temperature: string;
}

interface SecretsShape {
  openWeatherApiKey?: string;
}

const parser = new UAParser();
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});

const tableName = process.env.ACCESS_LOGS_TABLE_NAME ?? '';
const secretArn = process.env.API_SECRET_ARN ?? '';

let cachedSecrets: SecretsShape | null = null;

async function getSecrets(): Promise<SecretsShape> {
  if (cachedSecrets) {
    return cachedSecrets;
  }
  if (!secretArn) {
    cachedSecrets = {};
    return cachedSecrets;
  }
  const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
  cachedSecrets = result.SecretString ? (JSON.parse(result.SecretString) as SecretsShape) : {};
  return cachedSecrets;
}

function parseBody(event: APIGatewayProxyEventV2): GeoPayload {
  if (!event.body) {
    return {};
  }
  try {
    return JSON.parse(event.body);
  } catch (error) {
    console.warn('Unable to parse geo payload', error);
    return {};
  }
}

async function fetchWeather(lat?: number, lng?: number): Promise<{ location: string; weather: string; temperature: string }> {
  const secrets = await getSecrets();
  const fallback = {
    location: 'Global',
    weather: 'Clear',
    temperature: '72°F',
  };
  if (!lat || !lng || !secrets.openWeatherApiKey) {
    return fallback;
  }
  try {
    const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
      params: {
        lat,
        lon: lng,
        units: 'imperial',
        appid: secrets.openWeatherApiKey,
      },
    });
    const weatherMain = response.data?.weather?.[0]?.main ?? 'Clear';
    const city = response.data?.name ?? 'Unknown city';
    const country = response.data?.sys?.country ?? '';
    const location = country ? `${city}, ${country}` : city;
    const temperature = `${Math.round(response.data?.main?.temp ?? 70)}°F`;
    return {
      location,
      weather: weatherMain,
      temperature,
    };
  } catch (error) {
    console.error('Failed to fetch OpenWeatherMap data', error);
    return fallback;
  }
}

async function storeAccessLog(event: APIGatewayProxyEventV2, payload: GeoPayload, location: string) {
  if (!tableName) {
    return;
  }
  const sessionId = payload.sessionId ?? cryptoRandomId();
  const timestamp = new Date().toISOString();
  const ttlSeconds = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
  const ip = event.requestContext?.http?.sourceIp ?? '0.0.0.0';
  const userAgent = payload.userAgent ?? event.headers['user-agent'] ?? 'unknown';
  parser.setUA(userAgent);
  const device = parser.getResult();
  const deviceLabel = [device.device.vendor, device.device.model, device.browser.name]
    .filter(Boolean)
    .join(' ');

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        sessionId,
        ttl: ttlSeconds,
        timestamp,
        dateBucket: timestamp.slice(0, 10),
        ipHash: createHash('sha256').update(ip).digest('hex'),
        geo: location,
        device: deviceLabel || 'unknown',
        userAgent,
        path: event.rawPath ?? '/',
      },
    }),
  );
}

function cryptoRandomId(): string {
  return createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 32);
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const payload = parseBody(event);
  const weather = await fetchWeather(payload.lat, payload.lng);

  await storeAccessLog(event, payload, weather.location);

  const now = new Date();
  const response: GeoResponse = {
    date: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    day: now.toLocaleDateString('en-US', { weekday: 'long' }),
    location: weather.location,
    weather: weather.weather,
    temperature: weather.temperature,
  };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(response),
  };
};

# TechNewsHub Architecture Overview

## 1. Vision
TechNewsHub is conceived as a production-grade, serverless technology news aggregation platform tailored for advanced enthusiasts. The system blends real-time personalization, rigorous AI-assisted content verification, and resilient AWS-native infrastructure. This document captures an actionable blueprint that engineers can execute to deliver the complete experience described in the product specification.

## 2. High-Level System Diagram
```
Users -> CloudFront (S3 static site) -> React SPA
  |                                   |
  |                                   v
  |                              API Gateway (REST)
  |                                   |
  |                 +-----------------+------------------+
  |                 |                                    |
  v                 v                                    v
API Gateway (WebSocket)                   Cognito Hosted UI (Google IdP)
  |                 |                                    |
  v                 v                                    v
Lambda@Edge (Geo Fallback)    Lambda Functions (Node.js 20 runtime)  <- Secrets Manager
                        |        |        |         |         |
                        |        |        |         |         +--> SNS Alerts / CloudWatch Alarms
                        |        |        |         |
                        |        |        |         +--> EventBridge (cron 00:00 UTC)
                        |        |        |
                        |        |        +--> Step Functions (daily orchestration)
                        |        |
                        |        +--> DynamoDB (AccessLogs, UserProfiles, ContentCache)
                        |
                        +--> External APIs (Perplexity, Gemini, ChatGPT, NewsAPI, X/Twitter, USPTO, OpenWeatherMap)
```

## 3. Component Responsibilities

### 3.1 Frontend (React 18 + TypeScript)
- **Routing & Layout**: React Router for `/`, `/section/:id`, `/archive/:section/:period`.
- **Theming**: Material UI 5 with system preference detection and manual toggle for light/dark.
- **State & Data**: TanStack Query for API data caching, WebSocket subscription to refresh channel, Zustand store for UI preferences and session metadata.
- **Personalization Banner**:
  - On mount, request browser geolocation.
  - If granted, call `POST /geo-enrich` with coordinates, session UUID, hashed IP (provided by backend header injection), and user-agent.
  - If denied, call `POST /geo-enrich` without coordinates to trigger IP-based lookup.
  - Display formatted date, weekday, location, temperature, weather summary, and optionally the authenticated user name.
- **Authentication**:
  - Google Sign-In button triggers Cognito hosted domain `/oauth2/authorize`.
  - After redirect, the SPA reads JWT cookie, calls `/profile/me` to fetch display name, and updates banner with `Welcome, {name}`.
- **Content Panels**:
  - Homepage shows monthly curated cards per section with daily spotlight carousel.
  - Section view offers toggle chips for yearly (2020–present), monthly, weekly, daily filters.
  - News items render verification score badge, summary, citations, and metrics.
  - Deep dive modal lazy-loads hierarchical related content from `/content/{section}/{period}/{id}?depth=n`.
  - Patent carousel renders timeline with slider and AI-generated impact score.
- **Real-time Refresh**:
  - On initial load subscribe to WebSocket channel with sessionId.
  - Display toast when `refresh` event arrives (daily refresh).
- **Accessibility**: Use semantic markup, focus management for modals, aria labels, color contrast adherence.
- **PWA Enhancements**: Service worker caching static assets and fallback offline page.

### 3.2 API Gateway Layers
- **REST API**: `/geo-enrich`, `/profile/me`, `/content`, `/search`, `/recommendations`.
- **WebSocket API**: `/connect` -> register session; `/disconnect` -> cleanup; `/refresh` -> server push.
- **Security**: Lambda authorizer verifying Cognito JWT for authenticated endpoints; API keys for rate limiting.

### 3.3 Lambda Functions
- `geoEnrich`: Accepts location payload, fetches weather & locale, logs access.
- `profileMe`: Reads Cognito identity from JWT, fetches user profile from DynamoDB.
- `trackSession`: Invoked via API Gateway integration for `/connect` to insert WebSocket connection mapping table.
- `fetchNews`: Aggregates news items per section/time period with AI fallback.
- `fetchPatents`: Dedicated patent pipeline to reduce coupling.
- `relatedContent`: For deep dive expansions.
- `searchHandler`: Handles natural language search with embeddings.
- `recommendationEngine`: Utilizes session history and collaborative filtering heuristics.
- `authCallback`: Cognito post-confirmation Lambda to persist user profile and prompt for display name.
- `dailyRefresh`: EventBridge triggered orchestrator using Step Functions map state to call `fetchNews`/`fetchPatents` for each combination.
- Shared utility layers: `ai-clients`, `news-sources`, `patent-sources`, `dynamo-layer`, `logger` packaged as Lambda Layers to avoid duplication.

### 3.4 Data Stores
- **DynamoDB Tables**:
  - `AccessLogs` (PK: `sessionId`, SK: `timestamp`). Attributes: `ipHash`, `userAgent`, `device`, `geo`, `weather`, `userEmail?`, `path`, TTL (7 days). GSI1: `geo#device` for analytics; GSI2: `userEmail` for user-specific queries.
  - `UserProfiles` (PK: `email`). Attributes: `displayName`, `createdAt`, `updatedAt`, `preferences`, `isBetaTester`.
  - `ContentCache` (PK: `section#period`, SK: `type` = `news|patents`). Attributes: `items`, `verifiedAt`, `generatedAt`, TTL for auto-expiration (2 days) though refreshed daily.
  - `WebSocketSessions` (PK: `connectionId`). Attributes: `sessionId`, `lastSeen`.
- **S3 Buckets**: `news-artifacts` for caching raw API responses, `frontend-bucket` for static site, `ai-prompts` for prompt templates.

### 3.5 External Integrations
- **Perplexity API**: Primary research aggregator.
- **Gemini API**: Secondary summarizer and fallback.
- **OpenAI ChatGPT**: Final verification and tone normalization.
- **NewsAPI / RSS**: Raw headlines.
- **X/Twitter**: Through custom semantic search Lambda or third-party API.
- **USPTO & Google Patents**: Patent data (REST or BigQuery export via AWS Lambda with HTTP).
- **OpenWeatherMap**: Weather enrichment.
- **Google OAuth**: Via Cognito Identity Provider configuration.

### 3.6 Observability
- CloudWatch dashboards summarizing latency, error rate, fallback usage.
- Structured JSON logging (pino) with correlation IDs (sessionId + requestId).
- X-Ray tracing across API Gateway, Lambdas, DynamoDB.
- SNS notifications for alarm thresholds (≥20% fallback failure, >5% API 5xx).
- S3 access logs + CloudFront real-time logs to Kinesis Firehose -> S3 -> Athena.

## 4. Infrastructure as Code
- AWS CDK v2 (TypeScript) project structure under `infra/` with stacks:
  - `NetworkingStack` (if VPC needed for outbound NAT to secure API calls).
  - `DataStack` for DynamoDB tables and Secrets Manager.
  - `AuthStack` for Cognito configuration and Google IdP metadata.
  - `ApiStack` for REST/WebSocket APIs and Lambda functions.
  - `FrontendStack` for S3 + CloudFront + ACM certificate.
  - `ObservabilityStack` for dashboards, alarms, and SNS.
- CI/CD uses `cdk synth` and `cdk deploy` with OIDC to AWS account. GitHub Actions secrets store `AWS_ACCOUNT_ID`, `AWS_REGION`, and API keys are referenced via SSM Parameter Store at deploy time.

## 5. Data Pipelines & AI Orchestration
1. **Source Aggregation**: For each section/time period, gather raw articles via NewsAPI, curated RSS, and social signals. Each fetch has retries and caching.
2. **AI Cascade**:
   - Compose prompt to Perplexity describing target section/time window and requiring citations.
   - Evaluate confidence; if <0.8 or API fails, pivot to Gemini with summarization directive; else proceed to verification.
   - ChatGPT finalizes summary, ensures neutral tone, extracts metadata (source, URL, verification score) and calculates `engagementScore` using social metrics.
3. **Patent Pipeline**: Query USPTO/Google Patents for last 12 months, generate accessible summary, key claims, inventors, impact score via AI sentiment/regression model.
4. **Storage**: Persist aggregated results in `ContentCache`. Keep raw results in S3 for audit.
5. **Notification**: `dailyRefresh` orchestrator sends WebSocket message to active sessions.

## 6. Personalization & Tracking
- Session ID generated client-side (UUID v4) and stored in localStorage.
- Each page view triggers `POST /track` (handled by `geoEnrich` or dedicated `trackAccess` Lambda) storing hashed IP and device info.
- Recommendations query `AccessLogs` by session to infer interest clusters using heuristics (e.g., `AI` vs `Quantum`) and suggest cross-section cards.
- TTL ensures anonymous data purged after 7 days.

## 7. Security Considerations
- All API calls require HTTPS; CloudFront enforces TLS 1.3.
- Cognito JWT validation via Lambda authorizer; tokens stored in secure HttpOnly cookies with SameSite=Lax.
- Secrets Manager used for API keys; rotation Lambda scheduled quarterly.
- Input validation using `zod` in Lambda functions to guard payloads.
- IP hashing with salt stored in Secrets Manager.
- GDPR compliance with consent banner (Cookie/Tracking) on first visit.

## 8. Deployment Workflow (GitHub Actions)
1. `lint-and-test`: run ESLint, unit tests (Jest), backend tests (Vitest or Jest), type checking (tsc), infrastructure assertions (`npm run cdk:test`).
2. `build`: Vite build -> upload artifact.
3. `deploy-infra`: `cdk synth` + `cdk deploy --require-approval never` using AWS OIDC role.
4. `deploy-frontend`: Sync built assets to S3 and create CloudFront invalidation.
5. `post-deploy`: Smoke test by curling `/geo-enrich` mock, verifying 200; run Lighthouse CI for PWA.

## 9. Testing Strategy
- **Unit**: Lambda modules with mocked external APIs.
- **Integration**: Localstack-based tests for DynamoDB and API Gateway via `aws-sdk-client-mock`.
- **E2E**: Playwright suite covering login flow, geolocation fallback, deep dive navigation.
- **Performance**: Artillery scenarios to ensure <1.5s latency under load.

## 10. Roadmap Enhancements
- Multi-region DynamoDB Global Tables for resilience.
- Fine-grained personalization (user topics) stored in `UserProfiles.preferences`.
- Additional sections beyond ML/AI/IoT/Quantum.
- Monetization experiments (sponsored insights) with strict labeling.

## 11. Summary
This architecture document translates the expansive product requirements into a structured, AWS-native solution. It emphasizes modular Lambda services, robust AI orchestration, and a polished React frontend. Engineers can use this blueprint to implement the platform iteratively while maintaining production readiness, observability, and compliance.

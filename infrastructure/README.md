# TechNewsHub Infrastructure

This package contains an AWS CDK v2 stack that provisions the core serverless infrastructure for the TechNewsHub platform. The stack includes storage, APIs, authentication, serverless compute, scheduled automation, monitoring dashboards, and supporting resources described in the product specification.

## Features

- **Static delivery** via an S3 bucket fronted by a CloudFront distribution with HTTPS enforcement.
- **Data persistence** in DynamoDB tables for access logs, user profiles, and cached content.
- **Secrets management** for all external API keys (Perplexity, Gemini, ChatGPT, OpenWeatherMap, NewsAPI, X/Twitter, and Google OAuth credentials).
- **Authentication** through an Amazon Cognito user pool with a Google identity provider and OAuth client configuration.
- **Compute layer** of Lambda functions implemented in TypeScript for news aggregation, patent summarization, geolocation enrichment, authentication callbacks, and daily refresh orchestration.
- **API surfaces** including a REST API Gateway, a WebSocket API for live notifications, and an EventBridge rule that triggers refresh workflows.
- **Content refresh automation** using AWS Step Functions to iterate through all sections and time periods, invoking the aggregation Lambdas in sequence.
- **Observability** with CloudWatch metrics, alarms, and dashboards covering API, Lambda, DynamoDB, and CloudFront health.

## Project Structure

```text
infrastructure/
├── bin/technews-hub.ts         # CDK app entrypoint
├── lib/technews-hub-stack.ts   # Primary infrastructure stack definition
├── lambda/                     # TypeScript Lambda handlers bundled via esbuild
├── package.json                # Dependencies and scripts
├── tsconfig.json               # TypeScript compiler configuration
└── README.md                   # (this file)
```

## Getting Started

1. **Install dependencies**

   ```bash
   cd infrastructure
   npm install
   ```

2. **Synthesize the CloudFormation template**

   ```bash
   npm run synth
   ```

3. **Deploy** (requires AWS credentials and CDK bootstrap)

   ```bash
   npm run deploy
   ```

   The deployment expects the generated Secrets Manager secret to be populated with valid API keys and Google OAuth client credentials before running the live workloads.

4. **Destroy** the stack when finished

   ```bash
   npm run destroy
   ```

## Lambda Runtime Expectations

Each Lambda handler gracefully degrades when required secrets are absent by returning placeholder content. Once the secrets are configured, the functions will execute the full AI-orchestrated aggregation workflows, persist results to DynamoDB, and notify WebSocket clients.

## Security & Operations

- DynamoDB entries for anonymous access logs are written with a 7-day TTL to honour privacy commitments.
- API Gateway, Lambda, and DynamoDB are instrumented with CloudWatch alarms and consolidated dashboards.
- The EventBridge rule triggers a nightly refresh at midnight UTC, invoking the Step Functions state machine via the `dailyRefresh` Lambda. WebSocket broadcasts can be provided with connection IDs through the EventBridge event payload.

For additional architectural context, refer to `../docs/ARCHITECTURE.md`.

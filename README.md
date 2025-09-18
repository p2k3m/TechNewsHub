# TechNewsHub

TechNewsHub is a production-ready, serverless technology news aggregation platform. It blends AI-assisted research with human-readable summaries to deliver curated insights across Machine Learning, Artificial Intelligence, Internet of Things, and Quantum Computing. The system personalizes the experience with location-aware weather updates, optional Google authentication, and real-time refresh notifications for newly ingested content.

## Table of Contents
- [Key Features](#key-features)
- [Architecture Overview](#architecture-overview)
- [Repository Structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Deployment](#deployment)
  - [GitHub Secrets](#github-secrets)
  - [AWS Secrets Manager Values](#aws-secrets-manager-values)
  - [Manual CDK Deployment](#manual-cdk-deployment)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Further Reading](#further-reading)

## Key Features
- **Personalized homepage banner** that greets users with the current date, weekday, location, and live weather conditions, with graceful fallbacks when geolocation permissions are denied.
- **Section-specific content hubs** for ML, AI, IoT, and Quantum Computing that surface top news by daily, weekly, monthly, and yearly windows, complete with verification scores and citation metadata.
- **Patent intelligence module** providing the ten most recent filings per section, distilled into accessible 200-word summaries with inventor and impact details.
- **Deep-dive navigation experience** using nested accordions and modal flows to present related coverage up to five levels deep.
- **AI-orchestrated aggregation pipeline** that chains Perplexity, Gemini, and ChatGPT with confidence-based fallbacks to ensure high-quality, bias-aware summaries.
- **Recommendation engine and omniscient search** that use stored session metadata to suggest cross-sectional topics and resolve natural language queries.
- **Daily automation** triggered at 00:00 UTC to refresh news and patents, invalidate caches, and broadcast WebSocket notifications to active sessions.
- **AWS-native observability and compliance** including CloudWatch dashboards, alarms, encrypted storage, and anonymized access logging with TTL policies.

## Architecture Overview
TechNewsHub is implemented as a fully serverless workload on AWS:
- **Frontend:** React 18 + TypeScript single-page application served from Amazon S3 via CloudFront, using Material UI for theming, React Router for navigation, and TanStack Query for data synchronization.
- **APIs:** Amazon API Gateway (REST and WebSocket) routes traffic to Node.js 20 Lambda functions for personalization, aggregation, search, and recommendations.
- **Automation:** EventBridge cron rule triggers a Step Functions map workflow orchestrated by the `dailyRefresh` Lambda to regenerate content daily.
- **Stateful services:** DynamoDB tables store access logs, cached content, user profiles, and WebSocket sessions. Secrets Manager houses third-party API keys.
- **Authentication:** Amazon Cognito user pool integrated with a Google OAuth 2.0 identity provider handles optional login and profile persistence.

A deeper architectural narrative is available in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository Structure
```
├── docs/                 # High-level architecture and design documentation
├── frontend/             # React 18 + TypeScript SPA (Vite build)
├── infrastructure/       # AWS CDK v2 stack and Lambda sources
└── .github/workflows/    # GitHub Actions automation
```

## Prerequisites
Before building or deploying TechNewsHub you will need:
- An AWS account with permissions to create IAM roles, S3 buckets, CloudFront distributions, DynamoDB tables, Cognito user pools, API Gateway endpoints, Lambda functions, and Step Functions state machines.
- GitHub repository with Actions enabled and permission to configure repository secrets/variables.
- Node.js 20.x and npm installed locally for optional manual builds (`nvm install 20`).
- AWS CLI v2 configured with administrator (or sufficiently scoped) credentials for bootstrapping and inspection.
- AWS CDK v2 globally installed (`npm install -g aws-cdk`) if you intend to synthesize or deploy outside of GitHub Actions.

## Local Setup
1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/<your-org>/TechNewsHub.git
   cd TechNewsHub
   npm install --prefix infrastructure
   npm install --prefix frontend
   ```
2. (Optional) Bootstrap your AWS environment for CDK deployments:
   ```bash
   cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
   ```
3. Run local type checks:
   ```bash
   npm run lint --prefix infrastructure
   npm run lint --prefix frontend
   ```

> ℹ️ The Lambda functions call live third-party APIs. Without populating Secrets Manager (see below) they fall back to placeholder content intended for development.

## Deployment
GitHub Actions automates end-to-end deployment via `.github/workflows/deploy.yml`. The workflow:
1. Validates that all required repository secrets are present (fails fast if any are missing).
2. Installs infrastructure and frontend dependencies.
3. Runs TypeScript lint checks and builds both projects.
4. Configures AWS credentials using GitHub OIDC and the provided IAM role.
5. Synthesizes and deploys the CDK stack.
6. Uploads the built SPA to the provisioned S3 bucket and invalidates the CloudFront distribution.
7. Executes placeholder smoke tests (customize when APIs are public).

### GitHub Secrets
The workflow halts before deploying if any of the following secrets are absent. Configure them via **Repository Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Purpose | How to obtain |
| --- | --- | --- |
| `AWS_OIDC_ROLE_ARN` | IAM role assumed by GitHub Actions for AWS deployments. | Create an IAM role that trusts GitHub's OIDC provider following [AWS documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html) and grant it permissions to deploy the TechNewsHub stack. Copy the role ARN. |
| `AWS_ACCOUNT_ID` | Identifies the AWS account targeted by CDK. | Log in to the AWS console and copy the 12-digit account ID (top-right corner under **Support**). |
| `SITE_BUCKET_NAME` | S3 bucket receiving the built frontend assets. | After the first CDK deployment, view the CloudFormation stack outputs (or run `aws cloudformation describe-stacks`) to capture the generated static site bucket name. Store it verbatim. |
| `CLOUDFRONT_DISTRIBUTION_ID` | Enables cache invalidations after each deploy. | Retrieve the distribution ID from the CloudFront console or via `aws cloudfront list-distributions`, then copy the `Id` that matches the TechNewsHub distribution. |

The workflow writes a summary listing any missing secrets and exits with an error to ensure misconfiguration is detected immediately.

> ✅ Consider defining a repository variable `AWS_REGION` to override the default `us-east-1` deployment region if required.

### AWS Secrets Manager Values
The CDK stack provisions a `Secret` containing placeholders for all third-party API keys. Update the secret after deployment so runtime Lambdas can reach external providers:

| Secret field | Description |
| --- | --- |
| `perplexityApiKey` | API key for Perplexity's research endpoint. |
| `geminiApiKey` | Google Gemini Generative Language API key. |
| `chatGptApiKey` | OpenAI API key used for verification summaries. |
| `openWeatherApiKey` | OpenWeatherMap key for weather enrichment. |
| `newsApiKey` | NewsAPI key for supplemental headlines. |
| `xBearerToken` | Bearer token for X/Twitter semantic search (optional but recommended). |
| `googleClientId` / `googleClientSecret` | Google OAuth credentials linked to the Cognito identity provider. |

You can set these values from the AWS console or with the CLI, for example:
```bash
aws secretsmanager update-secret \
  --secret-id <ApiSecretsArn> \
  --secret-string '"{"perplexityApiKey":"...","geminiApiKey":"..."}"
```
Ensure the Google credentials match the OAuth client configured in the Google Cloud Console.

### Manual CDK Deployment
If you prefer to deploy from your workstation:
1. Export AWS credentials with permissions to manage the required resources.
2. From the `infrastructure/` directory run:
   ```bash
   npm run build
   npm run synth
   npm run deploy -- --require-approval never
   ```
3. After deployment finishes, capture the CloudFormation outputs for the distribution domain, REST API URL, and WebSocket endpoint. Update your GitHub secrets with the static site bucket and distribution ID before triggering CI/CD deployments.
4. Deploy the frontend manually if desired:
   ```bash
   npm run build --prefix frontend
   aws s3 sync frontend/dist s3://<SITE_BUCKET_NAME> --delete
   aws cloudfront create-invalidation --distribution-id <CLOUDFRONT_DISTRIBUTION_ID> --paths '/*'
   ```

## Testing
The workflow currently runs TypeScript linting for both infrastructure and frontend packages. Extend it with unit, integration, and end-to-end tests as features mature. Locally you can execute:
```bash
npm run lint --prefix infrastructure
npm run lint --prefix frontend
```
Future enhancements should wire Jest/Vitest for Lambdas and Playwright or Cypress for frontend flows.

## Troubleshooting
- **Workflow fails with “Missing secret”**: Follow the guidance in the workflow summary and this README to populate the absent value, then re-run the workflow.
- **Frontend deploy succeeds but site shows placeholders**: Verify that the Secrets Manager entry contains valid API keys and that scheduled refresh has run; otherwise Lambdas will emit placeholder content.
- **Google login fails**: Ensure the Cognito callback/logout URLs match the deployed CloudFront domain and that the Google OAuth client is authorized for those URLs.

## Further Reading
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a comprehensive technical deep dive.
- [AWS CDK v2 documentation](https://docs.aws.amazon.com/cdk/v2/guide/home.html) for customizing the infrastructure stack.
- [React Query documentation](https://tanstack.com/query/latest) for extending client-side data fetching patterns.

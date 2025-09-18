#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TechNewsHubStack } from '../lib/technews-hub-stack';

const app = new cdk.App();
new TechNewsHubStack(app, 'TechNewsHubStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});

#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AppStack } from './lib/app-stack';
import * as dotenv from 'dotenv';
dotenv.config();

const app = new cdk.App();

new AppStack(app, process.env.APP_NAME + '-app-stack', {
  appName: process.env.APP_NAME || '',
  account: process.env.DEV_ACCOUNT || '',
  env: {
    account: process.env.DEV_ACCOUNT,
    region: process.env.DEV_REGION,
  },
});

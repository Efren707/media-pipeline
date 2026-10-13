#!/usr/bin/env node
import "source-map-support/register";

import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { config as loadDotEnv } from "dotenv";
import { MediaPipelineStack } from "../lib/media-pipeline-stack";

loadDotEnv({ path: path.resolve(__dirname, "../../.env") });

const owner = (process.env.MP_OWNER ?? "").trim().toLowerCase();
if (!/^[a-z0-9][a-z0-9-]{1,19}$/.test(owner)) {
  throw new Error(
    "Set MP_OWNER in the repository .env file to 2-20 lowercase letters, numbers, or hyphens."
  );
}

const account = process.env.CDK_DEFAULT_ACCOUNT;
if (!account) {
  throw new Error(
    "CDK_DEFAULT_ACCOUNT is missing. Start the AWS Academy lab, load its temporary credentials, and run aws sts get-caller-identity."
  );
}

const region = process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? "us-east-1";
const corsOrigins = (process.env.MP_CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = new cdk.App();
new MediaPipelineStack(app, `MediaPipeline-${owner}`, {
  env: { account, region },
  owner,
  corsOrigins,
  synthesizer: new cdk.CliCredentialsStackSynthesizer({
    fileAssetsBucketName: `media-pipeline-cdk-assets-${account}`,
    bucketPrefix: "assets/"
  })
});

app.synth();

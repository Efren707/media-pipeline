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

// Phase 7: RDS only when asked for, e.g. `cdk deploy -c withDb=true -c dbClientCidr=1.2.3.4/32`.
// Phase 10 (D22): `-c withServer=true -c sshCidr=1.2.3.4/32` adds the demo EC2. With both, the
// database is private to the server and dbClientCidr is not needed.
const withDb = String(app.node.tryGetContext("withDb") ?? "false") === "true";
const withServer = String(app.node.tryGetContext("withServer") ?? "false") === "true";
const dbClientCidr = app.node.tryGetContext("dbClientCidr");
const sshCidr = app.node.tryGetContext("sshCidr");
if (withDb && !withServer && !dbClientCidr) {
  throw new Error("withDb=true needs -c dbClientCidr=<your public IPv4>/32.");
}
if (withServer && !sshCidr) {
  throw new Error("withServer=true needs -c sshCidr=<your public IPv4>/32.");
}

// The demo is browsed through `ssh -L 8088:localhost:80` (D22), and the browser PUTs uploads
// straight to S3, so the bucket must allow that origin while the server exists.
const DEMO_TUNNEL_ORIGIN = "http://localhost:8088";
if (withServer && !corsOrigins.includes(DEMO_TUNNEL_ORIGIN)) {
  corsOrigins.push(DEMO_TUNNEL_ORIGIN);
}

new MediaPipelineStack(app, `MediaPipeline-${owner}`, {
  env: { account, region },
  owner,
  corsOrigins,
  database: withDb
    ? { clientCidr: dbClientCidr === undefined ? undefined : String(dbClientCidr) }
    : undefined,
  server: withServer ? { sshCidr: String(sshCidr) } : undefined,
  synthesizer: new cdk.CliCredentialsStackSynthesizer({
    fileAssetsBucketName: `media-pipeline-cdk-assets-${account}`,
    bucketPrefix: "assets/"
  })
});

app.synth();

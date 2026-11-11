import * as path from "node:path";
import {
  CfnOutput,
  CfnParameter,
  Duration,
  Fn,
  RemovalPolicy,
  Size,
  Stack,
  StackProps,
  Tags,
  Validations
} from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

/** Opt-in PostgreSQL (Phase 7). Leave it out and the stack stays S3 + Lambda only. */
export interface DatabaseProps {
  /**
   * The only laptop address allowed to reach port 5432, as a single IPv4 /32. Required without
   * `server`; with `server` the database is private and reachable only from the instance (D22).
   */
  readonly clientCidr?: string;
}

/** Opt-in demo host (Phase 10, D22): one t3.micro reached only over SSH. */
export interface ServerProps {
  /** The only address allowed to reach port 22, as a single IPv4 /32. */
  readonly sshCidr: string;
  /**
   * Public HTTPS URL for classmates (D23). The ID of the AWS-managed prefix list
   * `com.amazonaws.global.cloudfront.origin-facing` in this region; when set, a CloudFront
   * distribution fronts the server and port 80 opens only to that list.
   */
  readonly cloudfrontPrefixListId?: string;
}

export interface MediaPipelineStackProps extends StackProps {
  readonly owner: string;
  readonly corsOrigins: string[];
  readonly database?: DatabaseProps;
  readonly server?: ServerProps;
}

/** Installs only runtimes. No secrets: user data is visible in the console and the template. */
const SERVER_USER_DATA = `#!/bin/bash
set -euo pipefail
dnf install -y java-21-amazon-corretto-headless nginx
id mp >/dev/null 2>&1 || useradd --system --home-dir /opt/media-pipeline --shell /sbin/nologin mp
install -d -o mp -g mp -m 0750 /opt/media-pipeline
install -d -m 0755 /usr/share/nginx/media-pipeline
systemctl enable nginx
`;

const PREFIX_LIST_ID = /^pl-[0-9a-f]{8,17}$/;

const SINGLE_IPV4_CIDR =
  /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)\/32$/;

export class MediaPipelineStack extends Stack {
  public readonly mediaBucketName: string;
  public readonly validateFunctionName: string;
  public readonly analyzeFunctionName: string;

  constructor(scope: Construct, id: string, props: MediaPipelineStackProps) {
    if (props.database && !props.server) {
      const cidr = props.database.clientCidr ?? "";
      if (!SINGLE_IPV4_CIDR.test(cidr)) {
        throw new Error(`dbClientCidr must be a single IPv4 address as /32, got "${cidr}".`);
      }
    }
    if (props.server && !SINGLE_IPV4_CIDR.test(props.server.sshCidr)) {
      throw new Error(
        `sshCidr must be a single IPv4 address as /32, got "${props.server.sshCidr}".`
      );
    }
    const prefixListId = props.server?.cloudfrontPrefixListId;
    if (prefixListId !== undefined && !PREFIX_LIST_ID.test(prefixListId)) {
      throw new Error(`cloudfrontPrefixListId must look like pl-0123abcd, got "${prefixListId}".`);
    }
    super(scope, id, props);

    const account = Stack.of(this).account;
    const prefix = `mp-${props.owner}`;
    this.mediaBucketName = `${prefix}-media-${account}`;
    this.validateFunctionName = `${prefix}-validate`;
    this.analyzeFunctionName = `${prefix}-analyze`;

    Tags.of(this).add("Project", "MediaPipeline");
    Tags.of(this).add("Owner", props.owner);
    Tags.of(this).add("ManagedBy", "AWS-CDK");

    const mediaBucket = new s3.CfnBucket(this, "MediaBucket", {
      bucketName: this.mediaBucketName,
      bucketEncryption: {
        serverSideEncryptionConfiguration: [
          {
            serverSideEncryptionByDefault: { sseAlgorithm: "AES256" }
          }
        ]
      },
      ownershipControls: {
        rules: [{ objectOwnership: "BucketOwnerEnforced" }]
      },
      publicAccessBlockConfiguration: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true
      },
      corsConfiguration: corsConfiguration(props.corsOrigins),
      lifecycleConfiguration: {
        rules: [
          {
            id: "AbortIncompleteMultipartUploads",
            status: "Enabled",
            abortIncompleteMultipartUpload: { daysAfterInitiation: 1 }
          },
          {
            id: "ExpireDemoData",
            status: "Enabled",
            expirationInDays: 30,
            prefix: "uploads/"
          },
          {
            id: "ExpireGeneratedArtifacts",
            status: "Enabled",
            expirationInDays: 30,
            prefix: "thumbnails/"
          },
          {
            id: "ExpireStageMessages",
            status: "Enabled",
            expirationInDays: 30,
            prefix: "stage/"
          },
          {
            id: "ExpireStatuses",
            status: "Enabled",
            expirationInDays: 30,
            prefix: "status/"
          },
          {
            id: "ExpireResults",
            status: "Enabled",
            expirationInDays: 30,
            prefix: "results/"
          }
        ]
      }
    });
    mediaBucket.applyRemovalPolicy(RemovalPolicy.DESTROY);

    new s3.CfnBucketPolicy(this, "RequireTlsBucketPolicy", {
      bucket: mediaBucket.ref,
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "DenyInsecureTransport",
            Effect: "Deny",
            Principal: "*",
            Action: "s3:*",
            Resource: [mediaBucket.attrArn, `${mediaBucket.attrArn}/*`],
            Condition: { Bool: { "aws:SecureTransport": "false" } }
          }
        ]
      }
    });

    const resultsTopic = new sns.CfnTopic(this, "ResultsTopic", {
      topicName: `${prefix}-results`
    });
    const resultsTopicPolicy = new sns.CfnTopicPolicy(this, "ResultsTopicPolicy", {
      topics: [resultsTopic.ref],
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "AllowMediaBucketPublish",
            Effect: "Allow",
            Principal: { Service: "s3.amazonaws.com" },
            Action: "sns:Publish",
            Resource: resultsTopic.ref,
            Condition: {
              ArnEquals: {
                "aws:SourceArn": `arn:${Stack.of(this).partition}:s3:::${this.mediaBucketName}`
              },
              StringEquals: { "aws:SourceAccount": account }
            }
          }
        ]
      }
    });

    const lambdaRole = iam.Role.fromRoleName(
      this,
      "ImportedLambdaRunRole",
      "lambda-run-role",
      { mutable: false }
    );

    const validateLogGroup = new logs.LogGroup(this, "ValidateLogGroup", {
      logGroupName: `/aws/lambda/${this.validateFunctionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const validateFunction = new lambda.Function(this, "ValidateFunction", {
      functionName: this.validateFunctionName,
      description: "Validates uploaded images, creates thumbnails, and writes S3 status objects.",
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.X86_64,
      code: lambda.Code.fromAsset(
        path.resolve(__dirname, "../../lambdas/validate/dist")
      ),
      handler: "handler.handler",
      role: lambdaRole,
      logGroup: validateLogGroup,
      memorySize: 1024,
      timeout: Duration.seconds(60),
      ephemeralStorageSize: Size.mebibytes(512),
      reservedConcurrentExecutions: 10,
      retryAttempts: 2,
      environment: {
        MEDIA_BUCKET_NAME: this.mediaBucketName,
        EXPECTED_BUCKET_OWNER: account,
        MAX_IMAGE_BYTES: "10485760",
        MAX_IMAGE_PIXELS: "25000000",
        THUMBNAIL_MAX_SIDE: "320"
      }
    });

    const allowS3Invoke = new lambda.CfnPermission(this, "AllowMediaBucketInvoke", {
      action: "lambda:InvokeFunction",
      functionName: validateFunction.functionName,
      principal: "s3.amazonaws.com",
      sourceAccount: account,
      sourceArn: `arn:${Stack.of(this).partition}:s3:::${this.mediaBucketName}`
    });

    const analyzeLogGroup = new logs.LogGroup(this, "AnalyzeLogGroup", {
      logGroupName: `/aws/lambda/${this.analyzeFunctionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const analyzeFunction = new lambda.Function(this, "AnalyzeFunction", {
      functionName: this.analyzeFunctionName,
      description: "Classifies validated images and writes labels, moderation and final status.",
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.X86_64,
      code: lambda.Code.fromAsset(
        path.resolve(__dirname, "../../lambdas/analyze/dist")
      ),
      handler: "handler.handler",
      role: lambdaRole,
      logGroup: analyzeLogGroup,
      memorySize: 3008,
      timeout: Duration.seconds(120),
      ephemeralStorageSize: Size.mebibytes(2048),
      reservedConcurrentExecutions: 5,
      retryAttempts: 2,
      environment: {
        MEDIA_BUCKET_NAME: this.mediaBucketName,
        EXPECTED_BUCKET_OWNER: account,
        MODEL_KEY: "models/squeezenet1.1-7.onnx",
        LABELS_KEY: "models/imagenet-labels.txt",
        MODEL_VERSION: "squeezenet1.1-7",
        MIN_LABEL_CONFIDENCE: "0.05",
        MODERATION_THRESHOLD: "0.20"
      }
    });

    const allowS3InvokeAnalyze = new lambda.CfnPermission(
      this,
      "AllowMediaBucketInvokeAnalyze",
      {
        action: "lambda:InvokeFunction",
        functionName: analyzeFunction.functionName,
        principal: "s3.amazonaws.com",
        sourceAccount: account,
        sourceArn: `arn:${Stack.of(this).partition}:s3:::${this.mediaBucketName}`
      }
    );

    mediaBucket.notificationConfiguration = {
      lambdaConfigurations: [
        {
          event: "s3:ObjectCreated:*",
          function: validateFunction.functionArn,
          filter: {
            s3Key: {
              rules: [{ name: "prefix", value: "uploads/" }]
            }
          }
        },
        {
          event: "s3:ObjectCreated:*",
          function: analyzeFunction.functionArn,
          filter: {
            s3Key: {
              rules: [{ name: "prefix", value: "stage/analyze/" }]
            }
          }
        }
      ],
      topicConfigurations: [
        {
          event: "s3:ObjectCreated:*",
          topic: resultsTopic.ref,
          filter: {
            s3Key: {
              rules: [{ name: "prefix", value: "results/" }]
            }
          }
        }
      ]
    };
    mediaBucket.addResourceDependency(allowS3Invoke);
    mediaBucket.addResourceDependency(allowS3InvokeAnalyze);
    mediaBucket.addResourceDependency(resultsTopicPolicy);

    new CfnOutput(this, "MediaBucketName", {
      value: mediaBucket.ref,
      description: "Private bucket used by the Media Pipeline"
    });
    new CfnOutput(this, "ValidateFunctionName", {
      value: validateFunction.functionName,
      description: "Validate-stage Lambda function"
    });
    new CfnOutput(this, "AnalyzeFunctionName", {
      value: analyzeFunction.functionName,
      description: "Analyze-stage Lambda function"
    });
    new CfnOutput(this, "ResultsTopicArn", {
      value: resultsTopic.ref,
      description: "SNS topic receiving completed result-object events"
    });

    const server = props.server ? this.addServer(prefix, props.server) : undefined;
    if (server && prefixListId) {
      const domainName = this.addPublicDistribution(prefix, server.instance);
      // The browser PUTs uploads straight to S3 from the public page, so allow that origin too.
      mediaBucket.corsConfiguration = corsConfiguration([
        ...props.corsOrigins,
        `https://${domainName}`
      ]);
    }
    if (props.database) {
      this.addDatabase(prefix, props.database, server?.securityGroup);
    }
  }

  /**
   * One t3.micro on Amazon Linux 2023 in the default VPC with the existing myS3Role instance
   * profile, so the backend gets S3 access without stored keys. Only SSH from one /32 is open;
   * the app is reached through an SSH tunnel (D22). With a CloudFront prefix list, port 80 also
   * opens to CloudFront only (D23). Returns the instance and its security group (for RDS ingress).
   */
  private addServer(
    prefix: string,
    server: ServerProps
  ): { instance: ec2.CfnInstance; securityGroup: ec2.CfnSecurityGroup } {
    const imageId = new CfnParameter(this, "ServerImageId", {
      type: "AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>",
      default: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64",
      description: "Amazon Linux 2023 AMI, resolved from the AWS public SSM parameter"
    });
    const keyName = new CfnParameter(this, "ServerKeyName", {
      type: "AWS::EC2::KeyPair::KeyName",
      default: "vockey",
      description: "Existing EC2 key pair for SSH (AWS Academy provides vockey)"
    });

    const securityGroup = new ec2.CfnSecurityGroup(this, "ServerSecurityGroup", {
      groupName: `${prefix}-server`,
      groupDescription: server.cloudfrontPrefixListId
        ? "SSH from one developer IP; HTTP from CloudFront only"
        : "SSH from one developer IP only; the app is reached through a tunnel",
      securityGroupIngress: [
        {
          ipProtocol: "tcp",
          fromPort: 22,
          toPort: 22,
          cidrIp: server.sshCidr,
          description: "Developer laptop (SSH tunnel)"
        },
        ...(server.cloudfrontPrefixListId
          ? [
              {
                ipProtocol: "tcp",
                fromPort: 80,
                toPort: 80,
                sourcePrefixListId: server.cloudfrontPrefixListId,
                description: "CloudFront origin-facing servers (D23)"
              }
            ]
          : [])
      ]
    });

    const instance = new ec2.CfnInstance(this, "Server", {
      instanceType: "t3.micro",
      imageId: imageId.valueAsString,
      keyName: keyName.valueAsString,
      iamInstanceProfile: "myS3Role",
      securityGroupIds: [securityGroup.attrGroupId],
      metadataOptions: { httpTokens: "required", httpPutResponseHopLimit: 1 },
      blockDeviceMappings: [
        {
          deviceName: "/dev/xvda",
          ebs: { volumeSize: 8, volumeType: "gp3", encrypted: true, deleteOnTermination: true }
        }
      ],
      userData: Fn.base64(SERVER_USER_DATA),
      tags: [{ key: "Name", value: `${prefix}-server` }]
    });
    instance.applyRemovalPolicy(RemovalPolicy.DESTROY);

    new CfnOutput(this, "ServerInstanceId", {
      value: instance.ref,
      description: "Demo EC2 instance"
    });
    new CfnOutput(this, "ServerPublicIp", {
      value: instance.attrPublicIp,
      description: "SSH target for the demo tunnel"
    });
    return { instance, securityGroup };
  }

  /**
   * Public HTTPS front door for the demo (D23): viewers get the CloudFront certificate on
   * `*.cloudfront.net`, and CloudFront reaches Nginx over HTTP on the instance's public DNS name.
   * `/api/*` keeps `Authorization` in the cache key (GET requests would otherwise drop it) with a
   * 1-second max TTL; Spring sends `no-store`, so API responses are not reused. Returns the
   * distribution's domain name.
   */
  private addPublicDistribution(prefix: string, instance: ec2.CfnInstance): string {
    const apiCachePolicy = new cloudfront.CfnCachePolicy(this, "ApiCachePolicy", {
      cachePolicyConfig: {
        name: `${prefix}-api`,
        comment: "API: forward Authorization and query strings, effectively no caching",
        minTtl: 0,
        defaultTtl: 0,
        maxTtl: 1,
        parametersInCacheKeyAndForwardedToOrigin: {
          enableAcceptEncodingGzip: false,
          headersConfig: { headerBehavior: "whitelist", headers: ["Authorization"] },
          queryStringsConfig: { queryStringBehavior: "all" },
          cookiesConfig: { cookieBehavior: "none" }
        }
      }
    });

    const originId = "demo-server";
    const distribution = new cloudfront.CfnDistribution(this, "PublicDistribution", {
      distributionConfig: {
        enabled: true,
        comment: `${prefix} demo (D23)`,
        priceClass: "PriceClass_100",
        httpVersion: "http2",
        origins: [
          {
            id: originId,
            domainName: instance.attrPublicDnsName,
            customOriginConfig: {
              originProtocolPolicy: "http-only",
              httpPort: 80,
              originReadTimeout: 30
            }
          }
        ],
        defaultCacheBehavior: {
          targetOriginId: originId,
          viewerProtocolPolicy: "redirect-to-https",
          allowedMethods: ["GET", "HEAD"],
          cachePolicyId: cloudfront.CachePolicy.CACHING_DISABLED.cachePolicyId,
          compress: true
        },
        cacheBehaviors: [
          {
            pathPattern: "/api/*",
            targetOriginId: originId,
            viewerProtocolPolicy: "https-only",
            allowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"],
            cachePolicyId: apiCachePolicy.attrId,
            originRequestPolicyId:
              cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId,
            compress: false
          },
          {
            pathPattern: "/assets/*",
            targetOriginId: originId,
            viewerProtocolPolicy: "redirect-to-https",
            allowedMethods: ["GET", "HEAD"],
            cachePolicyId: cloudfront.CachePolicy.CACHING_OPTIMIZED.cachePolicyId,
            compress: true
          }
        ]
      }
    });

    new CfnOutput(this, "PublicUrl", {
      value: `https://${distribution.attrDomainName}`,
      description: "Public HTTPS demo URL for classmates (D23)"
    });
    return distribution.attrDomainName;
  }

  /**
   * One db.t3.micro PostgreSQL in the default VPC (no VpcId or subnet group, as in the sandbox
   * probe). With the demo server it is private and reachable only from the server's security
   * group (D22); without it, public but limited to one laptop /32 (D20). Destroyed with the
   * stack, no backups.
   */
  private addDatabase(
    prefix: string,
    database: DatabaseProps,
    serverSecurityGroup?: ec2.CfnSecurityGroup
  ): void {
    const isPrivate = serverSecurityGroup !== undefined;
    const password = new CfnParameter(this, "DbPassword", {
      type: "String",
      noEcho: true,
      minLength: 16,
      allowedPattern: "[A-Za-z0-9]+",
      description: "RDS master password (MP_DB_PASSWORD in .env). Never stored in the template."
    });

    const securityGroup = new ec2.CfnSecurityGroup(this, "DbSecurityGroup", {
      groupName: `${prefix}-db`,
      groupDescription: serverSecurityGroup
        ? "PostgreSQL from the demo server only"
        : "PostgreSQL from one developer IP only",
      securityGroupIngress: [
        serverSecurityGroup
          ? {
              ipProtocol: "tcp",
              fromPort: 5432,
              toPort: 5432,
              sourceSecurityGroupId: serverSecurityGroup.attrGroupId,
              description: "Demo server"
            }
          : {
              ipProtocol: "tcp",
              fromPort: 5432,
              toPort: 5432,
              cidrIp: database.clientCidr,
              description: "Developer laptop"
            }
      ]
    });

    const instance = new rds.CfnDBInstance(this, "Database", {
      dbInstanceIdentifier: `${prefix}-db`,
      engine: "postgres",
      engineVersion: "18.3",
      dbInstanceClass: "db.t3.micro",
      allocatedStorage: "20",
      storageType: "gp2",
      storageEncrypted: true,
      multiAz: false,
      backupRetentionPeriod: 0,
      deletionProtection: false,
      publiclyAccessible: !isPrivate,
      dbName: "mediapipeline",
      masterUsername: "mpadmin",
      masterUserPassword: password.valueAsString,
      vpcSecurityGroups: [securityGroup.attrGroupId]
    });
    instance.applyRemovalPolicy(RemovalPolicy.DESTROY);
    // Deliberate choices: D20 (password parameter, laptop access) and D22 (private with server).
    Validations.of(instance).acknowledge({
      id: "CloudFormation-Validate::W1011",
      reason: "NoEcho parameter from the untracked .env; SSM write access is unproven in the sandbox."
    });
    if (!isPrivate) {
      Validations.of(instance).acknowledge({
        id: "CloudFormation-Validate::W9011",
        reason:
          "Public only so a laptop backend can connect: the security group allows one /32 and TLS is forced."
      });
    }

    new CfnOutput(this, "DbEndpoint", {
      value: instance.attrEndpointAddress,
      description: "PostgreSQL host for MP_DB_URL"
    });
    new CfnOutput(this, "DbPort", {
      value: instance.attrEndpointPort,
      description: "PostgreSQL port"
    });
  }
}

/** Browser uploads go straight to S3 with presigned PUTs, so each app origin must be allowed. */
function corsConfiguration(origins: string[]): s3.CfnBucket.CorsConfigurationProperty {
  return {
    corsRules: [
      {
        allowedMethods: ["GET", "HEAD", "PUT"],
        allowedOrigins: origins,
        allowedHeaders: ["Content-Type", "x-amz-content-sha256", "x-amz-date"],
        exposedHeaders: ["ETag"],
        maxAge: 300
      }
    ]
  };
}

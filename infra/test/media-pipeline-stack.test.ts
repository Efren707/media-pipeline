import { readFileSync } from "node:fs";
import * as path from "node:path";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { MediaPipelineStack } from "../lib/media-pipeline-stack";

describe("MediaPipelineStack", () => {
  const app = new App();
  const stack = new MediaPipelineStack(app, "TestStack", {
    env: { account: "123456789012", region: "us-east-1" },
    owner: "testuser",
    corsOrigins: ["http://localhost:5173"]
  });
  const template = Template.fromStack(stack);

  test("does not create IAM roles or a NAT gateway", () => {
    template.resourceCountIs("AWS::IAM::Role", 0);
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
  });

  test("creates one private encrypted S3 bucket", () => {
    template.resourceCountIs("AWS::S3::Bucket", 1);
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: Match.objectLike({
        ServerSideEncryptionConfiguration: Match.anyValue()
      }),
      OwnershipControls: {
        Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }]
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true
      }
    });
  });

  test("uses the existing role and only uploads events invoke validation", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "python3.12",
      Handler: "handler.handler"
    });
    expect(
      JSON.stringify(template.findResources("AWS::Lambda::Function"))
    ).toContain("lambda-run-role");
    template.hasResourceProperties("AWS::S3::Bucket", {
      NotificationConfiguration: {
        LambdaConfigurations: Match.arrayWith([
          Match.objectLike({
            Event: "s3:ObjectCreated:*",
            Filter: {
              S3Key: {
                Rules: [{ Name: "prefix", Value: "uploads/" }]
              }
            }
          })
        ])
      }
    });
  });

  test("creates Analyze with fixed model keys and an analyze-manifest trigger", () => {
    template.resourceCountIs("AWS::Lambda::Function", 2);
    template.resourceCountIs("AWS::Lambda::Permission", 2);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "mp-testuser-analyze",
      Runtime: "python3.12",
      Handler: "handler.handler",
      Environment: {
        Variables: Match.objectLike({
          MODEL_KEY: "models/squeezenet1.1-7.onnx",
          LABELS_KEY: "models/imagenet-labels.txt",
          MODEL_VERSION: "squeezenet1.1-7"
        })
      }
    });
    template.hasResourceProperties("AWS::S3::Bucket", {
      NotificationConfiguration: {
        LambdaConfigurations: Match.arrayWith([
          Match.objectLike({
            Event: "s3:ObjectCreated:*",
            Filter: {
              S3Key: {
                Rules: [{ Name: "prefix", Value: "stage/analyze/" }]
              }
            }
          })
        ])
      }
    });
  });

  test("creates one results topic with an owner-scoped name", () => {
    template.resourceCountIs("AWS::SNS::Topic", 1);
    template.hasResourceProperties("AWS::SNS::Topic", {
      TopicName: "mp-testuser-results"
    });
  });

  test("allows only this media bucket and account to publish results", () => {
    template.resourceCountIs("AWS::SNS::TopicPolicy", 1);
    template.hasResourceProperties("AWS::SNS::TopicPolicy", {
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          Match.objectLike({
            Effect: "Allow",
            Principal: { Service: "s3.amazonaws.com" },
            Action: "sns:Publish",
            Condition: {
              ArnEquals: {
                "aws:SourceArn": Match.anyValue()
              },
              StringEquals: { "aws:SourceAccount": "123456789012" }
            }
          })
        ]
      }
    });

    const policies = template.findResources("AWS::SNS::TopicPolicy");
    const policyJson = JSON.stringify(Object.values(policies)[0]);
    expect(policyJson).toContain("mp-testuser-media-123456789012");
    expect(policyJson).not.toContain('["MediaBucket","Arn"]');
  });

  test("publishes result objects to SNS without removing Lambda triggers", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      NotificationConfiguration: {
        LambdaConfigurations: Match.arrayWith([
          Match.objectLike({
            Filter: {
              S3Key: { Rules: [{ Name: "prefix", Value: "uploads/" }] }
            }
          }),
          Match.objectLike({
            Filter: {
              S3Key: { Rules: [{ Name: "prefix", Value: "stage/analyze/" }] }
            }
          })
        ]),
        TopicConfigurations: Match.arrayWith([
          Match.objectLike({
            Event: "s3:ObjectCreated:*",
            Filter: {
              S3Key: { Rules: [{ Name: "prefix", Value: "results/" }] }
            }
          })
        ])
      }
    });
  });

  test("creates no database resources unless asked to", () => {
    template.resourceCountIs("AWS::RDS::DBInstance", 0);
    template.resourceCountIs("AWS::EC2::SecurityGroup", 0);
    expect(template.toJSON().Parameters?.DbPassword).toBeUndefined();
  });

  test("builds the Lambda asset before CDK tests in the verify command", () => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve(__dirname, "../package.json"), "utf8")
    );
    const verifyCommand = String(packageJson.scripts.verify);
    const validatePackageIndex = verifyCommand.indexOf("npm run build:validate");
    const analyzePackageIndex = verifyCommand.indexOf("npm run build:analyze");
    const testIndex = verifyCommand.indexOf("npm test");

    expect(validatePackageIndex).toBeGreaterThanOrEqual(0);
    expect(analyzePackageIndex).toBeGreaterThanOrEqual(0);
    expect(validatePackageIndex).toBeLessThan(testIndex);
    expect(analyzePackageIndex).toBeLessThan(testIndex);
  });
});

describe("MediaPipelineStack with the opt-in database", () => {
  const build = (clientCidr: string) =>
    new MediaPipelineStack(new App(), "DbStack", {
      env: { account: "123456789012", region: "us-east-1" },
      owner: "testuser",
      corsOrigins: ["http://localhost:5173"],
      database: { clientCidr }
    });
  const template = Template.fromStack(build("203.0.113.7/32"));

  test("creates one small, single-AZ, disposable PostgreSQL instance", () => {
    template.resourceCountIs("AWS::RDS::DBInstance", 1);
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      DBInstanceIdentifier: "mp-testuser-db",
      Engine: "postgres",
      DBInstanceClass: "db.t3.micro",
      AllocatedStorage: "20",
      StorageType: "gp2",
      StorageEncrypted: true,
      MultiAZ: false,
      BackupRetentionPeriod: 0,
      DeletionProtection: false,
      MasterUserPassword: { Ref: "DbPassword" }
    });
    template.hasResource("AWS::RDS::DBInstance", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete"
    });
  });

  test("keeps the password out of the template", () => {
    expect(template.toJSON().Parameters.DbPassword).toMatchObject({
      Type: "String",
      NoEcho: true
    });
  });

  test("allows PostgreSQL only from the one client address", () => {
    template.resourceCountIs("AWS::EC2::SecurityGroup", 1);
    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      SecurityGroupIngress: [
        Match.objectLike({
          IpProtocol: "tcp",
          FromPort: 5432,
          ToPort: 5432,
          CidrIp: "203.0.113.7/32"
        })
      ]
    });
  });

  test("still creates no IAM roles or NAT gateway", () => {
    template.resourceCountIs("AWS::IAM::Role", 0);
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
  });

  test.each(["0.0.0.0/0", "203.0.113.0/24", "203.0.113.7", "not-an-ip/32"])(
    "rejects client CIDR %s",
    (cidr) => {
      expect(() => build(cidr)).toThrow(/dbClientCidr/);
    }
  );
});

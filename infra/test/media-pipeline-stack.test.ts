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
        LambdaConfigurations: [
          Match.objectLike({
            Event: "s3:ObjectCreated:*",
            Filter: {
              S3Key: {
                Rules: [{ Name: "prefix", Value: "uploads/" }]
              }
            }
          })
        ]
      }
    });
  });
});

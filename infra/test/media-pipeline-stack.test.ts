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

describe("MediaPipelineStack with the demo server and private database (D22)", () => {
  const build = (sshCidr: string, withDb = true) =>
    new MediaPipelineStack(new App(), "ServerStack", {
      env: { account: "123456789012", region: "us-east-1" },
      owner: "testuser",
      corsOrigins: ["http://localhost:5173"],
      database: withDb ? {} : undefined,
      server: { sshCidr }
    });
  const template = Template.fromStack(build("203.0.113.7/32"));

  test("creates one t3.micro with myS3Role, IMDSv2 and an encrypted root volume", () => {
    template.resourceCountIs("AWS::EC2::Instance", 1);
    template.hasResourceProperties("AWS::EC2::Instance", {
      InstanceType: "t3.micro",
      IamInstanceProfile: "myS3Role",
      ImageId: { Ref: "ServerImageId" },
      KeyName: { Ref: "ServerKeyName" },
      MetadataOptions: { HttpTokens: "required", HttpPutResponseHopLimit: 1 },
      BlockDeviceMappings: [
        Match.objectLike({
          Ebs: Match.objectLike({ VolumeSize: 8, VolumeType: "gp3", Encrypted: true })
        })
      ]
    });
    template.hasResource("AWS::EC2::Instance", { DeletionPolicy: "Delete" });
    const params = template.toJSON().Parameters;
    expect(params.ServerImageId).toMatchObject({
      Type: "AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>",
      Default: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
    });
    expect(params.ServerKeyName).toMatchObject({
      Type: "AWS::EC2::KeyPair::KeyName",
      Default: "vockey"
    });
  });

  test("opens only SSH from the one client address to the server", () => {
    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      GroupName: "mp-testuser-server",
      SecurityGroupIngress: [
        Match.objectLike({ IpProtocol: "tcp", FromPort: 22, ToPort: 22, CidrIp: "203.0.113.7/32" })
      ]
    });
  });

  test("makes the database private and reachable only from the server", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", { PubliclyAccessible: false });
    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      GroupName: "mp-testuser-db",
      SecurityGroupIngress: [
        Match.objectLike({
          FromPort: 5432,
          ToPort: 5432,
          SourceSecurityGroupId: { "Fn::GetAtt": ["ServerSecurityGroup", "GroupId"] }
        })
      ]
    });
  });

  test("opens no port to the internet and only SSH to any CIDR", () => {
    const groups = Object.values(template.findResources("AWS::EC2::SecurityGroup"));
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      for (const rule of group.Properties.SecurityGroupIngress ?? []) {
        expect(rule.CidrIp).not.toBe("0.0.0.0/0");
        expect(rule.CidrIpv6).toBeUndefined();
        if (rule.CidrIp) expect(rule.FromPort).toBe(22);
      }
    }
  });

  test("installs only runtimes in user data and keeps secrets out of the template", () => {
    const [instanceResource] = Object.values(template.findResources("AWS::EC2::Instance"));
    const userData: string = instanceResource.Properties.UserData["Fn::Base64"];
    expect(userData).toContain("java-21-amazon-corretto-headless");
    expect(userData).not.toMatch(/MP_JWT_SECRET|MP_DB_|PASSWORD|SECRET|TOKEN/i);
    expect(JSON.stringify(template.toJSON())).not.toMatch(
      /aws_secret_access_key|aws_session_token|AKIA|ASIA/
    );
  });

  test("outputs the instance and its public IP for the tunnel", () => {
    template.hasOutput("ServerInstanceId", {});
    template.hasOutput("ServerPublicIp", {});
  });

  test("still creates no IAM roles, instance profiles or NAT gateway", () => {
    template.resourceCountIs("AWS::IAM::Role", 0);
    template.resourceCountIs("AWS::IAM::InstanceProfile", 0);
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
  });

  test("can run without the database", () => {
    const serverOnly = Template.fromStack(build("203.0.113.7/32", false));
    serverOnly.resourceCountIs("AWS::EC2::Instance", 1);
    serverOnly.resourceCountIs("AWS::RDS::DBInstance", 0);
  });

  test.each(["0.0.0.0/0", "203.0.113.0/24", "203.0.113.7"])("rejects SSH CIDR %s", (cidr) => {
    expect(() => build(cidr)).toThrow(/sshCidr/);
  });

  test("creates no server unless asked to", () => {
    const plain = Template.fromStack(
      new MediaPipelineStack(new App(), "PlainStack", {
        env: { account: "123456789012", region: "us-east-1" },
        owner: "testuser",
        corsOrigins: ["http://localhost:5173"]
      })
    );
    plain.resourceCountIs("AWS::EC2::Instance", 0);
  });
});

describe("MediaPipelineStack with the public CloudFront URL (D23)", () => {
  const prefixListId = "pl-3b927c52";
  const build = (cloudfrontPrefixListId?: string) =>
    new MediaPipelineStack(new App(), "PublicStack", {
      env: { account: "123456789012", region: "us-east-1" },
      owner: "testuser",
      corsOrigins: ["http://localhost:5173", "http://localhost:8088"],
      database: {},
      server: { sshCidr: "203.0.113.7/32", cloudfrontPrefixListId }
    });
  const template = Template.fromStack(build(prefixListId));

  test("fronts the server's public DNS name over HTTP with an HTTPS viewer policy", () => {
    template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Enabled: true,
        PriceClass: "PriceClass_100",
        Origins: [
          Match.objectLike({
            DomainName: { "Fn::GetAtt": ["Server", "PublicDnsName"] },
            CustomOriginConfig: Match.objectLike({
              OriginProtocolPolicy: "http-only",
              HTTPPort: 80
            })
          })
        ],
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: "redirect-to-https" })
      })
    });
  });

  test("never caches the API and forwards Authorization with the viewer headers", () => {
    template.hasResourceProperties("AWS::CloudFront::CachePolicy", {
      CachePolicyConfig: Match.objectLike({
        Name: "mp-testuser-api",
        MinTTL: 0,
        DefaultTTL: 0,
        MaxTTL: 1,
        ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
          HeadersConfig: { HeaderBehavior: "whitelist", Headers: ["Authorization"] },
          QueryStringsConfig: { QueryStringBehavior: "all" }
        })
      })
    });
    const [dist] = Object.values(template.findResources("AWS::CloudFront::Distribution"));
    const behaviors = dist.Properties.DistributionConfig.CacheBehaviors;
    const api = behaviors.find((b: { PathPattern: string }) => b.PathPattern === "/api/*");
    expect(api).toMatchObject({
      ViewerProtocolPolicy: "https-only",
      CachePolicyId: { "Fn::GetAtt": ["ApiCachePolicy", "Id"] },
      // Managed AllViewerExceptHostHeader
      OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    });
    expect(api.AllowedMethods).toEqual(expect.arrayContaining(["POST", "PUT", "DELETE"]));
  });

  test("opens port 80 only to the CloudFront prefix list, never to a CIDR", () => {
    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      GroupName: "mp-testuser-server",
      SecurityGroupIngress: [
        Match.objectLike({ FromPort: 22, CidrIp: "203.0.113.7/32" }),
        Match.objectLike({ FromPort: 80, ToPort: 80, SourcePrefixListId: prefixListId })
      ]
    });
    for (const group of Object.values(template.findResources("AWS::EC2::SecurityGroup"))) {
      for (const rule of group.Properties.SecurityGroupIngress ?? []) {
        expect(rule.CidrIp).not.toBe("0.0.0.0/0");
        expect(rule.CidrIpv6).toBeUndefined();
        if (rule.CidrIp) expect(rule.FromPort).toBe(22);
        if (rule.FromPort === 80) expect(rule.SourcePrefixListId).toBe(prefixListId);
      }
    }
  });

  test("allows uploads from the distribution's HTTPS origin and keeps the others", () => {
    const [bucket] = Object.values(template.findResources("AWS::S3::Bucket"));
    const origins = bucket.Properties.CorsConfiguration.CorsRules[0].AllowedOrigins;
    expect(origins).toEqual(
      expect.arrayContaining([
        "http://localhost:5173",
        "http://localhost:8088",
        { "Fn::Join": ["", ["https://", { "Fn::GetAtt": ["PublicDistribution", "DomainName"] }]] }
      ])
    );
  });

  test("outputs the public URL and keeps the database private", () => {
    template.hasOutput("PublicUrl", {});
    template.hasResourceProperties("AWS::RDS::DBInstance", { PubliclyAccessible: false });
  });

  test("still creates no IAM roles, instance profiles or NAT gateway", () => {
    template.resourceCountIs("AWS::IAM::Role", 0);
    template.resourceCountIs("AWS::IAM::InstanceProfile", 0);
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
  });

  test("adds no distribution or port 80 without the prefix list", () => {
    const tunnelOnly = Template.fromStack(build());
    tunnelOnly.resourceCountIs("AWS::CloudFront::Distribution", 0);
    tunnelOnly.resourceCountIs("AWS::CloudFront::CachePolicy", 0);
    for (const group of Object.values(tunnelOnly.findResources("AWS::EC2::SecurityGroup"))) {
      for (const rule of group.Properties.SecurityGroupIngress ?? []) {
        expect(rule.FromPort).not.toBe(80);
      }
    }
  });

  test.each(["0.0.0.0/0", "sg-0123abcd", "pl-XYZ", ""])("rejects prefix list %p", (id) => {
    expect(() => build(id)).toThrow(/cloudfrontPrefixListId/);
  });
});

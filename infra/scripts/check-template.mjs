import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const outputDirectory = join(process.cwd(), "cdk.out");
const files = (await readdir(outputDirectory)).filter((name) =>
  name.endsWith(".template.json")
);

if (files.length === 0) {
  throw new Error("No synthesized CDK template found in infra/cdk.out.");
}

const forbiddenTypes = new Set(["AWS::IAM::Role", "AWS::EC2::NatGateway"]);
const violations = [];

for (const file of files) {
  const template = JSON.parse(await readFile(join(outputDirectory, file), "utf8"));
  for (const [logicalId, resource] of Object.entries(template.Resources ?? {})) {
    if (forbiddenTypes.has(resource.Type)) {
      violations.push(`${file}: ${logicalId} (${resource.Type})`);
    }
  }
}

if (violations.length > 0) {
  console.error("Forbidden resources found:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(
  `Checked ${files.length} template(s): no AWS::IAM::Role or AWS::EC2::NatGateway resources.`
);

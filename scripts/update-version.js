/* eslint-disable no-undef */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const version = process.argv[2];
const filePath = path.join(__dirname, '../src/index.ts');

if (!version) {
  console.error('Error: No version argument provided.');
  process.exit(1);
}

try {
  const content = fs.readFileSync(filePath, 'utf8');
  // Regex looks for: version: 'x.y.z'
  const regex = /version: '[^']*'/;

  if (!regex.test(content)) {
    console.error('Error: Could not find version string in src/index.ts');
    process.exit(1);
  }

  const updatedContent = content.replace(regex, `version: '${version}'`);
  fs.writeFileSync(filePath, updatedContent);
  console.log(`Updated src/index.ts to version ${version}`);
} catch (error) {
  console.error('Error updating version:', error);
  process.exit(1);
}

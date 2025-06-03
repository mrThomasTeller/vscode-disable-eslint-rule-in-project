import * as fs from 'fs-extra';
import * as path from 'path';

export async function findConfigFile(currentFile: string): Promise<string | null> {
  const configFileNames = [
    // ESLint 9 flat config files (prioritize these)
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    // Legacy config files
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc',
    'package.json',
  ];

  // find the nearest ESLint config file
  let dir = path.dirname(currentFile);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    for (const configFileName of configFileNames) {
      const configFilePath = path.join(dir, configFileName);
      if (await fs.pathExists(configFilePath)) {
        if (configFileName === 'package.json') {
          const packageJson = await fs.readJson(configFilePath);
          if (!packageJson.eslintConfig) {
            continue;
          }
        }

        return configFilePath;
      }
    }

    const parentDir = path.dirname(dir);
    if (dir === parentDir) {
      break;
    }
    dir = parentDir;
  }

  return null;
}
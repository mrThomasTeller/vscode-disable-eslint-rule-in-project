import * as fs from 'fs-extra';
import * as path from 'path';

export async function readConfigFile(configPath: string): Promise<any> {
  const ext = path.extname(configPath);
  const fileName = path.basename(configPath);
  
  // Remove .temp suffix for detection logic
  const baseFileName = fileName.replace(/\.temp$/, '');

  // Handle ESLint 9 flat config files
  if (baseFileName.startsWith('eslint.config.')) {
    const baseExt = path.extname(baseFileName);
    if (baseExt === '.mjs') {
      // ES module - use dynamic import
      try {
        const config = await import(`file://${configPath}`);
        return config.default || config;
      } catch (error) {
        // Fallback to reading as text and evaluating
        const content = await fs.readFile(configPath, 'utf8');
        const exportMatch = content.match(/export\s+default\s+(.+);?\s*$/s);
        if (exportMatch) {
          return JSON.parse(exportMatch[1]);
        }
        throw error;
      }
    } else if (baseExt === '.cjs' || baseExt === '.js') {
      // CommonJS module
      delete require.cache[require.resolve(configPath)];
      return require(configPath);
    }
  }

  // Handle legacy config files
  if (ext === '.js' || ext === '.cjs') {
    delete require.cache[require.resolve(configPath)];
    return require(configPath);
  } else if (baseFileName === 'package.json') {
    const packageJson = await fs.readJson(configPath);
    return packageJson.eslintConfig;
  } else if (ext === '.json' || ext === '') {
    return fs.readJson(configPath);
  }

  throw new Error(`Unsupported ESLint configuration format: ${configPath}`);
}

export async function writeConfigFile(configPath: string, config: any): Promise<void> {
  const ext = path.extname(configPath);
  const fileName = path.basename(configPath);
  
  // Remove .temp suffix for detection logic
  const baseFileName = fileName.replace(/\.temp$/, '');

  // Handle ESLint 9 flat config files
  if (baseFileName.startsWith('eslint.config.')) {
    const baseExt = path.extname(baseFileName);
    if (baseExt === '.mjs') {
      // ES module format
      const configContent = `export default ${JSON.stringify(config, null, 2)};`;
      await fs.writeFile(configPath, configContent);
    } else if (baseExt === '.cjs') {
      // CommonJS format
      const configContent = `module.exports = ${JSON.stringify(config, null, 2)};`;
      await fs.writeFile(configPath, configContent);
    } else if (baseExt === '.js') {
      // Default to CommonJS for .js files in flat config
      const configContent = `module.exports = ${JSON.stringify(config, null, 2)};`;
      await fs.writeFile(configPath, configContent);
    }
    return;
  }

  // Handle legacy config files
  if (ext === '.js' || ext === '.cjs') {
    await fs.writeFile(
      configPath,
      `module.exports = ${JSON.stringify(config, null, 2)}`
    );
  } else if (baseFileName === 'package.json') {
    const packageJson = await fs.readJson(configPath);
    packageJson.eslintConfig = config;
    await fs.writeJson(configPath, packageJson, { spaces: 2 });
  } else if (ext === '.json' || ext === '') {
    await fs.writeJson(configPath, config, { spaces: 2 });
  } else {
    throw new Error(`Unsupported ESLint configuration format: ${configPath}`);
  }
}

export function isFlatConfig(config: any): boolean {
  return Array.isArray(config);
}

export function updateRuleInFlatConfig(config: any[], ruleName: string): any[] {
  // Look for an existing global config object (one without files property or with files: ["**/*"])
  const globalConfigIndex = config.findIndex(
    (cfg) => !cfg.files || (Array.isArray(cfg.files) && cfg.files.includes("**/*"))
  );

  if (globalConfigIndex === -1) {
    // No global config found, add one at the end
    config.push({
      files: ["**/*"],
      rules: {
        [ruleName]: "off"
      }
    });
  } else {
    // Update existing global config
    const globalConfig = config[globalConfigIndex];
    if (!globalConfig.rules) {
      globalConfig.rules = {};
    }
    globalConfig.rules[ruleName] = "off";
  }

  return config;
}

export function updateRuleInLegacyConfig(config: any, ruleName: string): any {
  if (!config.rules) {
    config.rules = {};
  }
  config.rules[ruleName] = 0;
  return config;
}
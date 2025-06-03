import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { pattern: '**/*.{js,ts,jsx,tsx}', scheme: 'file' },
      new DisableEslintRuleProvider(),
      {
        providedCodeActionKinds:
          DisableEslintRuleProvider.providedCodeActionKinds,
      }
    )
  );

  const disposable = vscode.commands.registerCommand(
    'disable-eslint-rule-in-project.disableRule',
    async (document?: vscode.TextDocument, diagnostic?: vscode.Diagnostic) => {
      if (!diagnostic) diagnostic = await getCurrentDiagnostic();

      if (!diagnostic) return;

      const ruleName = getRuleName(diagnostic);

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder is open');
        return;
      }

      const eslintrcPath =
        document?.fileName && (await findEslintConfigFile(document?.fileName));

      if (!eslintrcPath) {
        vscode.window.showErrorMessage('ESLint configuration file not found');
        return;
      }

      try {
        const eslintConfig = await readEslintConfig(eslintrcPath);

        let updatedConfig;
        if (isFlatConfig(eslintConfig)) {
          // Handle ESLint 9 flat config (array of objects)
          updatedConfig = updateRuleInFlatConfig(eslintConfig, ruleName);
        } else {
          // Handle legacy config (single object)
          updatedConfig = updateRuleInLegacyConfig(eslintConfig, ruleName);
        }

        await writeEslintConfig(eslintrcPath, updatedConfig);

        vscode.window.showInformationMessage(
          `Successfully disabled rule "${ruleName}" in ESLint configuration file.`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `An error occurred while updating ESLint configuration file: ${
            (error as any).message
          }`
        );
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}

function getRuleName(diagnostic: vscode.Diagnostic): string {
  const code = diagnostic.code;
  const ruleName = typeof code === 'object' ? code.value : (code as string);
  return String(ruleName);
}

function isFlatConfig(config: any): boolean {
  return Array.isArray(config);
}

function updateRuleInFlatConfig(config: any[], ruleName: string): any[] {
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

function updateRuleInLegacyConfig(config: any, ruleName: string): any {
  if (!config.rules) {
    config.rules = {};
  }
  config.rules[ruleName] = 0;
  return config;
}

async function findEslintConfigFile(
  currentFile: string
): Promise<string | null> {
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

async function readEslintConfig(configPath: string): Promise<any> {
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

async function writeEslintConfig(
  configPath: string,
  config: any
): Promise<void> {
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

class DisableEslintRuleProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    const eslintDiagnostics = context.diagnostics.filter(
      (diagnostic) => diagnostic.source === 'eslint'
    );

    if (!eslintDiagnostics.length) {
      return;
    }

    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of eslintDiagnostics) {
      const ruleName = getRuleName(diagnostic);
      const action = new vscode.CodeAction(
        `Disable ESLint rule '${ruleName}' in the project`,
        vscode.CodeActionKind.QuickFix
      );
      action.command = {
        title: 'Disable ESLint rule in the project',
        command: 'disable-eslint-rule-in-project.disableRule',
        arguments: [document, diagnostic],
      };
      actions.push(action);
    }

    return actions;
  }
}

async function getCurrentDiagnostic() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
  const eslintDiagnostics = diagnostics.filter(
    (diagnostic) => diagnostic.source === 'eslint'
  );
  if (!eslintDiagnostics.length) {
    vscode.window.showInformationMessage(
      'No ESLint errors found in the current file.'
    );
    return;
  }
  const selectedDiagnostic = await vscode.window.showQuickPick(
    eslintDiagnostics.map((diagnostic) => ({
      label: diagnostic.message,
      detail: `Rule: ${getRuleName(diagnostic)}`,
      diagnostic,
    })),
    { placeHolder: 'Select ESLint error to disable' }
  );
  if (!selectedDiagnostic) {
    return;
  }

  return selectedDiagnostic.diagnostic;
}

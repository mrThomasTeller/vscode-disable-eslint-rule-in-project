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
        if (isFlatConfig(eslintrcPath)) {
          // Handle flat config
          updatedConfig = addRuleToFlatConfig(eslintConfig, ruleName);
        } else {
          // Handle legacy config
          if (!eslintConfig.rules) {
            eslintConfig.rules = {};
          }
          eslintConfig.rules[ruleName] = 0;
          updatedConfig = eslintConfig;
        }

        await writeEslintConfig(eslintrcPath, updatedConfig);

        vscode.window.showInformationMessage(
          `Successfully disabled rule "${ruleName}" in ESLint configuration file.`
        );
      } catch (error) {
        if ((error as Error).message === 'ESM_CONFIG_MODIFICATION_NOT_SUPPORTED') {
          showESMInstructions(ruleName, eslintrcPath);
        } else {
          vscode.window.showErrorMessage(
            `An error occurred while updating ESLint configuration file: ${
              (error as any).message
            }`
          );
        }
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

function isFlatConfig(configPath: string): boolean {
  const fileName = path.basename(configPath);
  return fileName.startsWith('eslint.config.');
}

function isESMConfig(configPath: string): boolean {
  const fileName = path.basename(configPath);
  return fileName.endsWith('.mjs');
}

async function readFlatConfigCJS(configPath: string): Promise<any[]> {
  // Clear require cache to ensure fresh read
  delete require.cache[require.resolve(configPath)];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const config = require(configPath);
  return Array.isArray(config) ? config : [config];
}

async function readFlatConfigESM(configPath: string): Promise<any[]> {
  // Use dynamic import for ESM modules
  const configModule = await import(`file://${configPath}?t=${Date.now()}`);
  const config = configModule.default || configModule;
  return Array.isArray(config) ? config : [config];
}

async function writeFlatConfigCJS(configPath: string, config: any[]): Promise<void> {
  const configString = `module.exports = ${JSON.stringify(config, null, 2)};`;
  await fs.writeFile(configPath, configString);
}

function showESMInstructions(ruleName: string, configPath: string): void {
  const instructions = `Cannot automatically modify ESM config file. Please manually add the following rule to your ${path.basename(configPath)}:

Add or modify a configuration object in the exported array:
{
  rules: {
    "${ruleName}": "off"
  }
}

Example:
export default [
  // ... other configs
  {
    rules: {
      "${ruleName}": "off"
    }
  }
];`;

  vscode.window.showWarningMessage(
    `ESM config detected. Manual modification required.`,
    'Show Instructions'
  ).then(selection => {
    if (selection === 'Show Instructions') {
      vscode.workspace.openTextDocument({ content: instructions, language: 'javascript' })
        .then(doc => vscode.window.showTextDocument(doc));
    }
  });
}

function addRuleToFlatConfig(configs: any[], ruleName: string): any[] {
  // Find existing config with rules or create new one
  let ruleConfig = configs.find(config => config.rules);
  
  if (!ruleConfig) {
    ruleConfig = { rules: {} };
    configs.push(ruleConfig);
  }
  
  if (!ruleConfig.rules) {
    ruleConfig.rules = {};
  }
  
  ruleConfig.rules[ruleName] = 'off';
  
  return configs;
}

async function findEslintConfigFile(
  currentFile: string
): Promise<string | null> {
  const configFileNames = [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
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

  // Handle flat config files
  if (isFlatConfig(configPath)) {
    if (isESMConfig(configPath)) {
      return await readFlatConfigESM(configPath);
    } else {
      return await readFlatConfigCJS(configPath);
    }
  }

  // Handle legacy config files
  if (ext === '.js') {
    return require(configPath);
  } else if (fileName === 'package.json') {
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

  // Handle flat config files
  if (isFlatConfig(configPath)) {
    if (isESMConfig(configPath)) {
      throw new Error('ESM_CONFIG_MODIFICATION_NOT_SUPPORTED');
    } else {
      await writeFlatConfigCJS(configPath, config);
      return;
    }
  }

  // Handle legacy config files
  if (ext === '.js') {
    await fs.writeFile(
      configPath,
      `module.exports = ${JSON.stringify(config, null, 2)}`
    );
  } else if (fileName === 'package.json') {
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

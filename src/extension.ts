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
        const eslintrcJson = await readEslintConfig(eslintrcPath);

        if (!eslintrcJson.rules) {
          eslintrcJson.rules = {};
        }

        eslintrcJson.rules[ruleName] = 0;

        await writeEslintConfig(eslintrcPath, eslintrcJson);

        vscode.window.showInformationMessage(
          `Successfully disabled rule "${ruleName}" in .eslintrc file.`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `An error occurred while updating .eslintrc file: ${
            (error as any).message
          }`
        );
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}

function getRuleName(diagnostic: vscode.Diagnostic) {
  const code = diagnostic.code;
  const ruleName = typeof code === 'object' ? code.value : (code as string);
  return ruleName;
}

async function findEslintConfigFile(
  currentFile: string
): Promise<string | null> {
  const configFileNames = [
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

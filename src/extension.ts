import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
    'disable-eslint-rule-in-project.disableRule',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
      const eslintDiagnostics = diagnostics.filter((diagnostic) => diagnostic.source === 'eslint');

      if (!eslintDiagnostics.length) {
        vscode.window.showInformationMessage('No ESLint errors found in the current file.');
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

      const ruleName = getRuleName(selectedDiagnostic.diagnostic);

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder is open');
        return;
      }

      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      const eslintrcPath = await findEslintConfigFile(workspaceRoot);

      if (!eslintrcPath) {
        vscode.window.showErrorMessage('ESLint configuration file not found in the workspace root');
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
          `An error occurred while updating .eslintrc file: ${(error as any).message}`
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

async function findEslintConfigFile(workspaceRoot: string): Promise<string | null> {
  const configFileNames = ['.eslintrc.js', '.eslintrc.json', '.eslintrc'];

  for (const fileName of configFileNames) {
    const configPath = path.join(workspaceRoot, fileName);
    if (await fs.pathExists(configPath)) {
      return configPath;
    }
  }

  return null;
}

async function readEslintConfig(configPath: string): Promise<any> {
  const ext = path.extname(configPath);
  if (ext === '.js') {
    return require(configPath);
  } else if (ext === '.json' || ext === '') {
    return fs.readJson(configPath);
  }
  throw new Error(`Unsupported ESLint configuration format: ${configPath}`);
}

async function writeEslintConfig(configPath: string, config: any): Promise<void> {
  const ext = path.extname(configPath);
  if (ext === '.js') {
    await fs.writeFile(configPath, `module.exports = ${JSON.stringify(config, null, 2)}`);
  } else if (ext === '.json' || ext === '') {
    await fs.writeJson(configPath, config, { spaces: 2 });
  } else {
    throw new Error(`Unsupported ESLint configuration format: ${configPath}`);
  }
}

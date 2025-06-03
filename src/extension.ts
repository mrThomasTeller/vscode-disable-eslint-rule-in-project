import * as vscode from 'vscode';
import { findConfigFile } from './helpers/findConfigFile';
import { 
  readConfigFile, 
  writeConfigFile, 
  isFlatConfig, 
  updateRuleInFlatConfig, 
  updateRuleInLegacyConfig 
} from './helpers/readConfigFile';

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
        document?.fileName && (await findConfigFile(document?.fileName));

      if (!eslintrcPath) {
        vscode.window.showErrorMessage('ESLint configuration file not found');
        return;
      }

      try {
        const eslintConfig = await readConfigFile(eslintrcPath);

        let updatedConfig;
        if (isFlatConfig(eslintConfig)) {
          // Handle ESLint 9 flat config (array of objects)
          updatedConfig = updateRuleInFlatConfig(eslintConfig, ruleName);
        } else {
          // Handle legacy config (single object)
          updatedConfig = updateRuleInLegacyConfig(eslintConfig, ruleName);
        }

        await writeConfigFile(eslintrcPath, updatedConfig);

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

import * as assert from 'assert';
import { findConfigFile } from '../../helpers/findConfigFile';
import { 
  readConfigFile, 
  writeConfigFile, 
  isFlatConfig, 
  updateRuleInFlatConfig, 
  updateRuleInLegacyConfig 
} from '../../helpers/readConfigFile';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Flat config detection', () => {
		const flatConfig = [{ files: ['**/*.js'], rules: { 'no-console': 'error' } }];
		const legacyConfig = { rules: { 'no-console': 'error' } };
		
		assert.strictEqual(isFlatConfig(flatConfig), true);
		assert.strictEqual(isFlatConfig(legacyConfig), false);
	});

	test('Flat config rule update', () => {
		const flatConfig = [
			{ files: ['**/*.js'], rules: { 'no-console': 'error' } }
		];
		
		const updated = updateRuleInFlatConfig([...flatConfig], 'no-unused-vars');
		
		// Should add a new global config object
		assert.strictEqual(updated.length, 2);
		assert.strictEqual(updated[1].files[0], '**/*');
		assert.strictEqual(updated[1].rules['no-unused-vars'], 'off');
	});

	test('Legacy config rule update', () => {
		const legacyConfig = { rules: { 'no-console': 'error' } };
		
		const updated = updateRuleInLegacyConfig({...legacyConfig}, 'no-unused-vars');
		
		assert.strictEqual(updated.rules['no-unused-vars'], 0);
		assert.strictEqual(updated.rules['no-console'], 'error'); // should preserve existing rules
	});
});

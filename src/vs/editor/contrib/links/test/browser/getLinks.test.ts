/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILink, ILinksList, LinkProvider } from '../../../../common/languages.js';
import { LanguageFeatureRegistry } from '../../../../common/languageFeatureRegistry.js';
import { ITextModel } from '../../../../common/model.js';
import { createTextModel } from '../../../../test/common/testTextModel.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { getLinks } from '../../browser/getLinks.js';

suite('getLinks', function () {

	const disposables = new DisposableStore();
	let model: ITextModel;

	setup(() => {
		model = disposables.add(createTextModel('Hello World'));
	});

	teardown(() => {
		disposables.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	function createLinkProvider(links: ILink[]): LinkProvider {
		return {
			provideLinks: (_model: ITextModel, _token: CancellationToken): ILinksList => {
				return { links };
			}
		};
	}

	test('should prefer longer links when overlapping', async function () {
		const registry = new LanguageFeatureRegistry<LinkProvider>();

		// Short link: just "overview.md"
		const shortProvider = createLinkProvider([{
			range: { startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 16 },
			url: URI.parse('file:///short/overview.md')
		}]);

		// Long link: "gl:docs/spec/repo-gl-fix/overview.md#L59"
		const longProvider = createLinkProvider([{
			range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 42 },
			url: URI.parse('file:///long/gl-link')
		}]);

		// Register short provider first, then long provider
		const r1 = registry.register('*', shortProvider);
		const r2 = registry.register('*', longProvider);

		const list = await getLinks(registry, model, CancellationToken.None);

		// Should only have one link (the longer one)
		assert.strictEqual(list.links.length, 1);
		assert.strictEqual(list.links[0].url?.toString(), 'file:///long/gl-link');

		list.dispose();
		r1.dispose();
		r2.dispose();
	});

	test('should keep shorter link when registered later (longer wins)', async function () {
		const registry = new LanguageFeatureRegistry<LinkProvider>();

		// Long link first
		const longProvider = createLinkProvider([{
			range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 42 },
			url: URI.parse('file:///long/gl-link')
		}]);

		// Short overlapping link second
		const shortProvider = createLinkProvider([{
			range: { startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 16 },
			url: URI.parse('file:///short/overview.md')
		}]);

		// Register long provider first, then short provider
		const r1 = registry.register('*', longProvider);
		const r2 = registry.register('*', shortProvider);

		const list = await getLinks(registry, model, CancellationToken.None);

		// Should only have one link (the longer one should win)
		assert.strictEqual(list.links.length, 1);
		assert.strictEqual(list.links[0].url?.toString(), 'file:///long/gl-link');

		list.dispose();
		r1.dispose();
		r2.dispose();
	});

	test('should keep non-overlapping links', async function () {
		const registry = new LanguageFeatureRegistry<LinkProvider>();

		const provider = createLinkProvider([
			{
				range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 },
				url: URI.parse('file:///first')
			},
			{
				range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 12 },
				url: URI.parse('file:///second')
			}
		]);

		const r = registry.register('*', provider);

		const list = await getLinks(registry, model, CancellationToken.None);

		// Should have both links
		assert.strictEqual(list.links.length, 2);

		list.dispose();
		r.dispose();
	});

	test('should prefer longer link when one contains the other (containment)', async function () {
		const registry = new LanguageFeatureRegistry<LinkProvider>();

		// Outer link: "gl:docs/spec/overview.md#L59" (columns 1-30)
		const outerProvider = createLinkProvider([{
			range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 30 },
			url: URI.parse('file:///outer/gl-link')
		}]);

		// Inner link: "overview.md" (columns 15-26, contained within outer)
		const innerProvider = createLinkProvider([{
			range: { startLineNumber: 1, startColumn: 15, endLineNumber: 1, endColumn: 26 },
			url: URI.parse('file:///inner/overview.md')
		}]);

		const r1 = registry.register('*', outerProvider);
		const r2 = registry.register('*', innerProvider);

		const list = await getLinks(registry, model, CancellationToken.None);

		// Should only have one link (the outer/longer one)
		assert.strictEqual(list.links.length, 1);
		assert.strictEqual(list.links[0].url?.toString(), 'file:///outer/gl-link');

		list.dispose();
		r1.dispose();
		r2.dispose();
	});

	test('should prefer leftmost link for partial overlaps', async function () {
		const registry = new LanguageFeatureRegistry<LinkProvider>();

		// Left link: columns 1-15
		const leftProvider = createLinkProvider([{
			range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 15 },
			url: URI.parse('file:///left-link')
		}]);

		// Right link: columns 10-25 (partial overlap with left)
		const rightProvider = createLinkProvider([{
			range: { startLineNumber: 1, startColumn: 10, endLineNumber: 1, endColumn: 25 },
			url: URI.parse('file:///right-link')
		}]);

		const r1 = registry.register('*', leftProvider);
		const r2 = registry.register('*', rightProvider);

		const list = await getLinks(registry, model, CancellationToken.None);

		// Should only have one link (the leftmost one)
		assert.strictEqual(list.links.length, 1);
		assert.strictEqual(list.links[0].url?.toString(), 'file:///left-link');

		list.dispose();
		r1.dispose();
		r2.dispose();
	});

	test('should prefer leftmost link for partial overlaps (reverse registration order)', async function () {
		const registry = new LanguageFeatureRegistry<LinkProvider>();

		// Right link registered first: columns 10-25
		const rightProvider = createLinkProvider([{
			range: { startLineNumber: 1, startColumn: 10, endLineNumber: 1, endColumn: 25 },
			url: URI.parse('file:///right-link')
		}]);

		// Left link registered second: columns 1-15 (partial overlap)
		const leftProvider = createLinkProvider([{
			range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 15 },
			url: URI.parse('file:///left-link')
		}]);

		const r1 = registry.register('*', rightProvider);
		const r2 = registry.register('*', leftProvider);

		const list = await getLinks(registry, model, CancellationToken.None);

		// Should still prefer leftmost link regardless of registration order
		assert.strictEqual(list.links.length, 1);
		assert.strictEqual(list.links[0].url?.toString(), 'file:///left-link');

		list.dispose();
		r1.dispose();
		r2.dispose();
	});

	test('should handle touching links (same end/start position)', async function () {
		const registry = new LanguageFeatureRegistry<LinkProvider>();

		// First link: columns 1-10
		const firstProvider = createLinkProvider([{
			range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 },
			url: URI.parse('file:///first')
		}]);

		// Second link: columns 10-20 (touching at column 10)
		const secondProvider = createLinkProvider([{
			range: { startLineNumber: 1, startColumn: 10, endLineNumber: 1, endColumn: 20 },
			url: URI.parse('file:///second')
		}]);

		const r1 = registry.register('*', firstProvider);
		const r2 = registry.register('*', secondProvider);

		const list = await getLinks(registry, model, CancellationToken.None);

		// Touching links are treated as overlapping, leftmost wins
		assert.strictEqual(list.links.length, 1);
		assert.strictEqual(list.links[0].url?.toString(), 'file:///first');

		list.dispose();
		r1.dispose();
		r2.dispose();
	});

	test('real-world case: gl: link should win over language server partial path detection', async function () {
		const registry = new LanguageFeatureRegistry<LinkProvider>();

		// gl-git-links extension detects: "gl:docs/spec/repo-gl-fix/overview.md#L59"
		// Full link from column 4 to column 45
		const glLinkProvider = createLinkProvider([{
			range: { startLineNumber: 1, startColumn: 4, endLineNumber: 1, endColumn: 45 },
			url: URI.parse('file:///repo/docs/spec/repo-gl-fix/overview.md'),
			tooltip: 'Git Link: docs/spec/repo-gl-fix/overview.md line 59'
		}]);

		// Language server (e.g., gopls) detects partial path: "overview.md"
		// Partial detection from column 30 to column 41 (inside the gl: link)
		const languageServerProvider = createLinkProvider([{
			range: { startLineNumber: 1, startColumn: 30, endLineNumber: 1, endColumn: 41 },
			url: URI.parse('file:///repo/overview.md')
		}]);

		const r1 = registry.register('*', glLinkProvider);
		const r2 = registry.register('*', languageServerProvider);

		const list = await getLinks(registry, model, CancellationToken.None);

		// The gl: link should win because it contains the language server's link
		assert.strictEqual(list.links.length, 1);
		assert.strictEqual(list.links[0].url?.toString(), 'file:///repo/docs/spec/repo-gl-fix/overview.md');
		assert.strictEqual(list.links[0].tooltip, 'Git Link: docs/spec/repo-gl-fix/overview.md line 59');

		list.dispose();
		r1.dispose();
		r2.dispose();
	});
});

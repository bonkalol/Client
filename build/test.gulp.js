'use strict';

/*!
 * V4Fire Client Core
 * https://github.com/V4Fire/Client
 *
 * Released under the MIT license
 * https://github.com/V4Fire/Client/blob/master/LICENSE
 */

const
	path = require('upath'),
	process = require('process'),
	{src} = require('config'),
	{resolve} = require('@pzlr/build-core');

module.exports = function (gulp = require('gulp')) {
	const
		$ = require('gulp-load-plugins')({scope: ['optionalDependencies']});

	gulp.task('test:component:build', () => {
		const
			arg = require('arg'),
			args = arg({'--name': String, '--suit': String}, {permissive: true});

		if (!args['--name']) {
			throw new ReferenceError('"--name" parameter is not specified');
		}

		const
			suitArg = args['--suit'] ? `--suit ${args['--suit']}` : '',
			extraArgs = args._.slice(1).join(' ');

		return $.run(`npx webpack --public-path / --client-output ${args['--name']} --components ${args['--name']} ${suitArg} ${extraArgs}`, {verbosity: 3})
			.exec()
			.on('error', console.error);
	});

	gulp.task('test:component:run', async () => {
		const
			arg = require('arg');

		const
			http = require('http'),
			nodeStatic = require('node-static');

		const
			fs = require('fs-extra-promise'),
			path = require('upath');

		const args = arg({
			'--name': String,
			'--port': Number,
			'--page': String,
			'--browsers': String,
			'--close': String,
			'--headless': String
		}, {permissive: true});

		if (!args['--name']) {
			throw new ReferenceError('"--name" parameter is not specified');
		}

		let
			browsers = getSelectedBrowsers(),
			headless = true,
			closeOnFinish = true;

		if (args['--headless']) {
			headless = JSON.parse(args['--headless']);
		}

		if (args['--close']) {
			closeOnFinish = JSON.parse(args['--close']);
		}

		args['--port'] = args['--port'] || Number.random(2000, 6000);
		args['--page'] = args['--page'] || 'p-v4-components-demo';

		const
			fileServer = new nodeStatic.Server(src.output(args['--name']));

		const server = http.createServer(async (req, res) => {
			req.addListener('end', () => {
				fileServer.serve(req, res);
			}).resume();
		}).listen(args['--port']);

		const
			componentDir = resolve.blockSync(args['--name']),
			tmpDir = path.join(src.cwd(), 'tmp', path.relative(src.src(), componentDir));

		fs.mkdirpSync(tmpDir);

		const
			test = require(path.join(componentDir, 'test'));

		for (const browserType of browsers) {
			const
				browser = await getBrowserInstance(browserType),
				context = await browser.newContext(),
				page = await context.newPage();

			await page.goto(`localhost:${args['--port']}/${args['--page']}.html`);
			const testEnv = getTestEnv(browserType);
			await test(page, {browser, context, browserType, componentDir, tmpDir});

			const
				close = () => closeOnFinish && context.close() && (process.exitCode = 1);

			await new Promise((resolve) => {
				testEnv.afterAll(() => resolve(), 10e3);
				testEnv.execute();
			}).then(close, close);
		}

		await server.close();

		function getTestEnv(browserType) {
			const
				Jasmine = require('jasmine'),
				jasmine = new Jasmine();

			jasmine.configureDefaultReporter({});
			Object.assign(globalThis, jasmine.env);

			console.log('\n-------------');
			console.log(`Starting to test "${args['--name']}" on "${browserType}"`);
			console.log('-------------\n');

			return jasmine.env;
		}
	});

	gulp.task('test:component',
		gulp.series(['test:component:build', 'test:component:run'])
	);

	gulp.task('test:components', async (cb) => {
		const
			playwright = require('playwright');

		const
			cwd = resolve.cwd,
			cases = require(path.join(cwd, 'tests/cases.js'));

		const
			wsEndpoints = {chromium: '', firefox: '', webkit: ''},
			browsers = getSelectedBrowsers(),
			servers = {};

		for (const browserType of browsers) {
			const
				browser = servers[browserType] = await playwright[browserType].launchServer(),
				wsEndpoint = browser.wsEndpoint();

			wsEndpoints[browserType] = wsEndpoint;
		};

		let
			endpointArg = Object.entries(wsEndpoints).map(([key, value]) => `--${key}WsEndpoint ${value}`).join(' ');

		let
			successCount = 0,
			failedCount = 0;

		const
			failedCases = [];

		const run = (c) => new Promise((res) => {
			$.run(`npx gulp test:component ${c} ${endpointArg}`, {verbosity: 3})
				.exec('', res)
				.on('error', (err) => (failedCount++, failedCases.push(c), console.error(err)));
		});

		for (let i = 0; i < cases.length; i++) {
			await run(cases[i]);
		}

		console.log(`✔️ Tests passed: ${successCount}`);
		console.log(`❌ Tests failed: ${failedCount}`);

		if (failedCases.length) {
			console.log(`❗ Failed tests: \n${failedCases.join('\n')}`);
		}

		Object.keys(servers).forEach(async (key) => await servers[key].close());
	});
};


/**
 * Returns a browser instance
 * @param {string} browserType
 */
async function getBrowserInstance(browserType) {
	const
		arg = require('arg'),
		playwright = require('playwright');

	const args = arg({
		'--firefoxWsEndpoint': String,
		'--webkitWsEndpoint': String,
		'--chromiumWsEndpoint': String
	}, {permissive: true});

	const endpointMap = {
		firefox: '--firefoxWsEndpoint',
		webkit: '--webkitWsEndpoint',
		chromium: '--chromiumWsEndpoint'
	};

	if (args[endpointMap]) {
		return await playwright[browserType].connect({wsEndpoint: args[endpointMap]});
	}

	return await playwright[browserType].launch();
}

/**
 * Returns selected browsers
 */
function getSelectedBrowsers() {
	const
		args = require('arg')({'--browsers': String}, {permissive: true});

	const
		browsers = ['chromium', 'firefox', 'webkit'];

	const aliases = {
		ff: 'firefox',
		chr: 'chromium',
		chrome: 'chromium',
		chromium: 'chromium',
		wk: 'webkit'
	};

	if (args['--browsers']) {
		const customBrowsers = args['--browsers']
			.split(',')
			.map((name) => aliases[name] || null)
			.filter((name) => name);

		if (customBrowsers.length) {
			return customBrowsers;
		}
	}

	return browsers;
}
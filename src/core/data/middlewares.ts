/*!
 * V4Fire Client Core
 * https://github.com/V4Fire/Client
 *
 * Released under the MIT license
 * https://github.com/V4Fire/Client/blob/master/LICENSE
 */

import Then from 'core/then';
import * as env from 'core/env';

import Provider from 'core/data';
import { Response, MiddlewareParams } from 'core/request';

interface MockOptions {
	patterns: RegExp[];
}

let
	options: MockOptions;

const setConfig = (opts) => {
	options = {
		patterns: [],
		...opts
	};

	options.patterns = (options.patterns || []).map((el) => Object.isRegExp(el) ? el : new RegExp(el));
};

const optionsInitializer = env.get('mock').then(setConfig, setConfig);
env.event.on('set.mock', setConfig);
env.event.on('remove.mock', setConfig);

/**
 * Middleware: attaches mock data from .mocks
 * @param params
 */
export async function attachMock(this: Provider, params: MiddlewareParams): Promise<CanUndef<Function>> {
	if (!options) {
		await optionsInitializer;
	}

	const
		{opts, ctx} = params;

	const
		id = opts.cacheId;

	if (!this.mocks || !Object.isString(id) || options.patterns.every((rgxp) => !rgxp.test(id))) {
		return;
	}

	let
		mocks = await this.mocks;

	if (!mocks) {
		return;
	}

	if ('default' in mocks) {
		mocks = mocks.default;
	}

	const
		requests = mocks[String(opts.method)];

	if (!requests) {
		return;
	}

	const requestKeys = [
		'query',
		'body',
		'headers'
	];

	let
		currentRequest;

	for (let i = 0; i < requests.length; i++) {
		const
			request = requests[i];

		if (!request) {
			continue;
		}

		requestKeys: for (let keys = requestKeys, i = 0; i < keys.length; i++) {
			const
				key = keys[i];

			if (!(key in request)) {
				currentRequest = request;
				continue;
			}

			const
				val = request[key],
				baseVal = opts[key];

			if (Object.isObject(val)) {
				for (let keys = Object.keys(val), i = 0; i < keys.length; i++) {
					const
						key = keys[i];

					if (!Object.fastCompare(val[key], baseVal && baseVal[key])) {
						currentRequest = undefined;
						break requestKeys;
					}
				}

				currentRequest = request;
				continue;
			}

			if (Object.fastCompare(baseVal, val)) {
				currentRequest = request;
				continue;
			}

			currentRequest = undefined;
		}

		if (currentRequest) {
			break;
		}
	}

	if (currentRequest === undefined) {
		return;
	}

	const
		customResponse = {status: undefined};

	let
		{response} = currentRequest;

	if (Object.isFunction(response)) {
		response = response.call(this, params, customResponse);
	}

	return () => Then.resolve(response, ctx.parent)
		.then((res) => new Response(res, {
			status: customResponse.status || currentRequest.status || 200,
			responseType: currentRequest.responseType || opts.responseType,
			okStatuses: opts.okStatuses,
			decoder: currentRequest.decoders === false ? undefined : ctx.decoders
		}))

		.then(ctx.wrapAsResponse);
}

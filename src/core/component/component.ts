/*!
 * V4Fire Client Core
 * https://github.com/V4Fire/Client
 *
 * Released under the MIT license
 * https://github.com/V4Fire/Client/blob/master/LICENSE
 */

// tslint:disable:max-file-line-count

import $C = require('collection.js');

import Async from 'core/async';
import log from 'core/log';
import { GLOBAL } from 'core/const/links';

import {

	ComponentDriver,
	minimalCtx,
	PropOptions,
	ComponentOptions,
	FunctionalComponentOptions

} from 'core/component/engines';

import {

	SystemField,
	ComponentField,
	ComponentProp,
	ComponentMeta,
	WatchOptionsWithHandler,
	ComponentInterface

} from 'core/component';

export interface ComponentConstructor<T = unknown> {
	new(): T;
}

export const
	defaultWrapper = Symbol('Default wrapper');

/**
 * Returns a meta object for the specified component
 *
 * @param constructor
 * @param meta
 */
export function getComponent(
	constructor: ComponentConstructor,
	meta: ComponentMeta
): ComponentOptions<ComponentDriver> | FunctionalComponentOptions<ComponentDriver> {
	const
		p = meta.params,
		m = p.model;

	if (p.functional === true) {
		return getFunctionalComponent(constructor, meta);
	}

	const
		{component, instance} = getBaseComponent(constructor, meta),
		{methods} = meta;

	const callMethod = (ctx, method) => {
		const
			obj = methods[method];

		if (obj) {
			try {
				const
					res = obj.fn.call(ctx);

				if (Object.isPromise(res)) {
					res.catch(stderr);
				}

			} catch (err) {
				stderr(err);
			}
		}
	};

	return {
		...<any>component,

		parent: p.parent,
		inheritAttrs: p.inheritAttrs,
		provide: p.provide,
		inject: p.inject,

		model: m && {
			prop: m.prop,
			model: m.event && m.event.dasherize()
		},

		data(): Dictionary {
			const
				ctx = <any>this,
				data = ctx.$$data;

			initDataObject(meta.fields, ctx, instance, data);
			runHook('beforeDataCreate', ctx.meta, ctx).catch(stderr);

			ctx.$$data = this;
			return data;
		},

		beforeCreate(): void {
			const
				ctx = <any>this;

			let
				p = ctx.$parent;

			while (p && p.isFunctional) {
				p = p.$parent;
			}

			ctx.$$data = {};
			ctx.$normalParent = p;
			ctx.$async = new Async(this);
			ctx.instance = instance;
			ctx.componentName = meta.name;
			ctx.meta = createMeta(meta);

			runHook('beforeRuntime', ctx.meta, ctx)
				.catch(stderr);

			for (let o = meta.accessors, keys = Object.keys(o), i = 0; i < keys.length; i++) {
				const
					key = keys[i],
					el = o[key];

				if (el) {
					Object.defineProperty(ctx, keys[i], {
						get: el.get,
						set: el.set
					});
				}
			}

			initDataObject(
				meta.systemFields,
				ctx,
				instance,
				ctx
			);

			runHook('beforeCreate', meta, ctx).catch(stderr);
			callMethod(ctx, 'beforeCreate');
			bindWatchers(ctx);
		},

		created(): void {
			this.hook = 'created';
			bindWatchers(this);
			runHook('created', this.meta, this).catch(stderr);
			callMethod(this, 'created');
		},

		beforeMount(): void {
			runHook('beforeMount', this.meta, this).catch(stderr);
			callMethod(this, 'beforeMount');
		},

		mounted(): void {
			this.$el.component = this;
			this.hook = 'mounted';
			bindWatchers(this);

			runHook('mounted', this.meta, this).then(async () => {
				if (methods.mounted) {
					await methods.mounted.fn.call(this);
				}
			}, stderr);
		},

		beforeUpdate(): void {
			runHook('beforeUpdate', this.meta, this).catch(stderr);
			callMethod(this, 'beforeUpdate');
		},

		updated(): void {
			runHook('updated', this.meta, this).then(async () => {
				if (methods.updated) {
					await methods.updated.fn.call(this);
				}
			}, stderr);
		},

		activated(): void {
			runHook('activated', this.meta, this).catch(stderr);
			callMethod(this, 'activated');
		},

		deactivated(): void {
			runHook('deactivated', this.meta, this).catch(stderr);
			callMethod(this, 'deactivated');
		},

		beforeDestroy(): void {
			runHook('beforeDestroy', this.meta, this).catch(stderr);
			callMethod(this, 'beforeDestroy');
			this.$async.clearAll().locked = true;
		},

		destroyed(): void {
			runHook('destroyed', this.meta, this).then(async () => {
				if (methods.destroyed) {
					await methods.destroyed.fn.call(this);
				}
			}, stderr);
		},

		errorCaptured(): void {
			const
				args = arguments;

			runHook('errorCaptured', this.meta, this, ...args).then(async () => {
				if (methods.errorCaptured) {
					await methods.errorCaptured.fn.apply(this, args);
				}
			}, stderr);
		}
	};
}

/**
 * Returns a meta object for the specified functional component
 *
 * @param constructor
 * @param meta
 */
export function getFunctionalComponent(
	constructor: ComponentConstructor,
	meta: ComponentMeta
): FunctionalComponentOptions<ComponentDriver> {
	const
		{component, instance} = getBaseComponent(constructor, meta),
		{params: p} = meta;

	const
		props = {};

	component.ctx = Object.assign(Object.create(minimalCtx), {
		meta,
		instance,
		componentName: meta.componentName,
		$options: {}
	});

	for (let o = component.props, keys = Object.keys(o), i = 0; i < keys.length; i++) {
		const
			key = keys[i],
			el = o[key],
			prop: PropOptions = props[key] = {...el};

		if (el && Object.isFunction(el.default) && !el.default[defaultWrapper]) {
			prop.default = undefined;
		}
	}

	return <ReturnType<typeof getFunctionalComponent>>{
		props,
		name: meta.name,
		functional: true,
		inject: p.inject,
		render: component.render
	};
}

/**
 * Creates new meta object with the specified parent
 * @param parent
 */
export function createMeta(parent: ComponentMeta): ComponentMeta {
	const meta = Object.assign(Object.create(parent), {
		watchers: {},
		hooks: {}
	});

	for (let o = meta.hooks, p = parent.hooks, keys = Object.keys(p), i = 0; i < keys.length; i++) {
		const
			key = keys[i],
			v = p[key];

		if (v) {
			o[key] = v.slice();
		}
	}

	for (let o = meta.watchers, p = parent.watchers, keys = Object.keys(p), i = 0; i < keys.length; i++) {
		const
			key = keys[i],
			v = p[key];

		if (v) {
			o[key] = v.slice();
		}
	}

	return meta;
}

export const
	customWatcherRgxp = /^([!?]?)([^!?:]*):(.*)/;

/**
 * Binds watchers to the specified component
 *
 * @param ctx - component context
 * @param [eventCtx] - event component context
 */
export function bindWatchers(ctx: ComponentInterface, eventCtx: ComponentInterface = ctx): void {
	const
		// @ts-ignore
		{meta, hook, $async: $a} = ctx;

	if (!{beforeCreate: true, created: true, mounted: true}[hook]) {
		return;
	}

	const
		ctxObj = $C(eventCtx),
		globalObj = $C(GLOBAL);

	const
		isBeforeCreate = hook === 'beforeCreate',
		isCreated = hook === 'created',
		isMounted = hook === 'mounted';

	for (let o = meta.watchers, keys = Object.keys(o), i = 0; i < keys.length; i++) {
		let
			key = keys[i],
			onBeforeCreate = false,
			onMounted = false,
			root = <any>ctx;

		const
			watchers = o[key],
			customWatcher = customWatcherRgxp.exec(key);

		if (customWatcher) {
			const
				m = customWatcher[1],
				l = customWatcher[2];

			onBeforeCreate = m === '!';
			onMounted = m === '?';

			root = l ? ctxObj.get(l) || globalObj.get(l) || ctx : ctx;
			key = customWatcher[3][l ? 'toString' : 'dasherize']();
		}

		if (
			isBeforeCreate && !onBeforeCreate ||
			isCreated && (onMounted || onBeforeCreate) ||
			isMounted && !onMounted ||
			!watchers
		) {
			continue;
		}

		for (let i = 0; i < watchers.length; i++) {
			const
				el = watchers[i],
				handlerIsStr = Object.isString(el.handler);

			const label = `[[WATCHER:${key}:${
				el.method != null ? el.method : handlerIsStr ? el.handler : (<Function>el.handler).name
			}]]`;

			const
				group = {group: el.group || 'watchers', label},
				eventParams = {...group, options: el.options, single: el.single};

			let handler: CanPromise<(...args: unknown[]) => void> = (...args) => {
				args = el.provideArgs === false ? [] : args;

				if (handlerIsStr) {
					const
						method = <string>el.handler;

					if (!Object.isFunction(ctx[method])) {
						throw new ReferenceError(`The specified method (${method}) for watching is not defined`);
					}

					// @ts-ignore
					$a.setImmediate(() => ctx[method](...args), group);

				} else {
					const
						fn = <Function>el.handler;

					if (el.method) {
						fn.call(ctx, ...args);

					} else {
						fn(ctx, ...args);
					}
				}
			};

			if (el.wrapper) {
				handler = <typeof handler>el.wrapper(ctx, handler);
			}

			(async () => {
				if (Object.isPromise(handler)) {
					handler = <typeof handler>await $a.promise(handler, group);
				}

				if (customWatcher) {
					const
						needDefEmitter = root === ctx && !Object.isFunction(root.on) && !Object.isFunction(root.addListener);

					if (needDefEmitter) {
						// @ts-ignore
						ctx.$on(key, handler);

					} else {
						$a.on(root, key, handler, eventParams, ...<unknown[]>el.args);
					}

					return;
				}

				// @ts-ignore
				const unwatch = ctx.$watch(key, {
					deep: el.deep,
					immediate: el.immediate,
					handler
				});

				$a.worker(unwatch, group);
			})();
		}
	}
}

/**
 * Initializes the specified fields to a data object and returns it
 *
 * @param fields
 * @param ctx - component context
 * @param instance - component class instance
 * @param [data] - data object
 */
export function initDataObject(
	fields: Dictionary<ComponentField>,
	ctx: Dictionary,
	instance: Dictionary,
	data: Dictionary = {}
): Dictionary {
	const
		queue = new Set(),
		atomQueue = new Set();

	const
		fieldList = <string[]>[];

	// Sorting atoms
	for (let keys = Object.keys(fields), i = 0; i < keys.length; i++) {
		const
			key = keys[i],
			el = <NonNullable<SystemField>>fields[key];

		if (el.atom || !el.init && (el.default !== undefined || key in instance)) {
			fieldList.unshift(key);

		} else {
			fieldList.push(key);
		}
	}

	while (true) {
		for (let i = 0; i < fieldList.length; i++) {
			const
				key = fieldList[i];

			if (key in data) {
				continue;
			}

			const
				el = <NonNullable<SystemField>>fields[key];

			let
				canInit = el.atom || atomQueue.size === 0;

			if (el.after.size) {
				for (let o = el.after.values(), val = o.next(); !val.done; val = o.next()) {
					const
						waitFieldKey = val.value,
						waitField = fields[waitFieldKey];

					if (!waitField) {
						throw new ReferenceError(`Field "${waitFieldKey}" is not defined`);
					}

					if (el.atom && !waitField.atom) {
						throw new Error(`Atom field "${key}" can't wait the non atom field "${waitFieldKey}"`);
					}

					if (!(waitFieldKey in data)) {
						queue.add(key);

						if (el.atom) {
							atomQueue.add(key);
						}

						canInit = false;
						break;
					}
				}
			}

			if (canInit) {
				ctx.$activeField = key;

				queue.delete(key);
				atomQueue.delete(key);

				let
					val;

				if (el.init) {
					val = el.init(<any>ctx, data);
				}

				if (val === undefined) {
					if (data[key] === undefined) {
						val = el.default !== undefined ? el.default : Object.fastClone(instance[key]);
						data[key] = val;
					}

				} else {
					data[key] = val;
				}
			}
		}

		if (!atomQueue.size && !queue.size) {
			break;
		}
	}

	return data;
}

/**
 * Runs a hook from the specified meta object
 *
 * @param hook
 * @param meta
 * @param ctx - link to context
 * @param args - event arguments
 */
export function runHook(
	hook: string,
	meta: ComponentMeta,
	ctx: Dictionary<any>,
	...args: unknown[]
): Promise<void> {
	ctx.hook = hook;

	if (Object.isFunction(ctx.log)) {
		ctx.log(`hook:${hook}`, ...args);

	} else {
		log(`component:hook:${meta.componentName}:${hook}`, ...args, ctx);
	}

	if (!meta.hooks[hook].length) {
		return createSyncPromise();
	}

	const event = {
		queue: [] as Function[],
		events: {} as Dictionary<{event: Set<string>; cb: Function}[]>,

		on(event: CanUndef<Set<string>>, cb: Function): void {
			if (event && event.size) {
				for (let v = event.values(), el = v.next(); !el.done; el = v.next()) {
					this.events[el.value] = this.events[el.value] || [];
					this.events[el.value].push({event, cb});
				}

				return;
			}

			this.queue.push(cb);
		},

		emit(event: string): CanPromise<void> {
			if (!this.events[event]) {
				return;
			}

			const
				tasks = <CanPromise<unknown>[]>[];

			for (let o = this.events[event], i = 0; i < o.length; i++) {
				const
					el = o[i];

				if (!el.event.delete(event).size) {
					const
						task = el.cb();

					if (Object.isPromise(task)) {
						tasks.push(task);
					}
				}
			}

			if (tasks.length) {
				return Promise.all(tasks).then(() => undefined);
			}
		},

		fire(): CanPromise<void> {
			const
				tasks = <Promise<unknown>[]>[];

			for (let i = 0; i < this.queue.length; i++) {
				const
					task = this.queue[i]();

				if (Object.isPromise(task)) {
					tasks.push(task);
				}
			}

			if (tasks.length) {
				return Promise.all(tasks).then(() => undefined);
			}
		}
	};

	for (let hooks = meta.hooks[hook], i = 0; i < hooks.length; i++) {
		const
			el = hooks[i];

		event.on(el.after, () => {
			const
				res = el.fn.apply(ctx, args),
				emit = () => event.emit(el.name || Math.random().toString());

			if (Object.isPromise(res)) {
				return res.then(emit);
			}

			const
				tasks = emit();

			if (Object.isPromise(tasks)) {
				return tasks;
			}
		});
	}

	const
		tasks = event.fire();

	if (Object.isPromise(tasks)) {
		return tasks;
	}

	return createSyncPromise();
}

/**
 * Returns a base component object from the specified constructor
 *
 * @param constructor
 * @param meta
 */
export function getBaseComponent(
	constructor: ComponentConstructor<any>,
	meta: ComponentMeta
): {
	mods: Dictionary<string>;
	component: ComponentMeta['component'];
	instance: Dictionary;
} {
	addMethodsToMeta(constructor, meta);

	const
		{component, methods, watchers, hooks} = meta,
		instance = new constructor();

	for (let o = methods, keys = Object.keys(o), i = 0; i < keys.length; i++) {
		const
			nm = keys[i],
			method = o[nm];

		if (!method) {
			continue;
		}

		component.methods[nm] =
			method.fn;

		for (let o = method.watchers, keys = Object.keys(o), i = 0; i < keys.length; i++) {
			const
				key = keys[i],
				el = <NonNullable<WatchOptionsWithHandler>>o[key],
				wList = watchers[key] = watchers[key] || [];

			wList.push({
				method: nm,
				group: el.group,
				single: el.single,
				options: el.options,
				args: (<unknown[]>[]).concat(el.args || []),
				provideArgs: el.provideArgs,
				deep: el.deep,
				immediate: el.immediate,
				wrapper: el.wrapper,
				handler: <any>method.fn
			});
		}

		for (let o = method.hooks, keys = Object.keys(o), i = 0; i < keys.length; i++) {
			const
				key = keys[i],
				el = o[key];

			hooks[key].push({
				name: el.name,
				fn: method.fn,
				after: el.after
			});
		}
	}

	for (let o = meta.computed, keys = Object.keys(o), i = 0; i < keys.length; i++) {
		const key = keys[i];
		component.computed[key] = o[key];
	}

	const canFunc = (type) => {
		if (!type) {
			return false;
		}

		if (Object.isArray(type)) {
			for (let i = 0; i < type.length; i++) {
				if (type[i] === Function) {
					return true;
				}
			}

			return false;
		}

		return type === Function;
	};

	const
		defaultProps = meta.params.defaultProps !== false;

	for (let o = meta.props, keys = Object.keys(o), i = 0; i < keys.length; i++) {
		const
			key = keys[i],
			prop = <NonNullable<ComponentProp>>o[key];

		let
			def,
			defWrapper,
			isFunc,
			skipDefault = true;

		if (defaultProps || prop.forceDefault) {
			skipDefault = false;
			def = defWrapper = instance[key];
			isFunc = canFunc(prop.type);

			if (def && typeof def === 'object' && (!isFunc || !Object.isFunction(def))) {
				defWrapper = () => Object.fastClone(def);
				defWrapper[defaultWrapper] = true;
			}
		}

		component.props[key] = {
			type: prop.type,
			required: prop.required,
			validator: prop.validator,
			default: !skipDefault ? prop.default !== undefined ? prop.default : defWrapper : undefined
		};

		const
			wList = watchers[key] = watchers[key] || [];

		for (let w = prop.watchers.values(), el = w.next(); !el.done; el = w.next()) {
			const
				val = el.value;

			wList.push({
				deep: val.deep,
				immediate: val.immediate,
				provideArgs: val.provideArgs,
				handler: val.fn
			});
		}
	}

	for (let o = meta.fields, keys = Object.keys(o), i = 0; i < keys.length; i++) {
		const
			key = keys[i],
			field = <NonNullable<ComponentField>>o[key];

		for (let w = field.watchers.values(), el = w.next(); !el.done; el = w.next()) {
			const
				val = el.value,
				wList = watchers[key] = watchers[key] || [];

			wList.push({
				deep: val.deep,
				immediate: val.immediate,
				provideArgs: val.provideArgs,
				handler: val.fn
			});
		}
	}

	const
		mods = component.mods;

	for (let o = meta.mods, keys = Object.keys(o), i = 0; i < keys.length; i++) {
		const
			key = keys[i],
			mod = o[key];

		let def;
		if (mod) {
			for (let i = 0; i < mod.length; i++) {
				const
					el = mod[i];

				if (Object.isArray(el)) {
					def = el;
					break;
				}
			}

			mods[key] = def ? String(def[0]) : undefined;
		}
	}

	return {mods, component, instance};
}

/**
 * Iterates the specified constructor prototype and adds methods/accessors to the meta object
 *
 * @param constructor
 * @param meta
 */
export function addMethodsToMeta(constructor: Function, meta: ComponentMeta): void {
	const
		proto = constructor.prototype,
		ownProps = Object.getOwnPropertyNames(proto);

	for (let i = 0; i < ownProps.length; i++) {
		const
			key = ownProps[i];

		if (key === 'constructor') {
			continue;
		}

		const
			desc = <PropertyDescriptor>Object.getOwnPropertyDescriptor(proto, key);

		if ('value' in desc) {
			const
				fn = desc.value;

			if (!Object.isFunction(fn)) {
				continue;
			}

			// tslint:disable-next-line:prefer-object-spread
			meta.methods[key] = Object.assign(meta.methods[key] || {watchers: {}, hooks: {}}, {fn});

		} else {
			const
				field = meta.props[key] ? meta.props : meta.fields[key] ? meta.fields : meta.systemFields,
				metaKey = key in meta.accessors ? 'accessors' : 'computed',
				obj = meta[metaKey];

			if (field[key]) {
				Object.defineProperty(proto, key, {
					writable: true,
					configurable: true,
					value: undefined
				});

				delete field[key];
			}

			const
				old = obj[key],
				set = desc.set || old && old.set,
				get = desc.get || old && old.get;

			if (set) {
				const
					k = `${key}Setter`;

				proto[k] = set;
				meta.methods[k] = {
					fn: set,
					watchers: {},
					hooks: {}
				};
			}

			if (get) {
				const
					k = `${key}Getter`;

				proto[k] = get;
				meta.methods[k] = {
					fn: get,
					watchers: {},
					hooks: {}
				};
			}

			Object.assign(obj, {
				[key]: {
					get: desc.get || old && old.get,
					set
				}
			});
		}
	}
}

function createSyncPromise<R = unknown>(val?: R, err?: unknown): Promise<R> {
	return <any>{
		then: (resolve, reject) => {
			try {
				if (err !== undefined) {
					return createSyncPromise(undefined, reject ? reject(err) : err);
				}

				return createSyncPromise(resolve ? resolve(val) : val);

			} catch (err) {
				return createSyncPromise(undefined, reject ? reject(err) : err);
			}
		},

		catch: (cb) => createSyncPromise(undefined, cb(err)),
		finally: (cb) => createSyncPromise(cb())
	};
}

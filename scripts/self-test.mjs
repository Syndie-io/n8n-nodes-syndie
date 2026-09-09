// Self-test for the built package: `pnpm build && pnpm test`.
//
// n8n community nodes have no test harness of their own, and the interesting
// behaviour here — what the trigger does on activation, what it refuses on
// delivery, what the action sends — is all reachable by calling the compiled
// node with a stubbed n8n context. Every check below drives dist/ the way n8n
// would and asserts what the backend would see or what the workflow would get.
//
// It runs in CI after the build, and locally in a second or so. It needs no
// network, no n8n and no credentials.

import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const helpers = require(join(root, 'dist/nodes/Syndie/GenericFunctions.js'));
const { SyndieTrigger } = require(join(root, 'dist/nodes/Syndie/SyndieTrigger.node.js'));
const { Syndie } = require(join(root, 'dist/nodes/Syndie/Syndie.node.js'));
const { SyndieOAuth2Api } = require(join(root, 'dist/credentials/SyndieOAuth2Api.credentials.js'));

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
	if (ok) {
		passed += 1;
		console.log(`  ok   ${name}`);
	} else {
		failed += 1;
		console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`);
	}
}

async function throws(run) {
	try {
		await run();
		return null;
	} catch (error) {
		return error;
	}
}

const SECRET = 'b'.repeat(64);
const node = () => ({ name: 'Syndie', type: 'syndie', typeVersion: 1 });

function sign(secret, body, t) {
	return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

// ─── the credential ─────────────────────────────────────────────────────────

function credential() {
	console.log('\ncredential');
	const c = new SyndieOAuth2Api();
	const byName = Object.fromEntries(c.properties.map((p) => [p.name, p]));
	check('defaults to the production API', byName.baseUrl.default === 'https://api.syndie.io');
	check(
		'the two OAuth URLs are built from the base URL field',
		byName.authUrl.default ===
			'={{ $self["baseUrl"].replace(/\\/+$/, "") }}/api/integrations/automation/n8n/oauth/authorize' &&
			byName.accessTokenUrl.default ===
				'={{ $self["baseUrl"].replace(/\\/+$/, "") }}/api/integrations/automation/n8n/oauth/token',
		`${byName.authUrl.default} | ${byName.accessTokenUrl.default}`,
	);
	check('PKCE stays on', byName.pkce.default === true);
}

// ─── the signature helpers ─────────────────────────────────────────────────

function signature() {
	console.log('\nsignature');
	const body = '{"id":"evt-1","event":"lead.replied"}';
	const t = Math.floor(Date.now() / 1000);
	const good = sign(SECRET, body, t);
	const verify = (header, raw = body, secret = SECRET) =>
		helpers.verifySyndieSignature({ secret, rawBody: raw, header });

	check('a valid signature verifies', verify(good) === true);
	check('a Buffer body verifies the same', verify(good, Buffer.from(body)) === true);
	check('one byte more in the body fails', verify(good, `${body} `) === false);
	check('another secret fails', verify(good, body, 'c'.repeat(64)) === false);
	check('a stamp ten minutes old fails', verify(sign(SECRET, body, t - 600)) === false);
	check('a stamp ten minutes ahead fails', verify(sign(SECRET, body, t + 600)) === false);
	check('a missing header fails', verify(undefined) === false);
	check('a malformed header fails', verify('t=abc,v1=zz') === false);
	check('a v1 of the wrong length is ignored', verify(`t=${t},v1=abcd`) === false);
	check(
		'a rotated secret is accepted through a second v1',
		verify(`t=${t},v1=${'f'.repeat(64)},v1=${good.split('v1=')[1]}`) === true,
	);
	check('parse rejects a header without a stamp', helpers.parseSignatureHeader(`v1=${'a'.repeat(64)}`) === null);
	check(
		'parse lower-cases the hex and keeps every v1',
		JSON.stringify(helpers.parseSignatureHeader(`t=5,v1=${'A'.repeat(64)},v1=${'b'.repeat(64)}`)) ===
			JSON.stringify({ timestamp: 5, signatures: ['a'.repeat(64), 'b'.repeat(64)] }),
	);
}

// ─── static data and secret selection ──────────────────────────────────────

function staticData() {
	console.log('\nstatic data');
	const legacy = helpers.readSubscriptions({ webhookId: 'old' });
	check(
		'a 0.3.x record reads as one default subscription without a secret',
		legacy.length === 1 && legacy[0].webhookId === 'old' && legacy[0].event === 'default' && legacy[0].signingSecret === undefined,
	);
	check('an empty record reads as nothing', helpers.readSubscriptions({}).length === 0);
	check(
		'malformed entries are dropped',
		helpers.readSubscriptions({ subscriptions: [null, 'x', { event: 'a' }, { webhookId: 'ok', event: 'a', targetUrl: '' }] }).length === 1,
	);
	const withSecret = [{ webhookId: 'a', event: 'lead.replied', targetUrl: '', signingSecret: SECRET }];
	check('legacy record: let through', helpers.selectSigningSecret(legacy, 'old').kind === 'legacy');
	check('nothing on record: reject', helpers.selectSigningSecret([], 'a').kind === 'reject');
	check('known id: verify with its secret', helpers.selectSigningSecret(withSecret, 'a').secret === SECRET);
	check('unknown id: reject', helpers.selectSigningSecret(withSecret, 'b').kind === 'reject');
	check('no id when secrets exist: reject', helpers.selectSigningSecret(withSecret, undefined).kind === 'reject');
}

// ─── event resolution and URLs ─────────────────────────────────────────────

function events() {
	console.log('\nevents and URLs');
	const ctx = { getNode: node };
	check('six events, sorted by display name', helpers.SYNDIE_EVENTS.length === 6 && helpers.SYNDIE_EVENTS.map((e) => e.name).join() === [...helpers.SYNDIE_EVENTS.map((e) => e.name)].sort().join());
	check('all six becomes default', JSON.stringify(helpers.resolveEventTypes.call(ctx, [...helpers.ALL_EVENT_VALUES])) === '["default"]');
	check('a subset stays a subset', JSON.stringify(helpers.resolveEventTypes.call(ctx, ['lead.replied', 'nonsense'])) === '["lead.replied"]');
	const empty = (() => { try { helpers.resolveEventTypes.call(ctx, []); return null; } catch (e) { return e; } })();
	check('nothing selected is refused', empty !== null && empty.constructor.name === 'NodeOperationError');
	check('URLs join base, prefix and path', helpers.syndieApiUrl('https://x.io', 'hooks/subscribe') === 'https://x.io/api/integrations/automation/n8n/hooks/subscribe');
	check('the subscribe reply is read plain or wrapped', helpers.unwrapSubscribeResponse({ id: 7 }).id === '7' && helpers.unwrapSubscribeResponse({ success: true, data: { id: 'x', signing_secret: 's' } }).signingSecret === 's');
	check('404 is recognised in both error shapes', helpers.isNotFoundError({ httpCode: '404' }) && helpers.isNotFoundError({ response: { status: 404 } }) && !helpers.isNotFoundError({ httpCode: '500' }));
}

// ─── the trigger: activation and deactivation ──────────────────────────────

function hookContext(overrides = {}) {
	const calls = [];
	let counter = 0;
	const data = overrides.staticData ?? {};
	const ctx = {
		calls,
		staticData: data,
		events: overrides.events ?? [],
		getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/abc',
		getWorkflow: () => ({ id: 'wf1', name: 'Test flow' }),
		getCredentials: async () => ({ baseUrl: overrides.baseUrl ?? 'https://dev-api.syndie.io/' }),
		getNodeParameter: (name, fallback) => (name === 'events' ? ctx.events : fallback),
		getWorkflowStaticData: () => data,
		getNode: node,
		helpers: {
			httpRequestWithAuthentication: async (_cred, opts) => {
				calls.push(opts);
				if (opts.method === 'POST' && overrides.failOn === opts.body.event_type) {
					const e = new Error('boom'); e.httpCode = '500'; throw e;
				}
				if (opts.method === 'DELETE' && overrides.deleteFails && opts.url.endsWith(overrides.deleteFails)) {
					const e = new Error('nope'); e.httpCode = '500'; throw e;
				}
				if (opts.method === 'DELETE' && opts.url.endsWith('/gone')) {
					const e = new Error('nf'); e.httpCode = '404'; throw e;
				}
				counter += 1;
				return { id: `sub${counter}`, signing_secret: 's'.repeat(64) };
			},
		},
	};
	return ctx;
}

async function trigger() {
	console.log('\ntrigger: activation');
	const methods = new SyndieTrigger().webhookMethods.default;

	let ctx = hookContext({ events: ['lead.replied', 'meeting.booked'] });
	await methods.create.call(ctx);
	const posted = ctx.calls.filter((c) => c.method === 'POST');
	check('a subset subscribes once per event', posted.map((c) => c.body.event_type).join() === 'lead.replied,meeting.booked');
	check('the URL comes from the credential, trailing slash removed', posted[0].url === 'https://dev-api.syndie.io/api/integrations/automation/n8n/hooks/subscribe', posted[0].url);
	check('subscriptions and secrets are remembered', ctx.staticData.subscriptions.length === 2 && ctx.staticData.subscriptions.every((s) => s.signingSecret.length === 64));

	ctx = hookContext({ events: [...helpers.ALL_EVENT_VALUES], staticData: { webhookId: 'legacy' } });
	await methods.create.call(ctx);
	check(
		'all six: one default subscription, and the record left by an older version is removed rather than stranded',
		ctx.calls.filter((c) => c.method === 'POST').length === 1 &&
			ctx.calls[0].body.event_type === 'default' &&
			ctx.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/hooks/legacy')) &&
			ctx.staticData.webhookId === undefined &&
			ctx.staticData.subscriptions.length === 1,
		JSON.stringify({ calls: ctx.calls.map((c) => `${c.method} ${c.url}`), staticData: ctx.staticData }),
	);

	ctx = hookContext({
		events: ['lead.replied'],
		staticData: { subscriptions: [{ webhookId: 'orphan', event: 'x', targetUrl: '' }] },
		deleteFails: '/hooks/orphan',
	});
	await methods.create.call(ctx);
	check(
		'a leftover that still cannot be removed stays on record for the next attempt',
		ctx.staticData.subscriptions.some((s) => s.webhookId === 'orphan') &&
			ctx.staticData.subscriptions.length === 2,
		JSON.stringify(ctx.staticData),
	);

	ctx = hookContext({ events: ['lead.replied', 'meeting.booked'], failOn: 'meeting.booked' });
	let error = await throws(() => methods.create.call(ctx));
	check(
		'a failure part-way rolls back, and the error explains what to check',
		error?.constructor.name === 'NodeOperationError' &&
			/reachable over https/.test(error.description ?? '') &&
			ctx.calls.filter((c) => c.method === 'DELETE').length === 1 &&
			ctx.staticData.subscriptions === undefined,
		`${error?.constructor.name}: ${error?.description}`,
	);

	ctx = hookContext({ events: ['lead.replied'], baseUrl: 'http://localhost:3000' });
	error = await throws(() => methods.create.call(ctx));
	check('an http base URL is refused before any request', error !== null && /https:\/\//.test(error.message) && ctx.calls.length === 0);

	console.log('\ntrigger: deactivation');
	ctx = hookContext({ staticData: { subscriptions: [{ webhookId: 'a1', event: 'x', targetUrl: '' }, { webhookId: 'gone', event: 'y', targetUrl: '' }] } });
	await methods.delete.call(ctx);
	check('every subscription is removed, 404 counts as removed', ctx.calls.length === 2 && ctx.staticData.subscriptions === undefined);

	ctx = hookContext({ staticData: { webhookId: 'legacy' } });
	await methods.delete.call(ctx);
	check('a 0.3.x record is removed through its id', ctx.calls[0].url.endsWith('/hooks/legacy') && ctx.staticData.webhookId === undefined);

	ctx = hookContext({ staticData: { subscriptions: [{ webhookId: 'keep', event: 'x', targetUrl: '' }, { webhookId: 'ok', event: 'y', targetUrl: '' }] }, deleteFails: '/hooks/keep' });
	error = await throws(() => methods.delete.call(ctx));
	check('a failed removal is kept on record and reported once', error !== null && ctx.staticData.subscriptions.length === 1 && ctx.staticData.subscriptions[0].webhookId === 'keep');

	check('checkExists is always false', (await methods.checkExists.call(hookContext())) === false);
}

// ─── the trigger: deliveries ───────────────────────────────────────────────

function webhookContext({ staticData, headers, raw, warnings, chosen, event }) {
	const rawBody = raw ?? JSON.stringify({ id: 'evt-1', event: event ?? 'lead.replied' });
	const response = { statusCode: null, body: null };
	return {
		response,
		getRequestObject: () => (raw === null ? {} : { rawBody: Buffer.from(rawBody) }),
		getResponseObject: () => ({
			status(code) { response.statusCode = code; return this; },
			json(body) { response.body = body; return this; },
		}),
		getHeaderData: () => headers,
		getBodyData: () => JSON.parse(rawBody),
		getNodeParameter: (name, fallback) =>
			name === 'events' ? (chosen ?? [...helpers.ALL_EVENT_VALUES]) : fallback,
		getWorkflowStaticData: () => staticData,
		getNode: node,
		logger: { warn: (m) => warnings.push(m), info() {}, debug() {}, error() {} },
	};
}

async function deliveries() {
	console.log('\ntrigger: deliveries');
	const t = new SyndieTrigger();
	const now = Math.floor(Date.now() / 1000);
	const rawBody = JSON.stringify({ id: 'evt-1', event: 'lead.replied' });
	const withSecret = { subscriptions: [{ webhookId: 'sub1', event: 'lead.replied', targetUrl: 'x', signingSecret: SECRET }] };
	const good = { 'x-webhook-signature': sign(SECRET, rawBody, now), 'x-webhook-subscription-id': 'sub1' };
	const run = async (opts) => {
		const warnings = [];
		const ctx = webhookContext({ warnings, ...opts });
		const out = await t.webhook.call(ctx);
		return { out, status: ctx.response.statusCode, body: ctx.response.body, warnings };
	};

	let r = await run({ staticData: withSecret, headers: good });
	check('a correctly signed delivery starts the workflow', r.out.workflowData?.[0][0].json.id === 'evt-1' && r.status === null && r.warnings.length === 0);
	r = await run({ staticData: withSecret, headers: { ...good, 'x-webhook-signature': sign(SECRET, `${rawBody} `, now) } });
	check('other bytes: 401, no run', r.status === 401 && r.out.noWebhookResponse === true && !r.out.workflowData);
	r = await run({ staticData: withSecret, headers: { ...good, 'x-webhook-signature': sign(SECRET, rawBody, now - 600) } });
	check('a stale stamp: 401', r.status === 401);
	r = await run({ staticData: withSecret, headers: { ...good, 'x-webhook-subscription-id': 'other' } });
	check('an unknown subscription id: 401', r.status === 401 && /does not hold/.test(r.body.error));
	r = await run({ staticData: withSecret, headers: {} });
	check('no headers: 401', r.status === 401);
	r = await run({ staticData: {}, headers: good });
	check('nothing on record: 401', r.status === 401);
	r = await run({ staticData: { webhookId: 'legacy' }, headers: {} });
	check('a 0.3.x activation is let through with one warning', r.out.workflowData?.[0][0].json.id === 'evt-1' && r.warnings.length === 1);
	r = await run({ staticData: withSecret, headers: good, raw: null });
	check('no raw body: the check runs over the re-serialised JSON', r.out.workflowData && r.status === null);

	const unchosen = JSON.stringify({ id: 'evt-2', event: 'lead.opted_out' });
	r = await run({
		staticData: withSecret,
		headers: {
			'x-webhook-signature': sign(SECRET, unchosen, now),
			'x-webhook-subscription-id': 'sub1',
		},
		raw: unchosen,
		chosen: ['lead.replied'],
	});
	check(
		'a signed event this workflow did not ask for is acknowledged and does not run it',
		!r.out.workflowData && r.status === null,
		JSON.stringify(r),
	);

	r = await run({
		staticData: withSecret,
		headers: good,
		chosen: ['lead.replied'],
	});
	check('a signed event it did ask for still runs it', !!r.out.workflowData);
}

// ─── the action ────────────────────────────────────────────────────────────

function executeContext({ items, params, continueOnFail = false, fail = false, baseUrl }) {
	const calls = [];
	return {
		calls,
		getInputData: () => items,
		getNodeParameter: (name, i, fallback) => (name in (params[i] ?? {}) ? params[i][name] : fallback),
		continueOnFail: () => continueOnFail,
		getCredentials: async () => ({ baseUrl: baseUrl ?? 'https://dev-api.syndie.io' }),
		getNode: node,
		helpers: {
			httpRequestWithAuthentication: async (_cred, opts) => {
				calls.push(opts);
				if (fail) { const e = new Error('upstream said no'); e.httpCode = '400'; throw e; }
				return opts.method === 'GET' ? { found: false, lead: null } : { created: true, lead: { id: 'l1' } };
			},
		},
	};
}

async function action() {
	console.log('\naction');
	const n = new Syndie();
	const item = { json: {} };

	let ctx = executeContext({ items: [item], params: [{ operation: 'create', linkedinUrl: ' https://www.linkedin.com/in/Sarah-Green/ ', email: 'sarah@kestrel.io', additionalFields: { firstName: 'Sarah', jobTitle: 'Head of Talent', company: '', connectionStatus: 'accepted' } }] });
	let out = await n.execute.call(ctx);
	check('import posts only the filled-in fields, trimmed, never connectionStatus', JSON.stringify(ctx.calls[0].body) === JSON.stringify({ linkedinUrl: 'https://www.linkedin.com/in/Sarah-Green/', email: 'sarah@kestrel.io', firstName: 'Sarah', jobTitle: 'Head of Talent' }) && ctx.calls[0].url.endsWith('/actions/import-lead'), JSON.stringify(ctx.calls[0]));
	check('the reply is the output item', out[0][0].json.created === true && out[0][0].pairedItem.item === 0);

	ctx = executeContext({ items: [item], params: [{ operation: 'create', additionalFields: { linkedinUrl: 'https://linkedin.com/in/old-layout' } }] });
	await n.execute.call(ctx);
	check('a 0.3.x workflow with the URL inside Additional Fields still sends it', ctx.calls[0].body.linkedinUrl === 'https://linkedin.com/in/old-layout');

	ctx = executeContext({ items: [item], params: [{ operation: 'create', additionalFields: { firstName: 'Nameless' } }] });
	let error = await throws(() => n.execute.call(ctx));
	check('nothing to match on is refused before any request', error?.constructor.name === 'NodeOperationError' && ctx.calls.length === 0);

	ctx = executeContext({ items: [item], params: [{ operation: 'find', linkedin: 'linkedin.com/in/sarah-green' }] });
	out = await n.execute.call(ctx);
	check('find sends a GET with the query and returns found: false as an item', ctx.calls[0].method === 'GET' && ctx.calls[0].qs.linkedin === 'linkedin.com/in/sarah-green' && out[0][0].json.found === false);

	ctx = executeContext({ items: [item], params: [{ operation: 'find' }] });
	error = await throws(() => n.execute.call(ctx));
	check('a find with nothing to look up by is refused', error?.constructor.name === 'NodeOperationError' && ctx.calls.length === 0);

	ctx = executeContext({ items: [item, item], params: [{ operation: 'create', email: 'a@b.co' }, { operation: 'create', email: 'c@d.co' }], continueOnFail: true, fail: true });
	out = await n.execute.call(ctx);
	check('Continue On Fail turns an upstream error into an error item and goes on', out[0].length === 2 && out[0][1].json.error === 'upstream said no');

	ctx = executeContext({ items: [item], params: [{ operation: 'create', email: 'a@b.co' }], fail: true });
	error = await throws(() => n.execute.call(ctx));
	check(
		'without it the failure names the item and keeps the upstream message',
		error?.context?.itemIndex === 0 && /upstream said no/.test(error?.message ?? ''),
		`${error?.constructor.name}: ${error?.message} ${JSON.stringify(error?.context)}`,
	);

	ctx = executeContext({
		items: [item],
		params: [{ operation: 'create', email: 'a@b.co' }],
		continueOnFail: true,
		baseUrl: 'http://localhost:5678',
	});
	out = await n.execute.call(ctx);
	check(
		'a credential the node cannot use is caught by Continue On Fail, not thrown past it',
		out[0].length === 1 && /https:\/\//.test(out[0][0].json.error ?? ''),
		JSON.stringify(out),
	);
}

console.log('n8n-nodes-syndie self-test (built package, stubbed n8n context)');
credential();
signature();
staticData();
events();
await trigger();
await deliveries();
await action();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

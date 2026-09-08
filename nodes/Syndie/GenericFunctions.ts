import { createHmac, timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	INodePropertyOptions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import {
	SYNDIE_API_BASE_URL,
	SYNDIE_N8N_API_PATH,
} from '../../credentials/SyndieOAuth2Api.credentials';

/**
 * The six events the backend can deliver. `value` is the name the backend
 * expects in `event_type`; `name` is what the person sees in the node.
 * Sorted by display name, which is what the n8n linter checks.
 */
export const SYNDIE_EVENTS: INodePropertyOptions[] = [
	{
		name: 'Connection Accepted',
		value: 'lead.connection_accepted',
		description: 'A lead accepted the connection request',
	},
	{
		name: 'Conversation Handed Off',
		value: 'conversation.handed_off',
		description: 'The AI SDR handed the conversation to a person',
	},
	{
		name: 'Lead Opted Out',
		value: 'lead.opted_out',
		description: 'The lead asked to stop, complained, or was blocked by hand',
	},
	{
		name: 'Lead Replied',
		value: 'lead.replied',
		description: 'A lead answered on LinkedIn or by email',
	},
	{
		name: 'Meeting Booked',
		value: 'meeting.booked',
		description: 'The lead booked a meeting',
	},
	{
		name: 'Status Changed',
		value: 'lead.status_changed',
		description: "Somebody changed the lead's status in Syndie",
	},
];

export const ALL_EVENT_VALUES = SYNDIE_EVENTS.map((event) => event.value as string);

/** What the backend calls "every event on one subscription". */
export const DEFAULT_EVENT_TYPE = 'default';

/** Header names the backend puts on every delivery. */
export const SIGNATURE_HEADER = 'x-webhook-signature';
export const SUBSCRIPTION_HEADER = 'x-webhook-subscription-id';
export const EVENT_ID_HEADER = 'x-webhook-event-id';

/** How old a signed delivery may be before it is refused, in seconds. */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/** One backend subscription, as remembered in the trigger's static data. */
export interface SyndieSubscription {
	webhookId: string;
	event: string;
	targetUrl: string;
	signingSecret?: string;
}

type SyndieContext = IHookFunctions | IExecuteFunctions | IWebhookFunctions;

/**
 * The API address from the credential's "API Base URL" field, with any
 * trailing slash removed. Empty means production. Anything that is not https
 * is refused: the backend only ever registers https targets and only ever
 * answers over https, so a plain http address can never work and should fail
 * here, with a clear message, rather than deep inside an OAuth redirect.
 */
export async function getSyndieBaseUrl(this: SyndieContext): Promise<string> {
	const credentials = (await this.getCredentials('syndieOAuth2Api')) as IDataObject;
	const configured = typeof credentials.baseUrl === 'string' ? credentials.baseUrl.trim() : '';
	const baseUrl = (configured || SYNDIE_API_BASE_URL).replace(/\/+$/, '');
	if (!/^https:\/\//i.test(baseUrl)) {
		throw new NodeOperationError(
			this.getNode(),
			'The API Base URL in the Syndie credential must start with https://',
			{ description: `It is currently "${baseUrl}".` },
		);
	}
	return baseUrl;
}

/** Builds a full backend URL from the base and a path under the n8n API prefix. */
export function syndieApiUrl(baseUrl: string, path: string): string {
	return `${baseUrl}${SYNDIE_N8N_API_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Turns the events picked in the trigger into what to subscribe to. All six
 * picked means one "default" subscription, which is also what a node built
 * before this version sends, so old and new installs look the same to the
 * backend. A subset means one subscription per event.
 */
export function resolveEventTypes(this: SyndieContext, selected: string[]): string[] {
	const wanted = selected.filter((event) => ALL_EVENT_VALUES.includes(event));
	if (wanted.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Pick at least one event to listen for');
	}
	if (ALL_EVENT_VALUES.every((event) => wanted.includes(event))) {
		return [DEFAULT_EVENT_TYPE];
	}
	return wanted;
}

/**
 * The subscribe reply is a plain object on current backends and, for one
 * release, may still arrive wrapped as `{ success, data }` from an older one.
 * Both shapes yield the subscription id and, when the backend issues one, the
 * signing secret.
 */
export function unwrapSubscribeResponse(response: unknown): {
	id: string;
	signingSecret?: string;
} {
	const body = (response ?? {}) as IDataObject;
	const inner = (body.data && typeof body.data === 'object' ? body.data : body) as IDataObject;
	const id = inner.id;
	if (typeof id !== 'string' && typeof id !== 'number') {
		throw new Error('The subscribe reply carried no subscription id');
	}
	const secret = inner.signing_secret;
	return {
		id: String(id),
		signingSecret: typeof secret === 'string' && secret.length > 0 ? secret : undefined,
	};
}

/**
 * Subscriptions remembered by an earlier activation. A workflow activated on
 * 0.3.x stored a single `webhookId` and no secret; it is read back as one
 * "default" subscription so deactivation still removes it and, until the
 * workflow is re-activated, its deliveries are accepted without a signature.
 */
export function readSubscriptions(staticData: IDataObject): SyndieSubscription[] {
	const stored = staticData.subscriptions;
	if (Array.isArray(stored)) {
		return stored.filter(
			(entry): entry is SyndieSubscription =>
				!!entry && typeof entry === 'object' && typeof (entry as IDataObject).webhookId === 'string',
		);
	}
	const legacyId = staticData.webhookId;
	if (typeof legacyId === 'string' || typeof legacyId === 'number') {
		return [{ webhookId: String(legacyId), event: DEFAULT_EVENT_TYPE, targetUrl: '' }];
	}
	return [];
}

/**
 * n8n wraps HTTP failures in NodeApiError, whose `httpCode` is a string; the
 * raw client error carries a numeric status instead. Either way, "not found"
 * on an unsubscribe means the backend already forgot the subscription.
 */
export function isNotFoundError(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const candidate = error as {
		httpCode?: unknown;
		statusCode?: unknown;
		response?: { status?: unknown };
	};
	return (
		candidate.httpCode === '404' ||
		candidate.httpCode === 404 ||
		candidate.statusCode === 404 ||
		candidate.response?.status === 404
	);
}

export interface ParsedSignature {
	timestamp: number;
	signatures: string[];
}

/**
 * `t=<unix seconds>,v1=<hex>[,v1=<hex>]` — more than one v1 is allowed so a
 * secret can be rotated without a gap. Anything else parses as null.
 */
export function parseSignatureHeader(header: string | undefined): ParsedSignature | null {
	if (!header) return null;
	let timestamp: number | null = null;
	const signatures: string[] = [];
	for (const part of header.split(',')) {
		const [key, value] = part.trim().split('=');
		if (key === 't' && /^\d+$/.test(value ?? '')) timestamp = Number(value);
		if (key === 'v1' && /^[0-9a-f]{64}$/i.test(value ?? '')) signatures.push(value.toLowerCase());
	}
	if (timestamp === null || signatures.length === 0) return null;
	return { timestamp, signatures };
}

export interface VerifySignatureInput {
	secret: string;
	rawBody: string | Buffer;
	header: string | undefined;
	nowSeconds?: number;
	toleranceSeconds?: number;
}

/**
 * True when one of the header's signatures is the HMAC-SHA256 of
 * `<t>.<raw body>` under the secret and `t` is within the tolerance of now.
 * The comparison is constant-time; the body is the exact bytes received.
 */
export function verifySyndieSignature(input: VerifySignatureInput): boolean {
	const parsed = parseSignatureHeader(input.header);
	if (!parsed) return false;
	const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
	const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
	if (Math.abs(now - parsed.timestamp) > tolerance) return false;

	const body = Buffer.isBuffer(input.rawBody) ? input.rawBody : Buffer.from(input.rawBody, 'utf8');
	const expected = createHmac('sha256', input.secret)
		.update(`${parsed.timestamp}.`)
		.update(body)
		.digest();

	return parsed.signatures.some((candidate) => {
		const given = Buffer.from(candidate, 'hex');
		return given.length === expected.length && timingSafeEqual(given, expected);
	});
}

export type SecretSelection =
	| { kind: 'verify'; secret: string }
	| { kind: 'legacy' }
	| { kind: 'reject'; reason: string };

/**
 * Which secret a delivery must be checked against, from the subscription id
 * the backend put in the header and what the trigger remembered when it
 * subscribed. A workflow activated before secrets existed has none stored,
 * and its deliveries are let through until it is re-activated. A delivery
 * naming a subscription the trigger does not know, or one it knows without
 * a secret while others have one, is refused.
 */
export function selectSigningSecret(
	subscriptions: SyndieSubscription[],
	subscriptionId: string | undefined,
): SecretSelection {
	const withSecret = subscriptions.filter((entry) => !!entry.signingSecret);
	if (withSecret.length === 0) {
		return subscriptions.length > 0
			? { kind: 'legacy' }
			: { kind: 'reject', reason: 'this workflow has no subscription on record' };
	}
	if (!subscriptionId) {
		return { kind: 'reject', reason: 'the delivery named no subscription' };
	}
	const match = withSecret.find((entry) => entry.webhookId === subscriptionId);
	if (!match) {
		return { kind: 'reject', reason: 'the delivery named a subscription this workflow does not hold' };
	}
	return { kind: 'verify', secret: match.signingSecret as string };
}

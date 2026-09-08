import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
	SIGNATURE_HEADER,
	SUBSCRIPTION_HEADER,
	SYNDIE_EVENTS,
	getSyndieBaseUrl,
	isNotFoundError,
	readSubscriptions,
	resolveEventTypes,
	selectSigningSecret,
	syndieApiUrl,
	unwrapSubscribeResponse,
	verifySyndieSignature,
	type SyndieSubscription,
} from './GenericFunctions';

function headerValue(headers: IDataObject, name: string): string | undefined {
	const value = headers[name] ?? headers[name.toLowerCase()];
	if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
	return typeof value === 'string' ? value : undefined;
}

/**
 * Answer 401 ourselves and tell n8n the response is handled, so a refused
 * delivery neither starts the workflow nor gets n8n's own 200.
 */
function refuse(this: IWebhookFunctions, reason: string): IWebhookResponseData {
	this.getResponseObject()
		.status(401)
		.json({ error: `Delivery refused: ${reason}` });
	return { noWebhookResponse: true };
}

/**
 * Removes subscriptions without raising: used to roll back a part-finished
 * activation, and to clear leftovers a previous deactivation could not remove.
 * Returns the ones still on the backend, so they stay on record and the next
 * attempt tries again rather than stranding them.
 */
async function removeSubscriptions(
	this: IHookFunctions,
	baseUrl: string,
	subscriptions: SyndieSubscription[],
): Promise<SyndieSubscription[]> {
	const remaining: SyndieSubscription[] = [];
	for (const subscription of subscriptions) {
		try {
			await this.helpers.httpRequestWithAuthentication.call(this, 'syndieOAuth2Api', {
				method: 'DELETE',
				url: syndieApiUrl(baseUrl, `/hooks/${subscription.webhookId}`),
				json: true,
			});
		} catch (error) {
			if (!isNotFoundError(error)) remaining.push(subscription);
		}
	}
	return remaining;
}

export class SyndieTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Syndie Trigger',
		name: 'syndieTrigger',
		icon: { light: 'file:SyndieLogo.svg', dark: 'file:SyndieLogo.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{ ($parameter["events"] || []).length === 6 ? "All events" : ($parameter["events"] || []).length + " event(s)" }}',
		description: 'Starts the workflow when something happens to a lead in Syndie',
		defaults: {
			name: 'Syndie Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'syndieOAuth2Api',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [
					'lead.connection_accepted',
					'conversation.handed_off',
					'lead.opted_out',
					'lead.replied',
					'meeting.booked',
					'lead.status_changed',
				],
				options: SYNDIE_EVENTS,
				description:
					'Which events start this workflow. Leaving all of them selected receives every event on one subscription.',
			},
		],
	};

	// Every delivery must carry a signature made with the secret the backend
	// handed out when this node subscribed. The one exception is a workflow
	// activated on 0.3.x, which holds a subscription but no secret: it is let
	// through with a warning until it is re-activated, so an upgrade does not
	// silently stop it.
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const headers = this.getHeaderData() as IDataObject;
		const subscriptions = readSubscriptions(this.getWorkflowStaticData('node'));
		const selection = selectSigningSecret(subscriptions, headerValue(headers, SUBSCRIPTION_HEADER));

		if (selection.kind === 'reject') {
			return refuse.call(this, selection.reason);
		}

		if (selection.kind === 'verify') {
			const request = this.getRequestObject() as unknown as { rawBody?: Buffer };
			const rawBody = request.rawBody ?? JSON.stringify(this.getBodyData());
			const verified = verifySyndieSignature({
				secret: selection.secret,
				rawBody,
				header: headerValue(headers, SIGNATURE_HEADER),
			});
			if (!verified) {
				return refuse.call(this, 'the signature did not match');
			}
		} else {
			this.logger.warn(
				'Syndie Trigger: this workflow was activated by an older version and its deliveries are not signed. Re-activate it once to start checking signatures.',
			);
		}

		// Only now that the delivery is known to be genuine is its content worth
		// reading. Selecting all six events subscribes to the backend's catch-all,
		// so an event added there later would reach a workflow that never asked for
		// it: what this node was told to listen for is the authority, not the
		// subscription. Acknowledged with 200, no run.
		const body = this.getBodyData() as IDataObject;
		const chosen = this.getNodeParameter('events', []) as string[];
		if (
			typeof body.event === 'string' &&
			chosen.length > 0 &&
			!chosen.includes(body.event)
		) {
			return {};
		}

		return {
			workflowData: [[{ json: body }]],
		};
	}

	webhookMethods = {
		default: {
			// Always (re)create: the backend returns the existing subscription and
			// its secret for the same URL and event, so there is nothing to look up.
			checkExists: async function (this: IHookFunctions): Promise<boolean> {
				return false;
			},

			// One subscription per chosen event, or a single "default" one when
			// every event is chosen. What comes back (id and signing secret) is
			// remembered so deliveries can be checked and deactivation can clean up.
			create: async function (this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const workflow = this.getWorkflow();
				const baseUrl = await getSyndieBaseUrl.call(this);
				const selected = this.getNodeParameter('events', []) as string[];
				const eventTypes = resolveEventTypes.call(this, selected);
				const staticData = this.getWorkflowStaticData('node');
				// A previous deactivation may have failed to remove some
				// subscriptions and deliberately kept them on record. Overwriting
				// that record would strand them: still live on the backend, posting
				// to this same URL under an id this node no longer holds.
				const leftovers = readSubscriptions(staticData);
				const created: SyndieSubscription[] = [];

				for (const eventType of eventTypes) {
					try {
						const response = await this.helpers.httpRequestWithAuthentication.call(
							this,
							'syndieOAuth2Api',
							{
								method: 'POST',
								url: syndieApiUrl(baseUrl, '/hooks/subscribe'),
								body: {
									automation_name: workflow.name || `n8n-workflow-${workflow.id}`,
									automation_id: workflow.id,
									event_type: eventType,
									target_url: webhookUrl,
								},
								json: true,
							},
						);
						const { id, signingSecret } = unwrapSubscribeResponse(response);
						created.push({ webhookId: id, event: eventType, targetUrl: webhookUrl, signingSecret });
					} catch (error) {
						await removeSubscriptions.call(this, baseUrl, created);
						// Not NodeApiError: its constructor hands back an existing
						// NodeApiError unchanged, so the hint below would be dropped.
						throw new NodeOperationError(this.getNode(), error as Error, {
							description: `Could not subscribe to "${eventType}" events. Check that the credential is connected and that this n8n is reachable over https.`,
						});
					}
				}

				const stranded = leftovers.filter(
					(old) => !created.some((fresh) => fresh.webhookId === old.webhookId),
				);
				const stillStranded = await removeSubscriptions.call(this, baseUrl, stranded);

				staticData.subscriptions = [
					...created,
					...stillStranded,
				] as unknown as IDataObject[];
				delete staticData.webhookId;
				return true;
			},

			// Remove every subscription this node holds. "Already gone" counts as
			// removed. Anything else is kept on record and reported once, so the
			// next deactivation can try again.
			delete: async function (this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const subscriptions = readSubscriptions(staticData);
				if (subscriptions.length === 0) {
					return true;
				}

				const baseUrl = await getSyndieBaseUrl.call(this);
				const kept = await removeSubscriptions.call(this, baseUrl, subscriptions);

				if (kept.length > 0) {
					staticData.subscriptions = kept as unknown as IDataObject[];
					delete staticData.webhookId;
					throw new NodeOperationError(
						this.getNode(),
						`Could not remove ${kept.length} of ${subscriptions.length} subscription(s) from Syndie`,
						{ description: 'Deactivate the workflow again to retry.' },
					);
				}

				delete staticData.subscriptions;
				delete staticData.webhookId;
				return true;
			},
		},
	};
}

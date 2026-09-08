import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';
import {
	SYNDIE_EVENTS,
	getSyndieBaseUrl,
	isNotFoundError,
	readSubscriptions,
	resolveEventTypes,
	syndieApiUrl,
	unwrapSubscribeResponse,
	type SyndieSubscription,
} from './GenericFunctions';

/**
 * Best-effort removal of subscriptions this activation created before it
 * failed part-way. Errors are swallowed on purpose: the activation is
 * already failing with the real error, and the backend deduplicates a
 * re-subscribe of the same URL and event, so a leftover costs nothing.
 */
async function removeSubscriptions(
	this: IHookFunctions,
	baseUrl: string,
	subscriptions: SyndieSubscription[],
): Promise<void> {
	for (const subscription of subscriptions) {
		try {
			await this.helpers.httpRequestWithAuthentication.call(this, 'syndieOAuth2Api', {
				method: 'DELETE',
				url: syndieApiUrl(baseUrl, `/hooks/${subscription.webhookId}`),
				json: true,
			});
		} catch {
			// The activation is already failing; a leftover row is harmless.
		}
	}
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

	// Deliveries are passed through as received. The signature check lands in
	// the next commit; this one only changes how subscriptions are made.
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const bodyData = this.getBodyData();

		return {
			workflowData: [
				[
					{
						json: bodyData,
					},
				],
			],
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
						throw new NodeApiError(this.getNode(), error as JsonObject, {
							message: `Could not subscribe to "${eventType}" events`,
							description:
								'Check that the credential is connected and that this n8n is reachable over https.',
						});
					}
				}

				staticData.subscriptions = created as unknown as IDataObject[];
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
				const kept: SyndieSubscription[] = [];
				let firstError: unknown = undefined;

				for (const subscription of subscriptions) {
					try {
						await this.helpers.httpRequestWithAuthentication.call(this, 'syndieOAuth2Api', {
							method: 'DELETE',
							url: syndieApiUrl(baseUrl, `/hooks/${subscription.webhookId}`),
							json: true,
						});
					} catch (error) {
						if (isNotFoundError(error)) continue;
						kept.push(subscription);
						if (firstError === undefined) firstError = error;
					}
				}

				if (kept.length > 0) {
					staticData.subscriptions = kept as unknown as IDataObject[];
					delete staticData.webhookId;
					throw new NodeApiError(this.getNode(), firstError as JsonObject, {
						message: `Could not remove ${kept.length} of ${subscriptions.length} subscription(s)`,
						description: 'Deactivate the workflow again to retry.',
					});
				}

				delete staticData.subscriptions;
				delete staticData.webhookId;
				return true;
			},
		},
	};
}

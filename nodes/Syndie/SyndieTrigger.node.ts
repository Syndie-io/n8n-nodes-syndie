import type {
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	IHookFunctions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, NodeConnectionTypes } from 'n8n-workflow';
import { SYNDIE_API_BASE_URL } from '../../credentials/SyndieOAuth2Api.credentials';

// The Syndie webhook subscribe endpoint. The base URL is hardcoded to production
// (single source of truth in the credential) so the webhook calls hit the same
// API the OAuth flow authenticates against.
const SUBSCRIBE_URL = `${SYNDIE_API_BASE_URL}/api/integrations/automation/n8n/hooks/subscribe`;

export class SyndieTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Syndie Trigger',
		name: 'syndieTrigger',
		icon: { light: 'file:SyndieLogo.svg', dark: 'file:SyndieLogo.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: 'Syndie webhook trigger',
		description: 'Syndie webhook trigger with OAuth integration',
		defaults: {
			name: 'Syndie',
		},
		usableAsTool: true,
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
		// No user-facing parameters: the trigger registers n8n's own webhook URL
		// with the Syndie production API using the OAuth2 credential.
		properties: [],
	};

	// This method is called when the webhook receives data
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

	// Webhook lifecycle methods as required by n8n
	webhookMethods = {
		default: {
			// Always (re)create: the backend deduplicates identical subscriptions
			// (see docs/n8n-trigger.md §5.4), so we don't track existence here.
			checkExists: async function (this: IHookFunctions): Promise<boolean> {
				return false;
			},
			// Create/register the webhook
			create: async function (this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const workflow = this.getWorkflow();

				try {
					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'syndieOAuth2Api',
						{
							method: 'POST',
							url: SUBSCRIBE_URL,
							body: {
								automation_name: workflow.name || `n8n-workflow-${workflow.id}`,
								automation_id: workflow.id,
								event_type: null,
								target_url: webhookUrl,
							},
							json: true,
							headers: {
								'Content-Type': 'application/json',
							},
						},
					);

					// Persist the backend webhook id so delete() can unsubscribe later.
					// /hooks/subscribe returns the AutomationWebhook row (see docs/n8n-trigger.md §4).
					const webhookId = response?.id ?? response?.data?.id;
					if (webhookId !== undefined && webhookId !== null) {
						this.getWorkflowStaticData('node').webhookId = webhookId;
					}
					return true;
				} catch (error) {
					if (error.response) {
						throw new NodeApiError(this.getNode(), error, {
							message: `Failed to register webhook: ${error.response.status} ${error.response.statusText}`,
							description: error.response.data ? JSON.stringify(error.response.data) : undefined,
						});
					}
					throw new NodeOperationError(this.getNode(), 'Failed to register webhook', {
						description: error.message,
					});
				}
			},

			// Unregister the webhook on the backend via DELETE /n8n/hooks/:webhookId
			// (flips isActive: false — see docs/n8n-trigger.md §5.3).
			delete: async function (this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const webhookId = staticData.webhookId;

				// No stored id (e.g. activated before this version, or subscribe returned
				// no id) → nothing we can unsubscribe.
				if (webhookId === undefined || webhookId === null) {
					return true;
				}

				// Derive .../n8n/hooks/subscribe → .../n8n/hooks/<id>
				const unsubscribeUrl = SUBSCRIBE_URL.replace(/\/subscribe\/?$/, `/${webhookId}`);

				try {
					await this.helpers.httpRequestWithAuthentication.call(this, 'syndieOAuth2Api', {
						method: 'DELETE',
						url: unsubscribeUrl,
						json: true,
					});
				} catch (error) {
					// Treat "already gone" (404) as success; surface anything else so a
					// genuine failure is visible and the id is kept for a retry.
					if (!error.response || error.response.status !== 404) {
						throw new NodeApiError(this.getNode(), error, {
							message: 'Failed to unregister webhook',
							description: error.response?.data
								? JSON.stringify(error.response.data)
								: error.message,
						});
					}
				}

				delete staticData.webhookId;
				return true;
			},
		},
	};
}

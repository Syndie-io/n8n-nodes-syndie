import type {
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	INodeProperties,
	IHookFunctions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, NodeConnectionTypes } from 'n8n-workflow';

/**
 * Resolve the Syndie subscribe endpoint.
 * Priority: explicit "Backend URL Override" node param → otherwise derive from
 * the Environment selected on the credential (single source of truth so the
 * webhook calls hit the same API as the OAuth flow).
 */
async function resolveSubscribeUrl(ctx: IHookFunctions): Promise<string> {
	const override = ((ctx.getNodeParameter('backendUrl', '') as string) || '').trim();
	if (override) {
		return override;
	}

	const cred = await ctx.getCredentials('syndieOAuth2Api');
	const env = (cred?.environment as string) || '';
	const base = (
		env === 'custom' ? ((cred?.customBaseUrl as string) || '') : env
	).replace(/\/$/, '');

	if (!base) {
		throw new NodeOperationError(
			ctx.getNode(),
			'No Syndie API base URL configured. Set the Environment on the credential or fill in the Backend URL Override.',
		);
	}

	return `${base}/api/integrations/automation/n8n/hooks/subscribe`;
}

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
		properties: [
			{
				displayName: 'Backend URL Override',
				name: 'backendUrl',
				type: 'string',
				default: '',
				placeholder:
					'https://api.syndie.io/api/integrations/automation/n8n/hooks/subscribe',
				description:
					'Optional. Full URL of the Syndie subscribe endpoint. Leave empty to use the Environment selected in the credential.',
			},
		] as INodeProperties[],
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
				const backendUrl = await resolveSubscribeUrl(this);
				const workflow = this.getWorkflow();

				try {
					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'syndieOAuth2Api',
						{
							method: 'POST',
							url: backendUrl,
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

				const backendUrl = await resolveSubscribeUrl(this);
				// Derive .../n8n/hooks/subscribe → .../n8n/hooks/<id>
				const unsubscribeUrl = backendUrl.replace(/\/subscribe\/?$/, `/${webhookId}`);

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

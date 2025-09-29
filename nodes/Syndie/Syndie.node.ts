import type {
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	INodeProperties,
	IHookFunctions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export class Syndie implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Syndie',
		name: 'syndie',
		icon: 'file:SyndieLogo.svg',
		group: ['trigger'],
		version: 1,
		description: 'Syndie webhook trigger with OAuth integration',
		defaults: {
			name: 'Syndie',
		},
		inputs: [],
		outputs: ['main' as unknown as import('n8n-workflow').NodeConnectionType],
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
				displayName: 'Backend URL',
				name: 'backendUrl',
				type: 'string',
				default: 'https://syndie.io/api/integrations/automation/n8n/hooks/subscribe',
				description: 'URL to send the webhook ID to your backend',
				required: true,
			},
			{
				displayName: 'Continue on Fail',
				name: 'continueOnFail',
				type: 'boolean',
				default: false,
				description: 'Whether to continue when the webhook registration fails',
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
						pairedItem: { item: 0 },
					},
				],
			],
		};
	}

	// Webhook lifecycle methods as required by n8n
	webhookMethods = {
		default: {
			// Check if the webhook exists (for now, always return false to always create)
			checkExists: async function (this: IHookFunctions): Promise<boolean> {
				// Optionally, implement logic to check if the webhook is already registered
				return false;
			},
			// Create/register the webhook
			create: async function (this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const backendUrl = this.getNodeParameter('backendUrl') as string;
				const workflow = this.getWorkflow();

				try {
					await this.helpers.requestWithAuthentication.call(
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
						}
					);

					return true;
				} catch (error) {
					const continueOnFail = this.getNodeParameter('continueOnFail', false) as boolean;
					if (continueOnFail) {
						return false;
					}
					
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
			
			delete: async function (this: IHookFunctions): Promise<boolean> {
				// Just return true - we don't need to unregister webhooks
				return true;
			},
		},
	};
}

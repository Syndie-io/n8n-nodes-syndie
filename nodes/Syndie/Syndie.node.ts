import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	INodeProperties,
	IDataObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, NodeConnectionTypes } from 'n8n-workflow';
import { SYNDIE_API_BASE_URL } from '../../credentials/SyndieOAuth2Api.credentials';

// The Syndie "create lead" action endpoint. The base URL is hardcoded to
// production (single source of truth in the credential) — the same API the
// OAuth flow authenticates against.
const CREATE_LEAD_URL = `${SYNDIE_API_BASE_URL}/api/integrations/automation/n8n/actions/create-lead`;

// Optional lead fields, mirrored from the backend CreateAutomationLeadDto.
const OPTIONAL_LEAD_FIELDS = [
	'firstName',
	'lastName',
	'jobTitle',
	'company',
	'location',
	'linkedinUrl',
	'publicIdentifier',
	'connectionStatus',
] as const;

export class Syndie implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Syndie',
		name: 'syndie',
		icon: { light: 'file:SyndieLogo.svg', dark: 'file:SyndieLogo.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ "Lead: " + $parameter["operation"] }}',
		description: 'Send leads to Syndie',
		defaults: {
			name: 'Syndie',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'syndieOAuth2Api',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Lead',
						value: 'lead',
					},
				],
				default: 'lead',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['lead'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						action: 'Create a lead',
						description: 'Add a lead to the connected Syndie account',
					},
				],
				default: 'create',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['lead'],
						operation: ['create'],
					},
				},
				options: [
					{
						displayName: 'Company',
						name: 'company',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Connection Status',
						name: 'connectionStatus',
						type: 'string',
						default: '',
						placeholder: 'pending',
						description: 'Initial connection status. Defaults to "pending" when empty.',
					},
					{
						displayName: 'First Name',
						name: 'firstName',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Job Title',
						name: 'jobTitle',
						type: 'string',
						default: '',
						description: 'Stored on the lead as its headline',
					},
					{
						displayName: 'Last Name',
						name: 'lastName',
						type: 'string',
						default: '',
					},
					{
						displayName: 'LinkedIn URL',
						name: 'linkedinUrl',
						type: 'string',
						default: '',
						placeholder: 'https://linkedin.com/in/john-doe',
						description:
							'The public identifier is parsed from this when Public Identifier is left empty',
					},
					{
						displayName: 'Location',
						name: 'location',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Public Identifier',
						name: 'publicIdentifier',
						type: 'string',
						default: '',
						placeholder: 'john-doe',
						description: 'LinkedIn public identifier (the profile slug after /in/)',
					},
				],
			},
		] as INodeProperties[],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const additionalFields = this.getNodeParameter(
					'additionalFields',
					i,
					{},
				) as IDataObject;

				const body: IDataObject = {};

				// Identify the source automation: the id of the n8n workflow this
				// node runs in. The backend stores it on the external lead so leads
				// can be traced back to the automation that produced them.
				const automationId = this.getWorkflow()?.id;
				if (automationId !== undefined && automationId !== null && `${automationId}` !== '') {
					body.automationId = `${automationId}`;
				}

				for (const key of OPTIONAL_LEAD_FIELDS) {
					const value = additionalFields[key];
					if (value !== undefined && value !== null && `${value}`.trim() !== '') {
						body[key] = `${value}`.trim();
					}
				}

				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'syndieOAuth2Api',
					{
						method: 'POST',
						url: CREATE_LEAD_URL,
						body,
						json: true,
						headers: {
							'Content-Type': 'application/json',
						},
					},
				);

				returnData.push({
					json: (response as IDataObject) ?? {},
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error.message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error.response) {
					throw new NodeApiError(this.getNode(), error, {
						message: `Failed to create lead: ${error.response.status} ${error.response.statusText}`,
						description: error.response.data
							? JSON.stringify(error.response.data)
							: undefined,
						itemIndex: i,
					});
				}
				throw new NodeOperationError(this.getNode(), 'Failed to create lead', {
					description: error.message,
					itemIndex: i,
				});
			}
		}

		return [returnData];
	}
}

import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { getSyndieBaseUrl, syndieApiUrl } from './GenericFunctions';

/**
 * Optional details an import may carry, mirrored from the backend's
 * ImportLeadDto. The three the backend accepts only for older workflows
 * (campaignId, automationId, connectionStatus) are deliberately not sent.
 */
const IMPORT_DETAIL_FIELDS = [
	'company',
	'firstName',
	'jobTitle',
	'lastName',
	'location',
	'phone',
	'publicIdentifier',
] as const;

function text(value: unknown): string {
	return typeof value === 'string' || typeof value === 'number' ? `${value}`.trim() : '';
}

/** POST .../actions/import-lead — the body carries only what was filled in. */
async function importLead(this: IExecuteFunctions, baseUrl: string, i: number): Promise<unknown> {
	const additional = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
	const body: IDataObject = {};

	// A workflow saved by 0.3.x kept the LinkedIn URL inside Additional
	// Fields; read it from there when the new top-level field is empty.
	const linkedinUrl = text(this.getNodeParameter('linkedinUrl', i, '')) || text(additional.linkedinUrl);
	const email = text(this.getNodeParameter('email', i, ''));
	if (linkedinUrl) body.linkedinUrl = linkedinUrl;
	if (email) body.email = email;

	for (const key of IMPORT_DETAIL_FIELDS) {
		const value = text(additional[key]);
		if (value) body[key] = value;
	}

	if (!body.linkedinUrl && !body.email && !body.publicIdentifier) {
		throw new NodeOperationError(
			this.getNode(),
			'Give a LinkedIn URL, a public identifier or an email so the lead can be matched',
			{ itemIndex: i },
		);
	}

	return await this.helpers.httpRequestWithAuthentication.call(this, 'syndieOAuth2Api', {
		method: 'POST',
		url: syndieApiUrl(baseUrl, '/actions/import-lead'),
		body,
		json: true,
	});
}

/** GET .../actions/find-lead — answers { found, lead }; not found is not an error. */
async function findLead(this: IExecuteFunctions, baseUrl: string, i: number): Promise<unknown> {
	const qs: IDataObject = {};
	const linkedin = text(this.getNodeParameter('linkedin', i, ''));
	const email = text(this.getNodeParameter('findEmail', i, ''));
	if (linkedin) qs.linkedin = linkedin;
	if (email) qs.email = email;

	if (!qs.linkedin && !qs.email) {
		throw new NodeOperationError(
			this.getNode(),
			'Give a LinkedIn URL or an email to look the lead up by',
			{ itemIndex: i },
		);
	}

	return await this.helpers.httpRequestWithAuthentication.call(this, 'syndieOAuth2Api', {
		method: 'GET',
		url: syndieApiUrl(baseUrl, '/actions/find-lead'),
		qs,
		json: true,
	});
}

export class Syndie implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Syndie',
		name: 'syndie',
		icon: { light: 'file:SyndieLogo.svg', dark: 'file:SyndieLogo.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] === "find" ? "Find a lead" : "Import a lead" }}',
		description: 'Import leads into Syndie, or look them up',
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
						name: 'Find',
						value: 'find',
						action: 'Find a lead',
						description: 'Look a lead up by LinkedIn address or email; not found is a normal answer',
					},
					{
						// The stored value stays "create" so workflows saved by 0.3.x keep
						// opening; only the label changed, because that is what it does now.
						name: 'Import',
						value: 'create',
						action: 'Import a lead',
						description:
							'Add a lead as a contact, or return the existing contact when the person is already there',
					},
				],
				default: 'create',
			},
			{
				displayName: 'LinkedIn URL',
				name: 'linkedinUrl',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://www.linkedin.com/in/sarah-green',
				description: 'The profile address, or just the public identifier after /in/',
				displayOptions: {
					show: {
						resource: ['lead'],
						operation: ['create'],
					},
				},
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				default: '',
				placeholder: 'e.g. sarah@kestrel.io',
				description: 'Used to match the person when there is no LinkedIn address',
				displayOptions: {
					show: {
						resource: ['lead'],
						operation: ['create'],
					},
				},
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
						displayName: 'Location',
						name: 'location',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Phone',
						name: 'phone',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Public Identifier',
						name: 'publicIdentifier',
						type: 'string',
						default: '',
						placeholder: 'e.g. sarah-green',
						description: 'The LinkedIn profile slug after /in/, when you have it instead of the URL',
					},
				],
			},
			{
				displayName: 'LinkedIn URL',
				name: 'linkedin',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://www.linkedin.com/in/sarah-green',
				description: 'The profile address or the public identifier after /in/',
				displayOptions: {
					show: {
						resource: ['lead'],
						operation: ['find'],
					},
				},
			},
			{
				displayName: 'Email',
				name: 'findEmail',
				type: 'string',
				default: '',
				placeholder: 'e.g. sarah@kestrel.io',
				displayOptions: {
					show: {
						resource: ['lead'],
						operation: ['find'],
					},
				},
			},
		] as INodeProperties[],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const baseUrl = await getSyndieBaseUrl.call(this);

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const response =
					operation === 'find'
						? await findLead.call(this, baseUrl, i)
						: await importLead.call(this, baseUrl, i);

				returnData.push({
					json: (response as IDataObject) ?? {},
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error.message, { itemIndex: i });
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

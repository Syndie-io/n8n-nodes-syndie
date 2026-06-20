import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class SyndieOAuth2Api implements ICredentialType {
	name = 'syndieOAuth2Api';
	extends = ['oAuth2Api'];

	icon = { light: 'file:SyndieLogo.svg', dark: 'file:SyndieLogo.dark.svg' } as const;

	oauth2Options = {
		includeCredentialsOnRefresh: true,
		tokenResponseProperty: {
			accessToken: 'access_token',
			refreshToken: 'refresh_token',
			expiresIn: 'expires_in',
		},
	};

	displayName = 'Syndie OAuth2 API';
	documentationUrl =
		'https://docs.google.com/document/d/1ebphd5HvkFhFgU7H_yAQDMDWEu6DBzfOzhwVjHlYCxM/edit?tab=t.0#heading=h.ha73d5u5qe0e';

	properties: INodeProperties[] = [
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'authorizationCode',
		},
		{
			displayName: 'Environment',
			name: 'environment',
			type: 'options',
			options: [
				{
					name: 'Production (api.syndie.io)',
					value: 'https://api.syndie.io',
				},
				{
					name: 'Beta / Staging',
					value: 'https://m6b7diz5x8.ap-south-1.awsapprunner.com',
				},
				{
					name: 'Localhost (http://localhost:3000)',
					value: 'http://localhost:3000',
				},
				{
					name: 'Custom…',
					value: 'custom',
				},
			],
			default: 'https://m6b7diz5x8.ap-south-1.awsapprunner.com',
			description: 'Which Syndie API environment to connect to',
		},
		{
			displayName: 'Custom Base URL',
			name: 'customBaseUrl',
			type: 'string',
			default: '',
			placeholder: 'https://my-host.example.com',
			description: 'Base URL of the Syndie API (no trailing slash). Used only when Environment is "Custom".',
			displayOptions: { show: { environment: ['custom'] } },
		},
		{
			displayName: 'Client ID',
			name: 'clientId',
			type: 'string',
			default: '',
			required: true,
			description: 'The Client ID provided by Syndie for your application',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default:
				'={{ ($self["environment"] === "custom" ? ($self["customBaseUrl"] || "").replace(/\\/$/, "") : $self["environment"]) + "/api/integrations/automation/n8n/oauth/authorize" }}',
			required: true,
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default:
				'={{ ($self["environment"] === "custom" ? ($self["customBaseUrl"] || "").replace(/\\/$/, "") : $self["environment"]) + "/api/integrations/automation/n8n/oauth/callback" }}',
			required: true,
		},
		{
			displayName: 'Use PKCE',
			name: 'pkce',
			type: 'hidden',
			default: true,
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'header',
		},
	];
}

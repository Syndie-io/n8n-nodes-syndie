import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Where the Syndie production API lives. It is the default of the visible
 * "API Base URL" field below, so a published node talks to production unless
 * the person configuring the credential deliberately points it elsewhere
 * (a staging environment, or a tunnel while testing).
 */
export const SYNDIE_API_BASE_URL = 'https://api.syndie.io';

/**
 * The path under which the api-engine serves everything n8n needs: the OAuth
 * server, the webhook subscriptions and the lead actions.
 */
export const SYNDIE_N8N_API_PATH = '/api/integrations/automation/n8n';

const BASE_URL_EXPRESSION = '={{ $self["baseUrl"].replace(/\\/+$/, "") }}';

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
	documentationUrl = 'https://github.com/Syndie-io/n8n-nodes-syndie#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'authorizationCode',
		},
		{
			displayName: 'Client ID',
			name: 'clientId',
			type: 'string',
			default: '',
			required: true,
			description: 'The Client ID Syndie issued for n8n',
		},
		{
			displayName: 'API Base URL',
			name: 'baseUrl',
			type: 'string',
			default: SYNDIE_API_BASE_URL,
			placeholder: 'e.g. https://api.syndie.io',
			description:
				'Where the Syndie API lives. Keep the default unless Syndie support gave you another address.',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: `${BASE_URL_EXPRESSION}${SYNDIE_N8N_API_PATH}/oauth/authorize`,
			required: true,
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: `${BASE_URL_EXPRESSION}${SYNDIE_N8N_API_PATH}/oauth/token`,
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

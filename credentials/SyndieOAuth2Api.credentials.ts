import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Base URL of the Syndie production API. This is the single source of truth for
 * where the credential and both nodes talk to. It is intentionally hardcoded:
 * the public/verified node only ever connects to production. (Internal beta /
 * localhost testing is done from a separate, unpublished branch.)
 */
export const SYNDIE_API_BASE_URL = 'https://api.syndie.io';

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
			description: 'The Client ID provided by Syndie for your application',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: `${SYNDIE_API_BASE_URL}/api/integrations/automation/n8n/oauth/authorize`,
			required: true,
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: `${SYNDIE_API_BASE_URL}/api/integrations/automation/n8n/oauth/callback`,
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

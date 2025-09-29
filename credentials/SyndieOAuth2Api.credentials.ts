import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class SyndieOAuth2Api implements ICredentialType {
	name = 'syndieOAuth2Api';
	extends = ['oAuth2Api'];

	oauth2Options = {
		includeCredentialsOnRefresh: true,
		tokenResponseProperty: {
			accessToken: 'access_token',
			refreshToken: 'refresh_token',
			expiresIn: 'expires_in',
		},
	};

	displayName = 'Syndie OAuth2 API';
	documentationUrl = 'https://docs.google.com/document/d/1ebphd5HvkFhFgU7H_yAQDMDWEu6DBzfOzhwVjHlYCxM/edit?tab=t.0#heading=h.ha73d5u5qe0e';

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
			default: 'https://syndie.io/api/integrations/automation/n8n/oauth/authorize',
			required: true,
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: 'https://syndie.io/api/integrations/automation/n8n/oauth/callback',
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
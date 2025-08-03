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
	documentationUrl = 'https://docs.syndie.app';

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
			type: 'hidden',
			default: 'd4a5b1c2-e3f4-5a6b-7c8d-9e0f1a2b3c4d-n8n-syndie',
			required: true,
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: 'https://app-syndie-io-git-dev-latest-syndieio.vercel.app/api/integrations/automation/n8n/oauth/authorize',
			required: true,
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: 'https://app-syndie-io-git-dev-latest-syndieio.vercel.app/api/integrations/automation/n8n/oauth/callback',
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
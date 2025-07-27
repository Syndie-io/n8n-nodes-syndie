import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class SyndieOAuth2Api implements ICredentialType {
    name = 'syndieOAuth2Api';
    extends = ['oAuth2Api'];
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
            default: 'd4a5b1c2-e3f4-5a6b-7c8d-9e0f1a2b3c4d-n8n-syndie', // Replace with your actual client ID
            required: true,
        },
        {
            displayName: 'Authorization URL',
            name: 'authUrl',
            type: 'hidden',
            default: 'http://localhost:3000/api/integrations/automation/n8n/oauth/authorize',
            required: true,
        },
        {
            displayName: 'Access Token URL',
            name: 'accessTokenUrl',
            type: 'hidden',
            // This should point to the callback URL, which then exchanges the code for a token.
            default: 'http://localhost:3000/api/integrations/automation/n8n/oauth/callback',
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
            default: 'body',
        },
    ];
}
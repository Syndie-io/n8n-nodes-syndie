

# n8n-nodes-syndie

This is an n8n community node for [Syndie.io](https://syndie.io), an AI-powered sales and outreach automation platform. This node allows you to integrate Syndie.io into your n8n workflows, enabling you to automate your sales and marketing processes.

[n8n](https://n8n.io) is a free and source-available workflow automation tool.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

This n8n node acts as a trigger, allowing you to start workflows based on events within your Syndie.io campaigns. When a specific event occurs in a Syndie.io campaign (like a lead responding or a message being sent), this node will trigger and fetch the relevant data from that campaign, making it available in your n8n workflow.

Specifically, this node allows you to:

-   Trigger a workflow when an event happens in a Syndie.io campaign.
-   Fetch data associated with that event (e.g., lead details, message content).

## Credentials

To use this node, you will need:

-   An active Syndie.io account. You can sign up at [syndie.io](https://syndie.io).
-   Your Syndie.io API credentials to connect to your account.

To get started:

1.  Install this node package in your n8n instance.
2.  Create a new workflow in n8n.
3.  Add the Syndie Trigger node to your workflow.
4.  Configure the node with your Syndie.io credentials (OAuth2).
5.  Select the campaign and the event that should trigger the workflow.
6.  Connect other nodes to the Syndie Trigger to process the data.

## Compatibility

This node is tested against n8n version 1.0.0 and later.

## Usage

An example workflow could be:

1.  The Syndie Trigger node is configured to listen for "Lead Replied" events in a campaign.
2.  When a lead replies in Syndie.io, the workflow is triggered, and the node outputs the lead's information and the message they sent.
3.  A "Set" node can be used to format the data.
4.  A Slack node then sends a notification to your sales team with the lead's details and their message, allowing for a quick follow-up.

## Resources

-   [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
-   [Syndie.io website](https://syndie.io)
-   [Syndie.io Help Center](https://help.syndie.io/en/)

## License

[MIT](LICENSE.md)

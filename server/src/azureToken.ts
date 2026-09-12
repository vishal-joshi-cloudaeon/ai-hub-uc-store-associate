import { DefaultAzureCredential } from '@azure/identity'

// DefaultAzureCredential tries, in order: env vars (AZURE_TENANT_ID /
// AZURE_CLIENT_ID / AZURE_CLIENT_SECRET), workload identity, managed identity,
// then the Azure CLI's logged-in account. In production (Azure App Service /
// Container Apps / AKS with a managed identity assigned) it needs zero
// configuration here — the identity is resolved from the hosting environment.
// Locally, `az login` (Azure CLI credential) or a service principal via env
// vars both work without any code change.
const credential = new DefaultAzureCredential()

const TOKEN_SCOPE = process.env.AZURE_TOKEN_SCOPE || 'https://ai.azure.com/.default'

// Refresh a little before actual expiry so an in-flight request never races
// a token that dies mid-call.
const REFRESH_SKEW_MS = 60_000

let cached: { token: string; expiresOnTimestamp: number } | null = null

export async function getAccessToken(): Promise<string> {
  const now = Date.now()
  if (cached && cached.expiresOnTimestamp - REFRESH_SKEW_MS > now) {
    return cached.token
  }

  const result = await credential.getToken(TOKEN_SCOPE)
  if (!result) {
    throw new Error(
      `Failed to acquire an Azure AD token for scope "${TOKEN_SCOPE}". Check that the ` +
        'identity running this service (managed identity, service principal, or ' +
        '`az login` account) exists and has been granted an RBAC role (e.g. "Azure AI ' +
        'Developer") on the target AI Foundry project.'
    )
  }

  cached = { token: result.token, expiresOnTimestamp: result.expiresOnTimestamp }
  return cached.token
}

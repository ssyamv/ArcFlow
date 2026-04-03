import { getConfig } from "../config";

async function graphql(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
  const config = getConfig();
  const res = await fetch(`${config.wikijsBaseUrl}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.wikijsApiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    console.error(`Wiki.js GraphQL error: ${res.status}`);
    return null;
  }

  return await res.json();
}

export async function triggerSync(): Promise<void> {
  try {
    await graphql(`
      mutation {
        site {
          importAll
        }
      }
    `);
  } catch (error) {
    // Non-blocking: Wiki.js Git sync will catch up eventually
    console.error("Wiki.js sync trigger failed:", error);
  }
}

export async function searchPages(query: string): Promise<unknown> {
  return graphql(
    `
      query ($query: String!) {
        pages {
          search(query: $query) {
            results {
              id
              title
              path
              description
            }
            totalHits
          }
        }
      }
    `,
    { query },
  );
}

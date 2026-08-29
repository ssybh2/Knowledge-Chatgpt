function successResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function errorResult(error) {
  return {
    content: [{ type: 'text', text: `Teddy Memory error: ${error?.message || 'unknown error'}` }],
    isError: true,
  };
}

function wrap(handler) {
  return async (input) => {
    try {
      return successResult(await handler(input));
    } catch (error) {
      return errorResult(error);
    }
  };
}

export function createToolHandlers(client) {
  return {
    search_memory: wrap((input) => client.searchMemory(input)),
    get_context: wrap((input) => client.getContext(input)),
    get_conversation: wrap((input) => client.getConversation(input)),
  };
}

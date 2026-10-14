// Thin, disposable browser adapter. Core operations do not depend on WebMCP or a backend.
export function modelContext(document, navigator) {
  if (typeof document?.modelContext?.registerTool === 'function') return document.modelContext;
  // Older Chromium previews used Navigator; prefer the current Document draft when both exist.
  if (typeof navigator?.modelContext?.registerTool === 'function') return navigator.modelContext;
  return null;
}
export function createWebMCP(api, context, onStatus = () => {}) {
  let generation = 0,
    controller = null,
    registered = [],
    enabled = false,
    lifecycle = Promise.resolve();
  function cancel() {
    enabled = false;
    controller?.abort();
    controller = null;
    api.cancel();
  }
  async function cleanup() {
    cancel();
    for (const name of registered) {
      try {
        await context?.unregisterTool?.(name);
      } catch {}
    }
    registered = [];
  }
  async function register(current) {
    await cleanup();
    if (current !== generation) return;
    if (!context) {
      onStatus({ state: 'unsupported', count: 0 });
      return;
    }
    const lifetime = new AbortController();
    controller = lifetime;
    enabled = true;
    try {
      for (const tool of api.tools) {
        if (current !== generation) return;
        await context.registerTool(
          {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: { readOnlyHint: tool.readOnly, untrustedContentHint: true },
            async execute(args, options = {}) {
              if (!enabled || lifetime.signal.aborted || current !== generation)
                throw Error('AI 协作已关闭，请重新发现工具');
              const invocation = new AbortController(),
                cancel = () => invocation.abort();
              const signals = [lifetime.signal, options.signal].filter(Boolean);
              for (const signal of signals) {
                if (signal.aborted) invocation.abort();
                signal.addEventListener('abort', cancel, { once: true });
              }
              try {
                return await api.execute(tool.name, args, { signal: invocation.signal });
              } catch (e) {
                return {
                  isError: true,
                  code: e.code || 'OPERATION_FAILED',
                  message: e.message,
                  revision: api.getDocument().revision,
                };
              } finally {
                for (const signal of signals) signal.removeEventListener('abort', cancel);
              }
            },
          },
          { signal: lifetime.signal },
        );
        if (current !== generation) {
          lifetime.abort();
          try {
            await context.unregisterTool?.(tool.name);
          } catch {}
          return;
        }
        registered.push(tool.name);
      }
      onStatus({ state: 'ready', count: registered.length });
    } catch (e) {
      if (current !== generation) return;
      await cleanup();
      onStatus({ state: 'error', count: 0, message: e.message });
    }
  }
  return {
    start() {
      const current = ++generation;
      cancel();
      lifecycle = lifecycle.then(() => register(current));
      return lifecycle;
    },
    stop() {
      const current = ++generation;
      cancel();
      lifecycle = lifecycle.then(async () => {
        await cleanup();
        if (current === generation) onStatus({ state: 'disabled', count: 0 });
      });
      return lifecycle;
    },
  };
}

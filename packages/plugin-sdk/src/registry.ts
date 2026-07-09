export interface Registry<T> {
  register(name: string, value: T): void;
  get(name: string): T;
  tryGet(name: string): T | undefined;
  list(): Array<{ name: string; value: T }>;
}

export function createRegistry<T>(kind: string): Registry<T> {
  const map = new Map<string, T>();
  return {
    register(name, value) {
      if (map.has(name)) throw new Error(`Duplicate ${kind} "${name}"`);
      map.set(name, value);
    },
    get(name) {
      const value = map.get(name);
      if (value === undefined) {
        const known = [...map.keys()].join(', ') || '(none registered)';
        throw new Error(`Unknown ${kind} "${name}". Registered: ${known}`);
      }
      return value;
    },
    tryGet(name) {
      return map.get(name);
    },
    list() {
      return [...map.entries()].map(([name, value]) => ({ name, value }));
    },
  };
}

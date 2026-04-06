export function createIdGenerator(): (prefix: string) => string {
  const counters = new Map<string, number>();

  return (prefix: string): string => {
    const count = (counters.get(prefix) ?? 0) + 1;

    counters.set(prefix, count);

    return `${prefix}-${count}`;
  };
}

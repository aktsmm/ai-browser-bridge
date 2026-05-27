export function defaultAllowEvaluateAction(): boolean {
  return false;
}

export function resolveAllowEvaluateAction(options: {
  storedValue: boolean | undefined;
  shouldForceFullAutoMigration: boolean;
}): boolean {
  if (options.shouldForceFullAutoMigration) {
    return defaultAllowEvaluateAction();
  }

  if (typeof options.storedValue === "boolean") {
    return options.storedValue;
  }

  return defaultAllowEvaluateAction();
}

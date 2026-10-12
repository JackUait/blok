export const installStdoutGuard = (target: Console): void => {
  const toStderr = (...args: unknown[]): void => target.error(...args);

  Object.assign(target, {
    log: toStderr,
    info: toStderr,
    debug: toStderr,
  });
};

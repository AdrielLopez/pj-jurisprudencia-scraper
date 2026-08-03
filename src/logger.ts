export type LogLevel = "debug" | "info" | "warn" | "error";

function serializeExtra(extra: Record<string, unknown> | undefined): string {
  if (!extra || Object.keys(extra).length === 0) return "";
  return ` ${JSON.stringify(extra)}`;
}

export class Logger {
  constructor(private readonly debugEnabled = false) {}

  debug(message: string, extra?: Record<string, unknown>): void {
    if (this.debugEnabled) this.write("debug", message, extra);
  }

  info(message: string, extra?: Record<string, unknown>): void {
    this.write("info", message, extra);
  }

  warn(message: string, extra?: Record<string, unknown>): void {
    this.write("warn", message, extra);
  }

  error(message: string, extra?: Record<string, unknown>): void {
    this.write("error", message, extra);
  }

  private write(
    level: LogLevel,
    message: string,
    extra?: Record<string, unknown>,
  ): void {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${serializeExtra(extra)}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}

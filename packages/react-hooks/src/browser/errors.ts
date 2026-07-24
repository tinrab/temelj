export class BrowserHookError extends Error {
  constructor(message: string, context?: Function) {
    super(message);
    this.name = "BrowserHookError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static clipboardUnavailable(this: void): never {
    throw new BrowserHookError(
      "Clipboard is not available outside the browser",
      BrowserHookError.clipboardUnavailable,
    );
  }

  static createGeolocationUnsupported(this: void): BrowserHookError {
    return new BrowserHookError(
      "Geolocation is not supported",
      BrowserHookError.createGeolocationUnsupported,
    );
  }
}

/**
 * Minimal logger mirroring the behaviour of Python's `logging` module.
 * The default level is `warning`, matching Python's root logger default, so
 * `debug`/`info` messages are suppressed unless the level is lowered.
 */

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warning: 30,
    error: 40,
};

export interface Logger {
    level: LogLevel;
    debug(message: string): void;
    info(message: string): void;
    warning(message: string): void;
    error(message: string): void;
    log(level: LogLevel, message: string): void;
}

/** Create a logger that prefixes messages with `${LEVEL}:${name}:`. */
export function createLogger(name: string): Logger {
    return {
        level: 'warning',
        debug(message: string): void {
            this.log('debug', message);
        },
        info(message: string): void {
            this.log('info', message);
        },
        warning(message: string): void {
            this.log('warning', message);
        },
        error(message: string): void {
            this.log('error', message);
        },
        log(level: LogLevel, message: string): void {
            if (LEVEL_ORDER[level] >= LEVEL_ORDER[this.level]) {
                // eslint-disable-next-line no-console
                console.log(`${level.toUpperCase()}:${name}:${message}`);
            }
        },
    };
}
